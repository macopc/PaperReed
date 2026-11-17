const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {createRequire}=require('node:module'),{execFile}=require('node:child_process');
const exec=require('node:util').promisify(execFile);
const [upstream,work,packaged,output]=process.argv.slice(2),r=createRequire(path.join(upstream,'package.json'));
const {_electron}=r('playwright'), fixture=JSON.parse(fs.readFileSync(path.join(work,'fixture.json')));
const config=path.join(work,'profile'),out=output||path.resolve(__dirname,'../first-run-validation-2026-11-16');fs.mkdirSync(out,{recursive:true});
let app,main,cdp;
async function evaluate(session,expression){const result=await session.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw new Error(JSON.stringify(result.exceptionDetails));return result.result.value;}
const run=expression=>evaluate(cdp,expression);
async function until(fn,label,timeout=45000){const end=Date.now()+timeout;while(Date.now()<end){const value=await fn();if(value)return value;await new Promise(resolve=>setTimeout(resolve,200));}throw new Error('Timeout: '+label);}
const type=page=>{try{return JSON.parse(new URL(page.url()).searchParams.get('loadSettings')).windowType;}catch{return null;}};
async function start(){
 const env={...process.env,PAPER_REED_CLI_BIN_DIR:path.join(work,'bin')};delete env.PLAYWRIGHT;delete env.ELECTRON_RUN_AS_NODE;delete env.PAPER_REED_MICROSOFT_CLIENT_ID;
 app=await _electron.launch({executablePath:packaged||r('electron'),args:[...(packaged?[]:[path.join(upstream,'app'),'--dev']),'--no-sandbox','--config-dir-path',config],env,timeout:45000});
 app.process().stderr.on('data',b=>fs.appendFileSync(path.join(work,'electron.log'),b));
 app.on('window',p=>{p.on('dialog',()=>{});p.on('console',msg=>fs.appendFileSync(path.join(work,'renderer.log'),msg.type()+': '+msg.text()+'\n'));});
}
async function selectWindow(kind){main=await until(async()=>app.windows().find(w=>type(w)===kind),kind+' window');cdp=await app.context().newCDPSession(main);}
async function shot(name){const image=await cdp.send('Page.captureScreenshot',{format:'png',fromSurface:true});fs.writeFileSync(path.join(out,name+'.png'),Buffer.from(image.data,'base64'));}
async function click(selector){await main.locator(selector).first().click();}
async function stop(){const process=app.process();await app.evaluate(({app})=>app.quit());await until(async()=>process.exitCode!==null,'normal quit');app=null;}
(async()=>{
 assert(!fs.existsSync(config));await start();await selectWindow('onboarding');
 await main.locator('[data-provider=office365]').click();
 await main.getByText('Microsoft 登录尚未配置',{exact:true}).waitFor();
 await main.getByRole('button',{name:'返回邮箱选择',exact:true}).click();
 await main.locator('[data-provider=icloud]').click();
 await main.locator('#name').fill('iCloud fixture');
 await main.locator('#emailAddress').fill('fixture@icloud.com');
 await main.locator('[id="settings.imap_password"]').fill('fixture-app-password');
 await main.getByRole('button',{name:'下一步',exact:true}).click();
 await main.locator('[id="settings.imap_host"]').waitFor();
 assert.equal(await main.locator('[id="settings.imap_host"]').inputValue(),'imap.mail.me.com');
 assert.equal(await main.locator('[id="settings.smtp_host"]').inputValue(),'smtp.mail.me.com');
 assert.equal(await main.locator('[id="settings.smtp_port"]').inputValue(),'587');
 assert.equal(await main.locator('[id="settings.smtp_security"]').inputValue(),'STARTTLS');
 await main.locator('.AccountIMAPSettingsForm').getByRole('button',{name:'返回',exact:true}).click();
 await main.locator('.AccountBasicSettingsForm').getByRole('button',{name:'返回',exact:true}).click();
 await main.locator('[data-provider=imap]').click();
 await main.locator('#name').waitFor();
 console.log('PASS provider selection, missing Microsoft app configuration, iCloud settings and back navigation');
 assert.equal(await app.evaluate(({app})=>app.getName()),'Paper Reed');
 assert.equal(await app.evaluate(({app})=>app.getPath('userData')),config);
 assert.equal((JSON.parse(fs.readFileSync(path.join(config,'config.json')))['*'].accounts||[]).length,0);
 await shot('connect-account');
 await main.locator('#name').fill('Paper Reed Test');
 await main.locator('#emailAddress').fill(fixture.emailAddress);
 await main.locator('[id="settings.imap_password"]').fill('wrong-password');
 await main.locator('[data-manual-setup]').click();
 await main.locator('[id="settings.imap_host"]').waitFor();
 for(const protocol of ['imap','smtp']){
   await main.locator(`[id="settings.${protocol}_host"]`).fill(fixture.settings[protocol+'_host']);
   await main.locator(`[id="settings.${protocol}_port"]`).selectOption({label:'Custom'});
   await main.locator(`[id="settings.${protocol}_port_custom"]`).fill(String(fixture.settings[protocol+'_port']));
   await main.locator(`[id="settings.${protocol}_security"]`).selectOption('none');
   await main.locator(`[id="settings.${protocol}_username"]`).fill(fixture.settings[protocol+'_username']);
 }
 await main.getByRole('button',{name:'连接邮箱',exact:true}).click();
 await until(()=>run('!!document.querySelector(".message.error") && document.body.innerText.includes("Authentication Error")'),'wrong password shown');
 assert((await main.locator('.message.error').first().innerText()).includes('Authentication Error'));
 assert.equal((JSON.parse(fs.readFileSync(path.join(config,'config.json')))['*'].accounts||[]).length,0);
 const layout=await run('({x:document.querySelector(".pr-onboarding").getBoundingClientRect().x,errorY:document.querySelector(".message.error").getBoundingClientRect().y})');
 assert.equal(layout.x,0);assert(layout.errorY>=0&&layout.errorY<780);
 await shot('connection-error');
 console.log('PASS failed authentication leaves no saved account');
 for(const protocol of ['imap','smtp'])await main.locator(`[id="settings.${protocol}_password"]`).fill(fixture.settings[protocol+'_password']);
 await main.getByRole('button',{name:'连接邮箱',exact:true}).click();
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
 const result={blankProfile:true,productName:'Paper Reed',independentProfile:true,noInjectedAccountsOrCredentials:true,wrongPasswordLeavesNoAccount:true,GUIAccountSetup:true,noUpstreamIdentity:true,upstreamUpdaterDisabled:true,firstSync:true,normalRestart:true,credentialsPersist:true,expiredCredentialsReconnect:true,GUIReplySaved:true,replyRestoredAfterRestart:true,GUISend:true,GUIArchive:true,installedCLI:true,noCLIConnectionEnvironment:true,CLIReadSameMail:true,readOnlyAgentAccess:true,packaged:!!packaged};
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');console.log('PASS',JSON.stringify(result));
 await stop();
})().catch(async error=>{console.error(error);if(main&&!main.isClosed()){fs.writeFileSync(path.join(work,'failure-dom.txt'),await main.locator('body').innerText().catch(()=>''));await shot('failure').catch(()=>{});}process.exitCode=1;}).finally(()=>{if(app)app.process().kill('SIGKILL');});
