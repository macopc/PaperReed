"""Real desktop/CLI/native engine with Gmail-style and ordinary IMAP accounts, loopback only."""
import argparse
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time

p=argparse.ArgumentParser()
p.add_argument('--upstream',type=Path,required=True)
p.add_argument('--output',type=Path,required=True)
a=p.parse_args();upstream=a.upstream.resolve()
sys.path.insert(0,str(upstream/'mailsync/test'))
from harness.servers.fake import FakeServer
from harness.mailsync import account_json
from harness.mailgen import message
work=Path(tempfile.mkdtemp(prefix='multi-mailbox-',dir=upstream.parent))
servers=[FakeServer('gmail',smtp=True,email='account0@example.test'),FakeServer('dovecot',smtp=True,email='account1@example.test')]
run=None
readonly_label_writes=[]
set_gmail_labels=servers[0].store.set_labels

def track_labels(mailbox,uids,op,labels,origin=None):
    if set(labels) & {'\\Sent','\\Draft','\\Drafts'}:
        readonly_label_writes.append(list(labels))
    return set_gmail_labels(mailbox,uids,op,labels,origin=origin)

servers[0].store.set_labels=track_labels
try:
    accounts=[]
    for i,server in enumerate(servers):
        server.append('INBOX',message(1,subject='Shared subject',message_id='<same-message@example.test>'))
        if i==0:
            server.create_mailbox('Projects')
            server.store.set_labels('[Gmail]/All Mail',[1],'add',['Projects'])
            server.store.append('[Gmail]/All Mail',message(2,subject='Archived sibling',in_reply_to='<same-message@example.test>',references=['<same-message@example.test>']))
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
            found=[]
            for folder,items in server.store.truth().items():
                for entry in items.values():
                    if entry['message_id'].strip('<>')==check['messageId'].strip('<>'):
                        found.append({'folder':folder,'labels':sorted(entry.get('labels',set()))})
            (work/'truth-result.json').write_text(json.dumps(found))
        if time.monotonic()>deadline:raise TimeoutError('Mixed mailbox check exceeded 360s')
        time.sleep(.1)
    assert run.returncode==0,run.returncode
    assert not readonly_label_writes,readonly_label_writes
    assert all(not s.sent_messages() for s in servers),'This test does not send mail'
    print('PASS mixed-account server state; no SMTP submissions')
finally:
    if run:
        try:os.killpg(run.pid,signal.SIGKILL)
        except ProcessLookupError:pass
    for s in servers:s.stop()
    print('Artifacts:',work)
