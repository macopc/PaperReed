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

  const input = page.locator(".pr-search-input");
  const until = async (expression) => {
    const deadline = Date.now() + 5000;
    while (!(await run(expression))) {
      if (Date.now() > deadline) throw Error("Timed out: " + expression);
      await new Promise((r) => setTimeout(r, 20));
    }
  };
  const pause = (ms) => new Promise((r) => setTimeout(r, ms));
  await run(
    `(()=>{const el=document.querySelector('.pr-workspace');let f=el[Object.keys(el).find(k=>k.startsWith('__reactInternalInstance')||k.startsWith('__reactFiber'))];while(f&&!(f.stateNode&&f.stateNode.refreshOperations))f=f.return;window.ws=f.stateNode;window.probe={renders:0,queries:0,delay:0};probe.inputUpdates=0;const setState=ws.setState;ws.setState=function(update,callback){if(update && Object.prototype.hasOwnProperty.call(update,"searchText"))probe.inputUpdates++;return setState.call(this,update,callback)};const render=ws.render;ws.render=function(){probe.renders++;return render.call(this)};const db=require('mailspring-exports').DatabaseStore,q=db._query;db._query=function(sql,args,bg){probe.queries++;const delay=bg?probe.delay:0;return q.call(this,sql,args,bg).then(async result=>{if(delay)await new Promise(r=>setTimeout(r,delay));return result})}})()`,
  );
  await input.fill("paperreed_no_match_zz");
  await until(
    'ws.state.query === "paperreed_no_match_zz" && !ws.state.loading',
  );
  assert.equal(
    await page.locator(".pr-mail-row").count(),
    0,
    "typing must search without Enter",
  );
  await input.fill("");
  await until('ws.state.query === "" && !ws.state.loading');
  const count = await page.locator(".pr-mail-row").count();
  assert(count > 0);
  // Unrelated database records must not query mail. Sending-result polling is tested separately.
  await run(
    'clearInterval(ws.operationTimer);probe.queries=0;require("mailspring-exports").DatabaseStore.trigger({type:"persist",objectClass:"Contact",objects:[],objectsRawJSON:[]})',
  );
  await pause(400);
  assert.equal(await run("probe.queries"), 0);
  await run("probe.renders=0");
  await run("ws.refreshOperations()");
  await run("ws.refreshOperations()");
  assert.equal(
    await run("probe.renders"),
    0,
    "unchanged send results must not render",
  );
  await run("probe.inputUpdates=0");
  // Composition is not a sequence of searches; only committed text searches.
  await run(
    'document.querySelector(".pr-search-input").dispatchEvent(new CompositionEvent("compositionstart",{bubbles:true}))',
  );
  await input.fill("中文不存在的搜索");
  await pause(300);
  assert.equal(await run("ws.state.query"), "");
  assert.equal(
    await run("probe.inputUpdates"),
    0,
    "keystrokes should stay in the search component",
  );
  await run(
    'document.querySelector(".pr-search-input").dispatchEvent(new CompositionEvent("compositionend",{bubbles:true}))',
  );
  await until('ws.state.query === "中文不存在的搜索" && !ws.state.loading');
  assert.equal(await page.locator(".pr-mail-row").count(), 0);
  await input.fill("");
  await until('ws.state.query === "" && !ws.state.loading');
  // Slow background query retains previous rows, but cannot replace a newer result.
  await run("probe.delay=400");
  await input.fill("project");
  await input.press("Enter");
  assert.equal(
    await page.locator(".pr-mail-row").count(),
    count,
    "keep prior rows while searching",
  );
  assert.equal(
    await page.locator(".pr-mail-list").getAttribute("aria-busy"),
    "true",
  );
  await run("probe.delay=0");
  await input.fill("paperreed_no_match_zz");
  await input.press("Enter");
  await until(
    'ws.state.query === "paperreed_no_match_zz" && !ws.state.loading',
  );
  await pause(500);
  assert.equal(
    await page.locator(".pr-mail-row").count(),
    0,
    "late query must not overwrite newer results",
  );
  // Relevant records still refresh: GUI/CLI must share observable mail changes.
  await run(
    'probe.queries=0;const e=require("mailspring-exports");e.DatabaseStore.trigger({type:"persist",objectClass:"Message",objects:[{accountId:e.AccountStore.accountIds()[0]}],objectsRawJSON:[]})',
  );
  await pause(400);
  assert((await run("probe.queries")) > 0);
  console.log(
    "PASS live typing, clear, IME, isolated input renders, unrelated events, unchanged send results, retained rows, late results and mail refresh",
  );
})()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    if (app) await app.close();
  });
