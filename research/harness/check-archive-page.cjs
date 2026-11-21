const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({main, cdp, out, accounts, ids, cli, truth, until, evaluate, pass, complete, undo}) => {
  const baseline = process.env.PAPER_REED_ARCHIVE_PAGE_CHECK === 'before';
  const phase = process.env.PAPER_REED_ARCHIVE_PAGE_CHECK;
  const list = main.locator('.pr-mail-list');
  const rows = list.locator('.pr-mail-row');
  const search = main.locator('.pr-search-input');
  const archive = main.locator('[data-mailbox=archive]');
  const inbox = main.locator('[data-mailbox=inbox]');
  const selectAll = main.locator('.pr-list-tools input[type=checkbox]').first();
  const receipt = main.locator('.pr-mail-receipt');
  const readError = main.locator('.pr-archive-read-error');
  const awaitRows = count => until(async () => await rows.count() === count &&
    await list.getAttribute('aria-busy') === 'false', `settled ${count} archive rows`);
  const capture = async (name, width = 900, height = 640) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
    await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const shot = await cdp.send('Page.captureScreenshot', {format: 'png', fromSurface: true});
    fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  const done = action => until(async () => (await receipt.textContent()).includes(`${action} · 2 / 2 完成`),
    `${action} remote receipt`);
  const restoreSettles = () => until(async () => {
    const status = await receipt.textContent();
    return status.includes('移回收件箱') &&
      (status.includes('1 项未完成') || status.includes('2 / 2 完成')) && status;
  }, 'Archive restore settles');
  const verifyGmailSentSibling = async () => {
    const copies = await truth(0, 'sent-archive-sibling@example.test');
    assert.ok(copies.some(item => item.labels.includes('\\Sent')), 'Gmail sent copy remains present');
    assert.equal(copies.some(item => item.labels.includes('\\Inbox')), false, 'Gmail sent copy never restores into Inbox');
  };

  if (!baseline) {
    await evaluate(`(() => {
      const api = require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core/inbox');
      const root = document.querySelector('.pr-workspace');
      let fiber = root[Object.keys(root).find(key => key.startsWith('__reactFiber$'))];
      while (fiber && !fiber.stateNode?.refreshOperations) fiber = fiber.return;
      const ws = fiber.stateNode;
      const query = api.queryInbox;
      const probe = window.archiveProbe = { started: false, fail: false, refresh: ws.refresh };
      probe.gate = new Promise(resolve => { probe.release = resolve; });
      api.queryInbox = async (input, access) => {
        if (input.folder === 'archive') {
          probe.started = true;
          await probe.gate;
          if (probe.fail) throw new Error('fixture archive read failure');
        }
        const result = await query(input, access);
        return input.folder === 'archive' && probe.hidden ? result.filter(row => row.id !== probe.hidden) : result;
      };
    })()`);
  }
  await archive.click();
  if (!baseline) {
    await until(() => evaluate('archiveProbe.started'), 'archive read started');
    await list.getByText('正在读取归档邮件…', {exact: true}).waitFor();
    assert.equal(await list.getByText('本机暂无归档邮件', {exact: true}).count(), 0);
    await capture('archive-loading');
    await evaluate('archiveProbe.release()');
  }
  await awaitRows(0);
  await capture('archive-empty');
  if (baseline) await inbox.click();
  else {
    await list.getByRole('button', {name: '返回收件箱'}).press('Enter');
    assert.equal(await evaluate('document.activeElement.matches(".pr-search-input")'), true);
  }
  await awaitRows(2);
  await selectAll.check();
  await main.locator('[data-mail-action=archive]').press('Enter');
  await done('归档');
  await awaitRows(0);
  assert.equal((await truth(0)).some(item => item.labels.includes('\\Inbox')), false);
  assert.ok((await truth(1)).some(item => item.folder === 'Archive'));
  await archive.click();
  await awaitRows(baseline ? 1 : 2);
  await capture('archive-desktop', 1440, 860);
  await capture('archive-narrow', 740, 700);
  if (baseline) {
    assert.equal(await rows.count(), 2, 'both Gmail and ordinary IMAP archived threads must be visible');
    return;
  }

  assert.deepEqual(new Set(await evaluate('[...document.querySelectorAll(".pr-mail-row")].map(row => row.dataset.threadId)')),
    new Set(ids), 'sent-only mail stays out of Archive');
  for (const [index, account] of accounts.entries()) {
    const items = await cli('local-list', {accountId: account.id, folder: 'archive'});
    assert.deepEqual(items.map(item => item.id), [ids[index]], 'Agent Archive matches desktop');
  }
  pass('Mixed-provider Archive membership and CLI match, sent-only mail excluded');

  if (phase === 'focus') {
    const current = list.locator('.pr-mail-item').filter({has: main.locator(`[data-thread-id="${ids[1]}"]`)});
    await current.getByRole('checkbox').focus();
    await evaluate(`archiveProbe.hidden = ${JSON.stringify(ids[1])}; archiveProbe.refresh()`);
    await awaitRows(1);
    assert.equal(await evaluate(`document.activeElement.closest('.pr-mail-item')?.querySelector('.pr-mail-row')?.dataset.threadId === ${JSON.stringify(ids[0])} &&
      document.activeElement.matches('input[type=checkbox]')`), true, 'focus transfers to the remaining Archive checkbox');
    pass('Focus transfers to the adjacent archive checkbox when its original row disappears');
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({checkboxFocus: true}, null, 2) + '\n');
    return;
  }

  const gmailRow = list.locator(`.pr-mail-row[data-thread-id="${ids[0]}"]`);
  await gmailRow.press('Enter');
  await main.locator('.pr-reader iframe[data-rendered-message-id]').first().waitFor();
  await main.locator('.pr-back').press('Enter');
  await awaitRows(2);
  assert.equal(await evaluate(`document.activeElement.dataset.threadId === ${JSON.stringify(ids[0])}`), true);
  await main.locator('.pr-unread-filter input').check();
  await awaitRows(0);
  await list.getByText('没有未读的归档邮件', {exact: true}).waitFor();
  await capture('archive-unread');
  await list.getByRole('button', {name: '显示全部邮件'}).press('Enter');
  await awaitRows(2);
  assert.equal(await evaluate('document.activeElement.matches(".pr-unread-filter input")'), true);
  pass('Archive reader return and keyboard filter recovery preserve focus');

  await evaluate('archiveProbe.fail = true; archiveProbe.refresh()');
  await readError.waitFor();
  assert.ok(await rows.first().isDisabled());
  assert.equal(await main.locator('.pr-list-caption').count(), 0);
  await capture('archive-failed');
  await evaluate(`document.querySelector('.pr-archive-read-error button').addEventListener('click', () => {
    archiveProbe.fail = false;
  }, {capture: true, once: true})`);
  await readError.getByRole('button', {name: '重新读取'}).press('Enter');
  await awaitRows(2);
  assert.equal(await evaluate('document.activeElement.matches(".pr-search-input")'), true);
  pass('Failed Archive read protects cached rows and keyboard retry restores them');

  const fixtureId = 'same-message@example.test';
  const lookup = (options = {}) => truth(1, fixtureId, {placements: true, ...options});
  const inboxPlacements = copies => copies.filter(item => item.folder === 'INBOX').sort((a, b) => a.uid - b.uid);
  const beforeCopies = await lookup({addCopyFrom: 'Archive'});
  const [original] = inboxPlacements(beforeCopies);
  assert.ok(original && beforeCopies.some(item => item.folder === 'Archive'));
  const awaitInboxPlacements = (count, unreadUID) => until(() => evaluate(`(async () => {
    const db = require('mailspring-exports').DatabaseStore;
    const copies = await db._query(
      'SELECT mf.remoteUID, mf.unread FROM MessageFolder mf JOIN Message m ON m.id=mf.messageId ' +
      'JOIN Folder f ON f.id=mf.folderId WHERE m.accountId=? AND m.headerMessageId=? AND f.path=?',
      ${JSON.stringify([accounts[1].id, fixtureId, 'INBOX'])});
    return copies.length === ${count} && (${JSON.stringify(unreadUID ?? null)} === null ||
      copies.some(copy => copy.remoteUID === ${JSON.stringify(unreadUID ?? null)} && copy.unread === 1));
  })()`), 'ordinary IMAP placement state synced');
  await awaitInboxPlacements(1);
  if (phase.endsWith('source-epoch')) {
    const source = beforeCopies.find(item => item.folder === 'Archive');
    await lookup({rebuildArchive: true});
    await selectAll.check();
    await main.locator('[data-mail-action=inbox]').press('Enter');
    const status = await restoreSettles();
    const replacement = await truth(1, 'archive-source-replacement@example.test', {placements: true});
    assert.deepEqual(replacement, [{
      folder: 'Archive', labels: [], uid: source.uid, flags: ['\\Flagged'], uidValidity: source.uidValidity + 1,
    }], 'restore must leave the replacement message and its flags in the new Archive generation');
    assert.deepEqual(inboxPlacements(await lookup()), [original], 'restore must preserve the existing Inbox copy');
    assert.ok(status.includes('1 项未完成'), 'the stale source copy must be reported as incomplete');
    pass('Archive restore rejected the changed source generation and preserved both unrelated copies');
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({
      sourceGenerationMismatch: true, replacementUntouched: true, incompleteReported: true, smtpSubmissions: 0,
    }, null, 2) + '\n');
    return;
  }
  if (phase === 'source-missing') {
    const accountId = JSON.stringify(accounts[1].id);
    await lookup({archiveBlocker: 'arm'});
    await evaluate(`(async () => {
      const {Actions, ChangeUnreadTask, DatabaseStore, Thread} = require('mailspring-exports');
      const [sent] = await DatabaseStore.findAll(Thread).where({
        accountId: ${accountId}, subject: 'Sent only',
      });
      Actions.queueTask(new ChangeUnreadTask({threads: [sent], unread: false}));
    })()`);
    await until(async () => (await lookup({archiveBlocker: 'state'})).held, 'foreground task held in Sent');
    await selectAll.check();
    await main.locator('[data-mail-action=inbox]').press('Enter');
    await until(() => evaluate(`require('mailspring-exports').DatabaseStore._query(
      "SELECT id FROM Task WHERE accountId=? AND status='remote' AND json_extract(data, '$.exactPlacementUndo')=1",
      [${accountId}]).then(rows => rows.length === 1)`), 'archive restore admitted before local UID reset');
    await lookup({archiveBlocker: 'reset'});
    const status = await restoreSettles();
    assert.deepEqual(await lookup(), beforeCopies, 'restore must leave both physical copies unchanged');
    assert.ok(status.includes('1 项未完成'), 'the missing local source copy must be reported as incomplete');
    assert.equal(await evaluate(`require('mailspring-exports').DatabaseStore._query(
      "SELECT mf.pendingFolderId FROM MessageFolder mf JOIN Message m ON m.id=mf.messageId " +
      "JOIN Folder f ON f.id=mf.folderId WHERE m.accountId=? AND m.headerMessageId=? AND f.path='Archive'",
      [${accountId}, ${JSON.stringify(fixtureId)}]).then(rows =>
        rows.length === 1 && rows[0].pendingFolderId === null)`), true,
      'the failed move clears its old pending destination');
    pass('Archive restore rejects the locally reset source after admission');
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({
      queuedSourceReset: true, serverCopiesPreserved: true, incompleteReported: true, markerCleared: true, smtpSubmissions: 0,
    }, null, 2) + '\n');
    return;
  }
  await selectAll.check();
  assert.equal(await main.locator('[data-mail-action=archive]').count(), 0);
  await main.locator('[data-mail-action=inbox]').press('Enter');
  await done('移回收件箱');
  await awaitRows(0);
  assert.ok((await truth(0)).some(item => item.labels.includes('\\Inbox')));
  assert.ok((await truth(1)).some(item => item.folder === 'INBOX'));
  assert.ok((await truth(1, 'sent-archive-sibling@example.test')).some(item => item.folder === 'Sent'));
  await verifyGmailSentSibling();
  await capture('archive-restored');
  const restoredCopies = inboxPlacements(await lookup());
  const restored = restoredCopies.find(item => item.uid !== original.uid);
  assert.equal(restoredCopies.length, 2);
  assert.ok(restored && restored.uidValidity === original.uidValidity);
  const changesDestinationEpoch = phase.startsWith('copy-epoch');
  if (!changesDestinationEpoch) await lookup({setUnreadUID: restored.uid});
  const crowded = inboxPlacements(await lookup({addCopyFrom: 'INBOX'}));
  await awaitInboxPlacements(3, changesDestinationEpoch ? undefined : restored.uid);
  const siblings = crowded.filter(item => item.uid !== restored.uid);
  if (phase === 'epoch') {
    const changed = inboxPlacements(await lookup({rollInboxValidity: true}));
    await receipt.getByRole('button', {name: '撤销'}).press('Enter');
    await until(async () => (await receipt.textContent()).includes('1 项未完成'), 'epoch mismatch is reported');
    assert.deepEqual(inboxPlacements(await lookup()), changed, 'new Inbox generation is left unchanged');
    pass('Undo rejects a changed Inbox UIDVALIDITY without moving any of its copies');
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({uidValidityGuard: true}, null, 2) + '\n');
    return;
  }
  if (phase.startsWith('copy-')) {
    const fault = phase.slice('copy-'.length);
    await lookup({armCopyFault: fault});
    await receipt.getByRole('button', {name: '撤销'}).press('Enter');
    const result = await until(async () => {
      const status = await receipt.textContent();
      return status.includes('撤销') && (status.includes('1 项未完成') || status.includes('2 / 2 完成')) && status;
    }, 'COPY fallback undo settles');
    if (fault === 'expunge') {
      const other = await truth(1, 'archive-other-deleted@example.test', {placements: true});
      assert.ok(other.some(item => item.folder === 'INBOX' && item.flags.includes('\\Deleted')),
        'targeted expunge failure must preserve unrelated deleted-marked mail');
    } else {
      const replacement = await truth(1, 'archive-new-epoch@example.test', {placements: true});
      assert.deepEqual(replacement[0]?.flags, ['\\Flagged'], 'the new generation copy must keep its flags');
      const expectedInbox = fault === 'epoch-commit' ? siblings : crowded;
      assert.deepEqual(inboxPlacements(await lookup()), expectedInbox,
        'the Inbox must reflect only confirmed targeted removal');
    }
    assert.ok(result.includes('1 项未完成'), 'the partially completed operation must be reported');
    pass('COPY failure preserves unrelated server copies and reports partial completion');
    fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({
      copyFault: fault, serverCopiesPreserved: true, partialReported: true,
    }, null, 2) + '\n');
    return;
  }
  await receipt.getByRole('button', {name: '撤销'}).press('Enter');
  await done('撤销');
  await awaitRows(2);
  assert.equal((await truth(0)).some(item => item.labels.includes('\\Inbox')), false);
  assert.ok((await truth(1)).some(item => item.folder === 'Archive'));
  const finalCopies = await lookup();
  assert.deepEqual(inboxPlacements(finalCopies), siblings, 'undo preserves both unrelated Inbox UIDs and flags');
  assert.deepEqual(finalCopies.find(item => item.folder === 'Archive')?.flags,
    restored.flags.filter(flag => flag !== '\\Seen'), 'the changed restored copy returns with its current flags');
  await verifyGmailSentSibling();
  pass('Keyboard restore and undo use only archived messages and placements');
  const request = {
    requestId: 'archive-fixture-cli-restoration',
    targets: accounts.map((account, index) => ({accountId: account.id, threadId: ids[index]})),
    fromArchive: true,
  };
  const response = await cli('restore-inbox', request);
  assert.equal(response.items.length, 2);
  for (const item of response.items) await complete(item);
  const conflict = await cli('restore-inbox', {...request, fromArchive: false}, true);
  assert.equal(conflict.items.length, 2);
  assert.ok(conflict.items.every(item => item.status === 'rejected' && item.error === 'request-conflict'));
  await awaitRows(0);
  assert.ok((await truth(1, 'sent-archive-sibling@example.test')).some(item => item.folder === 'Sent'));
  await verifyGmailSentSibling();
  for (const item of response.items) await undo(item);
  await awaitRows(2);
  assert.deepEqual(inboxPlacements(await lookup()), siblings, 'CLI undo preserves both unrelated Inbox UIDs and flags');
  pass('CLI scoped restore and undo match desktop, with request scope protected');
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({
    mixedArchive: true, cliParity: true, readerReturn: true, unreadRecovery: true,
    rejectedReadRecovery: true, scopedRestoreAndUndo: true, exactCopyUndo: true,
    cliScopedRestoreAndUndo: true, smtpSubmissions: 0,
  }, null, 2) + '\n');
};
