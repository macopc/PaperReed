const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
module.exports=async({app,main,cdp,work,account,cli,click,evaluate,until,restart})=>{
 app.windows().forEach(page=>page.on('dialog',()=>{}));app.on('window',page=>page.on('dialog',()=>{}));
 const out=process.env.PAPER_REED_UI_OUTPUT || path.resolve(__dirname,'../editor-validation-2026-11-16');fs.mkdirSync(out,{recursive:true});
 const text=()=>evaluate(cdp,'document.body.innerText');
 const action=selector=>click(main,cdp,selector);
 const frame=async(name)=>{const shot=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(shot.data,'base64'));};
 const screenshot=async(name)=>{await cdp.send('Emulation.setDeviceMetricsOverride',{width:name.includes('compact')?900:1440,height:name.includes('compact')?700:900,deviceScaleFactor:1,mobile:false});await evaluate(cdp,'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');await frame(name);};
 const openSubject=async subject=>{
   await until(()=>evaluate(cdp,`Array.from(document.querySelectorAll('.pr-mail-row')).some(e=>e.innerText.includes(${JSON.stringify(subject)}))`),'draft in list');
   await evaluate(cdp,`Array.from(document.querySelectorAll('.pr-mail-row')).find(e=>e.innerText.includes(${JSON.stringify(subject)})).setAttribute('data-test-target','true');true`);
   await action('[data-test-target]');
 };
 const edit=async content=>{await action('[contenteditable="true"]');await main.keyboard.press('Meta+A');await main.keyboard.insertText(content);};
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await until(()=>evaluate(cdp,'document.querySelectorAll(".pr-mail-row").length===8'),'8 real inbox threads');
 await screenshot('inbox');
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:900,height:700,deviceScaleFactor:1,mobile:false});
 await screenshot('inbox-compact');
 const listLayout=()=>evaluate(cdp,`(()=>{
   const row=document.querySelector('.pr-mail-row');
   const sender=row.querySelector('.pr-sender').getBoundingClientRect();
   const summary=row.querySelector('.pr-summary').getBoundingClientRect();
   const date=row.querySelector('.pr-date').getBoundingClientRect();
   return {senderTop:sender.top,summaryTop:summary.top,width:summary.width,
     dateRight:date.right,rowRight:row.getBoundingClientRect().right,
     overflow:document.documentElement.scrollWidth>innerWidth};
 })()`);
 const compact=await listLayout();
 assert(!compact.overflow);
 assert.equal(compact.senderTop,compact.summaryTop,'900px window keeps horizontal scanning');
 assert(compact.width>300,'Split-window subject stays readable');
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:740,height:700,deviceScaleFactor:1,mobile:false});
 await evaluate(cdp,'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 const narrow=await listLayout();
 assert(!narrow.overflow);
 assert(narrow.summaryTop>narrow.senderTop,'Narrow content stacks sender above subject');
 assert.equal(narrow.dateRight,narrow.rowRight,'Date stays on the trailing edge in the stacked layout');
 await frame('inbox-narrow');
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 const search=main.locator('.pr-search-input');
 await search.fill('no matching fixture mail');
 await main.getByRole('status').filter({hasText:'没找到匹配的邮件'}).waitFor();
 await screenshot('search-empty');
 await main.locator('.pr-command-trigger').click();
 const paletteInput=main.getByRole('textbox',{name:'查找命令'});
 await paletteInput.fill('归档');
 const activeCommand=main.locator('.pr-command-results button.active');
 assert((await activeCommand.innerText()).includes('前往归档'));
 assert(await main.locator('.pr-command-results button:disabled').count());
 await paletteInput.press('ArrowDown');
 assert((await activeCommand.innerText()).includes('前往归档'),'Arrow navigation skips disabled commands');
 await screenshot('command-available');
 await paletteInput.fill('core:archive-item');
 await main.getByRole('status').filter({hasText:'当前位置不可用'}).waitFor();
 assert.equal(await activeCommand.count(),0);
 await paletteInput.press('Enter');
 await main.locator('.pr-command-panel').waitFor();
 await screenshot('command-unavailable');
 await paletteInput.fill('no matching command');
 await main.getByRole('status').filter({hasText:'没有匹配的命令'}).waitFor();
 await paletteInput.press('Escape');
 await main.locator('.pr-command-panel').waitFor({state:'hidden'});
 await search.fill('Project kickoff');
 await until(()=>evaluate(cdp,`document.querySelectorAll('.pr-mail-row').length===1 &&
   document.querySelector('.pr-mail-row').innerText.includes('Project kickoff')`),'live search results');
 await main.locator('.pr-search button').click();
 assert(await evaluate(cdp,'document.activeElement === document.querySelector(".pr-search-input")'),'Clear returns focus to search');
 await until(()=>evaluate(cdp,'document.querySelectorAll(".pr-mail-row").length===8'),'cleared live search');
 await action('.pr-mail-row');
 await until(()=>evaluate(cdp,'!!document.querySelector(".pr-reader .messages-wrap.ready .message-item-wrap")'),'reader');
 assert.equal(await main.locator('.pr-reader .pr-local-controls').count(),1);
 await until(()=>evaluate(cdp,'Array.from(document.querySelectorAll("iframe")).some(e=>e.contentDocument?.body?.innerText.includes("Does the row"))'),'isolated message body');
 const readerWidth=await evaluate(cdp,'document.querySelector(".pr-reader").getBoundingClientRect().width');
 assert.equal(readerWidth,640);
 await screenshot('thread');
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:740,height:700,deviceScaleFactor:1,mobile:false});
 await main.locator('[data-local-panel=snooze]').click();
 const snoozePanel=main.locator('.pr-reader .pr-local-panel');
 await snoozePanel.waitFor();
 assert(await evaluate(cdp,`(()=>{const panel=document.querySelector('.pr-reader .pr-local-panel');return panel.scrollWidth<=panel.clientWidth;})()`),'Snooze fits the narrow reader');
 await frame('thread-narrow');
 await main.keyboard.press('Escape');
 await snoozePanel.waitFor({state:'hidden'});
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await action('.footer-reply-area-wrap');
 await until(()=>evaluate(cdp,'!!document.querySelector(".pr-draft-status")'),'inline reply composer');
 await edit('Reply layout verification.');
 await action('.pr-draft-status button');
 await until(async()=>(await text()).includes('已保存到本机'),'saved inline reply');
 await evaluate(cdp,'document.querySelector(".pr-main").scrollTop=0;true');
 await screenshot('reply');
 await action('[data-mailbox="drafts"]');
 const created=await cli('draft-create',{accountId:account.id,to:[{email:'recipient@example.test'}],cc:[{email:'cc@example.test'}],bcc:[{email:'bcc@example.test'}],subject:'Paper Reed connected composer',body:'CLI starting text'});
 const ref={accountId:account.id,draftId:created.draftId};
 await openSubject(created.subject);
 await until(()=>evaluate(cdp,'!!document.querySelector(".pr-editor [contenteditable=true]")'),'full editor');
 const editorWidth=await evaluate(cdp,'document.querySelector(".pr-editor").getBoundingClientRect().width');
 assert.equal(editorWidth,readerWidth);
 const sendLeft=await evaluate(cdp,'document.querySelector(".btn-send").getBoundingClientRect().left');
 const headerOrder=await evaluate(cdp,'Array.from(document.querySelectorAll(".pr-editor .expanded-participants .composer-participant-field")).map(e=>e.className)');
 assert(headerOrder[0].includes('from-field'),'From precedes recipients in DOM');
 assert.equal(await evaluate(cdp,'getComputedStyle(document.querySelector(".RichEditor-toolbar")).display'),'none');
 await action('.pr-format-toggle');
 assert.notEqual(await evaluate(cdp,'getComputedStyle(document.querySelector(".RichEditor-toolbar")).display'),'none');
 await action('.pr-format-toggle');
 await action('.pr-subject-heading textarea');await main.keyboard.press('Meta+A');await main.keyboard.insertText('A very long subject that should wrap naturally inside the same reading column without pushing recipients or actions outside the window — Paper Reed editor review');
 assert(await evaluate(cdp,`(()=>{const e=new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true});document.querySelector('.pr-subject-heading textarea').dispatchEvent(e);return !e.defaultPrevented;})()`),'Composing Enter must not be consumed by subject navigation');
 const titleHeight=await evaluate(cdp,'document.querySelector(".pr-subject-heading textarea").getBoundingClientRect().height');
 assert(titleHeight>=76,'Long subject wraps');
 await screenshot('long-subject');
 for (const [width,height] of [[740,700],[900,700],[900,760],[900,768],[900,820],[1440,900]]) {
   await cdp.send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false});
   await evaluate(cdp,`new Promise(resolve=>requestAnimationFrame(()=>{
     document.querySelector('.pr-main').scrollTop=0;
     requestAnimationFrame(resolve);
   }))`);
   const toolbarBottom=await evaluate(cdp,`Math.ceil(document.querySelector('.pr-editor .pr-compose-actions').getBoundingClientRect().bottom)`);
   assert(toolbarBottom<=height,`Draft actions visible without scrolling at ${width}×${height} (bottom = ${toolbarBottom})`);
   if (width===740) {
     assert(await evaluate(cdp,`(() => {
       const header = document.querySelector('.pr-draft-header');
       const centerY = el => { const r = el.getBoundingClientRect(); return r.top + r.height / 2; };
       return Math.abs(centerY(header.querySelector('.pr-back')) -
         centerY(header.querySelector('.pr-save-draft'))) <= 1;
     })()`),'Back and Save share the same row in the narrow draft');
     await frame('long-subject-narrow');
   }
   if (height===768) await frame('long-subject-768');
 }
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await main.keyboard.press('Meta+A');await main.keyboard.insertText(created.subject);
 await edit('Paper Reed GUI edit — preserve this version.');
 assert((await text()).includes('尚未保存'));
 const remote=await cli('draft-update',{...ref,expectedRevision:created.revision,changes:{body:'CLI newer version'}});
 await action('.pr-draft-status button');
 await until(async()=>(await text()).includes('草稿有更新'),'persistent conflict');
 await action('[data-mailbox="inbox"]');
 assert(await evaluate(cdp,'!!document.querySelector(".pr-editor")'),'conflict blocks navigation');
 await until(async()=>(await text()).includes('草稿有更新'),'conflict remains after navigation attempt');
 assert(!(await text()).includes('当前编辑尚未保存。请在编辑区处理后再切换。'),'no duplicate page-level error');
 assert(await evaluate(cdp,'document.querySelector(".btn-send").disabled'),'conflicting send control disabled');
 assert.equal(await evaluate(cdp,'document.querySelector(".btn-send").getBoundingClientRect().left'),sendLeft,'Conflict must not move the send action');
 await screenshot('conflict');
 await action('.pr-status-line button');
 await until(async()=>(await text()).includes('副本已保存到本机'),'copy saved');
 const copies=await evaluate(cdp,`require('mailspring-exports').DatabaseStore.findAll(require('mailspring-exports').Message).where({draft:true}).then(rows=>rows.filter(r=>r.subject===${JSON.stringify(created.subject)}).map(r=>r.headerMessageId))`);
 assert.equal(copies.length,2);const copyId=copies.find(id=>id!==created.draftId);
 assert((await cli('draft-get',{accountId:account.id,draftId:copyId})).body.includes('Paper Reed GUI edit'));
 assert.equal((await cli('draft-get',ref)).body,'CLI newer version');
 // Editing after the copy must remove the reload action until a fresh copy exists.
 await edit('Paper Reed GUI edit — newer than the recovery copy.');
 assert(!await evaluate(cdp,'!!document.querySelector(".pr-reload-original")'));
 await action('.pr-status-line button');
 await until(()=>evaluate(cdp,'!!document.querySelector(".pr-reload-original")'),'fresh recovery copy');
 await action('.pr-reload-original');
 await until(()=>evaluate(cdp,'document.querySelector("[contenteditable=true]")?.innerText.includes("CLI newer version")'),'explicit original reload');
 assert((await text()).includes('已保存到本机'));
 await screenshot('recovered');
 await action('[data-mailbox="drafts"]');
 await until(()=>evaluate(cdp,'document.querySelectorAll(".pr-copy-badge").length===2'),'two marked recovery copies');
 assert((await text()).includes('原稿 · 2 份恢复副本'));
 await screenshot('recovery-list');
 await action(`[data-draft-id="${copyId}"]`);
 await until(()=>evaluate(cdp,'!!document.querySelector(".pr-recovery-origin")'),'copy provenance in editor');
 await screenshot('recovery-copy');
 await action('.pr-recovery-origin button');
 const sourceWindow=await until(async()=>app.windows().find(w=>JSON.parse(new URL(w.url()).searchParams.get('loadSettings')||'{}').windowType==='composer'),'source composer');
 sourceWindow.on('dialog',()=>{});
 const sourceCdp=await app.context().newCDPSession(sourceWindow);
 const openedSource=await until(()=>evaluate(sourceCdp,`(() => {
   if (!window.AppEnv || !document.querySelector('[contenteditable=true]')) return null;
   const props = AppEnv.getWindowProps();
   return {header:props.headerMessageId, accountId:props.accountId,
     body:document.querySelector('[contenteditable=true]').innerText.trim()};
 })()`),'source editor');
 assert.deepEqual(openedSource,{header:created.draftId,accountId:account.id,body:'CLI newer version'});
 await evaluate(sourceCdp,'setTimeout(()=>AppEnv.close(),0);true');
 await until(async()=>sourceWindow.isClosed(),'clean source close');
 await action('[data-mailbox="drafts"]');
 await action(`[data-draft-id="${created.draftId}"]`);
 await until(()=>evaluate(cdp,'!!document.querySelector(".pr-editor [contenteditable=true]")'),'original restored');
 const restoredEditor=main.locator('.pr-editor [contenteditable=true]');
 const selectDraftBody=async (body) => {
   await restoredEditor.click();
   await until(async()=>{
     await restoredEditor.press('Meta+A');
     return evaluate(cdp,`(()=>{
       const editor=document.querySelector('.pr-editor [contenteditable=true]');
       const selection=getSelection();
       return editor===document.activeElement && editor.contains(selection.anchorNode) &&
         selection.toString().trim()===${JSON.stringify(body)};
     })()`);
   },'editor has selected the previous body',5000);
 };
 await selectDraftBody('CLI newer version');
 await main.keyboard.insertText('Unsaved edit before Agent setup');
 assert.equal((await restoredEditor.innerText()).trim(),'Unsaved edit before Agent setup');
 const firstAgentAction=main.getByRole('button',{name:'连接 Agent',exact:true});
 await firstAgentAction.click();
 await until(()=>evaluate(cdp,'!document.querySelector(".pr-workspace")'),'unsaved draft saved and Agent preferences opened');
 assert((await cli('draft-get',ref)).body.includes('Unsaved edit before Agent setup'));
 await evaluate(cdp,'require("mailspring-exports").Actions.selectRootSheet(require("mailspring-exports").WorkspaceStore.Sheet.Threads);true');
 await selectDraftBody('Unsaved edit before Agent setup');
 await evaluate(cdp,`(() => {
   const editor = document.querySelector('.pr-editor [contenteditable=true]');
   window.restoredTextInput = [];
   editor.addEventListener('beforeinput', event => {
     if (!event.isTrusted || event.inputType !== 'insertText') return;
     const [range] = event.getTargetRanges();
     const replaced = range.endOffset - range.startOffset;
     restoredTextInput.push({event, replaced});
   }, {capture: true, once: true});
 })()`);
 await main.keyboard.insertText('CLI newer version');
 assert.equal((await restoredEditor.innerText()).trim(),'CLI newer version');
 assert.deepEqual(await evaluate(cdp,`restoredTextInput.map(({event, replaced}) =>
   ({data:event.data, replaced, consumed:event.defaultPrevented}))`),
   [{data:'CLI newer version',replaced:'Unsaved edit before Agent setup'.length,consumed:true}],
   'the restored editor consumes exactly one native replacement event');
 const restoredBody = await evaluate(cdp,`(() => {
   const session = require('mailspring-exports').DraftStore.cachedDraftSession(
     ${JSON.stringify(created.draftId)}, ${JSON.stringify(account.id)});
   return {slate:session.draft().bodyEditorState.document.text, html:session.draft().body};
 })()`);
 assert.equal(restoredBody.slate, 'CLI newer version');
 assert(['CLI newer version','<div>CLI newer version</div>'].includes(restoredBody.html));
 await action('.pr-draft-status button');
 await until(async()=>(await text()).includes('已保存到本机'),'saved draft restored');
 await evaluate(cdp,`require(AppEnv.getLoadSettings().resourcePath+'/internal_packages/mcp-server/lib/paper-reed-cli').installCLI().then(()=>true)`);
 assert.equal(await main.locator('.pr-route-compose .pr-agent-button').count(),0,'Draft has one visible Agent entry');
 await main.locator('.pr-editor .pr-copy-agent').click();
 await until(async()=>(await text()).includes('已复制草稿引用'),'context copied');
 const context=await evaluate(cdp,'(async()=>JSON.parse(await require("@electron/remote").clipboard.readText()))()');
 assert.equal(context.context.draftId,created.draftId);assert.equal(context.context.revision,(await cli('draft-get',ref)).revision);
 await screenshot('agent-context');
 await main.locator('.pr-command-trigger').click();
 const commandSearch=main.getByRole('textbox',{name:'查找命令'});
 await commandSearch.fill('交给 Agent');
 await commandSearch.press('Enter');
 await main.locator('.pr-agent-panel').waitFor();
 await main.getByRole('button',{name:'收起交接'}).click();
 await main.locator('.pr-agent-panel').waitFor({state:'hidden'});
 assert(await evaluate(cdp,`document.activeElement === document.querySelector('.pr-editor .pr-copy-agent')`),'Closing handoff returns focus to toolbar');
 await main.locator('.pr-sidebar-bottom button').click();
 await until(()=>evaluate(cdp,'!document.querySelector(".pr-workspace")'),'settings');
 await evaluate(cdp,'require("mailspring-exports").Actions.selectRootSheet(require("mailspring-exports").WorkspaceStore.Sheet.Threads);true');
 await until(()=>evaluate(cdp,'!!document.querySelector(".pr-editor [contenteditable=true]")'),'return to same draft');
 assert(['CLI newer version','<div>CLI newer version</div>'].includes((await cli('draft-get',ref)).body),'Source text retained through editor HTML normalization');
 await edit('Paper Reed GUI edit');
 await action('.pr-draft-status button');
 await until(async()=>(await text()).includes('已保存到本机'),'save before send');
 await screenshot('compose');
 await action('.btn-send .primary-item');
 await until(async()=>{const rows=await evaluate(cdp,`require('mailspring-exports').DatabaseStore._query('SELECT phase,sentCopy FROM PaperReedSend WHERE accountId = ?',[${JSON.stringify(account.id)}])`);return rows.length===1&&rows[0].phase==='accepted'&&rows[0].sentCopy==='filed';},'one accepted and filed send',45000);
 await until(()=>evaluate(cdp,'!!document.querySelector(".pr-route-list")'),'send returns to sent list');
 await until(async()=>(await text()).includes('服务器已接受'),'persistent send result');
 await action('.pr-send-results summary');
 await screenshot('sent');
 const provenance=await evaluate(cdp,`require('mailspring-exports').DatabaseStore._query('SELECT * FROM PaperReedDraftRecovery')`);
 assert.equal(provenance.length,2);assert(provenance.every(r=>r.accountId===account.id&&r.sourceDraftId===created.draftId&&r.sourceRevision===created.revision));
 ({app,main,cdp}=await restart());
 app.windows().forEach(page=>page.on('dialog',()=>{}));app.on('window',page=>page.on('dialog',()=>{}));
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await action('[data-mailbox="drafts"]');
 await until(()=>evaluate(cdp,'document.querySelectorAll(".pr-copy-badge").length===2'),'copy labels survive restart');
 await screenshot('recovery-list-restarted');
 await action(`[data-draft-id="${copyId}"]`);
 await until(()=>evaluate(cdp,'!!document.querySelector(".pr-recovery-origin")'),'restored provenance');
 assert((await text()).includes('Paper Reed GUI edit'));
 await action('.pr-recovery-origin button');
 await until(async()=>(await text()).includes('原稿暂不可用或已不在草稿箱'),'source no longer draft');
 await screenshot('source-unavailable');
 await evaluate(cdp,`(async()=>{const {DatabaseStore,Message,Actions}=require('mailspring-exports');const draft=await DatabaseStore.findBy(Message,{accountId:${JSON.stringify(account.id)},headerMessageId:${JSON.stringify(copyId)}});Actions.destroyDraft(draft);return true;})()`);
 await action('[data-mailbox="drafts"]');
 await until(()=>evaluate(cdp,'document.querySelectorAll(".pr-copy-badge").length===1'),'deleted copy excluded from provenance list');
 assert.equal((await evaluate(cdp,'document.querySelector(".pr-copy-badge").innerText')).trim(),'恢复副本 2','Deleting the first copy must not renumber the second');
 const renderer=fs.readFileSync(path.join(work,'renderer.log'),'utf8');
 assert(!renderer.includes('Failed to activate plugin'), 'All packages must activate');
 const result={realInboxThreads:8,compactSubjectWidth:compact.width,narrowSubjectWidth:narrow.width,readingAndReply:true,readerWidth,editorWidth,conflictingSendDisabled:true,sendPositionStable:true,
   cliDraftOpened:true,conflictVisible:true,navigationBlocked:true,recoveryPreservesBoth:true,newEditsRequireFreshCopy:true,
   explicitReload:true,contextUsesSavedRevision:true,settingsReturnToDraft:true,nativeReplacementAppliedOnce:true,sentResultVisible:true,subjectWraps:true,composingEnterPreserved:true,formatToggleWorks:true,fromFirst:true,recoveryLabelsPersist:true,sourceNavigation:true,missingSourceExplained:true,deletedCopyHidden:true,expectedSMTPSubmissions:1};
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2));
 console.log('PASS connected Paper Reed UI:',JSON.stringify(result));
};
