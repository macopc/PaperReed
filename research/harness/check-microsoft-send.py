"""Reuse upstream Microsoft fixtures with Paper Reed's persistent send contract."""
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
parser.add_argument('--case', choices=['accepted', 'rejected', 'server-error', 'lost-response', 'refresh-rejected'])
args = parser.parse_args()
sys.path.insert(0, str(args.upstream.resolve() / 'mailsync/test'))
from harness.mailsync import MailsyncProcess, account_json
from harness.servers.fake import FakeServer
from harness.mailgen import message
from fakeimap.graph import _Handler

original_send = _Handler._send

def send_with_lost_response(self, msg):
    if getattr(self.server.owner, 'lose_send_response', False):
        self.close_connection = True
        self.connection.shutdown(2)
        return
    return original_send(self, msg)

_Handler._send = send_with_lost_response
args.output.mkdir(parents=True, exist_ok=True)
work = Path(tempfile.mkdtemp(prefix='microsoft-send-', dir=args.output.resolve()))
results = []

for mode in ([args.case] if args.case else ['accepted', 'rejected', 'server-error', 'lost-response', 'refresh-rejected']):
    failures = []
    if mode in ['rejected', 'server-error']:
        # Only the first attempt fails: a retry would silently turn uncertainty into a send.
        failures = [{'route': '^messages/.*/send$', 'method': 'POST',
                     'status': 403 if mode == 'rejected' else 503, 'times': 1, 'retry_after': 1}]
    server = FakeServer('outlook', smtp=True, graph=True, graph_failures=failures,
                        graph_consented=mode != 'refresh-rejected')
    server.graph.lose_send_response = mode == 'lost-response'
    server.append('INBOX', message(1))
    server.start()
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
            'subject': 'Microsoft HTTPS fixture', 'body': 'Microsoft send body', 'plaintext': True,
            'from': [{'email': 'test@example.test'}], 'to': [{'email': 'recipient@example.test'}],
            'cc': [{'email': 'cc@example.test'}], 'bcc': [{'email': 'bcc@example.test'}],
            'replyTo': [], 'files': [], 'rthMsgId': '', 'fwdMsgId': '',
        }
        ms.queue_task({'id': 'save', '__cls': 'SyncbackDraftTask', 'draft': draft})
        assert not complete('save').get('error')
        data = row('SELECT m.data,b.value FROM Message m JOIN MessageBody b ON m.id=b.id WHERE m.headerMessageId=?', (draft['hMsgId'],))
        draft = dict(json.loads(data[0]), body=data[1])
        submission = {'id': 'send', '__cls': 'SendDraftTask', 'draft': draft, 'perRecipientBodies': None}
        ms.queue_task(submission)
        result = complete('send')

        def submissions():
            return [r for r in server.graph.requests if r['method'] == 'POST' and r['path'].endswith('/send')]

        expected_submissions = 0 if mode == 'refresh-rejected' else 1
        assert len(submissions()) == expected_submissions, f'{mode}: final submission attempted {len(submissions())} times'
        expected = 'accepted' if mode == 'accepted' else 'rejected' if mode in ['rejected', 'refresh-rejected'] else 'unknown'
        assert result['sendOutcome'] == expected, result
        if mode == 'accepted':
            assert result['sentCopy'] == 'filed', result
            assert len(server.store.get('Sent Items').messages) == 1
            assert set(server.graph.sent[0].recipients()) == {'recipient@example.test', 'cc@example.test', 'bcc@example.test'}
        ms.stop()
        ms.start()
        ms.wait_quiescent(timeout=35)
        ms.queue_task(submission)
        ms.wait_quiescent(timeout=10)
        assert len(submissions()) == expected_submissions, 'Restart/resubmit must not deliver twice'
        assert not server.sent_messages(), 'No SMTP fallback'
        results.append({'case': mode, 'outcome': expected, 'api_submissions': expected_submissions, 'smtp_submissions': 0})
        print('PASS', mode, flush=True)
    finally:
        if ms:
            ms.stop()
        server.stop()

(args.output / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
print('Artifacts:', work)
