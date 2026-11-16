const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  { randomUUID } = require('node:crypto');
module.exports = async ({ main, cdp, account, cli, work, evaluate, until }) => {
  const out = path.resolve(__dirname, '../inbox-validation-2026-11-16');
  fs.mkdirSync(out, { recursive: true });
  const run = (s) => evaluate(cdp, s),
    action = (s) => main.locator(s).first().click();
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
  const query = async (q) => {
    await main.locator('.pr-search-input').fill(q);
    await main.locator('.pr-search-input').press('Enter');
  };
  const rows = () =>
    run(
      'Array.from(document.querySelectorAll(".pr-mail-row")).map(e=>e.dataset.threadId)'
    );
  const targets = (ids) =>
    ids.map((threadId) => ({ accountId: account.id, threadId }));
  const complete = async (item) => {
    if (!item.taskId) return item;
    return until(async () => {
      const r = await cli('change-get', {
        accountId: item.accountId,
        taskId: item.taskId,
      });
      assert(
        !['failed', 'rejected', 'cancelled'].includes(r.status),
        JSON.stringify(r)
      );
      return r.status === 'succeeded' ? r : false;
    }, 'remote mail operation complete');
  };
  const undo = async (item) =>
    complete(
      await cli('undo', { accountId: item.accountId, taskId: item.taskId })
    );
  const folders = await cli('folders', { accountId: account.id });
  const folderId = (role) => folders.find((f) => f.role === role).id;
  const categoryRows = (role) =>
    cli('threads', {
      accountId: account.id,
      folderId: folderId(role),
      limit: 100,
    });
  const all = await rows();
  assert.equal(all.length, 8);
  await run(
    `require(AppEnv.getLoadSettings().resourcePath+'/internal_packages/mcp-server/lib/paper-reed-cli').installCLI().then(()=>true)`
  );
  await shot('inbox');
  await query('from:sender0@example.test');
  await until(async () => (await rows()).length === 1, 'GUI search');
  const searched = await cli('search', {
    accountId: account.id,
    query: 'from:sender0@example.test',
    limit: 25,
  });
  assert.deepEqual(
    await rows(),
    searched.map((t) => t.id)
  );
  await shot('search');
  await run(
    `window.prCopyOriginal=require('@electron/remote').clipboard.writeText;window.prInboxCopy='';require('@electron/remote').clipboard.writeText=t=>window.prInboxCopy=t;true`
  );
  try {
    await action('.pr-agent-button');
    await main
      .locator('.pr-agent-panel button')
      .filter({ hasText: '复制给 Agent' })
      .click();
    const handoff = JSON.parse(await run('window.prInboxCopy'));
    assert.equal(handoff.context.query, 'from:sender0@example.test');
    assert(handoff.cli.commands[1].includes('from:sender0@example.test'));
    await action('.pr-agent-button');
  } finally {
    await run(
      `require('@electron/remote').clipboard.writeText=window.prCopyOriginal;delete window.prCopyOriginal;delete window.prInboxCopy;true`
    );
  }

  await action('.pr-mail-row');
  await until(
    () => run('!!document.querySelector(".pr-reader")'),
    'search result reader'
  );
  await action('.pr-back');
  await until(
    () => run('!!document.querySelector(".pr-search-input")'),
    'back to search'
  );
  assert.equal(
    await main.locator('.pr-search-input').inputValue(),
    'from:sender0@example.test'
  );
  await query('paperreed-no-match-983001');
  await until(async () => (await rows()).length === 0, 'empty search');
  await shot('empty-search');
  await query('');
  await until(async () => (await rows()).length === 8, 'clear search');
  // Keyboard list actions never intercept typing or IME composition.
  await main.locator('.pr-search-input').fill('jkx');
  assert.equal(
    await run('document.querySelectorAll(".pr-mail-item.selected").length'),
    0
  );
  await main.locator('.pr-search-input').fill('');
  await main.locator('.pr-mail-row').first().focus();
  await main.keyboard.press('j');
  assert.equal(await run('document.activeElement.dataset.threadId'), all[1]);
  await main.keyboard.press('x');
  assert.equal(
    await run('document.querySelectorAll(".pr-mail-item.selected").length'),
    1
  );
  await main.keyboard.press('Escape');
  await main.keyboard.press('e');
  assert.equal((await rows()).length, 8);
  await run(
    `document.activeElement.dispatchEvent(new KeyboardEvent('keydown',{key:'x',isComposing:true,bubbles:true}));true`
  );
  assert.equal(
    await run('document.querySelectorAll(".pr-mail-item.selected").length'),
    0
  );
  // Make a mixed read/unread pair. Undo must not mark the already-read item unread.
  let initial = await cli('mark-read', {
    targets: targets([all[0]]),
    requestId: randomUUID(),
  });
  await complete(initial.items[0]);
  await complete(
    (
      await cli('mark-unread', {
        targets: targets([all[1]]),
        requestId: randomUUID(),
      })
    ).items[0]
  );
  await until(
    () =>
      run(
        `document.querySelector('[data-thread-id="${all[1]}"]')?.classList.contains('unread')`
      ),
    'mixed fixture unread'
  );
  await main.locator('.pr-mail-item > input').nth(0).check();
  await main.locator('.pr-mail-item > input').nth(1).check();
  await shot('selection');
  await run(
    `window.prCopyOriginal=require('@electron/remote').clipboard.writeText;window.prInboxCopy='';require('@electron/remote').clipboard.writeText=t=>window.prInboxCopy=t;true`
  );
  try {
    await action('.pr-agent-button');
    await main
      .locator('.pr-agent-panel button')
      .filter({ hasText: '复制给 Agent' })
      .click();
    const h = JSON.parse(await run('window.prInboxCopy'));
    assert.deepEqual(h.context.targets, targets(all.slice(0, 2)));
    assert.equal(h.cli.commands.length, 3);
    await shot('selected-agent');
    await action('.pr-agent-button');
  } finally {
    await run(
      `require('@electron/remote').clipboard.writeText=window.prCopyOriginal;delete window.prCopyOriginal;delete window.prInboxCopy;true`
    );
  }

  await action('[data-mail-action=read]');
  await until(
    () =>
      run(
        'document.querySelector(".pr-mail-receipt")?.innerText.includes("2 / 2 完成")'
      ),
    'GUI read complete'
  );
  await main
    .locator('.pr-mail-receipt button')
    .filter({ hasText: '撤销' })
    .click();
  await until(
    () =>
      run(
        'document.querySelector(".pr-mail-receipt")?.innerText.includes("1 / 1 完成")'
      ),
    'GUI undo complete'
  );
  let inbox = await categoryRows('inbox');
  assert.equal(inbox.find((t) => t.id === all[0]).unread, false);
  assert.equal(inbox.find((t) => t.id === all[1]).unread, true);
  // Archive by GUI; CLI sees the same folders and exact task targets.
  await main.locator('.pr-mail-item > input').nth(1).check();
  await main.locator('.pr-mail-row').nth(1).focus();
  await main.keyboard.press('e');
  await until(
    () =>
      run(
        'document.querySelector(".pr-mail-receipt")?.innerText.includes("1 / 1 完成")'
      ),
    'archive complete'
  );
  assert((await categoryRows('archive')).some((t) => t.id === all[1]));
  await shot('archive-result');
  await action('[data-mailbox=archive]');
  await until(
    async () => (await rows()).includes(all[1]),
    'archive navigation'
  );
  await main
    .locator('.pr-mail-receipt button')
    .filter({ hasText: '撤销' })
    .click();
  await until(
    () =>
      run(
        'document.querySelector(".pr-mail-receipt")?.innerText.includes("1 / 1 完成")'
      ),
    'archive undo'
  );
  assert((await categoryRows('inbox')).some((t) => t.id === all[1]));
  // CLI mutations update GUI, stable retries reuse the same task; changed action is rejected.
  await action('[data-mailbox=inbox]');
  await until(async () => (await rows()).length === 8, 'inbox restored');
  const requestId = randomUUID();
  const moved = await cli('trash', { targets: targets([all[2]]), requestId });
  const movedItem = await complete(moved.items[0]);
  assert.equal(
    (await cli('trash', { targets: targets([all[2]]), requestId })).items[0]
      .taskId,
    movedItem.taskId
  );
  const conflict = await cli(
    'spam',
    { targets: targets([all[2]]), requestId },
    true
  );
  assert.equal(conflict.items[0].error, 'request-conflict');
  await until(
    async () => !(await rows()).includes(all[2]),
    'CLI trash reflected'
  );
  const persisted = await run(
    `require('mailspring-exports').DatabaseStore.find(require(AppEnv.getLoadSettings().resourcePath+'/src/flux/tasks/task').Task,${JSON.stringify(movedItem.taskId)}).then(t=>t.toJSON())`
  );
  assert(persisted.messageIds.length);
  assert(!('threadIds' in persisted));
  await undo(movedItem);
  assert((await categoryRows('inbox')).some((t) => t.id === all[2]));
  const spammed = await cli('spam', {
    targets: targets([all[3]]),
    requestId: randomUUID(),
  });
  await complete(spammed.items[0]);
  assert((await categoryRows('spam')).some((t) => t.id === all[3]));
  const restored = await cli('restore-inbox', {
    targets: targets([all[3]]),
    requestId: randomUUID(),
  });
  await complete(restored.items[0]);
  assert((await categoryRows('inbox')).some((t) => t.id === all[3]));
  const partial = await cli(
    'mark-unread',
    {
      targets: [
        ...targets([all[0]]),
        { accountId: account.id, threadId: 'missing-thread' },
      ],
      requestId: randomUUID(),
    },
    true
  );
  assert.equal(partial.items[1].status, 'rejected');
  await complete(partial.items[0]);
  // Wrong account and revoked write permission cannot enqueue mail changes.
  const wrong = await cli(
    'archive',
    {
      targets: [{ accountId: 'wrong-account', threadId: all[0] }],
      requestId: randomUUID(),
    },
    true
  );
  assert.equal(wrong.items[0].status, 'rejected');
  await run(`AppEnv.config.set('core.mcp.accessLevel','read-only');true`);
  const denied = await cli(
    'archive',
    { targets: targets([all[0]]), requestId: randomUUID() },
    true
  );
  assert(JSON.stringify(denied).includes('Access denied'));
  await run(
    `AppEnv.config.set('core.mcp.accessLevel','read-write');AppEnv.config.set('core.mcp.enabledAccounts',{[${JSON.stringify(account.id)}]:{enabled:true,excludedFolderIds:[${JSON.stringify(folderId('trash'))}]}});true`
  );
  const excluded = await cli(
    'trash',
    { targets: targets([all[0]]), requestId: randomUUID() },
    true
  );
  assert(excluded.items[0].error.includes('excluded'));
  await run(
    `AppEnv.config.set('core.mcp.enabledAccounts',{[${JSON.stringify(account.id)}]:{enabled:true}});true`
  );
  await action('[data-mailbox=inbox]');
  await until(async () => (await rows()).length === 8, 'final inbox');
  await main.locator('.pr-unread-filter input').check();
  await until(
    () => run('!document.querySelector(".pr-mail-row:not(.unread)")'),
    'unread filter'
  );
  await main.locator('.pr-unread-filter input').uncheck();
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 900,
    height: 700,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await main.locator('.pr-mail-item > input').first().check();
  await shot('compact-selection');
  assert(
    await run(
      'document.querySelector(".pr-main").scrollWidth<=document.querySelector(".pr-main").clientWidth+1'
    )
  );
  const result = {
    searchUIAndCLI: true,
    searchBackPreserved: true,
    emptySearch: true,
    keyboardList: true,
    archiveShortcut: true,
    searchAgentScope: true,
    selectionAgentScope: true,
    typingAndIMEProtected: true,
    mixedReadUndo: true,
    archiveAndUndo: true,
    cliTrashAndUndo: true,
    spamRestore: true,
    requestRetrySameTask: true,
    requestConflict: true,
    fixedMessageSnapshot: true,
    partialResults: true,
    accountIsolation: true,
    writePermission: true,
    destinationRestriction: true,
    unreadFilter: true,
    compactLayout: true,
    expectedSMTPSubmissions: 0,
  };
  fs.writeFileSync(
    path.join(out, 'result.json'),
    JSON.stringify(result, null, 2) + '\n'
  );
  console.log('PASS inbox operations', JSON.stringify(result));
};
