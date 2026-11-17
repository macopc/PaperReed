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
let app, page;
const result = { synthetic: true };
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



  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const until=async(expression,timeout=20000)=>{const end=Date.now()+timeout;while(!(await run(expression))){if(Date.now()>end)throw Error('Timeout: '+expression);await pause(30)}};
  if (traceDir) await cdp.send('Tracing.start',{categories:'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.stack,v8,blink.user_timing',transferMode:'ReturnAsStream'});
  await cdp.send('Performance.enable');
  await cdp.send('Profiler.enable');await cdp.send('Profiler.start');
  await run(`(()=>{
    let f=document.querySelector('.pr-workspace');f=f[Object.keys(f).find(k=>k.startsWith('__reactInternalInstance')||k.startsWith('__reactFiber'))];while(f&&!f.stateNode?.refreshOperations)f=f.return;window.ws=f.stateNode;
    const root=AppEnv.getLoadSettings().resourcePath;
    window.loadApi=require(root+'/src/services/mail-core/inbox');
    window.loadEnv=require('mailspring-exports');
    window.loadTasks=[];new PerformanceObserver(list=>loadTasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration})))).observe({type:'longtask'});
  })()`);
  result.database=await run(`loadEnv.DatabaseStore._query('SELECT COUNT(*) threads FROM Thread').then(r=>r[0])`);
  if (traceDir) await run(`(()=>{
    window.syncProbes=[];window.packageProbes=[];
    const manager=AppEnv.packages,activate=manager.activatePackage;
    manager.activatePackage=function(pkg){const start=performance.now();try{return activate.call(this,pkg)}finally{packageProbes.push({name:pkg.name,start,ms:performance.now()-start})}};
    const wrap=(obj,key,label)=>{const fn=obj[key];obj[key]=function(...args){const start=performance.now();try{return fn.apply(this,args)}finally{const ms=performance.now()-start;if(ms>5)syncProbes.push({label,start,ms,stack:new Error().stack})}}};
    wrap(require('electron').ipcRenderer,'sendSync','ipc.sendSync');
    const fs=require('fs');for(const key of ['readFileSync','statSync','existsSync','readdirSync'])wrap(fs,key,'fs.'+key);
    wrap(loadEnv.DatabaseStore,'_executeLocally','db.local');
  })()`);
  result.phases={queriesStart:await run('performance.now()')};
  result.queries=await run(`(async()=>{
    const {queryInbox,inboxDesktopAccess}=loadApi;const {AccountStore,DatabaseStore,Thread}=loadEnv;
    const root=AppEnv.getLoadSettings().resourcePath;
    const {threadQuery}=require(root+'/src/services/mail-access/queries');
    const {FULL_GRANT}=require(root+'/src/services/mail-access/grant');
    const {localPinOrder,localViewSQL}=require(root+'/src/services/mail-core/local-triage');
    const {FilterMatcher}=require(root+'/src/services/mail-access/filter');
    const all=AccountStore.accountIds();if(all.length!==3)throw Error('Expected 3 accounts');
    const check=(ok,why)=>{if(!ok)throw Error(why)};const samples=[];
    for(const accountIds of [all,...all.map(id=>[id])]){
      for(const folder of ['inbox','archive','spam']){
        const actual=await queryInbox({accountIds,folder,pinFirst:true,limit:50},inboxDesktopAccess);
        const q=threadQuery({...FULL_GRANT,accountIds},{filter:{in:folder},priorityOrder:localPinOrder,limit:50,background:true});
        q.where(new FilterMatcher(localViewSQL(undefined,folder==='inbox')));q.order(Thread.attributes.id.ascending());
        check(actual.map(x=>x.id).join(',')===(await q).map(x=>x.id).join(','),'folder/order mismatch '+folder);
      }
      for(const query of ['', '设计', '账户1专属', 'quarterly', 'not-present-token']){
        const elapsed=[];let rows;
        for(let i=0;i<3;i++){const t=performance.now();rows=await queryInbox({accountIds,query,folder:'inbox',pinFirst:true,limit:50},inboxDesktopAccess);elapsed.push(performance.now()-t)}
        check(rows.every(x=>accountIds.includes(x.accountId)),'scope leak');
        if(accountIds.length===1&&accountIds[0]!=='load0001'&&query==='账户1专属')check(rows.length===0,'foreign account marker leak');
        samples.push({accounts:accountIds,query,rows:rows.length,elapsedMs:elapsed});
      }
    }
    const pages=[];
    for(const offset of [0,50,100])pages.push(...await queryInbox({accountIds:all,folder:'inbox',pinFirst:true,limit:50,offset},inboxDesktopAccess));
    check(new Set(pages.map(r=>r.id)).size===150,'duplicate pagination');
    check(pages.slice(0,6).every(r=>/-0000000[23]$/.test(r.id)),'pins not first');
    const batch=await Promise.all(all.map((id,i)=>queryInbox({accountIds:[id],query:'账户'+i+'专属',limit:10},inboxDesktopAccess)));
    check(batch.every((rows,i)=>rows.length===10&&rows.every(r=>r.accountId===all[i])),'concurrent scope mix');
    const grant={...FULL_GRANT,accountIds:['load0000'],excludedFolderIds:{load0000:['load0000-inbox']}};
    const restricted=await queryInbox({accountIds:all,query:'设计',limit:50,pinFirst:true},{grant:()=>grant,check:()=>{}});
    check(restricted.every(r=>r.accountId==='load0000'&&!r.categories.some(c=>c.id==='load0000-inbox')),'grant exclusion leak');
    return samples;
  })()`);
  console.log('PASS three-account scopes, foreign markers, sparse/empty folders, pin ordering, pagination, concurrent queries and grant exclusions');
  result.phases.guiStart=await run('performance.now()');
  // Real GUI account switches while a body search is pending.
  await page.locator('.pr-search-input').fill('设计');await page.locator('#pr-account').focus();await page.locator('#pr-account').selectOption('load0001');
  await until('ws.state.accountId==="load0001" && ws.state.query==="设计" && !ws.state.loading');
  assert(await run('ws.state.rows.every(r=>r.accountId==="load0001")'));
  await page.locator('.pr-search-input').fill('');await until('ws.state.query===""&&!ws.state.loading');
  result.accountSwitchMs=[];
  for(const id of ['load0000','load0002','']){
    const t=performance.now();await page.locator('#pr-account').selectOption(id);await until('ws.state.accountId==='+JSON.stringify(id)+'&&!ws.state.loading');result.accountSwitchMs.push({id,ms:performance.now()-t});
  }
  console.log('PASS GUI pending search and account switching preserve scope');
  await page.locator('.pr-search-input').fill('subject:Project 0 note 9950');
  await until('ws.state.query==="subject:Project 0 note 9950"&&!ws.state.loading');
  const htmlRow=page.locator('[data-thread-id="t:load0000-00009950"]');await htmlRow.waitFor();
  await run(`window.loadBurst=(async()=>{const start=performance.now(),ids=loadEnv.AccountStore.accountIds();const rows=await Promise.all(Array.from({length:18},(_,i)=>loadApi.queryInbox({accountIds:[ids[i%3]],query:'设计',limit:20},loadApi.inboxDesktopAccess)));if(!rows.every((r,i)=>r.length===20&&r.every(t=>t.accountId===ids[i%3])))throw Error('Concurrent query scope mismatch');return {queries:rows.length,totalMs:performance.now()-start}})();true`);
  result.phases.htmlStart=await run('performance.now()');
  let t=performance.now();await htmlRow.click();
  await until('Array.from(document.querySelectorAll("iframe")).some(f=>f.contentDocument?.body?.textContent.includes("BODY-END-MARKER"))');
  result.htmlOpenToBodyMs=performance.now()-t;
  result.burst=await run('loadBurst');
  result.htmlDOM=await run('Array.from(document.querySelectorAll("iframe")).map(f=>({textLength:f.contentDocument?.body?.textContent.length,rows:f.contentDocument?.querySelectorAll("tr").length}))');
  if (traceDir) await page.screenshot({path:path.join(traceDir,'reader.png')});
  console.log('PASS complex HTML body rendered through end marker, including table rows');
  await page.locator('[data-mailbox=inbox]').click();await page.locator('.pr-search-input').fill('subject:Conversation');
  await until('ws.state.query==="subject:Conversation"&&!ws.state.loading');
  t=performance.now();await page.locator('[data-thread-id="t:load0000-00000000"]').click();
  await until('!loadEnv.MessageStore.itemsLoading() && loadEnv.MessageStore.items().length===30');
  await until('Array.from(document.querySelectorAll("iframe")).some(f=>f.contentDocument?.body?.textContent.includes("BODY-END-MARKER"))');
  result.longThreadOpenToBodyMs=performance.now()-t;
  console.log('PASS 30-message conversation loaded with cached HTML content');
  result.longTasks=await run('loadTasks');
  result.rendererMetrics=(await cdp.send('Performance.getMetrics')).metrics.filter(m=>['JSHeapUsedSize','JSHeapTotalSize','Nodes','Documents','TaskDuration'].includes(m.name));
  const cpu=(await cdp.send('Profiler.stop')).profile;
  const nodes=new Map(cpu.nodes.map(n=>[n.id,n.callFrame])),cost=new Map();
  for(let i=0;i<(cpu.samples||[]).length;i++){const id=cpu.samples[i];cost.set(id,(cost.get(id)||0)+cpu.timeDeltas[i]);}
  result.rendererCPU=Array.from(cost,([id,us])=>({name:nodes.get(id).functionName,file:nodes.get(id).url.split('/').slice(-3).join('/'),ms:us/1000})).sort((a,b)=>b.ms-a.ms).slice(0,15);
  if (traceDir) {
    result.syncProbes=await run('syncProbes');result.packageProbes=await run('packageProbes');
    const complete=new Promise(resolve=>cdp.once('Tracing.tracingComplete',resolve));
    await cdp.send('Tracing.end');
    const {stream}=await complete;let chunks='';
    while(true){const part=await cdp.send('IO.read',{handle:stream});chunks+=part.data;if(part.eof)break}
    await cdp.send('IO.close',{handle:stream});
    fs.writeFileSync(path.join(traceDir,'trace.json.gz'),require('node:zlib').gzipSync(chunks));
    fs.writeFileSync(path.join(traceDir,'result.json'),JSON.stringify(result,null,2));
  }
  console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);console.error(JSON.stringify(result,null,2));process.exitCode=1}).finally(async()=>{if(app)await app.close();});
