"""Verify that queued Junk flag changes and their receipts follow IMAP execution order."""
import argparse
import json
from pathlib import Path
import sys
from threading import Event


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--upstream', type=Path, required=True)
    parser.add_argument('--mailsync', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--first-unread', action='store_true')
    args = parser.parse_args()
    args.output.mkdir(parents=True)
    sys.path.insert(0, str(args.upstream.resolve() / 'mailsync/test'))
    from harness.mailgen import message
    from harness.mailsync import MailsyncProcess, account_json
    from harness.servers.fake import FakeServer

    header = 'spam-unread-queue@example.test'
    seen = r'\Seen'
    server = FakeServer('dovecot', smtp=True)
    raw = message(1, subject='Queued Junk flags', message_id=f'<{header}>')
    first_uid = server.append('Junk', raw, [seen] if args.first_unread else [])
    second_uid = server.append('Junk', raw, [] if args.first_unread else [seen])
    initial = {first_uid: not args.first_unread, second_uid: args.first_unread}
    server.append('Archive', raw, [r'\Flagged', seen])
    archive_before = server.truth()['Archive']
    server.start()
    account = account_json(**server.account_kwargs(), account_id='c-spam-unread-queue')
    proc = MailsyncProcess(account, args.output.resolve(), binary=args.mailsync.resolve())
    entered = Event()
    release = Event()

    def receipt(task_id):
        with proc.db() as db:
            row = db.execute('SELECT data FROM Task WHERE id = ?', (task_id,)).fetchone()
        return json.loads(row['data']) if row else {}

    def finish(task_id):
        proc.wait_for(lambda: receipt(task_id).get('status') == 'complete',
                      20, 'the scoped flag task completes')
        result = receipt(task_id)
        assert not result.get('error'), result
        return result

    def server_flags():
        return {uid: seen not in copy['flags'] for uid, copy in server.truth()['Junk'].items()}

    def pause_store(_):
        entered.set()
        release.wait(25)

    try:
        proc.start()
        proc.wait_quiescent(timeout=30, settle=1)
        source = proc.db_folders()['Junk']['id']
        archive = proc.db_folders()['Archive']['id']
        with proc.db() as db:
            row = db.execute('SELECT id FROM Message WHERE headerMessageId = ?', (header,)).fetchone()
        assert row is not None, 'the fixture message was not synced'
        message_id = row['id']

        def local_flags(folder):
            with proc.db() as db:
                return {row['remoteUID']: bool(row['unread']) for row in db.execute(
                    'SELECT remoteUID, unread FROM MessageFolder WHERE messageId = ? AND folderId = ?',
                    (message_id, folder))}

        def enqueue(unread, restore=None):
            task = {'__cls': 'ChangeUnreadTask', 'messageIds': [message_id],
                    'sourceFolderId': source, 'unread': unread}
            if restore is not None:
                task['restoreUnreadPlacements'] = restore
            return proc.queue_task(task)

        def recorded_uids(task):
            return {copy['uid'] for copy in task['unreadPlacements'].get(message_id, [])}

        assert local_flags(source) == server_flags() == initial
        archive_local_before = local_flags(archive)
        assert archive_local_before
        server.at('before_command', pause_store, command=r'UID STORE ', mailbox='Junk')
        first = enqueue(args.first_unread)
        try:
            assert entered.wait(15), 'first STORE is held at the IMAP server'
            second = enqueue(not args.first_unread)
            proc.wait_for(lambda: receipt(second).get('status') == 'remote',
                          10, 'second task queued while the first STORE is held')
            queued_second = receipt(second)
            assert local_flags(source) == server_flags() == initial
        finally:
            release.set()

        completed_first, completed_second = finish(first), finish(second)
        first_change = {uid for uid, unread in initial.items() if unread != args.first_unread}
        expected = dict.fromkeys(initial, not args.first_unread)
        actual = server_flags()
        result = {'queuedSecond': queued_second, 'completed': [completed_first, completed_second],
                  'expected': expected, 'server': actual, 'local': local_flags(source),
                  'archiveUnchanged': server.truth()['Archive'] == archive_before}
        result_path = args.output / 'result.json'
        result_path.write_text(json.dumps(result, indent=2) + '\n')
        assert local_flags(source) == actual == expected, 'the second queued intent must win on every Junk copy'
        assert recorded_uids(completed_first) == first_change
        assert recorded_uids(completed_second) == set(initial)
        assert recorded_uids(queued_second) == set(initial)

        no_change = finish(enqueue(not args.first_unread))
        assert not no_change['unreadPlacements'], 'a no-op must not offer an undo'
        finish(enqueue(args.first_unread, completed_second['unreadPlacements']))
        assert local_flags(source) == server_flags() == dict.fromkeys(initial, args.first_unread)
        finish(enqueue(not args.first_unread, completed_first['unreadPlacements']))
        assert local_flags(source) == server_flags() == initial, 'undo must leave already-matching copies alone'
        assert local_flags(archive) == archive_local_before and server.truth()['Archive'] == archive_before
        result.update(noOpHasNoUndo=True, undoRestored=server_flags(), archiveUnchanged=True)
        result_path.write_text(json.dumps(result, indent=2) + '\n')
        print('PASS queued scoped flags, exact undo subset, no-op receipt and unchanged Archive copy')
    finally:
        proc.stop()
        server.stop()


if __name__ == '__main__':
    main()
