const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ main, cdp, evaluate, until, account, cli }) => {
  const phase = process.env.PAPER_REED_SNOOZE_PAGE_CHECK;
  const control = process.env.PAPER_REED_SNOOZE_CONTROL_CASE;
  const check = name => phase === 'after' || control === name;
  const output = process.env.PAPER_REED_UI_OUTPUT;
  const run = expression => evaluate(cdp, expression);
  const rows = main.locator('.pr-mail-row');
  const view = mailbox => main.locator(`[data-mailbox=${mailbox}]`).click();
  const waitForRows = count => until(async () => (await rows.count()) === count, 'mail count ' + count);
  const ids = () => run(`Array.from(document.querySelectorAll('.pr-mail-row'), row => row.dataset.threadId)`);
  const target = threadId => ({ accountId: account.id, threadId });
  const snooze = (threadId, at) => cli('snooze', { targets: [target(threadId)], until: at.toISOString() });
  const scheduled = (limit = 50, offset = 0) => cli('local-list', { accountId: account.id, view: 'snoozed', limit, offset });
  const end = id => main.locator(`.pr-end-snooze[data-snooze-id="${id}"]`);
  const resize = (width, height) => cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false,
  });
  const capture = async (name, width = 900, height = 640) => {
    await resize(width, height);
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  fs.mkdirSync(output, { recursive: true });
  if (phase === 'pagination') {
    const total = Number(process.env.PAPER_REED_SNOOZE_FIXTURE_COUNT || 51);
    const expireFirst = total === 52 || total === 102;
    const remaining = total - Number(expireFirst);
    await until(() => run(`require('mailspring-exports').DatabaseStore._query('SELECT COUNT(*) AS count FROM Thread')
      .then(result => result[0].count === ${total})`), 'native multi-page inbox');
    const list = offset => cli('local-list', { accountId: account.id, folder: 'inbox', limit: 100, offset });
    const inbox = (await list(0)).concat(total > 100 ? await list(100) : []);
    assert.equal(inbox.length, total);
    const untilTime = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    for (let offset = 0; offset < total; offset += 40) {
      await cli('snooze', { targets: inbox.slice(offset, offset + 40).map(row => target(row.id)), until: untilTime });
    }
    await view('snoozed');
    await waitForRows(50);
    const more = main.locator('.pr-load-more');
    if (control !== 'loadMore') {
      await more.focus();
      await run("AppEnv.commands.dispatch('navigation:go-to-inbox'); true");
      await main.getByRole('heading', { name: '收件箱', exact: true }).waitFor();
      assert(await run("document.activeElement.id === 'pr-mail-search'"),
        'navigating from a focused pagination control leaves focus on search');
      await view('snoozed');
      await waitForRows(50);
    }
    const [firstAdded] = await scheduled(1, 50);
    const visible = await ids();
    const firstVisible = visible[0];
    assert(!visible.includes(firstAdded.id));
    if (expireFirst) {
      await run(`(() => {
        const { DatabaseStore } = require('mailspring-exports');
        const inbox = require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core/inbox');
        const query = inbox.queryInboxPage;
        window.snoozeExpiredBeforePageRead = false;
        inbox.queryInboxPage = async (request, access) => {
          if (request.localView === 'snoozed' && request.limit > 51) {
            inbox.queryInboxPage = query;
            await DatabaseStore._localTransaction([{
              query: 'UPDATE PaperReedLocalThread SET snoozeUntil=? WHERE accountId=? AND threadId=?',
              values: [Date.now() - 1000, ${JSON.stringify(account.id)}, ${JSON.stringify(firstVisible)}],
            }]);
            window.snoozeExpiredBeforePageRead = true;
          }
          return query(request, access);
        };
      })()`);
    }
    await more.focus();
    if (control === 'loadMore') await more.click();
    else await more.press('Enter');
    await waitForRows(Math.min(100, remaining));
    if (expireFirst) {
      assert(await run('snoozeExpiredBeforePageRead'), 'the first reminder expired before reading the expanded page');
      assert(!(await ids()).includes(firstVisible), 'the expired reminder is no longer visible');
    }
    assert(await run(`document.activeElement.dataset.threadId === ${JSON.stringify(firstAdded.id)}`),
      'pagination moves focus to the first newly loaded reminder');
    if (remaining > 100) {
      assert(await more.isDisabled());
      assert.match(await more.innerText(), /已显示 100 个会话/);
    } else {
      assert.equal(await more.count(), 0);
    }
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
      phase, nativeMail: true, total, expiredBeforePageRead: expireFirst, paginationFocus: true,
      navigationFocus: control !== 'loadMore',
    }, null, 2) + '\n');
    return;
  }
  await waitForRows(8);
  const [latest, middle, earliest, short] = await ids();
  const inbox = await ids();
  await view('snoozed');
  await main.locator('.pr-mail-list[aria-busy=false]').waitFor();
  await capture('snooze-empty');
  if (check('emptyFocus')) {
    await main.getByRole('button', { name: '返回收件箱' }).focus();
  }
  if (phase === 'after') {
    await main.getByRole('status').filter({ hasText: '暂无稍后邮件' }).waitFor();
    assert.equal(await main.locator('.pr-list-tools input').count(), 1, 'only the unread filter remains');
  }

  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 5, 0, 0);
  const afternoon = new Date(tomorrow);
  afternoon.setHours(15, 40);
  const following = new Date(tomorrow);
  following.setDate(following.getDate() + 1);
  await snooze(latest, following);
  if (check('emptyFocus')) {
    await waitForRows(1);
    assert(await run("document.activeElement.matches('.pr-snooze-row .pr-mail-row')"),
      'the first reminder receives focus when a focused empty action is removed');
  }
  await snooze(middle, afternoon);
  await snooze(earliest, tomorrow);
  await cli('pin', { targets: [target(latest)] });
  await waitForRows(3);
  await main.locator(`.pr-mail-row[data-thread-id="${latest}"] .pr-pin-mark`).waitFor();
  await capture('snooze-ordered', 1440, 860);
  await capture('snooze-ordered-compact');
  await capture('snooze-ordered-narrow', 740, 700);
  if (phase !== 'before') {
    assert.deepEqual(await ids(), [earliest, middle, latest], 'snoozes are ordered by reminder time, not received time or pin');
    assert.equal((await scheduled(1))[0].id, earliest, 'the earliest reminder survives pagination');
    assert.deepEqual((await scheduled()).map(row => row.id), [earliest, middle, latest]);
  }
  if (check('navigationFocus')) {
    await end(earliest).focus();
    await run("AppEnv.commands.dispatch('navigation:go-to-inbox'); true");
    await waitForRows(5);
    assert(await run("document.activeElement.id === 'pr-mail-search'"),
      'switching from a focused restore action preserves keyboard focus');
    await view('snoozed');
    await waitForRows(3);
  }
  if (check('paletteFocus')) {
    await end(earliest).focus();
    await main.keyboard.press('Meta+Shift+p');
    const command = main.getByRole('textbox', { name: '查找命令' });
    await command.fill('前往收件箱');
    await command.press('Enter');
    await waitForRows(5);
    assert(await run("document.activeElement.id === 'pr-mail-search'"),
      'command palette navigation preserves focus after removing the restore action');
    await view('snoozed');
    await waitForRows(3);
  }
  if (check('reminderLabel')) {
    assert.equal(await main.getByRole('button', { name: /提醒 15:40/ }).count(), 1,
      'the mail button exposes the local reminder time to assistive technology');
  }
  if (check('expirySnapshot')) {
    await run(`(() => {
      const local = require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core/local-triage');
      const states = local.localStates;
      window.interposeExpiry = 1;
      window.expiryObserved = 0;
      local.localStates = async (targets, access) => {
        const result = await states(targets, access);
        if (targets.length === window.interposeExpiry && result[${JSON.stringify(earliest)}]) {
          window.interposeExpiry = 0;
          window.expiryObserved++;
          result[${JSON.stringify(earliest)}].snoozeUntil = null;
        }
        return result;
      };
      window.restoreLocalStateRead = () => { local.localStates = states; };
    })()`);
    const [snapshot] = await scheduled(1);
    assert.equal(await run('expiryObserved'), 1, 'interposed expiry during the CLI metadata read');
    assert.equal(snapshot.id, earliest);
    assert.equal(snapshot.local.snoozeUntil, tomorrow.getTime(),
      'CLI returns the reminder time from the same page snapshot as membership');
    await run('interposeExpiry = 3');
    await view('snoozed');
    await waitForRows(3);
    assert.equal(await run('expiryObserved'), 2, 'interposed expiry during the desktop metadata read');
    assert.equal(await main.locator('.pr-snooze-row time').first().getAttribute('datetime'), tomorrow.toISOString());
    await run('restoreLocalStateRead()');
  }
  if (check('bulkControls')) {
    const checkbox = id => main.locator(`.pr-snooze-row[data-snooze-id="${id}"] .pr-mail-item input`);
    assert.equal(await main.locator('.pr-snooze-row input[type=checkbox]').count(), 3,
      'grouped reminders keep their original selection controls');
    await main.locator(`.pr-mail-row[data-thread-id="${earliest}"]`).focus();
    await run("AppEnv.commands.dispatch('core:select-item'); true");
    await until(() => checkbox(earliest).isChecked(), 'keyboard selects a reminder');
    await checkbox(middle).check();
    const bulk = main.getByRole('group', { name: '所选邮件操作' });
    assert(await bulk.getByRole('button', { name: '归档' }).isEnabled());
    assert(await bulk.getByRole('button', { name: '标为已读' }).isEnabled());
    await main.locator('.pr-local-controls [data-local-action=pin]').click();
    await until(async () => (await scheduled()).slice(0, 2).every(row => row.local.pinned), 'bulk local pin persists');
    assert.deepEqual(await ids(), [earliest, middle, latest], 'pinning does not reorder reminders');
    await view('snoozed');
    await waitForRows(3);
  }
  if (check('feedbackClears')) {
    await run(`(() => {
      const local = require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core/local-triage');
      const change = local.changeLocalMail;
      local.changeLocalMail = async (request, access) => {
        if (request.action !== 'unsnooze') return change(request, access);
        if (window.deferSnoozeFailure) await new Promise(resolve => { window.finishSnooze = resolve; });
        throw Error('测试写入失败');
      };
      window.restoreSnoozeWriter = () => { local.changeLocalMail = change; };
    })()`);
    const error = main.getByRole('alert').filter({ hasText: '未能结束稍后' });
    await end(earliest).press('Enter');
    await error.waitFor();
    await view('inbox');
    await waitForRows(5);
    await view('snoozed');
    await waitForRows(3);
    assert.equal(await error.count(), 0, 'returning to a snoozed view does not reannounce an old failure');

    await end(earliest).press('Enter');
    await error.waitFor();
    await main.locator(`.pr-mail-row[data-thread-id="${earliest}"]`).click();
    await main.locator('.pr-reader').waitFor();
    await main.locator('.pr-back').click();
    await waitForRows(3);
    assert.equal(await error.count(), 0, 'returning from the reader starts with fresh feedback');

    await run('window.deferSnoozeFailure = true');
    await end(earliest).press('Enter');
    await until(() => run('!!window.finishSnooze'), 'the restore is waiting');
    await view('inbox');
    await waitForRows(5);
    await view('snoozed');
    await waitForRows(3);
    await run('window.finishSnooze()');
    await until(() => end(earliest).isEnabled(), 'the delayed restore has finished');
    assert.equal(await error.count(), 0, 'a late failure from an earlier visit stays off the current list');
    await run('window.restoreSnoozeWriter()');
  }
  if (phase === 'after') {
    assert.deepEqual(await run(`Array.from(document.querySelectorAll('.pr-snooze-day'),
      group => group.querySelectorAll('.pr-mail-row').length)`), [2, 1]);
    assert.deepEqual(await run(`Array.from(document.querySelectorAll('.pr-snooze-row time'),
      time => [time.dateTime, time.innerText])`), [
      [tomorrow.toISOString(), '09:05'], [afternoon.toISOString(), '15:40'], [following.toISOString(), '09:05'],
    ]);
    assert.equal(await main.locator('.pr-mail-item input').count(), 3);
    assert.equal(await main.locator('.pr-end-snooze').count(), 3);
    assert(await run(`(() => {
      const pane = document.querySelector('.pr-main');
      const action = pane.querySelector('.pr-end-snooze').getBoundingClientRect();
      return pane.scrollWidth <= pane.clientWidth && action.right <= pane.getBoundingClientRect().right;
    })()`), 'the action fits at 740px');

    await run(`(() => {
      const root = AppEnv.getLoadSettings().resourcePath;
      const local = require(root + '/src/services/mail-core/local-triage');
      const inbox = require(root + '/src/services/mail-core/inbox');
      const change = local.changeLocalMail;
      const read = inbox.queryInboxPage ? 'queryInboxPage' : 'queryInbox';
      const query = inbox[read];
      window.snoozeProbe = { calls: [], reject: false, readFails: true };
      local.changeLocalMail = async (request, access) => {
        snoozeProbe.calls.push(request);
        if (snoozeProbe.reject) throw Error('测试写入失败');
        return change(request, access);
      };
      inbox[read] = async (request, access) => {
        if (request.localView === 'snoozed' && snoozeProbe.readFails) throw Error('测试读取失败');
        return query(request, access);
      };
    })()`);
    const unread = main.getByRole('checkbox', { name: '仅未读' });
    await unread.check();
    const readError = main.getByRole('alert').filter({ hasText: '邮件暂时无法读取' });
    await readError.waitFor();
    assert.deepEqual(await ids(), [earliest, middle, latest]);
    assert.equal(await main.locator('.pr-list-caption').count(), 0);
    assert(await end(earliest).isDisabled());
    await capture('snooze-read-failed');
    await run('snoozeProbe.readFails = false');
    await main.locator('.pr-search-input').focus();
    await main.keyboard.press('Tab');
    assert(await run("document.activeElement.matches('.pr-notice button')"));
    await main.keyboard.press('Enter');
    const showAll = main.getByRole('button', { name: '显示全部邮件' });
    await showAll.waitFor();
    await capture('snooze-unread-empty');
    await showAll.focus();
    await showAll.press('Enter');
    await waitForRows(3);
    assert(await run("document.activeElement.matches('.pr-unread-filter input')"));

    await run('snoozeProbe.reject = true');
    await end(earliest).focus();
    await end(earliest).press('Enter');
    await main.getByRole('alert').filter({ hasText: '未能结束稍后' }).waitFor();
    assert.deepEqual(await ids(), [earliest, middle, latest], 'failed restore preserves the schedule');
    assert(await run("document.activeElement.matches('.pr-end-snooze')"));
    await capture('snooze-restore-failed');
    await run('snoozeProbe.reject = false');
    await end(earliest).press('Enter');
    await waitForRows(2);
    assert.deepEqual(await run('snoozeProbe.calls.map(call => call.targets)'), [[target(earliest)], [target(earliest)]]);
    await until(() => run(`document.activeElement.dataset.snoozeId === ${JSON.stringify(middle)}`), 'next restore button has focus');
    assert.deepEqual(await ids(), [middle, latest]);
    await end(middle).press('Enter');
    await waitForRows(1);
    await end(latest).focus();
    await end(latest).press('Enter');
    const back = main.getByRole('button', { name: '返回收件箱' });
    await back.waitFor();
    await until(() => run("document.activeElement.matches('.pr-snooze-empty button')"), 'empty-state action has focus');
    await back.press('Enter');
    await waitForRows(8);
    await until(() => run("document.activeElement.id === 'pr-mail-search'"), 'return to Inbox keeps a keyboard destination');
    assert.deepEqual(new Set(await ids()), new Set(inbox));
    assert.equal((await scheduled()).length, 0);

    await snooze(short, new Date(Date.now() + 3500));
    await view('snoozed');
    await waitForRows(1);
    await main.locator('.pr-snooze-row input[type=checkbox]').first().focus();
    await until(async () => (await rows.count()) === 0, 'native reconcile clears an expired schedule', 25000);
    assert(await run("document.activeElement.matches('.pr-snooze-empty button')"));
    await view('inbox');
    await waitForRows(8);
    const stored = await run(`require('mailspring-exports').DatabaseStore._query(
      'SELECT snoozeUntil FROM PaperReedLocalThread WHERE accountId=? AND threadId=?',
      [${JSON.stringify(account.id)}, ${JSON.stringify(short)}])`);
    assert.equal(stored[0].snoozeUntil, null, 'reconciliation persisted expiry');

    await rows.first().click();
    await main.locator('.pr-reader [data-local-panel=snooze]').click();
    await main.getByRole('button', { name: '明天 09:00' }).click();
    await main.locator('.pr-reader [data-local-action=unsnooze]').waitFor();
    const savedFromReader = (await scheduled())[0].id;
    await main.locator('.pr-back').click();
    await view('snoozed');
    await waitForRows(1);
    assert.deepEqual(await ids(), [savedFromReader]);
    await end(savedFromReader).click();
    await back.waitFor();
    assert.equal((await scheduled()).length, 0);
  }
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
    phase, nativeMail: true, scheduledCount: 3,
    reminderOrder: phase !== 'before', groupedLocalDates: phase === 'after',
    singleRestoreAndRetry: phase === 'after', keyboardFocus: phase === 'after',
    unreadRecovery: phase === 'after', nativeExpiry: phase === 'after',
    readerScheduling: phase === 'after', readRecovery: phase === 'after',
    emptyFocus: check('emptyFocus'), navigationFocus: check('navigationFocus'),
    reminderLabel: check('reminderLabel'), expirySnapshot: check('expirySnapshot'),
    bulkControls: check('bulkControls'), feedbackClears: check('feedbackClears'),
    paletteFocus: check('paletteFocus'),
  }, null, 2) + '\n');
};
