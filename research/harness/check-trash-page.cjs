const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({main, cdp, out, accounts, cli, truth, until, evaluate, pass, complete, undo}) => {
  const phase = process.env.PAPER_REED_TRASH_PAGE_CHECK;
  const baseline = phase === 'before';
  const list = main.locator('.pr-mail-list');
  const rows = list.locator('.pr-mail-row');
  const trash = main.locator('[data-mailbox=trash]');
  const account = main.locator('#pr-account');
  const selectAll = main.locator('.pr-list-tools input[type=checkbox]').first();
  const unread = main.locator('.pr-unread-filter input');
  const receipt = main.locator('.pr-mail-receipt');
  const recovery = main.locator('.pr-selection-actions [data-mail-action=inbox]');
  const readerRecovery = main.locator('.pr-reader .pr-restore-trash');
  const readingError = main.locator('.pr-trash-read-error');
  const awaitRows = count => until(async () => await rows.count() === count &&
    await list.getAttribute('aria-busy') === 'false', 'settled ' + count + ' Trash rows');
  const capture = async (name, width = 900, height = 640) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const shot = await cdp.send('Page.captureScreenshot', {format: 'png', fromSurface: true});
    fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  const copies = index => truth(index, 'trash-review-' + index + '@example.test', {placements: true});
  const settled = async label => {
    const status = await until(async () => {
      const text = await receipt.textContent();
      return text.includes(label) && (/1 \/ 1 完成|1 项未完成/.test(text)) && text;
    }, label + ' receipt');
    assert.match(status, /1 \/ 1 完成/);
  };

  if (!baseline) {
    await evaluate(`(() => {
      const api = require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core/inbox');
      const root = document.querySelector('.pr-workspace');
      let fiber = root[Object.keys(root).find(key => key.startsWith('__reactFiber$'))];
      while (fiber && !fiber.stateNode?.refreshOperations) fiber = fiber.return;
      const ws = fiber.stateNode;
      const query = api.queryInboxPage;
      const probe = window.trashProbe = {
        started: false, fail: false, refresh: ws.refresh, rowCount: () => ws.state.rows.length,
        searchPending: ws.onSearchPending,
      };
      probe.gate = new Promise(resolve => { probe.release = resolve; });
      api.queryInboxPage = async (input, access) => {
        if (input.folder === 'trash') {
          probe.started = true;
          await probe.gate;
          if (probe.fail) throw new Error('fixture Trash read failure');
        }
        return query(input, access);
      };
    })()`);
  }
  await trash.click();
  if (!baseline) {
    await until(() => evaluate('trashProbe.started'), 'Trash read begins');
    await list.getByText('正在读取废纸篓…', {exact: true}).waitFor();
    assert.equal(await list.locator('.pr-trash-empty').count(), 0);
    await capture('trash-loading');
    await evaluate('trashProbe.release()');
  }
  if (phase === 'pagination') {
    const ids = () => evaluate('[...document.querySelectorAll(".pr-mail-row")].map(row => row.dataset.threadId)');
    await awaitRows(50);
    const previous = new Set(await ids());
    const more = list.locator('.pr-load-more');
    await more.press('Enter');
    await awaitRows(100);
    assert.equal(await more.getAttribute('aria-disabled'), 'true');
    assert.equal(await evaluate('document.activeElement.dataset.threadId'),
      (await ids()).find(id => !previous.has(id)));
    pass('Trash pagination focuses the first newly loaded conversation');
    return;
  }
  await awaitRows(2);
  if (phase === 'pending-search') {
    await account.selectOption(accounts[1].id);
    await awaitRows(1);
    const before = await copies(1);
    assert.ok(before.find(copy => copy.folder === 'Trash').flags.includes('\\Seen'));
    assert.ok(!before.find(copy => copy.folder === 'Archive').flags.includes('\\Seen'));
    assert.equal(await list.locator('.pr-mail-row.unread').count(), 0);
    await evaluate('trashProbe.searchPending()');
    await until(async () => await rows.first().isDisabled(), 'search pending disables the cached row');
    assert.equal(await list.locator('.pr-mail-row.unread').count(), 0,
      'the cached Trash row retains the flag read for that folder');
    const input = main.locator('.pr-search-input');
    await input.fill('Shared subject');
    await input.press('Enter');
    await awaitRows(1);
    assert.match(await rows.first().textContent(), /Shared subject/);
    assert.equal(await rows.first().isEnabled(), true);
    pass('Pending search keeps the cached Trash flags and then opens the global result list');
    return;
  }
  if (phase === 'palette') {
    await account.selectOption(accounts[1].id);
    await awaitRows(1);
    const before = await copies(1);
    const archived = before.find(copy => copy.folder === 'Archive');
    const trashed = before.find(copy => copy.folder === 'Trash');
    assert.ok(archived && trashed);
    await selectAll.check();
    await main.locator('.pr-command-trigger').click();
    const panel = main.getByRole('dialog', {name: '命令面板'});
    const input = panel.getByRole('textbox', {name: '查找命令'});
    await input.fill('移回收件箱');
    const commands = await evaluate('[...document.querySelectorAll(".pr-command-results button span")].map(item => item.textContent)');
    assert.deepEqual(commands, ['从归档移回收件箱', '从废纸篓移回收件箱']);
    assert.equal(await panel.getByRole('button', {name: '从归档移回收件箱', exact: true}).isDisabled(), true);
    assert.equal(await panel.getByRole('button', {name: '从废纸篓移回收件箱', exact: true}).isEnabled(), true);
    await capture('trash-restore-commands');
    await input.press('Enter');
    await settled('移回收件箱');
    await awaitRows(0);
    assert.deepEqual((await copies(1)).find(copy => copy.folder === 'Archive'), archived);
    await receipt.getByRole('button', {name: '撤销'}).press('Enter');
    await settled('撤销');
    await awaitRows(1);
    assert.deepEqual((await copies(1)).find(copy => copy.folder === 'Archive'), archived);
    assert.deepEqual((await copies(1)).find(copy => copy.folder === 'Trash').flags, trashed.flags);
    pass('Command palette identifies the source and keyboard restore and undo stay scoped to Trash');
    return;
  }
  if (phase !== 'reader-unread') {
    await selectAll.check();
    await capture('trash-desktop', 1440, 860);
    await capture('trash-narrow', 740, 700);
    if (!baseline) {
      assert.equal(await recovery.textContent(), '移回收件箱');
      assert.equal(await main.locator('.pr-selection-actions button').first().getAttribute('data-mail-action'), 'inbox');
      assert.equal(await main.locator('.pr-selection-actions [data-mail-action=archive],[data-mail-action=trash],[data-mail-action=spam]').count(), 0);
    }
    await selectAll.uncheck();
  }

  if (!baseline && phase !== 'reader-unread') {
    const ids = [];
    for (const {id} of accounts) {
      const local = await cli('local-list', {accountId: id, folder: 'trash'});
      assert.equal(local.length, 1);
      assert.equal(local[0].unread, false);
      assert.deepEqual(await cli('local-list', {accountId: id, folder: 'trash', unread: true}), []);
      ids.push(local[0].id);
    }
    assert.deepEqual(new Set(await evaluate('[...document.querySelectorAll(".pr-mail-row")].map(row => row.dataset.threadId)')), new Set(ids));
    assert.equal(await list.locator('.pr-mail-row.unread').count(), 0);
    await unread.check();
    await awaitRows(0);
    await list.getByText('没有未读的废纸篓邮件', {exact: true}).waitFor();
    await capture('trash-unread');
    await list.getByRole('button', {name: '显示全部邮件'}).press('Enter');
    await awaitRows(2);
    await rows.first().focus();
    await evaluate('trashProbe.fail = true; trashProbe.refresh()');
    await readingError.waitFor();
    assert.equal(await rows.count(), 2);
    assert.equal(await rows.first().isDisabled(), true);
    assert.equal(await main.locator('.pr-list-caption').count(), 0);
    await capture('trash-failed');
    await evaluate('document.querySelector(".pr-trash-read-error button").addEventListener("click", () => {'
      + 'trashProbe.fail = false; }, {capture: true, once: true})');
    await readingError.getByRole('button', {name: '重新读取'}).press('Enter');
    await awaitRows(2);
    assert.equal(await evaluate('document.activeElement.matches(".pr-search-input")'), true);
    pass('Trash uses matching desktop/CLI unread state and disables stale rows during a failed read');
  }

  await account.selectOption(accounts[1].id);
  await awaitRows(1);
  const before = await copies(1);
  const archived = before.find(copy => copy.folder === 'Archive');
  const trashed = before.find(copy => copy.folder === 'Trash');
  assert.ok(archived && trashed);
  if (phase === 'reader-unread') {
    await unread.check();
    await awaitRows(1);
    await rows.first().press('Enter');
    await until(() => evaluate('trashProbe.rowCount() === 0'), 'auto-read removes the Trash row from unread results');
    assert.equal(await readerRecovery.getAttribute('aria-disabled'), 'false');
    assert.deepEqual((await copies(1)).find(copy => copy.folder === 'Archive'), archived);
    assert.ok((await copies(1)).find(copy => copy.folder === 'Trash').flags.includes('\\Seen'));
    await capture('trash-unread-reader');
    await readerRecovery.press('Enter');
    await settled('移回收件箱');
    assert.ok((await copies(1)).find(copy => copy.folder === 'INBOX').flags.includes('\\Seen'));
    assert.deepEqual((await copies(1)).find(copy => copy.folder === 'Archive'), archived);
    pass('Opening unread Trash auto-reads only the Trash copy and still allows reader restore');
    return;
  }
  if (!baseline) {
    await selectAll.check();
    await main.locator('.pr-selection-actions [data-mail-action=unread]').press('Enter');
    await settled('标为未读');
    assert.ok(!(await copies(1)).find(copy => copy.folder === 'Trash').flags.includes('\\Seen'));
    assert.deepEqual((await copies(1)).find(copy => copy.folder === 'Archive'), archived);
    await receipt.getByRole('button', {name: '撤销'}).press('Enter');
    await settled('撤销');
    assert.deepEqual((await copies(1)).find(copy => copy.folder === 'Trash'), trashed);
  }

  await selectAll.check();
  await recovery.press('Enter');
  await settled('移回收件箱');
  assert.deepEqual((await copies(1)).find(copy => copy.folder === 'Archive'), archived,
    'restoring from Trash must preserve the existing Archive copy and UID');
  assert.deepEqual((await copies(1)).find(copy => copy.folder === 'INBOX').flags, trashed.flags);
  await awaitRows(0);
  assert.equal(await list.getByText('本机废纸篓为空', {exact: true}).count(), 1);
  await capture('trash-empty');
  await receipt.getByRole('button', {name: '撤销'}).press('Enter');
  await settled('撤销');
  await awaitRows(1);
  assert.deepEqual((await copies(1)).find(copy => copy.folder === 'Archive'), archived);
  assert.deepEqual((await copies(1)).find(copy => copy.folder === 'Trash').flags, trashed.flags);
  pass('Trash restores and undoes only the ordinary IMAP Trash copy');

  const [thread] = await cli('local-list', {accountId: accounts[1].id, folder: 'trash'});
  const target = {accountId: accounts[1].id, threadId: thread.id};
  const scope = {targets: [target], requestId: 'trash-scoped-restore'};
  const scoped = await cli('restore-inbox', {...scope, fromTrash: true});
  await complete(scoped.items[0]);
  const conflict = await cli('restore-inbox', scope, true);
  assert.equal(conflict.items[0].error, 'request-conflict');
  await undo(scoped.items[0]);
  await awaitRows(1);
  assert.deepEqual((await copies(1)).find(copy => copy.folder === 'Archive'), archived);
  pass('CLI enforces the same fromTrash scope and request identity');

  await account.selectOption(accounts[0].id);
  await awaitRows(1);
  const gmailBefore = await copies(0);
  assert.equal(gmailBefore.length, 1);
  await rows.first().press('Enter');
  await until(async () => await readerRecovery.getAttribute('aria-disabled') === 'false', 'Gmail Trash restore is ready');
  await capture('trash-reader');
  await readerRecovery.press('Enter');
  await settled('移回收件箱');
  assert.ok((await copies(0)).some(copy => copy.labels.includes('\\Inbox')));
  assert.ok(!(await copies(0)).some(copy => copy.folder === '[Gmail]/Trash'));
  await main.locator('.pr-back').press('Enter');
  await awaitRows(0);
  await receipt.getByRole('button', {name: '撤销'}).press('Enter');
  await settled('撤销');
  await awaitRows(1);
  const flagsAndLabels = ({folder, labels, flags}) => ({folder, labels, flags});
  assert.deepEqual((await copies(0)).map(flagsAndLabels), gmailBefore.map(flagsAndLabels));
  pass('Gmail reader restore can be undone to Trash with the original labels and flags');
};
