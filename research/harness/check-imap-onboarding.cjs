const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ phase, main, run, until, shot, out }) => {
  const active = main.locator('.page-container:not([inert])');
  const form = active.locator('.AccountBasicSettingsForm');
  const name = form.locator('#name');
  const email = form.locator('#emailAddress');
  const password = form.locator('[id="settings.imap_password"]');
  const next = form.getByRole('button', { name: '下一步', exact: true });
  const manual = form.locator('[data-manual-setup]');
  const back = main.getByRole('button', { name: '返回上一步', exact: true });
  const google = form.locator('[data-use-google]');
  const paint = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');

  await active.locator('[data-provider=imap]').click();
  await active.and(main.locator('.alpha-fade-enter-done')).locator('#name').waitFor();
  await until(() => run('document.fonts.status==="loaded"'), 'IMAP form fonts');
  await shot(`${phase}-imap-desktop`);
  await run('require("@electron/remote").getCurrentWindow().setContentSize(420,500);true');
  await until(() => run('innerWidth===420 && innerHeight===500'), 'native IMAP window 420 × 500');
  await run('document.querySelector(".page-container:not([inert]) .page").scrollTop=0;true');
  await paint();
  await shot(`${phase}-imap-narrow`);
  if (phase === 'before') return;

  assert(await run(`(()=>{
    const page=document.querySelector('.page-container:not([inert]) .AccountBasicSettingsForm');
    const actions=[...page.querySelectorAll('button')].map(button=>button.getBoundingClientRect());
    return page.scrollWidth<=page.clientWidth+1 &&
      actions.length===2 && actions.every(rect=>rect.bottom<=innerHeight && rect.left>=0);
  })()`), 'both IMAP actions fit in the narrow window');
  assert(await run('document.activeElement.id==="name"'));
  const error = form.getByRole('alert');
  await next.click();
  assert.equal(await error.textContent(), '请填写发件人姓名。');
  await name.fill('Maya Chen');
  await name.press('Tab');
  assert(await run('document.activeElement.id==="emailAddress"'));
  await email.fill('invalid maya@example.test');
  await email.press('Enter');
  assert.equal(await email.getAttribute('aria-invalid'), 'true');
  assert.equal(await error.textContent(), '请填写完整的邮箱地址。');
  await email.fill('maya@example.test');
  await email.press('Tab');
  assert(await run('document.activeElement.id==="settings.imap_password"'));
  assert.equal(await password.getAttribute('type'), 'password');
  await manual.click();
  assert.equal(await password.getAttribute('aria-invalid'), 'true');
  assert(await run('document.activeElement.id==="settings.imap_password"'));
  await password.fill('fixture-password');

  await run(`(()=>{
    const helpers=require(AppEnv.getLoadSettings().resourcePath+'/internal_packages/onboarding/lib/onboarding-helpers');
    const original=helpers.expandAccountForSetup;
    window.prIMAP={calls:0};
    helpers.expandAccountForSetup=account=>new Promise((resolve,reject)=>{
      window.prIMAP.calls++;
      window.prIMAP.complete=host=>{
        if(!host) return reject(new Error('fixture failure'));
        account.settings.imap_host=host;
        account.settings.smtp_host=host;
        resolve({account,confirmServers:true});
      };
    });
    window.prIMAP.restore=()=>{helpers.expandAccountForSetup=original;};
    return true;
  })()`);
  try {
    const idle = await next.boundingBox();
    await next.focus();
    await main.keyboard.down('Enter');
    await main.keyboard.down('Enter');
    await main.keyboard.up('Enter');
    await until(() => run('window.prIMAP.calls===1'), 'one discovery request');
    assert.equal(await form.getByRole('status').textContent(), '正在查找邮件服务器…');
    assert.equal(await next.getAttribute('aria-disabled'), 'true');
    assert(await run('document.activeElement.type==="submit"'));
    const busy = await next.boundingBox();
    assert.deepEqual(busy, idle);
    await paint();
    await shot('after-imap-discovery');
    await run('window.prIMAP.complete();true');
    await error.filter({ hasText: '未能查找邮件服务器' }).waitFor();
    assert(await run('document.activeElement.type==="submit"'));
    await paint();
    await shot('after-imap-discovery-error');

    await next.click();
    await until(() => run('window.prIMAP.calls===2'), 'lookup can retry');
    await manual.click();
    const imapHost = active.locator('[id="settings.imap_host"]');
    assert.equal(await imapHost.inputValue(), '');
    await imapHost.fill('imap.example.test');
    await run('window.prIMAP.complete("imap.late.example.test");true');
    await paint();
    assert.equal(await imapHost.inputValue(), 'imap.example.test');
    await back.click();
    assert.equal(await email.inputValue(), 'maya@example.test');
    assert.equal(await password.inputValue(), 'fixture-password');
    await manual.click();
    assert.equal(await imapHost.inputValue(), 'imap.example.test', 'top Back preserves hand-entered settings');
    await imapHost.fill('imap.edited.example.test');
    await active.getByRole('button', { name: '返回', exact: true }).click();
    await manual.click();
    assert.equal(await imapHost.inputValue(), 'imap.edited.example.test', 'form Back also preserves hand-entered settings');
    await active.getByRole('button', { name: '返回', exact: true }).click();
    await email.fill('other@example.test');
    await manual.click();
    assert.equal(await imapHost.inputValue(), '');
    assert.equal(await active.locator('[id="settings.imap_username"]').inputValue(), 'other@example.test');
    await active.getByRole('button', { name: '返回', exact: true }).click();
    assert.equal(await run('window.prIMAP.calls'), 2, 'manual settings do not start discovery');

    await next.click();
    await until(() => run('window.prIMAP.calls===3'), 'discovery completes on the current page');
    await run('window.prIMAP.complete("mail.other-domain.test");true');
    const discoveryWarning = active.locator('.message.error').filter({ hasText: 'mail.other-domain.test' });
    await discoveryWarning.waitFor();
    await active.getByRole('button', { name: '返回', exact: true }).click();
    await manual.click();
    assert.equal(await imapHost.inputValue(), 'mail.other-domain.test');
    await discoveryWarning.waitFor();
    await active.getByRole('button', { name: '返回', exact: true }).click();
  } finally {
    await run('window.prIMAP.restore();true');
  }

  await email.fill('maya@autoconfig.example.test');
  await manual.click();
  await active.getByRole('button', { name: '返回', exact: true }).click();
  const autoconfig = `<clientConfig><emailProvider id="autoconfig.example.test">
    <incomingServer type="imap"><hostname>imap.autoconfig.example.test</hostname><port>993</port>
      <socketType>SSL</socketType><username>%EMAILADDRESS%</username></incomingServer>
    <outgoingServer type="smtp"><hostname>smtp.autoconfig.example.test</hostname><port>587</port>
      <socketType>STARTTLS</socketType><username>%EMAILLOCALPART%</username></outgoingServer>
  </emailProvider></clientConfig>`;
  await run(`(()=>{
    const dns=require('dns'), resolveMx=dns.resolveMx, fetch=window.fetch;
    dns.resolveMx=(_domain,callback)=>callback(null,[]);
    const fixtureURLs=[
      'https://autoconfig.autoconfig.example.test/mail/config-v1.1.xml',
      'https://autoconfig.example.xn--p1ai/mail/config-v1.1.xml',
    ];
    window.fetch=(url,...args)=>fixtureURLs.includes(url)
      ? Promise.resolve(new Response(${JSON.stringify(autoconfig)}))
      : fetch(url,...args);
    window.prRestoreAutoconfig=()=>{dns.resolveMx=resolveMx;window.fetch=fetch;};
    return true;
  })()`);
  try {
    await next.click();
    const smtp = setting => active.locator(`[id="settings.smtp_${setting}"]`);
    assert.equal(await smtp('host').inputValue(), 'smtp.autoconfig.example.test');
    assert.equal(await smtp('port').inputValue(), '587', 'manual defaults cannot override discovered SMTP port');
    assert.equal(await smtp('security').inputValue(), 'STARTTLS');
    assert.equal(await smtp('username').inputValue(), 'maya');
    await active.getByRole('button', { name: '返回', exact: true }).click();

    const idn = 'maya@example.xn--p1ai';
    await email.fill(`invalid ${idn}`);
    await manual.click();
    assert.equal(await email.getAttribute('aria-invalid'), 'true');
    await email.fill(idn);
    await manual.click();
    assert.equal(await run('document.querySelector(".page-container:not([inert]) #pr-imap-error")?.textContent || ""'),
      '', 'a Punycode top-level domain passes full-address validation');
    assert.equal(await smtp('host').inputValue(), '');
    assert.equal(await smtp('username').inputValue(), idn);
    await active.getByRole('button', { name: '返回', exact: true }).click();
    await next.click();
    assert.equal(await smtp('host').inputValue(), 'smtp.autoconfig.example.test');
    assert.equal(await smtp('port').inputValue(), '587');
    assert.equal(await smtp('username').inputValue(), 'maya');
    await active.getByRole('button', { name: '返回', exact: true }).click();
  } finally {
    await run('window.prRestoreAutoconfig();true');
  }

  await password.fill('');
  await next.click();
  assert.equal(await password.getAttribute('aria-invalid'), 'true');
  await email.fill('maya@gmail.com');
  assert.equal(await error.textContent(), '');
  await email.fill('maya@example.test');
  await name.fill('');
  await next.click();
  assert.equal(await name.getAttribute('aria-invalid'), 'true');
  await email.fill('maya@gmail.com');
  assert.equal(await error.textContent(), '');
  assert.equal(await name.getAttribute('aria-invalid'), null);
  await name.fill('Maya Chen');
  assert.equal(await password.count(), 0);
  assert.equal(await next.count(), 0);
  assert.equal(await manual.count(), 0);
  assert.equal(await google.count(), 1);
  await active.and(main.locator('.alpha-fade-enter-done')).locator('[data-use-google]').waitFor();
  await main.locator('.alpha-fade-exit').waitFor({ state: 'hidden' });
  await run('require("@electron/remote").getCurrentWindow().setContentSize(420,500);true');
  await until(() => run('innerWidth===420 && innerHeight===500'), 'Gmail path fits the narrow window');
  await paint();
  await shot('after-imap-google-handoff');
  await email.press('Enter');
  assert.equal(await active.locator('.pr-google-account').textContent(), 'maya@gmail.com');
  await back.click();
  assert.equal(await email.inputValue(), 'maya@gmail.com');
  assert.equal(await name.inputValue(), 'Maya Chen');
  assert.equal(await password.count(), 0);
  assert.equal(await run('require("mailspring-exports").AccountStore.accounts().length'), 0);

  const result = { narrowFormFits: true, invalidFieldsFocus: true, stableDiscoveryAction: true,
    failureCanRetry: true, manualCanSupersedeDiscovery: true, serverDraftScopedToMailbox: true,
    discoveryWarningRetained: true, autoconfigUsesDiscoveredSettings: true, punycodeTLD: true,
    googleHandoff: true, noAccountsCreated: true, expectedSMTPSubmissions: 0 };
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('PASS IMAP onboarding', JSON.stringify(result));
};
