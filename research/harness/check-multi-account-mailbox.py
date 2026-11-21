"""Real desktop/CLI/native engine with Gmail-style and ordinary IMAP accounts, loopback only."""
import argparse
import json
import os
from pathlib import Path
import signal
import sqlite3
import subprocess
import sys
import tempfile
from threading import Event
import time

p=argparse.ArgumentParser()
p.add_argument('--upstream',type=Path,required=True)
p.add_argument('--output',type=Path,required=True)
a=p.parse_args();upstream=a.upstream.resolve()
sys.path.insert(0,str(upstream/'mailsync/test'))
from harness.servers.fake import FakeServer
from harness.mailsync import account_json
from harness.mailgen import message
from fakeimap.personalities import personality
work=Path(tempfile.mkdtemp(prefix='multi-mailbox-',dir=upstream.parent))
archive_phase=os.environ.get('PAPER_REED_ARCHIVE_PAGE_CHECK', '')
spam_phase=os.environ.get('PAPER_REED_SPAM_PAGE_CHECK', '')
trash_phase=os.environ.get('PAPER_REED_TRASH_PAGE_CHECK', '')
ordinary = personality('dovecot').without('MOVE') if archive_phase.startswith('copy') else 'dovecot'
servers=[FakeServer('gmail',smtp=True,email='account0@example.test'),FakeServer(ordinary,smtp=True,email='account1@example.test')]
run=None
readonly_label_writes=[]
set_gmail_labels=servers[0].store.set_labels
archive_blocker_started = Event()
archive_blocker_release = Event()

def track_labels(mailbox,uids,op,labels,origin=None):
    if set(labels) & {'\\Sent','\\Draft','\\Drafts'}:
        readonly_label_writes.append(list(labels))
    return set_gmail_labels(mailbox,uids,op,labels,origin=origin)

servers[0].store.set_labels=track_labels

def arm_copy_fault(server, fault):
    if fault == 'expunge':
        server.append('INBOX', message(81, subject='Unrelated marked mail',
                      message_id='<archive-other-deleted@example.test>'), flags=['\\Deleted', '\\Seen'])
        def reject_targeted(session, command, _args):
            if command != 'UID EXPUNGE' or session.selected != 'INBOX':
                return False
            session.reject_next = (None, 'Fixture rejects targeted expunge')
        server.imap.add_hook('before_command', reject_targeted, once=True)
    elif fault in ('epoch', 'epoch-commit'):
        def replace_after_copy(session, command, _args):
            expected = 'UID EXPUNGE' if fault == 'epoch-commit' else 'UID COPY'
            if command != expected or session.selected != 'INBOX':
                return False
            folder = server.store.get('Archive')
            with server.store.lock:
                copied_uid = folder.messages[-1].uid
                server.store.expunge('Archive', [copied_uid])
                server.store.set_uidvalidity('Archive', folder.uidvalidity + 1)
                server.store.set_uidnext('Archive', copied_uid)
                server.append('Archive', message(82, subject='Replacement generation',
                              message_id='<archive-new-epoch@example.test>'), flags=['\\Flagged'])
        server.imap.add_hook('after_command', replace_after_copy, once=True)

def arm_archive_rebuild(server):
    def rebuild_before_restore(session, command, args):
        selected_archive = command == 'SELECT' and args.split(None, 1)[0].strip(b'"') == b'Archive'
        restoring = command in ('UID MOVE', 'UID COPY') and session.selected == 'Archive'
        if not restoring and not (selected_archive and
                any(previous in session.commands for previous in ('UID MOVE', 'UID COPY'))):
            return False
        with server.store.lock:
            folder = server.store.get('Archive')
            previous, = folder.messages
            server.store.expunge('Archive', [previous.uid])
            server.store.set_uidvalidity('Archive', folder.uidvalidity + 1)
            server.store.set_uidnext('Archive', previous.uid)
            replacement = server.store.append('Archive', message(83, subject='Replacement archive copy',
                message_id='<archive-source-replacement@example.test>'), flags=['\\Flagged'])
            assert replacement.uid == previous.uid
    server.imap.add_hook('before_command', rebuild_before_restore, once=True)

try:
    accounts=[]
    for i,server in enumerate(servers):
        inbox_flags = [] if spam_phase == 'review-search-reader' and i == 1 else ['\\Seen']
        server.append('INBOX', message(1, subject='Shared subject', message_id='<same-message@example.test>'),
                      flags=inbox_flags)
        if i==0:
            server.create_mailbox('Projects')
            server.store.set_labels('[Gmail]/All Mail',[1],'add',['Projects'])
            archived = message(2,subject='Archived sibling',in_reply_to='<same-message@example.test>',references=['<same-message@example.test>'])
            if os.environ.get('PAPER_REED_ARCHIVE_PAGE_CHECK'):
                server.append('[Gmail]/All Mail', archived)
            else:
                server.store.append('[Gmail]/All Mail', archived)
        if os.environ.get('PAPER_REED_ARCHIVE_PAGE_CHECK'):
            sent_folder = '[Gmail]/Sent Mail' if i == 0 else 'Sent'
            server.append(sent_folder, message(3, subject='Re: Shared subject',
                          message_id='<sent-archive-sibling@example.test>',
                          in_reply_to='<same-message@example.test>', references=['<same-message@example.test>']))
            server.append(sent_folder, message(4, subject='Sent only',
                          message_id='<sent-only@example.test>'))
        if spam_phase:
            raw=message(5, subject='Message to review', message_id=f'<spam-review-{i}@example.test>')
            spam_flags = [] if spam_phase == 'review-reader' and i == 1 else ['\\Seen']
            spam_uid = server.append('[Gmail]/Spam' if i == 0 else 'Junk', raw, flags=spam_flags)
            if i == 1:
                server.append('Archive', raw, flags=['\\Flagged'])
                if spam_phase == 'review-partial-flags':
                    server.append('Junk', raw, flags=spam_flags)
                    server.at('before_command', lambda _, uid=spam_uid: server.expunge('Junk', [uid]),
                              command=r'UID STORE ', mailbox='Junk')
                if spam_phase == 'review-pagination':
                    for index in range(100):
                        server.append('Junk', message(20 + index, subject=f'Junk fixture {index}',
                                      message_id=f'<junk-page-{index}@example.test>'), flags=['\\Seen'])
        if trash_phase:
            raw = message(8, subject='Mail to recover', message_id=f'<trash-review-{i}@example.test>')
            folder = '[Gmail]/Trash' if i == 0 else 'Trash'
            flags = [] if trash_phase == 'reader-unread' and i == 1 else ['\\Seen']
            uid = server.append(folder, raw, flags=flags)
            if i == 0:
                server.store.set_labels(folder, [uid], 'add', ['Projects'])
            else:
                server.append('Archive', raw, flags=['\\Flagged'])
                if trash_phase == 'pagination':
                    for index in range(100):
                        server.append(folder, message(40 + index, subject=f'Trash fixture {index}',
                                      message_id=f'<trash-page-{index}@example.test>'), flags=['\\Seen'])
        server.start()
        accounts.append(account_json(**server.account_kwargs(),account_id=f'c-mixed-{i}'))
    (work/'accounts.json').write_text(json.dumps(accounts))
    a.output.mkdir(parents=True,exist_ok=True)
    run=subprocess.Popen(['node',str(Path(__file__).with_suffix('.cjs')),str(upstream),str(work),str(a.output.resolve())],start_new_session=True)
    deadline=time.monotonic()+360
    while run.poll() is None:
        request=work/'truth-request.json'
        if request.exists():
            check=json.loads(request.read_text());request.unlink()
            server=servers[check['account']]
            if 'password' in check:
                server.imap.credentials=(server.username,check['password'])
                (work/'truth-result.json').write_text(json.dumps({'ok':True}))
                continue
            if 'append' in check:
                item=check['append']
                raw=message(item['number'],subject='Re: Shared subject',
                            message_id='<'+item['id']+'>',
                            in_reply_to='<same-message@example.test>',references=['<same-message@example.test>'])
                server.store.append(item['folder'],raw)
                (work/'truth-result.json').write_text(json.dumps({'ok':True}))
                continue
            if check.get('markSent'):
                box=server.store.get('[Gmail]/All Mail')
                for item in box.messages:
                    if item.message_id.strip('<>')=='same-message@example.test':
                        set_gmail_labels('[Gmail]/All Mail',[item.uid],'add',['\\Sent'])
                (work/'truth-result.json').write_text(json.dumps({'ok':True}))
                continue
            if os.environ.get('PAPER_REED_ARCHIVE_PAGE_CHECK') and check.get('addCopyFrom'):
                source = check['addCopyFrom']
                source_uid = next(uid for uid, item in server.store.truth()[source].items()
                                  if item['message_id'].strip('<>') == check['messageId'])
                server.store.duplicate(source, [source_uid], 'INBOX', flags=['\\Seen'])
            if os.environ.get('PAPER_REED_ARCHIVE_PAGE_CHECK') and check.get('setUnreadUID'):
                server.store.store_flags('INBOX', [check['setUnreadUID']], 'remove', ['\\Seen'])
            if os.environ.get('PAPER_REED_ARCHIVE_PAGE_CHECK') and check.get('rollInboxValidity'):
                server.store.set_uidvalidity('INBOX', server.store.get('INBOX').uidvalidity + 1, renumber=False)
            if archive_phase.startswith('copy-') and check.get('armCopyFault'):
                arm_copy_fault(server, check['armCopyFault'])
            if archive_phase.endswith('source-epoch') and check.get('rebuildArchive'):
                arm_archive_rebuild(server)
            if archive_phase == 'source-missing' and 'archiveBlocker' in check:
                step = check['archiveBlocker']
                if step == 'arm':
                    def hold_store(session, command, _args):
                        if command != 'UID STORE' or session.selected != 'Sent':
                            return False
                        archive_blocker_started.set()
                        if not archive_blocker_release.wait(timeout=30):
                            session.reject_next = (None, 'Timed out holding archive test task')
                    server.imap.add_hook('before_command', hold_store, once=True)
                elif step == 'reset':
                    try:
                        with sqlite3.connect(work/'config'/'edgehill.db', timeout=5) as db:
                            updated = db.execute('''
                                UPDATE MessageFolder SET remoteUID=0
                                WHERE remoteUID>0 AND pendingFolderId IS NOT NULL
                                  AND folderId IN (SELECT id FROM Folder WHERE accountId=? AND path='Archive')
                                  AND messageId IN (SELECT id FROM Message WHERE accountId=? AND headerMessageId=?)
                            ''', ('c-mixed-1', 'c-mixed-1', check['messageId']))
                            assert updated.rowcount == 1
                    finally:
                        archive_blocker_release.set()
                (work/'truth-result.json').write_text(json.dumps({'held': archive_blocker_started.is_set()}))
                continue
            found=[]
            for folder,items in server.store.truth().items():
                for uid,entry in items.items():
                    if entry['message_id'].strip('<>')==check['messageId'].strip('<>'):
                        state={'folder':folder,'labels':sorted(entry.get('labels',set()))}
                        if check.get('placements'):
                            state.update(uid=uid,flags=sorted(entry['flags']),uidValidity=server.store.get(folder).uidvalidity)
                        found.append(state)
            (work/'truth-result.json').write_text(json.dumps(found))
        if time.monotonic()>deadline:raise TimeoutError('Mixed mailbox check exceeded 360s')
        time.sleep(.1)
    assert run.returncode==0,run.returncode
    assert not readonly_label_writes,readonly_label_writes
    assert all(not s.sent_messages() for s in servers),'This test does not send mail'
    print('PASS mixed-account server state; no SMTP submissions')
finally:
    archive_blocker_release.set()
    if run:
        try:os.killpg(run.pid,signal.SIGKILL)
        except ProcessLookupError:pass
    if archive_phase.startswith('copy'):
        commands = [line for _, _, direction, line in servers[1].imap.transcript
                    if direction == 'C' and any(command in line.upper() for command in
                        (' UID COPY ', ' UID EXPUNGE ', ' UID STORE ', ' EXPUNGE', ' STATUS '))]
        (work/'ordinary-copy-commands.log').write_text('\n'.join(commands)+'\n')
    if archive_phase.endswith('source-epoch'):
        commands = [line for _, _, direction, line in servers[1].imap.transcript
                    if direction == 'C' and any(command in line.upper() for command in
                        (' SELECT ', ' UID MOVE ', ' UID COPY ', ' UID STORE ', ' UID EXPUNGE '))]
        (work/'archive-source-commands.log').write_text('\n'.join(commands)+'\n')
    if spam_phase or trash_phase:
        for i, server in enumerate(servers):
            commands = [line for _, _, direction, line in server.imap.transcript
                        if direction == 'C' and any(op in line.upper() for op in
                            (' UID MOVE ', ' UID COPY ', ' UID STORE ', ' UID EXPUNGE '))]
            view = 'trash' if trash_phase else 'spam'
            (work/f'{view}-commands-{i}.log').write_text('\n'.join(commands)+'\n')
    for s in servers:s.stop()
    print('Artifacts:',work)
