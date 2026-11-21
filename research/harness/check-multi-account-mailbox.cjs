const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),{spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
const [upstream,work,out]=process.argv.slice(2),r=createRequire(path.join(upstream,'package.json'));
const {_electron}=r('playwright'),accounts=JSON.parse(fs.readFileSync(path.join(work,'accounts.json')));
const config=path.join(work,'config'),token=randomUUID(),tokenFile=path.join(work,'token');
fs.mkdirSync(config);fs.writeFileSync(tokenFile,token,{mode:0o600});
let app,main,cdp,port;const results=[];
async function until(fn,label,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,200));}throw Error('Timeout: '+label);}
async function evaluate(expression){const v=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(v.exceptionDetails)throw Error(JSON.stringify(v.exceptionDetails));return v.result.value;}
async function cli(command,input,error=false){const child=spawn(process.execPath,[path.resolve(__dirname,'../cli/paper-reed.cjs'),command],{env:{...process.env,PAPER_REED_UPSTREAM:upstream,PAPER_REED_TOKEN_FILE:tokenFile,PAPER_REED_MCP_URL:`http://127.0.0.1:${port}/mcp`},stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.stdin.end(JSON.stringify(input));const code=await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject)});error?assert.notEqual(code,0):assert.equal(code,0,stdout+stderr);return JSON.parse(stdout||stderr);}
async function truth(account,messageId='same-message@example.test',options={}){const result=path.join(work,'truth-result.json');fs.writeFileSync(path.join(work,'truth-request.json'),JSON.stringify({account,messageId,...options}));await until(()=>fs.existsSync(result),'server truth');const value=JSON.parse(fs.readFileSync(result));fs.unlinkSync(result);return value;}
async function complete(item){assert(item.taskId,JSON.stringify(item));return until(async()=>{const v=await cli('change-get',{accountId:item.accountId,taskId:item.taskId});assert(!['failed','rejected','cancelled'].includes(v.status),JSON.stringify(v));return v.status==='succeeded'?v:false},'remote complete');}
async function undo(item){return complete(await cli('undo',{accountId:item.accountId,taskId:item.taskId}));}
function pass(name){results.push(name);console.log('PASS',name);}
async function start(){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.PLAYWRIGHT;app=await _electron.launch({executablePath:r('electron'),args:[path.join(upstream,'app'),'--dev','--no-sandbox','--config-dir-path',config],env,timeout:30000});// Electron handles its own beforeunload dialog; prevent Playwright from accepting it again.
for(const p of app.windows())p.on('dialog',()=>{});app.on('window',p=>p.on('dialog',()=>{}));app.process().stderr.on('data',b=>fs.appendFileSync(path.join(work,'electron.log'),b));main=await until(()=>app.windows().find(p=>{try{return JSON.parse(new URL(p.url()).searchParams.get('loadSettings')).windowType==='default'}catch{return false}}),'main');main.on('console',m=>fs.appendFileSync(path.join(work,'renderer.log'),m.text()+'\n'));cdp=await app.context().newCDPSession(main);await until(()=>evaluate('typeof AppEnv!=="undefined" && !!AppEnv.mailsyncBridge'),'bridge');}
async function stop(){const p=app.process();await app.evaluate(({app})=>app.quit());await until(()=>p.exitCode!==null,'normal quit');app=null;}
(async()=>{
 const reservation=require('node:net').createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const stored=accounts.map(a=>{const x=JSON.parse(JSON.stringify(a));delete x.settings.imap_password;delete x.settings.smtp_password;return x});
 fs.writeFileSync(path.join(config,'config.json'),JSON.stringify({'*':{env:'production',accounts:stored,accountsVersion:2,core:{themes:['ui-light'],paperReed:{enabled:true},workspace:{mode:'split'},sending:{undoSend:0,sounds:false},mcp:{enabled:true,port,token,accessLevel:'read-write',enabledAccounts:Object.fromEntries(accounts.map(a=>[a.id,{enabled:true}]))}}}}));
 await start();
 await evaluate(`(async()=>{const km=require(${JSON.stringify(path.join(upstream,'app/src/key-manager'))}).default;for(const a of require('mailspring-exports').AccountStore.accounts()){await km.replacePassword(a.emailAddress+'-imap','pass');await km.replacePassword(a.emailAddress+'-smtp','pass');await AppEnv.mailsyncBridge.forceRelaunchClient(a);}return true})()`);
 await until(async()=>{try{return (await cli('search',{accountId:accounts[0].id,query:'in:inbox',limit:10})).length===1 && (await cli('search',{accountId:accounts[1].id,query:'in:inbox',limit:10})).length===1}catch{return false}},'both accounts sync');
 const ids=[];for(const a of accounts)ids.push((await cli('search',{accountId:a.id,query:'in:inbox',limit:10}))[0].id);
 assert.notEqual(ids[0],ids[1]);const targets=accounts.map((a,i)=>({accountId:a.id,threadId:ids[i]}));
 await until(()=>evaluate('document.querySelectorAll(".pr-mail-row").length===2'),'unified inbox');
 if(process.env.PAPER_REED_ARCHIVE_PAGE_CHECK){
  await require('./check-archive-page.cjs')({main,cdp,out,accounts,ids,cli,truth,until,evaluate,pass,complete,undo});
  await stop();
  return;
 }
 if(process.env.PAPER_REED_SPAM_PAGE_CHECK){
  await require('./check-spam-page.cjs')({main,cdp,out,accounts,cli,truth,until,evaluate,pass,complete,undo});
  await stop();
  return;
 }
 if(process.env.PAPER_REED_TRASH_PAGE_CHECK){
  await require('./check-trash-page.cjs')({main,cdp,out,accounts,cli,truth,until,evaluate,pass,complete,undo});
  await stop();
  return;
 }
 const otherRule=await cli('rule-save', {
   accountId:accounts[1].id,name:'第二邮箱规则',field:'subject',
   query:'shared subject',action:'category',value:'notifications',enabled:false,
 });
 await main.locator('.pr-sidebar button').filter({hasText:'设置'}).click();
 await main.locator('[data-settings-tab="Mail Rules"]').click();
 const mailbox=main.getByRole('combobox',{name:'规则邮箱'});
 await mailbox.focus();
 // Both fixture addresses start with “a”, so type-ahead advances to the other mailbox.
 await main.keyboard.press('a');
 await until(()=>evaluate(`document.activeElement.matches('select[aria-label="规则邮箱"]') &&
   document.activeElement.value===${JSON.stringify(accounts[1].id)}`),'rule account switch restores focus');
 await until(()=>evaluate('document.querySelector("#pr-local-rule-name").value==="第二邮箱规则"'),'rule from second account');
 await mailbox.selectOption(accounts[0].id);
 await until(()=>evaluate(`document.activeElement.matches('select[aria-label="规则邮箱"]') &&
   document.activeElement.value===${JSON.stringify(accounts[0].id)}`),'reverse rule account switch restores focus');
 await cli('rule-delete',{accountId:accounts[1].id,id:otherRule.id});
 await main.locator('.pr-preferences-nav button').filter({hasText:'返回邮件'}).click();
 pass('mail rule account switch keeps focus and loads the selected account rules');
 await main.locator('#pr-account').selectOption(accounts[0].id);await until(()=>evaluate('document.querySelectorAll(".pr-mail-row").length===1'),'filter Gmail');
 await main.locator('#pr-account').selectOption(accounts[1].id);await until(()=>evaluate(`document.querySelector('.pr-mail-row')?.dataset.threadId===${JSON.stringify(ids[1])}`),'filter IMAP');
 await main.locator('#pr-account').selectOption('');pass('unified inbox, account filters, identical Message-ID isolated');
 const before=await truth(0);assert(before[0].labels.includes('Projects'));assert(before[0].labels.includes('\\Inbox'));
 // GUI mixed-provider archive, followed by CLI receipts and server truth.
 await until(()=>evaluate('document.querySelectorAll(".pr-mail-row").length===2'),'unified list');
 for(const checkbox of await main.locator('.pr-mail-item > input').all())await checkbox.check();
 await main.locator('[data-mail-action=archive]').click();
 await until(()=>evaluate('document.querySelector(".pr-mail-receipt")?.innerText.includes("2 / 2 完成")'),'GUI archive');
 assert.deepEqual(await truth(0),[{folder:'[Gmail]/All Mail',labels:['Projects']}]);
 assert((await truth(1)).some(x=>x.folder==='Archive'));pass('GUI mixed-provider archive changes correct server state and preserves custom labels');
 await main.locator('.pr-mail-receipt button').filter({hasText:'撤销'}).click();
 await until(()=>evaluate('document.querySelector(".pr-mail-receipt")?.innerText.includes("2 / 2 完成")'),'GUI undo');
 await until(async()=>JSON.stringify(await truth(0))===JSON.stringify(before),'Gmail GUI undo settled');
 pass('GUI mixed-provider undo restores original placements');
 // The Gmail thread includes an archived sibling. Archive undo must leave that sibling archived.
 const archive=await complete((await cli('archive',{targets:[targets[0]],requestId:randomUUID()})).items[0]);
 await undo(archive);assert((await truth(0))[0].labels.includes('\\Inbox'));
 const sibling=await cli('thread-get',{threadId:ids[0]});assert(sibling.messages.length>=2);
 const siblingMid=sibling.messages.find(m=>m.headerMessageId!=='same-message@example.test').headerMessageId;
 assert(!(await truth(0,siblingMid))[0].labels.includes('\\Inbox'));pass('per-message archive undo preserves mixed Inbox membership');
 for(const action of ['spam','trash']){
  const moved=await complete((await cli(action,{targets:[targets[0]],requestId:randomUUID()})).items[0]);
  const states=await truth(0);assert.equal(states[0].folder,action==='spam'?'[Gmail]/Spam':'[Gmail]/Trash');assert(states[0].labels.includes('Projects'));
  await undo(moved);assert.deepEqual(await truth(0),before);assert(!(await truth(0,siblingMid))[0].labels.includes('\\Inbox'));
  pass(action+' and exact undo preserve Gmail custom labels and mixed Inbox membership');
 }
 const again=await cli('archive',{targets,requestId:randomUUID()});for(const item of again.items)await complete(item);
 const restore=await cli('restore-inbox',{targets,requestId:randomUUID()});for(const item of restore.items)await complete(item);
 assert((await truth(0))[0].labels.includes('\\Inbox'));assert((await truth(1)).some(x=>x.folder==='INBOX'));pass('CLI restore inbox for Gmail and ordinary Archive');
 const wrong=await cli('archive',{targets:[{accountId:accounts[1].id,threadId:ids[0]}],requestId:randomUUID()},true);assert.equal(wrong.items[0].status,'rejected');
 await evaluate(`AppEnv.config.set('core.mcp.enabledAccounts',${JSON.stringify({[accounts[0].id]:{enabled:true},[accounts[1].id]:{enabled:false}})});true`);
 const denied=await cli('archive',{targets:[targets[1]],requestId:randomUUID()},true);assert(denied.error || denied.items?.[0].status==='rejected');assert((await truth(1)).some(x=>x.folder==='INBOX'));
 await evaluate(`AppEnv.config.set('core.mcp.enabledAccounts',${JSON.stringify(Object.fromEntries(accounts.map(a=>[a.id,{enabled:true}])))});true`);
 pass('wrong-account reference and excluded account rejected without moving mail');
 for(const a of accounts){const d=await cli('draft-create',{accountId:a.id,to:[{email:'recipient@example.test'}],subject:'Account-bound draft',body:'Account test'});const read=await cli('draft-get',{accountId:a.id,draftId:d.draftId});assert.equal(read.accountId,a.id);await cli('draft-get',{accountId:accounts.find(x=>x.id!==a.id).id,draftId:d.draftId},true);}
 pass('drafts remain bound to their account');
 // A revoked folder/label grant must also block undo/status of an earlier operation.
 const restricted=await complete((await cli('archive',{targets:[targets[0]],requestId:randomUUID()})).items[0]);
 const project=(await cli('folders',{accountId:accounts[0].id})).find(f=>f.path==='Projects'||f.name==='Projects');assert(project);
 await evaluate(`AppEnv.config.set('core.mcp.enabledAccounts',${JSON.stringify({[accounts[0].id]:{enabled:true,excludedFolderIds:[project.id]},[accounts[1].id]:{enabled:true}})});true`);
 await cli('undo',{accountId:accounts[0].id,taskId:restricted.taskId},true);
 await evaluate(`AppEnv.config.set('core.mcp.enabledAccounts',${JSON.stringify(Object.fromEntries(accounts.map(a=>[a.id,{enabled:true}])))});true`);
 await undo(restricted);pass('changed Gmail label grant blocks historical undo');
 await evaluate(`(()=>{const a=require('mailspring-exports').AccountStore.accounts()[0].clone();a.settings.imap_host='imap.gmail.com';if(!a.usesLabels()||a.usesOAuth())throw Error('Mailbox semantics coupled to authentication');return true})()`);
 async function password(value){fs.writeFileSync(path.join(work,'truth-request.json'),JSON.stringify({account:1,password:value}));const file=path.join(work,'truth-result.json');await until(()=>fs.existsSync(file),'credential rotation');fs.unlinkSync(file);}
 await password('changed-fixture-password');
 await evaluate(`AppEnv.mailsyncBridge.forceRelaunchClient(require('mailspring-exports').AccountStore.accountForId(${JSON.stringify(accounts[1].id)})).then(()=>true)`);
 await until(()=>evaluate(`!!require('mailspring-exports').AccountStore.accountForId(${JSON.stringify(accounts[1].id)}).syncError`),'one account auth failure');
 const healthy=await complete((await cli('archive',{targets:[targets[0]],requestId:randomUUID()})).items[0]);await undo(healthy);
 await password('pass');await evaluate(`AppEnv.mailsyncBridge.forceRelaunchClient(require('mailspring-exports').AccountStore.accountForId(${JSON.stringify(accounts[1].id)})).then(()=>true)`);
 await until(()=>evaluate(`!require('mailspring-exports').AccountStore.accountForId(${JSON.stringify(accounts[1].id)}).syncError`),'one account recovery');
 pass('one provider authentication failure does not block the other account');
 const pendingUndo=await complete((await cli('archive',{targets:[targets[0]],requestId:randomUUID()})).items[0]);await stop();await start();await until(async()=>{try{return (await cli('doctor')).ok}catch{return false}},'CLI restart');await undo(pendingUndo);assert.deepEqual(await truth(0),before);pass('restart retains both accounts, CLI and exact Gmail undo');
 fs.writeFileSync(path.join(work,'truth-request.json'),JSON.stringify({account:0,markSent:true}));
 await until(()=>fs.existsSync(path.join(work,'truth-result.json')),'mark sent fixture');fs.unlinkSync(path.join(work,'truth-result.json'));
 await until(()=>evaluate(`(async()=>{const {DatabaseStore,Message}=require('mailspring-exports');const rows=await DatabaseStore.findAll(Message).where({accountId:${JSON.stringify(accounts[0].id)}});return rows.some(m=>(m.labels||[]).includes('\\\\Sent'))})()`),'Sent label sync');
 const sentBefore=await truth(0);
 const sentArchive=await complete((await cli('archive',{targets:[targets[0]],requestId:randomUUID()})).items[0]);await undo(sentArchive);
 assert.deepEqual(await truth(0),sentBefore);pass('archive and undo preserve Sent membership without writing read-only system labels');

 // Use different automatic recipients so a wrong account default is observable.
 await evaluate(`(()=>{const {Actions}=require('mailspring-exports');${accounts.map((a,i)=>`Actions.updateAccount(${JSON.stringify(a.id)},{autoaddress:{type:'bcc',value:'audit${i}@example.test'}});`).join('')}AppEnv.config.set('core.sending.defaultAccountIdForSend',${JSON.stringify(accounts[1].id)});return true})()`);
 await until(()=>evaluate(`require('mailspring-exports').AccountStore.accounts().every((a,i)=>a.autoaddress.value==='audit'+i+'@example.test')`),'per-account automatic recipients');
 const explicit=await evaluate(`(async()=>{const d=await require('mailspring-exports').DraftFactory.createDraft({accountId:${JSON.stringify(accounts[0].id)}});return {accountId:d.accountId,from:d.from.map(c=>c.email),bcc:d.bcc.map(c=>c.email)}})()`);
 assert.equal(explicit.accountId,accounts[0].id);assert.deepEqual(explicit.from,[accounts[0].emailAddress]);assert.deepEqual(explicit.bcc,['audit0@example.test']);
 pass('explicit draft account controls sender and automatic recipients');
 async function drafts(){return evaluate(`(async()=>{const {DatabaseStore,Message}=require('mailspring-exports');const rows=await DatabaseStore.findAll(Message).where({draft:true}).include(Message.attributes.body);return rows.map(d=>({accountId:d.accountId,draftId:d.headerMessageId,body:d.body}))})()`)}
 async function saveEditor(marker){
  const editor=main.locator('[contenteditable=true]').first();await editor.waitFor();await editor.click();await main.keyboard.insertText(marker);
  await main.locator('[data-mailbox=drafts]').click();
  const saved=await until(async()=>(await drafts()).find(d=>d.body?.includes(marker)),'saved composer '+marker);
  await main.locator('.pr-route-list').waitFor();
  return saved;
 }
 async function composeFor(filter,expected,marker){
  await main.locator('#pr-account').selectOption(filter);
  const caption=filter?accounts.find(a=>a.id===filter).emailAddress:'所有已连接邮箱';
  await until(async()=>(await main.locator('.pr-list-caption').innerText()).includes(caption),'account navigation settled');
  await main.locator('.pr-compose-button').click();
  await until(async()=>(await main.locator('.from-field').innerText()).includes(accounts[expected].emailAddress),'composer sender');
  const saved=await saveEditor(marker);assert.equal(saved.accountId,accounts[expected].id);
  const dto=await cli('draft-get',{accountId:saved.accountId,draftId:saved.draftId});
  assert.equal(dto.from[0].email,accounts[expected].emailAddress);assert.deepEqual(dto.bcc.map(c=>c.email),[`audit${expected}@example.test`]);
  return saved;
 }
 const defaultDraft=await composeFor('',1,'Unified sender fixture');
 pass('unified composer honors configured sender and CLI exposes the same identity');
 await composeFor(accounts[0].id,0,'Selected sender fixture');
 pass('selected mailbox overrides default sender without importing another account Bcc');
 await main.locator('[data-mailbox=inbox]').click();
 await main.locator(`.pr-mail-row[data-thread-id="${ids[0]}"]`).click();
 await main.locator('.footer-reply-area').first().click();
 await until(async()=>(await main.locator('.from-field').innerText()).includes(accounts[0].emailAddress),'reply sender');
 const reply=await saveEditor('Reply sender fixture');
 const replyDTO=await cli('draft-get',{accountId:reply.accountId,draftId:reply.draftId});
 assert.equal(reply.accountId,accounts[0].id);assert.equal(replyDTO.from[0].email,accounts[0].emailAddress);assert.deepEqual(replyDTO.bcc.map(c=>c.email),['audit0@example.test']);
 pass('reply stays with original account and its automatic recipients');
 await evaluate(`AppEnv.config.set('core.sending.defaultAccountIdForSend',${JSON.stringify(accounts[0].id)});true`);
 await stop();await start();
 await until(()=>evaluate('!!document.querySelector("#pr-account")'),'workspace after restart');
 await until(async()=>{try{return (await cli('doctor')).ok}catch{return false}},'CLI after sender restart');
 await main.locator('#pr-account').selectOption('');await main.locator('[data-mailbox=drafts]').click();
 await main.locator(`[data-draft-id="${defaultDraft.draftId}"]`).click();
 await until(async()=>(await main.locator('.from-field').innerText()).includes(accounts[1].emailAddress),'saved identity after restart');
 const reopened=await cli('draft-get',{accountId:defaultDraft.accountId,draftId:defaultDraft.draftId});assert.equal(reopened.from[0].email,accounts[1].emailAddress);
 pass('changing default sender and restarting does not change an existing draft identity');
 await main.locator('[data-mailbox=inbox]').click();
 await evaluate(`AppEnv.config.set('core.sending.defaultAccountIdForSend','removed-account');true`);
 await composeFor('',0,'Removed default sender fixture');
 pass('removed default account falls back to an available account for new mail');
 // Gmail uses All Mail UIDs, but only each message's Inbox membership is incoming evidence.
 const triage="require(AppEnv.getLoadSettings().resourcePath+'/src/services/mail-core/local-triage')";
 async function appendFixture(account,folder,id,number){
  fs.writeFileSync(path.join(work,'truth-request.json'),JSON.stringify({account,append:{folder,id,number}}));
  const file=path.join(work,'truth-result.json');await until(()=>fs.existsSync(file),'append fixture');fs.unlinkSync(file);
  await until(()=>evaluate(`require('mailspring-exports').DatabaseStore._query('SELECT id FROM Message WHERE accountId=? AND headerMessageId=?',[${JSON.stringify(accounts[account].id)},${JSON.stringify(id)}]).then(rows=>rows.length===1)`),'new fixture synced');
  await evaluate(`${triage}.processLocalRules()`);await evaluate(`${triage}.reconcileLocalSnoozes()`);
 }
 for(let index=0;index<accounts.length;index++){
  const target=targets[index],state=async()=>(await cli('local-state',{targets:[target]}))[target.threadId];
  const label=await cli('label-create',{name:'Incoming '+index,color:'#688177'});
  await cli('rule-save',{accountId:target.accountId,name:'Incoming fixture',field:'subject',query:'Shared',action:'label',value:label.id,enabled:true});
  await cli('snooze',{targets:[target],until:new Date(Date.now()+3600000).toISOString()});
  assert((await state()).snoozeUntil);assert(!(await state()).labels.some(l=>l.id===label.id));
  if(index===0){
   for(const [folder,suffix,n] of [['[Gmail]/All Mail','archived',21],['[Gmail]/Sent Mail','sent',22]]){
    await appendFixture(index,folder,`rule-${suffix}@example.test`,n);
    const current=await state();assert(current.snoozeUntil,suffix+' sibling must not wake snooze');
    assert(!current.labels.some(l=>l.id===label.id),suffix+' sibling must not trigger incoming rule');
   }
   pass('Gmail archived and Sent siblings do not wake snooze or run incoming rules');
  }
  await appendFixture(index,'INBOX',`rule-incoming-${index}@example.test`,23+index);
  await until(async()=>{const v=await state();return !v.snoozeUntil && v.labels.some(l=>l.id===label.id)},'incoming wakes snooze and applies rule');
  pass((index===0?'Gmail':'ordinary IMAP')+' snooze and enabled rules follow new incoming mail');
 }
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:results,realProviderAccounts:false,smtpSubmissions:0},null,2)+'\n');
 await stop();
})().catch(async e=>{console.error(e.stack);if(main){await main.screenshot({path:path.join(work,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(work,'failure.txt'),await main.locator('body').innerText().catch(()=>''));}process.exitCode=1}).finally(()=>{if(app)app.process().kill('SIGKILL')});
