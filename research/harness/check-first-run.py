"""Blank-profile onboarding through real UI and local IMAP/SMTP only."""
import argparse, json, os, signal, subprocess, sys, tempfile, time
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--upstream',type=Path,required=True)
parser.add_argument('--app',type=Path,help='Optional packaged executable')
parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parent.parent/'first-run-validation-2026-11-16')
args=parser.parse_args(); upstream=args.upstream.resolve()
sys.path.insert(0,str(upstream/'mailsync/test'))
from harness.servers.fake import FakeServer
from harness.mailgen import message
from harness.mailsync import account_json
work=Path(tempfile.mkdtemp(prefix='first-run-',dir=upstream.parent))
server=FakeServer('dovecot',smtp=True); run=None
try:
    server.append('INBOX',message(1,sender=('Maya','maya@example.test'),subject='First run review',body='Please review the draft.'))
    server.append('INBOX',message(2,sender=('Alex','alex@example.test'),subject='Archive this note',body='This note can be archived.'))
    server.start()
    (work/'fixture.json').write_text(json.dumps(account_json(**server.account_kwargs())))
    command=['node',str(Path(__file__).with_suffix('.cjs')),str(upstream),str(work)]
    command += [str(args.app.resolve()) if args.app else '', str(args.output.resolve())]
    run=subprocess.Popen(command,start_new_session=True)
    deadline = time.monotonic() + 300
    while run.poll() is None:
        if time.monotonic() > deadline: raise TimeoutError('First-run check exceeded 300s')
        if (work/'rotate-password').exists() and not (work/'password-rotated').exists():
            server.imap.credentials = server.smtp.credentials = (server.username, 'rotated-pass')
            (work/'password-rotated').touch()
        time.sleep(0.1)
    if run.returncode: raise RuntimeError(f'UI check failed: {run.returncode}')
    sent=server.sent_messages()
    scoped_phase=(os.environ.get('PAPER_REED_PROVIDER_PICKER_CHECK') or os.environ.get('PAPER_REED_GOOGLE_PAGE_CHECK')
                  or os.environ.get('PAPER_REED_ICLOUD_PAGE_CHECK'))
    assert len(sent)==(0 if scoped_phase else 1), len(sent)
    if not scoped_phase:
        assert b'Paper Reed first run reply' in sent[0].raw
    result_path=args.output.resolve()/'result.json'
    if scoped_phase!='before':
        result=json.loads(result_path.read_text());result['observedSMTPSubmissions']=len(sent)
        result_path.write_text(json.dumps(result,indent=2)+'\n')
    if scoped_phase:
        print('PASS isolated onboarding screen; SMTP=0')
    else:
        print('PASS blank profile, normal onboarding, restart and installed CLI; SMTP=1')
finally:
    if run:
        try: os.killpg(run.pid,signal.SIGKILL)
        except ProcessLookupError: pass
    server.stop()
    print('Artifacts:',work)
