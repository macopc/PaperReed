"""Offline desktop/CLI workflow; real engine, loopback IMAP and SMTP fixtures only."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time

p = argparse.ArgumentParser(description=__doc__)
p.add_argument('--upstream', type=Path, required=True)
p.add_argument('--output', type=Path, required=True)
a = p.parse_args()
upstream = a.upstream.resolve()
sys.path.insert(0, str(upstream / 'mailsync/test'))
from harness.servers.fake import FakeServer
from harness.mailsync import account_json
from harness.mailgen import message

work = Path(tempfile.mkdtemp(prefix='offline-workflow-', dir=upstream.parent))
servers = [FakeServer('dovecot', smtp=True, email=f'offline{i}@example.test') for i in range(2)]
run = None
try:
    accounts = []
    for i, server in enumerate(servers):
        server.append('INBOX', message(1, subject=f'Cached mail {i}', body='Cached body fixture'))
        server.start()
        accounts.append(account_json(**server.account_kwargs(), account_id=f'c-offline-{i}'))
    (work / 'accounts.json').write_text(json.dumps(accounts))
    a.output.mkdir(parents=True, exist_ok=True)
    run = subprocess.Popen(['node', str(Path(__file__).with_suffix('.cjs')), str(upstream), str(work), str(a.output.resolve())], start_new_session=True)
    deadline = time.monotonic() + 360
    while run.poll() is None:
        request = work / 'fixture-request.json'
        if request.exists():
            command = json.loads(request.read_text())
            request.unlink()
            action = command['action']
            if action == 'disconnect':
                server = servers[command['account']]
                server.imap.stop()
                server.drop_connections()
            elif action == 'reconnect':
                server = servers[command['account']]
                server.append('INBOX', message(2, subject='Reconnected fixture', body='Network restored'))
                server.imap.start()
            elif action != 'counts':
                raise ValueError(action)
            (work / 'fixture-result.json').write_text(json.dumps({'smtp': [len(s.sent_messages()) for s in servers]}))
        if time.monotonic() > deadline:
            raise TimeoutError('Offline workflow exceeded 360s')
        time.sleep(.1)
    assert run.returncode == 0, run.returncode
    assert [len(s.sent_messages()) for s in servers] == [1, 0]
    assert b'GUI offline edit fixture' in servers[0].sent_messages()[0].raw
    print('PASS fixture submission counts and sent body; SMTP=1, all loopback')
finally:
    if run:
        try:
            os.killpg(run.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
    for s in servers:
        s.stop()
    print('Artifacts:', work)
