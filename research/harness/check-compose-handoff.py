"""Launch isolated real desktop + local protocol servers; no PLAYWRIGHT mock mode."""
import argparse,json,subprocess,sys,tempfile,os,signal
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--upstream',type=Path,required=True)
a=p.parse_args();upstream=a.upstream.resolve()
sys.path.insert(0,str(upstream/'mailsync/test'))
from harness.mailsync import account_json
from harness.servers.fake import FakeServer
from harness.mailgen import message
work=Path(tempfile.mkdtemp(prefix='compose-handoff-',dir=upstream.parent))
server=FakeServer('dovecot',smtp=True)
try:
    server.append('INBOX',message(1));server.start()
    (work/'account.json').write_text(json.dumps(account_json(**server.account_kwargs())))
    run=subprocess.Popen(['node',str(Path(__file__).with_suffix('.cjs')),str(upstream),str(work)],start_new_session=True)
    try:
        run.wait(timeout=180)
    except subprocess.TimeoutExpired:
        os.killpg(run.pid,signal.SIGKILL)
        run.wait()
        raise
    sent=server.sent_messages()
    (work/'smtp-result.json').write_text(json.dumps({'submissions':len(sent),'subjects':[m.header('Subject') for m in sent]}))
    assert run.returncode==0
    assert len(sent)==1,len(sent)
    assert b'Paper Reed GUI edit' in sent[0].raw
    assert set(sent[0].recipients)=={'recipient@example.test','cc@example.test','bcc@example.test'},sent[0].recipients
    assert sent[0].header('Bcc') is None
    print('PASS real composer / actual CLI / desktop MCP / native engine; SMTP submissions=1')
finally:
    server.stop()
    print('Artifacts:',work)
