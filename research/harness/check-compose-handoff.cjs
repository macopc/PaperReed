const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),{spawn}=require('node:child_process'),{randomUUID}=require('node:crypto');
const [upstream,work,mode]=process.argv.slice(2),r=createRequire(path.join(upstream,'package.json'));
const {_electron}=r('playwright');
const account=JSON.parse(fs.readFileSync(path.join(work,'account.json')));
const token=randomUUID(),config=path.join(work,'config');fs.mkdirSync(config);
const tokenFile=path.join(work,'token');fs.writeFileSync(tokenFile,token,{mode:0o600});
const configData={'*':{env:'production',accounts:[account],accountsVersion:2,core:{
  themes:['ui-light'],disabledPackages:['open-tracking','link-tracking','send-reminders','send-later','thread-snooze'],
  workspace:{mode:'split'},sending:{undoSend:0,sounds:false},mcp:{enabled:true,accessLevel:'read-write-send',enabledAccounts:{[account.id]:{enabled:true}}}
}}};
fs.writeFileSync(path.join(config,'config.json'),JSON.stringify(configData));
let app,main,cdp,port;
async function evaluate(session,expression){const out=await session.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(out.exceptionDetails)throw new Error(JSON.stringify(out.exceptionDetails));return out.result.value;}
async function until(fn,label,timeout=30000){const end=Date.now()+timeout;while(Date.now()<end){const v=await fn();if(v)return v;await new Promise(r=>setTimeout(r,200));}throw new Error('Timeout: '+label);}
async function cli(command,input,expectError=false){
 const child=spawn(process.execPath,[path.resolve(__dirname,'../cli/paper-reed.cjs'),command],{env:{...process.env,PAPER_REED_UPSTREAM:upstream,PAPER_REED_TOKEN_FILE:tokenFile,PAPER_REED_MCP_URL:`http://127.0.0.1:${port}/mcp`},stdio:['pipe','pipe','pipe']});
 let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);child.stdin.end(JSON.stringify(input));
 const code=await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject);});
 if(!expectError)assert.equal(code,0,stderr+stdout);else assert.notEqual(code,0);
 return JSON.parse(stdout||stderr);
}
async function click(page,session,selector){const box=await evaluate(session,`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);assert(box,selector);await page.mouse.click(box.x,box.y);}
(async()=>{
 const reservation=require('node:net').createServer();await new Promise(r=>reservation.listen(0,'127.0.0.1',r));port=reservation.address().port;await new Promise(r=>reservation.close(r));
 configData['*'].core.mcp.port=port;configData['*'].core.mcp.token=token;fs.writeFileSync(path.join(config,'config.json'),JSON.stringify(configData));
 const env={...process.env};delete env.PLAYWRIGHT;delete env.ELECTRON_RUN_AS_NODE;
 app=await _electron.launch({executablePath:r('electron'),args:[path.join(upstream,'app'),'--dev','--no-sandbox','--config-dir-path',config],env,timeout:30000});
 app.process().stderr.on('data',b=>fs.appendFileSync(path.join(work,'electron.log'),b));
 main=await until(async()=>app.windows().find(w=>JSON.parse(new URL(w.url()).searchParams.get('loadSettings')||'{}').windowType==='default'),'main window');
 main.on('console',msg=>fs.appendFileSync(path.join(work,'renderer.log'),msg.type()+': '+msg.text()+'\n'));
 cdp=await app.context().newCDPSession(main);
 await until(()=>evaluate(cdp,'typeof AppEnv !== "undefined" && !!AppEnv.mailsyncBridge'),'app initialization');
 const km=JSON.stringify(path.join(upstream,'app/src/key-manager'));
 await evaluate(cdp,`(async()=>{const km=require(${km}).default;await km.replacePassword('test@example.test-imap','pass');await km.replacePassword('test@example.test-smtp','pass');const a=require('mailspring-exports').AccountStore.accountForId(${JSON.stringify(account.id)});await AppEnv.mailsyncBridge.forceRelaunchClient(a);return true;})()`);
 console.log('SETUP secrets and sync');
 await until(()=>evaluate(cdp,"document.body.innerText.includes('Inbox')"),'inbox');
 await until(async()=>{try{return (await fetch(`http://127.0.0.1:${port}/mcp`)).status===401;}catch{return false;}},'production MCP listener');
 console.log('SETUP production MCP via package manager');
 const created=await cli('draft-create',{accountId:account.id,to:[{email:'recipient@example.test'}],cc:[{email:'cc@example.test'}],bcc:[{email:'bcc@example.test'}],subject:'Paper Reed window handoff',body:'CLI original draft'});
 fs.writeFileSync(path.join(work,'created.json'),JSON.stringify(created));console.log('CREATED',JSON.stringify(created));
 const ref={accountId:account.id,draftId:created.draftId};
 await evaluate(cdp,`require('mailspring-exports').Actions.composePopoutDraft(${JSON.stringify(created.draftId)});true`);
 const composer=await until(async()=>app.windows().find(w=>JSON.parse(new URL(w.url()).searchParams.get('loadSettings')||'{}').windowType==='composer'),'composer window');
 // Electron already handles its beforeunload cancellation; do not let Playwright auto-answer a nonexistent Chrome dialog.
 composer.on('dialog',d=>{if(d.type()!=='beforeunload')d.dismiss().catch(e=>console.error(e.message));});
 const editor=await app.context().newCDPSession(composer);
 await until(()=>evaluate(editor,`!!document.querySelector('[contenteditable="true"]')`),'composer editor');
 if(mode==='conflict') await evaluate(editor,`global.__conflictDialogs=[];AppEnv.showErrorDialog=async(message)=>{global.__conflictDialogs.push(message);return 0;};true`);
 fs.writeFileSync(path.join(work,'composer-before.txt'),await evaluate(editor,'document.body.innerText'));
 await click(composer,editor,'[contenteditable="true"]');await composer.keyboard.press('Meta+End');await composer.keyboard.insertText('\nPaper Reed GUI edit');
 if(mode==='conflict') {
   const snapshot=()=>evaluate(editor,`(async()=>{const s=await require('mailspring-exports').DraftStore.sessionForClientId(${JSON.stringify(created.draftId)});return {body:s.draft().body,revision:s.draft().version,dirty:s.changes.isDirty(),errors:global.__conflictDialogs};})()`);
   console.log('CONFLICT unsaved input');
   const before=await snapshot();assert(before.dirty);assert.equal(before.revision,created.revision);
   const remote=await cli('draft-update',{...ref,expectedRevision:created.revision,changes:{body:'CLI newer version'}});
   await until(async()=>{const s=await snapshot();return s.errors.length?s:null;},'autosave conflict warning',25000);
   const autosave=await snapshot();assert(autosave.dirty);assert(autosave.body.includes('Paper Reed GUI edit'));assert.equal(autosave.revision,created.revision);
   console.log('CONFLICT autosave rejected');
   await click(composer,editor,'.btn-send');
   await until(async()=>{const s=await snapshot();return s.errors.length>autosave.errors.length;},'send conflict warning');
   assert(!composer.isClosed());
   const sends=await evaluate(cdp,`require('mailspring-exports').DatabaseStore._query('SELECT requestId FROM PaperReedSend WHERE accountId = ?',[${JSON.stringify(account.id)}])`);
   assert.equal(sends.length,0);
   console.log('CONFLICT send blocked; requesting close');
   // Request normal native close, including beforeunload handlers, not force destroy.
   await evaluate(editor,`setTimeout(()=>AppEnv.close(),0);true`);
   await new Promise(r=>setTimeout(r,1500));
   assert(!composer.isClosed(),'Conflict must prevent closing the unsaved editor');
   const closing=await snapshot();assert(closing.dirty);assert(closing.body.includes('Paper Reed GUI edit'));
   assert(closing.errors.some(message=>message.includes('This window will stay open.')),'Close failure must explain that edits remain in the window');
   const stored=await cli('draft-get',ref);assert.equal(stored.body,'CLI newer version');assert.equal(stored.revision,remote.revision);
   fs.writeFileSync(path.join(work,'conflict-result.json'),JSON.stringify({originalRevision:created.revision,storedRevision:stored.revision,autosaveRejected:true,sendBlocked:true,closeBlocked:true,localInputRetained:true,latestCLIContentRetained:true,sendOperations:sends.length,notificationAdapter:'warning dialogs recorded and auto-acknowledged; save/send/close logic unchanged'},null,2));
   console.log('PASS unsaved GUI / newer CLI: autosave rejected, send blocked, close blocked, both versions retained');
   return;
 }
 if(mode==='close-save') {
   const dirty=await evaluate(editor,`(async()=>{const s=await require('mailspring-exports').DraftStore.sessionForClientId(${JSON.stringify(created.draftId)});return s.changes.isDirty();})()`);
   assert(dirty,'Close must start with unsaved input');
   await evaluate(editor,`setTimeout(()=>AppEnv.close(),0);true`);
   await until(async()=>composer.isClosed(),'close after successful save');
   const stored=await cli('draft-get',ref);
   assert(stored.body.includes('Paper Reed GUI edit'));assert(stored.revision>created.revision);
   fs.writeFileSync(path.join(work,'close-result.json'),JSON.stringify({dirtyBeforeClose:true,closed:true,storedRevision:stored.revision,localInputSaved:true},null,2));
   console.log('PASS normal close saves unsaved input before closing; CLI reads saved body');
   return;
 }
 // Save through the actual visible editor/session using its standard idle autosave.
 const updated=await until(async()=>{const d=await cli('draft-get',ref);return d.body.includes('Paper Reed GUI edit')?d:null;},'GUI autosave',25000);
 assert(updated.revision>created.revision);
 assert.equal(updated.cc[0].email,'cc@example.test');assert.equal(updated.bcc[0].email,'bcc@example.test');
 const stale=await cli('draft-update',{...ref,expectedRevision:created.revision,changes:{body:'stale CLI edit'}},true);
 assert.match(JSON.stringify(stale),/draft-conflict/);
 assert((await cli('draft-get',ref)).body.includes('Paper Reed GUI edit'));
 await composer.screenshot({path:path.join(work,'composer-edited.png')});
 await click(composer,editor,'.btn-send');
 const operation=await until(()=>evaluate(cdp,`(async()=>{const rows=await require('mailspring-exports').DatabaseStore._query('SELECT requestId,phase,sentCopy FROM PaperReedSend WHERE accountId = ? AND draftId = ?',[${JSON.stringify(account.id)},${JSON.stringify(created.draftId)}]);return rows[0]||null;})()`),'GUI send operation');
 const final=await until(async()=>{const o=await cli('operation-get',{accountId:account.id,operationId:operation.requestId});return o.state==='accepted' && o.sentCopy==='filed'?o:null;},'SMTP acceptance and Sent copy');
 fs.writeFileSync(path.join(work,'result.json'),JSON.stringify({created,updatedRevision:updated.revision,staleRejected:true,ccBccPreserved:true,productionDesktopMcp:true,playwrightMockMode:false,operation:final},null,2));
 console.log('PASS GUI edit, stale CLI rejection, GUI Send, CLI accepted operation');
})().catch(async error=>{
 console.error(error.stack);
 if(cdp)try{fs.writeFileSync(path.join(work,'failure-dom.txt'),await evaluate(cdp,'document.body.innerText'));}catch{}
 process.exitCode=1;
}).finally(async()=>{if(app){if(mode==='conflict')await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows().forEach(w=>w.destroy())).catch(()=>{});await app.close();}});
