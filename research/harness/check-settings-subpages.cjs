const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
module.exports = async ({main, cdp, account, evaluate, until}) => {
  const out = path.resolve(__dirname, '../subpages-validation-2026-11-16');
  fs.mkdirSync(out, {recursive:true});
  const run = s => evaluate(cdp,s), action = s => main.locator(s).first().click();
  const before = process.env.PAPER_REED_SUBPAGES_PHASE === 'before';
  const shot = async name => { await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'); const img = await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true}); fs.writeFileSync(path.join(out, `${before?'before':'after'}-${name}.png`),Buffer.from(img.data,'base64')); };
  await main.locator('.pr-sidebar button').filter({hasText:'设置'}).click();
  await until(()=>run('!!document.querySelector(".pr-preferences-nav")'),'settings navigation');
  for (const [id, selector] of [['General','.container-general'],['Accounts','.container-accounts'],['Shortcuts','.container-keymaps'],['Appearance','.container-appearance']]) {
    await action(`[data-settings-tab="${id}"]`);
    await until(()=>run(`!!document.querySelector(${JSON.stringify(selector)})`),id);
    await shot(id.toLowerCase());
    if(before) fs.writeFileSync(path.join(out,`before-${id.toLowerCase()}.txt`),await run(`document.querySelector(${JSON.stringify(selector)}).innerText`));
  }
  if(before) { console.log('PASS subpages baseline captures'); return; }
  await action('[data-settings-tab="General"]');
  const spell = '[id="core.composing.spellcheck"]';
  await until(()=>run('!!document.getElementById("core.composing.spellcheck")'),'writing controls');
  const oldSpell = await run('AppEnv.config.get("core.composing.spellcheck")');
  await main.locator(spell).focus(); await main.keyboard.press('Space');
  await until(()=>run(`AppEnv.config.get("core.composing.spellcheck")===${!oldSpell}`),'keyboard checkbox saved');
  assert(await run('document.activeElement.id === "core.composing.spellcheck"'));
  await main.keyboard.press('Space');
  await until(()=>run(`AppEnv.config.get("core.composing.spellcheck")===${oldSpell}`),'checkbox restored');
  await main.locator('.pr-general summary').filter({hasText:'阅读'}).click();
  await main.locator('[id="core.reading.markAsReadDelay"]').selectOption('2000');
  assert.equal(Number(await run('AppEnv.config.get("core.reading.markAsReadDelay")')),2000);
  await action('[data-settings-tab="Accounts"]');
  await action('#account-label'); await main.keyboard.press('Meta+A'); await main.keyboard.insertText('工作 · Paper Reed');
  await action('#account-sender-name');
  await until(()=>run(`require('mailspring-exports').AccountStore.accountForId(${JSON.stringify(account.id)}).label === '工作 · Paper Reed'`),'account label saved');
  await main.locator('#account-color').fill('#997d67'); await action('#account-label');
  await until(()=>run(`require('mailspring-exports').AccountStore.accountForId(${JSON.stringify(account.id)}).color === '#997d67'`),'account color saved');
  assert.equal(await run('getComputedStyle(document.querySelector(".pr-account-monogram")).borderTopColor'),'rgb(153, 125, 103)');
  await shot('account-identity');
  assert(await run(`document.querySelector('.pr-account-add').compareDocumentPosition(
    document.querySelector('.account-list')) & Node.DOCUMENT_POSITION_FOLLOWING`));
  const reconnect=main.getByRole('button',{name:'更新连接设置…'});
  await reconnect.focus();
  assert(await run('document.activeElement.textContent.trim()==="更新连接设置…"'));
  await run(`window.prOriginalDialog=require('@electron/remote').dialog.showMessageBoxSync;
    require('@electron/remote').dialog.showMessageBoxSync=(_, options)=>{window.prRemoveDialog=options;return options.cancelId;};true`);
  try {
    const remove=main.getByRole('button',{name:'移除账号…'});
    await remove.focus();
    await main.keyboard.press('Enter');
    assert(await run(`window.prRemoveDialog.message.includes(${JSON.stringify(account.emailAddress)}) &&
      window.prRemoveDialog.defaultId===window.prRemoveDialog.cancelId &&
      window.prRemoveDialog.buttons[window.prRemoveDialog.defaultId]==="取消" &&
      window.prRemoveDialog.detail.includes("这是最后一个账号")`));
    assert(await run(`!!require('mailspring-exports').AccountStore.accountForId(${JSON.stringify(account.id)})`));
    await shot('account-actions');
  } finally {
    await run(`require('@electron/remote').dialog.showMessageBoxSync=window.prOriginalDialog;true`);
  }
  await action('[data-settings-tab="Shortcuts"]');
  await until(()=>run('!!document.querySelector("#pr-shortcut-search")'),'shortcut search');
  const search = '#pr-shortcut-search';
  await main.locator(search).fill('zzzznothing');
  await until(()=>run('!!document.querySelector(".pr-settings-empty")'),'empty search'); await shot('shortcuts-empty');
  await action('.pr-settings-empty button');
  assert.equal(await main.locator(search).inputValue(),'');
  await main.locator(search).fill('composer:send-message');
  await until(()=>run('document.querySelectorAll(".pr-keymaps .shortcut").length===1'),'filtered shortcut');
  await shot('shortcut-search');
  const originalPreset=await main.locator('#pr-keymap-preset').inputValue();
  const otherPreset=await run(`Array.from(document.querySelector('#pr-keymap-preset').options).find(o=>o.value!==${JSON.stringify(originalPreset)}).value`);
  await main.locator('#pr-keymap-preset').selectOption(otherPreset);
  await until(()=>run(`AppEnv.config.get('core.keymapTemplate')===${JSON.stringify(otherPreset)}`),'preset saved');
  await main.locator('#pr-keymap-preset').selectOption(originalPreset);
  const keymap = () => run(`(()=>{const fs=require('fs'),p=AppEnv.keymaps.getUserKeymapPath();return fs.existsSync(p)?fs.readFileSync(p,'utf8'):'{}';})()`);
  const oldKeymap = await keymap();
  await main.locator('.pr-keymaps .shortcut').focus();
  assert(!await run('!!document.querySelector(".shortcut.editing")'));
  await main.keyboard.press('Enter'); await until(()=>run('!!document.querySelector(".shortcut.editing")'),'keyboard edit activated');
  await main.keyboard.press('Escape'); await until(()=>run('!document.querySelector(".shortcut.editing")'),'keyboard edit canceled');
  assert.equal(await keymap(),oldKeymap);
  await main.keyboard.press('Enter'); await main.keyboard.press('Meta+Shift+Y');
  await until(async()=>(JSON.parse(await keymap())['composer:send-message'] || '').split('+').sort().join('+')==='mod+shift+y','custom shortcut persisted');
  await main.locator(search).fill('');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:900,height:700,deviceScaleFactor:1,mobile:false});
  for (const id of ['General','Accounts','Shortcuts']) {
    await action(`[data-settings-tab="${id}"]`);
    await until(()=>run('!!document.querySelector(".pr-settings-page")'),id+' compact');
    await shot('compact-'+id.toLowerCase());
    assert(await run(`(()=>{const e=document.querySelector('.pr-settings-page');return e.scrollWidth<=e.clientWidth+1 && e.getBoundingClientRect().right<=innerWidth;})()`),id+' overflow');
  }
  await action('[data-settings-tab="Accounts"]');
  assert.equal(await main.locator('#account-label').inputValue(),'工作 · Paper Reed');
  await action('[data-settings-tab="General"]');
  await run(`require('mailspring-exports').Actions.updateAccount(${JSON.stringify(account.id)}, { syncState: 'invalid' });true`);
  await action('[data-settings-tab="Accounts"]');
  const notice=main.getByRole('region',{name:'连接状态'});
  await notice.getByRole('button',{name:'重新连接…'}).focus();
  await main.keyboard.press('Tab');
  assert(await run('document.activeElement.textContent.trim()==="查看错误详情…"'));
  await notice.scrollIntoViewIfNeeded();
  await shot('compact-auth-error');
  await main.getByRole('button',{name:'移除账号…'}).focus();
  await shot('compact-account-actions');
  const result={accountAddBeforeList:true, accountActionsFocusable:true, accountRemoveConfirmCancels:true,
    lastAccountConsequenceShown:true, connectionErrorKeyboardActions:true, generalKeyboardToggle:true,generalFocusRetained:true,readingSelectSaved:true,accountLabelSaved:true,accountColorSaved:true,accountColorPreview:true,shortcutPresetSaved:true,shortcutSearch:true,shortcutEmptyState:true,shortcutKeyboardCancel:true,shortcutKeyboardSaved:true,compactLayouts:true,expectedSMTPSubmissions:0};
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');
  console.log('PASS settings subpages',JSON.stringify(result));
};
