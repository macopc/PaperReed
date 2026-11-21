const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ main, cdp, evaluate, until, account }) => {
  const output = process.env.PAPER_REED_UI_OUTPUT;
  const phase = process.env.PAPER_REED_SEARCH_PAGE_CHECK;
  const run = expression => evaluate(cdp, expression);
  const input = main.getByRole('textbox', { name: '搜索本机邮件' });
  const rows = main.locator('.pr-mail-row');
  const list = main.locator('.pr-mail-list');
  const count = main.locator('.pr-list-caption, .pr-search-count');
  const wait = (expression, label) => until(() => run(expression), label, 5000);
  const before = phase === 'before';
  const ready = (query, length) => wait(
    `ws.state.query === ${JSON.stringify(query)} && !ws.state.loading && !ws.state.searchPending &&
      document.querySelectorAll('.pr-mail-row').length === ${length}`,
    'matching list for ' + query
  );
  fs.mkdirSync(output, { recursive: true });
  const resize = (width, height) => cdp.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: 1, mobile: false,
  });
  const capture = async (name, width = 900, height = 640) => {
    await resize(width, height);
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  await until(async () => (await rows.count()) === 8, 'native fixture mail');
  await run(`(() => {
    const pane = document.querySelector('.pr-workspace');
    let fiber = pane[Object.keys(pane).find(key => key.startsWith('__reactFiber'))];
    while (fiber && !fiber.stateNode?.refreshOperations) fiber = fiber.return;
    window.ws = fiber.stateNode;
    const mail = require('../src/services/mail-core/inbox');
    window.searchProbe = { calls: [], holds: new Map(), active: new Map(), fail: null };
    const refresh = ws.refresh;
    ws.refresh = async () => {
      const query = ws.state.query;
      const active = searchProbe.active;
      active.set(query, (active.get(query) ?? 0) + 1);
      try {
        await refresh();
      } finally {
        active.set(query, active.get(query) - 1);
      }
    };
    const probe = query => async (options, access) => {
      searchProbe.calls.push({ query: options.query, ids: options.accountIds });
      const result = await query(options, access);
      const hold = searchProbe.holds.get(options.query);
      if (hold) {
        hold.reached = true;
        await hold.promise;
      }
      if (options.query === searchProbe.fail) throw Error('fixture read failure');
      return result;
    };
    mail.queryInbox = probe(mail.queryInbox);
    mail.queryInboxPage = probe(mail.queryInboxPage);
  })()`);
  const project = 'Project kickoff';
  const design = 'Design review';
  const missing = 'paperreed-fixture-no-match';
  const hold = query => run(`(() => {
    const hold = {};
    hold.promise = new Promise(resolve => { hold.release = resolve; });
    searchProbe.holds.set(${JSON.stringify(query)}, hold);
  })()`);
  const held = query => wait(`searchProbe.holds.get(${JSON.stringify(query)}).reached`, 'held production result');
  const release = query => run(`(() => {
    searchProbe.holds.get(${JSON.stringify(query)}).release();
    searchProbe.holds.delete(${JSON.stringify(query)});
  })()`);

  await resize(900, 640);
  await main.keyboard.press('Meta+Alt+f');
  await wait("document.activeElement.id === 'pr-mail-search'", 'search shortcut focus');
  await input.fill(project);
  await ready(project, 1);
  assert.match(await rows.first().innerText(), /Project kickoff/);
  await capture('search-result', 1440, 860);
  await capture('search-result-compact');

  await hold(design);
  await input.fill(design);
  await input.press('Enter');
  await held(design);
  assert.equal(await list.getAttribute('aria-busy'), 'true');
  assert.match(await rows.first().innerText(), /Project kickoff/);
  await capture('search-reading');
  if (!before) {
    assert.equal(await count.count(), 0, 'a prior result count must disappear while reading');
    assert(await rows.first().isDisabled(), 'prior rows cannot be opened while reading');
  }
  await input.fill(missing);
  await ready(missing, 0);
  await release(design);
  await wait(`searchProbe.active.get(${JSON.stringify(design)}) === 0`, 'old read fully settles');
  await main.getByRole('status').filter({ hasText: '没找到匹配的邮件' }).waitFor();
  assert.equal(await rows.count(), 0);
  await capture('search-empty');

  await input.fill(project);
  await ready(project, 1);
  await run(`searchProbe.fail = ${JSON.stringify(design)}`);
  await input.fill(design);
  const failure = main.getByRole('alert').filter({ hasText: '邮件暂时无法读取' });
  await failure.waitFor();
  await capture('search-failed');
  if (!before) {
    assert.equal(await count.count(), 0, 'failure must not count prior rows');
    assert(await rows.first().isDisabled(), 'prior rows cannot be opened after a failed search');
  }
  await run('searchProbe.fail = null');
  const retry = failure.getByRole('button', { name: '重新读取' });
  if (phase === 'after') {
    await input.focus();
    await main.keyboard.press('Tab');
    await main.keyboard.press('Tab');
    await wait("document.activeElement.matches('.pr-notice button')", 'Tab reaches search retry');
    await main.keyboard.press('Enter');
    await wait("document.activeElement.id === 'pr-mail-search'", 'retry returns focus to search');
  } else {
    await retry.click();
  }
  await ready(design, 1);
  assert.match(await rows.first().innerText(), /Design review/);

  await input.fill(project);
  await main.locator('#pr-account').focus();
  await main.locator('#pr-account').selectOption(account.id);
  await wait(`ws.state.accountId === ${JSON.stringify(account.id)}`, 'mailbox scope change');
  await ready(project, 1);
  assert.equal(await input.inputValue(), project);
  assert.deepEqual(await run('searchProbe.calls.at(-1).ids'), [account.id]);
  const clear = main.locator('.pr-search button');
  if (before) {
    await clear.click();
  } else {
    await clear.focus();
    await clear.press('Enter');
  }
  await ready('', 8);
  await wait("document.activeElement.id === 'pr-mail-search'", 'clear search focus');

  if (phase === 'after') {
    await input.fill(project);
    await ready(project, 1);
    const unread = main.getByRole('checkbox', { name: '仅未读' });
    await unread.check();
    await ready(project, 0);
    await main.getByRole('status').filter({ hasText: '没找到匹配的未读邮件' }).waitFor();
    await capture('search-unread-empty');
    const showAll = main.getByRole('button', { name: '显示全部邮件' });
    await showAll.focus();
    await showAll.press('Enter');
    await ready(project, 1);
    await wait("document.activeElement.matches('.pr-unread-filter input')", 'unread filter focus');
    assert.equal(await input.inputValue(), project);

    await input.focus();
    await run(`(() => {
      searchProbe.calls.length = 0;
      document.activeElement.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    })()`);
    const compositionText = '测试输入的关键词';
    await input.fill(compositionText);
    await input.press('Enter');
    await capture('search-composing', 740, 700);
    await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(await run('ws.state.query'), project, 'candidate selection must not start a search');
    assert.equal(await run('searchProbe.calls.length'), 0);
    assert.equal(await count.count(), 0);
    assert(await rows.first().isDisabled());
    assert.equal(await list.getAttribute('aria-busy'), 'true');
    assert(await run(`(() => {
      const pane = document.querySelector('.pr-main');
      return pane.scrollWidth <= pane.clientWidth && pane.querySelector('.pr-search-input').clientWidth > 200;
    })()`), 'the search input remains usable at 740px during composition');
    await run(`document.activeElement.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))`);
    await ready(compositionText, 0);
    assert.deepEqual(await run('searchProbe.calls.map(call => call.query)'), [compositionText]);
  }
  const control = process.env.PAPER_REED_SEARCH_CONTROL_CASE;
  const applied = {};
  if (phase === 'after' || control) {
    if (await input.inputValue()) await clear.click();
    await ready('', 8);
    await run(`(() => {
      const dirtySessions = ws.dirtySessions;
      const search = ws.search;
      window.holdSave = (retrySucceeds = false) => {
        let dirty = true;
        window.saveWaiting = false;
        window.saveAttempts = 0;
        window.saveResult = new Promise(resolve => { window.releaseSave = resolve; });
        ws.dirtySessions = () => dirty ? [{
          headerMessageId: 'search-fixture',
          changes: { commit: async () => {
            window.saveWaiting = true;
            const first = ++window.saveAttempts === 1;
            if (!(first ? await window.saveResult : retrySucceeds)) throw Error('fixture save failure');
            dirty = false;
          } },
        }] : [];
        window.resetSave = () => { ws.dirtySessions = dirtySessions; };
      };
      window.submittedQueries = [];
      ws.search = (...args) => {
        window.submittedQueries.push(args[0]);
        return window.lastSearch = search(...args);
      };
    })()`);
    const test = async (name, body) => {
      if (control && control !== name) return;
      await body();
      applied[name] = true;
    };
    const beginSearch = async (query, length) => {
      await input.fill(query);
      await input.press('Enter');
      await ready(query, length);
    };
    const submitWithSavePending = async query => {
      await input.fill(query);
      await input.press('Enter');
      await wait('window.saveWaiting', 'draft commit is suspended');
    };

    await test('clearGuard', async () => {
      await hold('');
      const unread = main.getByRole('checkbox', { name: '仅未读' });
      await unread.check();
      await held('');
      await input.focus();
      await run(`document.activeElement.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))`);
      await input.fill(project);
      await clear.click();
      await wait('ws.state.query === "" && ws.state.loading && !ws.state.searchPending', 'clear read starts');
      assert.equal(await count.count(), 0, 'clearing before debounce cannot certify the prior list');
      assert(await rows.first().isDisabled(), 'clearing before debounce cannot enable the prior row');
      await run('searchProbe.fail = ""');
      await release('');
      await failure.waitFor();
      assert.equal(await count.count(), 0, 'failed clear cannot restore the prior count');
      assert(await rows.first().isDisabled(), 'failed clear cannot enable the prior row');
      await capture('search-clear-failed');
      await run('searchProbe.fail = null');
      await input.focus();
      await main.keyboard.press('Tab');
      await wait("document.activeElement.matches('.pr-notice button')", 'retry after clear is next in keyboard order');
      await main.keyboard.press('Enter');
      await ready('', 0);
      await unread.uncheck();
      await ready('', 8);
    });
    await test('latestAfterSave', async () => {
      await run('holdSave(); submittedQueries.length = 0');
      await submitWithSavePending(project);
      await input.fill(design);
      await wait(`submittedQueries.includes(${JSON.stringify(design)})`, 'latest debounce reaches busy move');
      await run('searchProbe.calls.length = 0; releaseSave(true)');
      await ready(design, 1);
      assert(!await run(`searchProbe.calls.some(call => call.query === ${JSON.stringify(project)})`));
      await run('resetSave()');

      await run('holdSave(); submittedQueries.length = 0');
      await submitWithSavePending(project);
      await input.fill(missing);
      await wait(`submittedQueries.includes(${JSON.stringify(missing)})`, 'latest debounce during failed save');
      await run('searchProbe.calls.length = 0; releaseSave(false)');
      await main.getByRole('alert').filter({ hasText: '搜索尚未更新' }).waitFor();
      assert.equal(await main.getByRole('button', { name: '重新读取' }).count(), 0,
        'a blocked search offers Enter rather than a disabled re-read');
      assert.deepEqual(await run('searchProbe.calls'), []);
      assert.equal(await input.inputValue(), missing);
      await run('resetSave()');
      await input.press('Enter');
      await ready(missing, 0);

      await run('holdSave(); submittedQueries.length = 0');
      await main.locator('#pr-account').selectOption('');
      await wait('window.saveWaiting', 'scope switch waits for draft');
      await input.fill(project);
      await wait(`submittedQueries.includes(${JSON.stringify(project)})`, 'latest search reaches busy scope switch');
      await run('releaseSave(true)');
      await ready(project, 1);
      assert.equal(await main.locator('#pr-account').inputValue(), '');
      assert.equal(await input.inputValue(), project);
      await run('resetSave()');
    });
    await test('agentScope', async () => {
      await beginSearch(project, 1);
      await main.locator('.pr-mail-item input').check();
      await run(`(() => {
        holdSave();
        const agent = require(AppEnv.getLoadSettings().resourcePath + '/internal_packages/mcp-server/lib/paper-reed-cli');
        const clipboard = require('@electron/remote').clipboard;
        const { agentHandoff } = agent;
        const { writeText } = clipboard;
        window.handoffScopes = [];
        window.clipboardWrites = [];
        agent.agentHandoff = scope => { handoffScopes.push(scope); return 'fixture mail handoff'; };
        clipboard.writeText = text => { clipboardWrites.push(text); };
        window.restoreHandoff = () => {
          agent.agentHandoff = agentHandoff;
          clipboard.writeText = writeText;
        };
        window.agentCopy = ws.copyContext();
      })()`);
      await wait('window.saveWaiting', 'Agent waits for draft');
      await input.fill(design);
      await run('(async () => { releaseSave(true); await agentCopy; resetSave(); })()');
      assert.deepEqual(await run('handoffScopes'), [], 'changed selection cannot widen Agent handoff');
      assert.deepEqual(await run('clipboardWrites'), [], 'changed selection cannot widen Agent handoff');
      await ready(design, 1);
      const cancelled = main.getByRole('status').filter({ hasText: '交接已取消' });
      await cancelled.waitFor();
      await main.locator('.pr-mail-item input').check();
      await run('ws.copyContext()');
      assert.deepEqual(await run('handoffScopes'), [
        { scope: 'selection', targets: await run('ws.selectedTargets()') },
      ]);
      assert.deepEqual(await run('clipboardWrites'), ['fixture mail handoff']);
      await cancelled.waitFor({ state: 'hidden' });
      await run('restoreHandoff()');
    });
    await test('returnFocus', async () => {
      await beginSearch(project, 1);
      await rows.first().click();
      const back = main.locator('.pr-back');
      await back.waitFor();
      await run(`(async () => {
        searchProbe.fail = ${JSON.stringify(project)};
        await ws.refresh();
      })()`);
      await back.focus();
      await back.press('Enter');
      await failure.waitFor();
      await wait("document.activeElement.id === 'pr-mail-search'", 'return falls back to search input');
    });
    await test('resultReturnAndFolderReset', async () => {
      await run('searchProbe.fail = null');
      await beginSearch(design, 1);
      const id = await rows.first().getAttribute('data-thread-id');
      await rows.first().focus();
      await rows.first().press('Enter');
      const back = main.locator('.pr-back');
      await back.waitFor();
      await back.focus();
      await back.press('Enter');
      await ready(design, 1);
      await wait(`document.activeElement.dataset.threadId === ${JSON.stringify(id)}`, 'return focuses the result row');
      assert.equal(await input.inputValue(), design);

      await main.locator('[data-mailbox=sent]').click();
      await wait('ws.state.folder === "sent" && ws.state.query === "" && !ws.state.loading', 'folder change clears search');
      assert.equal(await input.inputValue(), '');
    });
    await test('saveFailsBeforeDebounce', async () => {
      await main.locator('[data-mailbox=inbox]').click();
      await ready('', 8);
      await run('holdSave(true); submittedQueries.length = 0; searchProbe.calls.length = 0');
      await submitWithSavePending(project);
      const failedBeforeDebounce = await run(`(async () => {
        const first = lastSearch;
        const input = document.querySelector('.pr-search-input');
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, ${JSON.stringify(missing)});
        input.dispatchEvent(new Event('input', { bubbles: true }));
        releaseSave(false);
        await first;
        return !submittedQueries.includes(${JSON.stringify(missing)});
      })()`);
      assert(failedBeforeDebounce);
      await wait(`submittedQueries.includes(${JSON.stringify(missing)})`, 'edited keyword reaches debounce');
      await run('lastSearch');
      assert.equal(await run('saveAttempts'), 1, 'debounce cannot retry a rejected draft save');
      assert.deepEqual(await run('searchProbe.calls'), []);
      await main.getByRole('alert').filter({ hasText: '搜索尚未更新' }).waitFor();
      assert.equal(await input.inputValue(), missing);
      await input.press('Enter');
      await ready(missing, 0);
      assert.equal(await run('saveAttempts'), 2, 'Enter can explicitly retry the draft save');
      await run('resetSave()');
    });
    await test('clearAcrossFolders', async () => {
      await main.locator('[data-mailbox=inbox]').click();
      await ready('', 8);
      await beginSearch(project, 1);
      await hold('');
      await clear.click();
      await held('');
      await main.locator('[data-mailbox=sent]').click();
      await wait('ws.state.folder === "sent" && ws.state.loading && searchProbe.active.get("") >= 2',
        'destination folder query is held');
      const agentDisabled = 'ws.commands().find(command => command.id === "paper-reed:agent").disabled';
      assert.equal(await count.count(), 0, 'moving during clear cannot make the destination look empty');
      assert.equal(await run(agentDisabled), true, 'handoff waits for the destination to load');
      await run('searchProbe.fail = ""');
      await release('');
      await failure.waitFor();
      assert.equal(await count.count(), 0, 'a failed destination does not report a result count');
      assert.equal(await run(agentDisabled), true);
      await capture('search-folder-failed');
      await run('searchProbe.fail = null');
      await retry.click();
      await ready('', 0);
      assert.match(await count.innerText(), /0 个会话/);
      assert.equal(await run(agentDisabled), false);
    });
    await test('lateFailureFocus', async () => {
      await main.locator('[data-mailbox=inbox]').click();
      await ready('', 8);
      const focusAfterRead = async moveFocus => {
        await beginSearch(project, 1);
        const id = await rows.first().getAttribute('data-thread-id');
        await rows.first().click();
        const back = main.locator('.pr-back');
        await back.waitFor();
        await hold(project);
        await back.focus();
        await back.press('Enter');
        await held(project);
        await wait(`document.activeElement.dataset.threadId === ${JSON.stringify(id)}`, 'return initially focuses result');
        const target = moveFocus ? '.pr-unread-filter input' : '.pr-search-input';
        if (moveFocus) await main.locator(target).focus();
        await run(`searchProbe.fail = ${JSON.stringify(project)}`);
        await release(project);
        await failure.waitFor();
        await wait(`document.activeElement.matches(${JSON.stringify(target)})`, 'focus after late read failure');
        await run('searchProbe.fail = null');
        await retry.click();
        await ready(project, 1);
      };
      await focusAfterRead(false);
      await focusAfterRead(true);
    });
    await test('clearDoesNotRetrySave', async () => {
      await main.locator('[data-mailbox=inbox]').click();
      await ready('', 8);
      await run('holdSave(true); submittedQueries.length = 0; searchProbe.calls.length = 0');
      await submitWithSavePending(project);
      await input.fill(missing);
      await wait(`submittedQueries.includes(${JSON.stringify(missing)})`, 'new keyword waits for save');
      await run('releaseSave(false)');
      const blocked = main.getByRole('alert').filter({ hasText: '搜索尚未更新' });
      await blocked.waitFor();
      assert.equal(await run('saveAttempts'), 1);

      await clear.click();
      await wait('submittedQueries.includes("")', 'clear submits immediately');
      await run('lastSearch');
      assert.equal(await run('saveAttempts'), 1, 'clear cannot retry a rejected draft save');
      assert.deepEqual(await run('searchProbe.calls'), []);
      assert.equal(await input.inputValue(), '');
      await wait("document.activeElement.id === 'pr-mail-search'", 'clear returns focus to search');
      await blocked.waitFor();
      const submissions = await run('submittedQueries.length');
      await run(`document.querySelector('.pr-search').requestSubmit(); lastSearch`);
      assert.equal(await run('submittedQueries.length'), submissions + 1);
      assert.equal(await run('saveAttempts'), 1, 'form submission alone cannot retry a rejected draft save');

      await input.press('Enter');
      await ready('', 8);
      assert.equal(await run('saveAttempts'), 2, 'Enter explicitly retries the save after clearing');
      await blocked.waitFor({ state: 'hidden' });
      await run('resetSave()');
    });
    await test('compositionDefersPendingSearch', async () => {
      await main.locator('[data-mailbox=inbox]').click();
      await ready('', 8);
      await run('holdSave(); submittedQueries.length = 0; searchProbe.calls.length = 0');
      await submitWithSavePending(project);
      await run(`(async () => {
        document.activeElement.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
        releaseSave(true);
        await lastSearch;
      })()`);
      assert.equal(await run('ws.state.query'), '', 'the queued query cannot commit after composition starts');
      assert.deepEqual(await run('searchProbe.calls'), []);
      assert.equal(await input.inputValue(), project, 'release precedes the first composition change');
      const composed = '合成词搜索夹具';
      await input.fill(composed);
      await input.press('Enter');
      assert.deepEqual(await run('searchProbe.calls'), [], 'candidate confirmation cannot start a search');
      await run(`document.activeElement.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))`);
      await ready(composed, 0);
      assert.deepEqual(await run('searchProbe.calls.map(call => call.query)'), [composed]);
      await run('resetSave()');
    });
    const focusByCommand = async () => {
      await main.locator('.pr-command-trigger').click();
      const command = main.getByRole('textbox', { name: '查找命令' });
      await command.fill('搜索邮件');
      await command.press('Enter');
    };
    await test('focusDoesNotRetrySave', async () => {
      await main.locator('[data-mailbox=inbox]').click();
      await ready('', 8);
      await run('holdSave(true)');
      await submitWithSavePending(project);
      await run('(async () => { searchProbe.calls.length = 0; releaseSave(false); await lastSearch; })()');
      const blocked = main.getByRole('alert').filter({ hasText: '搜索尚未更新' });
      await blocked.waitFor();

      await main.locator('.pr-unread-filter input').focus();
      await main.keyboard.press('Meta+Alt+f');
      await wait("document.activeElement.id === 'pr-mail-search'", 'shortcut focuses search after save rejection');
      assert.equal(await run('saveAttempts'), 1, 'search focus shortcut cannot retry a rejected draft save');
      await focusByCommand();
      await wait("document.activeElement.id === 'pr-mail-search'", 'search command focuses after the palette closes');
      assert.equal(await run('saveAttempts'), 1, 'search command cannot retry a rejected draft save');
      assert.deepEqual(await run('searchProbe.calls'), []);
      await blocked.waitFor();
      assert.equal(await input.inputValue(), project);

      await input.press('Enter');
      await ready(project, 1);
      assert.equal(await run('saveAttempts'), 2, 'Enter explicitly retries the save after refocusing');
      await run('resetSave()');
    });
    await test('focusNavigationSaves', async () => {
      await beginSearch(project, 1);
      const check = async (route, trigger) => {
        await run('holdSave()');
        await trigger();
        await wait('window.saveWaiting', 'leaving ' + route + ' waits for the draft save');
        assert.equal(await run('ws.state.route'), route);
        assert.equal(await input.count(), 0);
        await run('releaseSave(true)');
        await wait("document.activeElement.id === 'pr-mail-search'", 'focus after leaving ' + route);
        await ready(project, 1);
        assert.equal(await run('saveAttempts'), 1);
        await run('resetSave()');
      };

      await rows.first().click();
      await main.locator('.pr-reader').waitFor();
      await check('thread', () => main.keyboard.press('Meta+Alt+f'));

      await main.locator('.pr-compose-button').click();
      await main.locator('.pr-editor .pr-composer').waitFor();
      await check('compose', focusByCommand);
    });
  }
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
    phase, shortcutFocus: true, previousResultsDuringRead: true, rejectedReadCanRetry: true,
    liveQuery: true, lateResultIgnored: true, accountScopePreserved: true,
    clearRefocuses: true, keyboardClear: !before, unreadRecovery: phase === 'after',
    imeCommitOnly: phase === 'after', keyboardRetry: phase === 'after', ...applied,
  }, null, 2) + '\n');
};
