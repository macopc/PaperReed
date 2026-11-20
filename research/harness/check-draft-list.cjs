const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({app, main, cdp, evaluate, until, account, secondAccount, cli, upgradeDesktop}) => {
  const phase = process.env.PAPER_REED_DRAFT_LIST_CHECK;
  const output = process.env.PAPER_REED_UI_OUTPUT;
  const run = expression => evaluate(cdp, expression);
  const draftList = main.locator('.pr-mail-list[aria-label="草稿"]');
  const rows = draftList.locator('[data-draft-id]');
  const row = id => draftList.locator(`[data-draft-id="${id}"]`);
  const newDraft = draftList.getByRole('button', {name: '写邮件'});
  const search = main.locator('.pr-search-input');
  const waitForRows = count => until(async () =>
    await rows.count() === count && await draftList.getAttribute('aria-busy') === 'false',
  'draft count ' + count);
  const ids = () => run("Array.from(document.querySelectorAll('[data-draft-id]'), row => row.dataset.draftId)");
  const focusedDraft = () => run('document.activeElement?.dataset.draftId || null');
  const capture = async (name, width = 900, height = 640) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const shot = await cdp.send('Page.captureScreenshot', {format: 'png', fromSurface: true});
    fs.writeFileSync(path.join(output, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  const create = (subject, to = []) => cli('draft-create', {
    accountId: account.id, subject, to, body: 'Saved draft for the isolated desktop fixture.',
  });
  const view = id => main.locator(`[data-mailbox="${id}"]`).click();
  const setupProbe = () => run(`(() => {
    const source = require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core');
    const recovery = source.desktopDraftRecoveryInfo;
    const element = document.querySelector('.pr-workspace');
    let fiber = element[Object.keys(element).find(key => key.startsWith('__reactFiber$'))];
    while (fiber && !fiber.stateNode?.listReadScope) fiber = fiber.return;
    window.draftListProbe = {workspace: fiber.stateNode, pause: false, fail: false};
    source.desktopDraftRecoveryInfo = async drafts => {
      if (draftListProbe.fail) throw Error('fixture draft read failure');
      if (draftListProbe.pause) await new Promise(resolve => { draftListProbe.resume = resolve; });
      return recovery(drafts);
    };
  })()`);
  const remove = draftId => run(`(async () => {
    const {Actions, DatabaseStore, Message} = require('mailspring-exports');
    const draft = await DatabaseStore.findBy(Message, {
      accountId: ${JSON.stringify(account.id)}, headerMessageId: ${JSON.stringify(draftId)}, draft: true,
    });
    if (!draft) throw new Error('fixture draft no longer exists');
    Actions.destroyDraft(draft);
  })()`);

  fs.mkdirSync(output, {recursive: true});
  await main.locator('.pr-mail-row[data-thread-id]').first().waitFor();
  if (phase === 'identity' || phase === 'account-move-collision') {
    await setupProbe();
    const original = await create('First account draft', [{email: 'first-recipient@example.test'}]);
    const other = {accountId: secondAccount.id, draftId: original.draftId};
    await run(`(async () => {
      const {AccountStore, Message} = require('mailspring-exports');
      const core = require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core');
      const draft = new Message({
        accountId: ${JSON.stringify(other.accountId)}, headerMessageId: ${JSON.stringify(other.draftId)},
        draft: true, pristine: false, version: 0, unread: false, date: new Date(),
        from: [AccountStore.accountForId(${JSON.stringify(other.accountId)}).defaultMe()],
        to: core.draftContacts([{email: 'other-recipient@example.test'}]),
        subject: 'Second account draft', body: 'This body belongs to the second account.',
      });
      return core.saveDraft(draft, core.desktopAccess);
    })()`);
    await view('drafts');
    await waitForRows(2);
    const first = rows.filter({hasText: 'First account draft'});
    const second = rows.filter({hasText: 'Second account draft'});
    const editor = main.locator('.pr-editor [contenteditable=true]');
    const back = main.locator('.pr-editor .pr-back');
    await first.press('Enter');
    await editor.waitFor();
    assert.match(await editor.innerText(), /Saved draft for the isolated desktop fixture/);
    if (phase === 'account-move-collision') {
      await main.locator('.pr-editor .show-popout').click();
      const key = 'composer-' + JSON.stringify([original.draftId, secondAccount.id]);
      const originalKey = 'composer-' + JSON.stringify([original.draftId, account.id]);
      const registered = (_, windowKey) => global.application.windowManager.get(windowKey)?.browserWindow.id;
      const firstWindow = await until(() => app.evaluate(registered, originalKey), 'registered original composer');
      await run(`(() => {
        const core = require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core');
        const move = core.moveDraftToAccount;
        core.moveDraftToAccount = async (...args) => {
          await new Promise(resolve => { window.releaseCollidingMove = resolve; });
          return move(...args);
        };
      })()`);
      await main.locator('.from-field .only-item').click();
      await main.locator('.from-field .contact').filter({hasText: secondAccount.emailAddress}).click();
      await until(() => run('!!window.releaseCollidingMove'), 'colliding move is waiting to reach the native engine');
      try {
        await run(`require('mailspring-exports').DraftStore._onPopoutDraft(${JSON.stringify(original.draftId)},
          {accountId:${JSON.stringify(secondAccount.id)}})`);
        await until(() => app.evaluate((_, windowKey) =>
          !!global.application.windowManager.draftWindowAccountChanges.get(windowKey)?.open, key),
        'the destination open is deferred during migration');
        assert.equal(await app.evaluate(registered, key), undefined);
      } finally {
        await run('window.releaseCollidingMove(); true');
      }
      await until(() => run(`require('mailspring-exports').DraftStore.cachedDraftSession(
        ${JSON.stringify(original.draftId)}, ${JSON.stringify(account.id)})?.changes.saveError?.message === 'draft-conflict'`),
      'refuse replacement of an existing draft in the destination account');
      const firstAccountDraft = await cli('draft-get', {accountId: account.id, draftId: original.draftId});
      const secondAccountDraft = await cli('draft-get', other);
      assert.equal(firstAccountDraft.subject, 'First account draft');
      assert.equal(secondAccountDraft.subject, 'Second account draft');
      assert.match(secondAccountDraft.body, /belongs to the second account/);
      const secondWindow = await until(() => app.evaluate(registered, key), 'the destination composer opens after the rejected move');
      assert.notEqual(secondWindow, firstWindow);
      assert.equal(await app.evaluate(registered, originalKey), firstWindow);
      fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
        phase, bothDraftsPreserved: true, rejectedMoveReleasesDeferredWindow: true,
      }, null, 2) + '\n');
      return;
    }
    await back.press('Enter');
    await waitForRows(2);
    await second.press('Enter');
    await editor.waitFor();
    assert.match(await editor.innerText(), /belongs to the second account/,
      'opening a second-account draft with the same header cannot select the first session');
    const firstRef = {accountId: account.id, draftId: original.draftId};
    const secondBefore = await cli('draft-get', other);
    const firstBefore = await cli('draft-get', firstRef);
    await cli('draft-update', {...firstRef, expectedRevision: firstBefore.revision, changes: {subject: 'First account updated'}});
    await until(() => run(`require('mailspring-exports').DraftStore
      .cachedDraftSession(${JSON.stringify(original.draftId)}, ${JSON.stringify(account.id)})?.draft()?.subject === 'First account updated'`),
    'receive an update for the sibling draft');
    assert.match(await editor.innerText(), /belongs to the second account/);
    assert.equal(await main.locator('.pr-subject-heading textarea').inputValue(), secondBefore.subject);
    const handoff = await run(`(async () => {
      const agent = require(AppEnv.getLoadSettings().resourcePath + '/internal_packages/mcp-server/lib/paper-reed-cli');
      const original = agent.agentHandoff;
      let captured;
      agent.agentHandoff = context => {
        captured = context;
        throw new Error('fixture stops before writing to the system clipboard');
      };
      try { await draftListProbe.workspace.copyContext(); }
      finally { agent.agentHandoff = original; }
      return captured;
    })()`);
    assert.equal(handoff?.scope, 'draft');
    assert.equal(handoff.accountId, secondAccount.id, 'the Agent handoff uses the selected draft account');
    assert.equal(handoff.draftId, original.draftId);
    const attachment = path.join(output, 'identity-fixture.txt');
    fs.writeFileSync(attachment, 'Attachment for the second fixture account only.');
    await run(`(async () => {
      const {AttachmentStore, DraftStore} = require('mailspring-exports');
      const session = await DraftStore.sessionForClientId(${JSON.stringify(other.draftId)}, ${JSON.stringify(other.accountId)});
      await AttachmentStore._onAddAttachment({
        headerMessageId: session.headerMessageId, accountId: session.accountId,
        filePath: ${JSON.stringify(attachment)},
      });
      await session.changes.commit();
    })()`);
    assert.deepEqual((await cli('draft-get', other)).files.map(file => file.filename), ['identity-fixture.txt']);
    assert.equal((await cli('draft-get', firstRef)).files.length, 0);
    await back.press('Enter');
    await waitForRows(2);
    assert(await run(`document.activeElement.dataset.draftAccountId === ${JSON.stringify(secondAccount.id)}`),
      'return focuses the second-account row even when both rows share the header');
    await second.press('Enter');
    await editor.waitFor();
    const send = await run(`(async () => {
      const {DraftStore} = require('mailspring-exports');
      const {SendActionsStore} = require(AppEnv.getLoadSettings().resourcePath + '/src/flux/stores/send-actions-store');
      const action = SendActionsStore.DefaultSendAction;
      const perform = action.performSendAction;
      let submitted;
      action.performSendAction = async ({draft}) => {
        submitted = {accountId: draft.accountId, body: draft.body, to: draft.to.map(contact => contact.email)};
      };
      try { await DraftStore._onSendDraft(${JSON.stringify(other.draftId)}, {accountId: ${JSON.stringify(other.accountId)}, delay: 0}); }
      finally { action.performSendAction = perform; }
      return submitted;
    })()`);
    assert.equal(send.accountId, secondAccount.id);
    assert.match(send.body, /belongs to the second account/);
    assert.deepEqual(send.to, ['other-recipient@example.test']);
    const result = {
      phase, scopedEditor: true, siblingUpdateIsolated: true, scopedHandoff: true,
      scopedAttachment: true, scopedReturn: true, scopedSendPreparation: true,
    };
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify(result, null, 2) + '\n');
    return;
  }
  if (phase === 'draft-upgrade-reused-identity') {
    assert(upgradeDesktop, 'start the profile on the v13 engine');
    const original = await create('Original draft before deletion');
    const ref = {accountId: account.id, draftId: original.draftId};
    const historicalCopy = await run(`(async () => {
      const core = require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core');
      const source = await core.getDraft(${JSON.stringify(ref)}, core.desktopAccess);
      const copy = await core.saveDraftCopy(source, core.desktopAccess);
      return {id: source.id, revision: source.version, copyHeader: copy.headerMessageId};
    })()`);
    await view('drafts');
    await waitForRows(2);
    await remove(original.draftId);
    await waitForRows(1);
    const replacement = await run(`(async () => {
      const {AccountStore, Message} = require('mailspring-exports');
      const core = require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core');
      const draft = new Message({
        accountId: ${JSON.stringify(ref.accountId)}, headerMessageId: ${JSON.stringify(ref.draftId)},
        version: 0, draft: true, pristine: false, date: new Date(),
        from: [AccountStore.accountForId(${JSON.stringify(ref.accountId)}).defaultMe()],
        subject: 'Unrelated replacement draft', body: 'This text belongs to the replacement alone.',
      });
      return core.saveDraft(draft, core.desktopAccess);
    })()`);
    assert.equal(replacement.savedDraftId, historicalCopy.id);
    assert.equal(replacement.savedDraftRevision, historicalCopy.revision);
    ({app, main, cdp} = await upgradeDesktop());
    await view('drafts');
    await main.locator(`[data-draft-id="${historicalCopy.copyHeader}"]`).press('Enter');
    const editor = main.locator('.pr-editor [contenteditable=true]');
    await editor.waitFor();
    assert.match(await editor.innerText(), /Saved draft for the isolated desktop fixture/);
    await main.getByRole('button', {name: '查看原稿', exact: true}).click();
    const sourceNotices = main.getByText('原稿暂不可用或已不在草稿箱。这份副本仍然保留。');
    const sourceWindows = () => app.windows().filter(page =>
      JSON.parse(new URL(page.url() || 'about:blank').searchParams.get('loadSettings') || '{}').windowType === 'composer');
    await until(async () => await sourceNotices.count() > 0 || sourceWindows().length > 0,
      'viewing the original produces a notice or opens a window');
    await capture('reused-identity-source');
    assert.equal(await sourceNotices.count(), 1, 'the old copy must not open the unrelated replacement');
    assert.equal(sourceWindows().length, 0);
    assert.match((await cli('draft-get', ref)).body, /belongs to the replacement alone/);
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
      phase, legacyIdentityReused: true, originalUnavailable: true,
      retainedCopyContent: true, replacementPreserved: true,
    }, null, 2) + '\n');
    return;
  }
  if (['draft-upgrade-provenance', 'draft-upgrade-duplicate-provenance'].includes(phase)) {
    const duplicate = phase === 'draft-upgrade-duplicate-provenance';
    assert(upgradeDesktop, 'the original profile must be created by an earlier installation');
    const original = await create('Source moved before upgrading', [{email:'recipient@example.test'}]);
    const ref = {accountId: account.id, draftId: original.draftId};
    const movedRef = {...ref, accountId: secondAccount.id};
    const copy = ref => run(`(async () => {
      const core = require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core');
      const draft = await core.getDraft(${JSON.stringify(ref)}, core.desktopAccess);
      return (await core.saveDraftCopy(draft, core.desktopAccess)).headerMessageId;
    })()`);
    const moveToSecond = async id => {
      await row(id).press('Enter');
      await main.locator('.from-field .only-item').click();
      await main.locator('.from-field .contact').filter({hasText: secondAccount.emailAddress}).click();
      await until(() => run(`require('mailspring-exports').DraftStore.cachedDraftSession(
        ${JSON.stringify(id)}, ${JSON.stringify(secondAccount.id)})?.accountId`),
      'the legacy engine moves the requested draft to the second account');
      await main.locator('.pr-editor .pr-back').press('Enter');
    };
    const oldCopy = await copy(ref);
    await view('drafts');
    await waitForRows(2);
    await moveToSecond(original.draftId);
    await waitForRows(2);
    assert.equal(await row(original.draftId).getAttribute('data-draft-account-id'), secondAccount.id);
    assert.doesNotMatch(await row(original.draftId).innerText(), /份恢复副本/,
      'the earlier installation leaves the link behind');
    let secondOldCopy;
    if (duplicate) {
      await moveToSecond(oldCopy);
      await waitForRows(2);
      secondOldCopy = await copy(movedRef);
      await waitForRows(3);
      assert.equal(await row(oldCopy).getAttribute('data-draft-account-id'), secondAccount.id);
      assert.equal(await row(secondOldCopy).getAttribute('data-draft-account-id'), secondAccount.id);
      for (const id of [oldCopy, secondOldCopy]) {
        assert.equal(await row(id).locator('.pr-copy-badge').innerText(), '恢复副本 1');
      }
      await capture('duplicate-before-upgrade');
    }

    ({app, main, cdp} = await upgradeDesktop());
    const newCopy = await copy(movedRef);
    await view('drafts');
    const upgradedList = main.locator('.pr-mail-list[aria-label="草稿"]');
    const currentRow = id => upgradedList.locator(`[data-draft-id="${id}"]`);
    const upgradedCount = count => until(async () => await upgradedList.locator('[data-draft-id]').count() === count &&
      await upgradedList.getAttribute('aria-busy') === 'false', 'upgraded draft list');
    await upgradedCount(duplicate ? 4 : 3);
    assert.match(await currentRow(original.draftId).innerText(),
      duplicate ? /原稿 · 3 份恢复副本/ : /原稿 · 2 份恢复副本/);
    assert.equal(await currentRow(oldCopy).locator('.pr-copy-badge').innerText(),
      duplicate ? '恢复副本 1-1' : '恢复副本 1');
    if (duplicate) assert.equal(await currentRow(secondOldCopy).locator('.pr-copy-badge').innerText(), '恢复副本 1-2');
    assert.equal(await currentRow(newCopy).locator('.pr-copy-badge').innerText(), '恢复副本 2');
    if (duplicate) await capture('duplicate-after-upgrade');
    await currentRow(duplicate ? secondOldCopy : oldCopy).press('Enter');
    await main.locator('.pr-recovery-origin strong').waitFor();
    assert.equal(await main.locator('.pr-recovery-origin strong').innerText(),
      duplicate ? '恢复副本 1-2' : '恢复副本 1');
    await main.getByRole('button', {name: '查看原稿', exact: true}).click();
    const composer = await until(async () => app.windows().find(page =>
      JSON.parse(new URL(page.url() || 'about:blank').searchParams.get('loadSettings') || '{}').windowType === 'composer'),
    'the pre-upgrade recovery copy opens its relocated original');
    composer.on('dialog', () => {});
    const composerCDP = await app.context().newCDPSession(composer);
    const props = await evaluate(composerCDP, 'AppEnv.getWindowProps()');
    assert.equal(props.accountId, secondAccount.id);
    assert.equal(props.headerMessageId, original.draftId);
    if (duplicate) {
      await main.locator('.pr-editor .pr-back').press('Enter');
      await upgradedCount(4);
      await run(`(async () => {
        const {Actions, DatabaseStore, Message} = require('mailspring-exports');
        const reviewed = await DatabaseStore.findBy(Message, {
          accountId: ${JSON.stringify(secondAccount.id)}, headerMessageId: ${JSON.stringify(oldCopy)}, draft: true,
        });
        Actions.destroyDraft(reviewed);
      })()`);
      await upgradedCount(3);
      assert.equal(await currentRow(secondOldCopy).locator('.pr-copy-badge').innerText(), '恢复副本 1-2',
        'retiring one copy must not change another copy’s suffix');
      const numbers = await run(`require('mailspring-exports').DatabaseStore._query(
        'SELECT copyNumber FROM PaperReedDraftRecovery ORDER BY copyNumber')`);
      assert.deepEqual(numbers.map(row => row.copyNumber), [1, 1, 2]);
    }
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
      phase, existingProfileUpgraded: true, originalCountsCopies: true,
      numberingContinues: true, oldCopyOpensRelocatedOriginal: true,
      ...(duplicate && {duplicateLabelsDistinct: true, consistentEditorLabel: true, stableAfterRemoval: true}),
    }, null, 2) + '\n');
    return;
  }
  if (phase === 'account-move-original-provenance') {
    const original = await create('Original with an existing recovery copy', [{email:'recipient@example.test'}]);
    const ref = {accountId: account.id, draftId: original.draftId};
    const movedRef = {...ref, accountId: secondAccount.id};
    const copy = ref => run(`(async () => {
      const core = require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core');
      const draft = await core.getDraft(${JSON.stringify(ref)}, core.desktopAccess);
      return (await core.saveDraftCopy(draft, core.desktopAccess)).headerMessageId;
    })()`);
    const first = await copy(ref);
    const composers = () => app.windows().filter(page =>
      JSON.parse(new URL(page.url() || 'about:blank').searchParams.get('loadSettings') || '{}').windowType === 'composer');
    await view('drafts');
    await waitForRows(2);
    await row(first).press('Enter');
    await main.locator('.pr-editor .show-popout').click();
    const savedCopy = await until(async () => composers()[0], 'an existing recovery copy opens in its own editor');
    savedCopy.on('dialog', () => {});
    const sourceButton = savedCopy.getByRole('button', {name: '查看原稿', exact: true});
    await sourceButton.waitFor();
    await view('drafts');
    await row(original.draftId).press('Enter');
    await main.locator('.from-field .only-item').click();
    await main.locator('.from-field .contact').filter({hasText: secondAccount.emailAddress}).click();
    await until(() => run(`require('mailspring-exports').DraftStore.cachedDraftSession(
      ${JSON.stringify(original.draftId)}, ${JSON.stringify(secondAccount.id)})?.accountId`),
    'the original draft has moved to the second account');
    const second = await copy(movedRef);
    await view('drafts');
    await waitForRows(3);
    assert.equal(await row(original.draftId).getAttribute('data-draft-account-id'), secondAccount.id);
    assert.match(await row(original.draftId).innerText(), /原稿 · 2 份恢复副本/);
    assert.match(await row(first).innerText(), /恢复副本 1/);
    assert.match(await row(second).innerText(), /恢复副本 2/);
    await sourceButton.click();
    const movedSource = await until(async () => composers().find(page => page !== savedCopy),
      'the already-open copy opens the relocated original');
    const movedSourceCDP = await app.context().newCDPSession(movedSource);
    assert.equal(await evaluate(movedSourceCDP, 'AppEnv.getWindowProps().accountId'), secondAccount.id);
    assert.equal(await evaluate(movedSourceCDP, 'AppEnv.getWindowProps().headerMessageId'), original.draftId);
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
      phase, originalKeepsCopyCount: true, nextNumberContinues: true, openCopyResolvesMovedOriginal: true,
    }, null, 2) + '\n');
    return;
  }
  if (phase === 'account-move-provenance') {
    const original = await create('Original in the first account', [{email: 'recipient@example.test'}]);
    const originalRef = {accountId: account.id, draftId: original.draftId};
    const copyId = await run(`(async () => {
      const core = require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core');
      const original = await core.getDraft(${JSON.stringify(originalRef)}, core.desktopAccess);
      return (await core.saveDraftCopy(original, core.desktopAccess)).headerMessageId;
    })()`);
    await view('drafts');
    await waitForRows(2);
    const copyRow = row(copyId);
    assert.equal(await copyRow.getAttribute('data-draft-account-id'), account.id);
    assert.match(await copyRow.innerText(), /恢复副本 1/);
    await copyRow.press('Enter');
    const openOriginal = main.getByRole('button', {name: '查看原稿', exact: true});
    await openOriginal.waitFor();
    await main.locator('.from-field .only-item').click();
    await main.locator('.from-field .contact').filter({hasText: secondAccount.emailAddress}).click();
    await until(() => run(`require('mailspring-exports').DraftStore.cachedDraftSession(
      ${JSON.stringify(copyId)}, ${JSON.stringify(secondAccount.id)})?.accountId`),
    'the recovery copy moves to the second account');
    await openOriginal.waitFor();
    await main.locator('.pr-editor .pr-back').press('Enter');
    await waitForRows(2);
    assert.equal(await copyRow.getAttribute('data-draft-account-id'), secondAccount.id);
    assert.match(await copyRow.innerText(), /恢复副本 1/);
    assert.match(await row(original.draftId).innerText(), /原稿 · 1 份恢复副本/);
    await copyRow.press('Enter');
    await openOriginal.click();
    const originalWindow = await until(async () => app.windows().find(page =>
      JSON.parse(new URL(page.url() || 'about:blank').searchParams.get('loadSettings') || '{}').windowType === 'composer'),
    'open the original account’s draft from the migrated copy');
    const originalCDP = await app.context().newCDPSession(originalWindow);
    assert.equal(await evaluate(originalCDP, 'AppEnv.getWindowProps().accountId'), account.id);
    const body = originalWindow.locator('[contenteditable=true]').first();
    await body.waitFor();
    assert.match(await body.innerText(), /Saved draft for the isolated desktop fixture/);
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
      phase, recoveryBadgeSurvivesMove: true, firstAccountRetainsOriginal: true, opensOriginalAccount: true,
    }, null, 2) + '\n');
    return;
  }
  const retainedWindowPhases = ['account-move-dirty-popout', 'account-move-roundtrip-delete', 'account-move-picker-popout'];
  if (['account-move-stale', 'account-move-attachments', ...retainedWindowPhases].includes(phase)) {
    await setupProbe();
    main.setDefaultTimeout(10000);
    const subject = 'Draft changing its sending account';
    const source = await create(subject, [{email: 'recipient@example.test'}]);
    const sourceRef = {accountId: account.id, draftId: source.draftId};
    const targetRef = {accountId: secondAccount.id, draftId: source.draftId};
    const header = JSON.stringify(source.draftId);
    const from = JSON.stringify(account.id);
    const to = JSON.stringify(secondAccount.id);
    const editor = page => page.locator('[contenteditable=true]').first();
    const changeFrom = async (page, destination = secondAccount) => {
      await page.locator('.from-field .only-item').click();
      await page.locator('.from-field .contact').filter({hasText: destination.emailAddress}).click();
    };
    const nativeAccounts = () => run(`require('mailspring-exports').DatabaseStore._query(
      "SELECT accountId FROM Message WHERE headerMessageId = ? AND draft = 1", [${header}])
      .then(rows => rows.map(row => row.accountId))`);
    const confirmMoved = () => until(async () => (await nativeAccounts()).join() === secondAccount.id,
      'native draft migration moves the single source to B', 10000);
    const composers = () => app.windows().filter(page =>
      JSON.parse(new URL(page.url() || 'about:blank').searchParams.get('loadSettings') || '{}').windowType === 'composer');
    await view('drafts');
    await row(source.draftId).press('Enter');
    await editor(main).waitFor();
    let result;
    if (phase === 'account-move-stale') {
      await editor(main).fill('Unsaved edits in the source editing session.');
      await until(() => run(`require('mailspring-exports').DraftStore.cachedDraftSession(
        ${header}, ${from}).changes.isDirty()`), 'the source editing session holds unsaved text');
      const visible = await cli('draft-get', sourceRef);
      await cli('draft-update', {...sourceRef, expectedRevision: visible.revision,
        changes:{body:'A newer source body saved in a separate client.'}});
      await changeFrom(main);
      await until(async () => (await nativeAccounts()).includes(secondAccount.id) || await run(
        `require('mailspring-exports').DraftStore.cachedDraftSession(${header}, ${from})?.changes.saveError?.message === 'draft-conflict'`),
      'migration either preserves the revision conflict or reaches the destination', 8000);
      assert.deepEqual(await nativeAccounts(), [account.id], 'migration must preserve the newer source revision and leave no target');
      assert.equal((await cli('draft-get', sourceRef)).body, 'A newer source body saved in a separate client.');
      assert.match(await editor(main).innerText(), /Unsaved edits in the source editing session/);
      result = {preservesNewerSourceAndUnsavedEdits:true};
    } else if (retainedWindowPhases.includes(phase)) {
      const picker = phase === 'account-move-picker-popout';
      const roundtrip = phase === 'account-move-roundtrip-delete';
      const edited = 'Unsaved edits belong to the original independent window.';
      const picked = path.join(output, 'chosen-in-original-window.txt');
      await main.locator('.pr-editor .show-popout').click();
      const previous = await until(async () => composers()[0], 'original independent editor');
      previous.on('dialog', () => {});
      const previousCDP = await app.context().newCDPSession(previous);
      await editor(previous).waitFor();
      if (picker) {
        fs.writeFileSync(picked, 'Retained attachment from the original window');
        await evaluate(previousCDP, `(() => {
          AppEnv.showOpenDialog = (_options, done) => { window.finishPicker = done; };
          return true;
        })()`);
        await previous.getByRole('button', {name: '添加附件', exact: true}).click();
        await until(() => evaluate(previousCDP, '!!window.finishPicker'), 'the original window opens the file chooser');
      } else {
        const body = editor(previous);
        await body.click();
        await body.press('Meta+A');
        await until(() => evaluate(previousCDP, 'getSelection().toString().includes("Saved draft for the isolated desktop fixture")'),
          'the original body is selected');
        await previous.keyboard.insertText(edited);
        await until(() => evaluate(previousCDP, `require('mailspring-exports').DraftStore.cachedDraftSession(
          ${header}, ${from}).changes.isDirty()`), 'the independent editor holds unsaved text');
      }
      const previousId = await evaluate(previousCDP, 'AppEnv.getCurrentWindow().id');
      await changeFrom(main);
      await confirmMoved();
      await run(`require('mailspring-exports').DraftStore._onPopoutDraft(${header}, {accountId: ${to}})`);
      const newKey = 'composer-' + JSON.stringify([source.draftId, secondAccount.id]);
      const requestedId = await until(() => app.evaluate(
        (_, key) => global.application.windowManager.get(key)?.browserWindow.id, newKey),
      'the B window is registered');
      if (picker) {
        await evaluate(previousCDP, `window.finishPicker([${JSON.stringify(picked)}]); true`);
        await until(() => requestedId === previousId || evaluate(previousCDP, `
          require('mailspring-exports').DraftStore.cachedDraftSession(${header}, ${from})?.draft()?.files.some(
            file => file.filename === 'chosen-in-original-window.txt')`),
        'the selected file reaches the retained editor');
      }
      assert.notEqual(requestedId, previousId, 'the window holding work cannot impersonate B');
      assert.equal(await evaluate(previousCDP, 'AppEnv.getWindowProps().accountId'), account.id);
      if (!picker) assert.equal((await editor(previous).innerText()).trim(), edited);
      const movedWindow = await until(async () => composers().find(page => page !== previous), 'new independent B editor');
      await editor(movedWindow).waitFor();
      assert.match(await editor(movedWindow).innerText(), /Saved draft for the isolated desktop fixture/);
      if (roundtrip) {
        const freshText = 'Newer text from the migrated editor must survive deletion.';
        const beforeEdit = await cli('draft-get', targetRef);
        const inB = await cli('draft-update', {...targetRef, expectedRevision: beforeEdit.revision,
          changes: {body: freshText}});
        await until(() => run(`require('mailspring-exports').DraftStore.cachedDraftSession(
          ${header}, ${to})?.draft()?.version === ${JSON.stringify(inB.revision)}`),
        'the migrated editor receives the newer persisted revision');
        await changeFrom(main, account);
        await until(async () => (await nativeAccounts()).join() === account.id, 'the updated draft returns to A');
        await evaluate(previousCDP, 'AppEnv.showErrorDialog = async message => { window.deleteWarning = message; }; true');
        await evaluate(previousCDP, `(() => {
          const menu = document.querySelector('.pr-compose-more');
          if (!menu.open) menu.querySelector('summary').click();
          const button = menu.querySelector('button');
          if (!menu.open || button.textContent.trim() !== '删除草稿') throw Error('draft menu unavailable');
          button.click();
          return true;
        })()`);
        await until(() => previous.isClosed() || evaluate(previousCDP, '!!window.deleteWarning').catch(() => false),
          'the original editor gets a deletion result');
        assert.equal(previous.isClosed(), false, 'reject deletion without closing the old editor');
        assert.match(await evaluate(previousCDP, 'window.deleteWarning'), /最新草稿和这里的编辑均已保留/);
        assert.equal((await editor(previous).innerText()).trim(), edited);
        const returned = await cli('draft-get', sourceRef);
        assert(returned.revision > inB.revision);
        assert.match(returned.body, new RegExp(freshText));
        await run(`require('mailspring-exports').DraftStore._onPopoutDraft(${header}, {accountId: ${from}})`);
        const key = 'composer-' + JSON.stringify([source.draftId, account.id]);
        const currentId = await until(() => app.evaluate(
          (_, windowKey) => global.application.windowManager.get(windowKey)?.browserWindow.id, key),
        'a fresh composer is registered for the returned draft');
        assert.notEqual(currentId, previousId, 'reopening A does not select the retained recovery editor');
        const current = await until(async () => composers().find(page => page !== previous), 'returned A editor');
        await until(async () => (await editor(current).innerText()).trim() === freshText,
          'the separately opened editor shows the newer body');
        fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
          phase, staleDeleteRejected: true, originalEditsRetained: true, currentDraftOpensSeparately: true,
        }, null, 2) + '\n');
        return;
      }
      await evaluate(previousCDP, `(() => {
        const {dialog} = require('@electron/remote');
        dialog.showMessageBox = async () => ({response: 1});
        setTimeout(() => AppEnv.close(), 0);
        return true;
      })()`);
      await until(async () => previous.isClosed(), 'save the dirty original window as a recovery copy', 10000);
      const copyId = await until(() => run(`require('mailspring-exports').DatabaseStore._query(
        "SELECT copyDraftId FROM PaperReedDraftRecovery WHERE accountId = ? AND sourceDraftId = ?", [${from}, ${header}])
        .then(rows => rows[0]?.copyDraftId)`), 'the original account owns the recovery copy', 8000);
      const copy = await cli('draft-get', {accountId:account.id,draftId:copyId});
      const moved = await cli('draft-get', targetRef);
      assert.match(copy.body, picker ? /Saved draft for the isolated desktop fixture/ : new RegExp(edited));
      assert.match(moved.body, /Saved draft for the isolated desktop fixture/);
      if (picker) {
        assert.deepEqual(copy.files.map(file => file.filename), ['chosen-in-original-window.txt']);
        assert.equal(moved.files.length, 0);
        result = {openPickerRetainsOriginalSession:true,chosenFileSavedInRecoveryCopy:true,movedDraftUnchanged:true};
      } else {
        result = {dirtyWindowKeepsOriginalIdentity:true,movedDraftOpensSeparately:true,dirtySourceCanSaveRecoveryCopy:true};
      }
    } else {
      const first = path.join(output, 'before-move.txt');
      const second = path.join(output, 'during-move.txt');
      const picked = path.join(output, 'from-open-picker.txt');
      for (const file of [first, second, picked]) fs.writeFileSync(file, path.basename(file));
      await run(`(() => {
        const {AttachmentStore, DraftStore} = require('mailspring-exports');
        const resource = AppEnv.getLoadSettings().resourcePath;
        const files = require(resource + '/src/services/mail-core/draft-files');
        const core = require(resource + '/src/services/mail-core');
        const {SendActionsStore} = require(resource + '/src/flux/stores/send-actions-store');
        const session = DraftStore.cachedDraftSession(${header}, ${from});
        const actualImport = files.importDraftFile;
        const actualSave = core.saveDraft;
        const actualMove = core.moveDraftToAccount;
        window.attachmentMove = {imports: {}};
        const probe = window.attachmentMove;
        files.importDraftFile = async file => {
          await new Promise(resolve => { probe.imports[file] = resolve; });
          return actualImport(file);
        };
        const holdMove = async () => {
          if (!probe.releaseMove) await new Promise(resolve => { probe.releaseMove = resolve; });
        };
        core.saveDraft = async (draft, ...rest) => {
          if (draft.accountId === ${to}) await holdMove();
          return actualSave(draft, ...rest);
        };
        if (typeof actualMove === 'function') core.moveDraftToAccount = async (...args) => {
          await holdMove();
          return actualMove(...args);
        };
        const ensure = session.ensureCorrectAccount.bind(session);
        session.ensureCorrectAccount = () => { probe.attempted = true; return ensure(); };
        probe.add = path => AttachmentStore._onAddAttachment({
          headerMessageId:${header}, accountId:${from}, filePath:path,
        });
        SendActionsStore.DefaultSendAction.performSendAction = async ({draft}) => {
          probe.sent = {accountId:draft.accountId, files:draft.files.map(file=>file.filename)};
        };
        AppEnv.showErrorDialog = async message => { probe.sendError = message; };
        probe.pending = () => AttachmentStore._pendingAddsByDraft.get(session);
        const showPicker = AppEnv.showOpenDialog;
        AppEnv.showOpenDialog = (_options, done) => { probe.finishPicker = done; };
        try { AttachmentStore._onSelectAttachment({headerMessageId:${header}, accountId:${from}}); }
        finally { AppEnv.showOpenDialog = showPicker; }
        void probe.add(${JSON.stringify(first)});
      })()`);
      await until(() => run(`!!attachmentMove.imports[${JSON.stringify(first)}]`), 'first file is waiting for import');
      await changeFrom(main);
      await until(() => run('attachmentMove.attempted'), 'account move was requested');
      await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
      assert.equal(await run('!!attachmentMove.releaseMove'), false, 'moving must wait for the first accepted attachment');
      await run(`attachmentMove.imports[${JSON.stringify(first)}](); true`);
      await until(() => run('!!attachmentMove.releaseMove'), 'the native move can begin after the first attachment');
      await run(`void attachmentMove.add(${JSON.stringify(second)}); true`);
      await until(() => run(`!!attachmentMove.imports[${JSON.stringify(second)}]`), 'second file accepted while the move is in progress');
      await run('attachmentMove.releaseMove(); true');
      await confirmMoved();
      await main.locator('.from-field').filter({hasText:secondAccount.emailAddress}).waitFor();
      await run(`attachmentMove.beforePicker = attachmentMove.pending();
        attachmentMove.finishPicker([${JSON.stringify(picked)}]); true`);
      await until(() => run('attachmentMove.pending() !== attachmentMove.beforePicker'), 'picker queues the file on the migrated session');
      await main.locator('.pr-editor .btn-send .primary-item').click();
      assert.equal(await run('!!attachmentMove.sent'), false, 'send must wait for the file accepted during the move');
      await run(`attachmentMove.imports[${JSON.stringify(second)}](); true`);
      await until(() => run(`!!attachmentMove.imports[${JSON.stringify(picked)}]`), 'picker file starts after the second import');
      assert.equal(await run('!!attachmentMove.sent'), false, 'send must also wait for the picker file');
      await run(`attachmentMove.imports[${JSON.stringify(picked)}](); true`);
      const sent = await until(() => run('attachmentMove.sent || attachmentMove.sendError'),
        'send preparation includes every accepted file', 8000);
      assert.deepEqual(sent, {accountId:secondAccount.id,
        files:['before-move.txt','during-move.txt','from-open-picker.txt']});
      result = {waitsForExistingImport:true,inFlightImportFollowsSession:true,openPickerFollowsSession:true,sendIncludesAllFiles:true};
    }
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({phase, ...result}, null, 2) + '\n');
    return;
  }
  if (['account-move-workspace', 'account-move-popout', 'account-move-agent'].includes(phase)) {
    await setupProbe();
    const subject = 'Draft changing its sending account';
    const original = await create(subject, [{email: 'recipient@example.test'}]);
    const target = {accountId: secondAccount.id, draftId: original.draftId};
    await view('drafts');
    await row(original.draftId).press('Enter');
    const draftid = JSON.stringify(original.draftId);
    const accountB = JSON.stringify(secondAccount.id);
    const standalone = phase === 'account-move-popout';
    const agent = phase === 'account-move-agent';
    const composers = () => app.windows().filter(page =>
      JSON.parse(new URL(page.url() || 'about:blank').searchParams.get('loadSettings') || '{}').windowType === 'composer');
    let page = main;
    if (standalone) {
      await main.locator('.pr-editor .show-popout').click();
      page = await until(async () => composers()[0], 'an existing independent editor');
      // Electron owns beforeunload on the subsequent reload.
      page.on('dialog', dialog => {
        if (dialog.type() !== 'beforeunload') void dialog.dismiss().catch(() => {});
      });
    }
    await page.locator('[contenteditable=true]').waitFor({timeout: 6000});
    const popupCDP = standalone ? await app.context().newCDPSession(page) : null;
    const standaloneKey = standalone ? 'composer-' + JSON.stringify([original.draftId, secondAccount.id]) : null;
    if (standalone) {
      await evaluate(popupCDP, `(() => {
        const core = require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core');
        const move = core.moveDraftToAccount;
        core.moveDraftToAccount = async (...args) => {
          const receipt = await move(...args);
          await new Promise(resolve => { window.releaseMoveReceipt = resolve; });
          return receipt;
        };
      })()`);
      await app.evaluate((_, key) => {
        const manager = global.application.windowManager;
        const defer = manager.deferDraftWindowOpen.bind(manager);
        manager.deferDraftWindowOpen = (windowKey, open) => {
          const deferred = defer(windowKey, open);
          if (windowKey === key) global.draftReopenDeferred = deferred;
          return deferred;
        };
      }, standaloneKey);
    }
    if (agent) {
      await run(`(() => {
        window.beforeMovingEditor = document.querySelector('.pr-editor [contenteditable=true]');
        window.beforeMovingSession = require('mailspring-exports').DraftStore.cachedDraftSession(
          ${draftid}, ${JSON.stringify(account.id)});
      })()`);
    }
    await page.locator('.from-field .only-item').click();
    await page.locator('.from-field .contact').filter({hasText: secondAccount.emailAddress}).click();
    await until(() => run(`require('mailspring-exports').DatabaseStore._query(
      "SELECT accountId FROM Message WHERE headerMessageId = ? AND draft = 1", [${draftid}])
      .then(rows => rows.length === 1 && rows[0].accountId === ${accountB})`), 'native draft migration A to B');

    if (agent) {
      main.setDefaultTimeout(8000);
      await run(`(() => {
        const cli = require(AppEnv.getLoadSettings().resourcePath + '/internal_packages/mcp-server/lib/paper-reed-cli');
        cli.agentHandoff = context => {
          window.movedDraftHandoff = context;
          throw new Error('fixture stops before writing to the system clipboard');
        };
      })()`);
      await main.locator('.pr-command-trigger').click();
      const command = main.getByRole('textbox', {name: '查找命令'});
      await command.fill('交给 Agent');
      await command.press('Enter');
      await until(() => run('window.movedDraftHandoff'), 'Agent receives the moved draft from the command panel', 5000);
      assert.equal((await run('window.movedDraftHandoff')).accountId, secondAccount.id);
      assert(await run(`(() => {
        const {DraftStore} = require('mailspring-exports');
        return document.querySelector('.pr-editor [contenteditable=true]') === window.beforeMovingEditor &&
          DraftStore.cachedDraftSession(${draftid}, ${accountB}) === window.beforeMovingSession &&
          !DraftStore.cachedDraftSession(${draftid}, ${JSON.stringify(account.id)});
      })()`), 'migration preserves the mounted editor and rekeys the same session');

      console.log('PASS moved draft Agent context, same attached editor and cached session');
      const edited = 'Edited immediately after changing accounts.';
      await main.locator('.pr-editor [contenteditable=true]').fill(edited);
      await run(`(() => {
        const {SendActionsStore} = require(AppEnv.getLoadSettings().resourcePath + '/src/flux/stores/send-actions-store');
        const {DraftStore} = require('mailspring-exports');
        const session = DraftStore.cachedDraftSession(${draftid}, ${accountB});
        const trace = [];
        session.changes.on('state', () => trace.push({
          dirty: session.changes.dirtyFields(), saving: session.changes.saving, body: session.draft().body,
          visible: !!document.querySelector('.pr-editor [contenteditable=true]'),
        }));
        AppEnv.showErrorDialog = async error => { window.moveSendError = {error, trace}; };
        SendActionsStore.DefaultSendAction.performSendAction = ({draft}) => {
          window.movedDraftSend = {accountId:draft.accountId, headerMessageId:draft.headerMessageId, body:draft.body};
          return new Promise(resolve => { window.finishSendProbe = resolve; });
        };
      })()`);
      await main.locator('.pr-editor .btn-send .primary-item').click();
      console.log('PROBE send activated');
      const prepared = await until(() => run('window.movedDraftSend || window.moveSendError'),
        'submit the body from the migrated session', 6000);
      assert.equal(prepared.accountId, secondAccount.id, JSON.stringify(prepared));
      console.log('PASS moved draft latest body reached the send action');
      assert(prepared.body.includes(edited));
      await until(() => run(`document.querySelector('.pr-editor [role=status]')?.textContent.includes('正在发送')`),
        'a pending send shows the moved draft sending state', 5000);
      assert.equal(await main.locator('.pr-editor [contenteditable=true]').count(), 0);
      await run('window.finishSendProbe(); true');
      console.log('PASS pending send uses the moved identity in the status view');
    } else if (standalone) {
      await until(() => evaluate(popupCDP, '!!window.releaseMoveReceipt'), 'the native move has committed before its editor applies the receipt');
      const originalWindowId = await evaluate(popupCDP, 'AppEnv.getCurrentWindow().id');
      try {
        await run(`require('mailspring-exports').DraftStore._onPopoutDraft(${draftid}, {accountId: ${accountB}})`);
        await until(() => app.evaluate(() => typeof global.draftReopenDeferred === 'boolean'),
          'the main process receives a destination window request before the receipt');
        assert.equal(await app.evaluate(() => global.draftReopenDeferred), true,
          'reopening the moved draft waits for the source window to process its receipt');
        assert.equal(composers().length, 1);
      } finally {
        await evaluate(popupCDP, 'window.releaseMoveReceipt(); true');
      }
      await until(async () => await page.locator('.from-field').innerText().then(text =>
        text.includes(secondAccount.emailAddress)), 'existing composer still shows the moved draft');
      const key = standaloneKey;
      const reopenedWindowId = await until(() => app.evaluate(
        (_, windowKey) => global.application.windowManager.get(windowKey)?.browserWindow.id, key),
      'the registered window for the moved account');
      assert.equal(reopenedWindowId, originalWindowId, 'reopening the moved draft must reuse the already-open composer');
      assert.equal(composers().length, 1);
      assert.equal(await evaluate(popupCDP, 'AppEnv.getWindowProps().accountId'), secondAccount.id,
        'the registered composer can reload under the moved account');
      assert.match(await page.locator('[contenteditable=true]').innerText(), /saved draft for the isolated desktop fixture/i);
      await app.evaluate(({BrowserWindow}, id) => BrowserWindow.fromId(id).webContents.reload(), originalWindowId);
      await page.locator('.from-field').filter({hasText: secondAccount.emailAddress}).waitFor();
      assert.match(await page.locator('[contenteditable=true]').innerText(), /saved draft for the isolated desktop fixture/i);
    } else {
      await main.locator('.pr-sidebar-bottom button').click();
      await until(() => run('!document.querySelector(".pr-workspace")'), 'leave the workspace for settings');
      await run(`(() => {
        const {Actions, WorkspaceStore} = require('mailspring-exports');
        Actions.selectRootSheet(WorkspaceStore.Sheet.Threads);
      })()`);
      await main.locator('.pr-workspace').waitFor();
      await until(() => run('!!document.querySelector(".pr-editor [contenteditable=true]")'),
        'the moved draft must stay open after visiting settings', 5000);
      assert.match(await main.locator('.pr-editor [contenteditable=true]').innerText(), /saved draft for the isolated desktop fixture/i);
      await run(`(() => {
        const {SendActionsStore} = require(AppEnv.getLoadSettings().resourcePath + '/src/flux/stores/send-actions-store');
        const action = SendActionsStore.DefaultSendAction;
        action.performSendAction = async ({draft}) => {
          window.movedDraftSend = {accountId:draft.accountId, headerMessageId:draft.headerMessageId};
        };
      })()`);
      await main.locator('.pr-editor .btn-send .primary-item').click();
      await until(() => run('window.movedDraftSend'), 'send preparation uses the moved draft identity', 5000);
      assert.deepEqual(await run('window.movedDraftSend'), {accountId: secondAccount.id, headerMessageId: original.draftId});
    }
    console.log('PROBE checking migrated draft via CLI');
    assert.equal((await cli('draft-get', target)).subject, subject);
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
      phase, nativeMigration: true, ...(agent
        ? {commandAgentUsesMovedDraft:true, editorAndSessionPreserved:true, sendUsesLatestBody:true, sendingStatus:true}
        : standalone ? {reusedAndReloadedIndependentWindow:true} : {settingsReturnAndSendUseMovedIdentity:true}),
    }, null, 2) + '\n');
    return;
  }
  if (phase === 'open-race') {
    await setupProbe();
    const draft = await create('Vanishing draft');
    await view('drafts');
    await waitForRows(1);
    await run(`(() => {
      const {DatabaseStore, Message} = require('mailspring-exports');
      const findBy = DatabaseStore.findBy;
      DatabaseStore.findBy = function(model, filter) {
        const query = findBy.call(this, model, filter);
        if (model !== Message || filter?.headerMessageId !== ${JSON.stringify(draft.draftId)} || !filter.draft) return query;
        DatabaseStore.findBy = findBy;
        return Promise.resolve(query).then(async result => {
          if (!result) throw new Error('fixture lookup did not read an existing draft');
          await new Promise(resolve => { draftListProbe.releaseOpen = resolve; });
          return result;
        });
      };
    })()`);
    await row(draft.draftId).press('Enter');
    await until(() => run('typeof draftListProbe.releaseOpen === "function"'), 'hold a captured draft lookup');
    await remove(draft.draftId);
    await waitForRows(0);
    await run('draftListProbe.releaseOpen()');
    await until(() => run('!draftListProbe.workspace.moving'), 'settle the original open action');
    assert.equal(await run('draftListProbe.workspace.state.route'), 'list',
      'a draft deleted while its lookup is pending cannot enter the editor');
    assert.equal(await main.locator('.pr-editor').count(), 0);
    await newDraft.waitFor();
    assert(await run("document.activeElement.matches('.pr-drafts-empty button')"));
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({phase, deletedDraftRemainsInList: true}, null, 2) + '\n');
    return;
  }
  if (phase === 'pagination') {
    for (let start = 0; start < 52; start += 4) {
      await Promise.all(Array.from({length: 4}, (_, offset) => create('Fixture draft ' + (start + offset))));
    }
    const tiedIds = await run(`(async () => {
      const {DatabaseStore} = require('mailspring-exports');
      await DatabaseStore._localTransaction([{
        query: 'UPDATE Message SET date=? WHERE accountId=? AND draft=1',
        values: [Date.now() / 1000 | 0, ${JSON.stringify(account.id)}],
      }]);
      return (await DatabaseStore._query(
        'SELECT headerMessageId FROM Message WHERE accountId=? AND draft=1 ORDER BY id',
        [${JSON.stringify(account.id)}])).map(row => row.headerMessageId);
    })()`);
    assert.equal(tiedIds.length, 52);
    await view('drafts');
    await waitForRows(50);
    assert.deepEqual(await ids(), tiedIds.slice(0, 50), 'equal-date drafts sort by ID before pagination');
    const more = draftList.getByRole('button', {name: '加载更多'});
    await more.focus();
    await run("AppEnv.commands.dispatch('navigation:go-to-inbox')");
    await main.getByRole('heading', {name: '收件箱', exact: true}).waitFor();
    assert(await run("document.activeElement.matches('.pr-search-input')"));
    await view('drafts');
    await waitForRows(50);
    await more.press('Enter');
    await waitForRows(52);
    assert.deepEqual(await ids(), tiedIds);
    assert.equal(await focusedDraft(), tiedIds[50], 'pagination focuses the first newly loaded draft');
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
      phase, tiedDateOrder: true, navigationFocus: true, paginationFocus: true,
    }, null, 2) + '\n');
    return;
  }
  if (phase !== 'before') {
    await setupProbe();
    await run('draftListProbe.pause = true');
  }
  await view('drafts');
  if (phase !== 'before') {
    await until(() => run('typeof draftListProbe.resume === "function"'), 'hold initial draft read');
    assert.equal(await draftList.getByRole('status').filter({hasText: '正在读取草稿'}).count(), 1,
      'loading drafts has a distinct status');
    assert.equal(await newDraft.count(), 0, 'a pending read cannot show the confirmed empty state');
    assert.equal(await main.locator('.pr-list-caption').count(), 0);
    await capture('drafts-reading');
    await run('draftListProbe.pause = false; draftListProbe.resume()');
  }
  await waitForRows(0);
  await capture('drafts-empty');
  if (phase !== 'before') {
    await draftList.getByRole('status').filter({hasText: '暂无草稿'}).waitFor();
    await newDraft.focus();
  }
  const recipients = [
    {name: '林微', email: 'lin@example.test'},
    {name: 'Riley Chen', email: 'riley@example.test'},
    {name: 'Parker Green', email: 'parker@example.test'},
  ];
  const original = await create('项目评审纪要与下周计划：一封标题较长的未发送草稿', recipients);
  await waitForRows(1);
  if (phase !== 'before') assert.equal(await focusedDraft(), original.draftId,
    'a draft added from CLI receives focus when the focused empty button disappears');
  const blank = await create('');
  const plain = await create('会议后续', [{email: 'team@example.test'}]);
  const copy = await run(`(async () => {
    const core = require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core');
    const draft = await core.getDraft(${JSON.stringify({accountId: account.id, draftId: original.draftId})}, core.desktopAccess);
    return (await core.saveDraftCopy(draft, core.desktopAccess)).headerMessageId;
  })()`);
  await waitForRows(4);
  await capture('drafts-desktop', 1440, 860);
  await capture('drafts-compact');
  await capture('drafts-narrow', 740, 700);
  if (phase === 'before') {
    fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({phase, nativeDrafts: 4}, null, 2) + '\n');
    return;
  }
  assert.match(await row(blank.draftId).innerText(), /无主题\s+未填写收件人/);
  assert.match(await row(plain.draftId).innerText(), /会议后续/);
  assert.match(await row(original.draftId).innerText(), /林微、Riley Chen 等 3 人/);
  assert.match(await row(original.draftId).innerText(), /原稿 · 1 份恢复副本/);
  assert.equal(await row(copy).locator('.pr-copy-badge').innerText(), '恢复副本 1');
  assert(await run(`(() => {
    const pane = document.querySelector('.pr-main');
    const rows = Array.from(document.querySelectorAll('.pr-draft-row'));
    return pane.scrollWidth <= pane.clientWidth && rows.every(row =>
      row.querySelector('time').getBoundingClientRect().right <= row.getBoundingClientRect().right);
  })()`), 'dates and recovery labels fit in a narrow window');
  assert.equal(await main.locator('.pr-page-head .pr-agent-button').count(), 0);

  await row(copy).focus();
  await run('draftListProbe.fail = true; draftListProbe.workspace.refresh()');
  const error = main.getByRole('alert').filter({hasText: '草稿暂时无法读取'});
  await error.waitFor();
  assert.equal(await rows.count(), 4);
  assert.equal(await main.locator('.pr-list-caption').count(), 0);
  assert(await row(copy).isDisabled());
  await run(`document.querySelector('[data-draft-id="${copy}"]').click()`);
  assert.equal(await main.locator('.pr-editor').count(), 0);
  await capture('drafts-read-failed');
  const retry = error.getByRole('button', {name: '重新读取'});
  await retry.focus();
  await run(`document.activeElement.addEventListener('click', () => {
    draftListProbe.fail = false;
  }, {capture: true, once: true})`);
  await retry.press('Enter');
  await waitForRows(4);
  assert(!(await row(copy).isDisabled()));
  assert(await run("document.activeElement.matches('.pr-search-input')"));

  await row(copy).press('Enter');
  await main.locator('.pr-editor [contenteditable=true]').waitFor();
  const editingId = await run('draftListProbe.workspace.state.selected.headerMessageId');
  assert.equal(editingId, copy, 'the recovery copy opens under its own draft identity');
  await main.locator('.pr-editor .pr-back').press('Enter');
  await waitForRows(4);
  assert.equal(await focusedDraft(), copy, 'return from the editor restores the same draft');

  const ordered = await ids();
  await row(ordered[1]).focus();
  await remove(ordered[1]);
  await waitForRows(3);
  assert.equal(await focusedDraft(), ordered[2], 'removing the focused draft transfers focus to the next surviving draft');
  await search.focus();
  await remove(ordered[0]);
  await waitForRows(2);
  assert(await run("document.activeElement.matches('.pr-search-input')"), 'background changes preserve an independent focus');
  await remove(ordered[3]);
  await waitForRows(1);
  await row(ordered[2]).focus();
  await remove(ordered[2]);
  await waitForRows(0);
  assert(await run("document.activeElement.matches('.pr-drafts-empty button')"),
    'removing the last draft transfers focus to the write action');
  await newDraft.press('Enter');
  await main.locator('.pr-editor [contenteditable=true]').waitFor();
  assert.equal(await run('draftListProbe.workspace.state.selected.accountId'), account.id);
  fs.writeFileSync(path.join(output, 'result.json'), JSON.stringify({
    phase, distinctLoadingAndEmpty: true, recipientsAndRecovery: true, narrowFits: true,
    readFailureAndRetry: true, opensRecoveryByIdentity: true, focusFromEditorAndRemoval: true, emptyActionCreatesDraft: true,
  }, null, 2) + '\n');
};
