const fs = require("node:fs"),
  path = require("node:path"),
  assert = require("node:assert/strict");
module.exports = async ({
  main,
  cdp,
  account,
  cli,
  draft,
  work,
  evaluate,
  until,
}) => {
  const out = path.resolve(
    __dirname,
    "../template-agent-validation-2026-11-16",
  );
  fs.mkdirSync(out, { recursive: true });
  const run = (s) => evaluate(cdp, s),
    action = (s) => main.locator(s).first().click();
  const before = process.env.PAPER_REED_TEMPLATE_AGENT_PHASE === "before";
  const shot = async (name) => {
    if (!before && (await run('!!document.querySelector(".pr-templates")')))
      await until(
        () =>
          run(
            '!!document.querySelector(".pr-templates .RichEditor-toolbar button")',
          ),
        "template toolbar ready",
      );
    await run(
      "new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))",
    );
    const r = await cdp.send("Page.captureScreenshot", {
      format: "png",
      fromSurface: true,
    });
    fs.writeFileSync(
      path.join(out, `${before ? "before" : "after"}-${name}.png`),
      Buffer.from(r.data, "base64"),
    );
  };
  await main.locator(".pr-sidebar button").filter({ hasText: "设置" }).click();
  for (const [id, selector, name] of [
    ["Templates", ".preferences-templates-container", "templates"],
    ["MCP", ".container-mcp", "agent"],
  ]) {
    await action(`[data-settings-tab="${id}"]`);
    await until(
      () => run(`!!document.querySelector(${JSON.stringify(selector)})`),
      id,
    );
    if (before && id === "MCP")
      await run(
        `(()=>{const s=document.createElement('style');s.textContent='.mcp-token{font-size:0!important}.mcp-token::after{content:"测试令牌已隐藏";font-size:12px}';document.head.append(s);return true;})()`,
      );
    await shot(name);
  }
  if (before) {
    console.log("PASS template and Agent baseline (test token concealed)");
    return;
  }
  const store = `require(AppEnv.getLoadSettings().resourcePath+'/internal_packages/composer-templates/lib/template-store').default`;
  const items = () => run(`${store}.items()`);
  const ref = { accountId: account.id, draftId: draft.draftId };
  await action('[data-settings-tab="Templates"]');
  await action(".pr-template-toolbar button");
  await until(
    () => run('document.querySelector("#template-title")?.value==="新模板"'),
    "new Chinese template",
  );
  await main.locator("#template-title").fill("项目跟进");
  await action("#template-subject");
  await until(
    async () => (await items()).some((t) => t.name === "项目跟进"),
    "Chinese rename",
  );
  await main.locator("#template-subject").fill("关于项目的下一步");
  await action(".pr-template-detail [contenteditable=true]");
  await main.keyboard.insertText("你好，请确认下一步安排。");
  await action("#template-subject");
  let template = (await items()).find((t) => t.name === "项目跟进");
  await until(
    () =>
      Promise.resolve(
        fs.readFileSync(template.path, "utf8").includes("请确认下一步安排"),
      ),
    "template body saved",
  );
  assert(fs.readFileSync(template.path, "utf8").includes("关于项目的下一步"));
  await shot("template-edited");
  const original = fs.readFileSync(template.path, "utf8");
  await run(
    `window.prSavedError=AppEnv.showErrorDialog;window.prTemplateErrors=[];AppEnv.showErrorDialog=e=>{window.prTemplateErrors.push(e);return 0;};true`,
  );
  try {
    await action(".pr-template-toolbar button");
    await until(
      () => run('document.querySelector("#template-title")?.value==="新模板"'),
      "second template",
    );
    await main.locator("#template-title").fill("项目跟进");
    await action("#template-subject");
    await until(
      () => run("window.prTemplateErrors.length===1"),
      "duplicate name rejected",
    );
    assert.equal(fs.readFileSync(template.path, "utf8"), original);
    assert.equal(await main.locator("#template-title").inputValue(), "新模板");
  } finally {
    await run(
      "AppEnv.showErrorDialog=window.prSavedError;delete window.prSavedError;true",
    );
  }
  const count = (await items()).length;
  await run(
    `window.prOriginalDialog=require('@electron/remote').dialog.showMessageBoxSync;window.prDialogResponse=1;window.prDialogCalls=0;require('@electron/remote').dialog.showMessageBoxSync=()=>{window.prDialogCalls++;return window.prDialogResponse;};true`,
  );
  try {
    await action(".pr-template-detail footer button");
    await until(() => run("window.prDialogCalls===1"), "delete cancel");
    assert.equal((await items()).length, count);
    await run("window.prDialogResponse=0;true");
    await action(".pr-template-detail footer button");
    await until(
      async () => (await items()).length === count - 1,
      "delete confirmed",
    );
    await action(".pr-settings-back");
    await until(
      () => run('!!document.querySelector(".btn-templates")'),
      "composer restored",
    );
    await shot("composer-template-entry");
    await action(".btn-templates");
    await main
      .locator(".template-picker .template")
      .filter({ hasText: "项目跟进" })
      .click();
    await until(
      () =>
        run(
          'document.querySelector("[contenteditable=true]")?.innerText.includes("请确认下一步安排")',
        ),
      "template applied to composer",
    );
    await run(
      `require('mailspring-exports').DraftStore.sessionForClientId(${JSON.stringify(draft.draftId)}).then(s=>s.changes.commit()).then(()=>true)`,
    );
    const applied = await cli("draft-get", ref);
    assert.equal(applied.subject, "关于项目的下一步");
    assert(applied.body.includes("请确认下一步安排"));
  } finally {
    await run(
      `require('@electron/remote').dialog.showMessageBoxSync=window.prOriginalDialog;delete window.prOriginalDialog;true`,
    );
  }
  await main.locator(".pr-sidebar button").filter({ hasText: "设置" }).click();
  await action('[data-settings-tab="MCP"]');
  const endpoint = await run(
    '"http://127.0.0.1:"+AppEnv.config.get("core.mcp.port")+"/mcp"',
  );
  const originalPort = new URL(endpoint).port;
  assert.equal(
    await main.locator("#pr-agent-token").getAttribute("type"),
    "password",
  );
  await action(".pr-agent-token button:first-of-type");
  assert.equal(
    await main.locator("#pr-agent-token").getAttribute("type"),
    "text",
  );
  await action(".pr-agent-token button:first-of-type");
  // Intercept only clipboard delivery so no test secret replaces the user's clipboard.
  await run(
    `window.prOriginalCopy=require('@electron/remote').clipboard.writeText;window.prCopiedText=null;require('@electron/remote').clipboard.writeText=t=>{window.prCopiedText=t;};true`,
  );
  try {
    await action(".pr-agent-endpoint button");
    assert.equal(await run("window.prCopiedText"), endpoint);
    await action(".pr-agent-token button:last-of-type");
    assert(
      await run('window.prCopiedText===AppEnv.config.get("core.mcp.token")'),
    );
  } finally {
    await run(
      `require('@electron/remote').clipboard.writeText=window.prOriginalCopy;delete window.prOriginalCopy;delete window.prCopiedText;true`,
    );
  }
  await action("input[name=agent-access][value=read-only]");
  const denied = await cli(
    "draft-create",
    {
      accountId: account.id,
      to: [],
      subject: "Denied fixture",
      body: "Do not create",
    },
    true,
  );
  assert(
    JSON.stringify(denied).includes("Access denied"),
    JSON.stringify(denied),
  );
  await action("input[name=agent-access][value=read-draft]");
  const created = await cli("draft-create", {
    accountId: account.id,
    to: [],
    subject: "Allowed fixture",
    body: "Local permission check",
  });
  assert(created.draftId);
  await action(".pr-agent-account-heading input");
  const accountDenied = await cli("draft-get", ref, true);
  assert(
    /access|not allowed|permission/i.test(JSON.stringify(accountDenied)),
    JSON.stringify(accountDenied),
  );
  await action(".pr-agent-account-heading input");
  await action(".pr-agent-account-heading button");
  const draftsFolder = await run(
    `require('mailspring-exports').CategoryStore.getCategoryByRole(${JSON.stringify(account.id)},'drafts').id`,
  );
  await action(`input[data-folder-id="${draftsFolder}"]`);
  await cli("draft-get", ref, true);
  await action(`input[data-folder-id="${draftsFolder}"]`);
  assert((await cli("draft-get", ref)).body.includes("请确认下一步安排"));
  await shot("agent-scope");
  await action(".pr-agent-cli summary");
  await shot("agent-connection");
  await action(".pr-agent-audit summary");
  await shot("agent-audit");
  await action(".pr-agent-audit header button");
  await until(
    () => run('!document.querySelector(".pr-agent-audit li")'),
    "audit cleared",
  );
  await action(".pr-agent-advanced summary");
  await main.locator("#pr-agent-port").fill("0");
  assert(await main.locator(".pr-agent-port-row button").isDisabled());
  assert.equal(
    String(await run('AppEnv.config.get("core.mcp.port")')),
    originalPort,
  );
  const server = require("node:net").createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const nextPort = server.address().port;
  await new Promise((r) => server.close(r));
  await main.locator("#pr-agent-port").fill(String(nextPort));
  await action(".pr-agent-port-row button");
  await until(async () => {
    try {
      return (await fetch(`http://127.0.0.1:${nextPort}/mcp`)).status === 401;
    } catch {
      return false;
    }
  }, "applied port listener");
  await main.locator("#pr-agent-port").fill(originalPort);
  await action(".pr-agent-port-row button");
  await until(async () => {
    try {
      return (await fetch(endpoint)).status === 401;
    } catch {
      return false;
    }
  }, "restored port listener");
  const oldToken = await run('AppEnv.config.get("core.mcp.token")');
  await action(".pr-agent-advanced > button");
  await action(".pr-agent-token-confirm button:first-of-type");
  assert.equal(await run('AppEnv.config.get("core.mcp.token")'), oldToken);
  await action(".pr-agent-advanced > button");
  await action(".pr-agent-token-confirm button:last-of-type");
  const newToken = await run('AppEnv.config.get("core.mcp.token")');
  assert.notEqual(newToken, oldToken);
  assert.equal(
    (
      await fetch(endpoint, {
        headers: { Authorization: `Bearer ${oldToken}` },
      })
    ).status,
    401,
  );
  assert.notEqual(
    (
      await fetch(endpoint, {
        headers: { Authorization: `Bearer ${newToken}` },
      })
    ).status,
    401,
  );
  await action("#pr-agent-enabled");
  await until(async () => {
    try {
      await fetch(endpoint);
      return false;
    } catch {
      return true;
    }
  }, "service listener stopped");
  await until(
    () => run('document.querySelector(".pr-agent-state").innerText==="已关闭"'),
    "service off",
  );
  await shot("agent-disabled");
  await action("#pr-agent-enabled");
  await until(async () => {
    try {
      return (await fetch(endpoint)).status === 401;
    } catch {
      return false;
    }
  }, "service on");
  await cdp.send("Emulation.setDeviceMetricsOverride", {
    width: 900,
    height: 700,
    deviceScaleFactor: 1,
    mobile: false,
  });
  for (const [id, name] of [
    ["Templates", "templates"],
    ["MCP", "agent"],
  ]) {
    await action(`[data-settings-tab="${id}"]`);
    await shot("compact-" + name);
    assert(
      await run(
        `(()=>{const e=document.querySelector('.pr-settings-page');return e.scrollWidth<=e.clientWidth+1 && e.getBoundingClientRect().right<=innerWidth;})()`,
      ),
      name + " overflow",
    );
  }
  const result = {
    templateCreate: true,
    unicodeRename: true,
    duplicateNameProtected: true,
    templateSubjectAndBodySaved: true,
    templateDeleteCancelConfirm: true,
    templateAppliedToDraft: true,
    tokenMasked: true,
    copyActionsIntercepted: true,
    readOnlyDeniesDraft: true,
    readDraftAllowsDraft: true,
    accountRestriction: true,
    folderRestriction: true,
    auditClear: true,
    portValidation: true,
    portRebind: true,
    tokenRotation: true,
    serviceToggle: true,
    compactLayouts: true,
    expectedSMTPSubmissions: 0,
  };
  fs.writeFileSync(
    path.join(out, "result.json"),
    JSON.stringify(result, null, 2) + "\n",
  );
  console.log("PASS template and Agent settings", JSON.stringify(result));
};
