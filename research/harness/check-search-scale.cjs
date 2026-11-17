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


  const metrics=await run(`(async()=>{
    const root=AppEnv.getLoadSettings().resourcePath;
    const {queryInbox,inboxDesktopAccess}=require(root+'/src/services/mail-core/inbox');
    const {threadQuery}=require(root+'/src/services/mail-access/queries');
    const {localPinOrder,localViewSQL}=require(root+'/src/services/mail-core/local-triage');
    const {FilterMatcher}=require(root+'/src/services/mail-access/filter');
    const {DatabaseStore:db,Thread,AccountStore}=require('mailspring-exports');
    const {FULL_GRANT}=require(root+'/src/services/mail-access/grant');
    const accountIds=AccountStore.accountIds(), accountId=accountIds[0];
    const writer=new (require('better-sqlite3'))(db._databasePath);
    const samples=await db._query('SELECT id FROM Thread WHERE accountId=? ORDER BY lastMessageReceivedTimestamp DESC LIMIT 4',[accountId]);
    for(const row of samples.slice(1,3))writer.prepare('INSERT INTO PaperReedLocalThread(accountId,threadId,pinned) VALUES(?,?,1) ON CONFLICT(accountId,threadId) DO UPDATE SET pinned=1').run(accountId,row.id);
    writer.close();
    const baseline=async(input)=>{
      const clauses=[];if(input.folder)clauses.push({in:input.folder});if(input.unread)clauses.push({unread:true});
      const q=threadQuery({...FULL_GRANT,accountIds},{search:input.query,filter:clauses.length?{and:clauses}:undefined,priorityOrder:localPinOrder,limit:input.limit,offset:input.offset||0,background:true});
      q.where(new FilterMatcher(localViewSQL(input.localView,input.folder==='inbox'&&!input.query)));q.order(Thread.attributes.id.ascending());return await q;
    };
    const check=(condition,message)=>{if(!condition)throw Error(message)};
    const ids=rows=>rows.map(r=>r.id).join(',');
    const cases=[];
    for(const query of ['', 'project', '设计', 'subject:设计', 'project NOT 设计', '设计 OR missingword']){
      for(const offset of [0,1,3,49,100]){
        const input={accountIds,folder:'inbox',query,pinFirst:true,limit:17,offset};
        const expected=await baseline(input),actual=await queryInbox(input,inboxDesktopAccess);
        check(ids(actual)===ids(expected),'ordering/pagination mismatch '+query+' '+offset);cases.push({query,offset,rows:actual.length});
      }
    }
    const han=await queryInbox({accountIds,query:'设计',limit:50},inboxDesktopAccess);
    check(han.length===50,'Chinese suffix must match cached 产品设计');
    const negative=await queryInbox({accountIds,query:'project NOT 设计',limit:50},inboxDesktopAccess);
    check(negative.length===0,'NOT must exclude Chinese matches');
    const subject=await queryInbox({accountIds,query:'subject:设计',limit:50},inboxDesktopAccess);
    check(subject.length===0,'subject must not match body');
    const denied=await queryInbox({accountIds,query:'设计',pinFirst:true,limit:50},{grant:()=>({...FULL_GRANT,accountIds:[]}),check:()=>{}});
    check(denied.length===0,'account grant must still apply');
    const timings=[];
    for(const query of ['', 'project', '设计']){
      const input={accountIds,folder:'inbox',query,pinFirst:true,limit:51};
      const old=[],next=[];
      for(let i=0;i<4;i++){let t=performance.now();await baseline(input);old.push(performance.now()-t);t=performance.now();await queryInbox(input,inboxDesktopAccess);next.push(performance.now()-t);}
      timings.push({query,singleSortMs:old,orderedRangesMs:next});
    }
    return {threads:(await db._query('SELECT COUNT(*) n FROM Thread'))[0].n,cases,timings};
  })()`);
  console.log(JSON.stringify(metrics,null,2));
  await page.locator('.pr-search-input').fill('设计');
  await page.getByRole('heading',{name:'搜索结果',exact:true}).waitFor();
  await page.locator('.pr-mail-list[aria-label="搜索结果"][aria-busy="false"]').waitFor();
  assert.equal(await page.locator('.pr-mail-row').count(),50);
  await page.locator('.pr-search-input').fill('subject:设计');
  await page.locator('.pr-mail-row').first().waitFor({state:'detached'});
  console.log('PASS real GUI live Han search and subject-only exclusion');
  console.log('PASS Han suffix, field scoping, NOT/OR and 30 pin/date/id pagination comparisons against single-sort reference');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(app)await app.close();});
