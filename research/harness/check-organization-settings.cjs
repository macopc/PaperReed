const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async({main,cdp,account,evaluate,until})=>{
 const out=path.resolve(__dirname,'../organization-validation-2026-11-16');fs.mkdirSync(out,{recursive:true});
 const run=s=>evaluate(cdp,s),action=s=>main.locator(s).first().click();
 const before=process.env.PAPER_REED_ORGANIZATION_PHASE==='before';
 const appearanceOnly=process.env.PAPER_REED_ORGANIZATION_CHECK==='appearance';
 const shot=async name=>{await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const r=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true});fs.writeFileSync(path.join(out,`${before?'before':'after'}-${name}.png`),Buffer.from(r.data,'base64'));};
 await main.locator('.pr-sidebar button').filter({hasText:'设置'}).click();
 const pages=[['Appearance','.container-appearance','appearance'],['Mail Rules','.container-mail-rules','rules-empty'],['Folders','.category-mapper-container','folders']];
 for(const [id,selector,name] of appearanceOnly ? pages.slice(0,1) : pages){
  await action(`[data-settings-tab="${id}"]`);await until(()=>run(`!!document.querySelector(${JSON.stringify(selector)})`),id);await shot(name);
 }
 if(before){console.log('PASS organization baseline');return;}
 const rules=()=>run(`require('mailspring-exports').MailRulesStore.rulesForAccountId(${JSON.stringify(account.id)})`);
 await action('[data-settings-tab="Appearance"]');
 const scale=Number(await run('AppEnv.config.get("core.workspace.interfaceZoom")'));
 assert.equal(await main.locator('.pr-scale-control button').isDisabled(),scale===1);
 await main.locator('#interface-zoom-slider').focus();await main.keyboard.press('ArrowRight');
 await until(()=>run(`Math.abs(Number(AppEnv.config.get('core.workspace.interfaceZoom'))-${scale+0.05})<0.001`),'zoom saved');
 assert(Math.abs((await run('require("electron").webFrame.getZoomFactor()'))-(scale+0.05))<0.001);
 assert.equal(await main.locator('#interface-zoom-slider').getAttribute('aria-valuetext'),`${Math.round((scale+0.05)*100)}%`);
 if(appearanceOnly) await shot('appearance-zoom-focus');
 await main.keyboard.press('Tab');
 assert(await run('document.activeElement.matches(".pr-scale-control button")'));
 await main.keyboard.press('Enter');
 await until(()=>run('require("electron").webFrame.getZoomFactor()===1'),'zoom reset');
 assert(await main.locator('.pr-scale-control button').isDisabled());
 assert.equal(await run('getComputedStyle(document.querySelector(".pr-scale-control button")).opacity'),'1');
 assert(await run('document.activeElement.id==="interface-zoom-slider" && document.activeElement.matches(":focus-visible")'));
 if(appearanceOnly) await shot('appearance-reset-focus');
 const lightSample=await run('getComputedStyle(document.querySelector(".pr-reading-sample")).backgroundColor');
 await main.locator('#pr-message-appearance').selectOption('dark');assert.equal(await run('AppEnv.config.get("core.reading.emailRenderMode")'),'dark');
 await until(()=>run('!!document.querySelector(".pr-reading-sample.dark")'),'dark sample responds immediately');
 assert.notEqual(await run('getComputedStyle(document.querySelector(".pr-reading-sample")).backgroundColor'),lightSample);
 assert.equal(await run('getComputedStyle(document.querySelector(".pr-reading-sample")).color'),'rgb(255, 255, 255)');
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:740,height:700,deviceScaleFactor:1,mobile:false});
 await shot('compact-dark-appearance');
 assert(await run(`(()=>{const page=document.querySelector('.pr-settings-page');return page.scrollWidth<=page.clientWidth+1 && page.getBoundingClientRect().right<=innerWidth;})()`));
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
 await main.locator('#pr-tray-style').selectOption('none');assert.equal(await run('AppEnv.config.get("core.workspace.trayIconStyle")'),'none');
 if(appearanceOnly){
  await cdp.send('Emulation.clearDeviceMetricsOverride');
  await run('require("@electron/remote").getCurrentWindow().setContentSize(740,700);true');
  await until(()=>run('require("@electron/remote").getCurrentWindow().getContentSize().join(",")==="740,700"'),'native 740×700 window');
  await main.locator('#interface-zoom-slider').focus();
  await main.keyboard.press('End');
  await until(()=>run('Math.abs(require("electron").webFrame.getZoomFactor()-1.4)<0.001'),'native window at 140 percent');
  await main.locator('#interface-zoom-slider').focus();
  assert(await run(`document.querySelector('#interface-zoom-slider').getBoundingClientRect().width>=120`));
  await shot('native-compact-140-slider');
  for(const selector of ['#interface-zoom-slider','.pr-scale-control button','#pr-message-appearance','#pr-tray-style']){
   const control=main.locator(selector);
   await control.focus();
   assert(await run(`(()=>{
     const control=document.querySelector(${JSON.stringify(selector)});
     const r=control.getBoundingClientRect();
     return document.activeElement===control && r.left>=0 && r.right<=innerWidth+1 && r.top>=0 && r.bottom<=innerHeight+1 && r.width>=24;
   })()`),selector+' reachable at native 740×700 and 140%');
  }
  await main.locator('#pr-tray-style').selectOption('red');
  assert.equal(await run('AppEnv.config.get("core.workspace.trayIconStyle")'),'red');
  assert(await run(`(()=>{
    const select=document.querySelector('#pr-tray-style');
    const width=select.getBoundingClientRect().width;
    const available=select.parentElement.getBoundingClientRect().width;
    const canvas=document.createElement('canvas');
    const context=canvas.getContext('2d');
    context.font=getComputedStyle(select).font;
    const labelWidth=context.measureText(select.selectedOptions[0].text).width;
    return width>=Math.min(206,available)-1 && width>=labelWidth+26;
  })()`),'Longest tray option fits in the zoomed dropdown');
  assert(await run(`[...document.querySelectorAll('.pr-appearance .pr-setting-row')].every(row=>{
    const label=row.querySelector('span').getBoundingClientRect();
    const select=row.querySelector('select').getBoundingClientRect();
    return Math.abs(label.left-select.left)<1 && select.top>=label.bottom;
  })`),'Stacked labels and selectors align left at native zoom');
  await main.locator('#pr-tray-style').focus();
  await shot('native-compact-140');
  await main.locator('.pr-scale-control button').focus();
  await main.keyboard.press('Enter');
  await until(()=>run('require("electron").webFrame.getZoomFactor()===1'),'native window zoom reset');
  await main.locator('#pr-message-appearance').selectOption('light');
  await until(()=>run('!!document.querySelector(".pr-reading-sample.light")'),'light sample restored');
  const result={zoomConfigAndWindow:true,zoomResetFocusAndDisabled:true,readingPreviewFollowsMode:true,appearanceNarrow740:true,nativeCompact140:true,trayConfig:true,expectedSMTPSubmissions:0};
  fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');
  console.log('PASS appearance settings',JSON.stringify(result));
  return;
 }
 await action('[data-settings-tab="Folders"]');
 await until(()=>run('!!Array.from(document.querySelectorAll(".pr-folders option")).find(o=>o.value==="Paper Reed Review")'),'fixture folder synced');
 await main.locator('select[aria-label="垃圾邮件文件夹"]').selectOption('Paper Reed Review');
 await until(()=>run(`require('mailspring-exports').CategoryStore.categories().some(c=>c.accountId===${JSON.stringify(account.id)} && c.path==='Paper Reed Review' && c.role==='spam')`),'native folder role saved');
 await main.locator('.pr-folders summary').click();await main.locator('#pr-container-folder').fill('Mail/Personal');await action('.pr-folders h2');
 await until(()=>run('AppEnv.config.get("containerFolderDefault")==="Mail/Personal"'),'container default saved');await shot('folders-saved');
 await action('[data-settings-tab="Mail Rules"]');
 // An inert rule for another account checks global-vs-visible ordering without a second sync client.
 await run(`require('mailspring-exports').Actions.addMailRule({accountId:'pr-other-fixture',name:'Other account fixture',disabled:true});true`);
 await action('.pr-rule-toolbar button');
 await until(async()=>(await rules()).length===1,'rule created');assert((await rules())[0].disabled);
 await main.locator('#pr-rule-name').fill('设计评审 · 标星');
 await main.locator('.pr-rule-conditions select[aria-label="条件或动作类型"]').selectOption('subject');
 await main.locator('.pr-rule-conditions input').fill('Design review');
 await main.locator('.pr-rule-actions select[aria-label="条件或动作类型"]').selectOption('star');
 await main.locator('select[aria-label="条件匹配方式"]').selectOption('any');
 await action('.pr-rule-conditions button[aria-label="添加一行"]');await until(async()=>(await rules())[0].conditions.length===2,'condition added');
 await main.locator('.pr-rule-conditions .well-row').last().locator('button[aria-label="移除此行"]').click();await until(async()=>(await rules())[0].conditions.length===1,'condition removed');
 await action('.pr-rule-enabled input');await until(async()=>!(await rules())[0].disabled,'rule enabled');await shot('rule-editor');
 await action('.pr-rule-toolbar button');await until(async()=>(await rules()).length===2,'second rule');
 await main.locator('#pr-rule-name').fill('第二条规则');await action('.pr-rule-order button:first-child');await until(async()=>(await rules())[0].name==='第二条规则','rule reordered');
 await action('.pr-rule-order button:last-child');await until(async()=>(await rules())[1].name==='第二条规则','account-scoped move down');
 await action('.pr-rule-order button:first-child');await until(async()=>(await rules())[0].name==='第二条规则','account-scoped move up');
 await action('.pr-rule-footer button');await until(()=>run('document.querySelector(".pr-rule-footer").innerText.includes("确认删除")'),'delete confirmation');await shot('rule-delete');
 await action('.pr-rule-footer button:first-of-type');assert.equal((await rules()).length,2);
 await action('.pr-rule-footer button');await action('.pr-rule-footer button:last-of-type');await until(async()=>(await rules()).length===1,'rule deleted');
 assert.equal(await main.locator('#pr-rule-name').inputValue(),'设计评审 · 标星');
 await main.locator('.pr-rule-bulk summary').click();await action('.pr-rule-bulk > button');await shot('rule-run-confirm');
 await action('.pr-rule-run-confirm button:first-of-type');assert.deepEqual(await run('require("mailspring-exports").MailRulesStore.reprocessState()'),{});
 await action('.pr-rule-bulk > button');await action('.pr-rule-run-confirm button:last-of-type');
 await until(()=>run(`(()=>{const {DatabaseStore,Message}=require('mailspring-exports');return DatabaseStore.findAll(Message).where({accountId:${JSON.stringify(account.id)}}).then(ms=>ms.some(m=>m.subject.includes('Design review') && m.starred));})()`),'rule applied to fixture message');
 await action('[data-settings-tab="Folders"]');assert.equal(await main.locator('select[aria-label="垃圾邮件文件夹"]').inputValue(),'Paper Reed Review');
 await action('[data-settings-tab="Appearance"]');assert.equal(await main.locator('#pr-message-appearance').inputValue(),'dark');await main.locator('#pr-message-appearance').selectOption('light');
 await cdp.send('Emulation.setDeviceMetricsOverride',{width:900,height:700,deviceScaleFactor:1,mobile:false});
 for(const [id,name] of [['Appearance','appearance'],['Mail Rules','rules'],['Folders','folders']]){
  await action(`[data-settings-tab="${id}"]`);await shot('compact-'+name);
  assert(await run(`(()=>{const e=document.querySelector('.pr-settings-page');return e.scrollWidth<=e.clientWidth+1 && e.getBoundingClientRect().right<=innerWidth;})()`),name+' compact overflow');
 }
 await until(()=>run(`JSON.parse(localStorage.getItem('MailRules-V2') || '[]').some(r=>r.name==='设计评审 · 标星' && r.conditionMode==='any' && r.actions[0].templateKey==='star')`),'debounced rule persistence');
 const result={zoomConfigAndWindow:true,zoomResetFocusAndDisabled:true,readingPreviewFollowsMode:true,appearanceNarrow740:true,appearancePersisted:true,trayConfig:true,nativeFolderMapping:true,containerDefaultSaved:true,newRulePaused:true,ruleFieldsSaved:true,conditionAddRemove:true,ruleReorder:true,accountScopedRuleOrder:true,ruleDeleteCancelConfirm:true,bulkCancel:true,ruleAppliedToFixtureMessage:true,compactLayouts:true,expectedSMTPSubmissions:0};
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log('PASS organization settings',JSON.stringify(result));
};
