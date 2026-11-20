const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({main, cdp, evaluate, until, account, cli}) => {
  const phase = process.env.PAPER_REED_PINNED_PAGE_CHECK;
  const control = process.env.PAPER_REED_PINNED_CONTROL;
  const checks = name => !control || control === name;
  const output = process.env.PAPER_REED_UI_OUTPUT;
  const run = expression => evaluate(cdp, expression);
  const view = id => main.locator(`[data-mailbox=${id}]`).click();
  const list = main.locator('.pr-mail-list');
  const rows = list.locator('.pr-mail-row');
  const waitForRows = count => until(async () =>
    await rows.count() === count && await list.getAttribute('aria-busy') === 'false', 'mail count ' + count);
  const ids = () => run("Array.from(document.querySelectorAll('.pr-mail-row'), row => row.dataset.threadId)");
  const target = threadId => ({accountId: account.id, threadId});
  const localState = (...threads) => cli('local-state', {targets: threads.map(target)});
  const pin = (...threads) => cli('pin', {targets: threads.map(target)});
  const pinned = () => cli('local-list', {accountId: account.id, view: 'pinned', limit: 10});
  const unpinButton = id => list.locator(`[data-follow-up-id="${id}"] .pr-unpin`);
  const checkbox = id => list.locator(`[data-follow-up-id="${id}"] input[type=checkbox]`);
  const readonlyMail = () => run(`require('mailspring-exports').DatabaseStore._query(
    'SELECT id,unread,starred,data FROM Message WHERE draft=0 ORDER BY id')`);
  const capture = async (name, width = 900, height = 640) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const shot = await cdp.send('Page.captureScreenshot', {format: 'png', fromSurface: true});
    fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  fs.mkdirSync(output, {recursive: true});
  if (phase === 'pagination') {
    await until(() => run(`require('mailspring-exports').DatabaseStore._query('SELECT COUNT(*) AS count FROM Thread')
      .then(result => result[0].count === 52)`), 'native multi-page inbox');
    await waitForRows(50);
    const inbox = await cli('local-list', {accountId: account.id, folder: 'inbox', limit: 100});
    assert.equal(inbox.length, 52);
    for (let offset = 0; offset < inbox.length; offset += 40)
      await pin(...inbox.slice(offset, offset + 40).map(item => item.id));
    await view('pinned');
    await waitForRows(50);
    const [removed] = await ids();
    const [firstAdded] = await cli('local-list', {
      accountId: account.id, view: 'pinned', limit: 1, offset: 50,
    });
    assert(!(await ids()).includes(firstAdded.id));
    await run(`(() => {
      const {DatabaseStore} = require('mailspring-exports');
      const inbox = require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core/inbox');
      const query = inbox.queryInbox;
      inbox.queryInbox = async (request, access) => {
        if (request.localView === 'pinned' && request.limit > 51) {
          inbox.queryInbox = query;
          await DatabaseStore._localTransaction([{
            query: 'UPDATE PaperReedLocalThread SET pinned=0 WHERE accountId=? AND threadId=?',
            values: [${JSON.stringify(account.id)}, ${JSON.stringify(removed)}],
          }]);
        }
        return query(request, access);
      };
    })()`);
    const more = list.getByRole('button', {name: '加载更多'});
    await more.press('Enter');
    await waitForRows(51);
    assert(!(await ids()).includes(removed));
    assert(await run(`document.activeElement.dataset.threadId === ${JSON.stringify(firstAdded.id)}`),
      'pagination focuses the first new pin when an old pin is removed');
    await view('inbox');
    await view('pinned');
    await waitForRows(50);
    await main.getByRole('checkbox', {name: '选择当前列表'}).check();
    const refillCase = process.env.PAPER_REED_PINNED_REFILL_CASE;
    const returnsFromCompose = refillCase === 'compose-refill' || refillCase === 'compose-write';
    const compose = async () => {
      await main.locator('.pr-compose-button').click();
      await main.locator('.pr-editor .pr-composer').waitFor();
    };
    if (refillCase === 'date') {
      const snooze = main.locator('[data-local-panel=snooze]');
      await snooze.press('Enter');
      assert.equal(await snooze.getAttribute('aria-expanded'), 'true');
    }
    await run(`(() => {
      const inbox = require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core/inbox');
      const local = require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core/local-triage');
      const query = inbox.queryInbox;
      const change = local.changeLocalMail;
      const element = document.querySelector('.pr-workspace');
      let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))];
      while (fiber && !fiber.stateNode?.listReadScope) fiber = fiber.return;
      const workspace = fiber.stateNode;
      window.pinRefill = {gates: [], completed: 0, writes: 0, workspace};
      if (${JSON.stringify(refillCase === 'compose-write')}) {
        local.changeLocalMail = async (request, access) => {
          if (request.action === 'unpin') {
            await new Promise(resolve => { pinRefill.releaseWrite = resolve; });
            local.changeLocalMail = change;
          }
          return change(request, access);
        };
      }
      inbox.queryInbox = async (request, access) => {
        if (request.localView === 'pinned') {
          const ordinal = pinRefill.gates.length;
          await new Promise(resolve => pinRefill.gates.push(resolve));
          if (ordinal === 1 && ${JSON.stringify(refillCase === 'failed')})
            throw Error('fixture replacement read failure');
        }
        return query(request, access);
      };
      const refresh = workspace.refresh;
      workspace.refresh = async () => {
        const started = pinRefill.gates.length;
        const pending = refresh();
        const result = await pending;
        if (pinRefill.gates.length > started) pinRefill.completed++;
        return result;
      };
      const organize = inbox.organizeMail;
      inbox.organizeMail = async () => {
        pinRefill.writes++;
        return {items: []};
      };
      window.restorePinRefill = () => {
        inbox.queryInbox = query;
        inbox.organizeMail = organize;
      };
    })()`);
    await main.locator('[data-local-action=unpin]').press('Enter');
    if (refillCase === 'compose-write') {
      await until(() => run('typeof pinRefill.releaseWrite === "function"'), 'hold the unpin write');
      await compose();
      await run('pinRefill.releaseWrite()');
    }
    await until(() => run('pinRefill.gates.length >= 2'), 'hold the immediate and scheduled replacement reads');
    if (refillCase !== 'compose-write') {
      assert.equal(await list.locator('.pr-pinned-empty').count(), 0,
        'removing the displayed page cannot show empty while the remaining pins are loading');
      assert(await run("document.activeElement.matches('[data-local-action=unpin]')"));
    }
    await run('pinRefill.gates[0]()');
    await until(() => run('pinRefill.completed >= 1 && !pinRefill.workspace.state.busy'),
      'the superseded read returns while the latest is pending');
    if (refillCase === 'compose-refill') await compose();
    if (returnsFromCompose) {
      await main.keyboard.press('Meta+Alt+f');
      await main.locator('.pr-search-input').waitFor();
      assert(await run("document.activeElement.matches('.pr-search-input')"));
      assert.equal(await main.locator('[data-mailbox=pinned]').getAttribute('aria-current'), 'page');
      assert.equal(await rows.count(), 50);
    }
    if (refillCase !== 'focus') {
      await run("pinRefill.workspace.organize('archive')");
      assert.equal(await run('pinRefill.writes'), 0,
        'the old selection cannot send archive while the latest replacement is pending');
      const archive = main.locator('[data-mail-action=archive]');
      assert(await archive.isDisabled());
      assert.equal(await list.getAttribute('aria-busy'), 'true');
      if (refillCase === 'success') {
        await archive.press('Enter');
        assert.equal(await run('pinRefill.writes'), 0, 'Enter on the pending archive control cannot send a write');
        await main.locator('[data-local-action=unpin]').focus();
        await capture('pinned-refilling');
      }
    }
    assert.equal(await rows.count(), 50);
    if (refillCase === 'date') {
      await main.locator('.pr-local-panel input[type=datetime-local]').focus();
      assert(await run("document.activeElement.matches('input[type=datetime-local]')"));
    } else if (!returnsFromCompose) {
      await main.keyboard.press('Tab');
      assert(await run("document.activeElement.matches('[data-local-panel=snooze]')"));
    }
    if (refillCase === 'scope') {
      await view('inbox');
      await waitForRows(50);
      await main.locator('.pr-search-input').focus();
    }
    await run('restorePinRefill(); pinRefill.gates.slice(1).forEach(release => release())');
    await until(() => run('pinRefill.completed >= 2'), 'current replacement settled');
    if (refillCase === 'scope') {
      assert.equal(await main.locator('[data-mailbox=inbox]').getAttribute('aria-current'), 'page');
      assert(await run("document.activeElement.matches('.pr-search-input')"));
      assert.equal(await list.getAttribute('aria-busy'), 'false');
    } else if (refillCase === 'failed') {
      const error = main.getByRole('alert').filter({hasText: '邮件暂时无法读取'});
      await error.waitFor();
      assert(await rows.first().isDisabled());
      assert(await run("document.activeElement.matches('.pr-search-input')"));
      await error.getByRole('button', {name: '重新读取'}).press('Enter');
      await waitForRows(1);
    } else {
      await waitForRows(1);
      assert(await run(returnsFromCompose
        ? "document.activeElement.matches('.pr-search-input')"
        : "document.activeElement.matches('.pr-pinned-row .pr-mail-row')"),
        'replacement restores focus when the selected toolbar control is removed or retains search focus');
    }
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
      phase, nativeMail: true, refillCase: refillCase || 'success', paginationFocusAfterUnpin: true,
      replacementLocksOldSelection: refillCase !== 'focus', refilledPageKeepsFocus: true,
    }, null, 2) + '\n');
    return;
  }
  await waitForRows(8);
  const [first, second, third] = await ids();
  const providerState = await readonlyMail();
  await view('pinned');
  await waitForRows(0);
  await capture('pinned-empty');
  const returnToInbox = list.getByRole('button', {name: '返回收件箱'});
  if (phase !== 'before') {
    assert.equal(await returnToInbox.count(), 1, 'an empty pinned list offers a keyboard route to Inbox');
    await returnToInbox.focus();
  }
  await pin(first);
  await waitForRows(1);
  if (phase !== 'before') {
    assert(await run("document.activeElement.matches('.pr-pinned-row .pr-mail-row')"),
      'new mail receives focus when the focused empty action disappears');
  }
  await pin(second, third);
  await waitForRows(3);
  assert.deepEqual(await ids(), [first, second, third]);
  assert.deepEqual((await pinned()).map(item => item.id), [first, second, third]);
  await capture('pinned-desktop', 1440, 860);
  await capture('pinned-compact');
  await capture('pinned-narrow', 740, 700);
  if (phase === 'before') {
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({phase, nativeMail: true}, null, 2) + '\n');
    return;
  }
  assert(await run(`(() => {
    const pane = document.querySelector('.pr-main');
    const action = pane.querySelector('.pr-unpin').getBoundingClientRect();
    return pane.scrollWidth <= pane.clientWidth && action.right <= pane.getBoundingClientRect().right;
  })()`), 'unpin stays inside the narrow list');

  await checkbox(first).check();
  await checkbox(second).check();
  assert.equal(await main.locator('[data-local-action=unpin]').count(), 1, 'bulk unpin remains available');
  assert.equal(await main.locator('[data-mail-action=archive]').count(), 1, 'server actions remain available');
  if (checks('keyboard')) {
    const selection = main.getByRole('group', {name: '所选邮件操作'});
    await selection.getByRole('button', {name: '取消选择'}).press('Enter');
    assert.equal(await checkbox(first).isChecked(), false, 'Enter clears the selection');
    assert.equal(await checkbox(second).isChecked(), false);
    assert(await run("document.activeElement.matches('.pr-pinned-row .pr-mail-row')"),
      'clearing the selection returns keyboard focus to the list');
    await checkbox(first).check();
    await checkbox(second).check();
    const labelsTrigger = main.locator('[data-local-panel=labels]');
    await labelsTrigger.press('Space');
    assert.equal(await labelsTrigger.getAttribute('aria-expanded'), 'true', 'Space opens the label controls');
    await labelsTrigger.press('Escape');
    assert.equal(await labelsTrigger.getAttribute('aria-expanded'), 'false');
    const snoozeTrigger = main.locator('[data-local-panel=snooze]');
    await snoozeTrigger.press('Enter');
    assert.equal(await snoozeTrigger.getAttribute('aria-expanded'), 'true', 'Enter opens the snooze controls');
    await main.getByRole('button', {name: '3 小时后', exact: true}).press('Space');
    await until(() => run("document.activeElement.matches('[data-local-panel=snooze][aria-expanded=false]')"),
      'applying a preset closes the open panel and restores the trigger focus');
    const snoozed = await localState(first, second);
    assert(snoozed[first].snoozeUntil && snoozed[second].snoozeUntil);
    const clearSnooze = main.locator('[data-local-action=unsnooze]');
    await clearSnooze.waitFor();
    await until(async () => !(await clearSnooze.isDisabled()), 'end-snooze action is ready');
    await clearSnooze.press('Enter');
    await clearSnooze.waitFor({state: 'detached'});
    const restored = await localState(first, second);
    assert.equal(restored[first].snoozeUntil, null);
    assert.equal(restored[second].snoozeUntil, null);
  }
  if (checks('snapshot')) {
    await run(`(async () => {
      const {DatabaseStore} = require('mailspring-exports');
      const root = AppEnv.getLoadSettings().resourcePath;
      const local = require(root + '/src/services/mail-core/local-triage');
      const desktopAccess = require(root + '/src/services/mail-core/inbox').inboxDesktopAccess;
      const read = local.localStates;
      const first = ${JSON.stringify(first)};
      window.armPinSnapshot = desktop => {
        local.localStates = async (targets, access) => {
          if ((access === desktopAccess) === desktop && targets.some(item => item.threadId === first)) {
            local.localStates = read;
            await DatabaseStore._localTransaction([{
              query: 'UPDATE PaperReedLocalThread SET pinned=0 WHERE accountId=? AND threadId=?',
              values: [${JSON.stringify(account.id)}, first],
            }]);
          }
          return read(targets, access);
        };
      };
      armPinSnapshot(true);
      const element = document.querySelector('.pr-workspace');
      let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))];
      while (fiber && !fiber.stateNode?.listReadScope) fiber = fiber.return;
      await fiber.stateNode.refresh();
    })()`);
    assert.deepEqual(await ids(), [first, second, third]);
    assert.equal(await main.locator('[data-local-action=pin]').count(), 0,
      'stale local metadata cannot reverse the bulk pinned-page action');
    assert.equal(await list.locator(`[data-thread-id="${first}"] .pr-pin-mark`).count(), 1,
      'the pin marker agrees with the displayed page snapshot');
    assert(!(await pinned()).some(item => item.id === first), 'the injected external change reached storage');
    await pin(first);
    await run('armPinSnapshot(false)');
    const snapshot = await pinned();
    assert.equal(snapshot.find(item => item.id === first)?.local.pinned, true,
      'CLI pinned membership and flag come from the same snapshot');
    assert(!(await pinned()).some(item => item.id === first));
    await pin(first);
  }
  await run(`(() => {
    const root = AppEnv.getLoadSettings().resourcePath;
    const local = require(root + '/src/services/mail-core/local-triage');
    const inbox = require(root + '/src/services/mail-core/inbox');
    const change = local.changeLocalMail;
    const query = inbox.queryInbox;
    window.pinProbe = {writes: 0, writeFailure: true, readFailure: true};
    local.changeLocalMail = async (request, access) => {
      if (request.action === 'unpin') {
        pinProbe.writes++;
        if (pinProbe.delay) await new Promise(resolve => { pinProbe.release = resolve; });
        if (pinProbe.writeFailure) throw Error('fixture write failure');
      }
      return change(request, access);
    };
    inbox.queryInbox = async (request, access) => {
      if (request.localView === 'pinned' && pinProbe.readFailure) throw Error('fixture read failure');
      return query(request, access);
    };
  })()`);
  // A failed same-scope refresh leaves its rows visible but prevents acting on them.
  await pin(first);
  const readError = main.getByRole('alert').filter({hasText: '邮件暂时无法读取'});
  await readError.waitFor();
  assert.equal(await rows.count(), 3);
  assert.equal(await main.locator('.pr-list-caption').count(), 0);
  assert(await rows.first().isDisabled());
  assert(await unpinButton(first).isDisabled());
  await run(`document.querySelector('[data-follow-up-id="${first}"] .pr-unpin').click()`);
  assert.equal(await run('pinProbe.writes'), 0);
  await capture('pinned-read-failure');
  const retry = readError.getByRole('button', {name: '重新读取'});
  await retry.focus();
  await run(`document.activeElement.addEventListener('click', () => {
    pinProbe.readFailure = false;
  }, {capture: true, once: true})`);
  await retry.press('Enter');
  await until(async () => !(await unpinButton(first).isDisabled()), 'pin read retry');
  assert.equal(await run('document.activeElement.id'), 'pr-mail-search');
  assert(await checkbox(second).isChecked());
  await unpinButton(first).press('Enter');
  const writeError = main.getByRole('alert').filter({hasText: '未能取消置顶'});
  await writeError.waitFor();
  assert(await run("document.activeElement.matches('.pr-unpin')"));
  assert.deepEqual(await ids(), [first, second, third]);
  await capture('pinned-write-failure');

  await run('pinProbe.delay = true');
  await unpinButton(first).press('Enter');
  await until(() => run('typeof pinProbe.release === "function"'), 'pause local write');
  await view('inbox');
  await view('pinned');
  await waitForRows(3);
  await run('pinProbe.delay = false; pinProbe.release()');
  await until(async () => !(await unpinButton(first).isDisabled()), 'late write settled');
  assert.equal(await writeError.count(), 0, 'a previous visit cannot show its error in the current view');

  await run('pinProbe.writeFailure = false');
  await checkbox(first).check();
  await checkbox(second).check();
  await unpinButton(first).press('Enter');
  await waitForRows(2);
  assert.deepEqual(await ids(), [second, third]);
  assert.deepEqual((await pinned()).map(item => item.id), [second, third]);
  assert(await checkbox(second).isChecked(), 'a different selected mail remains checked');
  assert(await run(`document.activeElement.closest('[data-follow-up-id]')?.dataset.followUpId === ${JSON.stringify(second)}`));
  await main.getByRole('status').filter({hasText: '已取消置顶'}).waitFor();
  await capture('pinned-restored-focus');

  const bulkUnpin = main.locator('[data-local-action=unpin]');
  await pin(first);
  await waitForRows(3);
  await checkbox(first).check();
  await run('pinProbe.writeFailure = true');
  await unpinButton(second).press('Enter');
  await writeError.waitFor();
  await run('pinProbe.writeFailure = false');
  if (checks('partial')) {
    const failId = "'" + second.replace(/'/g, "''") + "'";
    const trigger = `CREATE TRIGGER reject_pinned_fixture BEFORE UPDATE OF pinned ON PaperReedLocalThread
      WHEN OLD.threadId=${failId} AND OLD.pinned=1 AND NEW.pinned=0
      BEGIN SELECT RAISE(ABORT, 'fixture partial unpin'); END`;
    const localSQL = query => run(`require('mailspring-exports').DatabaseStore._localTransaction(
      [{query: ${JSON.stringify(query)}}])`);
    await localSQL(trigger);
    await bulkUnpin.press('Enter');
    await waitForRows(2);
    assert.deepEqual(await ids(), [second, third]);
    const partial = main.getByRole('alert').filter({hasText: '1 / 2 完成'});
    assert.equal(await partial.count(), 1, 'partial failure stays visible after the selection changes');
    assert.equal(await writeError.count(), 0, 'bulk feedback replaces the previous single-row error');
    assert(await checkbox(second).isChecked(), 'the failed selection remains available for retry');
    assert(await run("document.activeElement.matches('[data-local-action=unpin]')"),
      'focus stays on the bulk action when a failed target can be retried');
    await capture('pinned-partial-failure');
    await localSQL('DROP TRIGGER reject_pinned_fixture');
  }
  await bulkUnpin.press('Enter');
  await waitForRows(1);
  assert.deepEqual(await ids(), [third]);
  assert.equal(await writeError.count(), 0, 'successful bulk retry clears the prior single-row error');
  assert.equal(await main.getByRole('alert').filter({hasText: '1 / 2 完成'}).count(), 0,
    'successful bulk retry clears the prior partial failure');
  assert(await run("document.activeElement.matches('.pr-pinned-row .pr-mail-row')"),
    'a removed bulk action leaves focus on the remaining mail');

  const unread = main.getByRole('checkbox', {name: '仅未读'});
  if (checks('keyboard')) {
    await checkbox(third).check();
    await main.locator('[data-mail-action=read]').press('Space');
  } else {
    await run(`require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core/inbox').organizeMail(
      {action: 'read', targets: [${JSON.stringify(target(third))}], requestId: 'pin-fixture-read'},
      require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core/inbox').inboxDesktopAccess)`);
  }
  await until(() => run(`require('mailspring-exports').DatabaseStore._query(
    'SELECT unread FROM Thread WHERE id=?', [${JSON.stringify(third)}]).then(result => result[0].unread === 0)`),
    'fixture is read');
  await unread.check();
  await waitForRows(0);
  await list.getByRole('status').filter({hasText: '暂无未读的置顶邮件'}).waitFor();
  await capture('pinned-unread-empty');
  await list.getByRole('button', {name: '显示全部邮件'}).press('Enter');
  await waitForRows(1);
  assert(await run("document.activeElement.matches('.pr-unread-filter input')"));
  await unpinButton(third).press('Enter');
  await waitForRows(0);
  assert(await run("document.activeElement.matches('.pr-pinned-empty button')"));
  assert.deepEqual(await pinned(), []);
  await returnToInbox.press('Enter');
  await waitForRows(8);
  assert(await run("document.activeElement.matches('.pr-search-input')"));
  // Mark-as-read initialized the unread-only case; pin and unpin never change remote star state.
  const native = await readonlyMail();
  assert.deepEqual(native.map(item => [item.id, item.starred]), providerState.map(item => [item.id, item.starred]));
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
    phase, nativeMail: true, orderedPins: true, emptyRecovery: true, selectionPreserved: true,
    readFailureProtectsList: true, writeFailureRetainsPin: true, staleVisitIgnored: true,
    singleAndBulkUnpin: true, unreadRecovery: true, providerStarUnchanged: true, narrowFits: true,
    pinnedSnapshot: checks('snapshot'), durablePartialFailure: checks('partial'), bulkSupersedesSingleError: true,
    nativeBulkKeys: checks('keyboard'),
  }, null, 2) + '\n');
};
