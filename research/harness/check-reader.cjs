const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ phase, app, currentWindow, selectWindow, run, until, shot, out, fixture }) => {
  const setup = currentWindow().locator('.page-container:not([inert])');
  const field = key => setup.locator(`[id="settings.${key}"]`);
  await setup.locator('[data-provider=imap]').click();
  await setup.locator('#name').fill('Reader fixture');
  await setup.locator('#emailAddress').fill(fixture.emailAddress);
  await field('imap_password').fill(fixture.settings.imap_password);
  await setup.locator('[data-manual-setup]').click();
  for (const protocol of ['imap', 'smtp']) {
    await field(`${protocol}_host`).fill(fixture.settings[`${protocol}_host`]);
    await field(`${protocol}_port`).selectOption('0');
    await field(`${protocol}_port_custom`).fill(String(fixture.settings[`${protocol}_port`]));
    await field(`${protocol}_security`).selectOption('none');
    await field(`${protocol}_username`).fill(fixture.settings[`${protocol}_username`]);
  }
  await setup.getByRole('button', { name: '连接邮箱', exact: true }).click();
  await selectWindow('default');
  const page = currentWindow();
  const first = page.locator('.pr-mail-row').filter({ hasText: 'Design review' });
  const second = page.locator('.pr-mail-row').filter({ hasText: 'Conversation reference' });
  const reader = page.locator('.pr-reader');
  const back = page.getByRole('button', { name: /返回收件箱/ });
  const firstText = 'The revised reading layout is ready.';
  const secondText = 'This is the second conversation.';
  const testPopIn = phase === 'after' || phase.startsWith('pop-in-');
  const polished = testPopIn || phase === 'notification-control';
  const testSwitch = phase !== 'before';
  const testQueuedNotification = phase === 'after' || phase === 'pop-in-queue-control';
  const paint = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const waitForBody = text => until(() => run(`Array.from(document.querySelectorAll('.pr-reader iframe')).some(
    frame => frame.contentDocument?.body.innerText.includes(${JSON.stringify(text)})
  )`), 'isolated message body');
  const resize = async (width, height) => {
    await run(`require('@electron/remote').getCurrentWindow().setContentSize(${width},${height});true`);
    await until(() => run(`innerWidth === ${width} && innerHeight === ${height}`), 'native reader dimensions');
    await paint();
  };
  if (testPopIn) {
    await run(`(()=>{
      window.readerWorkspace = () => {
        const node = document.querySelector('.pr-workspace');
        let fiber = node[Object.keys(node).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'))];
        while (fiber && fiber.stateNode?.constructor.displayName !== 'PaperReedWorkspace') fiber = fiber.return;
        return fiber.stateNode;
      };
      return true;
    })()`);
  }

  await resize(1440, 860);
  if (polished) await first.press('Enter');
  else await first.click();
  await reader.waitFor({ timeout: 4000 });
  await waitForBody(firstText);
  if (polished) {
    assert(await run(`document.activeElement === document.querySelector('.pr-reader')`));
    assert.equal(await reader.getByRole('heading', { level: 1, name: 'Design review' }).count(), 1);
    assert(await run(`document.querySelector('.pr-reader h1').getBoundingClientRect().bottom
      < document.querySelector('.pr-reader .pr-local-controls').getBoundingClientRect().top`));
    await reader.getByRole('button', { name: '撰写回复…' }).waitFor();
  }
  await shot(`${phase}-reader-desktop`);
  await resize(900, 640);
  await shot(`${phase}-reader-compact`);

  if (testSwitch) {
    await run(`(()=>{
      const { MessageStore: store } = require(AppEnv.getLoadSettings().resourcePath + '/src/flux/stores/message-store');
      const apply = store._onApplyFocusChange;
      window.readerFocusProbe = {
        getSubject: () => store.thread()?.subject,
        restore: () => { store._onApplyFocusChange = apply; store._onApplyFocusChange(); },
      };
      store._onApplyFocusChange = () => {};
      return true;
    })()`);
  }
  try {
    if (polished) await back.press('Enter');
    else await back.click();
    await first.waitFor({ timeout: 4000 });
    if (polished) {
      assert(await run(`document.activeElement === document.querySelector('.pr-mail-row[data-thread-id="${await first.getAttribute('data-thread-id')}"]')`));
    }
    await second.click();
    if (testSwitch) {
      assert.equal(await run('window.readerFocusProbe.getSubject()'), 'Design review');
      assert.equal(await reader.getByText('Design review', { exact: true }).count(), 0, 'previous conversation must not render while opening another');
      await reader.getByRole('status').filter({ hasText: '正在读取会话' }).waitFor({ timeout: 4000 });
      assert.equal(await reader.locator('iframe').count(), 0);
      await shot(`${phase}-reader-loading-compact`);
    }
  } finally {
    if (testSwitch) await run('window.readerFocusProbe.restore();delete window.readerFocusProbe;true');
  }
  await waitForBody(secondText);
  await paint();
  if (polished) {
    assert(await run(`(()=>{
      const subject = document.querySelector('.pr-reader .message-subject');
      const reader = document.querySelector('.pr-reader');
      return subject.textContent.includes('ABCD1234'.repeat(13)) &&
        subject.getBoundingClientRect().height > 38 && reader.scrollWidth === reader.clientWidth;
    })()`));
  }
  await shot(`${phase}-reader-long-compact`);
  await resize(1440, 860);
  await shot(`${phase}-reader-long-desktop`);
  if (polished) await reader.getByRole('button', { name: '撰写回复…' }).press('Enter');
  else await page.locator('.pr-reader .footer-reply-area-wrap').click();
  await reader.locator('[contenteditable=true]').first().waitFor();
  await page.keyboard.insertText('Reader fixture reply.');
  await reader.getByText('Reader fixture reply.', { exact: true }).waitFor();
  await back.click();
  await second.waitFor();
  assert.equal(await reader.count(), 0);
  if (polished) {
    await second.click();
    await reader.locator('[contenteditable=true]').getByText('Reader fixture reply.', { exact: true }).waitFor();

    await run(`(()=>{
      const { NativeNotifications } = require('mailspring-exports');
      const { Notifier } = require(AppEnv.getLoadSettings().resourcePath + '/internal_packages/unread-notifications/lib/main');
      const display = NativeNotifications.displayNotification;
      const notifier = new Notifier();
      notifier.unlisten();
      let activation;
      window.clickMailNotification = async subject => {
        const { DatabaseStore, Message, Thread } = require('mailspring-exports');
        const thread = await DatabaseStore.findBy(Thread, { subject });
        const message = await DatabaseStore.findBy(Message, { threadId: thread.id, draft: false });
        NativeNotifications.displayNotification = async ({ onActivate }) => { activation = onActivate; return null; };
        try { await notifier._notifyOne({ thread, message }, false); }
        finally { NativeNotifications.displayNotification = display; }
        activation({ activationType: 'clicked' });
      };
      return true;
    })()`);
    const editor = reader.locator('[contenteditable=true]').first();
    await editor.click();
    await page.keyboard.insertText(' Saved before notification.');
    try {
      if (phase === 'after') {
        await run(`(()=>{
          void window.readerWorkspace().move(() => new Promise(resolve => { window.resumeNotificationMove = resolve; }));
          return true;
        })()`);
        await until(() => run('Boolean(window.resumeNotificationMove)'), 'main workspace saving and moving');
      }
      try {
        await run(`window.clickMailNotification('Design review')`);
        if (phase === 'after') {
          assert.equal(await reader.getByRole('heading', { name: /Conversation reference/ }).count(), 1,
            'notification must wait for the ongoing move');
        }
      } finally {
        if (phase === 'after') await run('window.resumeNotificationMove();delete window.resumeNotificationMove;true');
      }
      await reader.getByRole('heading', { name: 'Design review', exact: true }).waitFor({ timeout: 4000 });
      await waitForBody(firstText);
      assert.equal(await reader.getByText(/Conversation reference/).count(), 0);
      await reader.getByRole('button', { name: '置顶', exact: true }).click();
      await reader.getByRole('button', { name: '取消置顶', exact: true }).waitFor();
      assert(await run(`(async()=>{
        const { DatabaseStore, Thread } = require('mailspring-exports');
        const root = AppEnv.getLoadSettings().resourcePath;
        const { localStates } = require(root + '/src/services/mail-core/local-triage');
        const { inboxDesktopAccess } = require(root + '/src/services/mail-core/inbox');
        const a = await DatabaseStore.findBy(Thread, { subject: 'Design review' });
        const b = await DatabaseStore.findBy(Thread, { subject: 'Conversation reference ' + 'ABCD1234'.repeat(13) });
        const states = await localStates([a,b].map(t => ({threadId:t.id,accountId:t.accountId})), inboxDesktopAccess);
        return !!states[a.id]?.pinned && !states[b.id]?.pinned;
      })()`));

      await page.locator('.pr-sidebar-bottom button').click();
      await reader.waitFor({ state: 'detached' });
      await run(`window.clickMailNotification('Conversation reference ' + 'ABCD1234'.repeat(13))`);
      await reader.getByRole('heading', { name: /Conversation reference/ }).waitFor();
      await reader.locator('[contenteditable=true]').getByText(/Saved before notification/).waitFor();
    } finally {
      if (!testQueuedNotification) await run('delete window.clickMailNotification;true');
    }
  }

  if (testPopIn) {
    const mailbox = folder => page.locator(`[data-mailbox="${folder}"]`);
    const inLabel = await run(`require('mailspring-exports').localized('Pop thread in')`);
    const popupRun = async (popup, expression) => {
      const cdp = await app.context().newCDPSession(popup);
      try {
        const reply = await cdp.send('Runtime.evaluate', { expression, returnByValue: true });
        if (reply.exceptionDetails) throw new Error(JSON.stringify(reply.exceptionDetails));
        return reply.result.value;
      } finally {
        if (!popup.isClosed()) await cdp.detach();
      }
    };
    const popOut = async () => {
      // Paper Reed hides the legacy toolbar. Invoke its production handler;
      // the source window and the return click still run in Electron.
      await run(`(()=>{
        const node = document.querySelector('.pr-reader #message-list');
        let fiber = node[Object.keys(node).find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'))];
        while (fiber && !fiber.stateNode?._onPopoutThread) fiber = fiber.return;
        fiber.stateNode._onPopoutThread();
        return true;
      })()`);
      return until(() => app.windows().find(win => !win.isClosed() && win !== page && win.url().includes('loadSettings=') &&
        JSON.parse(new URL(win.url()).searchParams.get('loadSettings') || '{}').windowType === 'thread-popout'),
      'independent conversation window');
    };
    const popInButton = popup => popup.getByRole('button', { name: inLabel, exact: true });
    const popIn = popup => popInButton(popup).click();
    const selectScope = async accountId => {
      await page.locator('#pr-account').selectOption(accountId);
      await until(() => run(`(() => {
        const { moving, state } = window.readerWorkspace();
        return state.accountId === ${JSON.stringify(accountId)} && state.route === 'list' && !state.loading && !moving;
      })()`), 'selected source account and refreshed list');
    };
    const captureErrors = popup => popupRun(popup, `(()=>{
      window.popInErrors = [];
      AppEnv.showErrorDialog = message => window.popInErrors.push(message);
      return true;
    })()`);
    const waitForError = async (popup, expected) => {
      await until(async () => {
        if (popup.isClosed()) return true;
        try {
          return await popupRun(popup, 'window.popInErrors.length') === expected;
        } catch (error) {
          if (popup.isClosed()) return true;
          if (error.message.includes('No target with given id')) return false;
          throw error;
        }
      }, 'main window refusal reaches the source');
      assert(!popup.isClosed(), 'a refused pop-in must leave the original conversation open');
    };

    await mailbox('inbox').click();
    await reader.waitFor({ state: 'detached' });
    const inboxAccount = await run("require('mailspring-exports').AccountStore.accountIds()[0]");
    await selectScope(inboxAccount);
    await first.press('Enter');
    await reader.getByRole('heading', { name: 'Design review', exact: true }).waitFor({ timeout: 4000 });
    const inboxPopup = await popOut();
    await popInButton(inboxPopup).waitFor();
    await mailbox('trash').click();
    await selectScope('');
    const trashRow = page.locator('.pr-mail-row').filter({ hasText: 'Trashed conversation' });
    await trashRow.waitFor();

    if (phase === 'pop-in-control') {
      await popIn(inboxPopup);
      await reader.getByRole('heading', { name: 'Design review', exact: true }).waitFor();
      assert.equal(await mailbox('inbox').getAttribute('aria-current'), 'page',
        'returning from an Inbox popout restores the Inbox perspective');
    }

    await captureErrors(inboxPopup);
    await run(`(()=>{
      const workspace = window.readerWorkspace();
      const dirtySessions = workspace.dirtySessions;
      window.popInMoveProbe = {
        hold: () => { void workspace.move(() => new Promise(resolve => { window.popInMoveProbe.release = resolve; })); },
        moving: () => workspace.moving,
        failSave: () => { workspace.dirtySessions = () => [{
          headerMessageId: 'pop-in-rejected-save@fixture.test',
          changes: { commit: async () => { throw new Error('Deliberate pop-in save failure'); } },
        }]; },
        restore: () => { workspace.dirtySessions = dirtySessions; },
      };
      window.popInMoveProbe.hold();
      return true;
    })()`);
    try {
      await until(() => run('Boolean(window.popInMoveProbe.release)'), 'a real move is in progress');
      if (testQueuedNotification) {
        await run(`window.clickMailNotification('Conversation reference ' + 'ABCD1234'.repeat(13))`);
        assert.equal(await reader.count(), 0, 'notification stays queued during the held move');
      }
      await popIn(inboxPopup);
      await waitForError(inboxPopup, 1);
      assert.equal(await mailbox('trash').getAttribute('aria-current'), 'page');
      console.log('PASS pop-in refused while main window is busy; source remains open');
    } finally {
      await run('window.popInMoveProbe.release();true');
    }
    await until(() => run('!window.popInMoveProbe.moving()'), 'held move completed');
    if (testQueuedNotification) {
      try {
        await until(() => run(`window.readerWorkspace().state.selected?.subject?.startsWith('Conversation reference ')`),
          'rejected pop-in preserves the queued notification', 4500);
        await reader.getByRole('heading', { name: /Conversation reference/ }).waitFor();
        assert(!inboxPopup.isClosed());
        assert.equal(await mailbox('inbox').getAttribute('aria-current'), 'page');
        console.log('PASS refused pop-in keeps the queued notification and the source window');
        await mailbox('trash').click();
        await selectScope('');
        await trashRow.waitFor();
      } finally {
        await run('delete window.clickMailNotification;true');
      }
    }
    await run('window.popInMoveProbe.failSave();true');
    try {
      await popIn(inboxPopup);
      await waitForError(inboxPopup, 2);
      assert.equal(await reader.count(), 0);
      console.log('PASS failed draft save refuses pop-in; source remains open');
    } finally {
      await run('window.popInMoveProbe.restore();true');
    }

    let errors = 2;
    if (phase === 'after' || phase === 'pop-in-deadline-control') {
      await run(`(()=>{
        const workspace = window.readerWorkspace();
        const probe = window.popInMoveProbe;
        workspace.dirtySessions = () => [{
          headerMessageId: 'pop-in-held-save@fixture.test',
          changes: { commit: () => new Promise(resolve => {
            probe.releaseSave = () => {
              probe.restore();
              probe.saved = true;
              resolve();
            };
          }) },
        }];
        return true;
      })()`);
      try {
        await popIn(inboxPopup);
        await until(() => run('Boolean(window.popInMoveProbe.releaseSave)'), 'pop-in entered draft commit');
        await waitForError(inboxPopup, ++errors);
      } finally {
        await run('window.popInMoveProbe.releaseSave?.();window.popInMoveProbe.restore();true');
      }
      await until(() => run('window.popInMoveProbe.saved && !window.popInMoveProbe.moving()'), 'late draft commit completes');
      await paint();
      assert.equal(await reader.count(), 0, 'expired pop-in must not navigate after the draft finishes saving');
      assert.equal(await mailbox('trash').getAttribute('aria-current'), 'page');
      console.log('PASS a late draft commit completes without navigating an expired pop-in');
    }
    await run('delete window.popInMoveProbe;true');

    const holdPopInBody = subject => run(`(()=>{
      const { Actions, MessageBodyProcessor: processor } = require('mailspring-exports');
      const heldSubject = ${JSON.stringify(subject)};
      const retrieveCached = processor.retrieveCached;
      const subscribe = processor.subscribe;
      const existingFocus = AppEnv.focus;
      const probe = window.popInBodyProbe = { results: [], focuses: 0 };
      const unlisten = Actions.popInThreadResult.listen((id, opened) => probe.results.push(opened));
      AppEnv.focus = function() { probe.focuses++; return existingFocus.call(this); };
      processor.retrieveCached = function(message) {
        return message.subject === heldSubject ? null : retrieveCached.call(this, message);
      };
      processor.subscribe = function(message, sendInitial, callback) {
        return subscribe.call(this, message, sendInitial, result => {
          if (message.subject !== heldSubject || probe.resumed) callback(result);
          else probe.releaseBody = () => {
            probe.resumed = true;
            callback(result);
          };
        });
      };
      probe.restore = () => {
        processor.retrieveCached = retrieveCached;
        processor.subscribe = subscribe;
        AppEnv.focus = existingFocus;
        unlisten();
      };
      return true;
    })()`);
    await holdPopInBody('Design review');
    await run(`(()=>{
      const { MessageStore } = require('mailspring-exports');
      const apply = MessageStore._onApplyFocusChange;
      MessageStore._onApplyFocusChange = () => {};
      window.releasePopInFocus = () => {
        MessageStore._onApplyFocusChange = apply;
        MessageStore._onApplyFocusChange();
      };
      return true;
    })()`);
    try {
      await popIn(inboxPopup);
      await reader.getByRole('status').filter({ hasText: '正在读取会话' }).waitFor();
      assert(!inboxPopup.isClosed(), 'the source stays open until the target renders');
    } finally {
      await run('window.releasePopInFocus();delete window.releasePopInFocus;true');
    }
    try {
      await until(() => run('Boolean(window.popInBodyProbe.releaseBody)'), 'production body processing reached the held callback');
      await reader.locator('.message-body-loading').waitFor();
      assert.equal(await reader.locator('iframe').count(), 0);
      assert.deepEqual(await run('window.popInBodyProbe.results'), [],
        'no successful pop-in receipt before the target body reaches its iframe');
      assert(!inboxPopup.isClosed());
      if (phase === 'after') await waitForError(inboxPopup, ++errors);
      await run('window.popInBodyProbe.releaseBody();true');
      await waitForBody(firstText);
      await paint();
      if (phase === 'after') {
        assert.deepEqual(await run('window.popInBodyProbe.results'), []);
        assert.equal(await run('window.popInBodyProbe.focuses'), 0);
        assert(!inboxPopup.isClosed(), 'the expired request never raises the main window or closes the source');
        await popIn(inboxPopup);
      }
    } finally {
      await run('window.popInBodyProbe.restore();delete window.popInBodyProbe;true');
    }
    await until(() => inboxPopup.isClosed(), 'Inbox popout closes after the main reader is ready');
    assert.equal(await mailbox('inbox').getAttribute('aria-current'), 'page');
    assert.equal(await page.locator('#pr-account').inputValue(), inboxAccount);
    console.log('PASS Inbox pop-in waits for the target and restores the source scope');

    await mailbox('inbox').click();
    await second.press('Enter');
    await reader.locator('[contenteditable=true]').getByText(/Saved before notification/).waitFor();
    const replyPopup = await popOut();
    await popInButton(replyPopup).waitFor();
    await mailbox('trash').click();
    await trashRow.waitFor();
    await popIn(replyPopup);
    await waitForBody(secondText);
    await reader.locator('[contenteditable=true]').getByText(/Saved before notification/).waitFor();
    await until(() => replyPopup.isClosed(), 'reply popout closes after body and draft are readable');
    console.log('PASS pop-in expands the original body and retains the existing inline draft');

    await mailbox('trash').click();
    await trashRow.press('Enter');
    await reader.getByRole('heading', { name: 'Trashed conversation', exact: true }).waitFor({ timeout: 4000 });
    await waitForBody('This message only exists in Trash.');
    const trashPopup = await popOut();
    await popInButton(trashPopup).waitFor();
    await mailbox('inbox').click();
    await selectScope('');
    await holdPopInBody('Trashed conversation');
    try {
      await popIn(trashPopup);
      await until(() => run('Boolean(window.popInBodyProbe.releaseBody)'), 'Trash body processing reached the held callback');
      assert.deepEqual(await run('window.popInBodyProbe.results'), []);
      assert(!trashPopup.isClosed());
      await run('window.popInBodyProbe.releaseBody();true');
      await waitForBody('This message only exists in Trash.');
      await until(() => trashPopup.isClosed(), 'Trash popout closes after the main reader is ready');
      assert.deepEqual(await run('window.popInBodyProbe.results'), [true]);
    } finally {
      await run('window.popInBodyProbe.restore();delete window.popInBodyProbe;true');
    }
    assert.equal(await mailbox('trash').getAttribute('aria-current'), 'page');
    assert.equal(await page.locator('#pr-account').inputValue(), inboxAccount);
    await page.getByRole('button', { name: /返回废纸篓/ }).click();
    await trashRow.waitFor();
    console.log('PASS Trash pop-in renders the original body and resumes the Trash list');
    await run('delete window.readerWorkspace;true');
  }

  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({
    isolatedBodies: true, inlineReplyAndReturn: true,
    ...(polished ? {
      keyboardOpenAndReturn: true, readerFocus: true, subjectPrecedesActions: true,
      localizedReply: true, staleConversationHidden: true, wrapsLongSubject: true, replyDraftRestored: true,
      notificationOpensCorrectThreadAndActions: true, notificationRestoresMailAndPreservesDirtyReply: true,
    } : {}),
    ...(testPopIn ? {
      popInPreservesSourceFolderAndAccount: true,
      popInWaitsForRenderedConversation: true,
      popInLeavesWindowOpenWhenBusyOrSaveFails: true,
      lateDraftSaveCannotNavigateExpiredPopIn: true,
      lateBodyCannotAcknowledgeExpiredPopIn: true,
      busyNotificationOpensAfterMove: true,
      refusedPopInPreservesQueuedNotification: true,
      popInWithInlineReplyShowsBodyAndDraft: true,
    } : {}),
  }, null, 2) + '\n');
  console.log('PASS conversation navigation, isolated bodies and inline reply');
};
