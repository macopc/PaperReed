const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({main, cdp, out, accounts, cli, truth, until, evaluate, pass, complete, undo}) => {
  const phase = process.env.PAPER_REED_SPAM_PAGE_CHECK;
  const baseline = phase === 'before';
  const list = main.locator('.pr-mail-list');
  const rows = list.locator('.pr-mail-row');
  const folder = main.locator('[data-mailbox=spam]');
  const account = main.locator('#pr-account');
  const selectAll = main.locator('.pr-list-tools input[type=checkbox]').first();
  const receipt = main.locator('.pr-mail-receipt');
  const error = main.locator('.pr-spam-read-error');
  const awaitRows = count => until(async () => await rows.count() === count &&
    await list.getAttribute('aria-busy') === 'false', 'settled ' + count + ' spam rows');
  const capture = async (name, width = 900, height = 640) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const shot = await cdp.send('Page.captureScreenshot', {format: 'png', fromSurface: true});
    fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  const uidState = index => truth(index, 'spam-review-' + index + '@example.test', {placements: true});
  const settledReceipt = async label => {
    const text = await until(async () => {
      const status = await receipt.textContent();
      return status.includes(label) && (status.includes('1 / 1 完成') || status.includes('1 项未完成')) && status;
    }, label + ' receipt');
    assert.match(text, /1 \/ 1 完成/);
  };
  const undoFromPage = async () => {
    await receipt.getByRole('button', {name: '撤销'}).press('Enter');
    await settledReceipt('撤销');
    await awaitRows(1);
  };

  if (!baseline) {
    await evaluate('(() => {'
      + 'const api = require(AppEnv.getLoadSettings().resourcePath + "/src/services/mail-core/inbox");'
      + 'const root = document.querySelector(".pr-workspace");'
      + 'let fiber = root[Object.keys(root).find(key => key.startsWith("__reactFiber$"))];'
      + 'while (fiber && !fiber.stateNode?.refreshOperations) fiber = fiber.return;'
      + 'const ws = fiber.stateNode;'
      + 'const query = api.queryInboxPage;'
      + 'const probe = window.spamProbe = { started: false, fail: false, refresh: ws.refresh,'
      + ' rowCount: () => ws.state.rows.length, receipts: () => ws.state.receipt };'
      + 'probe.gate = new Promise(resolve => { probe.release = resolve; });'
      + 'api.queryInboxPage = async (input, access) => {'
      + 'if (input.folder === "spam") {'
      + 'probe.started = true;'
      + 'await probe.gate;'
      + 'if (probe.fail) throw new Error("fixture spam read failure");'
      + '}'
      + 'return query(input, access);'
      + '};'
      + '})()');
  }
  await folder.click();
  if (!baseline) {
    await until(() => evaluate('spamProbe.started'), 'spam read started');
    await list.getByText('正在读取垃圾邮件…', {exact: true}).waitFor();
    assert.equal(await list.locator('.pr-spam-empty').count(), 0);
    await capture('spam-loading');
    await evaluate('spamProbe.release()');
  }
  if (phase === 'review-pagination') {
    const ids = () => evaluate('[...document.querySelectorAll(".pr-mail-row")].map(row => row.dataset.threadId)');
    await awaitRows(50);
    const previous = new Set(await ids());
    const more = list.locator('.pr-load-more');
    await more.press('Enter');
    await awaitRows(100);
    const firstAdded = (await ids()).find(id => !previous.has(id));
    assert.ok(firstAdded);
    assert.equal(await more.getAttribute('aria-disabled'), 'true');
    assert.equal(await evaluate('document.activeElement.dataset.threadId'), firstAdded,
      'focus moves to the first newly loaded Junk row when the page limit is reached');
    await capture('spam-page-limit');
    pass('Pagination preserves focus at the display limit');
    return;
  }
  if (phase === 'review-search-reader') {
    await awaitRows(2);
    await account.selectOption(accounts[1].id);
    await awaitRows(1);
    const inbox = () => truth(1, 'same-message@example.test', {placements: true});
    const copiesBefore = await inbox();
    assert.equal(copiesBefore.length, 1);
    assert.equal(copiesBefore[0].folder, 'INBOX');
    assert.ok(!copiesBefore[0].flags.includes('\\Seen'));
    const input = main.locator('.pr-search-input');
    await input.fill('Shared subject');
    await input.press('Enter');
    const row = rows.filter({hasText: 'Shared subject'});
    await row.press('Enter');
    await main.locator('.pr-reader').waitFor();
    assert.notEqual(await evaluate('require("mailspring-exports").FocusedPerspectiveStore.current().categoriesSharedRole()'),
      'spam', 'a global result opened from Spam must keep its search context');
    assert.equal(await main.locator('.pr-reader .pr-not-spam').count(), 0);
    await until(async () => (await inbox()).some(copy => copy.folder === 'INBOX' && copy.flags.includes('\\Seen')),
      'the unread Inbox search result is marked read');
    pass('Global search results opened from Spam retain ordinary auto-read');
    return;
  }
  if (phase === 'review-reader') {
    await awaitRows(2);
    await account.selectOption(accounts[1].id);
    await awaitRows(1);
    const archived = (await uidState(1)).find(copy => copy.folder === 'Archive');
    const unread = main.locator('.pr-unread-filter input');
    await unread.check();
    await awaitRows(1);
    await rows.first().press('Enter');
    const readerAction = main.locator('.pr-reader .pr-not-spam');
    await readerAction.waitFor();
    await until(() => evaluate('spamProbe.rowCount() === 0'), 'automatic read removed the row from the unread slice');
    assert.equal(await readerAction.getAttribute('aria-disabled'), 'false',
      'a read Spam message stays restorable in the reader after leaving the unread slice');
    assert.deepEqual((await uidState(1)).find(copy => copy.folder === 'Archive'), archived);
    await capture('spam-unread-reader');
    await readerAction.press('Enter');
    await settledReceipt('移回收件箱');
    assert.ok((await uidState(1)).some(copy => copy.folder === 'INBOX' && copy.flags.includes('\\Seen')));
    assert.deepEqual((await uidState(1)).find(copy => copy.folder === 'Archive'), archived);
    pass('Auto-read is scoped to Junk and the reader can still restore the message');
    return;
  }
  if (phase === 'review-partial-flags') {
    await awaitRows(2);
    await account.selectOption(accounts[1].id);
    await awaitRows(1);
    const before = await uidState(1);
    const archive = before.find(copy => copy.folder === 'Archive');
    const junk = before.filter(copy => copy.folder === 'Junk').sort((a, b) => a.uid - b.uid);
    assert.equal(junk.length, 2);
    await selectAll.check();
    await main.locator('.pr-selection-actions [data-mail-action=unread]').press('Enter');
    const change = await until(async () => {
      const [result] = await evaluate('spamProbe.receipts()');
      return result && !['queued', 'syncing'].includes(result.status) && result;
    }, 'partial flag receipt settles');
    assert.equal(change.status, 'failed');
    assert.equal(change.undoable, true);
    assert.match(await receipt.textContent(), /1 项未完成/);
    const fromCli = await cli('change-get', {accountId: change.accountId, taskId: change.taskId});
    assert.equal(fromCli.status, 'failed');
    assert.equal(fromCli.undoable, true);
    assert.equal(JSON.parse(fromCli.error).key, 'flag-write-partial');
    assert.deepEqual((await uidState(1)).filter(copy => copy.folder === 'Junk'),
      [{...junk[1], flags: junk[1].flags.filter(flag => flag !== '\\Seen')}]);
    await undoFromPage();
    const after = await uidState(1);
    assert.deepEqual(after.filter(copy => copy.folder === 'Junk'), [junk[1]]);
    assert.deepEqual(after.find(copy => copy.folder === 'Archive'), archive);
    pass('Desktop and CLI expose partial flags, and Undo changes only the confirmed Junk copy');
    return;
  }
  await awaitRows(2);
  await selectAll.check();
  await capture('spam-desktop', 1440, 860);
  await capture('spam-narrow', 740, 700);
  const action = main.locator('.pr-selection-actions [data-mail-action=inbox]');
  assert.equal(await action.textContent(), '不是垃圾邮件');
  assert.equal(await main.locator('.pr-selection-actions button').first().textContent(), '不是垃圾邮件');
  assert.equal(await main.locator('.pr-selection-actions [data-mail-action=archive],[data-mail-action=spam]').count(), 0);
  await selectAll.uncheck();
  assert.equal(await list.locator('.pr-mail-row.unread').count(), 0, 'read Junk copy does not inherit its Archive copy’s unread flag');

  const spamIds = [];
  for (const entry of accounts) {
    const local = await cli('local-list', {accountId: entry.id, folder: 'spam'});
    assert.equal(local.length, 1);
    assert.equal(local[0].unread, false);
    assert.deepEqual(await cli('local-list', {accountId: entry.id, folder: 'spam', unread: true}), []);
    spamIds.push(local[0].id);
  }
  assert.deepEqual(new Set(await evaluate('[...document.querySelectorAll(".pr-mail-row")].map(row => row.dataset.threadId)')),
    new Set(spamIds));
  pass('Mixed Gmail and IMAP Spam matches CLI, with a dedicated bulk restore action');

  await evaluate('spamProbe.fail = true; spamProbe.refresh()');
  await error.waitFor();
  assert.ok(await rows.first().isDisabled());
  assert.equal(await main.locator('.pr-list-caption').count(), 0);
  await capture('spam-failed');
  await evaluate('document.querySelector(".pr-spam-read-error button").addEventListener("click", () => {'
    + ' spamProbe.fail = false; }, {capture: true, once: true})');
  await error.getByRole('button', {name: '重新读取'}).press('Enter');
  await awaitRows(2);
  assert.equal(await evaluate('document.activeElement.matches(".pr-search-input")'), true);
  await main.locator('.pr-unread-filter input').check();
  await awaitRows(0);
  await list.getByText('没有未读的垃圾邮件', {exact: true}).waitFor();
  await capture('spam-unread');
  await list.getByRole('button', {name: '显示全部邮件'}).press('Enter');
  await awaitRows(2);
  pass('Loading, error, retry and unread states preserve list safety and keyboard access');

  await account.selectOption(accounts[1].id);
  await awaitRows(1);
  const ordinaryBefore = await uidState(1);
  const archived = ordinaryBefore.find(copy => copy.folder === 'Archive');
  const junk = ordinaryBefore.find(copy => copy.folder === 'Junk');
  assert.ok(archived && junk);
  await selectAll.check();
  await main.locator('.pr-selection-actions [data-mail-action=unread]').press('Enter');
  await settledReceipt('标为未读');
  assert.equal((await uidState(1)).find(copy => copy.folder === 'Junk')?.flags.includes('\\Seen'), false,
    'Junk copy becomes unread even when its Archive copy was already unread');
  assert.deepEqual((await uidState(1)).find(copy => copy.folder === 'Archive'), archived);
  await undoFromPage();
  assert.deepEqual((await uidState(1)).find(copy => copy.folder === 'Junk'), junk);
  assert.deepEqual((await uidState(1)).find(copy => copy.folder === 'Archive'), archived);
  pass('Scoped unread and its undo preserve the Archive copy’s flags');
  if (phase === 'review-flags') return;
  await selectAll.check();
  await action.press('Enter');
  await settledReceipt('移回收件箱');
  await awaitRows(0);
  await list.getByRole('button', {name: '返回收件箱'}).waitFor();
  await capture('spam-empty');
  assert.deepEqual((await uidState(1)).find(copy => copy.folder === 'Archive'), archived);
  assert.deepEqual((await uidState(1)).find(copy => copy.folder === 'INBOX')?.flags, junk.flags);
  assert.ok(!(await uidState(1)).some(copy => copy.folder === 'Junk'));
  await undoFromPage();
  assert.deepEqual((await uidState(1)).find(copy => copy.folder === 'Archive'), archived);
  assert.deepEqual((await uidState(1)).find(copy => copy.folder === 'Junk')?.flags, junk.flags);

  await selectAll.check();
  await main.locator('.pr-selection-actions [data-mail-action=trash]').press('Enter');
  await settledReceipt('移入废纸篓');
  await awaitRows(0);
  assert.deepEqual((await uidState(1)).find(copy => copy.folder === 'Archive'), archived);
  assert.deepEqual((await uidState(1)).find(copy => copy.folder === 'Trash')?.flags, junk.flags);
  await undoFromPage();
  assert.deepEqual((await uidState(1)).find(copy => copy.folder === 'Archive'), archived);
  assert.deepEqual((await uidState(1)).find(copy => copy.folder === 'Junk')?.flags, junk.flags);
  pass('IMAP restore and trash operate on the Junk copy, including exact undo');

  await account.selectOption(accounts[0].id);
  await awaitRows(1);
  const gmailBefore = await uidState(0);
  assert.ok(gmailBefore.some(copy => copy.folder === '[Gmail]/Spam'));
  await rows.first().press('Enter');
  const readerAction = main.locator('.pr-reader .pr-not-spam');
  await readerAction.waitFor();
  await capture('spam-reader');
  await readerAction.press('Enter');
  await settledReceipt('移回收件箱');
  assert.ok((await uidState(0)).some(copy => copy.labels.includes('\\Inbox')));
  assert.ok(!(await uidState(0)).some(copy => copy.folder === '[Gmail]/Spam'));
  await main.locator('.pr-back').press('Enter');
  await awaitRows(0);
  await undoFromPage();
  const gmailAfter = await uidState(0);
  assert.deepEqual(gmailAfter.map(({folder, labels, flags}) => ({folder, labels, flags})),
    gmailBefore.map(({folder, labels, flags}) => ({folder, labels, flags})));
  const gmailTrash = await cli('trash', {targets: [{accountId: accounts[0].id, threadId: spamIds[0]}],
    requestId: 'gmail-spam-trash', fromSpam: true});
  await complete(gmailTrash.items[0]);
  assert.deepEqual((await uidState(0)).map(copy => copy.folder), ['[Gmail]/Trash']);
  await undo(gmailTrash.items[0]);
  assert.deepEqual((await uidState(0)).map(({folder, labels, flags}) => ({folder, labels, flags})),
    gmailBefore.map(({folder, labels, flags}) => ({folder, labels, flags})));
  pass('Gmail reader restore and scoped Trash both undo to Spam with original flags and labels');

  const input = {targets: [{accountId: accounts[1].id, threadId: spamIds[1]}], requestId: 'spam-scoped-restore'};
  const scoped = await cli('restore-inbox', {...input, fromSpam: true});
  await complete(scoped.items[0]);
  const conflict = await cli('restore-inbox', input, true);
  assert.equal(conflict.items[0].error, 'request-conflict');
  await undo(scoped.items[0]);
  assert.deepEqual((await uidState(1)).find(copy => copy.folder === 'Archive'), archived);
  assert.deepEqual((await uidState(1)).find(copy => copy.folder === 'Junk')?.flags, junk.flags);
  pass('CLI enforces the Spam scope across repeated requests and undo');

  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({
    spamIds, states: true, ordinaryScope: true, gmailReader: true, cliScope: true,
  }, null, 2) + '\n');
};
