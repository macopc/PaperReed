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




  const startup=await run(`(async()=>{
    const manager=AppEnv.packages,expected=manager.waiting.map(p=>p.name),calls=[],tasks=[];
    if(!expected.length)throw Error('Probe attached after delayed activation; no valid startup sample');
    const original=manager.activatePackage;
    manager.activatePackage=function(pkg){const start=performance.now();try{return original.call(this,pkg)}finally{calls.push({name:pkg.name,start,ms:performance.now()-start})}};
    const observer=new PerformanceObserver(list=>tasks.push(...list.getEntries().map(e=>({start:e.startTime,duration:e.duration}))));observer.observe({type:'longtask'});
    const deadline=performance.now()+10000;
    while(calls.length<expected.length){if(performance.now()>deadline)throw Error('Delayed packages did not finish');await new Promise(r=>setTimeout(r,20))}
    await new Promise(r=>setTimeout(r,50));observer.disconnect();manager.activatePackage=original;
    if(calls.map(p=>p.name).join(',')!==expected.join(','))throw Error('Delayed activation order changed');
    return {expected,calls,longTasks:tasks};
  })()`);
  console.log(JSON.stringify(startup,null,2));
  // Exercise the actual method with cheap packages, not a timing-sensitive speed assertion.
  await run(`new Promise((resolve,reject)=>{
    const calls=[],manager=Object.create(Object.getPrototypeOf(AppEnv.packages));let yielded=false;
    const timeout=setTimeout(()=>reject(Error('Activation test timed out')),5000);
    manager.available={critical:{name:'critical',syncInit:true,windowTypes:{default:true}},a:{name:'a',windowTypes:{default:true}},b:{name:'b',windowTypes:{default:true}},other:{name:'other',windowTypes:{composer:true}}};manager.waiting=[];
    manager.activatePackage=p=>{calls.push(p.name);if(p.name==='a')setTimeout(()=>{yielded=true},0);if(p.name==='b'){clearTimeout(timeout);if(!yielded)reject(Error('Activation monopolized one event-loop task'));else if(calls.join(',')!=='critical,a,b')reject(Error('Wrong activation order'));else resolve(true)}};
    manager.activatePackages('default');
    if(calls.join(',')!=='critical'){clearTimeout(timeout);reject(Error('Synchronous initialization changed'))}
  })`);
  console.log('PASS real delayed package order, event-loop yield between packages, synchronous initialization and window filtering');
  if(process.argv.includes('--expect-responsive'))assert(!startup.longTasks.some(t=>t.duration>=80),'Startup renderer task exceeded 80ms on this fixture');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(app)await app.close();});
