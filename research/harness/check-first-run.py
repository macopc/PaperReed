"""Blank-profile onboarding through real UI and local IMAP/SMTP only."""
import argparse, json, os, signal, ssl, subprocess, sys, tempfile, time
from pathlib import Path
parser=argparse.ArgumentParser()
parser.add_argument('--upstream',type=Path,required=True)
parser.add_argument('--app',type=Path,help='Optional packaged executable')
parser.add_argument('--output',type=Path,default=Path(__file__).resolve().parent.parent/'first-run-validation-2026-11-16')
parser.add_argument('--certificate-fixture',type=Path,help='Untrusted fixture directory containing chain.pem and leaf.key')
args=parser.parse_args(); upstream=args.upstream.resolve()
certificate_phase=os.environ.get('PAPER_REED_CERTIFICATE_PAGE_CHECK')
certificate_service={'native-imap':'imap','native-smtp':'smtp'}.get(certificate_phase)
if bool(certificate_service) != bool(args.certificate_fixture):
    parser.error('native-imap and native-smtp require --certificate-fixture')
sys.path.insert(0,str(upstream/'mailsync/test'))
from harness.servers.fake import FakeServer
from harness.mailgen import message
from harness.mailsync import account_json
work=Path(tempfile.mkdtemp(prefix='first-run-',dir=upstream.parent))
tls=None
if certificate_service:
    tls=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    chain=args.certificate_fixture/'chain.pem'
    tls.load_cert_chain(str(chain),str(args.certificate_fixture/'leaf.key'))
    (work/'native-certificate.pem').write_bytes(chain.read_bytes())
server=FakeServer('dovecot',smtp=True,log_path=str(work/'fixture-imap.log') if certificate_service else None,
    tls_context=tls if certificate_service=='imap' else None,implicit_tls=certificate_service=='imap')
if certificate_service=='smtp':
    server.smtp.tls_context=tls
run=None
try:
    server.append('INBOX',message(1,sender=('Maya','maya@example.test'),subject='First run review',body='Please review the draft.'))
    server.append('INBOX',message(2,sender=('Alex','alex@example.test'),subject='Archive this note',body='This note can be archived.'))
    server.start()
    account=account_json(**server.account_kwargs(),
        imap_security='SSL / TLS' if certificate_service=='imap' else 'none',
        smtp_security='SSL / TLS' if certificate_service=='smtp' else 'none')
    (work/'fixture.json').write_text(json.dumps(account))
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
                  or os.environ.get('PAPER_REED_ICLOUD_PAGE_CHECK') or os.environ.get('PAPER_REED_IMAP_PAGE_CHECK')
                  or os.environ.get('PAPER_REED_SERVER_PAGE_CHECK') or os.environ.get('PAPER_REED_CERTIFICATE_PAGE_CHECK')
                  or os.environ.get('PAPER_REED_ACCOUNT_SAVE_CHECK'))
    assert len(sent)==(0 if scoped_phase else 1), len(sent)
    if not scoped_phase:
        assert b'Paper Reed first run reply' in sent[0].raw
    result_path=args.output.resolve()/'result.json'
    if scoped_phase!='before':
        result=json.loads(result_path.read_text());result['observedSMTPSubmissions']=len(sent)
        if certificate_service=='imap':
            imap_log=(work/'fixture-imap.log').read_text()
            assert not any(' LOGIN ' in line or ' AUTHENTICATE ' in line for line in imap_log.splitlines())
            result['rejectedServerReceivedNoCredentials']=True
        elif certificate_service=='smtp':
            assert not any(direction=='C' and line.upper().startswith('AUTH ') for _,direction,line in server.smtp.transcript)
            result['rejectedServerReceivedNoCredentials']=True
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
