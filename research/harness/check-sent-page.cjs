const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({main, cdp, evaluate, until, account, secondAccount}) => {
  const phase = process.env.PAPER_REED_SENT_PAGE_CHECK;
  const baseline = phase === 'before';
  const output = process.env.PAPER_REED_UI_OUTPUT;
  const run = expression => evaluate(cdp, expression);
  const list = main.locator('.pr-mail-list');
  const search = main.locator('.pr-search-input');
  const unread = main.locator('.pr-unread-filter input');
  const sent = main.locator('[data-mailbox=sent]');
  const title = main.locator('.pr-main h1');
  const rows = list.locator('.pr-mail-row');
  const awaitRows = (count) => until(async () => await rows.count() === count &&
    await list.getAttribute('aria-busy') === 'false', `mail count ${count}`);
  const capture = async (name, width, height) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const shot = await cdp.send('Page.captureScreenshot', {format: 'png', fromSurface: true});
    fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  fs.mkdirSync(output, {recursive: true});
  await rows.first().waitFor();
  if (phase === 'removal-reader' || phase === 'removal-all') {
    const inReader = phase === 'removal-reader';
    const focusTarget = process.env.PAPER_REED_SENT_REMOVAL_FOCUS;
    const accounts = main.locator('#pr-account');
    const reader = main.locator('.pr-reader');
    await sent.click();
    await awaitRows(2);
    const threadIds = await run(`(() => {
      const {AccountStore, FocusedContentStore} = require('mailspring-exports');
      const root = document.querySelector('.pr-workspace');
      let fiber = root[Object.keys(root).find(key => key.startsWith('__reactFiber$'))];
      while (fiber && !fiber.stateNode?.refreshOperations) fiber = fiber.return;
      const ws = fiber.stateNode;
      const api = require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core/inbox');
      const [removed, remaining, inReader] = ${JSON.stringify([account.id, secondAccount.id, inReader])};
      const readPage = api.queryInboxPage;
      const probe = window.removalProbe = {calls: 0, fail: !inReader, failOld: false, holdOld: false};
      const oldGate = new Promise(resolve => { probe.releaseOld = resolve; });
      const newGate = new Promise(resolve => { probe.releaseNew = resolve; });
      api.queryInboxPage = async (input, access) => {
        if (input.folder === 'sent') {
          if (probe.holdOld && input.accountIds.includes(removed)) {
            const cached = await readPage(input, access);
            probe.oldWaiting = true;
            await oldGate;
            return cached;
          }
          if (probe.failOld && input.accountIds.includes(removed)) {
            throw new Error('fixture pre-removal read failure');
          }
          if (input.accountIds.length === 1 && input.accountIds[0] === remaining) {
            probe.calls++;
            await newGate;
            if (probe.fail) throw new Error('fixture remaining account read failure');
          }
        }
        return readPage(input, access);
      };
      probe.startOld = () => {
        probe.holdOld = true;
        probe.oldRead = ws.refresh();
      };
      probe.failBeforeRemoval = () => {
        probe.failOld = true;
        return ws.refresh();
      };
      probe.remove = () => {
        AccountStore._accounts = AccountStore._accounts.filter(item => item.id !== removed);
        AccountStore._caches = {};
        AccountStore._trigger();
      };
      probe.threadCleared = () => ws.state.route === 'list' && ws.state.selected === null &&
        !FocusedContentStore.focused('thread');
      probe.checked = () => ws.state.checked;
      return Object.fromEntries(ws.state.rows.map(row => [row.accountId, row.id]));
    })()`);
    assert.ok(threadIds[account.id] && threadIds[secondAccount.id], 'both accounts have a native Sent row');
    const removedRow = main.locator(`.pr-mail-row[data-thread-id="${threadIds[account.id]}"]`);
    const remainingRow = main.locator(`.pr-mail-row[data-thread-id="${threadIds[secondAccount.id]}"]`);
    const focusSelector = {
      back: '.pr-back',
      retry: '.pr-sent-read-error button',
      selection: '.pr-list-tools label:first-child input',
      bulk: '.pr-selection-actions button[data-mail-action=archive]',
      outside: '#pr-account',
      unread: '.pr-unread-filter input',
    }[focusTarget] || (inReader ? '.pr-reader' : `.pr-mail-row[data-thread-id="${threadIds[account.id]}"]`);
    if (inReader) {
      await accounts.selectOption(account.id);
      await awaitRows(1);
      await removedRow.press('Enter');
      await reader.locator('iframe[data-rendered-message-id]').first().waitFor();
    } else {
      await main.getByLabel('选择当前列表', {exact: true}).check();
      assert.deepEqual(new Set(await run('removalProbe.checked()')), new Set(Object.values(threadIds)));
      if (focusTarget === 'retry') {
        await run('removalProbe.failBeforeRemoval()');
        await main.locator(focusSelector).waitFor();
      }
      await run('removalProbe.startOld()');
      await until(() => run('removalProbe.oldWaiting'), 'old list read captured both accounts before removal');
    }
    await main.locator(focusSelector).focus();
    assert.equal(await run(`document.activeElement.matches(${JSON.stringify(focusSelector)})`), true,
      'intended element has focus before account removal');
    await run('removalProbe.remove()');
    if (inReader) {
      assert.equal(await reader.count(), 0, 'removing the reader account must leave the reader');
      assert.equal(await run('removalProbe.threadCleared()'), true, 'removed conversation selection and focus clear');
      assert.equal(await accounts.inputValue(), '');
    } else {
      assert.equal(await removedRow.count(), 0, 'removing an account must drop its cached Sent row immediately');
      assert.equal(await remainingRow.count(), 1, 'connected account cached rows are retained');
      assert.deepEqual(await run('removalProbe.checked()'), [threadIds[secondAccount.id]]);
    }
    assert.equal(await title.innerText(), '已发送');
    const preserveFocus = focusTarget === 'outside' || focusTarget === 'unread';
    const expectedFocus = preserveFocus ? focusSelector : '.pr-search-input';
    assert.equal(await run(`document.activeElement.matches(${JSON.stringify(expectedFocus)})`), true,
      preserveFocus ? 'focus stays on the surviving control' : 'focus returns to search');
    await until(() => run('removalProbe.calls > 0'), 'remaining Sent account read starts', 1500);
    await run('removalProbe.releaseNew()');
    if (!inReader) {
      const error = main.locator('.pr-sent-read-error');
      await error.waitFor();
      await run('(async () => { removalProbe.releaseOld(); await removalProbe.oldRead; })()');
      assert.equal(await removedRow.count(), 0, 'a late old read cannot restore the removed row');
      assert.equal(await remainingRow.isDisabled(), true, 'cached connected rows are disabled on failure');
      await capture('sent-removed-account-read-failed', 900, 640);
      await run(`document.querySelector('.pr-sent-read-error button').addEventListener('click', () => {
        removalProbe.fail = false;
      }, {capture: true, once: true})`);
      await error.getByRole('button', {name: '重新读取'}).press('Enter');
      await error.waitFor({state: 'hidden'});
    }
    await awaitRows(1);
    assert.equal(await remainingRow.isEnabled(), true);
    assert.equal(await removedRow.count(), 0);
    if (inReader) await capture('sent-removed-reader-return', 900, 640);
    const result = inReader ? {closedRemovedAccountReader: true, returnedToCurrentList: true} :
      {removedCachedRows: true, retainedConnectedRowsAfterFailure: true, discardedLateList: true, retried: true};
    if (focusTarget) Object.assign(result, {focusTarget, focusAfterRemoval: expectedFocus});
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
    return;
  }
  if (phase === 'removal') {
    const accounts = main.locator('#pr-account');
    const receipts = main.locator('.pr-send-results');
    const oldSubject = 'Removed account receipt';
    await accounts.selectOption(account.id);
    await until(async () => await rows.count() > 0 && await list.getAttribute('aria-busy') === 'false',
      'selected account has cached Inbox rows');
    await run(`(() => {
      const {AccountStore, DatabaseStore: db} = require('mailspring-exports');
      const query = db._query.bind(db);
      const api = require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core/inbox');
      const readInbox = api.queryInbox;
      const [removed, remaining, subject] = ${JSON.stringify([account.id, secondAccount.id, oldSubject])};
      const root = document.querySelector('.pr-workspace');
      let fiber = root[Object.keys(root).find(key => key.startsWith('__reactFiber$'))];
      while (fiber && !fiber.stateNode?.refreshOperations) fiber = fiber.return;
      const ws = fiber.stateNode;
      const probe = window.removalProbe = {receiptCalls: 0, listCalls: 0, holdOld: false};
      const oldGate = new Promise(resolve => { probe.releaseOld = resolve; });
      const newGate = new Promise(resolve => { probe.releaseNew = resolve; });
      db._query = async (sql, params, ...options) => {
        if (!sql.includes('FROM PaperReedSend')) return query(sql, params, ...options);
        if (params.length === 1 && params[0] === removed) {
          if (probe.holdOld) {
            await oldGate;
            return [{accountId: removed, requestId: 'fixture-late', phase: 'accepted',
              sentCopy: 'filed', payload: JSON.stringify({draft: {subject: 'Late removed account receipt'}})}];
          }
          return [{accountId: removed, requestId: 'fixture-old', phase: 'accepted',
            sentCopy: 'filed', payload: JSON.stringify({draft: {subject}})}];
        }
        if (params.length === 1 && params[0] === remaining) {
          probe.receiptCalls++;
          await newGate;
        }
        return query(sql, params, ...options);
      };
      api.queryInbox = async (input, access) => {
        if (input.accountIds.length === 1 && input.accountIds[0] === remaining) {
          probe.listCalls++;
          await newGate;
        }
        return readInbox(input, access);
      };
      probe.remove = () => {
        probe.holdOld = true;
        probe.staleRead = ws.refreshOperations();
        // Publish the fixture account change before the removed account's cache is cleared.
        AccountStore._accounts = AccountStore._accounts.filter(item => item.id !== removed);
        AccountStore._caches = {};
        AccountStore._trigger();
      };
      probe.readSettled = () => ws.state.operationsRead?.scope === JSON.stringify([remaining]) &&
        !ws.state.operationsRead.failed;
      return ws.refreshOperations();
    })()`);
    assert.match(await receipts.textContent(), new RegExp(oldSubject));
    await rows.first().focus();
    await run('removalProbe.remove()');
    assert.equal(await receipts.count(), 0, 'removing the selected account must hide its send receipts immediately');
    assert.equal(await accounts.inputValue(), '', 'the account selector returns to All Accounts');
    assert.equal(await rows.count(), 0, 'cached rows from the removed account are cleared');
    assert.equal(await list.getAttribute('aria-busy'), 'true');
    await until(() => run('removalProbe.receiptCalls > 0 && removalProbe.listCalls > 0'),
      'read the list and send receipts for the remaining account immediately', 1500);
    await capture('sent-account-removed', 900, 640);
    await run('(async () => { removalProbe.releaseOld(); await removalProbe.staleRead; removalProbe.releaseNew(); })()');
    await until(() => run('removalProbe.readSettled()'), 'remaining account receipt read settles');
    await until(async () => await list.getAttribute('aria-busy') === 'false', 'remaining account list settles');
    assert.equal(await receipts.count(), 0, 'an in-flight read cannot restore a removed account receipt');
    fs.writeFileSync(path.join(output, 'result.json'),
      JSON.stringify({removedAccountFallsBack: true, staleReceiptDiscarded: true}, null, 2) + '\n');
    return;
  }
  if (phase === 'scope') {
    const accounts = main.locator('#pr-account');
    const error = main.getByText('发送结果暂时无法读取。', {exact: true});
    await sent.click();
    await accounts.selectOption(account.id);
    await run(`(() => {
      const db = require('mailspring-exports').DatabaseStore;
      const query = db._query.bind(db);
      const root = document.querySelector('.pr-workspace');
      let fiber = root[Object.keys(root).find(key => key.startsWith('__reactFiber$'))];
      while (fiber && !fiber.stateNode?.refreshOperations) fiber = fiber.return;
      window.sentWorkspace = fiber.stateNode;
      window.operationsProbe = {calls: 0};
      operationsProbe.gate = new Promise(resolve => { operationsProbe.release = resolve; });
      db._query = async (sql, params, ...options) => {
        if (sql.includes('FROM PaperReedSend')) {
          if (params[0] === ${JSON.stringify(account.id)}) throw new Error('fixture operations read failure');
          if (params[0] === ${JSON.stringify(secondAccount.id)}) {
            operationsProbe.calls++;
            await operationsProbe.gate;
          }
        }
        return query(sql, params, ...options);
      };
      return sentWorkspace.refreshOperations();
    })()`);
    await error.waitFor();
    await accounts.selectOption(secondAccount.id);
    await until(() => run(`sentWorkspace.state.accountId === ${JSON.stringify(secondAccount.id)}`), 'selected new account');
    assert.equal(await error.count(), 0, 'no old-account errors during the new read');
    await until(() => run('operationsProbe.calls > 0'), 'new account reads its operations immediately', 1500);
    await capture('sent-account-pending', 900, 640);
    await run('operationsProbe.release()');
    await until(() => run('sentWorkspace.state.operationsRead?.failed === false'), 'new operations read settles');
    assert.equal(await error.count(), 0);
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({accountScopedOperations: true}, null, 2) + '\n');
    return;
  }
  if (!baseline) {
    await run(`(() => {
      const api = require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core/inbox');
      const hook = query => async (input, access) => {
        if (input.folder === 'sent') {
          if (sentProbe.fail) throw new Error('fixture reading failure');
          if (sentProbe.gate) {
            sentProbe.waiting = true;
            await sentProbe.gate;
          }
        }
        return query(input, access);
      };
      window.sentProbe = {fail: true};
      api.queryInbox = hook(api.queryInbox);
      api.queryInboxPage = hook(api.queryInboxPage);
    })()`);
  }
  await sent.click();
  if (!baseline) {
    const readError = main.locator('.pr-sent-read-error');
    await readError.waitFor();
    assert.equal(await rows.count(), 0);
    await run(`document.querySelector('.pr-sent-read-error button').addEventListener('click', () => {
      sentProbe.fail = false;
      sentProbe.gate = new Promise(resolve => { sentProbe.release = resolve; });
    }, {once: true, capture: true})`);
    await readError.getByRole('button', {name: '重新读取'}).press('Enter');
    await until(() => run('sentProbe.waiting'), 'retry remains in flight');
    assert.equal(await list.getAttribute('aria-busy'), 'true');
    await list.getByText('正在读取已发送邮件…', {exact:true}).waitFor({timeout:3000});
    await capture('sent-empty-retrying', 900, 640);
    await run('sentProbe.release(); sentProbe.gate = null;');
  }
  await awaitRows(0);
  if (!baseline) {
    assert.equal(await list.getByText('本机暂无已发送邮件', {exact: true}).count(), 1);
    assert.equal(await list.getByRole('button', {name: '写邮件', exact: true}).count(), 1);
  }
  await capture('sent-empty', 900, 640);

  await main.locator('[data-mailbox=inbox]').click();
  await search.fill('Project kickoff');
  await search.press('Enter');
  await awaitRows(1);
  await unread.check();
  await awaitRows(0);
  await main.locator('.pr-compose-button').click();
  const editor = main.locator('.pr-editor [contenteditable=true]');
  await editor.waitFor();
  const to = main.locator('.pr-editor .to-field input[role=combobox]');
  for (const address of ['avery@example.test', 'sam@example.test']) {
    await to.fill(address);
    await to.press('Enter');
  }
  const subject = main.locator('.pr-subject-heading textarea');
  await subject.fill('Paper Reed outgoing list');
  await editor.click();
  await main.keyboard.insertText('The outgoing body is the preview used in Sent.');
  await until(async () => (await main.locator('.pr-editor').innerText()).includes('已保存到本机'), 'saved draft');
  await main.locator('.btn-send .primary-item').click();
  await until(async () => (await main.locator('.pr-send-results').innerText()).includes('服务器已接受'), 'accepted send', 45000);
  await list.waitFor();
  if (baseline) {
    const filterSurvived = (await title.innerText()) === '搜索结果';
    assert.equal(filterSurvived, true);
    await capture('sent-delivery', 900, 640);
    await sent.click();
    await unread.uncheck();
  } else {
    assert.equal(await title.innerText(), '已发送');
    assert.equal(await main.locator('#pr-account').inputValue(), account.id);
    assert.equal(await search.inputValue(), '');
    assert.equal(await unread.isChecked(), false);
    assert.equal(await run('document.activeElement === document.querySelector(".pr-search-input")'), true);
  }
  await awaitRows(1);
  const outgoing = rows.filter({hasText: 'Paper Reed outgoing list'});
  assert.equal(await outgoing.count(), 1);
  if (!baseline) {
    assert.match(await outgoing.locator('.pr-sent-recipient-names').innerText(), /^发给 avery.*、sam/i);
    assert.equal(await outgoing.locator('.pr-sent-recipient-count').innerText(), '2 人');
    assert.match(await outgoing.locator('.pr-snippet').innerText(), /The outgoing body/);
    assert.match(await outgoing.getAttribute('aria-label'), /发给/);
    await capture('sent-delivery', 900, 640);
  }
  await capture('sent-desktop', 1440, 860);
  await capture('sent-narrow', 740, 700);
  if (!baseline) {
    assert(await run('document.querySelector(".pr-main").scrollWidth <= document.querySelector(".pr-main").clientWidth'));
    await outgoing.press('Enter');
    const back = main.getByRole('button', {name: '‹ 返回已发送', exact: true});
    await back.waitFor();
    await back.press('Enter');
    await awaitRows(1);
    assert.equal(await run('document.activeElement?.dataset.threadId'), await outgoing.getAttribute('data-thread-id'));
    await unread.check();
    await awaitRows(0);
    await capture('sent-unread', 900, 640);
    await list.getByRole('button', {name: '显示全部邮件'}).press('Enter');
    await awaitRows(1);
    assert(await run('document.activeElement.matches(".pr-unread-filter input")'));

    await run(`(() => {
      sentProbe.fail = true;
      const root = document.querySelector('.pr-workspace');
      let fiber = root[Object.keys(root).find(key => key.startsWith('__reactFiber$'))];
      while (fiber && !fiber.stateNode?.listReadScope) fiber = fiber.return;
      return fiber.stateNode.refresh();
    })()`);
    const readError = main.locator('.pr-sent-read-error');
    await readError.waitFor();
    assert.match(await readError.innerText(), /已发送邮件暂时无法读取/);
    assert.equal(await outgoing.isDisabled(), true);
    await capture('sent-read-failed', 900, 640);
    await run(`document.querySelector('.pr-sent-read-error button').addEventListener('click', () => {
      sentProbe.fail = false;
    }, {once: true, capture: true})`);
    await readError.getByRole('button', {name: '重新读取'}).press('Enter');
    await awaitRows(1);
    assert.equal(await outgoing.isEnabled(), true);
  }
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
    baseline, sentScopeReset: !baseline, outgoingRecipients: !baseline,
    returnFocus: !baseline, unreadRecovery: !baseline, readRecovery: !baseline, emptyRetryProgress: !baseline,
  }, null, 2) + '\n');
};
