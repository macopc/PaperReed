const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({main, cdp, evaluate, until, account, secondAccount, cli}) => {
  const phase = process.env.PAPER_REED_AGENT_PAGE_CHECK;
  const before = phase === 'before';
  const control = phase === 'scope-control';
  const failures = [];
  const verify = (condition, description) => {
    if (control && !condition) failures.push(description);
    else assert(condition, description);
  };
  const out = process.env.PAPER_REED_UI_OUTPUT;
  fs.mkdirSync(out, {recursive: true});
  const run = script => evaluate(cdp, script);
  const panel = main.locator('.pr-agent-panel');
  const trigger = main.locator('.pr-agent-button');
  const copy = panel.locator('.pr-agent-copy');
  const scope = panel.locator('.pr-agent-scope');
  const settings = panel.getByRole('button', {name: '打开连接设置', exact: true});
  const copied = panel.getByText('已复制任务，可粘贴到 Agent 会话。', {exact: true});
  const accountPicker = main.locator('#pr-account');
  const title = panel.getByRole('heading', {name: 'Agent 交接'});
  const rowSelector = id => `.pr-mail-row[data-thread-id="${id}"]`;
  const checkbox = id => main.locator('.pr-mail-item').filter({has: main.locator(rowSelector(id))}).locator('input[type=checkbox]');
  const capture = async (name, width = 900, height = 640) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const shot = await cdp.send('Page.captureScreenshot', {format: 'png', fromSurface: true});
    fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  await run(`(() => {
    const root = document.querySelector('.pr-workspace');
    let fiber = root[Object.keys(root).find(key => key.startsWith('__reactFiber$'))];
    while (fiber && !fiber.stateNode?.refreshOperations) fiber = fiber.return;
    window.agentWorkspace = fiber.stateNode;
    const clipboard = require('@electron/remote').clipboard;
    window.agentClipboard = { writes: [], reject: false };
    clipboard.writeText = text => {
      if (agentClipboard.reject) throw new Error('fixture clipboard unavailable');
      agentClipboard.writes.push(text);
    };
  })()`);
  const ready = () => until(
    () => run('!agentWorkspace.state.loading && agentWorkspace.state.listRead && !agentWorkspace.state.listRead.failed'),
    'current list read settles');
  const firstRow = id => until(() => run(`agentWorkspace.state.rows.find(row => row.accountId === ${JSON.stringify(id)})?.id`),
    'synced conversation for account ' + id);
  const clickCopy = async count => {
    await copy.press('Enter');
    await copied.waitFor();
    const total = await run('agentClipboard.writes.length');
    assert.equal(total, count);
    const contents = await run('agentClipboard.writes.at(-1)');
    assert(!contents.includes(await run('AppEnv.config.get("core.mcp.token")')), 'clipboard omits the MCP token');
    return JSON.parse(contents);
  };
  const reopenWorkspace = async () => {
    await main.locator('.pr-preferences-nav button').filter({hasText: '返回邮件'}).click();
    await panel.waitFor();
    await run(`(() => {
      const root = document.querySelector('.pr-workspace');
      let fiber = root[Object.keys(root).find(key => key.startsWith('__reactFiber$'))];
      while (fiber && !fiber.stateNode?.refreshOperations) fiber = fiber.return;
      window.agentWorkspace = fiber.stateNode;
    })()`);
    await ready();
    assert(await run('document.activeElement.id === "pr-agent-title"'), 'return from setup focuses the handoff');
  };
  await firstRow(account.id);
  await firstRow(secondAccount.id);
  await accountPicker.selectOption(account.id);
  await ready();
  if (before) {
    await run('require(AppEnv.getLoadSettings().resourcePath + "/internal_packages/mcp-server/lib/paper-reed-cli").installCLI().then(() => true)');
    await trigger.click();
    await panel.waitFor();
    await capture('agent-desktop', 1440, 760);
    await capture('agent-narrow', 740, 680);
    assert.equal(await scope.count(), 1, 'handoff shows the exact copy scope before copying');
    return;
  }
  await trigger.press('Enter');
  await title.waitFor();
  assert(await run('document.activeElement.id === "pr-agent-title"'));
  assert.equal(await copy.count(), 0);
  assert.equal(await panel.getByRole('button').count(), 1, 'connection has one clear action');
  await capture('agent-setup');
  await settings.press('Enter');
  const install = main.locator('[data-cli-action=install]');
  await install.waitFor();
  await install.click();
  const cliStatus = 'require(AppEnv.getLoadSettings().resourcePath + "/internal_packages/mcp-server/lib/paper-reed-cli").cliStatus().ready';
  await until(() => run(cliStatus), 'real CLI install is ready');
  await reopenWorkspace();
  assert.match(await scope.textContent(), /收件箱/);
  assert((await scope.textContent()).includes(account.emailAddress));
  assert.equal(await accountPicker.inputValue(), account.id);
  await capture('agent-desktop', 1440, 760);
  await capture('agent-narrow', 740, 680);
  assert(await run(`(() => {
    const p = document.querySelector('.pr-agent-panel');
    return p.scrollWidth <= p.clientWidth + 1 && p.getBoundingClientRect().right <= innerWidth;
  })()`));
  const inbox = await clickCopy(1);
  assert.deepEqual(inbox.context, {scope: 'mailbox', accountIds: [account.id], mailbox: 'inbox',
    query: 'in:inbox', localView: {folder: 'inbox', unread: false}});
  await capture('agent-copied');

  const first = await firstRow(account.id);
  await checkbox(first).check();
  assert.match(await scope.textContent(), /已选 1 个会话/);
  assert.equal(await copied.count(), 0, 'old receipt is hidden when selection changes');
  await settings.press('Enter');
  await install.waitFor();
  await reopenWorkspace();
  assert.equal(await checkbox(first).isChecked(), true, 'setup round trip keeps checked mail');
  const batch = await clickCopy(2);
  assert.deepEqual(batch.context, {scope: 'selection', targets: [{accountId: account.id, threadId: first}]});
  const thread = await cli('thread-get', {threadId: first});
  assert.equal(thread.id || thread.thread?.id, first, 'copied thread id resolves via production CLI');

  await run('agentClipboard.reject = true');
  await copy.press('Enter');
  await panel.getByText('未能复制任务，请重试。', {exact: true}).waitFor();
  assert.equal(await main.locator('.pr-notice').filter({hasText: '操作未完成'}).count(), 0,
    'clipboard error stays with the handoff action');
  assert.equal(await copied.count(), 0);
  assert.equal(await run('agentClipboard.writes.length'), 2);
  await capture('agent-copy-failed');
  await run('agentClipboard.reject = false');
  await clickCopy(3);
  await copy.press('Escape');
  await panel.waitFor({state: 'hidden'});
  assert(await run('document.activeElement.matches(".pr-agent-button")'));

  await accountPicker.selectOption('');
  await ready();
  const other = await firstRow(secondAccount.id);
  await trigger.press('Enter');
  await run(`AppEnv.config.set('core.mcp.enabledAccounts', ${JSON.stringify({
    [account.id]: {enabled: true}, [secondAccount.id]: {enabled: false},
  })})`);
  await until(async () => !(await scope.textContent()).includes(secondAccount.emailAddress), 'grant filters the visible Agent accounts');
  assert.deepEqual((await clickCopy(4)).context.accountIds, [account.id]);
  await checkbox(first).check();
  await checkbox(other).check();
  assert.match(await scope.textContent(), /已选 2 个会话/);
  assert.equal(await copy.getAttribute('aria-disabled'), 'true');
  await copy.press('Enter');
  assert.equal(await run('agentClipboard.writes.length'), 4, 'excluded selection is never copied');
  await capture('agent-blocked');

  await main.locator('.pr-search-input').fill('Project kickoff');
  await main.locator('.pr-search-input').press('Enter');
  await until(() => run('agentWorkspace.state.query === "Project kickoff" && !agentWorkspace.state.loading'), 'search completes');
  await trigger.press('Enter');
  assert.match(await scope.textContent(), /搜索结果.*Project kickoff/s);
  const search = await clickCopy(5);
  assert.equal(search.context.query, 'Project kickoff');
  assert.deepEqual(search.context.accountIds, [account.id]);
  await accountPicker.selectOption(account.id);
  await ready();
  const project = await firstRow(account.id);
  await cli('mark-unread', {requestId: require('node:crypto').randomUUID(), targets: [{accountId: account.id, threadId: project}]});
  await until(() => run(`agentWorkspace.state.rows.some(row => row.id === ${JSON.stringify(project)} && row.unread)`),
    'fixture session is marked unread');
  const raw = '"Project kickoff';
  const input = main.locator('.pr-search-input');
  await input.fill(raw);
  await input.press('Enter');
  await until(() => run(`agentWorkspace.state.query === ${JSON.stringify(raw)} && !agentWorkspace.state.loading`),
    'unclosed-quote search loads');
  await main.locator('.pr-unread-filter input').check();
  await ready();
  const visible = await run('agentWorkspace.state.rows.map(row => row.id)');
  assert.equal(visible.length, 1, 'fixture desktop search has one unread match');
  await trigger.press('Enter');
  const unread = await clickCopy(6);
  const command = unread.cli.commands.find(text => text.includes(' --input '));
  const [, method, json] = command.match(/ (local-list|search) --input '(.*)'$/);
  const results = await cli(method, JSON.parse(json));
  verify(method === 'local-list' && unread.context.query === raw &&
    JSON.stringify(results.map(row => row.id)) === JSON.stringify(visible),
    'unread search uses the original query and returns the same thread as the desktop');
  const result = visible[0];
  await main.locator(rowSelector(result)).click();
  await main.locator('.pr-reader').waitFor();
  await trigger.press('Enter');
  assert.match(await scope.textContent(), /当前会话.*Project kickoff/s);
  const reading = await clickCopy(7);
  assert.deepEqual(reading.context, {scope: 'thread', accountId: account.id, threadId: result});

  const draft = await cli('draft-create', {accountId: account.id, to: [], subject: 'Agent handoff fixture draft', body: 'Saved draft for handoff.'});
  await main.locator('[data-mailbox=drafts]').click();
  await main.locator(`[data-draft-id="${draft.draftId}"]`).click();
  const toolbar = main.locator('.pr-editor .pr-copy-agent');
  await toolbar.waitFor();
  const setGrant = allow => run(`AppEnv.config.set('core.mcp.enabledAccounts', ${JSON.stringify({
    [account.id]: {enabled: allow}, [secondAccount.id]: {enabled: false},
  })})`);
  await setGrant(false);
  await toolbar.click();
  await until(async () => await panel.count() || (await run('agentClipboard.writes.length')) > 7, 'toolbar completes its action');
  verify((await run('agentClipboard.writes.length')) === 7 && !!await panel.count(),
    'unauthorized draft references are never copied by the workspace toolbar');
  if (!control) {
    assert.match(await scope.textContent(), /当前草稿/);
    assert.equal(await copy.getAttribute('aria-disabled'), 'true');
    await capture('agent-draft-blocked');
  }
  await setGrant(true);
  const beforeRace = await run('agentClipboard.writes.length');
  await run(`(() => {
    const api = require(AppEnv.getLoadSettings().resourcePath + '/internal_packages/mcp-server/lib/mcp-access-control');
    const original = api.isMessageVisible;
    window.agentDraftCheck = {waiting: false};
    api.isMessageVisible = async draft => {
      await new Promise(resolve => {
        agentDraftCheck.waiting = true;
        agentDraftCheck.release = resolve;
      });
      return original(draft);
    };
    agentDraftCheck.restore = () => { api.isMessageVisible = original; };
    agentDraftCheck.copy = agentWorkspace.copyContext();
  })()`);
  await until(() => run('agentDraftCheck.waiting'), 'draft visibility check is held');
  const subject = main.locator('.pr-subject-heading textarea');
  await subject.fill('Edited while Agent checked visibility');
  await run('(async () => {agentDraftCheck.release(); await agentDraftCheck.copy; agentDraftCheck.restore();})()');
  verify((await run('agentClipboard.writes.length')) === beforeRace,
    'new edits during draft validation cancel the stale copy');
  if (control) {
    fs.writeFileSync(path.join(out, 'control.json'), JSON.stringify({failures}, null, 2));
    assert.deepEqual(failures, [], 'E1 should reproduce all three review findings');
    return;
  }
  await panel.getByRole('status').getByText(/交接已取消/).waitFor();
  assert.equal(await subject.inputValue(), 'Edited while Agent checked visibility');
  const freshDraft = await clickCopy(8);
  const saved = await cli('draft-get', {accountId: account.id, draftId: draft.draftId});
  assert.deepEqual(freshDraft.context, {scope: 'draft', accountId: account.id, draftId: draft.draftId, revision: saved.revision});
  assert.equal(saved.subject, 'Edited while Agent checked visibility');
  assert((await scope.textContent()).includes(saved.subject), 'the copied draft title reflects its saved revision');
  await capture('agent-draft-copied');
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({
    checks: {setup: true, scope: true, narrow: true, keyboard: true, settingsReturn: true,
      selection: true, liveGrant: true, blockedSelection: true, search: true, reader: true,
      clipboardFailure: true, retry: true, cliRead: true, noToken: true,
      unreadSearchParity: true, draftToolbarGrant: true, draftEditCancelsCopy: true, draftRetryUsesSavedRevision: true},
  }, null, 2) + '\n');
  console.log('PASS Agent handoff scope, permission, clipboard, settings and focus');
};
