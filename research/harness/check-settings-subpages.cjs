const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');
module.exports = async ({main, cdp, account, evaluate, until, work, restartDesktop}) => {
  if (process.env.PAPER_REED_SUBPAGES_CHECK === 'general') {
    return require('./check-general-settings.cjs')({main, cdp, evaluate, until, work, restartDesktop});
  }
  if (process.env.PAPER_REED_SUBPAGES_CHECK === 'subscription') {
    return require('./check-subscription-settings.cjs')({main, cdp, evaluate, until});
  }
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
  if(before) {
    await action('[data-settings-tab="Shortcuts"]');
    await main.locator('#pr-shortcut-search').fill('composer:send-message');
    await main.locator('.pr-keymaps .shortcut').focus();
    await main.keyboard.press('Enter');
    await until(()=>run('!!document.querySelector(".shortcut.editing")'),'baseline keyboard edit activated');
    await shot('shortcut-recording');
    await main.keyboard.press('Escape');
    console.log('PASS subpages baseline captures');
    return;
  }
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
  const searchWidth=()=>run('document.querySelector("#pr-shortcut-search").getBoundingClientRect().width');
  const idleSearchWidth=await searchWidth();
  await main.locator(search).fill('zzzznothing');
  assert.equal(await searchWidth(),idleSearchWidth);
  await until(()=>run('!!document.querySelector(".pr-settings-empty")'),'empty search'); await shot('shortcuts-empty');
  await main.getByRole('button',{name:'清除搜索'}).click();
  assert.equal(await main.locator(search).inputValue(),'');
  assert(await run('document.activeElement.id==="pr-shortcut-search"'));
  await main.mouse.move(12,12);
  await main.locator(search).fill('取消选择');
  const sequence=await main.locator('.pr-keymaps .shortcut-value').first().innerText();
  assert.match(sequence,/→/);
  await main.locator(search).fill(sequence);
  await main.getByRole('button',{name:/^取消选择：/}).waitFor();
  await main.locator(search).fill('发送邮件');
  await until(()=>run('document.querySelectorAll(".pr-keymaps .shortcut").length===1'),'Chinese action search');
  assert.equal(await main.locator('.pr-keymaps .shortcut-name').innerText(),'发送邮件');
  await main.locator(search).fill('composer:send-message');
  await until(()=>run('document.querySelectorAll(".pr-keymaps .shortcut").length===1'),'filtered shortcut');
  await shot('shortcut-search');
  const displayedBinding=await main.locator('.pr-keymaps .shortcut-value').first().innerText();
  const displayedCommand=await main.locator('.pr-keymaps .shortcut-name').innerText();
  assert(displayedBinding.includes('⌘'));
  await main.locator(search).fill(displayedBinding);
  await until(()=>run(`[...document.querySelectorAll('.pr-keymaps .shortcut-name')].some(row=>row.textContent===${JSON.stringify(displayedCommand)})`),'visible key symbol search');
  await shot('shortcut-symbol-search');
  await main.locator(search).fill('composer:send-message');
  const originalPreset=await main.locator('#pr-keymap-preset').inputValue();
  await main.locator('#pr-keymap-preset').selectOption('Outlook');
  await until(()=>run(`AppEnv.config.get('core.keymapTemplate')==='Outlook'`),'preset saved');
  assert.equal(await main.locator('.pr-keymaps .shortcut-value').innerText(),displayedBinding);
  await main.locator('#pr-keymap-preset').selectOption(originalPreset);
  const keymap = () => run(`(()=>{const fs=require('fs'),p=AppEnv.keymaps.getUserKeymapPath();return fs.existsSync(p)?fs.readFileSync(p,'utf8'):'{}';})()`);
  const oldKeymap = await keymap();
  await main.locator(search).focus();
  await main.keyboard.press('Tab'); await main.keyboard.press('Tab');
  assert(await run('document.activeElement.matches(".pr-keymaps .shortcut:focus-visible")'));
  assert(!await run('!!document.querySelector(".shortcut.editing")'));
  await main.keyboard.press('Enter'); await until(()=>run('!!document.querySelector(".shortcut.editing")'),'keyboard edit activated');
  await main.locator('.pr-shortcut-recording').waitFor();
  await shot('shortcut-recording');
  await main.keyboard.press('Escape'); await until(()=>run('!document.querySelector(".shortcut.editing")'),'keyboard edit canceled');
  assert.equal(await keymap(),oldKeymap);
  await main.keyboard.press('Enter');
  await main.keyboard.down('Meta'); await main.keyboard.down('Enter');
  await main.keyboard.up('Meta'); await main.keyboard.down('Enter');
  assert.match(await main.locator('.pr-shortcut-recording').innerText(),/Enter 保存/);
  assert.equal(await keymap(),oldKeymap);
  await main.keyboard.up('Enter'); await main.keyboard.press('Escape');
  await main.keyboard.press('Enter'); await main.keyboard.press('y'); await main.keyboard.press('Enter');
  assert.match(await main.locator('.pr-shortcut-recording').innerText(),/Ctrl 组合键/);
  assert.equal(await keymap(),oldKeymap);
  await main.keyboard.press('Meta+C'); await main.keyboard.press('Enter');
  assert.match(await main.locator('.pr-shortcut-recording').innerText(),/避开编辑键/);
  assert.equal(await keymap(),oldKeymap);
  await main.keyboard.press('Meta+Shift+ArrowLeft'); await main.keyboard.press('Enter');
  assert.match(await main.locator('.pr-shortcut-recording').innerText(),/避开编辑键/);
  assert.equal(await keymap(),oldKeymap);
  for (const keys of ['Control+E', 'Control+Shift+E', 'Control+D', 'Meta+Shift+V']) {
    await main.keyboard.press(keys); await main.keyboard.press('Enter');
    assert.match(await main.locator('.pr-shortcut-recording').innerText(),/避开编辑键/);
    assert.equal(await keymap(),oldKeymap);
  }
  await main.keyboard.press('Meta+K'); await main.keyboard.press('Enter');
  assert.match(await main.locator('.pr-shortcut-recording').innerText(),/冲突/);
  assert.equal(await keymap(),oldKeymap);
  await shot('shortcut-conflict');
  await main.keyboard.press('Meta+Shift+Y');
  assert.match(await main.locator('.pr-shortcut-recording').innerText(),/Enter 保存/);
  assert.equal(await keymap(),oldKeymap);
  await shot('shortcut-pending');
  await action('.pr-shortcut-help');
  assert.equal(await keymap(),oldKeymap);
  assert(!await run('!!document.querySelector(".shortcut.editing")'));
  await main.locator('.pr-keymaps .shortcut').focus();
  await main.keyboard.press('Enter'); await main.keyboard.press('Meta+Shift+Y');
  await main.keyboard.down('Enter');
  await until(()=>run('!document.querySelector(".shortcut.editing")'),'confirmation closes shortcut recording');
  await main.keyboard.down('Enter');
  assert(!await run('!!document.querySelector(".shortcut.editing")'));
  await main.keyboard.up('Enter');
  await until(async()=>(JSON.parse(await keymap())['composer:send-message'] || '').split('+').sort().join('+')==='mod+shift+y','custom shortcut persisted');
  await until(()=>run('document.activeElement.matches(".pr-keymaps .shortcut:not(.editing)") && document.activeElement.getAttribute("aria-label").includes("Y")'),'focus stays on the saved command');
  await main.locator(search).fill('选择邮件');
  const selectMail=main.getByRole('button',{name:/^选择邮件：/});
  const oldSelectionBinding=await selectMail.locator('.shortcut-value').innerText();
  const savedSend=await keymap();
  await selectMail.focus();
  await main.keyboard.press('Enter'); await main.keyboard.press('g'); await main.keyboard.press('Enter');
  assert.match(await main.locator('.pr-shortcut-recording').innerText(),/前往收件箱.*冲突/);
  assert.equal(await keymap(),savedSend);
  await main.locator(search).fill('取消选择');
  await main.getByRole('button',{name:/^取消选择：/}).focus();
  await main.keyboard.press('Enter'); await main.keyboard.press('e'); await main.keyboard.press('n');
  await main.keyboard.press('Enter');
  assert.match(await main.locator('.pr-shortcut-recording').innerText(),/归档.*冲突/);
  assert.equal(await keymap(),savedSend);
  await main.locator(search).fill(oldSelectionBinding);
  await selectMail.focus();
  await main.keyboard.press('Enter'); await main.keyboard.press('4');
  assert.match(await main.locator('.pr-shortcut-recording').innerText(),/Enter 保存/);
  await main.keyboard.press('Enter');
  await until(async()=>JSON.parse(await keymap())['core:select-item']==='4','single-key edit saved with Enter');
  await until(()=>run('document.activeElement.id==="pr-shortcut-search"'),'focus returns to search when changed binding leaves results');
  await main.locator(search).fill('插入有序列表');
  await main.getByRole('button',{name:/^插入有序列表：/}).focus();
  await main.keyboard.press('Enter'); await main.keyboard.press('Meta+Shift+7');
  await main.keyboard.press('Enter');
  assert.equal(JSON.parse(await keymap())['contenteditable:numbered-list'].split('+').sort().join('+'),'7+mod+shift');
  await main.locator(search).fill('添加附件');
  await main.getByRole('button',{name:/^添加附件：/}).focus();
  await main.keyboard.press('Enter'); await main.keyboard.press('Meta+Shift+A');
  await main.keyboard.press('Enter');
  assert.equal(JSON.parse(await keymap())['composer:select-attachment'].split('+').sort().join('+'),'a+mod+shift');

  // Verify an older custom file cannot steal the native selection shortcut.
  await run(`(()=>{
    const fs=require('fs'), file=AppEnv.keymaps.getUserKeymapPath();
    const map=JSON.parse(fs.readFileSync(file,'utf8'));
    map['composer:send-message']=[
      map['composer:send-message'], 'mod+shift+left', 'ctrl+e', 'ctrl+shift+e', 'ctrl+d',
    ];
    fs.writeFileSync(file, JSON.stringify(map));
    AppEnv.keymaps.userKeymap.load();
    return true;
  })()`);
  await action('.pr-settings-back');
  for (const selector of ['.pr-subject-heading textarea', '[data-slate-editor]']) {
    await main.locator(selector).first().focus();
    assert(await run(`document.activeElement.matches(${JSON.stringify(selector)})`));
    await run(`window.prSendShortcutCalls=0;
      window.prSendShortcutHandler=AppEnv.commands.add(document.activeElement,'composer:send-message',event=>{
        event.stopImmediatePropagation(); window.prSendShortcutCalls++;
      });
      window.prListShortcutCalls=0;
      window.prListShortcutHandler=AppEnv.commands.add(document.activeElement,'contenteditable:numbered-list',event=>{
        event.stopImmediatePropagation(); window.prListShortcutCalls++;
      });true`);
    try {
      await main.keyboard.press('Meta+Shift+Y');
      await until(()=>run('window.prSendShortcutCalls===1'),'saved Send shortcut in '+selector);
      await main.keyboard.press('Meta+Shift+7');
      await until(()=>run('window.prListShortcutCalls===1'),'saved shifted digit in '+selector);
      if (selector === '.pr-subject-heading textarea') {
        await run('document.activeElement.setSelectionRange(document.activeElement.value.length, document.activeElement.value.length); true');
        await main.keyboard.press('Meta+Shift+ArrowLeft');
        assert(await run('document.activeElement.selectionStart===0 && document.activeElement.selectionEnd===document.activeElement.value.length'));
        await run('document.activeElement.setSelectionRange(0,0); true');
        await main.keyboard.press('Control+E');
        assert(await run('document.activeElement.selectionStart===document.activeElement.value.length'));
        await run('document.activeElement.setSelectionRange(0,0); true');
        await main.keyboard.press('Control+Shift+E');
        assert(await run('document.activeElement.selectionStart===0 && document.activeElement.selectionEnd===document.activeElement.value.length'));
        const subject = main.locator(selector);
        const value = await subject.inputValue();
        await run('document.activeElement.setSelectionRange(0,0); true');
        await main.keyboard.press('Control+D');
        assert.equal(await subject.inputValue(), value.slice(1));
        await subject.fill(value);
        assert.equal(await run('window.prSendShortcutCalls'),1);
      }
    } finally {
      await run('window.prSendShortcutHandler.dispose();window.prListShortcutHandler.dispose();true');
    }
  }
  await main.locator('.pr-sidebar button').filter({hasText:'设置'}).click();
  await action('[data-settings-tab="Shortcuts"]');
  // Model a legacy sequence written through the advanced configuration file.
  await run(`(()=>{
    const fs=require('fs'), file=AppEnv.keymaps.getUserKeymapPath();
    const map=JSON.parse(fs.readFileSync(file,'utf8'));
    map['multiselect-list:deselect-all']='e n';
    fs.writeFileSync(file, JSON.stringify(map));
    AppEnv.keymaps.userKeymap.load();
    return true;
  })()`);
  const customKeymap=await keymap();
  await run(`window.prOriginalResetDialog=require('@electron/remote').dialog.showMessageBoxSync;
    window.prConfirmShortcutReset=false;
    require('@electron/remote').dialog.showMessageBoxSync=(_, options)=>{
      window.prShortcutResetDialog=options;return window.prConfirmShortcutReset?1:options.cancelId;
    };true`);
  try {
    const reset=main.getByRole('button',{name:'恢复默认…'});
    await reset.focus(); await main.keyboard.press('Enter');
    assert(await run(`window.prShortcutResetDialog.buttons[window.prShortcutResetDialog.defaultId]==="取消" &&
      window.prShortcutResetDialog.defaultId===window.prShortcutResetDialog.cancelId`));
    assert.equal(await keymap(),customKeymap);
    await run('window.prConfirmShortcutReset=true');
    await main.keyboard.press('Enter');
    assert.deepEqual(JSON.parse(await keymap()),{});
    await main.locator(search).fill('发送邮件');
    assert.equal(await main.locator('.pr-keymaps .shortcut-value').innerText(),displayedBinding);
  } finally {
    await run(`require('@electron/remote').dialog.showMessageBoxSync=window.prOriginalResetDialog;true`);
  }
  await action('.pr-settings-back');
  await main.locator('.pr-sidebar button').filter({hasText:'收件箱'}).click();
  await main.locator('.pr-mail-row').first().focus();
  await run(`window.prArchiveShortcutCalls=0;
    window.prArchiveShortcutHandler=AppEnv.commands.add(document.activeElement,'core:archive-item',event=>{
      event.stopImmediatePropagation(); window.prArchiveShortcutCalls++;
    });true`);
  try {
    await main.keyboard.press('e');
    await until(()=>run('window.prArchiveShortcutCalls===1'),'reset removes stale sequence and restores archive key');
  } finally {
    await run('window.prArchiveShortcutHandler.dispose();true');
  }
  await main.locator('.pr-sidebar button').filter({hasText:'设置'}).click();
  await action('[data-settings-tab="Shortcuts"]');
  await main.locator(search).fill('');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:900,height:700,deviceScaleFactor:1,mobile:false});
  for (const id of ['General','Accounts','Shortcuts']) {
    await action(`[data-settings-tab="${id}"]`);
    await until(()=>run('!!document.querySelector(".pr-settings-page")'),id+' compact');
    await shot('compact-'+id.toLowerCase());
    assert(await run(`(()=>{const e=document.querySelector('.pr-settings-page');return e.scrollWidth<=e.clientWidth+1 && e.getBoundingClientRect().right<=innerWidth;})()`),id+' overflow');
  }
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await run('require("@electron/remote").getCurrentWindow().setContentSize(740,700);true');
  await until(()=>run('innerWidth===740 && innerHeight===700'),'native 740×700 window');
  await shot('narrow-shortcuts-default');
  await main.locator(search).fill('composer:send-message');
  await main.locator(search).focus();
  await main.keyboard.press('Tab'); await main.keyboard.press('Tab');
  assert(await run('document.activeElement.matches(".pr-keymaps .shortcut:focus-visible")'));
  await shot('narrow-shortcuts');
  assert(await run(`(()=>{const e=document.querySelector('.pr-settings-page');return e.scrollWidth<=e.clientWidth+1 && e.getBoundingClientRect().right<=innerWidth;})()`));
  const shortcutHeight=()=>run('document.querySelector(".pr-keymaps .shortcut").getBoundingClientRect().height');
  const restingHeight=await shortcutHeight();
  await main.keyboard.press('Enter'); await main.keyboard.press('Meta+Shift+Y');
  assert(Math.abs((await shortcutHeight())-restingHeight)<=2);
  await shot('narrow-shortcut-pending');
  await main.keyboard.press('Escape');
  await cdp.send('Emulation.setDeviceMetricsOverride',{width:900,height:700,deviceScaleFactor:1,mobile:false});
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
    lastAccountConsequenceShown:true, connectionErrorKeyboardActions:true, generalKeyboardToggle:true,generalFocusRetained:true,readingSelectSaved:true,accountLabelSaved:true,accountColorSaved:true,accountColorPreview:true,shortcutPresetSaved:true,shortcutSearch:true,shortcutChineseActionSearch:true,shortcutSymbolSearch:true,shortcutSequenceSearch:true,shortcutClearFocus:true,shortcutRecordingPrompt:true,shortcutNative740:true,shortcutEmptyState:true,shortcutKeyboardCancel:true,shortcutBlurCancel:true,shortcutConflictBlocked:true,shortcutSequencePrefixBlocked:true,shortcutHeldEnterDoesNotCommit:true,shortcutHeldEnterDoesNotReopen:true,shortcutShiftedDigitDispatch:true,shortcutUnusableComposeBindingBlocked:true,shortcutKeyboardSaved:true,shortcutSingleKeySaved:true,shortcutFocusAfterFilterChange:true,shortcutDispatchInComposer:true,shortcutDispatchInSlateBody:true,shortcutNativeTextSelectionPreserved:true,shortcutMacControlEditingPreserved:true,shortcutResetDefaultsToCancel:true,shortcutResetConfirmed:true,shortcutResetClearsStaleSequence:true,shortcutNarrowHeightStable:true,compactLayouts:true,expectedSMTPSubmissions:0};
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');
  console.log('PASS settings subpages',JSON.stringify(result));
};
