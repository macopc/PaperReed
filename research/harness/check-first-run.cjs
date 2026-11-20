const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),{execFile}=require('node:child_process');
const exec=require('node:util').promisify(execFile);
const [upstream,work,packaged,output]=process.argv.slice(2),r=createRequire(path.join(upstream,'package.json'));
const {_electron}=r('playwright'), fixture=JSON.parse(fs.readFileSync(path.join(work,'fixture.json')));
const config=path.join(work,'profile'),out=output||path.resolve(__dirname,'../first-run-validation-2026-11-16');fs.mkdirSync(out,{recursive:true});
const onboardingLib="AppEnv.getLoadSettings().resourcePath+'/internal_packages/onboarding/lib/'";
const onboardingStore=`require(${onboardingLib}+'onboarding-store').default`;
let app,main,cdp;
async function evaluate(session,expression){const result=await session.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
const run=expression=>evaluate(cdp,expression);
async function until(fn,label,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,200));}throw new Error('Timeout: '+label);}
const type=page=>{try{return JSON.parse(new URL(page.url()).searchParams.get('loadSettings')).windowType;}catch{return null;}};
async function start(){
 const env={...process.env,PAPER_REED_CLI_BIN_DIR:path.join(work,'bin'),PAPER_REED_GOOGLE_CLIENT_FILE:path.join(work,'missing-google-client.json')};delete env.PLAYWRIGHT;delete env.ELECTRON_RUN_AS_NODE;delete env.PAPER_REED_MICROSOFT_CLIENT_ID;
 app=await _electron.launch({executablePath:packaged||r('electron'),args:[...(packaged?[]:[path.join(upstream,'app'),'--dev']),'--no-sandbox','--config-dir-path',config],env,timeout:45000});
 app.process().stderr.on('data',b=>fs.appendFileSync(path.join(work,'electron.log'),b));
 // Electron handles beforeunload, including in startup windows created before launch resolves.
 app.context().on('dialog',()=>{});
 app.on('window',p=>p.on('console',msg=>fs.appendFileSync(path.join(work,'renderer.log'),msg.type()+': '+msg.text()+'\n')));
}
async function selectWindow(kind){main=await until(async()=>app.windows().find(w=>type(w)===kind),kind+' window');cdp=await app.context().newCDPSession(main);}
async function shot(name){const image=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(image.data,'base64'));}
async function click(selector){await main.locator(selector).first().click();}
async function stop(){const process=app.process();await app.evaluate(({app})=>app.quit());await until(async()=>process.exitCode!==null,'normal quit');app=null;}
async function checkDeletedGoogleReconnect() {
 const mailbox=main,mailboxSession=cdp;
 await run(`(async()=>{
  const {AccountStore,KeyManager}=require('mailspring-exports');
  const alias=AccountStore.accountForId('fixture-google-alias');
  await KeyManager.replacePassword(alias.emailAddress+'-imap','old-alias-password');
  require('electron').ipcRenderer.send('command','application:add-account',{
   existingAccountJSON:alias.toJSON(),
  });
  return true;
 })()`);
 await selectWindow('onboarding');
 const onboarding=main;
 await main.locator('[data-google-connect]').waitFor();
 await run(`(()=>{
  const auth=require(${onboardingLib}+'paper-reed-google-auth');
  const {MailsyncProcess}=require('mailspring-exports');
  auth.authorizeGoogle=async()=>({emailAddress:'te.st@gmail.com',settings:{refresh_token:'fixture-google-race-grant'}});
  MailsyncProcess.prototype.test=async()=>{};
  window.reconnectErrors=[];
  AppEnv.showErrorDialog=options=>window.reconnectErrors.push(options.message);
  return true;
 })()`);
 await app.evaluate(({app})=>{
  const {secureStorage}=process.mainModule.require(app.getAppPath()+'/src/browser/credential-store');
  const encrypt=secureStorage.encrypt;
  global.reconnectRace={restore:()=>{secureStorage.encrypt=encrypt;}};
  secureStorage.encrypt=async text=>{
   if(text.includes('fixture-google-race-grant')){
    await new Promise(resolve=>{global.reconnectRace.release=resolve;});
   }
   return encrypt(text);
  };
 });
 try{
  await main.locator('[data-google-connect]').click();
  await until(()=>app.evaluate(()=>!!global.reconnectRace.release),'Google account save reached encryption');
  await checkAccountSaveLocked();
  await evaluate(mailboxSession,`(()=>{
   const {Actions}=require('mailspring-exports');
   const reset=AppEnv.mailsyncBridge.resetCacheForAccount.bind(AppEnv.mailsyncBridge);
   AppEnv.mailsyncBridge.resetCacheForAccount=(account,options)=>{
    if(account.id!=='fixture-google-alias')return reset(account,options);
    return new Promise(resolve=>{window.finishAliasCacheCleanup=resolve;});
   };
   Actions.removeAccount('fixture-google-alias');
   return true;
  })()`);
  const aliasExists=()=>app.evaluate(()=>global.application.config.get('accounts').some(a=>a.id==='fixture-google-alias'));
  await until(async()=>!await aliasExists(),'other window removed Gmail alias');
  await app.evaluate(()=>global.reconnectRace.release());
  await until(async()=>onboarding.isClosed()||await run(`${onboardingStore}.accountSaveState()!=='saving'`),'reconnect save settled');
  const keys=await evaluate(mailboxSession,`require('mailspring-exports').KeyManager._getKeyHash()`);
  assert.equal(await aliasExists(),false,'a stale Google reconnect must never recreate a deleted account');
  assert(!onboarding.isClosed(),'a rejected save must leave onboarding open');
  assert.equal(keys['test@googlemail.com-refresh-token'],undefined,'the rejected grant must never reach the credential store');
  assert.deepEqual(await run('window.reconnectErrors'),['此邮箱账号已变更。请关闭此窗口后重新连接。']);
  await evaluate(mailboxSession,'window.finishAliasCacheCleanup();true');
  await until(async()=>!(await evaluate(mailboxSession,`require('mailspring-exports').KeyManager.getPassword('test@googlemail.com-imap')`)),'removed account credentials cleared');
  assert.equal(await evaluate(mailboxSession,`require('mailspring-exports').KeyManager.getPassword('te.st@gmail.com-imap')`),'other-account-password');
  console.log('PASS account deletion from another window wins during real credential encryption without persisting the new grant');
 }finally{
  await app.evaluate(()=>{global.reconnectRace.release?.();global.reconnectRace.restore();delete global.reconnectRace;});
  await evaluate(mailboxSession,'window.finishAliasCacheCleanup?.();true');
  main=mailbox;cdp=mailboxSession;
 }
}
async function checkAbandonedSetup(store) {
 const active=main.locator('.page-container:not([inert])');
 const back=main.getByRole('button',{name:'返回上一步',exact:true});
 await run(`(()=>{
  const helpers=require(AppEnv.getLoadSettings().resourcePath+'/internal_packages/onboarding/lib/onboarding-helpers');
  const {AccountStore}=require('mailspring-exports');
  const checkout=${store};
  const pending={};
  const originals={
   discover:helpers.expandAccountForSetup, validate:helpers.finalizeAndValidateAccount,
   save:AccountStore.addAccount, complete:checkout._onOnboardingComplete,
  };
  const probe=window.prAbandonedSetup={pending,saved:0,completed:0};
  helpers.expandAccountForSetup=account=>new Promise(resolve=>{
   pending.discover=()=>resolve({account,confirmServers:false});
  });
  helpers.finalizeAndValidateAccount=account=>new Promise((resolve,reject)=>{
   pending.validate=shouldSucceed=>shouldSucceed ? resolve(account) : reject(Object.assign(
    new Error('Late certificate rejection'),{certificates:[{service:'imap',host:'127.0.0.1',port:993,sha256:'0'.repeat(64)}]}
   ));
  });
  AccountStore.addAccount=async account=>{probe.saved++;return account;};
  checkout._onOnboardingComplete=()=>{probe.completed++;};
  probe.restore=()=>{
   helpers.expandAccountForSetup=originals.discover;helpers.finalizeAndValidateAccount=originals.validate;
   AccountStore.addAccount=originals.save;checkout._onOnboardingComplete=originals.complete;
   delete window.prAbandonedSetup;
  };
  return true;
 })()`);
 try {
  for(const [request,succeed] of [['discover',true],['validate',true],['validate',false]]){
   await active.locator('[data-provider=imap]').click();
   await active.locator('#name').fill('Abandoned IMAP');
   await active.locator('#emailAddress').fill('abandoned@example.test');
   await active.locator('[id="settings.imap_password"]').fill('fixture-password');
   if(request==='discover'){
    await active.getByRole('button',{name:'下一步',exact:true}).click();
   }else{
    await active.locator('[data-manual-setup]').click();
    for(const protocol of ['imap','smtp']){
     await active.locator(`[id="settings.${protocol}_host"]`).fill('127.0.0.1');
    }
    await active.getByRole('button',{name:'连接邮箱',exact:true}).click();
   }
   await until(()=>run(`!!window.prAbandonedSetup.pending.${request}`),`pending ${request}`);
   await back.click();
   if(request==='validate')await back.click();
   await active.locator('[data-provider=icloud]').click();
   await active.locator('#emailAddress').fill('current@icloud.com');
   const outcome=await run(`(async()=>{
    const probe=window.prAbandonedSetup;
    probe.pending.${request}(${succeed});
    delete probe.pending.${request};
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    const store=${store};
    return {page:store.page(),provider:store.account().provider,saved:probe.saved,completed:probe.completed};
   })()`);
   assert.deepEqual(outcome,{page:'paper-reed-icloud',provider:'icloud',saved:0,completed:0},
    `abandoned ${request} (${succeed ? 'success' : 'failure'}) must not change the active setup`);
   assert.equal(await active.locator('#emailAddress').inputValue(),'current@icloud.com');
   await back.click();
  }
 }finally{
  await run('window.prAbandonedSetup.restore();true');
 }
}
async function checkAccountSaveLocked() {
 const active=main.locator('.page-container:not([inert])');
 const back=main.getByRole('button',{name:/^返回(上一步|邮箱选择)$/});
 await active.getByRole('status').getByText('正在保存邮箱账号…',{exact:true}).waitFor({timeout:2500});
 assert(await back.isDisabled(),'Back is disabled while the account is saved');
 const target=await back.boundingBox();
 await main.mouse.click(target.x+target.width/2,target.y+target.height/2);
 assert.equal(await active.getByRole('button').count(),0,'the saving page cannot submit twice');
 assert(await run(`(()=>{
  const actions=require(${onboardingLib}+'onboarding-actions');
  const store=${onboardingStore},visit=store.pageVisit();
  actions.moveToPreviousPage();
  actions.chooseAccountProvider('icloud');
  actions.finishAndAddAccount(store.account());
  return store.pageVisit()===visit && store.accountSaveState()==='saving';
 })()`),'save-in-progress rejects queued navigation and duplicate submission');
}
async function checkAccountSaveFailure() {
 const active=main.locator('.page-container:not([inert])');
 const google=active.getByRole('button',{name:'使用 Google 登录',exact:true});
 await run(`(()=>{
  const auth=require(${onboardingLib}+'paper-reed-google-auth');
  const helpers=require(${onboardingLib}+'onboarding-helpers');
  const {Account,AccountStore}=require('mailspring-exports');
  const originals={auth:auth.authorizeGoogle,build:helpers.buildPaperReedGmailAccount,
   save:AccountStore.addAccount,dialog:AppEnv.showErrorDialog};
  const probe=window.prFailedSave={writes:0};
  auth.authorizeGoogle=async()=>({emailAddress:'save-test@gmail.com'});
  helpers.buildPaperReedGmailAccount=async authorization=>new Account({
   provider:'gmail',emailAddress:authorization.emailAddress,settings:{},
  });
  AccountStore.addAccount=()=>new Promise((_resolve,reject)=>{
   probe.writes++;
   probe.fail=()=>reject(new Error('fixture save failure'));
  });
  AppEnv.showErrorDialog=message=>{probe.error=message;};
  probe.restore=()=>{
   auth.authorizeGoogle=originals.auth;helpers.buildPaperReedGmailAccount=originals.build;
   AccountStore.addAccount=originals.save;AppEnv.showErrorDialog=originals.dialog;
   delete window.prFailedSave;
  };
  return true;
 })()`);
 try {
  await active.locator('[data-provider=gmail]').click();
  await google.click();
  await until(()=>run('window.prFailedSave.writes===1'),'pending Google account save');
  await checkAccountSaveLocked();
  await active.and(main.locator('.alpha-fade-enter-done')).getByRole('status').waitFor();
  await shot('after-provider-saving');
  assert.equal(await run('window.prFailedSave.writes'),1);
  await run('window.prFailedSave.fail();true');
  await until(()=>run('window.prFailedSave.error?.title==="无法保存邮箱账号"'),'save failure reported');
  await google.waitFor();
  assert(await google.isEnabled(),'Google setup is usable again after a failed save');
  const back=main.getByRole('button',{name:'返回邮箱选择',exact:true});
  assert(await back.isEnabled());
  await back.click();
  await active.locator('[data-provider=gmail]').waitFor();
 }finally{
  await run('window.prFailedSave.restore();true');
 }
}
async function checkProviderPicker(phase) {
 const picker=main.locator('.account-choose');
 const choice=provider=>picker.locator(`[data-provider=${provider}]`);
 const capture=async name=>{
  await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  await shot(`${phase}-provider-${name}`);
 };
 await picker.waitFor();
 await until(()=>run('document.fonts.status==="loaded"'),'picker fonts');
 await capture('desktop');
 await run('require("@electron/remote").getCurrentWindow().setContentSize(420,500);true');
 await until(()=>run('innerWidth===420 && innerHeight===500'),'native 420 × 500 onboarding window');
 await capture('narrow');
 if(phase==='before'){
  console.log('PASS provider picker baseline at native desktop and 420 × 500');
  return;
 }

 assert.deepEqual(await run('[...document.querySelectorAll(".account-choose button[data-provider]")].map(e=>e.dataset.provider)'), ['gmail','icloud','imap']);
 assert(await run(`(() => {
  const page=document.querySelector('.account-choose');
  return page.scrollWidth<=page.clientWidth+1 && [...page.querySelectorAll('button')].every(b=>{
    const r=b.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth && r.bottom<=innerHeight;
  });
 })()`));
 for(const [provider,label,help] of [
  ['gmail','Gmail',/浏览器.*Google Workspace/],
  ['icloud','iCloud 邮件',/应用专用密码/],
  ['imap','其他 IMAP 邮箱',/IMAP.*SMTP/],
 ]){
  const button=picker.getByRole('button',{name:label,exact:true});
  const description=await button.getAttribute('aria-describedby');
  assert.match(await main.locator(`[id=${JSON.stringify(description)}]`).textContent(),help);
  assert.equal(await button.getAttribute('data-provider'),provider);
 }
 assert.match(await picker.textContent(),/Microsoft 网页授权.*Outlook.*Microsoft 365/);
 const close=main.getByRole('button',{name:'退出 Paper Reed',exact:true});
 const store=onboardingStore;
 await close.focus();await main.keyboard.press('Tab');
 assert(await run('document.activeElement.dataset.provider==="gmail"'));
 await capture('focus');
 const brandGeometry=selector=>run(`(()=>{
  const node=document.querySelector(${JSON.stringify(selector)});
  const r=node.getBoundingClientRect();
  return {top:r.top,center:r.left+r.width/2,align:getComputedStyle(node).textAlign};
 })()`);
 const chooserBrand=await brandGeometry('.pr-provider-choose .pr-onboarding-brand');
 await main.keyboard.press('Enter');
 const google=main.getByRole('button',{name:'使用 Google 登录',exact:true});
 await google.waitFor();
 await main.locator('.alpha-fade-enter-done [data-google-connect]').waitFor();
 const googleBrand=await brandGeometry('.account-setup .pr-onboarding-brand');
 assert.equal(chooserBrand.align,'center');
 assert.equal(googleBrand.align,'center');
 assert(Math.abs(chooserBrand.top-googleBrand.top)<1 && Math.abs(chooserBrand.center-googleBrand.center)<1);
 assert.equal(await main.locator('input[type=password]').count(),0);
 await main.getByRole('button',{name:'返回邮箱选择',exact:true}).focus();
 await main.keyboard.press('Space');
 await until(()=>run('document.activeElement.dataset.provider==="gmail"'),'Google back restores picker focus');

 const oldGmail=await choice('gmail').boundingBox();
 assert(oldGmail);
 await choice('icloud').focus();await main.keyboard.press('Space');
 const exitInert=await run('document.querySelector(".account-choose")?.closest(".page-container").inert');
 await main.mouse.click(oldGmail.x+oldGmail.width/2,oldGmail.y+oldGmail.height/2);
 assert.equal(await run(`${store}.account().provider`),'icloud','an exiting Gmail button cannot change the selected provider');
 assert.equal(exitInert,true,'exiting provider page is inert');
 await main.locator('.pr-icloud-setup').getByRole('heading',{name:'连接 iCloud 邮件'}).waitFor();
 const back=main.getByRole('button',{name:'返回上一步',exact:true});
 await run(`window.prPickerCloseCalls=0;
  window.prOriginalPickerQuit=AppEnv.quit;window.prOriginalPickerClose=AppEnv.close;
  AppEnv.quit=AppEnv.close=()=>{window.prPickerCloseCalls++;};true`);
 try {
  await back.focus();await main.keyboard.press('Enter');
  const closeLocked=await run('document.querySelector("button.pr-onboarding-window-action.close")?.disabled');
  await main.keyboard.press('Enter');
  assert.equal(await run('window.prPickerCloseCalls'),0,'rapid Enter after Back cannot close the picker');
  assert.equal(closeLocked,true,'Close is disabled while returning to the picker');
  await until(()=>run('document.activeElement.dataset.provider==="icloud"'),'iCloud back restores picker focus');
  await choice('icloud').click();
  const backBox=await back.boundingBox();
  const x=backBox.x+backBox.width/2,y=backBox.y+backBox.height/2;
  await main.mouse.click(x,y);
  await until(()=>close.isEnabled(),'picker can close after the fade ends');
  await main.mouse.click(x,y);
  assert.equal(await run('window.prPickerCloseCalls'),0,'clicking the old Back position after the fade cannot exit');
  const closeBox=await close.boundingBox();
  assert(backBox.x>=closeBox.x+closeBox.width,'Back and Quit have separate hit areas');
  await close.click();
  assert.equal(await run('window.prPickerCloseCalls'),1,'a deliberate click on Quit still exits');
 }finally{
  await run('AppEnv.quit=window.prOriginalPickerQuit;AppEnv.close=window.prOriginalPickerClose;true');
 }
 assert(await close.isEnabled());

 await choice('imap').focus();await main.keyboard.press('Enter');
 await main.locator('.AccountBasicSettingsForm #emailAddress').waitFor();
 assert.equal(await run(`${store}.account().provider`),'imap');
 await back.focus();await main.keyboard.press('Enter');
 await until(()=>run('document.activeElement.dataset.provider==="imap"'),'IMAP back restores picker focus');
 await checkAbandonedSetup(store);
 await checkAccountSaveFailure();
 assert.equal(await run('require("mailspring-exports").AccountStore.accounts().length'),0);
 const result={nativeCompact:true, providerHelpAssociated:true, brandedStepsAligned:true, firstRunExitName:true, focusOrder:true, providerRoutes:true, providerFocusRestored:true, exitingProviderCannotActivate:true, fastBackCannotClose:true, backAndQuitHitAreasSeparate:true, abandonedSetupIgnored:true, failedSaveUnlocksGoogleSetup:true, noAccountsCreated:true, expectedSMTPSubmissions:0};
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');
 console.log('PASS provider picker',JSON.stringify(result));
}
async function checkGoogleNativeDiagnostics(startAttempt, alert) {
 const requests=[];
 let responseStatus=503;
 const server=require('node:http').createServer((req,res)=>{
  if(req.method!=='POST' || req.url!=='/token'){
   res.writeHead(404).end();
   return;
  }
  requests.push(responseStatus);
  if(responseStatus===0){
   req.socket.destroy();
   return;
  }
  req.resume();
  if(responseStatus==='partial-503'){
   res.writeHead(503,{'Content-Type':'application/json','Content-Length':'64','Connection':'close'});
   res.end('{"error":');
   return;
  }
  res.writeHead(responseStatus,{'Content-Type':'application/json'});
  res.end(JSON.stringify({error:'temporarily_unavailable'}));
 });
 server.listen(0,'127.0.0.1');
 await require('node:events').once(server,'listening');
 try{
  const url=`http://127.0.0.1:${server.address().port}/token`;
  await run(`(()=>{
   const helpers=require(${onboardingLib}+'onboarding-helpers');
   const {Account}=require('mailspring-exports');
   const build=helpers.buildPaperReedGmailAccount;
   const previous=process.env.GMAIL_OAUTH_TOKEN_URL;
   process.env.GMAIL_OAUTH_TOKEN_URL=${JSON.stringify(url)};
   helpers.buildPaperReedGmailAccount=()=>{
    // Keep the mail servers on loopback while the actual engine refreshes the Gmail token.
    const account=new Account({}).fromJSON(${JSON.stringify(fixture)});
    account.provider='gmail';
    Object.assign(account.settings,{gmail_api_send:true,gmail_client_id:'paper-reed-fixture',
     gmail_client_secret:'fixture-secret',refresh_token:'fixture-refresh'});
    return helpers.finalizeAndValidateAccount(account);
   };
   window.prRestoreNativeGoogle=()=>{
    helpers.buildPaperReedGmailAccount=build;
    if(previous===undefined)delete process.env.GMAIL_OAUTH_TOKEN_URL;
    else process.env.GMAIL_OAUTH_TOKEN_URL=previous;
   };
   return true;
  })()`);
  for(const [status,message] of [
   [503,'暂时无法连接 Gmail 服务器。请稍后重试。'],
   [429,'暂时无法连接 Gmail 服务器。请稍后重试。'],
   ['partial-503','暂时无法连接 Gmail 服务器。请稍后重试。'],
   [0,'网络连接中断。请检查网络后重试。'],
  ]){
   responseStatus=status;
   const attempt=await startAttempt();
   await run(`window.prGoogleFixture.authorizations[${attempt}].pass();true`);
   await alert.waitFor();
   assert.equal(await alert.textContent(),message,`native Gmail validation diagnostic for HTTP status ${status || 'unavailable'}`);
   if(status===503)await shot('after-google-service-error');
  }
  assert.deepEqual(requests,[503,429,'partial-503',0]);
  console.log('PASS native Gmail token refresh distinguishes complete HTTP errors, truncated 503, and no response');
 }finally{
  try{await run('window.prRestoreNativeGoogle?.();delete window.prRestoreNativeGoogle;true');}
  finally{
   server.closeAllConnections();
   await new Promise(resolve=>server.close(resolve));
  }
 }
}
async function checkGoogleSavedSender(active) {
 const back=main.getByRole('button',{name:'返回上一步',exact:true});
 await back.click();
 await back.click();
 await active.locator('[data-provider=imap]').click();
 const name='Gmail fixture',emailAddress='intended@googlemail.com',verifiedEmail='in.tended@gmail.com';
 await active.locator('#name').fill(name);
 await active.locator('#emailAddress').fill(emailAddress);
 await active.locator('[data-use-google]').click();
 await run(`(()=>{
  const auth=require(${onboardingLib}+'paper-reed-google-auth');
  const {AccountStore,MailsyncProcess}=require('mailspring-exports');
  const store=${onboardingStore};
  const original={authorize:auth.authorizeGoogle,test:MailsyncProcess.prototype.test,
   save:AccountStore.addAccount,complete:store._onOnboardingComplete};
  const probe=window.prGoogleSave={accounts:[],completed:0};
  auth.authorizeGoogle=async emailAddress=>{
   probe.requestedEmail=emailAddress;
   return {emailAddress:${JSON.stringify(verifiedEmail)},settings:{}};
  };
  MailsyncProcess.prototype.test=async()=>{};
  AccountStore.addAccount=async account=>{
   probe.accounts.push({name:account.name,emailAddress:account.emailAddress,provider:account.provider});
   return account;
  };
  store._onOnboardingComplete=()=>{probe.completed++;};
  probe.restore=()=>{
   auth.authorizeGoogle=original.authorize;MailsyncProcess.prototype.test=original.test;
   AccountStore.addAccount=original.save;store._onOnboardingComplete=original.complete;
   delete window.prGoogleSave;
  };
  return true;
 })()`);
 try{
  await active.getByRole('button',{name:'使用 Google 登录',exact:true}).click();
  await until(()=>run('window.prGoogleSave.completed===1'),'Google setup reached account save');
  assert.equal(await run('window.prGoogleSave.requestedEmail'),emailAddress);
  assert.deepEqual(await run('window.prGoogleSave.accounts'),[{name,emailAddress:verifiedEmail,provider:'gmail'}],
   'first Google connection saves the entered sender name');
 }finally{
  await run('window.prGoogleSave.restore();true');
 }
}
async function checkGooglePage(phase) {
 const active=main.locator('.page-container:not([inert])');
 const login=active.locator('[data-google-connect]');
 const stable=async()=>{await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');};
 await active.locator('[data-provider=gmail]').click();
 await active.and(main.locator('.alpha-fade-enter-done')).locator('[data-google-connect]').waitFor();
 await until(()=>run('document.fonts.status==="loaded"'),'Google page fonts');
 await shot(`${phase}-google-desktop`);
 await run('require("@electron/remote").getCurrentWindow().setContentSize(420,500);true');
 await until(()=>run('innerWidth===420 && innerHeight===500'),'native Google window 420 × 500');
 await stable();
 await shot(`${phase}-google-narrow`);
 await login.focus();await main.keyboard.press('Enter');
 const alert=active.getByRole('alert');
 await alert.filter({hasText:'Google 登录尚未配置'}).waitFor();
 await stable();
 await shot(`${phase}-google-missing-config`);
 if(phase==='before'){
  console.log('PASS Google sign-in baseline at native desktop and 420 × 500');
  return;
 }
 assert.equal(await active.locator('input').count(),0);
 const retry=active.getByRole('button',{name:'重试 Google 登录',exact:true});
 assert(await run('document.activeElement.matches("[data-google-connect]")'));
 const position=await login.boundingBox();
 assert(position.width>=160 && position.height>=36);
 assert.equal(await main.getByRole('button',{name:'返回邮箱选择',exact:true}).count(),1);

 await run(`(()=>{
  const auth=require(${onboardingLib}+'paper-reed-google-auth');
  const helpers=require(${onboardingLib}+'onboarding-helpers');
  const {Account,AccountStore}=require('mailspring-exports');
  const original={authorize:auth.authorizeGoogle,build:helpers.buildPaperReedGmailAccount,save:AccountStore.addAccount,accounts:AccountStore.accounts};
  const probe=window.prGoogleFixture={authorizations:[],verifications:[],saves:0};
  auth.authorizeGoogle=(email,signal)=>new Promise((resolve,reject)=>probe.authorizations.push({
   email,signal,pass:()=>resolve({emailAddress:'fixture@gmail.com',settings:{}}),
   fail:(message='Google 未授予收发邮件权限，请重新授权并勾选邮件权限。')=>reject(new auth.GoogleAuthorizationError(message)),
  }));
  helpers.buildPaperReedGmailAccount=authorization=>new Promise((resolve,reject)=>probe.verifications.push(diagnostic=>{
   if(diagnostic)reject(Object.assign(new Error('fixture internal diagnostic'),diagnostic));
   else resolve(new Account({provider:'gmail',emailAddress:authorization.emailAddress,settings:{}}));
  }));
  AccountStore.addAccount=()=>{probe.saves++;};
  probe.restore=()=>{
   auth.authorizeGoogle=original.authorize;helpers.buildPaperReedGmailAccount=original.build;
   AccountStore.addAccount=original.save;AccountStore.accounts=original.accounts;
   delete window.prGoogleFixture;
  };
  return true;
 })()`);
 try {
  const status=active.getByRole('status');
  const cancel=active.getByRole('button',{name:'取消连接',exact:true});
  const startAttempt=async()=>{
   await login.focus();await main.keyboard.press('Enter');
   await status.getByText('等待浏览器中的授权。完成后请返回 Paper Reed。',{exact:true}).waitFor();
   assert(await login.isDisabled());
   assert(await run('document.activeElement.matches("[data-google-connect]")'));
   return await run('window.prGoogleFixture.authorizations.length-1');
  };
  await startAttempt();
  await main.keyboard.press('Enter');
  assert.equal(await run('window.prGoogleFixture.authorizations.length'),1,'Enter cannot open a second request');
  await stable();
  assert.deepEqual(await login.boundingBox(),position,'feedback does not move the main action');
  await shot('after-google-authorizing');
  await main.keyboard.press('Tab');
  assert(await run('document.activeElement.textContent.trim()==="取消连接"'));
  await main.keyboard.down('Enter');
  await main.keyboard.down('Enter');
  await main.keyboard.up('Enter');
  assert(await run('document.activeElement.matches("[data-google-connect]")'));
  assert.equal(await run('window.prGoogleFixture.authorizations.length'),1,'holding Enter after Cancel must not start a new authorization');
  assert(await run('window.prGoogleFixture.authorizations[0].signal.aborted'));
  await run('window.prGoogleFixture.authorizations[0].pass();true');
  await stable();
  assert.equal(await run('window.prGoogleFixture.verifications.length'),0);

  await startAttempt();
  await run('window.prGoogleFixture.authorizations[1].pass();true');
  await status.getByText('已收到 Google 授权，正在验证邮箱连接…',{exact:true}).waitFor();
  assert(await run('(() => {const page=document.querySelector(".page-container:not([inert]) .pr-google-setup"); return page.scrollWidth<=page.clientWidth+1 && page.scrollHeight<=page.clientHeight+1;})()'));
  assert.deepEqual(await login.boundingBox(),position);
  await shot('after-google-verifying');
  await cancel.click();
  await startAttempt();
  await run('window.prGoogleFixture.verifications[0]();true');
  await stable();
  assert.equal(await run('window.prGoogleFixture.saves'),0);
  await status.getByText('等待浏览器中的授权。完成后请返回 Paper Reed。',{exact:true}).waitFor();
  await run('window.prGoogleFixture.authorizations[2].fail();true');
  await alert.filter({hasText:'Google 未授予收发邮件权限'}).waitFor();
  assert(await retry.isEnabled());
  assert(await run('document.activeElement.matches("[data-google-connect]")'));
  await shot('after-google-permission-error');
  for(const [diagnostic,message] of [
   [{errorCode:'ErrorGmailIMAPNotEnabled',isNetworkError:false},'工作或学校邮箱请联系管理员启用 IMAP'],
   [{errorCode:'ErrorConnection',isNetworkError:true},'网络连接中断。请检查网络后重试。'],
   [{errorCode:'ErrorConnection',isNetworkError:false},'暂时无法连接 Gmail 服务器。请稍后重试。'],
   [{errorCode:'UnknownFixtureError'},'Google 已授权，但未能连接邮箱。请重试。'],
  ]){
   const attempt=await startAttempt();
   await run(`window.prGoogleFixture.authorizations[${attempt}].pass();true`);
   await status.getByText('已收到 Google 授权，正在验证邮箱连接…',{exact:true}).waitFor();
   await run(`window.prGoogleFixture.verifications.at(-1)(${JSON.stringify(diagnostic)});true`);
   await alert.waitFor();
   const text=await alert.textContent();
   assert(text.includes(message),`expected "${message}" for ${diagnostic.errorCode}, got "${text}"`);
   assert.doesNotMatch(text,/fixture internal diagnostic/);
   assert(await retry.isEnabled());
   if(diagnostic.errorCode==='ErrorGmailIMAPNotEnabled')await shot('after-google-imap-error');
  }
  await checkGoogleNativeDiagnostics(startAttempt,alert);
  const backAttempt=await startAttempt();
  const back=main.getByRole('button',{name:'返回邮箱选择',exact:true});
  const backBox=await back.boundingBox();
  await back.click();
  await until(()=>run(`window.prGoogleFixture.authorizations[${backAttempt}].signal.aborted`),'going back ends Google authorization');
  assert(await run('document.activeElement.dataset.provider==="gmail"'));
  await main.mouse.click(backBox.x+backBox.width/2,backBox.y+backBox.height/2);
  assert.equal(await run(`${onboardingStore}.page()`),'account-choose','a second Back click cannot select a mailbox provider');

  await active.locator('[data-provider=imap]').click();
  const intendedAddress='intended@gmail.com';
  const senderName='Gmail fixture';
  await active.locator('#name').fill(senderName);
  await active.locator('#emailAddress').fill(intendedAddress);
  await active.locator('[data-use-google]').click();
  await login.waitFor();
  assert.equal(await active.locator('.pr-google-account').count(),1,'explicit Google handoff must keep the entered email');
  assert.equal(await active.locator('.pr-google-account').textContent(),intendedAddress);
  const explicitAttempt=await startAttempt();
  assert.equal(await run(`window.prGoogleFixture.authorizations[${explicitAttempt}].email`),intendedAddress);
  const mismatch='授权的 Google 账号与当前邮箱不同，请选择对应账号。';
  await run(`window.prGoogleFixture.authorizations[${explicitAttempt}].fail(${JSON.stringify(mismatch)});true`);
  await alert.filter({hasText:mismatch}).waitFor();
  assert.equal(await run('window.prGoogleFixture.saves'),0);
  const previous=main.getByRole('button',{name:'返回上一步',exact:true});
  await previous.click();
  assert.equal(await active.locator('#emailAddress').inputValue(),intendedAddress);
  assert.equal(await active.locator('#name').inputValue(),senderName);
  await previous.click();

  await active.locator('[data-provider=gmail]').click();
  const address='Long.Reconnect.Account.Fixture@workspace.example.test';
  await run(`(()=>{
   const {Account,AccountStore}=require('mailspring-exports');
   const actions=require(${onboardingLib}+'onboarding-actions');
   const account=new Account({provider:'gmail',emailAddress:${JSON.stringify(address)},settings:{}});
   AccountStore.accounts=()=>[new Account({provider:'gmail',emailAddress:account.emailAddress.toLowerCase(),settings:{}})];
   actions.setAccount(account);
   return true;
  })()`);
  await active.getByRole('heading',{name:'重新连接 Google 邮箱'}).waitFor();
  await active.and(main.locator('.alpha-fade-enter-done')).locator('[data-google-connect]').waitFor();
  assert.equal(await active.locator('.pr-google-account').textContent(),address);
  assert(await run('(() => {const page=document.querySelector(".page-container:not([inert]) .pr-google-setup"); return page.scrollWidth<=page.clientWidth+1;})()'));
  await stable();
  await shot('after-google-reconnect');
 }finally{
  await run('window.prGoogleFixture.restore();true');
 }
 await main.getByRole('button',{name:'返回邮箱选择',exact:true}).click();
 await active.locator('[data-provider=imap]').click();
 const workspaceAddress='detected@workspace.example.test';
 await active.locator('#name').fill('Workspace fixture');
 await active.locator('#emailAddress').fill(workspaceAddress);
 await active.locator('[id="settings.imap_password"]').fill('fixture-password');
 await run(`(()=>{
  const dns=require('dns'),resolveMx=dns.resolveMx;
  dns.resolveMx=(domain,callback)=>{
   if(domain!=='workspace.example.test')return resolveMx(domain,callback);
   callback(null,[{priority:1,exchange:'aspmx.l.google.com'}]);
  };
  window.prRestoreGoogleMx=()=>{dns.resolveMx=resolveMx;};
  return true;
 })()`);
 try{
  await active.getByRole('button',{name:'下一步',exact:true}).click();
  await login.waitFor();
 }finally{
  await run('window.prRestoreGoogleMx();true');
 }
 assert.equal(await active.locator('.pr-google-account').textContent(),workspaceAddress);
 const detectedBack=main.locator('button.pr-onboarding-window-action.back');
 assert.equal(await detectedBack.getAttribute('aria-label'),'返回上一步','Back should name the IMAP form as the previous step');
 await detectedBack.focus();await main.keyboard.press('Enter');
 assert.equal(await active.locator('#emailAddress').inputValue(),workspaceAddress,'return preserves the IMAP form email');
 const correctedAddress='corrected@fastmail.com';
 await active.locator('#emailAddress').fill(correctedAddress);
 await active.getByRole('button',{name:'下一步',exact:true}).click();
 await until(()=>run(`${onboardingStore}.page()!=='account-settings'`),'corrected address routed');
 assert.equal(await run(`${onboardingStore}.page()`),'account-settings-imap','a changed mailbox must not reuse the discovered Gmail host');
 const imapHost=active.locator('[id="settings.imap_host"]');
 assert.equal(await imapHost.inputValue(),'imap.fastmail.com');
 assert.equal(await active.locator('[id="settings.imap_username"]').inputValue(),correctedAddress);
 await imapHost.fill('imap.custom.example.test');
 await active.getByRole('button',{name:'返回',exact:true}).click();
 await active.locator('[data-manual-setup]').click();
 assert.equal(await imapHost.inputValue(),'imap.custom.example.test','manual settings stay attached to the same mailbox');
 await active.getByRole('button',{name:'返回',exact:true}).click();
 await active.locator('#emailAddress').fill('manual@other.example.test');
 await active.locator('[data-manual-setup]').click();
 assert.equal(await imapHost.inputValue(),'','manual setup for a different mailbox starts with a blank host');
 assert.equal(await active.locator('[id="settings.imap_username"]').inputValue(),'manual@other.example.test');
 await checkGoogleSavedSender(active);
 assert.equal(await run('require("mailspring-exports").AccountStore.accounts().length'),0);
 const result={nativeCompact:true,browserHandoff:true,missingConfigFeedback:true,stableAction:true,
  keyboardCancelRestoresFocus:true,heldEnterDoesNotRestart:true,duplicateLoginPrevented:true,
  abandonedVerificationIgnored:true,permissionRetry:true,verificationDiagnosticGuidance:true,nativeRefreshDiagnosticGuidance:true,
  returnAbortsAuthorization:true,reconnectIdentityShown:true,discoveredGoogleBackReturnsToIMAP:true,
  correctedMailboxUsesNewSettings:true,explicitGoogleHandoffPreservesMailbox:true,firstGoogleSaveKeepsSenderName:true,
  expectedSMTPSubmissions:0};
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');
 console.log('PASS Google sign-in',JSON.stringify(result));
}
(async()=>{
 assert(!fs.existsSync(config));await start();await selectWindow('onboarding');
 const googlePhase=process.env.PAPER_REED_GOOGLE_PAGE_CHECK;
 if(googlePhase){await checkGooglePage(googlePhase);await stop();return;}
 const pickerPhase=process.env.PAPER_REED_PROVIDER_PICKER_CHECK;
 if(pickerPhase){await checkProviderPicker(pickerPhase);await stop();return;}
 const icloudPhase=process.env.PAPER_REED_ICLOUD_PAGE_CHECK;
 if(icloudPhase){await require('./check-icloud-onboarding.cjs')({phase:icloudPhase,app,main,run,until,shot,out,fixture,work});await stop();return;}
 const imapPhase=process.env.PAPER_REED_IMAP_PAGE_CHECK;
 if(imapPhase){await require('./check-imap-onboarding.cjs')({phase:imapPhase,main,run,until,shot,out});await stop();return;}
 const activePage=main.locator('.page-container:not([inert])');
 await activePage.locator('[data-provider=gmail]').click();
 await activePage.getByRole('button',{name:'使用 Google 登录',exact:true}).waitFor();
 await activePage.and(main.locator('.alpha-fade-enter-done')).locator('[data-google-connect]').waitFor();
 await shot('google-login');
 assert.equal(await activePage.locator('input[type=password]').count(),0);
 await activePage.locator('[data-google-connect]').click();
 await activePage.getByRole('alert').filter({hasText:'Google 登录尚未配置'}).waitFor();
 await main.getByRole('button',{name:'返回邮箱选择',exact:true}).click();
 console.log('PASS Google login without password or JSON picker; missing project config reported');
 assert.equal(await activePage.locator('[data-provider=office365]').count(),0);
 await activePage.locator('[data-provider=imap]').click();
 await activePage.locator('#emailAddress').fill('fixture@gmail.com');
 await activePage.locator('[data-use-google]').waitFor();
 assert.equal(await activePage.locator('input[type=password]').count(),0);
 await activePage.locator('[data-use-google]').click();
 await activePage.locator('[data-google-connect]').waitFor();
 assert.equal(await activePage.locator('.pr-google-account').textContent(),'fixture@gmail.com');
 const previous=main.getByRole('button',{name:'返回上一步',exact:true});
 await previous.click();
 assert.equal(await activePage.locator('#emailAddress').inputValue(),'fixture@gmail.com');
 await previous.click();
 await activePage.locator('[data-provider=icloud]').click();
 await activePage.locator('#name').fill('iCloud fixture');
 await activePage.locator('#emailAddress').fill('fixture@icloud.com');
 await activePage.locator('[id="settings.imap_password"]').fill('fixture-app-password');
 await activePage.getByRole('button',{name:'服务器设置…',exact:true}).click();
 await activePage.locator('[id="settings.imap_host"]').waitFor();
 assert.equal(await activePage.locator('[id="settings.imap_host"]').inputValue(),'imap.mail.me.com');
 assert.equal(await activePage.locator('[id="settings.smtp_host"]').inputValue(),'smtp.mail.me.com');
 assert.equal(await activePage.locator('[id="settings.smtp_port"]').inputValue(),'587');
 assert.equal(await activePage.locator('[id="settings.smtp_security"]').inputValue(),'STARTTLS');
 await activePage.locator('.AccountIMAPSettingsForm').getByRole('button',{name:'返回',exact:true}).click();
 const icloud=activePage.locator('.pr-icloud-setup');
 assert.equal(await icloud.locator('#emailAddress').inputValue(),'fixture@icloud.com');
 assert(await icloud.getByRole('button',{name:'连接邮箱',exact:true}).isEnabled(),'returning before the fade ends reopens an editable form');
 await previous.click();
 const basic=activePage.locator('.AccountBasicSettingsForm');
 await activePage.locator('[data-provider=imap]').click();
 await basic.locator('#name').waitFor();
 assert.equal(await basic.locator('#emailAddress').inputValue(),'','switching providers starts a fresh form');
 await until(()=>run('!document.querySelector(".alpha-fade-enter, .alpha-fade-exit")'),'manual provider form transition complete');
 console.log('PASS provider selection, Microsoft entry removed and Gmail redirected, iCloud settings and back navigation');
 assert.equal(await app.evaluate(({app})=>app.getName()),'Paper Reed');
 assert.equal(await app.evaluate(({app})=>app.getPath('userData')),config);
 assert.equal((JSON.parse(fs.readFileSync(path.join(config,'config.json')))['*'].accounts||[]).length,0);
 await shot('connect-account');
 await activePage.locator('#name').fill('Paper Reed Test');
 await activePage.locator('#emailAddress').fill(fixture.emailAddress);
 await activePage.locator('[id="settings.imap_password"]').fill('wrong-password');
 await activePage.locator('[data-manual-setup]').click();
 await activePage.locator('[id="settings.imap_host"]').waitFor();
 for(const protocol of ['imap','smtp']){
   await activePage.locator(`[id="settings.${protocol}_host"]`).fill(fixture.settings[protocol+'_host']);
   await activePage.locator(`[id="settings.${protocol}_port"]`).selectOption({label:'Custom'});
   await activePage.locator(`[id="settings.${protocol}_port_custom"]`).fill(String(fixture.settings[protocol+'_port']));
   await activePage.locator(`[id="settings.${protocol}_security"]`).selectOption('none');
   await activePage.locator(`[id="settings.${protocol}_username"]`).fill(fixture.settings[protocol+'_username']);
 }
 await run(`(()=>{
  const {MailsyncProcess}=require('mailspring-exports');
  const test=MailsyncProcess.prototype.test;
  MailsyncProcess.prototype.test=async function(){
   try{return await test.call(this);}
   catch(error){
    window.prFixtureDiagnostic={code:error.errorCode,network:error.isNetworkError};
    throw error;
   }
  };
  window.prRestoreMailsyncTest=()=>{MailsyncProcess.prototype.test=test;};
  return true;
 })()`);
 try{
  await activePage.getByRole('button',{name:'连接邮箱',exact:true}).click();
  await until(()=>run('!!document.querySelector(".message.error") && document.body.innerText.includes("Authentication Error")'),'wrong password shown');
  assert((await activePage.locator('.message.error').first().innerText()).includes('Authentication Error'));
  assert.deepEqual(await run('window.prFixtureDiagnostic'),{code:'ErrorAuthentication',network:false});
 }finally{
  await run('window.prRestoreMailsyncTest();true');
 }
 assert.equal((JSON.parse(fs.readFileSync(path.join(config,'config.json')))['*'].accounts||[]).length,0);
 const layout=await run('({x:document.querySelector(".pr-onboarding").getBoundingClientRect().x,errorY:document.querySelector(".message.error").getBoundingClientRect().y})');
 assert.equal(layout.x,0);assert(layout.errorY>=0&&layout.errorY<780);
 await shot('connection-error');
 console.log('PASS failed authentication preserves the native diagnostic and leaves no saved account');
 for(const protocol of ['imap','smtp'])await activePage.locator(`[id="settings.${protocol}_password"]`).fill(fixture.settings[protocol+'_password']);
 await run(`(()=>{
  const ipc=require('electron').ipcRenderer,invoke=ipc.invoke;
  const probe=window.prCredentialWrite={calls:0};
  ipc.invoke=function(channel,...args){
   if(channel!=='credentials:update')return invoke.call(this,channel,...args);
   probe.calls++;
   return new Promise((resolve,reject)=>{
    probe.release=()=>invoke.call(this,channel,...args).then(resolve,reject);
   });
  };
  probe.restore=()=>{ipc.invoke=invoke;};
  return true;
 })()`);
 try {
  await activePage.getByRole('button',{name:'连接邮箱',exact:true}).click();
  await until(()=>run('!!window.prCredentialWrite.release'),'paused real credential write');
  await checkAccountSaveLocked();
  assert.equal(await run('window.prCredentialWrite.calls'),1);
  await run('window.prCredentialWrite.restore();window.prCredentialWrite.release();true');
 }finally{
  if(!main.isClosed())await run('window.prCredentialWrite.restore();true').catch(()=>{});
 }
 await selectWindow('default');
 await until(()=>run('document.querySelectorAll(".pr-mail-row").length===2'),'initial inbox');
 const account=(await run('require("mailspring-exports").AccountStore.accounts().map(a=>({id:a.id,emailAddress:a.emailAddress}))'))[0];
 const savedConfig=JSON.parse(fs.readFileSync(path.join(config,'config.json')))['*'];
 assert.equal(savedConfig.accounts.length,1);assert(!fs.readFileSync(path.join(config,'config.json'),'utf8').includes('imap_password'));
 assert(!savedConfig.identity);assert.equal(await app.evaluate(()=>global.application.autoUpdateManager.getState()),'unsupported');
 await shot('inbox');console.log('PASS blank profile / wrong credentials / native connection / initial inbox');
 // Reserve a fixture port so another running Paper Reed profile is unaffected.
 const reservation=require('node:net').createServer();
 await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
 const mcpPort=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
 await run(`AppEnv.config.set('core.mcp.port',${mcpPort});true`);
 // Establish read-only access and install the real CLI through settings.
 await main.locator('.pr-sidebar button').filter({hasText:'设置'}).click();await click('[data-settings-tab=MCP]');
 await main.locator('#pr-agent-enabled').check();await click('input[name=agent-access][value=read-only]');
 await click('[data-cli-action=install]');
 await until(()=>run('!document.querySelector("[data-cli-action=install]").disabled'),'installed');
 await click('[data-cli-action=doctor]');
 await until(()=>run('document.querySelector(".pr-cli-feedback").innerText.includes("连接正常")'),'CLI doctor');
 const cliPath=path.join(work,'bin','paper-reed');
 const cli=async(command,input)=>{
   const env={...process.env};for(const key of ['PAPER_REED_UPSTREAM','PAPER_REED_MCP_URL','PAPER_REED_TOKEN_FILE','PAPER_REED_CLI_PROFILE','ELECTRON_RUN_AS_NODE'])delete env[key];
   const result=await exec(cliPath,[command,...(input?['--input',JSON.stringify(input)]:[])],{env,timeout:30000});return JSON.parse(result.stdout);
 };
 assert((await cli('doctor')).ok);assert.equal((await cli('accounts'))[0].id,account.id);
 const messages=await cli('search',{accountId:account.id,query:'in:inbox'});assert.equal(messages.length,2);
 await shot('installed-cli');
 // Normal restart restores the account without setup or fixture credential injection.
 await stop();await start();await selectWindow('default');
 await until(()=>run('document.querySelectorAll(".pr-mail-row").length===2'),'restart inbox');
 assert(!app.windows().some(w=>type(w)==='onboarding'));await until(async()=>{try{return (await cli('doctor')).ok;}catch{return false;}},'CLI ready after restart');
 // Rotate credentials at the fixture server; no account/config mutation in the client.
 fs.writeFileSync(path.join(work,'rotate-password'),'');
 await until(async()=>fs.existsSync(path.join(work,'password-rotated')),'fixture credential rotation');
 await stop();await start();await selectWindow('default');
 await main.getByRole('button',{name:'重新连接',exact:true}).waitFor({timeout:45000});
 await shot('reconnect');await main.getByRole('button',{name:'重新连接',exact:true}).click();
 await selectWindow('onboarding');
 for(const protocol of ['imap','smtp'])await main.locator(`[id="settings.${protocol}_password"]`).fill('rotated-pass');
 await main.getByRole('button',{name:'连接邮箱',exact:true}).click();
 await until(async()=>!app.windows().some(w=>type(w)==='onboarding'),'reconnect completed');
 await selectWindow('default');
 await until(()=>run('!document.querySelector(".pr-sync-status")?.innerText.includes("需要重新连接")'),'sync resumed');
 assert.equal(await run('require("mailspring-exports").AccountStore.accounts().length'),1);
 console.log('PASS normal restart / expired credentials / GUI reconnect');
 const row=main.locator('.pr-mail-row').filter({hasText:'First run review'});await row.click();
 await main.locator('.footer-reply-area').first().click();
 await main.locator('[contenteditable=true]').first().waitFor();
 await main.locator('[contenteditable=true]').first().click();await main.keyboard.insertText('Paper Reed first run reply');
 await click('[data-mailbox=drafts]');
 await main.locator('[data-draft-id]').waitFor();const draftId=await main.locator('[data-draft-id]').first().getAttribute('data-draft-id');
 const ref={accountId:account.id,draftId};assert((await cli('draft-get',ref)).body.includes('Paper Reed first run reply'));
 await stop();await start();await selectWindow('default');
 await click('[data-mailbox=drafts]');await until(()=>run('!!document.querySelector("[data-draft-id]")'),'restored draft');
 await click('[data-draft-id]');await main.locator('[contenteditable=true]').first().waitFor();
 assert((await main.locator('[contenteditable=true]').first().innerText()).includes('Paper Reed first run reply'));
 await click('.btn-send .primary-item');
 await until(async()=> (await run("require('mailspring-exports').DatabaseStore._query('SELECT phase,sentCopy FROM PaperReedSend')")).some(o=>o.phase==='accepted'&&o.sentCopy==='filed'),'GUI send');
 await click('[data-mailbox=inbox]');await main.locator('.pr-mail-row').filter({hasText:'Archive this note'}).focus();
 await main.keyboard.press('x');await click('[data-mail-action=archive]');
 await until(async()=>!(await cli('search',{accountId:account.id,query:'in:inbox'})).some(t=>t.subject==='Archive this note'),'archive visible in CLI');
 await shot('completed');
 // Exercise the real account store's reconnect merge and encrypted credential round trip.
 const migrated=await run(`(async()=>{
  const {AccountStore,KeyManager}=require('mailspring-exports');
  const original=await KeyManager.insertAccountSecrets(AccountStore.accounts()[0]);
  const replacement=original.clone();replacement.provider='gmail';
  replacement.settings.refresh_token='fixture-unified-refresh';
  replacement.settings.gmail_client_secret='fixture-client-secret';
  replacement.settings.gmail_api_send=true;
  delete replacement.settings.imap_password;delete replacement.settings.smtp_password;
  const stored=await AccountStore.addAccount(replacement);
  const restored=await KeyManager.insertAccountSecrets(stored);
  const result={sameId:stored.id===original.id,provider:stored.provider,
   tokenRestored:restored.settings.refresh_token==='fixture-unified-refresh',
   noPassword:!restored.settings.imap_password&&!restored.settings.smtp_password,
   oneAccount:AccountStore.accounts().length===1,
   noPlaintext:!JSON.stringify(AppEnv.config.get('accounts')).includes('fixture-unified-refresh')};
  await AccountStore.addAccount(original);return result;
 })()`);
 assert.deepEqual(migrated,{sameId:true,provider:'gmail',tokenRestored:true,noPassword:true,oneAccount:true,noPlaintext:true});
 console.log('PASS actual account store reconnect updates provider and encrypts the shared grant');
 const aliasCredentials=await run(`(async()=>{
  const {AccountStore,KeyManager,MailsyncProcess}=require('mailspring-exports');
  const {buildPaperReedGmailAccount}=require(${onboardingLib}+'onboarding-helpers');
  const original=AccountStore.accounts()[0];
  const alias=original.clone();Object.assign(alias,{id:'fixture-google-alias',emailAddress:'test@googlemail.com'});
  Object.assign(alias.settings,{imap_password:'old-imap',smtp_password:'old-smtp',gmail_refresh_token:'old-grant'});
  const canonical=original.clone();Object.assign(canonical,{id:'fixture-google-canonical',emailAddress:'te.st@gmail.com'});
  canonical.settings.imap_password='other-account-password';
  await AccountStore.addAccount(canonical);
  const storedAlias=await AccountStore.addAccount(alias);
  const originalTest=MailsyncProcess.prototype.test;
  let replacement;
  try{
   MailsyncProcess.prototype.test=async()=>{};
   replacement=await buildPaperReedGmailAccount({emailAddress:canonical.emailAddress,settings:{refresh_token:'new-alias-grant'}},storedAlias);
  }finally{MailsyncProcess.prototype.test=originalTest;}
  const stored=await (AccountStore.reconnectAccount
   ? AccountStore.reconnectAccount(replacement,storedAlias)
   : AccountStore.addAccount(replacement));
  const restored=await KeyManager.insertAccountSecrets(stored);
  const result={sameAccount:stored.id===alias.id&&stored.emailAddress===alias.emailAddress,
   verifiedUsername:stored.settings.imap_username===canonical.emailAddress&&stored.settings.smtp_username===canonical.emailAddress,
   replaced:restored.settings.refresh_token==='new-alias-grant'&&!restored.settings.imap_password&&
    !restored.settings.smtp_password&&!restored.settings.gmail_refresh_token};
  await KeyManager.deleteAccountSecrets(stored);
  const keys=await KeyManager._getKeyHash();
  result.deleted=Object.keys(keys).every(key=>!key.startsWith(alias.emailAddress+'-'));
  result.otherAccountUnchanged=AccountStore.accountForId(canonical.id)?.emailAddress===canonical.emailAddress&&
   keys[canonical.emailAddress+'-imap']==='other-account-password'&&!keys[canonical.emailAddress+'-refresh-token'];
  return result;
 })()`);
 assert.deepEqual(aliasCredentials,{sameAccount:true,verifiedUsername:true,replaced:true,deleted:true,otherAccountUnchanged:true});
 console.log('PASS Gmail alias reconnect replaces stored credentials, deletion clears them, and the other record is untouched');
 await checkDeletedGoogleReconnect();
 const result={blankProfile:true,productName:'Paper Reed',independentProfile:true,noInjectedAccountsOrCredentials:true,wrongPasswordLeavesNoAccount:true,GUIAccountSetup:true,noUpstreamIdentity:true,upstreamUpdaterDisabled:true,firstSync:true,normalRestart:true,credentialsPersist:true,expiredCredentialsReconnect:true,GUIReplySaved:true,replyRestoredAfterRestart:true,GUISend:true,GUIArchive:true,installedCLI:true,noCLIConnectionEnvironment:true,CLIReadSameMail:true,readOnlyAgentAccess:true,packaged:!!packaged,googleLoginNoPassword:true,googleMissingConfig:true,microsoftEntryRemoved:true,gmailFromIMAP:true,fastProviderReentry:true,accountSaveNavigationLocked:true,reconnectProviderAndCredentials:true,aliasReconnectCredentials:true};
 result.deletionWinsOverGoogleReconnect=true;
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log('PASS',JSON.stringify(result));
 await stop();
})().catch(async error=>{console.error(error);if(main&&!main.isClosed()){fs.writeFileSync(path.join(work,'failure-dom.txt'),await main.locator('body').innerText().catch(()=>''));await shot('failure').catch(()=>{});}process.exitCode=1;}).finally(()=>{if(app)app.process().kill('SIGKILL');});
