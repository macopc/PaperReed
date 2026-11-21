"""Interrupt an IMAP Junk STORE and verify its receipt, local state and undo."""
import argparse
import json
from pathlib import Path
import socket
import sys
from threading import Event


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--upstream', type=Path, required=True)
    parser.add_argument('--mailsync', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--interrupt', choices=('before-store', 'after-store', 'disconnect', 'rejected'),
                        required=True)
    parser.add_argument('--remove-copy', choices=('neighbor', 'target'))
    parser.add_argument('--store-fault', choices=('expunge', 'ignore', 'partial-expunge'))
    args = parser.parse_args()
    if args.remove_copy and args.interrupt != 'after-store':
        parser.error('--remove-copy requires --interrupt after-store')
    if args.store_fault and args.interrupt != 'before-store':
        parser.error('--store-fault requires --interrupt before-store')
    args.output.mkdir(parents=True)
    sys.path.insert(0, str(args.upstream.resolve() / 'mailsync/test'))
    from harness.mailgen import message
    from harness.mailsync import MailsyncProcess, account_json
    from harness.servers.fake import FakeServer

    header = 'spam-unread-restart@example.test'
    seen = r'\Seen'
    server = FakeServer('dovecot', smtp=True)
    raw = message(1, subject='Junk flags across a restart', message_id=f'<{header}>')
    target = server.append('Junk', raw, [])
    partial = args.store_fault == 'partial-expunge'
    neighbor = server.append('Junk', raw, [] if partial else [seen])
    server.append('Archive', raw, [r'\Flagged'])
    archive_before = server.truth()['Archive']
    held = Event()
    release = Event()
    before_store = args.interrupt == 'before-store'
    disconnect = args.interrupt == 'disconnect'
    rejected = args.interrupt == 'rejected'

    def interrupt_store(session):
        if rejected:
            session.reject_next = (None, 'Fixture rejects STORE')
            return
        if before_store:
            held.set()
            release.wait(25)
            session.reject_next = (None, 'Fixture interrupted STORE before mutation')
            return

        original = session.ok

        def withhold_ack(tag, text, code=None):
            session.ok = original
            assert text == 'Store completed.', text
            held.set()
            if release.wait(25) and disconnect:
                session.connection.shutdown(socket.SHUT_RDWR)
                session.connection.close()

        session.ok = withhold_ack

    server.start()
    account = account_json(**server.account_kwargs(), account_id='c-spam-unread-restart')
    proc = MailsyncProcess(account, args.output.resolve(), binary=args.mailsync.resolve())

    def receipt(task_id):
        with proc.db() as db:
            row = db.execute('SELECT data FROM Task WHERE id = ?', (task_id,)).fetchone()
        return json.loads(row['data']) if row else {}

    def finish(task_id):
        proc.wait_for(lambda: receipt(task_id).get('status') == 'complete',
                      30, 'scoped task completes after resumption')
        return receipt(task_id)

    def unread_uids():
        return {uid for uid, copy in server.truth()['Junk'].items() if seen not in copy['flags']}

    try:
        proc.start()
        proc.wait_quiescent(timeout=30, settle=1)
        source = proc.db_folders()['Junk']['id']
        with proc.db() as db:
            message_id = db.execute('SELECT id FROM Message WHERE headerMessageId = ?', (header,)).fetchone()['id']

        def local_state():
            with proc.db() as db:
                rows = db.execute('SELECT remoteUID, unread FROM MessageFolder WHERE messageId = ? AND folderId = ?',
                                  (message_id, source))
                pending = db.execute("SELECT json_extract(data, '$._suc') FROM Message WHERE id = ?",
                                     (message_id,)).fetchone()[0]
                return {row['remoteUID']: bool(row['unread']) for row in rows}, pending

        since = proc.elapsed()
        server.at('before_command', interrupt_store, command=r'UID STORE ', mailbox='Junk')
        task = {'__cls': 'ChangeUnreadTask', 'messageIds': [message_id], 'sourceFolderId': source, 'unread': False}
        task_id = proc.queue_task(task)
        result_path = args.output / 'result.json'
        if rejected:
            proc.wait_for(lambda: receipt(task_id).get('status') == 'complete',
                          15, 'rejected STORE records a terminal receipt')
            finished = receipt(task_id)
            result_path.write_text(json.dumps(finished, indent=2) + '\n')
            assert finished.get('error'), finished
            assert not finished['unreadPlacements'] and 'unreadAttempt' not in finished
            assert unread_uids() == {target} and local_state() == ({target: True, neighbor: False}, 0)
            assert server.truth()['Archive'] == archive_before
            print('PASS rejected Junk STORE settles with no undo and releases the pending message')
            return
        try:
            assert held.wait(15), 'reached the intended STORE interruption point'
            initial_unread = {target, neighbor} if partial else {target}
            assert unread_uids() == (initial_unread if before_store else set())
            in_flight = receipt(task_id)
            assert in_flight.get('status') == 'remote'
            if before_store:
                # A second client changes the copy that the interrupted write skipped.
                server.set_flags('Junk', [neighbor], remove=[seen])
            if not disconnect:
                proc.proc.kill()
                proc.proc.wait(5)
                proc.stop()
        finally:
            release.set()

        if disconnect:
            proc.wait_for_log(r'--sleeping', timeout=15, since=since)
            assert receipt(task_id).get('status') == 'remote'
            proc.wake()
        else:
            if args.remove_copy:
                removed = neighbor if args.remove_copy == 'neighbor' else target
                server.expunge('Junk', [removed])
                assert removed not in server.truth()['Junk']
            if args.store_fault in ('expunge', 'partial-expunge'):
                server.at('before_command', lambda _: server.expunge('Junk', [target]),
                          command=r'UID STORE ', mailbox='Junk')
            elif args.store_fault == 'ignore':
                store_flags = server.store.store_flags

                def ignore_store(mailbox, uids, op, flags, *rest, **kwargs):
                    if mailbox == 'Junk' and target in uids and op == 'add' and seen in flags:
                        return []
                    return store_flags(mailbox, uids, op, flags, *rest, **kwargs)

                server.store.store_flags = ignore_store
            proc = MailsyncProcess(account, args.output.resolve(), binary=args.mailsync.resolve())
            proc.start()

        finished = finish(task_id)
        copies = finished['unreadPlacements'].get(message_id, [])
        stored = [line for _, _, direction, line in server.imap.transcript
                  if direction == 'C' and ' UID STORE ' in line.upper()]
        result = {'interruption': args.interrupt, 'removedCopy': args.remove_copy, 'storeFault': args.store_fault,
                  'target': target, 'neighbor': neighbor,
                  'inFlight': in_flight, 'completed': finished, 'unread': sorted(unread_uids()),
                  'wireStores': stored}
        result_path.write_text(json.dumps(result, indent=2) + '\n')
        if args.store_fault:
            expected_error = {'expunge': 'flag-source-unavailable', 'ignore': 'flag-write-unconfirmed',
                              'partial-expunge': 'flag-write-partial'}[args.store_fault]
            assert finished.get('error', {}).get('key') == expected_error, finished
            assert 'unreadAttempt' not in finished
            assert [copy['uid'] for copy in copies] == ([neighbor] if partial else []), copies
            assert len(stored) == 2, stored
            expected = {neighbor: not partial}
            if args.store_fault == 'ignore':
                expected[target] = True
            proc.wake()
            proc.wait_for(lambda: local_state() == (expected, 0), 15, 'post-STORE flags reconcile')
            assert unread_uids() == {uid for uid, unread in expected.items() if unread}
            if partial:
                undo = finish(proc.queue_task({**task, 'unread': True, 'restoreUnreadPlacements': finished['unreadPlacements']}))
                assert not undo.get('error') and unread_uids() == {neighbor}
                assert local_state() == ({neighbor: True}, 0)
            assert server.truth()['Archive'] == archive_before and not server.sent_messages()
            result.update(partialUndoVerified=partial, archiveUnchanged=True)
            result_path.write_text(json.dumps(result, indent=2) + '\n')
            print('PASS STORE is acknowledged only for flags verified on the surviving write targets')
            return
        if args.remove_copy == 'target':
            assert finished.get('error', {}).get('key') == 'flag-source-unavailable', finished
            assert not finished['unreadPlacements'] and 'unreadAttempt' not in finished
            assert len(stored) == 1 and set(server.truth()['Junk']) == {neighbor}
            proc.wake()
            proc.wait_for(lambda: local_state() == ({neighbor: False}, 0), 15, 'missing target syncs')
            assert server.truth()['Archive'] == archive_before
            print('PASS an unavailable write target reports failure and leaves the other copies alone')
            return
        assert not finished.get('error'), finished
        assert [copy['uid'] for copy in copies] == [target], 'only the interrupted write must remain undoable'
        assert in_flight.get('unreadAttempt', {}).get(message_id) == copies
        assert 'unreadAttempt' not in finished
        expected = {target: False}
        if args.remove_copy != 'neighbor':
            expected[neighbor] = before_store
        proc.wake()
        proc.wait_for(lambda: local_state() == (expected, 0), 15, 'unrelated flags and copies reconcile through sync')
        assert unread_uids() == {uid for uid, unread in expected.items() if unread}
        assert len(stored) == (2 if before_store else 1), stored
        undone = finish(proc.queue_task({**task, 'unread': True, 'restoreUnreadPlacements': finished['unreadPlacements']}))
        assert not undone.get('error'), undone
        expected[target] = True
        assert local_state() == (expected, 0)
        assert unread_uids() == {uid for uid, unread in expected.items() if unread}
        assert server.truth()['Archive'] == archive_before and not server.sent_messages()
        result.update(undone=True, archiveUnchanged=True, smtpSubmissions=0)
        result_path.write_text(json.dumps(result, indent=2) + '\n')
        print('PASS persisted Junk write, resumed receipt, exact undo and unchanged Archive copy')
    finally:
        proc.stop()
        server.stop()


if __name__ == '__main__':
    main()
