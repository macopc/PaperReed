const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ main, cdp, evaluate, until, work, restartDesktop }) => {
  const out = path.resolve(__dirname, '../subpages-validation-2026-11-16');
  fs.mkdirSync(out, { recursive: true });
  const before = process.env.PAPER_REED_SUBPAGES_PHASE === 'before';
  const prefix = before ? 'before' : 'after';
  const run = (expression) => evaluate(cdp, expression);
  const page = main.locator('.pr-general');
  const section = (label) => `[...document.querySelectorAll('.pr-general summary')].find(el=>el.textContent.trim()===${JSON.stringify(label)}).parentElement`;
  const expand = async (label, block = 'nearest') => {
    if (!(await run(`${section(label)}.open`))) await page.locator('summary').filter({ hasText: label }).click();
    await run(`${section(label)}.scrollIntoView({block:${JSON.stringify(block)}});true`);
  };
  const shot = async (name) => {
    await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(out, `${prefix}-general-${name}.png`), Buffer.from(data, 'base64'));
  };
  const scrollTop = () => run('document.querySelector(".preferences-content .scroll-region-content").scrollTop=0;true');
  const narrow = async () => {
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await run('require("@electron/remote").getCurrentWindow().setContentSize(740,700);true');
    await until(() => run('innerWidth===740 && innerHeight===700'), 'native 740 × 700 settings window');
  };

  await main.getByRole('button', { name: '设置', exact: true }).click();
  await main.locator('[data-settings-tab="General"]').click();
  await page.waitFor();
  await scrollTop();
  await shot('desktop');
  await narrow();
  await scrollTop();
  await shot('narrow');
  await expand('发送', 'start');
  await shot('sending');
  await expand('本机数据', 'end');
  await shot('local-data');
  if (before) {
    console.log('PASS General settings baseline at 1440 and native 740');
    return;
  }

  assert.equal(await page.locator('summary').count(), 7);
  const id = (value) => page.locator(`[id=${JSON.stringify(value)}]`);
  const active = (value) => run(`document.activeElement.id===${JSON.stringify(value)}`);
  const optionLabels = (value) => run(`[...document.getElementById(${JSON.stringify(value)}).options].map(o=>o.textContent.trim())`);
  const spell = 'core.composing.spellcheck';
  const oldSpell = await run(`AppEnv.config.get(${JSON.stringify(spell)})`);
  await id(spell).focus();
  await main.keyboard.press('Space');
  await until(() => run(`AppEnv.config.get(${JSON.stringify(spell)})===${!oldSpell}`), 'keyboard changes spelling setting');
  assert(await active(spell));
  await main.keyboard.press('Space');
  await until(() => run(`AppEnv.config.get(${JSON.stringify(spell)})===${oldSpell}`), 'spelling setting restored');

  await page.locator('summary').filter({ hasText: '阅读' }).focus();
  await main.keyboard.press('Enter');
  assert(await run(`${section('阅读')}.open`));
  const delay = 'core.reading.markAsReadDelay';
  const delayPicker = id(delay);
  const previousDelay = await delayPicker.inputValue();
  const nextDelay = previousDelay === '2000' ? '500' : '2000';
  assert.deepEqual(await optionLabels(delay), ['立即', '0.5 秒后', '2 秒后', '手动标为已读']);
  await delayPicker.focus();
  await delayPicker.selectOption(nextDelay);
  assert.equal(String(await run(`AppEnv.config.get(${JSON.stringify(delay)})`)), nextDelay);
  assert(await active(delay));
  await delayPicker.selectOption(previousDelay);

  assert.deepEqual(await optionLabels('core.sending.defaultSendType'), ['发送', '发送并归档']);
  assert.deepEqual(await optionLabels('core.sending.defaultReplyType'), ['回复', '回复全部']);
  const account = id('core.sending.defaultAccountIdForSend');
  assert.equal(await account.locator('option').first().textContent(), '自动选择');
  const noteId = await account.getAttribute('aria-describedby');
  const senderNote = await id(noteId).textContent();
  assert.match(senderNote, /全部邮箱.*独立写信窗口.*优先使用所选账号/);
  assert.match(senderNote, /单邮箱内的「写邮件」使用当前账号/);
  assert.match(senderNote, /「自动选择」时会用首个账号.*回复沿用原邮件账号/);
  assert(await run(`(() => {
    const selects=[...${section('发送')}.querySelectorAll('select')].map(el=>el.getBoundingClientRect());
    const page=document.querySelector('.pr-settings-page');
    return selects.length===4 && selects.every(el=>el.height>=34 && Math.abs(el.right-selects[0].right)<1)
      && page.scrollWidth<=page.clientWidth+1;
  })()`));
  const warnings = page.getByRole('button', { name: '恢复收件人警告' });
  await run(`localStorage.setItem('recipientWarningBlacklist', ${JSON.stringify(JSON.stringify(['local@example.test']))});true`);
  await warnings.focus();
  await main.keyboard.press('Enter');
  assert.equal(await run('localStorage.getItem("recipientWarningBlacklist")'), null);
  assert.equal(await page.getByRole('status').textContent(), '已恢复收件人警告');
  await shot('recipient-warning');

  await run(`(() => {
    const remote=require('@electron/remote');
    const ipc=require('electron').ipcRenderer;
    const fs=require('fs');
    const originals={dialog:remote.dialog.showMessageBoxSync, send:ipc.send, rm:fs.rm,
      relaunch:remote.app.relaunch, quit:remote.app.quit};
    const actions={warnings:[], cacheResets:0, configResets:0, relaunch:0, quit:0, confirm:false};
    window.prGeneralActions=actions;
    remote.dialog.showMessageBoxSync=(parent, options)=>{
      actions.warnings.push({options, bound:parent.id===remote.getCurrentWindow().id});
      return actions.confirm ? 1 : 0;
    };
    ipc.send=(channel, ...args)=>{
      if(channel==='command' && args[0]==='application:reset-database') { actions.cacheResets++; return; }
      return originals.send.call(ipc, channel, ...args);
    };
    fs.rm=(dir, options, callback)=>{
      if(dir===AppEnv.getConfigDirPath()) { actions.configResets++; callback(null); return; }
      return originals.rm.call(fs,dir,options,callback);
    };
    remote.app.relaunch=()=>{actions.relaunch++;};
    remote.app.quit=()=>{actions.quit++;};
    window.prRestoreGeneralActions=()=>{
      remote.dialog.showMessageBoxSync=originals.dialog;ipc.send=originals.send;fs.rm=originals.rm;
      remote.app.relaunch=originals.relaunch;remote.app.quit=originals.quit;
    };
    return true;
  })()`);
  try {
    const cache = page.getByRole('button', { name: '重建邮件缓存…' });
    const reset = page.getByRole('button', { name: '重置账号与设置…' });
    for (const [button, message] of [[cache, '重建邮件缓存？'], [reset, '重置账号与设置？']]) {
      await button.focus();
      await main.keyboard.press('Enter');
      const warning = await run('window.prGeneralActions.warnings.at(-1)');
      assert(warning.bound);
      assert.equal(warning.options.message, message);
      assert.equal(warning.options.defaultId, warning.options.cancelId);
      assert.equal(warning.options.buttons[warning.options.defaultId], '取消');
      assert.match(warning.options.detail, /本机规则、标签、置顶、稍后处理和手动分类会被清除/);
      assert.match(warning.options.detail, /尚未同步的草稿.*可能丢失.*服务商上的邮件会保留/);
      assert.equal(await run('document.activeElement.textContent.trim()'), (await button.textContent()).trim());
    }
    const canceled = await run('window.prGeneralActions');
    assert.equal(canceled.cacheResets, 0);
    assert.equal(canceled.configResets, 0);
    assert.match(canceled.warnings[1].options.detail, /快捷键.*签名、模板、Agent 连接.*附件、自定义词典和模型/);
    assert.match(canceled.warnings[1].options.detail, /重新添加账号并接入 Agent/);

    await run('window.prGeneralActions.confirm=true;true');
    await cache.focus();
    await main.keyboard.press('Enter');
    assert.equal(await run('window.prGeneralActions.cacheResets'), 1);
    assert.equal(await run('window.prGeneralActions.configResets'), 0);
    await reset.focus();
    await main.keyboard.press('Enter');
    const confirmed = await run('window.prGeneralActions');
    assert.equal(confirmed.cacheResets, 1);
    assert.equal(confirmed.configResets, 1);
    assert.equal(confirmed.relaunch, 1);
    assert.equal(confirmed.quit, 1);

    await expand('界面语言', 'end');
    const language = id('interface-language');
    const oldLanguage = await language.inputValue();
    const current = await run("require('mailspring-exports').getAvailableLanguages().current.key");
    const alternative = current === 'fr' ? 'de' : 'fr';
    await language.focus();
    await language.selectOption(alternative);
    assert.equal(await run('AppEnv.config.get("core.intl.language")'), alternative);
    assert(await active('interface-language'));
    await main.keyboard.press('Tab');
    assert(await run('document.activeElement.textContent.trim()==="重启以应用"'));
    await shot('language-pending-restart');
    await main.keyboard.press('Enter');
    assert.equal(await run('window.prGeneralActions.relaunch'), 2);
    assert.equal(await run('window.prGeneralActions.quit'), 2);
    await language.selectOption(oldLanguage);
  } finally {
    await run('window.prRestoreGeneralActions();true');
  }

  const language = id('interface-language');
  await language.selectOption('en-gb');
  assert((await optionLabels('interface-language')).includes('English (United Kingdom)'));
  const configFile = path.join(work, 'config/config.json');
  await until(() => JSON.parse(fs.readFileSync(configFile, 'utf8'))['*'].core.intl?.language === 'en-gb', 'British English persisted for the actual restart');
  const relaunched = await restartDesktop();
  const afterRestart = (expression) => evaluate(relaunched.cdp, expression);
  assert.equal(await afterRestart("require('mailspring-exports').getCurrentLocale()"), 'en-gb');
  await relaunched.main.getByRole('button', { name: '设置', exact: true }).click();
  await relaunched.main.locator('[data-settings-tab="General"]').click();
  const reopened = relaunched.main.locator('.pr-general');
  await reopened.locator('summary').filter({ hasText: '界面语言' }).click();
  assert.equal(await reopened.locator('#interface-language').inputValue(), 'en-gb');
  assert.equal(await reopened.getByRole('button', { name: '重启以应用' }).count(), 0);

  const result = {
    narrowNative740: true,
    writingKeyboardFocus: true,
    readingSelectSaved: true,
    localizedSendingOptions: true,
    senderHelpDistinguishesComposeEntries: true,
    alignedSendingSelectors: true,
    recipientWarningsRestored: true,
    bothResetsDefaultToCancel: true,
    bothResetsDiscloseLocalDataLoss: true,
    confirmedResetsReachIntendedHandlers: true,
    languageKeyboardRelaunch: true,
    britishEnglishHasNoPendingRestart: true,
    expectedSMTPSubmissions: 0,
  };
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('PASS General settings', JSON.stringify(result));
};
