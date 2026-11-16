const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async({main,cdp,account,evaluate,until})=>{
 const out=path.resolve(__dirname,'../organization-validation-2026-11-16');fs.mkdirSync(out,{recursive:true});
 const run=s=>evaluate(cdp,s),action=s=>main.locator(s).first().click();
 const before=process.env.PAPER_REED_ORGANIZATION_PHASE==='before';
 const shot=async name=>{await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const r=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true});fs.writeFileSync(path.join(out,`${before?'before':'after'}-${name}.png`),Buffer.from(r.data,'base64'));};
 await main.locator('.pr-sidebar button').filter({hasText:'设置'}).click();
 for(const [id,selector,name] of [['Appearance','.container-appearance','appearance'],['Mail Rules','.container-mail-rules','rules-empty'],['Folders','.category-mapper-container','folders']]){
  await action(`[data-settings-tab="${id}"]`);await until(()=>run(`!!document.querySelector(${JSON.stringify(selector)})`),id);await shot(name);
 }
 if(before){console.log('PASS organization baseline');return;}
 const rules=()=>run(`require('mailspring-exports').MailRulesStore.rulesForAccountId(${JSON.stringify(account.id)})`);
 await action('[data-settings-tab="Appearance"]');
 const scale=Number(await run('AppEnv.config.get("core.workspace.interfaceZoom")'));
 await main.locator('#interface-zoom-slider').focus();await main.keyboard.press('ArrowRight');
 await until(()=>run(`Math.abs(Number(AppEnv.config.get('core.workspace.interfaceZoom'))-${scale+0.05})<0.001`),'zoom saved');
 assert(Math.abs((await run('require("electron").webFrame.getZoomFactor()'))-(scale+0.05))<0.001);
 await action('.pr-scale-control button');await until(()=>run('require("electron").webFrame.getZoomFactor()===1'),'zoom reset');
 await main.locator('#pr-message-appearance').selectOption('dark');assert.equal(await run('AppEnv.config.get("core.reading.emailRenderMode")'),'dark');
 await main.locator('#pr-tray-style').selectOption('none');assert.equal(await run('AppEnv.config.get("core.workspace.trayIconStyle")'),'none');
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
 const result={zoomConfigAndWindow:true,appearancePersisted:true,trayConfig:true,nativeFolderMapping:true,containerDefaultSaved:true,newRulePaused:true,ruleFieldsSaved:true,conditionAddRemove:true,ruleReorder:true,accountScopedRuleOrder:true,ruleDeleteCancelConfirm:true,bulkCancel:true,ruleAppliedToFixtureMessage:true,compactLayouts:true,expectedSMTPSubmissions:0};
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log('PASS organization settings',JSON.stringify(result));
};
