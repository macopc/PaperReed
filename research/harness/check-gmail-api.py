"""Exercise Gmail HTTPS submission with the real engine and loopback fixtures only."""
import argparse
import base64
from contextlib import closing
from email import policy
from email.parser import BytesParser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import socket
import sqlite3
import sys
import tempfile
import threading
from urllib.parse import parse_qs

parser = argparse.ArgumentParser()
parser.add_argument('--upstream', type=Path, required=True)
parser.add_argument('--binary', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
sys.path.insert(0, str(args.upstream.resolve() / 'mailsync/test'))
from harness.mailsync import MailsyncProcess, account_json
from harness.servers.fake import FakeServer
from harness.mailgen import message
from fakeimap.server import Session as _Handler

# Upstream's fixture lacks X-GM-MSGID search and uses backing UIDs for label views.
# Implement this protocol key in the fixture, with folder-specific UIDs like Gmail.
_original_uid_search = _Handler.cmd_uid_search
def _uid_search(self, tag, args, uid_mode):
    tokens = args.rest().strip().split()
    if len(tokens) != 2 or tokens[0].upper() != b'X-GM-MSGID':
        return _original_uid_search(self, tag, args, uid_mode)
    if not self.require_selected(tag):
        return
    mailbox = self.store.get(self.selected)
    with self.store.lock:
        matches = [m for m in mailbox.messages if m.gm_msgid == int(tokens[1])]
        uids = [mailbox.view_uid(m) if hasattr(mailbox, 'view_uid') else m.uid for m in matches]
    self.send(('* SEARCH ' + ' '.join(map(str, uids))).encode())
    self.flush_events(allow_expunge=True)
    self.ok(tag, 'Search completed.')
_Handler.cmd_uid_search = _uid_search

args.output.mkdir(parents=True, exist_ok=True)
work = Path(tempfile.mkdtemp(prefix='gmail-api-', dir=args.output.resolve()))
results = []


def run_case(mode):
    requests = []
    class Google(BaseHTTPRequestHandler):
        def log_message(self, *args):
            pass

        def reply(self, status, body):
            raw = json.dumps(body).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)

        def do_GET(self):
            assert self.path == '/userinfo'
            assert self.headers['Authorization'] == 'Bearer fixture-access'
            self.reply(200, {'email': 'test@example.test', 'email_verified': True})

        def do_POST(self):
            body = self.rfile.read(int(self.headers['Content-Length']))
            if self.path == '/token':
                form = parse_qs(body.decode())
                assert form['client_id'] == ['paper-reed-fixture']
                assert form['client_secret'] == ['fixture-client-secret']
                assert form['refresh_token'] == ['fixture-refresh']
                self.reply(400 if mode == 'refresh-rejected' else 200,
                           {'error': 'invalid_grant'} if mode == 'refresh-rejected' else {'access_token': 'fixture-access'})
                return
            assert self.path == '/gmail/v1/users/me/messages/send'
            assert self.headers['Authorization'] == 'Bearer fixture-access'
            raw = json.loads(body)['raw']
            assert '+' not in raw and '/' not in raw and '=' not in raw
            mime = BytesParser(policy=policy.default).parsebytes(base64.urlsafe_b64decode(raw + '=' * (-len(raw) % 4)))
            assert mime['To'] == 'recipient@example.test'
            assert mime['Cc'] == 'cc@example.test'
            assert mime['Bcc'] == 'bcc@example.test'
            assert mime['Subject'] == 'Gmail HTTPS fixture'
            assert 'Gmail send body' in mime.get_body(preferencelist=('plain',)).get_content()
            requests.append(mime['Message-ID'])
            if mode == 'lost-response':
                self.connection.shutdown(socket.SHUT_RDWR)
                self.connection.close()
            elif mode == 'rejected':
                self.reply(403, {'error': {'code': 403}})
            elif mode == 'invalid-receipt':
                self.reply(200, {})
            elif mode == 'server-error':
                self.reply(503, {'error': {'code': 503}})
            elif mode == 'rewritten-message-id':
                mime.replace_header('Message-ID', '<rewritten-by-google@example.test>')
                saved = server.store.append('[Gmail]/Sent Mail', mime.as_bytes())
                self.reply(200, {'id': format(saved.gm_msgid, 'x'), 'labelIds': ['SENT']})
            else:
                self.reply(200, {'id': '123456789abcdef', 'labelIds': ['SENT']})

    google = ThreadingHTTPServer(('127.0.0.1', 0), Google)
    thread = threading.Thread(target=google.serve_forever, daemon=True)
    thread.start()
    server = FakeServer('gmail', smtp=True)
    server.append('INBOX', message(1))
    server.start()
    ms = None
    case = work / mode
    try:
        account = account_json(**server.account_kwargs(), extra_settings={
            'gmail_api_send': True, 'gmail_client_id': 'paper-reed-fixture',
            'gmail_client_secret': 'fixture-client-secret', 'gmail_refresh_token': 'fixture-refresh',
        })
        base = f'http://127.0.0.1:{google.server_port}'
        ms = MailsyncProcess(account, case, binary=args.binary.resolve(), env={
            'GMAIL_OAUTH_TOKEN_URL': base + '/token', 'GMAIL_USERINFO_URL': base + '/userinfo',
            'GMAIL_API_URL': base + '/gmail/v1',
        })
        if mode == 'accepted':
            check = ms.run_mode('test')
            assert check.returncode == 0, check.stdout
            assert not requests, 'Connection check must not send email'
        ms.start()
        ms.wait_quiescent(timeout=35)

        def row(sql, values=()):
            with closing(sqlite3.connect((case / 'config/edgehill.db').as_uri() + '?mode=ro', uri=True, timeout=3)) as db:
                return db.execute(sql, values).fetchone()

        def task(task_id):
            data = row('SELECT data FROM Task WHERE id=?', (task_id,))
            return json.loads(data[0]) if data else {}

        def complete(task_id):
            ms.wait_for(lambda: task(task_id).get('status') == 'complete', 35, task_id)
            return task(task_id)

        draft = {
            '__cls': 'Message', 'aid': account['id'], 'hMsgId': f'{mode}@example.test', 'v': 0,
            'subject': 'Gmail HTTPS fixture', 'body': 'Gmail send body', 'plaintext': True,
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
        expected = 'accepted' if mode in ('accepted', 'rewritten-message-id', 'late-sent-copy') else 'rejected' if mode in ('rejected', 'refresh-rejected') else 'unknown'
        assert result['sendOutcome'] == expected, result
        if mode == 'accepted':
            assert result['sentCopy'] == 'pending', result
            # Gmail owns Sent filing; do not manufacture a second IMAP copy.
            assert not row("SELECT 1 FROM Message WHERE headerMessageId=? AND draft=0", (draft['hMsgId'],))
        if mode == 'rewritten-message-id':
            assert result['sentCopy'] == 'filed', result
            assert row("SELECT COUNT(*) FROM Message WHERE headerMessageId='rewritten-by-google@example.test'")[0] == 1
            assert len(server.store.get('[Gmail]/Sent Mail').messages) == 1
        if mode == 'late-sent-copy':
            assert result['sentCopy'] == 'pending', result
            # A rewritten header must still match the durable Gmail API receipt.
            raw = message(9, message_id='<late-rewritten@example.test>')
            saved = server.store.append('[Gmail]/Sent Mail', raw)
            saved.gm_msgid = int('123456789abcdef', 16)
            ms.wait_for(lambda: row("SELECT sentCopy FROM PaperReedSend WHERE requestId='send'") == ('filed',),
                        45, 'late Sent sync reconciles receipt')
        expected_requests = 0 if mode == 'refresh-rejected' else 1
        assert len(requests) == expected_requests, requests
        ms.stop()
        ms.start()
        ms.wait_quiescent(timeout=35)
        ms.queue_task(submission)
        ms.wait_quiescent(timeout=10)
        assert len(requests) == expected_requests, 'Restart/resubmit must not deliver twice'
        if mode == 'late-sent-copy':
            assert row("SELECT sentCopy FROM PaperReedSend WHERE requestId='send'") == ('filed',)
        assert len(server.sent_messages()) == 0, 'Gmail API must not fall back to SMTP'
        results.append({'case': mode, 'outcome': expected, 'api_submissions': len(requests), 'smtp_submissions': 0})
        print('PASS', mode, flush=True)
    finally:
        if ms:
            ms.stop()
        server.stop()
        google.shutdown()
        google.server_close()


for mode in ('accepted', 'rewritten-message-id', 'late-sent-copy', 'rejected', 'lost-response', 'invalid-receipt', 'server-error', 'refresh-rejected'):
    run_case(mode)
(work / 'results.json').write_text(json.dumps(results, indent=2) + '\n')
print('Results:', work)
