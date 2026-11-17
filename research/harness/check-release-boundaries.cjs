const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict"),
  { execFileSync } = require("node:child_process");
const root = process.cwd(),
  up = path.join(root, "research/.local/Mailspring"),
  { _electron } = require(path.join(up, "node_modules/playwright"));
assert(
  process.env.AUDIT_PROFILE,
  "Set AUDIT_PROFILE to a synthetic cached fixture profile",
);
const original = path.resolve(process.env.AUDIT_PROFILE);
const profile = fs.mkdtempSync(path.join(root, "research/.local/live-search-"));
const cfg = JSON.parse(fs.readFileSync(path.join(original, "config.json")));
assert(
  cfg["*"].accounts.every((a) => a.emailAddress.endsWith("@example.test")),
  "Use synthetic accounts only",
);
cfg["*"].core.mcp = { enabled: false };
fs.writeFileSync(path.join(profile, "config.json"), JSON.stringify(cfg));
execFileSync("python3", [
  "-c",
  "import sqlite3,sys; a=sqlite3.connect(sys.argv[1]); b=sqlite3.connect(sys.argv[2]); a.backup(b); b.close(); a.close()",
  path.join(original, "edgehill.db"),
  path.join(profile, "edgehill.db"),
]);
let app, page, server;
const result = { synthetic: true };
const out=path.join(root,'research/release-fixes-2026-11-17');fs.mkdirSync(out,{recursive:true});
// Optional local diagnostics; the default workload keeps its existing behavior.
const traceDir = process.env.AUDIT_TRACE_DIR && path.resolve(process.env.AUDIT_TRACE_DIR);
if (traceDir) fs.mkdirSync(traceDir, { recursive: true });
(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PLAYWRIGHT;
  const start = performance.now();
  app = await _electron.launch({
    executablePath: path.join(
      up,
      "app/dist/Paper Reed-darwin-arm64/Paper Reed.app/Contents/MacOS/Paper Reed",
    ),
    args: ["--no-sandbox", "--config-dir-path", profile],
    env,
  });
  const deadline = Date.now() + 30000;
  while (!page) {
    page = app.windows().find((p) => {
      try {
        return (
          JSON.parse(new URL(p.url()).searchParams.get("loadSettings"))
            .windowType === "default"
        );
      } catch {
        return false;
      }
    });
    if (Date.now() > deadline) throw Error("No main window");
    if (!page) await new Promise((r) => setTimeout(r, 25));
  }
  await page.locator(".pr-mail-row").first().waitFor();
  result.launchToRowsMs = Math.round(performance.now() - start);
  const cdp = await app.context().newCDPSession(page);
  const run = async (expression) => {
    const v = await cdp.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (v.exceptionDetails) throw Error(JSON.stringify(v.exceptionDetails));
    return v.result.value;
  };




  const pause=ms=>new Promise(r=>setTimeout(r,ms));
  await run(`window.auditEnv=require('mailspring-exports');window.auditRoot=AppEnv.getLoadSettings().resourcePath;window.auditTriage=require(auditRoot+'/src/services/mail-core/local-triage');window.auditInbox=require(auditRoot+'/src/services/mail-core/inbox');true`);
  const requests=[];
  server=require('node:http').createServer((req,res)=>{requests.push(req.url);res.writeHead(200,{'Content-Type':'image/png'});res.end(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nX8AAAAASUVORK5CYII=','base64'))});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const origin='http://127.0.0.1:'+server.address().port;
  const markup=`<img src="${origin}/ordinary"><img srcset="${origin}/srcset 1x"><div style="width:40px;height:40px;background: red url(${origin}/shorthand)">style</div><style>.audit-css{background-image:url(${origin}/stylesheet);width:40px;height:40px}@font-face{font-family:audit;src:url(${origin}/font)}.audit-font{font-family:audit}</style><div class="audit-css">CSS</div><div class="audit-font">FONT</div><img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nX8AAAAASUVORK5CYII=" id="audit-inline"><script>parent.auditInjected=true</script><img src="x" onerror="parent.auditInjected=true"><a href="file:///tmp/audit" data-command="bad">test</a>`;
  await run(`(async()=>{
    AppEnv.config.set('core.reading.autoloadImages',false);
    window.auditMessage=(await auditEnv.DatabaseStore.findAll(auditEnv.Message).where({draft:false}).limit(1))[0].clone();
    auditMessage.body=${JSON.stringify(markup)};auditMessage.plaintext=false;
    window.auditProcessed=await auditEnv.MessageBodyProcessor._process(auditMessage);
    window.auditImages=require(auditRoot+'/internal_packages/message-autoload-images/lib/autoload-images-store').default;
    const EmailFrame=require(auditRoot+'/internal_packages/message-list/lib/email-frame').default;
    const mount=document.createElement('div');mount.id='audit-email-mount';document.body.appendChild(mount);
    require('react-dom').render(require('react').createElement(EmailFrame,{content:auditProcessed.body,message:auditMessage,showQuotedText:true}),mount);
    window.auditFirstFrame=mount.querySelector('iframe');
  })()`);
  await pause(350);
  result.render={blockedRequests:requests.slice(),scriptExecuted:await run('window.auditInjected===true'),inlineLoaded:await run("document.querySelector('#audit-email-mount iframe').contentDocument.querySelector('#audit-inline').naturalWidth>0")};
  assert.deepEqual(result.render.blockedRequests,[]);assert.equal(result.render.scriptExecuted,false);assert.equal(result.render.inlineLoaded,true);
  await run('auditImages._onTemporarilyEnableImages(auditMessage);true');await pause(350);
  result.render.allowedRequests=requests.slice();result.render.frameRecreated=await run("auditFirstFrame!==document.querySelector('#audit-email-mount iframe')");
  for(const resource of ['/ordinary','/srcset','/shorthand','/stylesheet','/font'])assert(requests.includes(resource),resource+' did not load after explicit consent');
  assert(result.render.frameRecreated);
  requests.length=0;
  await run('delete auditImages._whitelistMessageIds[auditMessage.id];auditImages.trigger();true');await pause(350);
  result.render.reblockedRequests=requests.slice();assert.deepEqual(requests,[]);
  await run("require('react-dom').unmountComponentAtNode(document.querySelector('#audit-email-mount'));document.querySelector('#audit-email-mount').remove();true");
  console.log('PASS actual EmailFrame blocks remote resources, keeps inline image, permits explicit loading and blocks again',JSON.stringify(result.render));

  // Use the production main-process store and real IPC. Only cryptography is replaced;
  // credentials are fictitious and the profile is disposable. No OS keychain calls.
  await app.evaluate(({app})=>{
    const mod=process.mainModule.require(app.getAppPath()+'/src/browser/credential-store');
    global.auditStorageOriginal={...mod.secureStorage};
    Object.assign(mod.secureStorage,{isAvailable:async()=>true,encrypt:async text=>{await new Promise(r=>setTimeout(r,15));return Buffer.from(text)},decrypt:async bytes=>({result:bytes.toString(),shouldReEncrypt:false})});
    global.application.config.set('credentials',Buffer.from('{}'));
  });
  result.credentials=await run(`(async()=>{
    const km=auditEnv.KeyManager;
    await Promise.all([km.replacePassword('audit-a@example.test-refresh-token','synthetic-A'),km.replacePassword('audit-b@example.test-refresh-token','synthetic-B')]);
    const both=await km._getKeyHash();
    await Promise.all([km.deleteAccountSecrets({emailAddress:'audit-a@example.test'}),km.replacePassword('audit-b@example.test-refresh-token','synthetic-B-new')]);
    const after=await km._getKeyHash();
    return {bothUpdatesSaved:!!both['audit-a@example.test-refresh-token']&&!!both['audit-b@example.test-refresh-token'],deletedAccountStaysDeleted:!after['audit-a@example.test-refresh-token'],otherAccountUpdated:after['audit-b@example.test-refresh-token']==='synthetic-B-new'};
  })()`);
  assert(Object.values(result.credentials).every(Boolean));
  const other=app.windows().find(w=>w!==page);assert(other,'Expected the app hot window for a second IPC caller');
  const otherCDP=await app.context().newCDPSession(other);
  const otherCall=await otherCDP.send('Runtime.evaluate',{expression:`require(AppEnv.getLoadSettings().resourcePath+'/src/key-manager').default.replacePassword('audit-c@example.test-refresh-token','synthetic-C').then(()=>true)`,awaitPromise:true,returnByValue:true});
  assert(!otherCall.exceptionDetails,JSON.stringify(otherCall.exceptionDetails));
  await Promise.all([
    run(`auditEnv.KeyManager.replacePassword('audit-b@example.test-refresh-token','synthetic-B-cross-window')`),
    otherCDP.send('Runtime.evaluate',{expression:`require(AppEnv.getLoadSettings().resourcePath+'/src/key-manager').default.replacePassword('audit-c@example.test-refresh-token','synthetic-C-cross-window')`,awaitPromise:true,returnByValue:true}).then(v=>assert(!v.exceptionDetails,JSON.stringify(v.exceptionDetails))),
  ]);
  result.credentials.crossWindowUpdatesSaved=await run(`auditEnv.KeyManager._getKeyHash().then(k=>k['audit-b@example.test-refresh-token']==='synthetic-B-cross-window'&&k['audit-c@example.test-refresh-token']==='synthetic-C-cross-window')`);
  assert(result.credentials.crossWindowUpdatesSaved);

  result.credentials.untrustedWindowRejected=await app.evaluate(async({BrowserWindow})=>{
    const w=new BrowserWindow({show:false,webPreferences:{nodeIntegration:true,contextIsolation:false,sandbox:false}});
    await w.loadURL('about:blank');
    const denied=await w.webContents.executeJavaScript("require('electron').ipcRenderer.invoke('credentials:read').then(()=>false,()=>true)");
    w.destroy();return denied;
  });assert(result.credentials.untrustedWindowRejected);
  // A failed write must preserve the old blob, propagate, and not poison the next write.
  result.credentials.failureRecovery=await app.evaluate(async({app})=>{
    const {CredentialStore}=process.mainModule.require(app.getAppPath()+'/src/browser/credential-store');let blob;let fail=true;
    const store=new CredentialStore({get:()=>blob,set:(_k,v)=>blob=v},{isAvailable:async()=>true,encrypt:async t=>{if(fail){fail=false;throw Error('synthetic storage unavailable')}return Buffer.from(t)},decrypt:async b=>({result:b.toString(),shouldReEncrypt:false}),decryptLegacy:()=>{throw Error('unused')}});
    const results=await Promise.allSettled([store.update({set:{a:'fake'}}),store.update({set:{b:'fake'}})]);
    return {outcomes:results.map(r=>r.status),keys:Object.keys(await store.read())};
  });assert.deepEqual(result.credentials.failureRecovery,{outcomes:['rejected','fulfilled'],keys:['b']});
  await app.evaluate(({app})=>{global.application.config.set('credentials',undefined);Object.assign(process.mainModule.require(app.getAppPath()+'/src/browser/credential-store').secureStorage,global.auditStorageOriginal)});
  console.log('PASS credential updates, deletion, failed-write recovery and untrusted IPC rejection',JSON.stringify(result.credentials));

  await run('auditTriage.ensureLocalTriage()');
  const target=await run("auditEnv.DatabaseStore._query('SELECT accountId,id AS threadId FROM Thread LIMIT 1').then(r=>r[0])");
  const {spawn}=require('node:child_process');
  const lock=spawn('python3',['-u','-c',"import sqlite3,sys,time; c=sqlite3.connect(sys.argv[1]); print(c.execute('pragma journal_mode').fetchone()[0],flush=True); c.execute('BEGIN IMMEDIATE'); print('LOCKED',flush=True); time.sleep(1.8); c.rollback()",path.join(profile,'edgehill.db')]);
  let lockLog='';await new Promise((resolve,reject)=>{lock.stdout.on('data',d=>{lockLog+=d;if(lockLog.includes('LOCKED'))resolve()});lock.on('error',reject);lock.on('exit',c=>{if(c)reject(Error('lock exit '+c))})});
  result.writer=await run(`(async()=>{const start=performance.now();const heartbeat=new Promise(r=>setTimeout(()=>r(performance.now()-start),20));const changed=await auditTriage.changeLocalMail({action:'pin',targets:[${JSON.stringify(target)}]},auditInbox.inboxDesktopAccess);return {operationMs:performance.now()-start,heartbeatMs:await heartbeat,changed}})()`);
  result.writer.journalMode=lockLog.trim().split('\n')[0];assert.equal(result.writer.journalMode,'wal');assert(result.writer.heartbeatMs<300);assert.equal(result.writer.changed.items[0].status,'succeeded');
  console.log('PASS WAL write contention keeps renderer responsive',JSON.stringify(result.writer));
  result.query=await run(`(async()=>{
    const unhandled=[];const listener=e=>{unhandled.push(String(e.reason));e.preventDefault()};window.addEventListener('unhandledrejection',listener);
    const receiver={_open:true,_executeLocally:async()=>{throw Error('AUDIT_SQLITE_BUSY')},_prettyConsoleLog:()=>{}};
    const outcome=await Promise.race([auditEnv.DatabaseStore._query.call(receiver,'SELECT 1').then(()=> 'resolved',()=> 'rejected'),new Promise(r=>setTimeout(()=>r('pending-after-250ms'),250))]);
    await new Promise(r=>setTimeout(r,50));window.removeEventListener('unhandledrejection',listener);return {outcome,unhandled};
  })()`);assert.equal(result.query.outcome,'rejected');assert.deepEqual(result.query.unhandled,[]);
  await run("auditEnv.DatabaseStore._query('SELECT 1',[],true)");
  const pid=await run('auditEnv.DatabaseStore._agent.pid');process.kill(pid,'SIGSTOP');
  await run("window.auditPending='pending';auditEnv.DatabaseStore._query('SELECT 42 AS audit',[],true).then(()=>auditPending='resolved',()=>auditPending='rejected');true");process.kill(pid,'SIGKILL');await pause(300);
  result.query.helperExit=await run('auditPending');assert.equal(result.query.helperExit,'rejected');
  result.query.nextQuery=await run("auditEnv.DatabaseStore._query('SELECT 42 AS audit',[],true).then(r=>r[0].audit)");assert.equal(result.query.nextQuery,42);
  console.log('PASS local rejection and helper exit settle queries; next helper query succeeds',JSON.stringify(result.query));

  const reserve=require('node:net').createServer();await new Promise(r=>reserve.listen(0,'127.0.0.1',r));const port=reserve.address().port;await new Promise(r=>reserve.close(r));
  const token=require('node:crypto').randomBytes(32).toString('hex');
  result.packagedVersions=await run(`Object.fromEntries(['dompurify','zod','@modelcontextprotocol/sdk'].map(n=>[n,JSON.parse(require('fs').readFileSync(auditRoot+'/node_modules/'+n+'/package.json')).version]))`);
  await run(`window.auditMCP=new (require(auditRoot+'/internal_packages/mcp-server/lib/mcp-http-server').McpHttpServer)();auditMCP.start(${port},()=>${JSON.stringify(token)})`);
  const send=async(body,{auth=token,host='127.0.0.1:'+port,session,chunked=false}={})=>{
    const data=JSON.stringify(body);
    return new Promise((resolve,reject)=>{const req=require('node:http').request({hostname:'127.0.0.1',port,path:'/mcp',method:'POST',headers:{'Content-Type':'application/json','Accept':'application/json, text/event-stream',Authorization:'Bearer '+auth,Host:host,...(session?{'mcp-session-id':session}:{}),...(chunked?{}:{'Content-Length':Buffer.byteLength(data)})}},res=>{let text='';res.on('data',d=>text+=d);res.on('end',()=>resolve({status:res.statusCode,session:res.headers['mcp-session-id'],text}))});req.on('error',reject);if(chunked){for(let i=0;i<data.length;i+=16384)req.write(data.slice(i,i+16384));req.end()}else req.end(data)});
  };
  const init={jsonrpc:'2.0',id:1,method:'initialize',params:{protocolVersion:'2025-03-26',capabilities:{},clientInfo:{name:'audit',version:'1'}}};
  const large={...init,params:{...init.params,clientInfo:{name:'x'.repeat(5*1024*1024),version:'1'}}};
  result.mcp={wrongToken:(await send(init,{auth:'wrong'})).status,wrongHost:(await send(init,{host:'attacker.test:'+port})).status,largeInitialize:(await send(large)).status,chunkedInitialize:(await send(large,{chunked:true})).status};
  assert.deepEqual(result.mcp,{wrongToken:401,wrongHost:403,largeInitialize:413,chunkedInitialize:413});
  const established=await send(init);assert.equal(established.status,200);assert(established.session);
  const hugeCollection=await send({jsonrpc:'2.0',id:2,method:'tools/call',params:{name:'search_mail',arguments:{filter:{and:Array.from({length:11000},()=>({text:'x'}))}}}},{session:established.session});
  result.mcp.collectionRejected=/maximum of 10000 elements/.test(hugeCollection.text);assert(result.mcp.collectionRejected,hugeCollection.text);
  result.mcp.largeEstablished=(await send({...large,id:3},{session:established.session})).status;assert.equal(result.mcp.largeEstablished,413);
  const toolList=await send({jsonrpc:'2.0',id:4,method:'tools/list'},{session:established.session});result.mcp.normalRequestAfterRejections=toolList.status===200&&toolList.text.includes('search_mail');assert(result.mcp.normalRequestAfterRejections);
  await fetch('http://127.0.0.1:'+port+'/mcp',{method:'DELETE',headers:{Authorization:'Bearer '+token,'mcp-session-id':established.session}});result.localCLI=await require('./check-local-helper-cli.cjs')({run,page,port,token,profile,root,out});await run('auditMCP.stop()');
  console.log('PASS MCP auth/Host, fixed and chunked bodies, established transport, collection bounds and subsequent normal request',JSON.stringify(result.mcp));
  fs.writeFileSync(path.join(out,'boundaries-result.json'),JSON.stringify(result,null,2)+'\n');
})().catch(e=>{console.error(e);console.error(JSON.stringify(result,null,2));process.exitCode=1}).finally(async()=>{if(server)server.close();if(app)await app.close();});
