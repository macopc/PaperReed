"""Resume an offline Archive restore with a newer native engine and the same local database."""
import argparse
from contextlib import contextmanager
import json
from pathlib import Path
import re
import socket
import sys
from threading import Event


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--upstream', type=Path, required=True)
    parser.add_argument('--queued-with', type=Path, required=True)
    parser.add_argument('--resume-with', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--sequence', choices=('single', 'different-target', 'same-target', 'undo-return',
                                               'other-copy', 'same-copy', 'other-copy-undo-redo', 'flag-after',
                                               'independent-success', 'independent-failure', 'independent-batch',
                                               'independent-copies-success', 'independent-copies-failure',
                                               'independent-copies-followup', 'independent-copies-double-failure',
                                               'independent-copies-source-epoch', 'independent-copies-next-epoch',
                                               'independent-copies-reassert-epoch', 'independent-copies-early-epoch',
                                               'independent-copies-partial-live'),
                        default='single')
    args = parser.parse_args()
    args.output.mkdir(parents=True)
    sys.path.insert(0, str(args.upstream.resolve() / 'mailsync/test'))
    from harness.mailgen import message
    from harness.mailsync import MailsyncProcess, account_json
    from harness.servers.fake import FakeServer

    @contextmanager
    def run_engine(account, binary, phase):
        proc = MailsyncProcess(account, args.output.resolve(), binary=binary)
        try:
            proc.start()
            yield proc
        finally:
            proc.stop()
            if proc.log_path.exists():
                proc.log_path.rename(args.output / f'{phase}.log')

    header = 'archive-upgrade@example.test'
    peer_header = 'archive-upgrade-peer@example.test'
    replacement_header = 'archive-upgrade-replacement@example.test'
    server = FakeServer('dovecot', smtp=True)
    server.create_mailbox('Later')
    independent = args.sequence.startswith('independent-')
    one_message_batch = args.sequence.startswith('independent-copies-')
    live_partial = args.sequence == 'independent-copies-partial-live'
    rebuild_first = args.sequence == 'independent-copies-early-epoch'
    followup = args.sequence in ('independent-copies-followup', 'independent-copies-double-failure',
                                 'independent-copies-next-epoch')
    reassert = args.sequence == 'independent-copies-reassert-epoch'
    rebuild = {'independent-copies-source-epoch': 'Archive', 'independent-copies-next-epoch': 'Work',
               'independent-copies-reassert-epoch': 'Archive'}.get(args.sequence)
    if independent:
        for name in ('Other', 'Work'):
            server.create_mailbox(name)
    raw = message(1, subject='Archive upgrade', message_id=f'<{header}>')
    server.append('Archive', raw, flags=['\\Flagged'])
    if live_partial:
        server.append('Archive', raw, flags=['\\Seen'])
    if independent or args.sequence in ('other-copy', 'same-copy', 'other-copy-undo-redo'):
        server.append('Later', raw, flags=['\\Seen'])
    server.append('INBOX', message(2, subject='Unrelated inbox copy', message_id=f'<{peer_header}>'),
                  flags=['\\Seen'])
    server.start()
    try:
        account = account_json(**server.account_kwargs(), account_id='c-archive-upgrade')
        with run_engine(account, args.queued_with, 'initial') as proc:
            proc.wait_quiescent(timeout=30, settle=1)
            with proc.db() as db:
                mail = db.execute('SELECT id, threadId FROM Message WHERE headerMessageId=?',
                                  (header,)).fetchone()
                assert mail is not None, 'old engine did not sync the archived mail'
                peer_id = db.execute('SELECT id FROM Message WHERE headerMessageId=?',
                                     (peer_header,)).fetchone()['id']
                folders = {
                    row['path']: json.loads(row['data'])
                    for row in db.execute("SELECT path, data FROM Folder")
                }
        message_id, thread_id = mail['id'], mail['threadId']
        sequence = [('Archive', 'INBOX')]
        selected_copy = {'other-copy': 'Later', 'same-copy': 'Archive',
                         'other-copy-undo-redo': 'Later'}.get(args.sequence)
        if selected_copy:
            sequence.append((selected_copy, 'INBOX'))
        elif args.sequence != 'single':
            sequence.append(('INBOX', 'Later'))
        if args.sequence in ('same-target', 'undo-return', 'flag-after'):
            sequence.append(('Later', 'INBOX'))
        if args.sequence == 'other-copy-undo-redo':
            sequence.extend((('INBOX', 'Later'), ('Later', 'INBOX')))
        expected_paths = [sequence[-1][1]] if len(sequence) > 1 else ['Archive']
        if selected_copy:
            expected_paths.append('Archive' if selected_copy == 'Later' else 'Later')
        exact_index = 0
        undo_task = (2, 1) if args.sequence in ('undo-return', 'other-copy-undo-redo') else None
        expected_moves = sequence[1:]
        expected_errors = ['exact-move-source-unavailable'] + [None] * (len(sequence) - 1)
        if args.sequence == 'flag-after':
            expected_errors.append(None)
        if independent:
            sequence = [('Later', 'Other'), ('Archive', 'INBOX'), ('INBOX', 'Work'),
                        ('Work', 'INBOX'), ('Other', 'Later')]
            expected_paths = ['INBOX', 'Later']
            exact_index, undo_task = 1, (4, 0)
            expected_moves = [('Later', 'Other'), ('Archive', 'Work'), ('Work', 'INBOX')]
            expected_errors = [None, 'exact-move-source-unavailable', None, None, None]
            if args.sequence in ('independent-failure', 'independent-batch'):
                expected_errors[0] = 'ErrorCopy'
                expected_errors[-1] = 'move-source-history-unavailable'
            else:
                expected_moves.append(('Other', 'Later'))
            if args.sequence == 'independent-batch':
                expected_moves.insert(0, ('INBOX', 'Other'))
                expected_moves.append(('Other', 'INBOX'))
        if one_message_batch:
            sequence = [('Later', 'Other'), ('Archive', 'INBOX'), ('INBOX', 'Work')]
            if reassert:
                sequence[-1] = ('Archive', 'INBOX')
            exact_index, undo_task = 1, None
            if args.sequence != 'independent-copies-success':
                expected_paths = ['Work', 'Later']
                expected_moves = [('Later', 'Other'), ('Archive', 'Work')]
                expected_errors = ['ErrorCopy', 'exact-move-source-unavailable', 'move-source-history-unavailable']
            else:
                expected_paths = ['Work', 'Work']
                expected_moves = [('Later', 'Other'), ('Other', 'Work'), ('Archive', 'Work')]
                expected_errors = [None, 'exact-move-source-unavailable', None]
            if followup:
                sequence.append(('Work', 'INBOX'))
                expected_paths = ['INBOX', 'Later']
                expected_moves.append(('Work', 'INBOX'))
                expected_errors.append('move-source-history-unavailable')
            if args.sequence == 'independent-copies-double-failure':
                expected_paths = ['Archive', 'Later']
                expected_moves.pop()
                expected_errors[2] = 'ErrorCopy'
            if rebuild:
                expected_paths = ['Later']
                expected_moves.pop()
                expected_errors[-1] = 'exact-move-source-unavailable'
            if rebuild_first:
                expected_paths = ['Archive', 'Later']
                expected_moves.pop()
        initial_paths = ['Archive', 'Later'] if selected_copy or independent else ['Archive']
        archive = folders['Archive']['id']

        def receipt(proc, task_id):
            with proc.db() as db:
                row = db.execute('SELECT data FROM Task WHERE id=?', (task_id,)).fetchone()
            return json.loads(row['data']) if row else {}

        def placements(proc):
            with proc.db() as db:
                return [dict(row) for row in db.execute(
                    'SELECT folderId, remoteUID, pendingFolderId FROM MessageFolder WHERE messageId=?',
                    (message_id,))]

        if live_partial:
            blocked = Event()
            release = Event()
            restore_attempts = 0
            move_sources = []

            def track_moves(session, command, arguments):
                nonlocal restore_attempts
                if command == 'UID MOVE':
                    move_sources.append(session.selected)
                    if session.selected == 'Archive' and arguments.split()[-1].strip(b'"') == b'INBOX':
                        restore_attempts += 1
                        if restore_attempts == 2:
                            blocked.set()
                            if release.wait(20):
                                session.reject_next = (None, 'Fixture denies the second restore')

            server.imap.add_hook('before_command', track_moves)
            transcript_start = len(server.imap.transcript)
            with run_engine(account, args.resume_with, 'resumed') as proc:
                proc.wait_quiescent(timeout=30, settle=1)
                restore = proc.queue_task({'__cls': 'ChangeFolderTask', 'messageIds': [message_id],
                                           'sourceFolderIds': [archive], 'folder': folders['INBOX'],
                                           'exactPlacementUndo': True})
                try:
                    assert blocked.wait(15), 'the first Archive copy must have moved before the second is refused'
                    assert [copy['message_id'] for copy in server.truth()['INBOX'].values()].count(header) == 1
                    onward = proc.queue_task({'__cls': 'ChangeFolderTask', 'messageIds': [message_id],
                                              'sourceFolderIds': [folders['INBOX']['id']], 'folder': folders['Work']})
                    proc.wait_for(lambda: receipt(proc, onward).get('status') == 'remote', 10, 'queue before restore commit')
                    assert [entry['folderId'] for entry in receipt(proc, onward)['undoPlacements'][message_id]] == [folders['INBOX']['id']] * 2
                finally:
                    release.set()
                task_ids = (restore, onward)
                proc.wait_for(lambda: all(receipt(proc, task_id).get('status') == 'complete' for task_id in task_ids),
                              25, 'partial restore and follow-up settle')
                completed = [receipt(proc, task_id) for task_id in task_ids]
                proc.wake()
                proc.wait_quiescent(timeout=30, settle=1)
                rows = placements(proc)
                with proc.db() as db:
                    snapshot = json.loads(db.execute('SELECT data FROM Message WHERE id=?', (message_id,)).fetchone()['data'])
            truth = server.truth()
            copies = [(folder, copy['flags']) for folder, contents in truth.items() for copy in contents.values()
                      if copy['message_id'] == header]
            writes = [line for _, _, direction, line in server.imap.transcript[transcript_start:]
                      if direction == 'C' and ' UID MOVE ' in line]
            result = {'taskErrors': [(task.get('error') or {}).get('key') for task in completed],
                      'serverFolders': sorted(folder for folder, _ in copies), 'finalPlacements': rows,
                      'reportedFolders': sorted(path for path, folder in folders.items() if folder['id'] in snapshot['folders']),
                      'moveCommands': writes, 'moveSources': move_sources, 'smtpSubmissions': len(server.sent_messages())}
            (args.output / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
            assert result['serverFolders'] == ['Later', 'Work', 'Work'], result
            assert result['reportedFolders'] == ['Later', 'Work'], result
            assert result['taskErrors'] == ['ErrorCopy', None], result
            assert move_sources[:2] == ['Archive', 'Archive'] and sorted(move_sources[2:]) == ['Archive', 'INBOX'], result
            assert all(re.search(r' UID MOVE \d+ Work$', line) for line in writes[2:]), result
            assert {frozenset(flags) & {'\\Seen', '\\Flagged'} for folder, flags in copies if folder == 'Work'} == {
                frozenset({'\\Seen'}), frozenset({'\\Flagged'})}, copies
            assert all(row['pendingFolderId'] is None for row in rows), result
            assert result['smtpSubmissions'] == 0, result
            print('PASS partial restore: a concurrent follow-up uses confirmed Inbox and surviving Archive copies')
            return

        # A reserved but non-listening port keeps the old engine offline while its local
        # task queue and optimistic placement update run through the normal IPC entry.
        with socket.socket() as disconnected:
            disconnected.bind(('127.0.0.1', 0))
            offline = {**account, 'settings': {
                **account['settings'], 'imap_port': disconnected.getsockname()[1],
            }}
            queued = []
            with run_engine(offline, args.queued_with, 'offline') as proc:
                for index, (from_path, to_path) in enumerate(sequence):
                    source, dest = folders[from_path]['id'], folders[to_path]['id']
                    task = {
                        '__cls': 'ChangeFolderTask',
                        'messageIds': [message_id],
                        'sourceFolderIds': [source],
                        'folder': folders[to_path],
                        **({'exactPlacementUndo': True} if index == exact_index else {}),
                    }
                    if args.sequence == 'independent-batch' and index in (0, 4):
                        task['messageIds'].append(peer_id)
                        if index == 0:
                            task['sourceFolderIds'].append(folders['INBOX']['id'])
                    if one_message_batch and index == 2 and not reassert:
                        task['sourceFolderIds'].append(folders['Other']['id'])
                    if undo_task and index == undo_task[0]:
                        task['restorePlacements'] = queued[undo_task[1]]['receipt']['undoPlacements']
                    task_id = proc.queue_task(task)
                    proc.wait_for(lambda: receipt(proc, task_id).get('status') == 'remote', 15, 'offline move admission')
                    move = receipt(proc, task_id)
                    assert 'exactMoveSources' not in move, 'the queued binary is expected to predate source snapshots'
                    recorded = [entry['folderId'] for entry in move['undoPlacements'].get(message_id, [])]
                    # A same-copy follow-up already appears in its destination due to
                    # the earlier marker, so that ordinary task has no folder change to record.
                    if reassert and index == 2:
                        assert recorded == [], move
                    elif one_message_batch and index == 2:
                        assert sorted(recorded) == sorted([source, folders['Other']['id']]), move
                    elif followup and index == 3:
                        assert recorded == [source, source], move
                    else:
                        assert recorded == ([] if args.sequence == 'same-copy' and index == 1 else [source]), move
                    rows = placements(proc)
                    assert sorted(row['folderId'] for row in rows) == sorted(
                        folders[where]['id'] for where in initial_paths), rows
                    marked_folder = folders[selected_copy]['id'] if selected_copy and index > 0 else archive
                    if independent and index in (0, 4):
                        marked_folder = folders['Later']['id']
                    assert any(row['folderId'] == marked_folder and row['pendingFolderId'] == dest
                               for row in rows), 'offline move did not mark the intended copy'
                    queued.append({'receipt': move, 'placements': rows})
                if args.sequence == 'flag-after':
                    flag_task_id = proc.queue_task({
                        '__cls': 'ChangeUnreadTask', 'messageIds': [message_id], 'unread': False,
                    })
                    proc.wait_for(lambda: receipt(proc, flag_task_id).get('status') == 'remote',
                                  15, 'offline read flag admission')
                    queued.append({'receipt': receipt(proc, flag_task_id), 'placements': placements(proc)})
        (args.output / 'queued-tasks.json').write_text(json.dumps(queued, indent=2) + '\n')
        task_ids = [entry['receipt']['id'] for entry in queued]

        before = server.truth()
        transcript_start = len(server.imap.transcript)
        move_sources = []

        def record_move_source(session, command, _args):
            if command == 'UID MOVE':
                move_sources.append(session.selected)

        server.imap.add_hook('before_command', record_move_source)
        failed_first_move = args.sequence in ('independent-failure', 'independent-batch') or (
            one_message_batch and args.sequence != 'independent-copies-success')
        if failed_first_move and args.sequence != 'independent-batch' and not rebuild_first:
            server.at('before_command', lambda _: server.delete_mailbox('Other'),
                      command=r'UID MOVE .*Other', mailbox='Later')
        if args.sequence == 'independent-batch':
            server.at('before_command', lambda session: setattr(session, 'reject_next', (None, 'Fixture denies one source')),
                      command=r'UID MOVE .*Other', mailbox='Later')
        if args.sequence == 'independent-copies-double-failure':
            server.at('before_command', lambda _: server.delete_mailbox('Work'),
                      command=r'UID MOVE .*Work', mailbox='Archive')
        rebuild_waiting = Event()
        rebuild_release = Event()
        new_generation = None
        rebuilt_copy = None
        if rebuild_first:
            def rebuild_before_replay(_):
                nonlocal new_generation, rebuilt_copy
                server.delete_mailbox('Other')
                mailbox = server.store.get('Archive')
                new_generation = mailbox.uidvalidity + 1
                server.delete_mailbox('Archive')
                server.create_mailbox('Archive')
                server.set_uidvalidity('Archive', new_generation)
                server.set_uidnext('Archive', 20)
                uid = server.append('Archive', raw, flags=['\\Flagged'])
                assert uid == 20
                rebuilt_copy = server.truth()['Archive'][uid]
                rebuild_waiting.set()
                rebuild_release.wait(25)

            server.at('before_command', rebuild_before_replay, command=r'UID MOVE .*Other', mailbox='Later')
        replacement_uid = None
        replacement_before = None
        if rebuild:
            def rebuild_source(session, command, arguments):
                nonlocal replacement_uid, replacement_before
                if command != 'SELECT' or arguments.split(None, 1)[0].strip(b'"') != rebuild.encode():
                    return False
                if session.commands.count('UID MOVE') < (2 if followup else 1):
                    return False
                mailbox = server.store.get(rebuild)
                generation = mailbox.uidvalidity
                [old_uid] = server.truth()[rebuild]
                server.delete_mailbox(rebuild)
                server.create_mailbox(rebuild)
                server.set_uidvalidity(rebuild, generation + 1)
                replacement_uid = server.append(rebuild, message(3, subject='New mailbox generation',
                                                                 message_id=f'<{replacement_header}>'), flags=['\\Seen'])
                assert replacement_uid == old_uid
                replacement_before = server.truth()[rebuild][replacement_uid]
                return True

            server.imap.add_hook('before_command', rebuild_source, once=True)
        with run_engine(account, args.resume_with, 'resumed') as proc:
            if rebuild_first:
                try:
                    assert rebuild_waiting.wait(15), 'foreground pause before replay'
                    proc.wake()
                    proc.wait_for(lambda: proc.db_folders()['Archive']['localStatus'].get('uidvalidity') == new_generation and
                                  any(row['folderId'] == archive and row['remoteUID'] == 20 for row in placements(proc)),
                                  20, 'background has committed the new generation of the same message before rollback')
                finally:
                    rebuild_release.set()
            proc.wait_for(lambda: all(receipt(proc, task_id).get('status') == 'complete' for task_id in task_ids),
                          25, 'all queued moves settle after upgrade')
            completed = [receipt(proc, task_id) for task_id in task_ids]
            proc.wake()
            proc.wait_quiescent(timeout=30, settle=1)
            with proc.db() as db:
                # The ordinary IMAP membership predicate used by the Archive list.
                visible = db.execute("""
                    SELECT EXISTS (
                        SELECT 1 FROM Thread t
                        JOIN Message m INDEXED BY MessageListThreadIndex
                          ON m.accountId=t.accountId AND m.threadId=t.id
                        WHERE t.id=? AND m.draft=0
                          AND NOT EXISTS (SELECT 1 FROM MessageOrphan WHERE messageId=m.id)
                          AND EXISTS (SELECT 1 FROM json_each(m.data, '$.folders') WHERE key=?)
                    )
                """, (thread_id, archive)).fetchone()[0]
                reported_folders = [row['key'] for row in db.execute("""
                    SELECT entry.key FROM Message m, json_each(m.data, '$.folders') entry WHERE m.id=?
                """, (message_id,))]
            final_placements = placements(proc)
            with proc.db() as db:
                peer_placements = [dict(row) for row in db.execute(
                    'SELECT folderId, remoteUID, pendingFolderId FROM MessageFolder WHERE messageId=?',
                    (peer_id,))]
        commands = [line for _, _, direction, line in server.imap.transcript[transcript_start:]
                    if direction == 'C' and re.search(r'\b(?:UID (?:MOVE|COPY|STORE|EXPUNGE)|EXPUNGE)\b', line)]
        after = server.truth()
        physical_paths = [folder for folder, copies in after.items() for copy in copies.values()
                          if copy['message_id'] == header]
        result = {
            'sequence': args.sequence,
            'taskErrors': [(task.get('error') or {}).get('key') for task in completed],
            'finalPlacements': final_placements,
            'visibleInArchive': bool(visible),
            'reportedFolders': sorted(path for path, folder in folders.items() if folder['id'] in reported_folders),
            'serverFolders': physical_paths,
            'serverUnchanged': after == before,
            'imapWritesAfterUpgrade': commands,
            'imapMoveSources': move_sources,
            'peerPlacements': peer_placements,
            'peerServerFolders': [folder for folder, copies in after.items() for copy in copies.values()
                                  if copy['message_id'] == peer_header],
            'replacementServerFolders': [folder for folder, copies in after.items() for copy in copies.values()
                                         if copy['message_id'] == replacement_header],
            'smtpSubmissions': len(server.sent_messages()),
        }
        (args.output / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
        assert result['smtpSubmissions'] == 0, result
        if rebuild_first:
            assert after['Archive'] == {20: rebuilt_copy}, result
        if rebuild:
            assert result['replacementServerFolders'] == [rebuild], result
            assert after[rebuild][replacement_uid] == replacement_before, result
        move_commands = commands
        if args.sequence == 'flag-after':
            assert commands and ' UID STORE ' in commands[-1], commands
            move_commands = commands[:-1]
        assert len(move_commands) == len(expected_moves), 'the expected independent moves must be attempted'
        for command, (_, to_path) in zip(move_commands, expected_moves):
            assert re.search(rf' UID MOVE \d+ "?{re.escape(to_path)}"?$', command), command
        assert result['taskErrors'] == expected_errors, result
        assert sorted(physical_paths) == sorted(expected_paths), result
        if args.sequence == 'flag-after':
            [moved_copy] = [copy for copy in after['INBOX'].values() if copy['message_id'] == header]
            assert '\\Seen' in moved_copy['flags'], moved_copy
        assert sorted(row['folderId'] for row in final_placements) == sorted(
            folders[where]['id'] for where in expected_paths), result
        assert all(row['pendingFolderId'] is None for row in final_placements), result
        assert result['reportedFolders'] == sorted(set(expected_paths)), result
        assert bool(visible) == ('Archive' in expected_paths), result
        if selected_copy:
            unselected = 'Archive' if selected_copy == 'Later' else 'Later'
            assert move_sources == [source for source, _ in sequence[1:]], result
            assert after[unselected] == before[unselected], 'the unrelated copy must keep its UID and flags'
        if independent:
            assert move_sources == [source for source, _ in expected_moves], result
        if failed_first_move:
            assert after['Later'] == before['Later'], 'the failed copy must keep its original UID and flags'
        if args.sequence == 'independent-copies-double-failure':
            assert after['Archive'] == before['Archive'], result
        if args.sequence == 'independent-batch':
            assert result['peerServerFolders'] == ['INBOX'], result
            assert [p['folderId'] for p in peer_placements] == [folders['INBOX']['id']], result
            assert all(p['pendingFolderId'] is None for p in peer_placements), result
        if args.sequence == 'single':
            assert result['serverUnchanged'], result
        print(f'PASS {args.sequence}: legacy restore reports failure, later moves settle in queue order')
    finally:
        server.stop()


if __name__ == '__main__':
    main()
