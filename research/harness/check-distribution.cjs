// Inspect and exercise the actual configured macOS package without external network or consent.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const [upstream,executable,clientFile,output]=process.argv.slice(2).map(p=>path.resolve(p));
const {_electron}=require(path.join(upstream,'node_modules/playwright'));
const folder=fs.mkdtempSync(path.join(path.dirname(upstream),'distribution-check-'));
let app;
(async()=>{
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;delete env.PLAYWRIGHT;delete env.PAPER_REED_GOOGLE_CLIENT_FILE;
 app=await _electron.launch({executablePath:executable,args:['--no-sandbox','--config-dir-path',folder],env});
 const page=await app.firstWindow();await page.locator('[data-provider=gmail]').waitFor();
 const cdp=await app.context().newCDPSession(page);
 const run=async expression=>{
  const response=await cdp.send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});
  if(response.exceptionDetails)throw Error('Packaged configuration inspection failed');
  return response.result.value;
 };
 const metadata=await run(`(()=>{
  const fs=require('fs'),path=require('path'),base=AppEnv.getLoadSettings().resourcePath;
  const pkg=JSON.parse(fs.readFileSync(path.join(base,'package.json'),'utf8'));
  const config=JSON.parse(fs.readFileSync(path.join(base,'paper-reed-google-client.json'),'utf8'));
  const expected=JSON.parse(fs.readFileSync(${JSON.stringify(clientFile)},'utf8'));
  window.__expectedClient=config.installed.client_id;
  return {version:pkg.version,revision:pkg.commitHash,repository:pkg.repository.url,
   configured:!!config.installed.client_id&&!!config.installed.client_secret,
   projectMatches:config.installed.client_id===expected.installed.client_id&&config.installed.client_secret===expected.installed.client_secret,
   onlyProjectConfig:Object.keys(config).join(',')==='installed'&&Object.keys(config.installed).sort().join(',')==='client_id,client_secret'};
 })()`);
 assert.equal(metadata.version,'0.1.0-preview.1');assert(/^[a-f0-9]{40}(-dirty)?$/.test(metadata.revision));
 assert.equal(metadata.repository,'https://github.com/macopc/PaperReed.git');
 assert(metadata.configured&&metadata.projectMatches&&metadata.onlyProjectConfig);
 await run(`require('electron').shell.openExternal=async url=>{window.__googleURL=url;};true`);
 await page.locator('[data-provider=gmail]').click();
 await page.locator('[data-google-connect]').click();
 await page.getByRole('status').filter({hasText:'请在浏览器中完成 Google 登录'}).waitFor();
 const deadline=Date.now()+10000;
 while(!await run('!!window.__googleURL')) {
  if(Date.now()>deadline)throw Error('Browser authorization URL was not produced');
  await new Promise(resolve=>setTimeout(resolve,50));
 }
 const correctClient=await run(`new URL(window.__googleURL).searchParams.get('client_id')===window.__expectedClient`);
 assert(correctClient,'Bundled project identity must be used without environment configuration');
 const callback=await run(`new URL(window.__googleURL).searchParams.get('redirect_uri')`);
 await page.getByRole('button',{name:'取消连接',exact:true}).click();
 await page.locator('.alpha-fade-enter-done [data-provider=gmail]').waitFor();
 await assert.rejects(fetch(callback), 'Cancelled authorization listener must close');
 assert.equal(await run('require("mailspring-exports").AccountStore.accounts().length'),0);
 fs.mkdirSync(path.dirname(output),{recursive:true});
 fs.writeFileSync(output,JSON.stringify({...metadata,noOAuthEnvironment:true,bundledLogin:true,cancelClosesCallback:true,noAccountSaved:true,externalNetwork:false},null,2)+'\n');
 console.log('PASS configured package identity, project match, browser login handoff and cancellation');
})().catch(error=>{console.error(error.message);process.exitCode=1}).finally(async()=>{
 if(app)await app.close();fs.rmSync(folder,{recursive:true,force:true});
});
