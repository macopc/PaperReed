"""Launch isolated real desktop + local protocol servers; no PLAYWRIGHT mock mode."""
import argparse,json,subprocess,sys,tempfile,os,signal
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--upstream',type=Path,required=True)
mode=p.add_mutually_exclusive_group();mode.add_argument('--conflict',action='store_true');mode.add_argument('--close-save',action='store_true');mode.add_argument('--recover',action='store_true');mode.add_argument('--audit',action='store_true');mode.add_argument('--workspace',action='store_true');mode.add_argument('--controls',action='store_true')
a=p.parse_args();upstream=a.upstream.resolve()
sys.path.insert(0,str(upstream/'mailsync/test'))
from harness.mailsync import account_json
from harness.servers.fake import FakeServer
from harness.mailgen import message
work=Path(tempfile.mkdtemp(prefix='compose-handoff-',dir=upstream.parent))
server=FakeServer('dovecot',smtp=True)
run=None
try:
    if a.audit or a.workspace or a.controls:
        from email.header import Header
        samples=[('Maya Chen','Design review · final notes','The revised layouts are ready. Please review the inbox spacing and reply flow.'),('Alex Morgan','Project kickoff — Thursday','Could you confirm the agenda and attendees for Thursday?'),('Billing','Your monthly receipt','Your receipt is ready. This is an isolated test message.'),('Weekly Digest','This week in product design','Three articles about typography, accessibility, and writing tools.'),('Lin Wei','Paper Reed 首版体验走查','我们先看收件箱、阅读和回复的连续体验，再检查异常状态。'),('Jordan Park','Re: Release checklist','The checklist is updated. Let me know which items need another pass.'),('Support','Account notification','Your test account is ready.'),('Sam Lee','A deliberately long subject to check how the inbox handles truncation and competing metadata','Does the row keep sender, date and unread status easy to scan?')]
        for i,(name,subject,body) in enumerate(samples):
            server.append('INBOX',message(i+1,sender=(name,f'sender{i}@example.test'),subject=Header(subject,'utf-8').encode(),body=body, **({'attachment':('incoming.txt',b'Incoming attachment bytes\n'),'extra_headers':{'Cc':'Team <team@example.test>'}} if os.environ.get('PAPER_REED_ATTACHMENTS_CHECK') and i==0 else {})))
    else:
        server.append('INBOX',message(1))
    if os.environ.get('PAPER_REED_ORGANIZATION_CHECK'):
        server.create_mailbox('Paper Reed Review')
    if os.environ.get('PAPER_REED_ORGANIZATION_CHECK') == 'folders':
        server.create_mailbox('All Mail', special_use='\\All')
        server.create_mailbox('[Mailspring]/Snoozed')
    server.start()
    (work/'account.json').write_text(json.dumps(account_json(**server.account_kwargs())))
    run=subprocess.Popen(['node',str(Path(__file__).with_suffix('.cjs')),str(upstream),str(work),'controls' if a.controls else 'workspace' if a.workspace else 'audit' if a.audit else 'recover' if a.recover else 'conflict' if a.conflict else 'close-save' if a.close_save else 'handoff'],start_new_session=True)
    try:
        run.wait(timeout=1800 if a.audit else 300)
    except subprocess.TimeoutExpired:
        os.killpg(run.pid,signal.SIGKILL)
        run.wait()
        raise
    sent=server.sent_messages()
    (work/'smtp-result.json').write_text(json.dumps({'submissions':len(sent),'subjects':[m.header('Subject') for m in sent]}))
    assert run.returncode==0
    if a.workspace and os.environ.get('PAPER_REED_COMPOSE_PAGE_CHECK'):
        assert not sent, len(sent)
        result_path=Path(os.environ['PAPER_REED_UI_OUTPUT'])/'result.json'
        result=json.loads(result_path.read_text())
        result['observedSMTPSubmissions']=len(sent)
        result_path.write_text(json.dumps(result,indent=2)+'\n')
        print('PASS isolated write-mail page; SMTP=0')
        sys.exit(0)
    if a.controls and os.environ.get('PAPER_REED_CONTROLS_PHASE') != 'before' and os.environ.get('PAPER_REED_SUBPAGES_PHASE') != 'before' and os.environ.get('PAPER_REED_ORGANIZATION_PHASE') != 'before' and os.environ.get('PAPER_REED_TEMPLATE_AGENT_PHASE') != 'before':
        result_path=Path(__file__).resolve().parent.parent/('settings-validation-2026-11-16/result.json' if os.environ.get('PAPER_REED_SETTINGS_CHECK') else 'controls-validation-2026-11-16/result.json')
        if os.environ.get('PAPER_REED_SETTINGS_CHECK') and os.environ.get('PAPER_REED_SETTINGS_OUTPUT'):
            result_path=Path(os.environ['PAPER_REED_SETTINGS_OUTPUT'])/'result.json'
        if os.environ.get('PAPER_REED_SUBPAGES_CHECK'):
            result_path=Path(__file__).resolve().parent.parent/'subpages-validation-2026-11-16/result.json'
        if os.environ.get('PAPER_REED_ORGANIZATION_CHECK'):
            result_path=Path(__file__).resolve().parent.parent/'organization-validation-2026-11-16/result.json'
        if os.environ.get('PAPER_REED_TEMPLATE_AGENT_CHECK'):
            result_path=Path(__file__).resolve().parent.parent/'template-agent-validation-2026-11-16/result.json'
        if os.environ.get('PAPER_REED_CLI_ONBOARDING_CHECK'):
            result_path=Path(__file__).resolve().parent.parent/'cli-onboarding-validation-2026-11-16/result.json'
        if os.environ.get('PAPER_REED_INBOX_CHECK'):
            result_path=Path(__file__).resolve().parent.parent/'inbox-validation-2026-11-16/result.json'
        if os.environ.get('PAPER_REED_TRIAGE_CHECK'):
            result_path=Path(__file__).resolve().parent.parent/'triage-validation-2026-11-16/result.json'
        if os.environ.get('PAPER_REED_ATTACHMENTS_CHECK'):
            result_path=Path(__file__).resolve().parent.parent/'attachments-validation-2026-11-16/result.json'
        if os.environ.get('PAPER_REED_RULES_CHECK'):
            result_path=Path(__file__).resolve().parent.parent/'rules-validation-2026-11-16/result.json'
        if os.environ.get('PAPER_REED_QUALITY_CHECK'):
            result_path=Path(__file__).resolve().parent.parent/'quality-fixes-validation-2026-11-16/result.json'
        result=json.loads(result_path.read_text());result['observedSMTPSubmissions']=len(sent)
        result_path.write_text(json.dumps(result,indent=2)+'\n')
    if os.environ.get('PAPER_REED_ATTACHMENTS_CHECK'):
        from email import policy
        from email.parser import BytesParser
        assert len(sent)==2,len(sent)
        parsed=[BytesParser(policy=policy.default).parsebytes(m.raw) for m in sent]
        first=next(m for m in parsed if m['Subject']=='Paper Reed GUI attachment copy')
        reply=next(m for m in parsed if 'Design review' in str(m['Subject']))
        assert list(first.iter_attachments())[0].get_payload(decode=True)==b'Frozen attachment bytes\n'
        assert first['Bcc'] is None
        original=next(m for m in sent if b'Paper Reed GUI attachment copy' in m.raw)
        assert set(original.recipients)=={'recipient@example.test','bcc@example.test'},original.recipients
        assert reply['In-Reply-To'] and reply['References']
        assert list(reply.iter_attachments())[0].get_payload(decode=True)==b'Incoming attachment bytes\n'
        reply_sent=next(m for m in sent if m is not original)
        assert set(reply_sent.recipients)=={'sender0@example.test','team@example.test'},reply_sent.recipients
        result.update({'SMTPAttachmentBytesMatch':True,'SMTPEnvelopeMatchesEditedRecipients':True,'SMTPReplyHeaders':True,'SMTPBccHidden':True})
        result_path.write_text(json.dumps(result,indent=2)+'\n')
        print('PASS actual SMTP MIME bytes, recipients and reply headers; submissions=2')
        sys.exit(0)
    if a.conflict or a.close_save or a.recover or a.audit or a.controls:
        assert len(sent)==0,len(sent)
        print('PASS close/conflict verification; SMTP submissions=0')
        sys.exit(0)
    assert len(sent)==1,len(sent)
    assert b'Paper Reed GUI edit' in sent[0].raw
    assert set(sent[0].recipients)=={'recipient@example.test','cc@example.test','bcc@example.test'},sent[0].recipients
    assert sent[0].header('Bcc') is None
    if a.workspace:
        result_path=Path(os.environ.get('PAPER_REED_UI_OUTPUT',str(Path(__file__).resolve().parent.parent/'editor-validation-2026-11-16')))/'result.json'
        result=json.loads(result_path.read_text())
        result['observedSMTPSubmissions']=len(sent)
        result_path.write_text(json.dumps(result,indent=2)+'\n')
    print('PASS real composer / actual CLI / desktop MCP / native engine; SMTP submissions=1')
finally:
    if run:
        try: os.killpg(run.pid,signal.SIGKILL if a.workspace or a.controls else signal.SIGTERM)
        except ProcessLookupError: pass
    server.stop()
    print('Artifacts:',work)
