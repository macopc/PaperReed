const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const exec = require('node:util').promisify(execFile);
module.exports = async ({
  main,
  cdp,
  account,
  draft,
  work,
  evaluate,
  until,
}) => {
  const out = path.resolve(
    __dirname,
    '../cli-onboarding-validation-2026-11-16'
  );
  fs.mkdirSync(out, { recursive: true });
  const run = (s) => evaluate(cdp, s),
    action = (s) => main.locator(s).first().click();
  const mod =
    "require(AppEnv.getLoadSettings().resourcePath+'/internal_packages/mcp-server/lib/paper-reed-cli')";
  const shot = async (name) => {
    await run(
      'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'
    );
    const r = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    });
    fs.writeFileSync(
      path.join(out, name + '.png'),
      Buffer.from(r.data, 'base64')
    );
  };
  const settings = async () => {
    await main
      .locator('.pr-sidebar button')
      .filter({ hasText: '设置' })
      .click();
    await action('[data-settings-tab="MCP"]');
    await until(
      () => run('!!document.querySelector(".pr-cli-setup")'),
      'CLI settings'
    );
  };
  const waitIdle = () =>
    until(
      () =>
        run('!document.querySelector("[data-cli-action=install]").disabled'),
      'installer idle'
    );
  await action('.pr-copy-agent');
  await until(
    () => run('!!document.querySelector(".pr-cli-setup")'),
    'composer offers CLI setup'
  );
  const p = await run(mod + '.cliPaths()');
  assert(p.command.startsWith(work));
  const installed = async (args = [], expectError = false) => {
    const env = {
      ...process.env,
      PAPER_REED_TOKEN_FILE: '/deliberately-absent-legacy-token',
    };
    let r;
    try {
      r = await exec(p.command, args, { env, timeout: 25000 });
      assert(!expectError, 'expected CLI rejection');
    } catch (e) {
      if (e.code === 'ERR_ASSERTION') throw e;
      assert(expectError, e.stderr || e.message);
      r = e;
    }
    if (args.includes('--help') || args.includes('--version')) return r.stdout;
    return JSON.parse(r.stdout || r.stderr);
  };
  await action('input[name=agent-access][value=read-only]');
  await shot('before-install');
  // Preserve an unrelated command rather than overwriting it.
  fs.mkdirSync(path.dirname(p.command), { recursive: true });
  fs.writeFileSync(p.command, 'unrelated command');
  await action('[data-settings-tab="Templates"]');
  await action('[data-settings-tab="MCP"]');
  assert(await main.locator('[data-cli-action=install]').isDisabled());
  assert.equal(fs.readFileSync(p.command, 'utf8'), 'unrelated command');
  fs.unlinkSync(p.command);
  const foreign = path.join(work, 'foreign-command');
  fs.writeFileSync(foreign, 'preserve me');
  fs.symlinkSync(foreign, p.command);
  assert((await run(mod + '.cliStatus()')).blocked);
  assert.equal(fs.readFileSync(foreign, 'utf8'), 'preserve me');
  fs.unlinkSync(p.command);
  await action('[data-settings-tab="Templates"]');
  await action('[data-settings-tab="MCP"]');
  const start = Date.now();
  await action('[data-cli-action=install]');
  await waitIdle();
  assert.equal(fs.statSync(p.profile).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.dirname(p.profile)).mode & 0o777, 0o700);
  assert(fs.statSync(p.command).mode & 0o111);
  await action('[data-cli-action=doctor]');
  await waitIdle();
  assert(
    (await main.locator('.pr-cli-feedback').innerText()).includes('连接正常')
  );
  const firstResultMs = Date.now() - start;
  const doctor = await installed(['doctor']);
  assert(doctor.ok);
  assert.equal(doctor.authorizedAccounts, 1);
  assert((await installed(['--help'])).includes('draft-update'));
  assert(
    (await installed(['draft-update', '--help'])).includes('expectedRevision')
  );
  const bad = await installed(['draft-get', '--input', '{'], true);
  assert.equal(bad.code, 'invalid-json');
  const accounts = await installed(['accounts']);
  assert.equal(accounts[0].id, account.id);
  const folders = await installed([
    'folders',
    '--input',
    JSON.stringify({ accountId: account.id }),
  ]);
  const inbox = folders.find((f) => f.role === 'inbox');
  assert(inbox);
  const threads = await installed([
    'threads',
    '--input',
    JSON.stringify({ accountId: account.id, folderId: inbox.id, limit: 2 }),
  ]);
  assert.equal(threads.length, 2);
  const thread = await installed([
    'thread-get',
    '--input',
    JSON.stringify({ threadId: threads[0].id }),
  ]);
  assert(thread);
  const search = await installed([
    'search',
    '--input',
    JSON.stringify({ accountId: account.id, query: 'in:inbox', limit: 2 }),
  ]);
  assert.equal(search.length, 2);
  const sessions = await run(
    `Object.keys(require(AppEnv.getLoadSettings().resourcePath+'/internal_packages/mcp-server/lib/mcp-server-manager').default._server.transports).length`
  );
  assert.equal(sessions, 0, 'CLI sessions must close');
  const denied = await installed(
    [
      'draft-create',
      '--input',
      JSON.stringify({
        accountId: account.id,
        to: [],
        subject: 'Denied',
        body: 'denied',
      }),
    ],
    true
  );
  assert(JSON.stringify(denied).includes('Access denied'));
  await action('input[name=agent-access][value=read-draft]');
  const ref={accountId:account.id,draftId:draft.draftId};
  const initial=await installed(['draft-get','--input',JSON.stringify(ref)]);
  await installed(['draft-update','--input',JSON.stringify({...ref,expectedRevision:initial.revision,changes:{body:'<div>CLI installation handoff verified</div>'}})]);
  fs.chmodSync(p.profile,0o644);
  assert.equal((await installed(['doctor'],true)).code,'insecure-profile');
  fs.chmodSync(p.profile,0o600);
  await action('.pr-agent-account-heading input');
  const none = await installed(['doctor']);
  assert.equal(none.authorizedAccounts, 0);
  await action('.pr-agent-account-heading input');
  await main.locator('.pr-cli-setup').scrollIntoViewIfNeeded();
  await shot('installed');
  await action('.pr-cli-help summary');
  await shot('terminal-help');
  await run(
    `window.prOriginalCopy=require('@electron/remote').clipboard.writeText;window.prCliCopy='';require('@electron/remote').clipboard.writeText=t=>window.prCliCopy=t;true`
  );
  try {
    await action('[data-cli-action=copy]');
    await waitIdle();
    let prompt = JSON.parse(await run('window.prCliCopy'));
    assert.equal(prompt.context.scope, 'mailbox');
    assert(prompt.cli.commands.some((c) => c.includes('search')));
    assert(
      !(await run(
        'window.prCliCopy.includes(AppEnv.config.get("core.mcp.token"))'
      ))
    );
    await action('.pr-settings-back');
    await until(
      () => run('!!document.querySelector(".pr-copy-agent")'),
      'composer restored'
    );
    await action('.pr-copy-agent');
    await until(
      () => run('window.prCliCopy.includes("draft-get")'),
      'draft instructions copied'
    );
    prompt = JSON.parse(await run('window.prCliCopy'));
    assert.equal(prompt.context.draftId, draft.draftId);
    assert(prompt.context.revision);
    // Execute exactly the generated, shell-quoted read command, including a launcher path containing spaces and an apostrophe.
    const read = await exec('/bin/sh', ['-c', prompt.cli.commands[1]], {
      timeout: 25000,
    });
    assert.equal(JSON.parse(read.stdout).subject, '关于下一版编辑器的细节');
    assert(JSON.parse(read.stdout).body.includes('CLI installation handoff verified'));
    assert((await main.locator('[contenteditable=true]').first().innerText()).includes('CLI installation handoff verified'));
    await shot('draft-handoff');
    await action('[data-mailbox="inbox"]');
    await action('.pr-agent-button');
    await main
      .locator('.pr-agent-panel button')
      .filter({ hasText: '复制给 Agent' })
      .click();
    await until(
      () => run('window.prCliCopy.includes("search")'),
      'mailbox handoff'
    );
    prompt = JSON.parse(await run('window.prCliCopy'));
    assert.equal(prompt.context.mailbox, 'inbox');
    await shot('mailbox-handoff');
  } finally {
    await run(
      `require('@electron/remote').clipboard.writeText=window.prOriginalCopy;delete window.prOriginalCopy;delete window.prCliCopy;true`
    );
  }
  await settings();
  await action('.pr-agent-advanced summary');
  await action('.pr-agent-advanced > button');
  await action('.pr-agent-token-confirm button:last-of-type');
  const rejected = await installed(['doctor'], true);
  assert.equal(rejected.code, 'authentication-failed');
  assert(await main.locator('[data-cli-action=doctor]').isDisabled());
  await main.locator('.pr-cli-setup').scrollIntoViewIfNeeded();
  await shot('connection-stale');
  await action('[data-cli-action=install]');
  await waitIdle();
  assert((await installed(['doctor'])).ok);
  await action('#pr-agent-enabled');
  await until(async () => {
    try {
      await fetch(doctor.endpoint);
      return false;
    } catch {
      return true;
    }
  }, 'listener closed');
  const offline = await installed(['doctor'], true);
  assert.equal(offline.code, 'connection-unavailable');
  await action('[data-cli-action=doctor]');await waitIdle();
  assert((await main.locator('.pr-cli-feedback').innerText()).includes('无法连接应用'));
  await main.locator('.pr-cli-setup').scrollIntoViewIfNeeded();await shot('offline-recovery');
  await action('#pr-agent-enabled');
  await until(async () => {
    try {
      return (await fetch(doctor.endpoint)).status === 401;
    } catch {
      return false;
    }
  }, 'listener restored');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 900,
    height: 700,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await action('[data-settings-tab="Templates"]');
  await action('[data-settings-tab="MCP"]');
  await shot('compact');
  assert(
    await run(
      `(()=>{const e=document.querySelector('.pr-settings-page');return e.scrollWidth<=e.clientWidth+1;})()`
    )
  );
  await action('.pr-cli-help summary');
  await action('[data-cli-action=remove]');
  await action('.pr-cli-remove button:first-of-type');
  assert(fs.existsSync(p.command));
  await action('[data-cli-action=remove]');
  await action('[data-cli-action=remove-confirm]');
  await until(() => Promise.resolve(!fs.existsSync(p.command)), 'uninstalled');
  assert(!fs.existsSync(p.profile));
  await action('[data-cli-action=install]');
  await waitIdle();
  assert((await installed(['doctor'])).ok);
  const result = {
    installFromComposer: true,
    foreignCommandPreserved: true,
    foreignSymlinkPreserved: true,
    sessionsClosed: true,
    privateProfile: true,
    insecureProfileRejected: true,
    installedDraftUpdateAndGUI: true,
    noExternalNodeNeeded: true,
    firstResultMs,
    installedDoctor: true,
    commandHelp: true,
    invalidInputHint: true,
    accountsFoldersThreadsSearch: true,
    readOnlyEnforced: true,
    emptyGrantReported: true,
    mailboxHandoff: true,
    draftHandoff: true,
    quotedHandoffExecuted: true,
    noTokenInHandoff: true,
    rotatedTokenRejected: true,
    connectionRefresh: true,
    offlineHint: true,
    compactLayout: true,
    removeCancelConfirm: true,
    reinstall: true,
    expectedSMTPSubmissions: 0,
  };
  fs.writeFileSync(
    path.join(out, 'result.json'),
    JSON.stringify(result, null, 2) + '\n'
  );
  console.log('PASS CLI onboarding', JSON.stringify(result));
  // Only isolated installation files are left in the ignored fixture directory.
};
