const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function connectMailbox(window, fixture) {
  const setup = window.locator('.page-container:not([inert])');
  const field = key => setup.locator(`[id="settings.${key}"]`);
  await setup.locator('[data-provider=imap]').click();
  await setup.locator('#name').fill('Maya Chen');
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
}

module.exports = async ({ phase, app, currentWindow, selectWindow, run, until, shot, out, fixture, work }) => {
  await connectMailbox(currentWindow(), fixture);
  await selectWindow('default');
  const inbox = currentWindow();
  const list = inbox.locator('.pr-mail-list');
  const empty = list.getByRole('status');
  const rows = list.locator('.pr-mail-row');
  const unread = inbox.getByRole('checkbox', { name: '仅未读' });
  const showAll = list.getByRole('button', { name: '显示全部邮件', exact: true });
  const title = text => empty.getByText(text, { exact: true });
  const paint = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const waitForLocalList = () => inbox.locator('.pr-mail-list[aria-busy=false]').waitFor();
  const fixturePath = name => path.join(work, name);
  const takeScreens = async (state, compactOnly = false) => {
    const sizes = [['desktop', 1440, 860], ['compact', 900, 640]];
    for (const [label, width, height] of compactOnly ? sizes.slice(1) : sizes) {
      await run(`require('@electron/remote').getCurrentWindow().setContentSize(${width},${height});true`);
      await until(() => run(`innerWidth===${width} && innerHeight===${height}`), `inbox ${width} × ${height}`, 5000);
      await paint();
      assert(await run('document.documentElement.scrollWidth <= innerWidth'));
      await shot(`${phase}-inbox-${state}-${label}`);
    }
  };
  await until(() => fs.existsSync(fixturePath('inbox-scan-held')), 'native inbox STATUS held');
  await waitForLocalList();
  assert.equal(await rows.count(), 0);
  await takeScreens('syncing');
  if (phase !== 'before') {
    assert.match(await empty.innerText(), /正在同步收件箱/);
    assert.equal(await inbox.locator('.pr-list-caption').count(), 0);
    assert.equal(await inbox.getByText('收件箱为空', { exact: true }).count(), 0);
    await inbox.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await run(`getComputedStyle(document.querySelector('.pr-inbox-empty-icon'), '::before').animationName`), 'none');
    await inbox.emulateMedia({ reducedMotion: 'no-preference' });
  }

  await app.context().setOffline(true);
  try {
    await inbox.getByText(/当前离线/).waitFor();
    if (phase !== 'before') {
      await empty.getByText('本机暂无收件箱邮件', { exact: true }).waitFor();
      assert.equal(await inbox.locator('.pr-list-caption').count(), 0);
    }
    await takeScreens('offline', true);
  } finally {
    await app.context().setOffline(false);
  }

  fs.writeFileSync(fixturePath('release-inbox-scan'), '');
  await until(() => run(`(()=>{
    const { AccountStore, CategoryStore } = require('mailspring-exports');
    const inbox = CategoryStore.getInboxCategory(AccountStore.accountIds()[0]);
    return inbox?.localStatus?.busy === false && Number.isFinite(inbox.localStatus.syncedMinUID);
  })()`), 'native inbox finished empty scan');
  await waitForLocalList();
  if (phase !== 'before') await empty.getByText('收件箱为空', { exact: true }).waitFor();
  assert.equal(await rows.count(), 0);
  await takeScreens('empty');

  if (phase !== 'before') {
    await run(`(()=>{
      const root = AppEnv.getLoadSettings().resourcePath;
      const core = require(root + '/src/services/mail-core/inbox');
      const agent = require(root + '/internal_packages/mcp-server/lib/paper-reed-cli');
      const clipboard = require('@electron/remote').clipboard;
      const { queryInbox } = core, { agentHandoff } = agent, { writeText } = clipboard;
      core.queryInbox = async () => { throw new Error('fixture inbox read error'); };
      agent.agentHandoff = () => 'fixture mail handoff';
      clipboard.writeText = (text) => { window.fixtureHandoff = text; };
      window.resumeInboxRead = () => { core.queryInbox = queryInbox; };
      window.restoreReadProbe = () => {
        window.resumeInboxRead(); agent.agentHandoff = agentHandoff; clipboard.writeText = writeText;
      };
      return true;
    })()`);
    const error = inbox.getByRole('alert').filter({ hasText: '邮件暂时无法读取' });
    try {
      await inbox.locator('[data-mailbox=inbox]').click();
      await error.waitFor();
      await run(`document.querySelector('.pr-search-input').focus();
        AppEnv.commands.dispatch('paper-reed:agent'); true`);
      await until(() => run("window.fixtureHandoff==='fixture mail handoff'"), 'real Agent copy action');
      await error.waitFor({ timeout: 4000 });
      assert.equal(await title('收件箱为空').count(), 0);
      assert.equal(await inbox.locator('.pr-list-caption').count(), 0);
      await inbox.locator('.pr-agent-button').click();
      await takeScreens('read-error', true);
      await run('window.resumeInboxRead();true');
      await error.getByRole('button', { name: '重新读取' }).click();
      await title('收件箱为空').waitFor();
      assert.equal(await error.count(), 0);
    } finally {
      await run('window.restoreReadProbe();delete window.restoreReadProbe;delete window.resumeInboxRead;delete window.fixtureHandoff;true');
    }

    const second = JSON.parse(fs.readFileSync(fixturePath('second-inbox.json'), 'utf8'));
    const secondAddress = JSON.stringify(second.emailAddress);
    await run(`(()=>{
      const { AccountStore, CategoryStore } = require('mailspring-exports');
      const core = require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core/inbox');
      const original = core.queryInbox;
      const pending = [];
      window.secondInboxRead = {
        pending, account: () => AccountStore.accounts().find(a => a.emailAddress === ${secondAddress}),
        async ready() {
          const account = this.account();
          if (!account || CategoryStore.getInboxCategory(account.id)?.displayType() !== 'label') return false;
          const progress = CategoryStore.getAllMailCategory(account.id)?.localStatus;
          if (progress?.busy !== false || progress.syncedMinUID > 1) return false;
          const rows = await original({ accountIds: [account.id], folder: 'inbox', limit: 10 }, core.inboxDesktopAccess);
          return rows.some(row => row.subject === 'Second inbox mail');
        },
        release() { core.queryInbox = original; pending.splice(0).forEach(read => read()); },
      };
      core.queryInbox = (request, access) => {
        const account = window.secondInboxRead.account();
        if (!account || !request.accountIds.includes(account.id)) return original(request, access);
        return new Promise(resolve => pending.push(resolve)).then(() => original(request, access));
      };
      require('electron').ipcRenderer.send('command', 'application:add-account');
      return true;
    })()`);
    await selectWindow('onboarding');
    await connectMailbox(currentWindow(), second);
    await selectWindow('default');
    assert.equal(currentWindow(), inbox);
    try {
      await until(() => run('window.secondInboxRead.pending.length && window.secondInboxRead.ready()'), 'new mailbox scanned while combined list read is paused');
      await title('正在读取收件箱').waitFor({ timeout: 4000 });
      assert.equal(await title('收件箱为空').count(), 0);
      assert.equal(await inbox.locator('.pr-list-caption').count(), 0);
    } finally {
      await run('window.secondInboxRead.release();delete window.secondInboxRead;true');
    }
    await rows.getByText('Second inbox mail', { exact: true }).waitFor();
    const secondID = await run(
      `require('mailspring-exports').AccountStore.accounts().find(a => a.emailAddress === ${secondAddress}).id`
    );
    await run(`((id)=>{
      const { AccountStore, CategoryStore } = require('mailspring-exports');
      const core = require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core/inbox');
      const account = AccountStore.accountForId(id);
      const getByRole = CategoryStore.getCategoryByRole;
      const categories = CategoryStore.categories;
      const usesLabels = account.usesLabels;
      const queryInbox = core.queryInbox;
      const pending = [];
      let restoreWorkspaceRefresh = () => {};
      account.usesLabels = () => true;
      const hideInbox = () => {
        CategoryStore.getCategoryByRole = function (accountId, role) {
          return accountId === id && role === 'inbox' ? null : getByRole.call(this, accountId, role);
        };
        CategoryStore.categories = function (accountOrId) {
          return categories.call(this, accountOrId).filter(cat => cat.accountId !== id || cat.role !== 'inbox');
        };
      };
      const showInbox = () => {
        CategoryStore.getCategoryByRole = getByRole;
        CategoryStore.categories = categories;
      };
      hideInbox();
      window.gmailInboxMapping = {
        pending,
        recover() {
          core.queryInbox = (request, access) => {
            if (!request.accountIds.includes(id)) return queryInbox(request, access);
            return new Promise(resolve => pending.push(resolve)).then(() => queryInbox(request, access));
          };
          showInbox();
          CategoryStore.trigger();
        },
        holdScheduledRefresh() {
          const node = document.querySelector('.pr-workspace');
          let fiber = node[Object.keys(node).find(key => key.startsWith('__reactFiber'))];
          while (fiber && !fiber.stateNode?.refreshOperations) fiber = fiber.return;
          const workspace = fiber.stateNode;
          this.read = workspace.refresh;
          restoreWorkspaceRefresh = () => { workspace.refresh = this.read; };
          workspace.refresh = () => {};
        },
        async readAcrossMappingChanges() {
          const inboxID = CategoryStore.getInboxCategory(id)?.id;
          const version = CategoryStore.getAllMailCategory(id)?.version;
          let readCount;
          core.queryInbox = async (request, access) => {
            if (!request.accountIds.includes(id)) return queryInbox(request, access);
            hideInbox();
            CategoryStore.trigger();
            try {
              const rows = await queryInbox(request, access);
              readCount = rows.length;
              return rows;
            } finally {
              showInbox();
              CategoryStore.trigger();
            }
          };
          try {
            await this.read();
            return {
              readCount,
              sameMapping: Boolean(inboxID) && CategoryStore.getInboxCategory(id)?.id === inboxID,
              sameScan: Number.isInteger(version) && CategoryStore.getAllMailCategory(id)?.version === version,
            };
          } finally {
            core.queryInbox = queryInbox;
          }
        },
        restore() {
          account.usesLabels = usesLabels;
          core.queryInbox = queryInbox;
          showInbox();
          restoreWorkspaceRefresh();
          pending.splice(0).forEach(resolve => resolve());
        },
      };
      return true;
    })(${JSON.stringify(secondID)})`);
    try {
      await inbox.locator('#pr-account').selectOption(secondID);
      await waitForLocalList();
      assert.equal(await rows.count(), 0, 'Gmail with no Inbox label yields zero rows through the production filter');
      assert.equal(await title('收件箱为空').count(), 0, 'a completed All Mail scan cannot confirm an unmapped Inbox');
      await title('暂时无法确认收件箱内容').waitFor({ timeout: 4000 });
      const retry = list.getByRole('button', { name: '重试同步', exact: true });
      assert(await retry.isEnabled());
      await unread.check();
      await waitForLocalList();
      await title('暂时无法确认收件箱内容').waitFor();
      assert.equal(await title('没有未读邮件').count(), 0);
      assert(await retry.isEnabled());
      assert(await showAll.isEnabled());
      await takeScreens('gmail-unmapped', true);
      await showAll.press('Enter');
      assert.equal(await unread.isChecked(), false);
      await waitForLocalList();
      await title('暂时无法确认收件箱内容').waitFor();
      await run('window.gmailInboxMapping.recover();true');
      await until(() => run('window.gmailInboxMapping.pending.length > 0'), 'Inbox mapping restored and list read paused');
      await title('正在读取收件箱').waitFor();
      assert.equal(await title('收件箱为空').count(), 0);
      assert.equal(await rows.count(), 0);
      await run('window.gmailInboxMapping.restore();true');
      await rows.getByText('Second inbox mail', { exact: true }).waitFor();

      // A transient mapping must not certify a stale zero-row read, even with no newer read yet.
      await run('window.gmailInboxMapping.holdScheduledRefresh();true');
      await inbox.locator('[data-mailbox=inbox]').click();
      await inbox.locator('.pr-mail-list[aria-busy=true]').waitFor();
      const transient = await run('window.gmailInboxMapping.readAcrossMappingChanges()');
      assert.deepEqual(transient, { readCount: 0, sameMapping: true, sameScan: true });
      await paint();
      assert.equal(await title('收件箱为空').count(), 0, 'a transient Inbox mapping cannot certify an empty list');
      await title('正在读取收件箱').waitFor({ timeout: 4000 });
      await run('window.gmailInboxMapping.restore();window.gmailInboxMapping.read()');
    } finally {
      await run('window.gmailInboxMapping.restore();delete window.gmailInboxMapping;true');
    }
    await rows.getByText('Second inbox mail', { exact: true }).waitFor();
  }

  const originalAccountID = await run(
    `require('mailspring-exports').AccountStore.accounts().find(a => a.emailAddress === ${JSON.stringify(fixture.emailAddress)}).id`
  );
  await inbox.locator('#pr-account').selectOption(originalAccountID);
  await waitForLocalList();

  fs.writeFileSync(fixturePath('deliver-first-inbox-mail'), '');
  await until(() => fs.existsSync(fixturePath('first-inbox-mail-delivered')), 'first mail delivered to fixture');
  await run('AppEnv.mailsyncBridge.sendSyncMailNow();true');
  await rows.getByText('First inbox arrival', { exact: true }).waitFor();
  assert.equal(await rows.count(), 1);
  assert.equal(await empty.count(), 0);
  await takeScreens('loaded');

  if (phase !== 'before') {
    await unread.check();
    await empty.getByText('没有未读邮件', { exact: true }).waitFor();
    await takeScreens('unread', true);
    await app.context().setOffline(true);
    try {
      await title('本机暂无未读邮件').waitFor();
      assert.equal(await title('本机暂无收件箱邮件').count(), 0);
      assert.equal(await inbox.locator('.pr-list-caption').count(), 0);
      await takeScreens('offline-unread', true);
      await showAll.focus();
      await inbox.keyboard.press('Enter');
      await rows.getByText('First inbox arrival', { exact: true }).waitFor();
      assert.equal(await unread.isChecked(), false);
      assert(await run(`document.activeElement === document.querySelector('.pr-unread-filter input')`));
    } finally {
      await app.context().setOffline(false);
    }
  }

  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({
    ...(phase !== 'before' ? {
      pendingIsNotEmpty: true, reducedMotion: true, offlineIsNotEmpty: true,
      clearOfflineUnreadFilterViaKeyboard: true, localReadFailureSurvivesAgentCopy: true,
      localReadFailureCanRetry: true, combinedRangeWaitsForCurrentRead: true,
      unmappedGmailInboxIsNotEmpty: true, gmailMappingRecoveryWaitsForRead: true,
      transientGmailMappingInvalidatesEmptyRead: true,
    } : {}),
    nativeInboxScanHeld: true, actualEmptyInbox: true, nativeInboxReceivedFirstMail: true,
  }, null, 2) + '\n');
  console.log('PASS first inbox arrival, empty scan and real fixture arrival');
};
