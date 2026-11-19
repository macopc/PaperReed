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


  await run('document.activeElement.blur()');
  await page.keyboard.press('Meta+k');await page.locator('.pr-command-panel').waitFor();await page.keyboard.press('Escape');
  console.log('PASS command palette with no list row focused');
  const focused=()=>run('Array.from(document.querySelectorAll(".pr-mail-row")).indexOf(document.activeElement)');
  const row=page.locator('.pr-mail-row');
  await run('AppEnv.config.set("core.keymapTemplate","Gmail")');
  await row.first().focus();await page.keyboard.press('j');assert.equal(await focused(),1);
  await page.keyboard.press('x');assert.equal(await page.locator('.pr-mail-list input[type=checkbox]:checked').count(),1);
  await page.keyboard.press('Escape');assert.equal(await page.locator('.pr-mail-list input[type=checkbox]:checked').count(),0);
  console.log('PASS Gmail J moves to next row; X selects and Escape clears');
  await row.nth(3).click();await page.locator('.pr-back').waitFor();
  await page.locator('.pr-back').click();await row.nth(3).waitFor();
  assert.equal(await focused(),3,'Returning from a thread must restore its list row focus');
  await page.keyboard.press('j');assert.equal(await focused(),4);
  console.log('PASS return from reader restores the previous row and keyboard navigation');

  await run('AppEnv.config.set("core.keymapTemplate","Apple Mail")');
  await row.first().focus();await page.keyboard.press('j');assert.equal(await focused(),0);
  await page.keyboard.press('ArrowDown');assert.equal(await focused(),1);
  console.log('PASS Apple Mail ignores J and honors ArrowDown');
  await run('require("fs").writeFileSync(AppEnv.keymaps.getUserKeymapPath(),JSON.stringify({"core:next-item":"n"}));AppEnv.keymaps.userKeymap.load()');
  await row.first().focus();await page.keyboard.press('n');assert.equal(await focused(),1);
  console.log('PASS custom N binding changes actual list behavior');
  await page.keyboard.press('Meta+k');await page.locator('.pr-command-panel').waitFor();
  await page.getByRole('textbox',{name:'查找命令'}).fill('草稿');await page.keyboard.press('Enter');
  await page.locator('.pr-command-panel').waitFor({state:'detached'});
  assert.equal(await page.locator('[data-mailbox=drafts]').getAttribute('aria-current'),'page');
  console.log('PASS Cmd+K, filtered command and Enter navigate to drafts');
  await page.locator('[data-mailbox=inbox]').click();await row.first().waitFor();await row.first().focus();
  await page.keyboard.press('Meta+Shift+p');await page.locator('.pr-command-panel').waitFor();await page.keyboard.press('Escape');
  await page.locator('.pr-command-panel').waitFor({state:'detached'});assert.equal(await focused(),0);
  console.log('PASS Cmd+Shift+P, Escape and focus restoration');
  await page.keyboard.press('Meta+Alt+f');await page.locator('.pr-search-input').fill('jekx');
  assert.equal(await page.locator('.pr-search-input').inputValue(),'jekx');
  console.log('PASS typing action letters in search does not activate list commands');
  await page.locator('.pr-compose-button').click();await page.locator('[contenteditable=true]').first().waitFor();
  await page.locator('[contenteditable=true]').first().focus();await page.keyboard.press('Meta+k');
  assert.equal(await page.locator('.pr-command-panel').count(),0);
  await page.keyboard.press('Escape');await page.locator('[contenteditable=true]').first().focus();
  await page.keyboard.press('Meta+Shift+p');await page.locator('.pr-command-panel').waitFor();
  console.log('PASS editor Cmd+K does not open palette; Cmd+Shift+P does');
  await page.keyboard.press('Escape');
  await page.locator('[contenteditable=true]').first().click();
  await page.keyboard.insertText('Focus restoration check');
  await page.locator('.pr-back').click();await page.locator('.pr-search-input').waitFor();
  assert(await run('document.activeElement===document.querySelector(".pr-search-input")'), 'New draft outside the current mailbox should return focus to search');
  await page.locator('[data-mailbox=drafts]').click();
  const draftRow=page.locator('[data-draft-id]').first();await draftRow.waitFor();
  const draftId=await draftRow.getAttribute('data-draft-id');
  await draftRow.click();await page.locator('[contenteditable=true]').first().waitFor();
  await page.locator('.pr-back').click();await draftRow.waitFor();
  assert.equal(await run('document.activeElement?.getAttribute("data-draft-id")'),draftId);
  console.log('PASS returning from a new draft focuses search; existing draft restores its own row');

  console.log('PASS command-panel workflow in isolated synthetic profile; no mail sent');
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(app)await app.close();});
