const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),{spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
const [upstream,work,out]=process.argv.slice(2),r=createRequire(path.join(upstream,'package.json'));
const {_electron}=r('playwright'),accounts=JSON.parse(fs.readFileSync(path.join(work,'accounts.json')));
const config=path.join(work,'config'),token=randomUUID(),tokenFile=path.join(work,'token');
fs.mkdirSync(config);fs.writeFileSync(tokenFile,token,{mode:0o600});
let app,main,cdp,port;const results=[];
async function until(fn,label,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,200));}throw Error('Timeout: '+label);}
async function evaluate(expression){const v=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(v.exceptionDetails)throw Error(JSON.stringify(v.exceptionDetails));return v.result.value;}
async function cli(command,input,error=false){const child=spawn(path.join(upstream,'app','paper-reed-cli'),[command],{env:{...process.env,PAPER_REED_UPSTREAM:upstream,PAPER_REED_TOKEN_FILE:tokenFile,PAPER_REED_MCP_URL:`http://127.0.0.1:${port}/mcp`},stdio:['pipe','pipe','pipe']});let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.stdin.end(JSON.stringify(input));const code=await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject)});error?assert.notEqual(code,0):assert.equal(code,0,stdout+stderr);return JSON.parse(stdout||stderr);}
function pass(name){results.push(name);console.log('PASS',name);}
async function start(offline=false){const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.PLAYWRIGHT;app=await _electron.launch({executablePath:r('electron'),args:[path.join(upstream,'app'),'--dev','--no-sandbox','--config-dir-path',config],env,timeout:30000});// Electron handles its own beforeunload dialog; prevent Playwright from accepting it again.
for(const p of app.windows())p.on('dialog',()=>{});app.on('window',p=>p.on('dialog',()=>{}));await app.context().setOffline(offline);app.process().stderr.on('data',b=>fs.appendFileSync(path.join(work,'electron.log'),b));main=await until(()=>app.windows().find(p=>{try{return JSON.parse(new URL(p.url()).searchParams.get('loadSettings')).windowType==='default'}catch{return false}}),'main');main.on('console',m=>fs.appendFileSync(path.join(work,'renderer.log'),m.text()+'\n'));cdp=await app.context().newCDPSession(main);await until(()=>evaluate('typeof AppEnv!=="undefined" && !!AppEnv.mailsyncBridge'),'bridge');}
async function stop(){const p=app.process();await app.evaluate(({app})=>app.quit());await until(()=>p.exitCode!==null,'normal quit');app=null;}
(async()=>{
 const reservation=require('node:net').createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));port=reservation.address().port;await new Promise(r=>reservation.close(r));
 const stored=accounts.map(a=>{const x=JSON.parse(JSON.stringify(a));delete x.settings.imap_password;delete x.settings.smtp_password;return x});
 fs.writeFileSync(path.join(config,'config.json'),JSON.stringify({'*':{env:'production',accounts:stored,accountsVersion:2,core:{themes:['ui-light'],paperReed:{enabled:true},workspace:{mode:'split'},sending:{undoSend:0,sounds:false},mcp:{enabled:true,port,token,accessLevel:'read-write-send',enabledAccounts:Object.fromEntries(accounts.map(a=>[a.id,{enabled:true}]))}}}}));
 await start();
 await evaluate(`(async()=>{const km=require(${JSON.stringify(path.join(upstream,'app/src/key-manager'))}).default;for(const a of require('mailspring-exports').AccountStore.accounts()){await km.replacePassword(a.emailAddress+'-imap','pass');await km.replacePassword(a.emailAddress+'-smtp','pass');await AppEnv.mailsyncBridge.forceRelaunchClient(a);}return true})()`);
 await until(async()=>{try{return (await cli('search',{accountId:accounts[0].id,query:'in:inbox',limit:10})).length===1 && (await cli('search',{accountId:accounts[1].id,query:'in:inbox',limit:10})).length===1}catch{return false}},'both accounts sync');
 const ids=[];for(const a of accounts)ids.push((await cli('search',{accountId:a.id,query:'in:inbox'}))[0].id);
 // The SMTP listener stays available: no-send assertions exercise the product boundary.
 async function fixture(action,account){
  const result=path.join(work,'fixture-result.json');
  fs.writeFileSync(path.join(work,'fixture-request.json'),JSON.stringify({action,account}));
  await until(()=>fs.existsSync(result),'fixture '+action);
  const value=JSON.parse(fs.readFileSync(result));fs.unlinkSync(result);return value;
 }
 async function sendRows(){return evaluate("require('mailspring-exports').DatabaseStore._query('SELECT phase, sentCopy FROM PaperReedSend')")}
 async function waitCLI(){await until(async()=>{try{return (await cli('doctor')).ok}catch{return false}},'CLI ready')}
 await waitCLI();
 for(const id of ids)await until(async()=>JSON.stringify(await cli('thread-get',{threadId:id})).includes('Cached body fixture'),'body cached');
 // Pause the production final read, then let the CLI save a newer draft revision.
 const raceDraft=await cli('draft-create',{accountId:accounts[0].id,to:[{email:'recipient@example.test'}],subject:'Review revision fixture',body:'GUI reviewed body'});
 const raceRef={accountId:raceDraft.accountId,draftId:raceDraft.draftId};
 await main.locator('[data-mailbox=drafts]').click();await main.locator(`[data-draft-id="${raceRef.draftId}"]`).click();
 await until(()=>main.locator('.pr-send').isEnabled(),'review fixture ready');
 await evaluate(`(()=>{const {DatabaseStore,DraftStore}=require('mailspring-exports');const original=DatabaseStore.findBy;const dialog=AppEnv.showErrorDialog;
 window.reviewRace={waiting:false,errors:[],restore:()=>{DatabaseStore.findBy=original;AppEnv.showErrorDialog=dialog}};
 AppEnv.showErrorDialog=(message)=>window.reviewRace.errors.push(message);
 DatabaseStore.findBy=function(...args){const q=original.apply(this,args);if(args[1]?.headerMessageId===${JSON.stringify(raceRef.draftId)} && DraftStore._draftsSending[${JSON.stringify(raceRef.draftId)}]){
 DatabaseStore.findBy=original;const include=q.include.bind(q);q.include=(...attrs)=>{window.reviewRace.waiting=true;return new Promise(resolve=>{window.reviewRace.release=()=>resolve(include(...attrs))})};}return q;};return true})()`);
 await main.locator('.pr-send').click();await until(()=>evaluate('window.reviewRace.waiting'),'final GUI read paused');
 const beforeAgent=await cli('draft-get',raceRef);
 await cli('draft-update',{...raceRef,expectedRevision:beforeAgent.revision,changes:{body:'New body saved by Agent'}});
 await evaluate('window.reviewRace.release();true');
 await until(()=>evaluate('window.reviewRace.errors.length===1'),'revision conflict shown');
 assert((await evaluate('window.reviewRace.errors[0]')).includes('draft changed'));
 assert.equal((await sendRows()).length,0);assert.deepEqual((await fixture('counts')).smtp,[0,0]);
 assert(await main.locator('[contenteditable=true]').first().isVisible());
 await until(()=>main.locator('.pr-send').isEnabled(),'send flag reset after conflict');
 await evaluate('window.reviewRace.restore();true');
 await main.locator('[data-mailbox=inbox]').click();
 pass('GUI stops before admission when Agent changes the reviewed revision; editor remains open and no SMTP submission');
 await fixture('disconnect',0);
 await until(()=>evaluate(`!require('mailspring-exports').OnlineStatusStore.isAccountOnline(${JSON.stringify(accounts[0].id)})`),'engine detects disconnected account');
 await until(async()=>(await main.locator('.pr-sync-status').innerText()).includes('连接暂时中断'),'connection status visible');
 assert((await main.locator('.pr-sync-status').innerText()).includes(accounts[0].emailAddress));
 assert.equal(await main.locator('.pr-sync-status').getByRole('button',{name:'重新连接',exact:true}).count(),0);
 await main.locator('#pr-account').selectOption(accounts[1].id);
 await until(()=>evaluate(`document.querySelector('.pr-list-caption')?.innerText.includes(${JSON.stringify(accounts[1].emailAddress)})`),'healthy account view');
 assert(!(await main.locator('.pr-main').innerText()).includes('连接暂时中断'));
 // The healthy account remains writable while the other IMAP endpoint is down.
 const healthy=await cli('draft-create',{accountId:accounts[1].id,to:[{email:'recipient@example.test'}],subject:'Healthy account fixture',body:'Other mailbox stays writable'});
 assert.equal(healthy.accountId,accounts[1].id);
 pass('native connection loss is scoped to the affected mailbox; other account stays writable');
 await fixture('disconnect',1);await app.context().setOffline(true);
 await until(()=>evaluate('navigator.onLine === false'),'renderer offline');
 await main.locator('#pr-account').selectOption('');
 await until(async()=>(await main.locator('.pr-sync-status').innerText()).includes('当前离线'),'offline notice');
 for(const id of ids)assert(JSON.stringify(await cli('thread-get',{threadId:id})).includes('Cached body fixture'));
 for(const a of accounts)assert.equal((await cli('search',{accountId:a.id,query:'in:inbox'})).length,1);
 assert.equal(await main.locator('.pr-mail-row').count(),2);
 pass('cached inbox and message bodies remain readable through CLI while offline');
 const created=await cli('draft-create',{accountId:accounts[0].id,to:[{email:'recipient@example.test'}],subject:'Offline draft fixture',body:'Created offline'});
 const ref={accountId:created.accountId,draftId:created.draftId};
 await main.locator('[data-mailbox=drafts]').click();
 await main.locator(`[data-draft-id="${ref.draftId}"]`).click();
 const editor=main.locator('[contenteditable=true]').first();await editor.click();await main.keyboard.insertText('GUI offline edit fixture');
 await main.locator('[data-mailbox=drafts]').click();await main.locator('.pr-route-list').waitFor();
 let saved=await until(async()=>{const d=await cli('draft-get',ref);return d.body.includes('GUI offline edit fixture')?d:false},'offline editor saved');
 await main.locator(`[data-draft-id="${ref.draftId}"]`).click();
 await until(()=>main.locator('.pr-send').isDisabled(),'offline send disabled');
 assert((await main.locator('.pr-draft-status').innerText()).includes('已保存到本机'));
 await main.locator('[contenteditable=true]').first().click();await main.keyboard.press('Meta+Enter');
 assert.equal((await sendRows()).length,0);
 saved=await cli('draft-get',ref);
 const denied=await cli('draft-send',{...ref,expectedRevision:saved.revision,requestId:randomUUID()},true);
 assert(JSON.stringify(denied).includes('offline'),JSON.stringify(denied));
 assert.equal((await sendRows()).length,0);assert.deepEqual((await fixture('counts')).smtp,[0,0]);
 pass('offline GUI and CLI draft edits persist; button, keyboard and CLI cannot submit a send');
 await main.locator('[data-mailbox=drafts]').click();await main.locator('.pr-route-list').waitFor();
 await stop();await start(true);await waitCLI();
 await main.locator('[data-mailbox=drafts]').click();await main.locator(`[data-draft-id="${ref.draftId}"]`).click();
 await main.locator('[contenteditable=true]').first().waitFor();
 assert((await main.locator('[contenteditable=true]').first().innerText()).includes('GUI offline edit fixture'));
 assert.equal((await cli('draft-get',ref)).body,saved.body);
 assert.equal((await sendRows()).length,0);assert.deepEqual((await fixture('counts')).smtp,[0,0]);
 pass('normal offline restart restores the saved draft without sending it');
 await fixture('reconnect',0);await fixture('reconnect',1);await app.context().setOffline(false);
 await until(()=>evaluate("require('mailspring-exports').OnlineStatusStore.isOnline()"),'native reconnection');
 await until(()=>main.locator('.pr-send').isEnabled(),'send enabled after reconnection');
 await until(async()=>(await cli('search',{accountId:accounts[1].id,query:'subject:Reconnected'})).length===1,'new mail after reconnect');
 assert(!(await main.locator('.pr-main').innerText()).includes('当前离线'));
 assert.equal((await sendRows()).length,0);assert.deepEqual((await fixture('counts')).smtp,[0,0]);
 pass('reconnection resumes native sync and enables sending without automatically sending drafts');
 await main.locator('.pr-send').click();
 await until(async()=>(await sendRows()).some(r=>r.phase==='accepted'&&r.sentCopy==='filed'),'explicit GUI send accepted');
 assert.deepEqual((await fixture('counts')).smtp,[1,0]);
 await stop();await start();await waitCLI();
 assert.equal((await sendRows()).length,1);assert.deepEqual((await fixture('counts')).smtp,[1,0]);
 pass('explicit send after reconnect submits once and remains accepted after restart');
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify({passed:results,realProviderAccounts:false,smtpSubmissions:1},null,2)+'\n');
 await stop();
})().catch(async e=>{console.error(e.stack);if(main&&!main.isClosed()){await main.screenshot({path:path.join(work,'failure.png')}).catch(()=>{});fs.writeFileSync(path.join(work,'failure.txt'),await main.locator('body').innerText().catch(()=>''));}process.exitCode=1}).finally(()=>{if(app)app.process().kill('SIGKILL')});
