const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async({main,cdp,work,account,cli,click,evaluate,until,draft})=>{
 const out=path.resolve(process.env.PAPER_REED_SETTINGS_OUTPUT || path.join(__dirname,'../settings-validation-2026-11-16'));fs.mkdirSync(out,{recursive:true});
 const run=s=>evaluate(cdp,s);
 const action=async s=>{await main.locator(s).first().click();};
 const shot=async name=>{await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const r=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(r.data,'base64'));};
 if (process.env.PAPER_REED_SETTINGS_CHECK === 'signatures') {
  const before=process.env.PAPER_REED_CONTROLS_PHASE==='before';
  await action('.pr-sidebar button:has-text("设置")');
  const tabs=await run('[...document.querySelectorAll(".pr-preferences-nav [data-settings-tab]")].map(tab=>tab.dataset.settingsTab)');
  assert.equal(tabs[tabs.indexOf('Folders')+1],'Signatures');
  await action('[data-settings-tab="Signatures"]');
  const page=main.locator('.pr-signature-settings');
  const nav=page.locator('nav');
  const title=page.locator('#signature-title');
  const create=page.getByRole('button',{name:'新建签名',exact:true});
  const remove=()=>page.locator('footer').getByRole('button',{name:/^删除签名/});
  const cancel=()=>page.getByRole('button',{name:'取消',exact:true});
  const confirm=()=>page.getByRole('button',{name:'确认删除',exact:true});
  const focus=selector=>run(`document.activeElement.matches(${JSON.stringify(selector)})`);
  const preview=page.locator('.section.preview > .preview');
  await nav.getByRole('button',{name:'工作',exact:true}).click();
  assert.equal(await page.locator('#signature-body').inputValue(),'<div>Maya Chen</div><div>Paper Reed · Design</div>');
  await shot('signature-raw');
  if(!before) {
    await page.locator('.pr-template-html').focus();
    await main.keyboard.press('Tab');
    assert(await focus('#signature-body:focus-visible'));
    assert.equal(await run('getComputedStyle(document.activeElement).outlineColor'),'rgb(75, 99, 79)');
    assert.equal(await run('getComputedStyle(document.activeElement).boxShadow'),'none');
    await shot('signature-html-focus');
    const raw=page.locator('#signature-body');
    const customHtml='<div>保留这份手写签名</div>';
    await raw.fill(customHtml);
    await until(()=>run(`require('mailspring-exports').SignatureStore.selectedSignature().body===${JSON.stringify(customHtml)}`),'custom HTML saved');
    assert.equal(await preview.innerText(),'保留这份手写签名');
    await run(`(()=>{
      const {dialog,getCurrentWindow}=require('@electron/remote');
      window.prRawDialog=dialog.showMessageBoxSync;
      dialog.showMessageBoxSync=(parent,options)=>{
        window.prRawWarning={...options,parentBound:parent.id===getCurrentWindow().id};
        return window.prReplaceRaw ? 1 : options.cancelId;
      };
      return true;
    })()`);
    try {
      const format=page.getByRole('button',{name:'横线落款',exact:true});
      await format.focus();
      await main.keyboard.press('Enter');
      const warning=await run('window.prRawWarning');
      assert(warning.parentBound);
      assert.equal(warning.message,'改用签名版式？');
      assert.match(warning.detail,/覆盖.*自定义 HTML/);
      assert.equal(warning.buttons[warning.defaultId],'取消');
      assert.equal(warning.defaultId,warning.cancelId);
      assert.equal(await format.getAttribute('aria-pressed'),'false');
      assert.equal(await raw.inputValue(),customHtml);
      assert(await focus('.pr-template-grid button:first-child'));
      await run('window.prReplaceRaw=true');
      await main.keyboard.press('Enter');
      assert.equal(await format.getAttribute('aria-pressed'),'true');
      assert.equal(await raw.count(),0);
      assert.notEqual(await preview.innerText(),'保留这份手写签名');
    } finally {
      await run("require('@electron/remote').dialog.showMessageBoxSync=window.prRawDialog;true");
    }
  }
  await run('AppEnv.config.set("signatures",{});true');
  await until(()=>run('!!document.querySelector(".pr-signature-empty")'),'empty signature settings');
  await shot('signature-empty');
  if(!before) {
    assert.equal(await nav.count(),0);
    assert((await create.boundingBox()).height>=34);
    assert.equal(await run('getComputedStyle(document.querySelector(".pr-signature-add")).backgroundColor'),'rgb(75, 99, 79)');
  }
  await create.focus();
  await main.keyboard.press('Enter');
  await until(()=>run('document.getElementById("signature-title")?.value==="新签名"'),'signature editor');
  if(!before) assert(await run(`(()=>{
    const title=document.getElementById('signature-title');
    return document.activeElement===title && title.selectionStart===0 && title.selectionEnd===title.value.length;
  })()`),'new signature focuses and selects the name');
  await title.fill('工作 · Paper Reed');
  await page.locator('#name').fill('Maya Chen');
  await page.locator('[id="title"]').fill('设计总监');
  await page.locator('#email').fill('maya@studio.example.test');
  const defaultIdentity=page.getByRole('checkbox',{name:account.emailAddress});
  await defaultIdentity.focus();
  await main.keyboard.press('Space');
  const selectedId=await run('require("mailspring-exports").SignatureStore.selectedSignature().id');
  const getDefault=()=>run(`require('mailspring-exports').SignatureStore.signatureForEmail(${JSON.stringify(account.emailAddress)})?.id`);
  assert.equal(await getDefault(),selectedId);
  assert.match(await preview.innerText(),/Maya Chen/);
  const alternate=page.getByRole('button',{name:'竖线名片',exact:true});
  const first=page.getByRole('button',{name:'横线落款',exact:true});
  const firstHtml=await preview.innerHTML();
  await alternate.focus();
  await main.keyboard.press('Space');
  assert.equal(await alternate.getAttribute('aria-pressed'),'true');
  assert.notEqual(await preview.innerHTML(),firstHtml);
  await first.click();
  assert.equal(await preview.innerHTML(),firstHtml);
  if(!before) {
    const more=page.locator('.pr-signature-more summary');
    const website=page.getByRole('textbox',{name:'网站',exact:true});
    assert.equal(await website.isVisible(),false);
    await more.focus();
    await main.keyboard.press('Enter');
    assert(await website.isVisible());
    const photo=page.getByRole('combobox',{name:'签名图片'});
    assert.equal(await photo.innerText().then(text=>text.split('\n')[0]),'不使用图片');
    await website.fill('example.test');
    await until(()=>run('require("mailspring-exports").SignatureStore.selectedSignature().data.websiteURL==="example.test"'),'advanced field persists');
    const labelColor=await run(`getComputedStyle(document.querySelector('label[for="websiteURL"]')).color`);
    assert.equal(labelColor,'rgb(98, 107, 96)');
    await photo.scrollIntoViewIfNeeded();
    await shot('signature-more');
    await photo.selectOption('custom');
    const photoAddress=page.getByRole('textbox',{name:'图片地址',exact:true});
    await photo.focus();
    await main.keyboard.press('Tab');
    assert(await focus('#signature-photo-address'));
    const gap=await run(`document.querySelector('#signature-photo-address').getBoundingClientRect().top-
      document.querySelector('#photoURL').getBoundingClientRect().bottom`);
    assert(gap>=8,'image address has space below its picker');
    const testImage='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPxoAAAAASUVORK5CYII=';
    await photoAddress.fill(testImage);
    assert.equal(await run('require("mailspring-exports").SignatureStore.selectedSignature().data.photoURL'),testImage);
    await shot('signature-photo-address');
    await photoAddress.fill('');
    assert.equal(await photo.inputValue(),'custom');
    assert.equal(await photoAddress.inputValue(),'');
    assert(await focus('#signature-photo-address'),'clearing an address keeps focus for replacement');
    await shot('signature-photo-empty-edit');
    await photoAddress.fill(testImage);
    assert.equal(await run('require("mailspring-exports").SignatureStore.selectedSignature().data.photoURL'),testImage);
    await photo.selectOption('');
    await more.focus();
    await main.keyboard.press('Enter');
    assert.equal(await website.isVisible(),false);
    assert.equal(await run('require("mailspring-exports").SignatureStore.selectedSignature().data.websiteURL'),'example.test');
    await main.keyboard.press('Enter');
    await website.fill('');
    await more.focus();
    await main.keyboard.press('Enter');
  }
  await run('document.querySelector(".preferences-content .scroll-region-content").scrollTop=0;true');
  await shot('signature-desktop');

  await remove().focus();
  await main.keyboard.press('Enter');
  await confirm().waitFor();
  await shot('signature-delete');
  if(before) {
    await cancel().click();
  } else {
    assert(await focus('.pr-signature-delete-actions button:first-child'),'cancel receives focus');
    assert.match(await page.locator('footer').innerText(),/工作 · Paper Reed.*停止插入/s);
    await main.keyboard.press('Shift+Tab');
    assert(await focus('.pr-signature-more summary'));
    await main.keyboard.press('Escape');
    assert(await focus('.pr-signature-detail footer button.pr-signature-remove'));
    assert.equal(await getDefault(),selectedId);
    await main.keyboard.press('Enter');
    await main.keyboard.press('Enter');
    assert(await focus('.pr-signature-detail footer button.pr-signature-remove'));
    assert.equal(await getDefault(),selectedId);
  }

  await cdp.send('Emulation.clearDeviceMetricsOverride');
  if(!before) {
    await run('require("@electron/remote").getCurrentWindow().setContentSize(900,700);true');
    await until(()=>run('innerWidth===900 && innerHeight===700'),'native medium signature settings');
    await page.locator('.pr-template-grid').scrollIntoViewIfNeeded();
    assert(await run(`[...document.querySelectorAll('.pr-template-preview')].every(frame=>{
      const sample=frame.firstElementChild.getBoundingClientRect();
      const bounds=frame.getBoundingClientRect();
      return sample.left>=bounds.left && sample.right<=bounds.right+1;
    })`),'the 900px template cards contain their full-size preview samples');
    await shot('signature-medium-templates');
  }
  await run('require("@electron/remote").getCurrentWindow().setContentSize(740,700);true');
  await until(()=>run('innerWidth===740 && innerHeight===700'),'native narrow signature settings');
  await run('document.querySelector(".preferences-content .scroll-region-content").scrollTop=0;true');
  await shot('signature-narrow');
  if(before) {
   console.log('PASS signatures baseline');
   return;
  }
  const narrow=await run(`(()=>{
    const page=document.querySelector('.pr-signature-settings');
    const bounds=selector=>page.querySelector(selector).getBoundingClientRect().toJSON();
    return {
      list:bounds('.pr-signature-list'), editor:bounds('.pr-signature-detail'),
      preview:bounds('.section.preview'), email:bounds('#email'), templates:bounds('.pr-template-grid'),
      overflow:page.scrollWidth>page.clientWidth+1, height:innerHeight,
    };
  })()`);
  assert(narrow.list.bottom<narrow.editor.top && Math.abs(narrow.list.left-narrow.editor.left)<1 &&
    Math.abs(narrow.preview.width-narrow.editor.width)<1 && !narrow.overflow,
    'narrow signature list stacks above a full-width preview');
  assert(narrow.preview.top>=0 && narrow.preview.bottom<narrow.email.top &&
    narrow.email.bottom<narrow.templates.top && narrow.email.bottom<=narrow.height,
    'preview and common fields share the initial view: '+JSON.stringify(narrow));
  const contactEmail=page.locator('#email');
  await contactEmail.fill('maya+studio@studio.example.test');
  assert.match(await preview.innerText(),/maya\+studio@studio\.example\.test/);
  await shot('signature-narrow-edit');
  await contactEmail.fill('maya@studio.example.test');
  await main.keyboard.press('Tab');
  assert(await focus('.pr-template-grid button:first-child'),'Tab follows the visual order into the template picker');

  await create.focus();
  await main.keyboard.press('Enter');
  assert.equal(await title.inputValue(),'新签名');
  assert.notEqual(await page.locator('#name').inputValue(),'Maya Chen');
  assert.equal(await getDefault(),selectedId);
  assert.equal(await defaultIdentity.isChecked(),false);
  await title.fill('简短回信');
  const newId=await run('require("mailspring-exports").SignatureStore.selectedSignature().id');
  assert.notEqual(newId,selectedId);
  const owner=page.locator('.pr-signature-defaults small');
  assert.equal(await owner.innerText(),'当前使用「工作 · Paper Reed」');
  assert.equal(await defaultIdentity.getAttribute('aria-describedby'),await owner.getAttribute('id'));
  await run('document.querySelector(".preferences-content .scroll-region-content").scrollTop=0;true');
  await shot('signature-narrow-multiple');
  await defaultIdentity.focus();
  await main.keyboard.press('Space');
  assert.equal(await getDefault(),newId);
  assert.equal(await owner.count(),0);
  await nav.getByRole('button',{name:'工作 · Paper Reed',exact:true}).click();
  assert.equal(await owner.innerText(),'当前使用「简短回信」');
  await defaultIdentity.focus();
  await main.keyboard.press('Space');
  assert.equal(await getDefault(),selectedId);
  await nav.getByRole('button',{name:'简短回信',exact:true}).click();

  await remove().focus();
  await main.keyboard.press('Enter');
  assert(await run(`[...document.querySelectorAll('.pr-signature-delete-actions button')].every(button=>{
    const bounds=button.getBoundingClientRect();
    return bounds.left>=0 && bounds.right<=innerWidth && bounds.top>=0 && bounds.bottom<=innerHeight;
  })`),'narrow deletion controls stay in the viewport');
  await shot('signature-narrow-delete');
  await main.keyboard.press('Tab');
  assert(await focus('.pr-signature-delete-actions .pr-signature-remove'));
  await main.keyboard.press('Enter');
  assert(await focus('.pr-signature-list nav button[aria-current]'));
  assert.equal(await title.inputValue(),'工作 · Paper Reed');
  assert.equal(await getDefault(),selectedId);
  await remove().focus();
  await main.keyboard.press('Enter');
  await main.keyboard.press('Tab');
  await main.keyboard.press('Enter');
  await page.locator('.pr-signature-empty').waitFor();
  assert(await focus('.pr-signature-add'),'last deletion returns focus to New');
  assert.equal(await getDefault(),undefined);

  await create.focus();
  await main.keyboard.press('Enter');
  await title.fill('自动落款验证');
  await page.locator('#name').fill('Maya · 自动落款验证');
  await defaultIdentity.focus();
  await main.keyboard.press('Space');
  assert(await getDefault());
  await action('.pr-settings-back');
  await main.getByRole('button',{name:/^写邮件/}).click();
  await until(()=>run(`[...document.querySelectorAll('.pr-editor [contenteditable=true]')].some(editor=>
    editor.textContent.includes('Maya · 自动落款验证')
  )`),'default signature from settings appears in a new draft');
  await shot('signature-composer-default');
  console.log('PASS new composer inserts the signature selected in settings');
  const result={
    signatureNavigation:true, rawSignatureRetained:true, emptyStateAndNewButton:true,
    newNameFocus:true, keyboardDefaultIdentity:true, livePreviewAndTemplate:true,
    deleteCancelAndEscapeRestoreFocus:true, deleteMovesFocusToRemainingOrNew:true,
    newSignatureDoesNotCopyAnotherIdentity:true, nativeNarrowSignaturePreview:true,
    advancedFieldsAvailableAndRetained:true, narrowPreviewAndFieldsVisibleTogether:true,
    htmlKeyboardFocusColor:true, mediumTemplateSamplesFit:true, existingDefaultOwnerVisible:true,
    customHtmlSwitchConfirmation:true, customImageInputKeyboardAndSpacing:true,
    clearingPhotoKeepsCustomInput:true, defaultSignatureAppliedToNewDraft:true,
    expectedSMTPSubmissions:0,
  };
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');
  console.log('PASS signature settings',JSON.stringify(result));
  return;
 }
 await action('[contenteditable=true]');await main.keyboard.press('Meta+End');
 await action('.pr-format-toggle');await until(()=>run('!!document.querySelector("button[aria-label=表情]")'),'emoji trigger');
 await action('button[aria-label=表情]');await until(()=>run('!!document.querySelector(".pr-emoji-picker")'),'emoji picker');
 await shot('emoji');
 await action('.pr-emoji-picker > input');await main.keyboard.insertText('zzzznothing');
 await until(()=>run('document.querySelectorAll(".pr-emoji-grid button").length===0'),'empty emoji search');await shot('emoji-empty');
 await main.keyboard.press('Meta+A');await main.keyboard.insertText('smile');
 await until(()=>run('document.querySelectorAll(".pr-emoji-grid button").length>0'),'emoji search');await shot('emoji-search');
 await main.keyboard.press('ArrowDown');await main.keyboard.press('Enter');
 await shot('emoji-inserted');
 await until(()=>run('!document.querySelector(".pr-emoji-picker") && !!document.querySelector("[contenteditable] img")'),'emoji inserted');
 await run(`require('mailspring-exports').DraftStore.sessionForClientId(${JSON.stringify(draft.draftId)}).then(s=>s.changes.commit()).then(()=>true)`);
 const saved=await cli('draft-get',{accountId:account.id,draftId:draft.draftId});assert(saved.body.includes('data-emoji-name'));assert(saved.body.includes('请保留这段正文'));
 await action('button[aria-label=表情]');await until(()=>run('!!document.querySelector(".pr-emoji-picker")'),'reopen emoji');await until(()=>run('document.activeElement?.matches(".pr-emoji-picker > input")'),'emoji search focused');await main.keyboard.press('Escape');
 await until(()=>run('!document.querySelector(".pr-emoji-picker")'),'emoji escape');
 await until(()=>run('!!document.querySelector(".pr-signature-picker summary")'),'signature trigger');await action('.pr-signature-picker summary');await action('.pr-signature-manage');
 await until(()=>run('!!document.querySelector(".pr-signature-settings")'),'signature settings');
 await action('.pr-signature-settings nav button');await until(()=>run('!!document.querySelector("#signature-title")'),'selected signature');await shot('signatures');
 await action('#signature-title');await main.keyboard.press('Meta+A');await main.keyboard.insertText('工作 · Paper Reed');
 await action('.pr-signature-defaults input');
 await until(()=>run('Object.values(AppEnv.config.get("signatures")).some(s=>s.title==="工作 · Paper Reed")'),'name saved');
 assert.equal(await run(`AppEnv.config.get('defaultSignatures')[${JSON.stringify(account.email)}] || AppEnv.config.get('defaultSignatures')['test@example.test']`),'studio');
 await action('.pr-signature-detail footer button');await until(()=>run('document.querySelector(".pr-signature-detail footer").innerText.includes("确认删除")'),'first confirmation');await shot('delete-confirmation');await action('.pr-signature-detail footer button:first-of-type');
 assert.equal(await run('Object.keys(AppEnv.config.get("signatures")).length'),2);
 await action('.pr-signature-detail footer button');await until(()=>run('document.querySelector(".pr-signature-detail footer").innerText.includes("确认删除")'),'delete confirmation ready');await action('.pr-signature-detail footer button:last-of-type');
 await until(()=>run('Object.keys(AppEnv.config.get("signatures")).length===1'),'delete signature');
 await action('.pr-signature-settings header button');await until(()=>run('Object.keys(AppEnv.config.get("signatures")).length===2'),'new signature');await shot('signature-new');
 if (process.env.PAPER_REED_NAVIGATION_CHECK) await require('./check-settings-navigation.cjs')({main,cdp,run,action,shot,until,cli,account,draft});
 const result={settingsNavigation:!!process.env.PAPER_REED_NAVIGATION_CHECK,emojiSearch:true,emojiEmptyState:true,emojiKeyboardInsert:true,emojiEscape:true,emojiSavedWithBody:true,signatureRename:true,signatureDefaultAccount:true,signatureDeleteCancel:true,signatureDeleteConfirm:true,signatureCreate:true,expectedSMTPSubmissions:0};
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log('PASS settings details',JSON.stringify(result));
};
