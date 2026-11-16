"""Characterize pinned upstream gaps with a real mailsync and local protocol fixtures.

These checks intentionally reproduce missing Paper Reed guarantees. Passing does not
mean the product contract passes. No real mailbox or external SMTP server is used.
"""
import argparse
import copy
import hashlib
import json
from pathlib import Path
import sqlite3
import shutil
import sys
import tempfile
import threading
from contextlib import closing, contextmanager

parser = argparse.ArgumentParser()
parser.add_argument('--upstream', type=Path, required=True)
parser.add_argument('--binary', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
parser.add_argument('--expect-fixed', action='store_true', help='Assert product guarantees against a source-built patched engine.')
parser.add_argument('--case', choices=['all', 'stale-draft', 'duplicate-send', 'before-data', 'after-data', 'accepted-before-copy', 'copy-failure'], default='all')
args = parser.parse_args()
if args.case in ('accepted-before-copy', 'copy-failure') and not args.expect_fixed:
    parser.error('Sent-copy boundary cases require --expect-fixed')
args.upstream = args.upstream.resolve()
args.binary = args.binary.resolve()
binary_hash = hashlib.sha256(args.binary.read_bytes()).hexdigest()
if not args.expect_fixed:
    assert binary_hash == 'cbc1b2ac4cd21f98df7c14759d2145bc17888a83ecab5ff0c3005ddac4776448', 'Use the recorded upstream binary for characterization.'
sys.path.insert(0, str(args.upstream / 'mailsync/test'))
from harness.mailsync import MailsyncProcess, account_json
from harness.servers.fake import FakeServer
from harness.mailgen import message
from fakeimap import smtp
from fakeimap import server as imap_server

args.output.mkdir(parents=True, exist_ok=True)
run_dir = Path(tempfile.mkdtemp(prefix='contracts-', dir=args.output))
results = []


class Case:
    def __init__(self, name):
        self.work = run_dir / name
        self.work.mkdir()
        self.server = FakeServer('dovecot', smtp=True, log_path=str(self.work / 'server.log'))
        self.server.append('INBOX', message(1))
        self.server.start()
        self.account = account_json(**self.server.account_kwargs())
        self.ms = None
        try:
            self.start()
        except Exception:
            self.close()
            raise

    def start(self):
        self.ms = MailsyncProcess(self.account, self.work, binary=args.binary)
        self.ms.start()
        self.ms.wait_quiescent(timeout=35)

    def close(self):
        if self.ms:
            self.ms.stop()
        self.server.stop()

    def row(self, sql, params=()):
        uri = (self.work / 'config/edgehill.db').as_uri() + '?mode=ro'
        with closing(sqlite3.connect(uri, uri=True, timeout=3)) as db:
            return db.execute(sql, params).fetchone()

    def task(self, task_id):
        row = self.row('SELECT data FROM Task WHERE id = ?', (task_id,))
        return json.loads(row[0]) if row else None

    def complete(self, task_id):
        self.ms.wait_for(lambda: (self.task(task_id) or {}).get('status') == 'complete', 35, task_id)
        return self.task(task_id)

    def draft(self, header):
        row = self.row('SELECT m.data, b.value FROM Message m JOIN MessageBody b ON b.id = m.id WHERE m.headerMessageId = ?', (header,))
        return dict(json.loads(row[0]), body=row[1]) if row else None

    def save(self, draft, task_id):
        self.ms.queue_task({'id': task_id, '__cls': 'SyncbackDraftTask', 'draft': draft})
        result = self.complete(task_id)
        assert not result.get('error'), result
        return self.draft(draft['hMsgId'])

    def send(self, draft, task_id):
        return self.ms.queue_task({'id': task_id, '__cls': 'SendDraftTask', 'draft': draft, 'perRecipientBodies': None})


@contextmanager
def case(name):
    print('RUN', name, flush=True)
    item = Case(name)
    try:
        yield item
    finally:
        item.close()


def new_draft(c, header):
    return {
        '__cls': 'Message', 'aid': c.account['id'], 'hMsgId': header, 'v': 0,
        'subject': 'Paper Reed local experiment', 'body': 'Original draft',
        'plaintext': True, 'from': [{'name': 'Test', 'email': 'test@example.test'}],
        'to': [{'email': 'recipient@example.test'}], 'cc': [], 'bcc': [],
        'replyTo': [], 'files': [], 'rthMsgId': '', 'fwdMsgId': '',
    }


def record(name, **data):
    results.append({'case': name, 'mode': 'regression' if args.expect_fixed else 'characterization',
                    'binary_sha256': binary_hash, 'observation_reproduced': not args.expect_fixed,
                    'paper_reed_contract_met': args.expect_fixed, **data})
    (run_dir / 'results.json').write_text(json.dumps(results, indent=2))
    print(json.dumps(results[-1]), flush=True)


def stale_draft():
    with case('stale-draft') as c:
        original = c.save(new_draft(c, 'stale@example.test'), 'create')
        editor = dict(copy.deepcopy(original), body='New user edit')
        agent = dict(copy.deepcopy(original), body='Agent edit based on old revision')
        latest = c.save(editor, 'user-edit')
        assert latest['body'] == editor['body']
        c.ms.queue_task({'id': 'stale-agent-edit', '__cls': 'SyncbackDraftTask', 'draft': agent})
        result = c.complete('stale-agent-edit')
        final = c.draft(agent['hMsgId'])
        if args.expect_fixed:
            assert (result.get('error') or {}).get('key') == 'draft-conflict', result
            assert final['body'] == editor['body'] and final['v'] == latest['v'], final
        else:
            assert not result.get('error'), result
            assert final['body'] == agent['body']
            assert final['v'] > latest['v'] > original['v']
        record('stale-draft', original_revision=original['v'], user_revision=latest['v'], final_revision=final['v'], stale_write_accepted=not args.expect_fixed, user_edit_replaced=not args.expect_fixed)


def duplicate_send():
    with case('duplicate-send') as c:
        draft = c.save(new_draft(c, 'duplicate@example.test'), 'save')
        # Two calls with the same cached draft, each assigned a different task id.
        for task_id in ('send-1', 'send-2'):
            c.send(copy.deepcopy(draft), task_id)
        for task_id in ('send-1', 'send-2'):
            result = c.complete(task_id)
            if args.expect_fixed and task_id == 'send-2':
                assert (result.get('error') or {}).get('key') == 'draft-frozen', result
            else:
                assert not result.get('error'), result
                if args.expect_fixed:
                    assert result.get('sendOutcome') == 'accepted', result
        received = c.server.sent_messages()
        assert len(received) == (1 if args.expect_fixed else 2), len(received)
        ids = [m.header('Message-ID') for m in received]
        assert len(set(ids)) == 1
        record('duplicate-send', distinct_task_ids=2, smtp_submissions=len(received), same_message_id=len(ids) == 2)


def interrupted_send(point):
    with case('crash-' + point) as c:
        draft = c.save(new_draft(c, point + '@example.test'), 'save')
        reached, release = threading.Event(), threading.Event()
        original_send = smtp._Handler.send
        original_handle = smtp._Handler.handle

        class EndInterruptedConnection(Exception):
            pass

        def interrupted_handle(handler):
            try:
                return original_handle(handler)
            except EndInterruptedConnection:
                # End this fixture connection without letting its DATA loop treat
                # EOF as an accepted empty message. No engine code is patched.
                return

        def held_send(handler, line):
            matching = line.startswith('354 ') if point == 'before-data' else line.startswith('250 2.0.0 Ok: queued as ')
            if matching and handler.server.owner is c.server.smtp:
                reached.set()
                if not release.wait(30):
                    raise TimeoutError('Crash probe did not release SMTP fixture')
                # The killed client never receives this response.
                raise EndInterruptedConnection()
            return original_send(handler, line)

        smtp._Handler.send = held_send
        smtp._Handler.handle = interrupted_handle
        try:
            c.send(draft, 'interrupted-send')
            assert reached.wait(30), 'SMTP checkpoint not reached'
            before = c.task('interrupted-send')
            assert before.get('_performRemoteRan') is True, before
            submissions = len(c.server.sent_messages())
            expected = 0 if point == 'before-data' else 1
            assert submissions == expected, submissions
            assert all(m.raw for m in c.server.sent_messages())
            (c.work / 'checkpoint.json').write_text(json.dumps({'task': before, 'smtp_submissions': submissions}, indent=2))
            c.ms.proc.kill()  # Actual SIGKILL, not an edited database or a simulated task.
            c.ms.proc.wait(timeout=5)
            c.ms.stop()
            shutil.copyfile(c.work / 'config' / ('mailsync-' + c.account['id'] + '.log'), c.work / 'before-restart.log')
        finally:
            release.set()
            smtp._Handler.send = original_send
            smtp._Handler.handle = original_handle
        c.start()  # Same database and protocol servers, fresh engine process.
        after = c.complete('interrupted-send')
        if args.expect_fixed:
            assert (after.get('error') or {}).get('key') == 'send-unknown', after
            assert after.get('sendOutcome') == 'unknown', after
        else:
            assert not after.get('error'), after
        assert len(c.server.sent_messages()) == expected
        record('crash-' + point, killed_with='SIGKILL', smtp_before_restart=submissions, smtp_after_restart=len(c.server.sent_messages()), restored_status=after['status'], restored_error=after.get('error'), automatic_resend=False)


def sent_copy_boundary(crash):
    name = 'accepted-before-copy' if crash else 'copy-failure'
    with case(name) as c:
        draft = c.save(new_draft(c, name + '@example.test'), 'save')
        original = imap_server.Session.cmd_append
        reached, release = threading.Event(), threading.Event()

        def intercepted_append(session, tag, command):
            if session.store is not c.server.store:
                return original(session, tag, command)
            if crash:
                reached.set()
                release.wait(30)
                return  # The client is killed before a Sent copy is appended.
            session.no(tag, 'Injected Sent-copy storage failure')

        imap_server.Session.cmd_append = intercepted_append
        try:
            c.send(draft, 'send')
            if crash:
                assert reached.wait(30), 'Sent APPEND checkpoint not reached'
                checkpoint = c.task('send')
                assert checkpoint.get('sendOutcome') == 'accepted', checkpoint
                assert len(c.server.sent_messages()) == 1
                (c.work / 'checkpoint.json').write_text(json.dumps(checkpoint, indent=2))
                c.ms.proc.kill()
                c.ms.proc.wait(timeout=5)
                c.ms.stop()
            else:
                completed = c.complete('send')
                assert not completed.get('error'), completed
                assert completed.get('sendOutcome') == 'accepted', completed
                assert completed.get('sentCopy') == 'failed', completed
                c.ms.stop()
        finally:
            release.set()
            imap_server.Session.cmd_append = original
        c.start()
        after = c.complete('send')
        assert not after.get('error'), after
        assert after.get('sendOutcome') == 'accepted', after
        assert after.get('sentCopy') == ('pending' if crash else 'failed'), after
        # A new task id after restart cannot resend the cached draft either.
        c.send(draft, 'duplicate-after-restart')
        assert c.complete('duplicate-after-restart').get('error')
        assert len(c.server.sent_messages()) == 1
        record(name, send_outcome=after['sendOutcome'], sent_copy=after['sentCopy'],
               smtp_after_restart=1, duplicate_after_restart_rejected=True,
               killed_with='SIGKILL' if crash else None)


try:
    if args.case in ('all', 'stale-draft'): stale_draft()
    if args.case in ('all', 'duplicate-send'): duplicate_send()
    if args.case in ('all', 'before-data'): interrupted_send('before-data')
    if args.case in ('all', 'after-data'): interrupted_send('after-data')
    if args.expect_fixed:
        if args.case in ('all', 'accepted-before-copy'): sent_copy_boundary(True)
        if args.case in ('all', 'copy-failure'): sent_copy_boundary(False)
finally:
    print('Artifacts:', run_dir, flush=True)
