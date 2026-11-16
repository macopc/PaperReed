"""Exercise the real TS service against the source-built engine over a test-only RPC adapter."""
import argparse, json, sqlite3, subprocess, sys, tempfile
from contextlib import closing
from pathlib import Path
p=argparse.ArgumentParser()
p.add_argument('--upstream',type=Path,required=True)
p.add_argument('--binary',type=Path,required=True)
a=p.parse_args(); a.upstream=a.upstream.resolve(); a.binary=a.binary.resolve()
sys.path.insert(0,str(a.upstream/'mailsync/test'))
from harness.mailsync import MailsyncProcess, account_json
from harness.servers.fake import FakeServer
from harness.mailgen import message
work=Path(tempfile.mkdtemp(prefix='shared-core-',dir=a.upstream.parent))
server=FakeServer('dovecot',smtp=True)
ms=None;node=None
try:
    server.append('INBOX',message(1));server.start()
    account=account_json(**server.account_kwargs())
    ms=MailsyncProcess(account,work,binary=a.binary);ms.start();ms.wait_quiescent(timeout=35)
    def query(sql,params):
        assert sql.startswith('SELECT ')
        with closing(sqlite3.connect((work/'config/edgehill.db').as_uri()+'?mode=ro',uri=True)) as db:
            db.row_factory=sqlite3.Row
            return [dict(row) for row in db.execute(sql,params)]
    node=subprocess.Popen(['node',str(Path(__file__).with_name('check-shared-core.cjs')),str(a.upstream),account['id']],
                          stdin=subprocess.PIPE,stdout=subprocess.PIPE,text=True)
    for line in node.stdout:
        call=json.loads(line)
        try:
            method=call['method'];arg=call['args']
            if method=='query': result=query(*arg)
            elif method=='enqueue': result=ms.queue_task(arg[0])
            elif method=='wait':
                def task():
                    rows=query('SELECT data FROM Task WHERE id = ?',[arg[0]])
                    return json.loads(rows[0]['data']) if rows else {}
                ms.wait_for(lambda: task().get('status') in ('remote','complete','cancelled'),35,'local task')
                result=task()
            elif method=='churn':
                for i in range(110):
                    ms.queue_task({'id':f'history-{i}','__cls':'SyncbackDraftTask',
                                   'draft':{'aid':account['id'],'hMsgId':f'missing-{i}@example.test','v':7}})
                ms.wait_for(lambda: query("SELECT id FROM Task WHERE id = ? AND status = 'complete'", ['history-109']),35,'history churn')
                result=True
            elif method=='restart':
                ms.stop();ms=MailsyncProcess(account,work,binary=a.binary);ms.start();ms.wait_quiescent(timeout=35);result=True
            elif method=='smtp-count': result=len(server.sent_messages())
            else: raise ValueError(method)
            answer={'id':call['id'],'result':result}
        except Exception as e: answer={'id':call['id'],'error':str(e)}
        node.stdin.write(json.dumps(answer)+'\n');node.stdin.flush()
    assert node.wait(timeout=10)==0
    print('PASS shared TS service / actual mailsync / local SMTP; artifacts:',work)
finally:
    if node and node.poll() is None:node.kill();node.wait()
    if ms:ms.stop()
    server.stop()
