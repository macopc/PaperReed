"""Check SMTP refusal, ambiguous delivery and unsupported multisend with loopback fixtures."""
import argparse
from contextlib import closing
import json
from pathlib import Path
import sqlite3
import sys
import tempfile

parser = argparse.ArgumentParser()
parser.add_argument('--upstream', type=Path, required=True)
parser.add_argument('--binary', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
sys.path.insert(0, str(args.upstream.resolve() / 'mailsync/test'))
from harness.mailsync import MailsyncProcess, account_json
from harness.servers.fake import FakeServer
from harness.mailgen import message
from fakeimap.smtp import _Handler

original_send = _Handler.send

def send_with_lost_response(self, line):
    if getattr(self.server.owner, 'lose_send_response', False) and line.startswith('250 2.0.0 Ok: queued'):
        self.connection.shutdown(2)
        return
    return original_send(self, line)

_Handler.send = send_with_lost_response
args.output.mkdir(parents=True, exist_ok=True)
work = Path(tempfile.mkdtemp(prefix='smtp-send-', dir=args.output.resolve()))
results = []

for mode in ['auth-rejected', 'lost-response', 'multisend-rejected']:
    server = FakeServer('dovecot', smtp=True, smtp_auth_response='535 5.7.8 Authentication failed' if mode == 'auth-rejected' else None)
    server.append('INBOX', message(1))
    server.start()
    server.smtp.lose_send_response = mode == 'lost-response'
    ms = None
    case = work / mode
    try:
        account = account_json(**server.account_kwargs())
        ms = MailsyncProcess(account, case, binary=args.binary.resolve(), env=server.engine_env())
        ms.start()
        ms.wait_quiescent(timeout=35)

        def row(sql, values=()):
            with closing(sqlite3.connect((case / 'config/edgehill.db').as_uri() + '?mode=ro', uri=True, timeout=3)) as db:
                return db.execute(sql, values).fetchone()

        def task(task_id):
            data = row('SELECT data FROM Task WHERE id=?', (task_id,))
            return json.loads(data[0]) if data else {}

        def complete(task_id):
            ms.wait_for(lambda: task(task_id).get('status') == 'complete', 45, task_id)
            return task(task_id)

        draft = {
            '__cls': 'Message', 'aid': account['id'], 'hMsgId': f'{mode}@example.test', 'v': 0,
            'subject': 'SMTP fixture', 'body': 'SMTP send body', 'plaintext': True,
            'from': [{'email': 'test@example.test'}], 'to': [{'email': 'recipient@example.test'}],
            'cc': [{'email': 'cc@example.test'}], 'bcc': [{'email': 'bcc@example.test'}],
            'replyTo': [], 'files': [], 'rthMsgId': '', 'fwdMsgId': '',
        }
        ms.queue_task({'id': 'save', '__cls': 'SyncbackDraftTask', 'draft': draft})
        assert not complete('save').get('error')
        data = row('SELECT m.data,b.value FROM Message m JOIN MessageBody b ON m.id=b.id WHERE m.headerMessageId=?', (draft['hMsgId'],))
        draft = dict(json.loads(data[0]), body=data[1])
        submission = {'id': 'send', '__cls': 'SendDraftTask', 'draft': draft, 'perRecipientBodies': {'recipient@example.test': 'Unsupported'} if mode == 'multisend-rejected' else None}
        ms.queue_task(submission)
        result = complete('send')

        expected = 'unknown' if mode == 'lost-response' else 'rejected'
        assert result['sendOutcome'] == expected, result
        count = 1 if mode == 'lost-response' else 0
        assert len(server.sent_messages()) == count
        ms.queue_task({'id': 'edit-after-failure', '__cls': 'SyncbackDraftTask', 'draft': dict(draft, body='Edit after send failure')})
        edit = complete('edit-after-failure')
        if expected == 'rejected':
            assert not edit.get('error'), edit
        else:
            assert edit.get('error', {}).get('key') == 'draft-frozen', edit
        ms.stop()
        ms.start()
        ms.wait_quiescent(timeout=35)
        ms.queue_task(submission)
        ms.wait_quiescent(timeout=10)
        assert len(server.sent_messages()) == count, 'Restart must not submit again'
        results.append({'case': mode, 'smtpSubmissions': count, 'outcome': expected,
                        'draftEditable': expected == 'rejected'})
        print('PASS', mode, flush=True)
    finally:
        if ms:
            ms.stop()
        server.stop()

(args.output / 'result.json').write_text(json.dumps(results, indent=2) + '\n')
print('Artifacts:', work)
