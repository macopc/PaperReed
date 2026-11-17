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
const out=path.join(root,'research/version-001-validation-2026-11-17');
const result = { synthetic: true, externalNetwork: false };
const executable=path.resolve(process.env.TEST_EXECUTABLE);
const binDir=path.join(profile,'CLI bin');
(async () => {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.PLAYWRIGHT;
  env.PAPER_REED_CLI_BIN_DIR=binDir;
  const start = performance.now();
  app = await _electron.launch({
    executablePath: executable,
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
  assert.equal(await page.locator('.pr-build-label').textContent(),'0.0.1 · 测试版');
  result.brand=await run(`({version:AppEnv.getVersion().split('-')[0],markLoaded:document.querySelector('.pr-brand img').naturalWidth>0,accounts:require('mailspring-exports').AccountStore.accounts().length})`);
  assert.equal(result.brand.version,'0.0.1');assert(result.brand.markLoaded);assert.equal(result.brand.accounts,3);
  const cached=await run(`require('mailspring-exports').DatabaseStore._query('SELECT count(*) AS count FROM Thread').then(r=>r[0].count)`);
  assert.equal(cached,30000);result.cachedThreads=cached;
  await page.screenshot({path:path.join(out,'installed-inbox.png')});
  const token=require('node:crypto').randomBytes(32).toString('hex');
  const net=require('node:net'), reservation=net.createServer();
  await new Promise(resolve=>reservation.listen(0,'127.0.0.1',resolve));
  const port=reservation.address().port;await new Promise(resolve=>reservation.close(resolve));
  await run(`AppEnv.config.set('core.mcp.accessLevel','read-only');AppEnv.config.set('core.mcp.enabledAccounts',{});window.testServer=new(require(AppEnv.getLoadSettings().resourcePath+'/internal_packages/mcp-server/lib/mcp-http-server').McpHttpServer)();testServer.start(${port},()=>${JSON.stringify(token)});true`);
  const status=await run(`(async()=>{const installer=require(AppEnv.getLoadSettings().resourcePath+'/internal_packages/mcp-server/bin/install.cjs');window.testPaths=installer.paths({configDir:AppEnv.getConfigDirPath(),appRoot:AppEnv.getLoadSettings().resourcePath,executable:process.execPath,binDir:${JSON.stringify(binDir)}});return installer.install(testPaths,{endpoint:'http://127.0.0.1:${port}/mcp',token:${JSON.stringify(token)}});})()`);
  assert(status.installed&&status.ready);
  const exec=require('node:util').promisify(require('node:child_process').execFile);
  const cli=path.join(binDir,'paper-reed');
  result.cliVersion=(await exec(cli,['--version'],{env,timeout:20000})).stdout.trim();assert.equal(result.cliVersion,'0.0.1');
  const doctor=JSON.parse((await exec(cli,['doctor'],{env,timeout:20000})).stdout);
  assert.equal(doctor.ok,true);result.cliDoctor=doctor;
  await run(`testServer.stop();require(AppEnv.getLoadSettings().resourcePath+'/internal_packages/mcp-server/bin/install.cjs').uninstall(testPaths);true`);
  result.cliUninstalled=!fs.existsSync(cli);assert(result.cliUninstalled);
  fs.writeFileSync(path.join(out,'installed-app.json'),JSON.stringify(result,null,2)+'\n');
  console.log('PASS relocated ZIP app: version, logo, 3 cached accounts / 30,000 threads, bundled CLI install / doctor / uninstall');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(app)await app.close();fs.rmSync(profile,{recursive:true,force:true});});
