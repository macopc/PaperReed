const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ phase, main, run, until, shot, out, fixture }) => {
  const active = main.locator('.page-container:not([inert])');
  const page = active.locator('.AccountIMAPSettingsForm');
  const field = key => page.locator(`[id="settings.${key}"]`);
  const connect = page.getByRole('button', { name: '连接邮箱', exact: true });
  const back = page.getByRole('button', { name: '返回', exact: true });
  const paint = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const resize = async (width, height) => {
    await run(`require("@electron/remote").getCurrentWindow().setContentSize(${width},${height});true`);
    await until(() => run(`innerWidth===${width} && innerHeight===${height}`), `server window ${width} × ${height}`);
    await paint();
  };
  await active.locator('[data-provider=imap]').click();
  await active.locator('#name').fill('Maya Chen');
  await active.locator('#emailAddress').fill(fixture.emailAddress);
  await active.locator('[id="settings.imap_password"]').fill(fixture.settings.imap_password);
  await active.locator('[data-manual-setup]').click();
  await active.and(main.locator('.alpha-fade-enter-done')).locator('.AccountIMAPSettingsForm').waitFor();
  await until(() => run('document.fonts.status==="loaded"'), 'server form fonts');
  await resize(900, 780);
  await shot(`${phase}-servers-desktop`);
  await resize(420, 500);
  await run('document.querySelector(".page-container:not([inert]) .AccountIMAPSettingsForm").scrollTop=0;true');
  await paint();
  await shot(`${phase}-servers-narrow`);
  if (phase === 'before') return;

  const incoming = page.getByRole('group', { name: '收信服务器 IMAP' });
  const outgoing = page.getByRole('group', { name: '发信服务器 SMTP' });
  assert(await incoming.isVisible());
  assert(await outgoing.isVisible());
  assert(await run(`(()=>{
    const page=document.querySelector('.page-container:not([inert]) .pr-server-setup');
    const groups=page.querySelectorAll('fieldset');
    const first=groups[0].getBoundingClientRect(), second=groups[1].getBoundingClientRect();
    const actions=page.querySelector('.pr-onboarding-actions').getBoundingClientRect();
    return page.scrollWidth<=page.clientWidth+1 && first.bottom<=second.top &&
      actions.top>=0 && actions.bottom<=innerHeight+1;
  })()`), 'server form stacks and both actions remain visible');
  assert(await run('document.activeElement.id==="settings.imap_host"'));
  await field('imap_host').press('Tab');
  assert(await run('document.activeElement.id==="settings.imap_port"'));
  const advanced = incoming.locator('details');
  assert.equal(await advanced.getAttribute('open'), null);
  await advanced.locator('summary').focus();
  await main.keyboard.press('Enter');
  assert.equal(await advanced.getAttribute('open'), '');
  assert(await field('container_folder').isVisible());
  assert.equal(await field('imap_allow_insecure_ssl').isChecked(), false);
  await main.keyboard.press('Enter');

  await field('imap_host').fill(fixture.settings.imap_host);
  await back.click();
  await active.locator('[data-manual-setup]').click();
  await outgoing.waitFor();
  assert(await run('document.activeElement.id==="settings.smtp_host"'),
    'initial focus skips the closed folder prefix and reaches the empty SMTP host');
  await resize(420, 500);

  await field('smtp_port').selectOption('0');
  const customSMTPPort = field('smtp_port_custom');
  await customSMTPPort.focus();
  await main.keyboard.type('2525');
  assert.equal(await customSMTPPort.inputValue(), '2525',
    'typing past a standard port prefix keeps the custom field visible');
  assert(await run('document.activeElement.id==="settings.smtp_port_custom"'));
  assert.equal(await field('smtp_port').inputValue(), '0');
  assert.equal(await field('smtp_security').inputValue(), 'SSL / TLS');
  await back.click();
  await active.locator('[data-manual-setup]').click();
  await customSMTPPort.waitFor();
  await resize(420, 500);
  assert.equal(await customSMTPPort.inputValue(), '2525');
  await customSMTPPort.fill('');
  await main.keyboard.type('2526');
  assert.equal(await customSMTPPort.inputValue(), '2526', 'a reopened custom port can be edited by keyboard');
  await field('smtp_port').selectOption('465');

  await field('smtp_port').selectOption('0');
  await field('smtp_port_custom').fill('143');
  assert.equal(await field('imap_security').inputValue(), 'SSL / TLS',
    'a custom SMTP port does not change IMAP encryption');
  await field('smtp_port').selectOption('465');
  for (const service of ['imap', 'smtp']) {
    await field(`${service}_host`).fill(fixture.settings[`${service}_host`]);
    await field(`${service}_port`).selectOption('0');
    assert.equal(await field(`${service}_port_custom`).inputValue(), '');
    await field(`${service}_port_custom`).fill(String(fixture.settings[`${service}_port`]));
    await field(`${service}_security`).selectOption('none');
    await field(`${service}_username`).fill(fixture.settings[`${service}_username`]);
  }
  await field('smtp_port').selectOption('465');
  await field('smtp_port').selectOption('0');
  assert.equal(await field('smtp_port_custom').inputValue(), '');
  assert.equal(await page.getByRole('alert').count(), 0, 'choosing a custom port does not announce an error');
  assert.equal(await field('smtp_port_custom').getAttribute('aria-invalid'), null);
  assert.equal(await connect.getAttribute('aria-disabled'), 'true');
  await field('smtp_port_custom').focus();
  await paint();
  await shot('after-servers-custom-port');
  for (const [draft, invalid] of [[' 465 ', true], ['465', false]]) {
    await field('smtp_port_custom').fill(draft);
    await back.click();
    await active.locator('[data-manual-setup]').click();
    assert.equal(await field('smtp_port').inputValue(), '0', 'a reopened draft stays in custom mode');
    assert.equal(await field('smtp_port_custom').inputValue(), draft, 'the raw draft stays editable');
    assert.equal(await field('smtp_port_custom').getAttribute('aria-invalid'), invalid ? 'true' : null);
    assert.equal(await connect.getAttribute('aria-disabled'), String(invalid));
    if (invalid) {
      await resize(420, 500);
      await field('smtp_port_custom').focus();
      await paint();
      await shot('after-servers-port-draft');
    }
  }
  await resize(420, 500);
  await field('smtp_port_custom').fill('0');
  assert.equal(await field('smtp_port_custom').getAttribute('aria-invalid'), 'true', 'typed zero is invalid');
  await field('smtp_port_custom').fill('65536');
  assert.equal(await field('smtp_port_custom').getAttribute('aria-invalid'), 'true');
  assert.equal(await connect.getAttribute('aria-disabled'), 'true');
  await field('smtp_port_custom').fill('');
  assert.equal(await page.getByRole('alert').count(), 0, 'clearing the custom port returns to the incomplete state');
  assert.equal(await field('smtp_port_custom').getAttribute('aria-invalid'), null);
  assert.equal(await connect.getAttribute('aria-disabled'), 'true');
  await field('smtp_port_custom').fill(String(fixture.settings.smtp_port));
  await field('smtp_security').selectOption('none');
  assert.equal(await field('smtp_port_custom').getAttribute('aria-invalid'), null);
  await field('smtp_password').fill('fixture-wrong-smtp-password');
  await paint();
  const actions = await Promise.all([back.boundingBox(), connect.boundingBox()]);
  assert(actions.every(box => box && box.y >= 0 && box.y + box.height <= 500),
    'actions stay visible while editing SMTP');
  await shot('after-servers-narrow-smtp');
  await run(`(()=>{
    const {MailsyncProcess}=require('mailspring-exports');
    const original=MailsyncProcess.prototype.test;
    MailsyncProcess.prototype.test=async function(){
      await new Promise(resolve=>{window.prReleaseServerValidation=resolve;});
      return original.call(this);
    };
    window.prRestoreServerValidation=()=>{MailsyncProcess.prototype.test=original;};
    return true;
  })()`);
  const alert = page.getByRole('alert').filter({ hasText: '发信服务器拒绝登录' });
  try {
    await connect.click();
    await until(() => run('!!window.prReleaseServerValidation'), 'native test paused before connecting');
    const busy = page.getByRole('button', { name: '正在验证连接…', exact: true });
    assert.deepEqual(await busy.boundingBox(), actions[1], 'validation keeps the action in place');
    assert.equal(await busy.getAttribute('aria-disabled'), 'true');
    assert(await run('document.activeElement.textContent==="正在验证连接…"'));
    await paint();
    await shot('after-servers-validating');
    await run('window.prReleaseServerValidation();true');
    await alert.waitFor();
  } finally {
    await run('window.prRestoreServerValidation();true');
  }
  assert.equal(await field('smtp_password').getAttribute('aria-invalid'), 'true');
  assert.equal(await field('imap_password').getAttribute('aria-invalid'), null);
  assert(await run('document.activeElement.textContent==="连接邮箱"'));
  await paint();
  await shot('after-servers-smtp-rejected');
  assert.equal(await run('require("mailspring-exports").AccountStore.accounts().length'), 0);

  await field('smtp_password').fill(fixture.settings.smtp_password);
  await advanced.locator('summary').click();
  const legacyTLS = incoming.getByRole('checkbox', { name: '允许旧版 TLS', exact: true });
  assert.equal(await legacyTLS.isChecked(), false);
  const legacyTLSHelp = incoming.locator('#pr-imap-legacy-tls-help');
  assert.match(await legacyTLSHelp.textContent(), /证书仍会校验/);
  await run('document.querySelector(".page-container:not([inert]) #pr-imap-legacy-tls-help").scrollIntoView({block:"center"});true');
  await paint();
  await shot('after-servers-legacy-tls');
  await legacyTLS.check();
  await advanced.locator('summary').click();
  assert.match(await advanced.locator('summary').textContent(), /已允许旧版 TLS/);

  await field('smtp_port_custom').fill('465');
  await run(`(()=>{
    const {MailsyncProcess}=require('mailspring-exports');
    const original=MailsyncProcess.prototype.test;
    MailsyncProcess.prototype.test=async function(){
      window.prServerValidatedPort=this.account.settings.smtp_port;
      throw Object.assign(new Error('local diagnostic fixture'),window.prServerDiagnostic);
    };
    window.prRestoreServerValidation=()=>{MailsyncProcess.prototype.test=original;};
    return true;
  })()`);
  try {
    for (const [diagnostic, message] of [
      [{ errorCode: 'ErrorCertificate', errorService: 'imap', errorAdvice: 'certificate validation failed' },
        '无法验证收信服务器的证书'],
      [{ errorCode: 'ErrorConnection', errorService: 'smtp', errorAdvice: 'outdated encryption' },
        '可在该服务器的高级设置中允许旧版 TLS'],
      [{ errorCode: 'ErrorConnection', errorService: 'imap', errorAdvice: 'outdated encryption' },
        '已允许旧版 TLS，请联系服务商更新加密设置'],
    ]) {
      await run(`window.prServerDiagnostic=${JSON.stringify(diagnostic)};true`);
      await connect.click();
      await page.getByRole('alert').filter({ hasText: message }).waitFor();
      assert.equal(await run('window.prServerValidatedPort'), 465);
      assert.equal(await field('smtp_port_custom').inputValue(), '465', 'failed validation preserves the custom draft');
    }
    const rejected = { service: 'smtp', host: fixture.settings.smtp_host, port: 465, sha256: 'a'.repeat(64), chain: [] };
    const certificateError = { errorCode: 'ErrorCertificate', certificates: [rejected] };
    const certificatePage = active.locator('.AccountCertificatePage');
    const titleBack = main.getByRole('button', { name: '返回上一步', exact: true });
    for (const retry of [false, true]) {
      await run(`window.prServerDiagnostic=${JSON.stringify(certificateError)};true`);
      await connect.click();
      await certificatePage.waitFor();
      assert.equal(await run('window.prServerValidatedPort'), 465);
      if (retry) {
        await run('window.prServerDiagnostic={errorCode:"ErrorConnection"};true');
        await certificatePage.getByRole('button', { name: 'Accept and Connect' }).click();
        await certificatePage.locator('.message.error').filter({ hasText: 'local diagnostic fixture' }).waitFor();
        assert.equal(await run('window.prServerValidatedPort'), 465);
      }
      await titleBack.click();
      assert.equal(await field('smtp_port').inputValue(), '0', 'certificate review preserves custom mode');
      assert.equal(await field('smtp_port_custom').inputValue(), '465', 'certificate review preserves the port draft');
    }
  } finally {
    await run('window.prRestoreServerValidation();true');
  }

  const result = { narrowLayout: true, stickyActions: true, keyboardOrder: true, advancedDisclosure: true,
    customPortValidation: true, blankPortIsIncomplete: true, customPortDraftRestored: true,
    certificateReviewPreservesDraft: true,
    portEncryptionIsolation: true, stableValidation: true,
    nativeSMTPRejection: true, skipsCollapsedFields: true, keyboardCustomPort: true, distinctTLSAdvice: true,
    noAccountsCreated: true, expectedSMTPSubmissions: 0 };
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('PASS server onboarding', JSON.stringify(result));
};
