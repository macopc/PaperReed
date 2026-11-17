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




  const scan = await run(`(()=>{
    const fs=require('fs'),path=require('path'),root=AppEnv.getLoadSettings().resourcePath;
    const utils=require(root+'/src/flux/models/utils'),base=path.join(root,'static/images');
    if(JSON.parse(AppEnv.fileListCache().imageData)[root])throw Error('Image cache already warm; invalid cold scan');
    const original=fs.readdirSync,calls=[];
    fs.readdirSync=function(...args){const start=performance.now();try{return original.apply(this,args)}finally{if(args[0]===base)calls.push({ms:performance.now()-start,withFileTypes:!!args[1]?.withFileTypes})}};
    let resolved;
    try{resolved=utils.imageNamed('toolbar-compose.png');utils.imageNamed('toolbar-compose.png');if(utils.imageNamed('paper-reed-does-not-exist.png')!==null)throw Error('Missing icon changed behavior')}finally{fs.readdirSync=original}
    if(calls.length!==1)throw Error('Expected one cold scan, followed by cached lookups');
    const cache=JSON.parse(AppEnv.fileListCache().imageData)[root],reference={};
    // Preserve the previous traversal's ordering, including duplicate basenames.
    for(const name of original(base,{recursive:true})){
      const file=path.join(base,name).replace(/\\\\/g,'/').replace(root+'/static/','');reference[path.basename(file)]=file;
    }
    const names=Object.keys(reference);
    if(Object.keys(cache).length!==names.length||names.some(name=>cache[name]!==reference[name]))throw Error('Image mapping or duplicate-name precedence changed');
    const ratio=window.devicePixelRatio;
    const expected=reference['toolbar-compose@'+ratio+'x.png']||reference['toolbar-compose.png']||reference['toolbar-compose@2x.png'];
    if(resolved!==expected)throw Error('Retina image selection changed');
    return {calls,cacheEntries:names.length,resolved,ratio};
  })()`);
  console.log(JSON.stringify(scan,null,2));
  console.log('PASS cold lookup, repeated cache hit, full legacy path mapping, duplicate basename precedence, Retina selection and missing icon');
  // Local performance diagnostic, not a portable CI budget.
  if(process.argv.includes('--expect-fast-scan'))assert(scan.calls[0].ms<15,'Cold image directory scan exceeded local 15ms diagnostic budget');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(app)await app.close();});
