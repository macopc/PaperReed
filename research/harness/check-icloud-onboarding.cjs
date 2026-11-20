const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ phase, app, main, run, until, shot, out, fixture, work }) => {
  const initialPassword = fixture.settings.imap_password;
  const active = main.locator('.page-container:not([inert])');
  const settled = active.and(main.locator('.alpha-fade-enter-done'));
  const name = active.locator('#name');
  const email = active.locator('#emailAddress');
  const password = active.locator('[id="settings.imap_password"]');
  const submit = active.getByRole('button', { name: '连接邮箱', exact: true });
  const servers = active.getByRole('button', { name: '服务器设置…' });
  const back = main.getByRole('button', { name: '返回上一步', exact: true });
  const alert = active.locator('#pr-icloud-error');
  const choose = () => active.locator('[data-provider=icloud]').click();
  const paint = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const narrow = async () => {
    await run('require("@electron/remote").getCurrentWindow().setContentSize(420,500);true');
    await until(() => run('innerWidth===420 && innerHeight===500'), 'native iCloud window 420 × 500');
    await paint();
  };
  const fill = async () => {
    await name.fill('Maya Chen');
    await email.fill('maya@example.test');
    await password.fill(initialPassword);
  };

  await choose();
  await settled.locator('#name').waitFor();
  await until(() => run('document.fonts.status==="loaded"'), 'iCloud form fonts');
  await shot(`${phase}-icloud-desktop`);
  await narrow();
  await shot(`${phase}-icloud-narrow`);
  if (phase === 'before') return;

  assert(await run('document.activeElement.id==="name"'));
  assert.equal(await password.getAttribute('type'), 'password');
  const help = active.getByRole('link', { name: '前往 Apple 账户' });
  assert.equal(await help.getAttribute('href'), 'https://account.apple.com/');
  assert(await run(`(()=>{
    const page=document.querySelector('.pr-icloud-setup');
    const submit=page.querySelector('[type=submit]').getBoundingClientRect();
    return page.scrollWidth<=page.clientWidth+1 && submit.bottom<=innerHeight && submit.left>=0;
  })()`), 'the action and form fit in the narrow window');
  await main.keyboard.press('Tab');
  assert(await run('document.activeElement.id==="emailAddress"'));
  await main.keyboard.press('Tab');
  assert(await run('document.activeElement.id==="settings.imap_password"'));
  await main.keyboard.press('Tab');
  assert(await run('document.activeElement.href==="https://account.apple.com/"'));

  const installProbe = (evaluate, useLocalValidation = false) => evaluate(`(()=>{
    const {shell}=require('electron');
    const {MailsyncProcess}=require('mailspring-exports');
    const test=MailsyncProcess.prototype.test;
    const probe=window.prICloud={opened:[], attempts:[], useLocalValidation:${useLocalValidation}};
    shell.openExternal=async url=>{
      probe.opened.push(url);
      if(probe.holdLink) await new Promise((_resolve,reject)=>{
        probe.rejectLink=()=>reject(new Error('fixture could not open browser'));
      });
    };
    MailsyncProcess.prototype.test=function(){
      const original=this.account;
      probe.attempts.push(original.toJSON());
      if(probe.useLocalValidation){
        this.account=original.clone();
        Object.assign(this.account.settings, ${JSON.stringify(fixture.settings)}, {
          imap_password: original.settings.imap_password,
          smtp_password: original.settings.smtp_password,
          smtp_verification: 'login',
        });
        return test.call(this).finally(()=>{this.account=original;});
      }
      return new Promise((resolve,reject)=>{
        probe.settle=diagnostic=>diagnostic?reject(Object.assign(new Error('local fixture'),diagnostic)):resolve();
      });
    };
    return true;
  })()`);
  await installProbe(run);
  await help.focus();
  await main.keyboard.down('Enter');
  await main.keyboard.down('Enter');
  await main.keyboard.up('Enter');
  await until(() => run('window.prICloud.opened.length===1'), 'Apple account link opens by keyboard', 2500);
  assert.deepEqual(await run('window.prICloud.opened'), ['https://account.apple.com/']);
  await submit.click();
  assert.equal(await alert.textContent(), '请填写发件人姓名。');
  assert(await run('document.activeElement.id==="name"'));
  await name.fill(' Maya Chen ');
  await email.fill('invalid maya@example.test');
  await email.press('Enter');
  assert.equal(await email.getAttribute('aria-invalid'), 'true');
  assert.equal(await alert.textContent(), '请填写完整的 iCloud 邮件地址。');
  assert.equal(await run('window.prICloud.attempts.length'), 0);

  await fill();
  await servers.click();
  const imapHost = active.locator('[id="settings.imap_host"]');
  const smtpPort = active.locator('[id="settings.smtp_port"]');
  const customSMTPPort = active.locator('[id="settings.smtp_port_custom"]');
  const smtpPassword = active.locator('[id="settings.smtp_password"]');
  const returnFromServers = async () => {
    await active.getByRole('button', { name: '返回', exact: true }).click();
    await settled.locator('.pr-icloud-setup').waitFor();
  };
  assert.equal(await imapHost.inputValue(), 'imap.mail.me.com');
  assert.equal(await smtpPort.inputValue(), '587');
  await imapHost.fill('imap.example.test');
  await smtpPort.selectOption('0');
  await customSMTPPort.fill(' 465 ');
  await back.click();
  await settled.locator('.pr-icloud-setup').waitFor();
  await servers.click();
  assert.equal(await smtpPort.inputValue(), '0', 'the iCloud title bar returns with the custom port draft');
  assert.equal(await customSMTPPort.inputValue(), ' 465 ');
  assert.equal(await customSMTPPort.getAttribute('aria-invalid'), 'true');
  assert.equal(await imapHost.inputValue(), 'imap.example.test');
  await customSMTPPort.fill('2525');
  await returnFromServers();
  assert.equal(await email.inputValue(), 'maya@example.test');
  assert.equal(await password.inputValue(), initialPassword);
  await password.fill('updated-iCloud-draft-password');
  await servers.click();
  assert.equal(await imapHost.inputValue(), 'imap.example.test', 'return must preserve the same mailbox IMAP host');
  assert.equal(await customSMTPPort.inputValue(), '2525');
  assert.equal(await password.inputValue(), 'updated-iCloud-draft-password');
  assert.equal(await smtpPassword.inputValue(), 'updated-iCloud-draft-password');
  await smtpPassword.fill('separate-SMTP-draft-password');
  await returnFromServers();
  await password.fill(initialPassword);
  await narrow();
  await run('window.prICloud.holdLink=true;true');
  await help.click();
  await until(() => run('!!window.prICloud.rejectLink'), 'Apple account link pending');
  const idle = await submit.boundingBox();
  await password.press('Enter');
  await until(() => run('window.prICloud.attempts.length===1'), 'first iCloud validation');
  assert.equal(await active.getByRole('status').textContent(), '正在验证 iCloud 邮件连接…');
  await main.keyboard.press('Enter');
  assert.equal(await run('window.prICloud.attempts.length'), 1);
  const busy = await submit.boundingBox();
  assert(Math.abs(idle.x - busy.x) < 1 && Math.abs(idle.y - busy.y) < 1 && idle.height === busy.height);
  await paint();
  await shot('after-icloud-connecting');
  const attempted = await run('window.prICloud.attempts[0]');
  assert.equal(attempted.name, 'Maya Chen');
  assert.equal(attempted.emailAddress, 'maya@example.test');
  assert.equal(attempted.settings.imap_host, 'imap.mail.me.com');
  assert.equal(attempted.settings.imap_port, 993);
  assert.equal(attempted.settings.imap_security, 'SSL / TLS');
  assert.equal(attempted.settings.imap_username, 'maya@example.test');
  assert.equal(attempted.settings.smtp_host, 'smtp.mail.me.com');
  assert.equal(attempted.settings.smtp_port, 587);
  assert.equal(attempted.settings.smtp_security, 'STARTTLS');
  assert.equal(attempted.settings.smtp_username, 'maya@example.test');
  assert.equal(attempted.settings.smtp_verification, 'login');
  assert.equal(attempted.settings.smtp_password, initialPassword);

  await run('window.prICloud.settle({errorCode:"ErrorAuthentication",errorService:"smtp"});true');
  await alert.filter({ hasText: 'iCloud 发信服务器拒绝了登录' }).waitFor();
  await run('window.prICloud.rejectLink();true');
  await paint();
  assert.match(await alert.textContent(), /iCloud 发信服务器拒绝了登录/);
  assert.equal(await active.locator('.pr-icloud-guide-error').textContent(), '');
  assert.equal(await password.getAttribute('aria-invalid'), 'true');
  assert.match(await password.getAttribute('aria-describedby'), /pr-icloud-error/);
  await until(() => run('document.activeElement.id==="settings.imap_password"'), 'password focus after failed authentication');
  await paint();
  const feedbackLayout = await run(`(()=>{
    const page=document.querySelector('.pr-icloud-setup');
    const error=document.getElementById('pr-icloud-error').getBoundingClientRect();
    const back=document.querySelector('.pr-onboarding-window-action.back');
    const rect=back.getBoundingClientRect();
    return {scrollTop:page.scrollTop,top:error.top,bottom:error.bottom,height:innerHeight,
      backClickable:back.contains(document.elementFromPoint(rect.x+rect.width/2,rect.y+rect.height/2))};
  })()`);
  assert(feedbackLayout.scrollTop===0 && feedbackLayout.top>=0 && feedbackLayout.bottom<=feedbackLayout.height &&
    feedbackLayout.backClickable, `narrow authentication feedback and Back fit: ${JSON.stringify(feedbackLayout)}`);
  await shot('after-icloud-rejected');

  for (const [diagnostic, message] of [
    [{ isNetworkError: true }, '网络连接中断。请检查网络后重试。'],
    [{ errorCode: 'ErrorConnection' }, '暂时无法连接 iCloud 邮件服务器。请检查网络，或稍后重试。'],
    [{ errorCode: 'ErrorConnection', errorAdvice: 'The server rejected the secure connection.' },
      '无法建立安全连接。请检查系统时间和网络设置后重试。'],
    [{ errorCode: 'ErrorCertificate', certificates: [{}] }, '无法建立安全连接。请检查系统时间和网络设置后重试。'],
    [{ errorCode: 'ErrorInvalidAccount' },
      '无法读取 iCloud 收件箱。请在 iCloud 网页版确认收件箱可用，再回来重试。'],
    [{ errorCode: 'ErrorNeedsConnectToWebmail' }, '请先在 iCloud 网页版确认邮件已开通，再回来连接。'],
  ]) {
    const count = await run('window.prICloud.attempts.length');
    await submit.click();
    await until(() => run(`window.prICloud.attempts.length===${count + 1}`), 'next iCloud validation');
    await run(`window.prICloud.settle(${JSON.stringify(diagnostic)});true`);
    await alert.filter({ hasText: message }).waitFor();
  }

  await servers.click();
  assert.equal(await imapHost.inputValue(), 'imap.example.test');
  assert.equal(await customSMTPPort.inputValue(), '2525');
  assert.equal(await password.inputValue(), initialPassword);
  assert.equal(await smtpPassword.inputValue(), 'separate-SMTP-draft-password');
  await returnFromServers();
  await email.fill('other@example.test');
  await servers.click();
  assert.equal(await imapHost.inputValue(), 'imap.mail.me.com');
  assert.equal(await smtpPort.inputValue(), '587');
  assert.equal(await active.locator('[id="settings.imap_username"]').inputValue(), 'other@example.test');
  assert.equal(await smtpPassword.inputValue(), initialPassword);
  await returnFromServers();
  await fill();
  console.log('PASS same-mailbox server drafts survive Back and direct validation; another address starts with presets');

  const attempts = await run('window.prICloud.attempts.length');
  await submit.click();
  await until(() => run(`window.prICloud.attempts.length===${attempts + 1}`), 'validation kept pending');
  await back.click();
  await active.locator('[data-provider=icloud]').waitFor();
  await until(() => run('document.activeElement.dataset.provider==="icloud"'), 'return focuses the iCloud choice');
  await run('window.prICloud.settle();true');
  await paint();
  assert.equal(await run('require("mailspring-exports").AccountStore.accounts().length'), 0);

  await choose();
  await fill();
  const originalAddress = 'Maya@example.test';
  await email.fill(originalAddress);
  await run('window.prICloud.useLocalValidation=true;true');
  await submit.click();
  const stored = await until(() => app.evaluate(() => global.application.config.get('accounts')?.[0]),
    'iCloud form validated through the local mail worker and saved');
  assert.equal(stored.emailAddress, originalAddress);
  assert.equal(stored.name, 'Maya Chen');
  assert.equal(stored.provider, 'icloud');
  assert.equal(stored.settings.imap_password, undefined);
  assert.equal(stored.settings.smtp_password, undefined);
  const findWindow = kind => app.windows().find(page => {
    const settings = new URL(page.url()).searchParams.get('loadSettings');
    return settings && JSON.parse(settings).windowType === kind;
  });
  const evaluateIn = async window => {
    const session = await app.context().newCDPSession(window);
    return async expression => {
      const result = await session.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
      assert.equal(result.exceptionDetails, undefined, JSON.stringify(result.exceptionDetails));
      return result.result.value;
    };
  };
  const mailWindow = await until(() => findWindow('default'), 'mail window after iCloud setup');
  const mailbox = await evaluateIn(mailWindow);
  await until(() => mailbox('!!globalThis.AppEnv?.config?.get("accounts")?.length'), 'saved account in the mail window');
  const openICloud = async (previous, sender, address, secret, useLocalValidation) => {
    await until(() => previous.isClosed(), 'previous iCloud setup closed');
    await mailbox('require("electron").ipcRenderer.send("command","application:add-account",{});true');
    const window = await until(() => findWindow('onboarding'), 'add-account window reopened');
    const evaluate = await evaluateIn(window);
    const page = window.locator('.page-container:not([inert])');
    await page.locator('[data-provider=icloud]').click();
    await page.locator('#name').fill(sender);
    await page.locator('#emailAddress').fill(address);
    await page.locator('[id="settings.imap_password"]').fill(secret);
    await installProbe(evaluate, useLocalValidation);
    return { window, evaluate, page };
  };
  const expectCredentials = async expected => assert.deepEqual(await mailbox(`(async()=>{
    const {AccountStore,KeyManager}=require('mailspring-exports');
    AppEnv.config.load();
    const account=AccountStore.accountForId(${JSON.stringify(stored.id)});
    const decrypted=await KeyManager.insertAccountSecrets(account);
    const keys=await KeyManager._getKeyHash();
    return {imap:decrypted.settings.imap_password===${JSON.stringify(expected)},
      smtp:decrypted.settings.smtp_password===${JSON.stringify(expected)},
      noExtraCaseKeys:Object.keys(keys).filter(key=>key.toLowerCase().startsWith('maya@example.test-'))
        .every(key=>key.startsWith(account.emailAddress+'-'))};
  })()`), { imap: true, smtp: true, noExtraCaseKeys: true });
  const openPreferencesReconnect = async (previous, useLocalValidation = false) => {
    await until(() => previous.isClosed(), 'previous reconnect closed');
    const tab = mailWindow.locator('[data-settings-tab="Accounts"]');
    if (!await tab.isVisible()) await mailWindow.locator('.pr-sidebar button').filter({ hasText: '设置' }).click();
    await tab.click();
    await mailWindow.locator('.pr-settings-account').filter({ hasText: originalAddress }).click();
    await mailWindow.getByRole('button', { name: '更新连接设置…', exact: true }).click();
    const window = await until(() => findWindow('onboarding'), 'Preferences reconnect window');
    const evaluate = await evaluateIn(window);
    const page = window.locator('.page-container:not([inert])');
    await page.locator('.AccountIMAPSettingsForm').waitFor();
    await installProbe(evaluate, useLocalValidation);
    return { window, evaluate, page };
  };
  await expectCredentials(initialPassword);

  // Re-enter through the picker with different local-part and domain casing.
  fs.writeFileSync(path.join(work, 'rotate-password'), '');
  await until(() => fs.existsSync(path.join(work, 'password-rotated')), 'local mail credentials rotated');
  const reopened = await openICloud(main, 'Maya Updated', 'maya@EXAMPLE.TEST', 'rotated-pass', true);
  await reopened.page.getByRole('button', { name: '连接邮箱', exact: true }).click();
  const records = await until(async () => {
    const accounts = await app.evaluate(() => global.application.config.get('accounts'));
    return accounts.some(account => account.name === 'Maya Updated') && accounts;
  }, 'same mailbox updated from the iCloud form');
  assert.equal(records.length, 1, 'changing only address case must not create a second account');
  assert.equal(records[0].id, stored.id);
  assert.equal(records[0].emailAddress, originalAddress);
  await expectCredentials('rotated-pass');

  const readAccounts = () => app.evaluate(() => global.application.config.get('accounts'));
  const normalReconnect = await openPreferencesReconnect(reopened.window, true);
  await normalReconnect.page.locator('[id="settings.imap_username"]').fill('fixture-imap-login');
  await normalReconnect.page.locator('.AccountIMAPSettingsForm').getByRole('button', { name: '连接邮箱', exact: true }).click();
  await until(() => normalReconnect.window.isClosed(), 'normal Preferences reconnect complete');
  const updated = await readAccounts();
  assert.equal(updated.length, 1);
  assert.equal(updated[0].id, stored.id);
  assert.equal(updated[0].settings.imap_username, 'fixture-imap-login');
  await expectCredentials('rotated-pass');

  // Keep another account so removing the original does not reset the test application.
  await mailbox(`(async()=>{
    const {Account,AccountStore}=require('mailspring-exports');
    await AccountStore.addAccount(new Account({id:'fixture-other-mailbox',name:'Other',
      emailAddress:'other@example.test',provider:'imap',settings:${JSON.stringify(fixture.settings)}}));
    return true;
  })()`);
  const advanced = await openICloud(normalReconnect.window, 'Maya Pending', 'maya@EXAMPLE.TEST', 'stale-app-password', false);
  await advanced.page.getByRole('button', { name: '服务器设置…' }).click();
  const noICloudKeys = () => mailbox(`(async()=>{
    const keys=await require('mailspring-exports').KeyManager._getKeyHash();
    return Object.keys(keys).every(key=>!key.toLowerCase().startsWith('maya@example.test-'));
  })()`);
  const removeOriginal = async () => {
    await mailbox(`require('mailspring-exports').Actions.removeAccount(${JSON.stringify(stored.id)});true`);
    await until(async () => (await readAccounts()).every(account => account.id !== stored.id), 'other window removed iCloud account');
    await until(noICloudKeys, 'removed iCloud credentials cleared');
  };
  const assertStillRemoved = async label => {
    assert.deepEqual((await readAccounts()).map(account => account.id), ['fixture-other-mailbox'],
      `${label} must not restore a removed account`);
    assert(await noICloudKeys(), `${label} must not restore removed credentials`);
  };
  await mailbox(`(()=>{
    const removeId=${JSON.stringify(stored.id)};
    const bridge=AppEnv.mailsyncBridge;
    const reset=bridge.resetCacheForAccount.bind(bridge);
    bridge.resetCacheForAccount=(account,options)=>account.id===removeId?Promise.resolve():reset(account,options);
    return true;
  })()`);
  const checkRemovedDuringReconnect = async (setup, label, viaCertificate = false) => {
    await setup.evaluate(`(()=>{
      window.prICloudSaveErrors=[];
      AppEnv.showErrorDialog=options=>window.prICloudSaveErrors.push(options.message);
      return true;
    })()`);
    await setup.page.locator('.AccountIMAPSettingsForm').getByRole('button', { name: '连接邮箱', exact: true }).click();
    await until(() => setup.evaluate('window.prICloud.attempts.length===1'), `${label} validation pending`);
    if (viaCertificate) {
      const fingerprint = 'ab'.repeat(32);
      const diagnostic = { errorCode: 'ErrorCertificate', certificates: [
        { service: 'imap', host: 'imap.mail.me.com', port: 993, sha256: fingerprint, chain: [] },
      ] };
      await setup.evaluate(`window.prICloud.settle(${JSON.stringify(diagnostic)});true`);
      await setup.page.locator('.AccountCertificatePage').getByRole('button', { name: '修复后重新验证' }).click();
      await until(() => setup.evaluate('window.prICloud.attempts.length===2'), 'accepted certificate validation pending');
      assert.equal(await setup.evaluate('window.prICloud.attempts[1].settings.imap_certificate_sha256'), undefined,
        'reviewed fingerprints do not become trust settings on a reconnect');
    }
    await removeOriginal();
    await setup.evaluate('window.prICloud.settle();true');
    await until(async () => setup.window.isClosed() || await setup.evaluate('window.prICloudSaveErrors.length>0'),
      `${label} save settled`);
    await assertStillRemoved(label);
    assert(!setup.window.isClosed(), 'the removed-record warning must leave setup open');
    assert.deepEqual(await setup.evaluate('window.prICloudSaveErrors'),
      ['此邮箱账号已变更。请关闭此窗口后重新连接。']);
    console.log(`PASS ${label} rejects validation after deletion`);
  };
  await checkRemovedDuringReconnect(advanced, 'advanced iCloud reconnect');

  // Restore the disposable mailbox between independent deletion checks.
  const closeAndRestoreOriginal = async setup => {
    await setup.evaluate('setTimeout(()=>AppEnv.close(),0);true');
    await until(() => setup.window.isClosed(), 'previous reconnect closed');
    await mailbox(`(async()=>{
      const {Account,AccountStore}=require('mailspring-exports');
      const account=new Account({}).fromJSON(${JSON.stringify(records[0])});
      Object.assign(account.settings,{imap_password:'rotated-pass',smtp_password:'rotated-pass'});
      await AccountStore.addAccount(account);
      return true;
    })()`);
  };
  let previous = advanced;
  for (const certificate of [false, true]) {
    await closeAndRestoreOriginal(previous);
    previous = await openPreferencesReconnect(previous.window);
    await checkRemovedDuringReconnect(previous,
      certificate ? 'Preferences reconnect after certificate acceptance' : 'Preferences reconnect', certificate);
  }

  const checkRemovedRetry = async (setup, label) => {
    const completedAttempts = await setup.evaluate('window.prICloud.attempts.length');
    const retried = setup.page.getByRole('button', { name: '连接邮箱', exact: true });
    await retried.click();
    await until(() => setup.evaluate(`(() => {
      if (document.getElementById('pr-icloud-error')?.textContent?.includes('此邮箱账号已移除')) return 'removed';
      if (window.prICloud.attempts.length > ${completedAttempts}) return 'validating';
      return false;
    })()`), `${label} produced feedback or started validation`);
    // On the vulnerable version, permit the unintended validation to finish to expose the resurrection.
    if (await setup.evaluate(`window.prICloud.attempts.length > ${completedAttempts}`)) {
      await setup.evaluate('window.prICloud.settle();true');
      await until(() => setup.window.isClosed(), `${label} completed the unintended save`);
    }
    await assertStillRemoved(label);
    assert(!setup.window.isClosed());
    assert.equal(await setup.page.locator('#pr-icloud-error').textContent(),
      '此邮箱账号已移除。请返回邮箱选择后重新添加，或填写另一个邮箱。');
    assert.equal(await setup.evaluate('document.activeElement.id'), 'emailAddress');
    console.log(`PASS ${label} blocks a new save after deletion`);
  };

  await closeAndRestoreOriginal(previous);
  const returning = await openICloud(previous.window, 'Maya Retry', 'maya@EXAMPLE.TEST', 'stale-app-password', false);
  await returning.page.getByRole('button', { name: '服务器设置…' }).click();
  await returning.page.locator('.AccountIMAPSettingsForm').waitFor();
  await removeOriginal();
  await returning.window.getByRole('button', { name: '返回上一步', exact: true }).click();
  await returning.page.locator('#emailAddress').fill('MAYA@example.test');
  await checkRemovedRetry(returning, 'returning from iCloud server settings');

  await closeAndRestoreOriginal(returning);
  const beforeSubmit = await openICloud(returning.window, 'Maya Retry', 'maya@EXAMPLE.TEST', 'stale-app-password', false);
  await removeOriginal();
  await checkRemovedRetry(beforeSubmit, 'deleting a matched iCloud account before the first submission');

  await closeAndRestoreOriginal(beforeSubmit);
  const retrying = await openICloud(beforeSubmit.window, 'Maya Retry', 'maya@EXAMPLE.TEST', 'stale-app-password', false);
  await retrying.page.getByRole('button', { name: '连接邮箱', exact: true }).click();
  await until(() => retrying.evaluate('window.prICloud.attempts.length===1'), 'first direct attempt pending');
  await retrying.evaluate('window.prICloud.settle({errorCode:"ErrorAuthentication"});true');
  await retrying.page.locator('#pr-icloud-error').filter({ hasText: 'iCloud 拒绝了登录' }).waitFor();
  await removeOriginal();
  await retrying.page.locator('[id="settings.imap_password"]').fill('retry-app-password');
  await checkRemovedRetry(retrying, 'retrying iCloud after failed authentication');

  await retrying.page.locator('#emailAddress').fill('another-icloud@example.test');
  await retrying.page.locator('[id="settings.imap_password"]').fill('rotated-pass');
  await retrying.evaluate('window.prICloud.useLocalValidation=true;true');
  await retrying.page.getByRole('button', { name: '连接邮箱', exact: true }).click();
  await until(() => retrying.window.isClosed(), 'a different iCloud mailbox can be added from the form');
  assert.deepEqual((await readAccounts()).map(account => account.emailAddress),
    ['other@example.test', 'another-icloud@example.test']);
  assert(await noICloudKeys(), 'adding another mailbox does not restore the removed address keys');

  const lowerAddress = originalAddress.toLowerCase();
  const lowerId = 'fixture-icloud-lowercase';
  await mailbox(`(async()=>{
    const {Account,AccountStore}=require('mailspring-exports');
    const upper=new Account({}).fromJSON(${JSON.stringify(records[0])});
    Object.assign(upper.settings,{imap_password:'fixture-upper',smtp_password:'fixture-upper'});
    const lower=upper.clone();
    Object.assign(lower,{id:${JSON.stringify(lowerId)},emailAddress:${JSON.stringify(lowerAddress)},name:'Lower'});
    Object.assign(lower.settings,{imap_password:'fixture-lower',smtp_password:'fixture-lower'});
    await AccountStore.addAccount(upper);
    await AccountStore.addAccount(lower);
    return true;
  })()`);
  const expectCaseCredentials = async (upper, lower) => assert.deepEqual(await mailbox(`(async()=>{
    const keys=await require('mailspring-exports').KeyManager._getKeyHash();
    return [keys[${JSON.stringify(originalAddress + '-imap')}] ?? null,
      keys[${JSON.stringify(originalAddress + '-smtp')}] ?? null,
      keys[${JSON.stringify(lowerAddress + '-imap')}] ?? null,
      keys[${JSON.stringify(lowerAddress + '-smtp')}] ?? null];
  })()`), [upper, upper, lower, lower]);

  const selectExactCase = async setup => {
    await setup.page.locator('#emailAddress').fill(lowerAddress);
    await setup.page.getByRole('button', { name: '连接邮箱', exact: true }).click();
    await until(() => setup.evaluate('window.prICloud.attempts.length===1'), 'exact spelling reached validation');
    const attempted = await setup.evaluate('window.prICloud.attempts[0]');
    assert.deepEqual({ id: attempted.id, address: attempted.emailAddress }, { id: lowerId, address: lowerAddress },
      'exact iCloud address must take precedence over a remembered case variant');
    await setup.evaluate('window.prICloud.settle();true');
    await until(() => setup.window.isClosed(), 'exact iCloud record updated');
  };
  const bothPresent = await openICloud(retrying.window, 'Lower Reconnected', originalAddress, 'fixture-lower-renewed', false);
  await selectExactCase(bothPresent);
  assert.equal((await readAccounts()).find(record => record.id === stored.id).name, records[0].name);
  assert.equal((await readAccounts()).find(record => record.id === lowerId).name, 'Lower Reconnected');
  await expectCaseCredentials('fixture-upper', 'fixture-lower-renewed');

  const upperRemoved = await openICloud(bothPresent.window, 'Lower After Removal', originalAddress, 'fixture-lower-after-removal', false);
  await upperRemoved.page.locator('#emailAddress').fill('mAyA@EXAMPLE.TEST');
  await upperRemoved.page.getByRole('button', { name: '连接邮箱', exact: true }).click();
  await upperRemoved.page.locator('#pr-icloud-error').filter({ hasText: '此地址匹配到多个账号' }).waitFor();
  assert.equal(await upperRemoved.evaluate('window.prICloud.attempts.length'), 0);
  assert.equal(await upperRemoved.evaluate('document.activeElement.id'), 'emailAddress');

  // The remembered spelling still protects its own removed record, but must not shadow the other.
  await mailbox(`require('mailspring-exports').Actions.removeAccount(${JSON.stringify(stored.id)});true`);
  await until(async () => !(await readAccounts()).some(record => record.id === stored.id), 'remembered case variant removed');
  await until(() => mailbox(`require('mailspring-exports').KeyManager.getPassword(${JSON.stringify(originalAddress + '-imap')}).then(value=>!value)`),
    'remembered case variant credentials cleared');
  await upperRemoved.page.locator('#emailAddress').fill(originalAddress);
  await upperRemoved.page.getByRole('button', { name: '连接邮箱', exact: true }).click();
  await upperRemoved.page.locator('#pr-icloud-error').filter({ hasText: '此邮箱账号已移除' }).waitFor();
  assert.equal(await upperRemoved.evaluate('window.prICloud.attempts.length'), 0);
  await selectExactCase(upperRemoved);
  assert.equal((await readAccounts()).find(record => record.id === lowerId).name, 'Lower After Removal');
  assert(!(await readAccounts()).some(record => record.id === stored.id));
  await expectCaseCredentials(null, 'fixture-lower-after-removal');
  console.log('PASS exact spelling selects the corresponding iCloud account with or without the remembered variant');

  const result = { narrowFormFits: true, keyboardOrder: true, appleGuide: true, invalidFields: true,
    serverSettingsRetained: true, titleBarRetainsServerDraft: true, serverDraftScopedToMailbox: true,
    secureDefaults: true, duplicateValidationBlocked: true,
    stableAction: true, localizedDiagnostic: true, passwordFocusRestored: true, staleResultDiscarded: true,
    localValidationAndEncryptedSave: true, addressCaseReconnect: true, tlsHandshakeGuidance: true,
    lateBrowserFailureIgnored: true, deletedAccountNotRestoredFromServers: true,
    preferencesReconnectPreservesId: true, deletedAccountNotRestoredFromPreferences: true,
    deletedAccountNotRestoredFromCertificate: true,
    deletedAccountNotRestoredAfterBack: true, deletedAccountNotRestoredBeforeSubmit: true,
    deletedAccountNotRestoredAfterRetry: true,
    canAddDifferentMailboxAfterRemoval: true,
    exactSpellingSelectsCorrectAccount: true, ambiguousSpellingRequiresCorrection: true,
    expectedSMTPSubmissions: 0 };
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('PASS iCloud onboarding', JSON.stringify(result));
};
