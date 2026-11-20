const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  checkHandoffRecovery, checkReloadedWorkspaceHandoff, injectConfigNotificationFailure, checkAbandonedSave,
} = require('./check-account-handoff.cjs');

const accountStore = 'require("mailspring-exports").AccountStore';

module.exports = async ({
  phase, app, currentWindow, selectWindow, run, until, shot, out, fixture, checkAccountSaveLocked,
}) => {
  const activePage = () => currentWindow().locator('.page-container:not([inert])');
  const field = key => activePage().locator(`[id="settings.${key}"]`);
  const connect = () => activePage().getByRole('button', { name: '连接邮箱', exact: true });
  const status = () => activePage().getByRole('status');
  const statusNode = 'document.querySelector(".page-container:not([inert]) .pr-account-save-status")';
  const paint = () => run('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const settled = async () => {
    await status().waitFor();
    await until(() => run('!document.querySelector(".alpha-fade-enter, .alpha-fade-exit")'), 'save screen transition complete');
    await run('document.fonts.ready.then(()=>true)');
    await paint();
  };
  const resize = async (width, height) => {
    await run(`require('@electron/remote').getCurrentWindow().setContentSize(${width},${height});true`);
    await until(() => run(`innerWidth===${width} && innerHeight===${height}`), `save window ${width} × ${height}`, 5000);
    await paint();
  };
  const installProbe = ({ reconnect = false } = {}) => run(`(()=>{
    const ipc=require('electron').ipcRenderer;
    const AccountStore=${accountStore};
    const {invoke,send}=ipc;
    const addAccount=AccountStore.addAccount;
    const dialog=AppEnv.showErrorDialog;
    const reportError=AppEnv.reportError;
    const probe=window.prSaveProbe={writes:0,handoffs:0,errors:[]};
    probe.pauseAndRejectSave=()=>{
      AccountStore.addAccount=()=>new Promise((_resolve,reject)=>{
        probe.failSave=()=>{
          AccountStore.addAccount=addAccount;
          // Keep dev tools closed for the expected failure in the screenshot run.
          reject(Object.assign(new Error('fixture account save failure'), {noSentry:true}));
        };
      });
    };
    ipc.invoke=function(channel,...args){
      if(channel!==${JSON.stringify(phase === 'before' ? 'credentials:update' :
        reconnect ? 'credentials:reconnect-account' : 'credentials:add-account')})
        return invoke.call(this,channel,...args);
      probe.writes++;
      return new Promise((resolve,reject)=>{
        probe.releaseWrite=()=>invoke.call(this,channel,...args).then(resolve,reject);
      });
    };
    ipc.send=function(channel,...args){
      if(channel!=='account-setup-successful')return send.call(this,channel,...args);
      probe.handoffs++;
      probe.releaseHandoff=()=>send.call(this,channel,...args);
    };
    AppEnv.showErrorDialog=options=>{probe.errors.push(options.title);};
    AppEnv.reportError=function(error,...args){
      if (!error.message.includes('fixture account save')) reportError.call(this,error,...args);
    };
    probe.restore=()=>{
      ipc.invoke=invoke;
      ipc.send=send;
      AccountStore.addAccount=addAccount;
      AppEnv.showErrorDialog=dialog;
      AppEnv.reportError=reportError;
    };
    return true;
  })()`);
  const resumeHandoff = async (timeout) => {
    const onboarding = currentWindow();
    await run('window.prSaveProbe.restore();true');
    await run('setTimeout(window.prSaveProbe.releaseHandoff,0);true');
    await until(() => onboarding.isClosed(), 'onboarding window closed after real handoff', timeout);
    await selectWindow('default');
  };
  const checkNativeCloseAndQuit = async () => {
    const result = await app.evaluate(async ({ app }) => {
      const application = global.application;
      const window = application.windowManager.get('onboarding').browserWindow;
      let closeBlocked;
      window.once('close', event => { closeBlocked = event.defaultPrevented; });
      window.close();
      let quitBlocked;
      app.once('before-quit', event => { quitBlocked = event.defaultPrevented; });
      application.emit('application:quit');
      let reloads = 0;
      const contents = window.webContents;
      const reload = contents.reload;
      contents.reload = () => { reloads++; };
      let reloading;
      try {
        reloading = await contents.executeJavaScript(`new Promise(resolve => {
          AppEnv.reload();
          require('electron').ipcRenderer.send('call-webcontents-method', 'reload');
          setTimeout(() => resolve(!!AppEnv.isReloading), 30);
        })`);
      } finally {
        contents.reload = reload;
      }
      return { closeBlocked, quitBlocked, reloads, reloading, open: !window.isDestroyed() };
    });
    assert.deepEqual(result, { closeBlocked: true, quitBlocked: true, reloads: 0, reloading: false, open: true });
  };
  const installFaults = address => app.evaluate(({ app }, mailbox) => {
    const fs = process.mainModule.require('node:fs');
    const { secureStorage } = process.mainModule.require(app.getAppPath() + '/src/browser/credential-store');
    const manager = global.application.configPersistenceManager;
    const priorAuth = manager.settings.accounts?.find(account => account.emailAddress === mailbox)?.authedAt;
    const { encrypt } = secureStorage;
    const { renameSync } = fs;
    const summarize = settings => ({
      accounts: settings.accounts || [], version: settings.accountsVersion || 0,
      credentials: settings.credentials || null,
    });
    const fault = global.prAccountSaveFault = {
      point: null,
      failures: 0,
      snapshot: () => ({
        memory: summarize(manager.settings),
        disk: summarize(JSON.parse(fs.readFileSync(manager.configFilePath, 'utf8'))['*']),
      }),
      restore: () => {
        secureStorage.encrypt = encrypt;
        fs.renameSync = renameSync;
        delete global.prAccountSaveFault;
      },
    };
    secureStorage.encrypt = async text => {
      if (fault.point === 'keychain') {
        fault.failures++;
        throw new Error('fixture account save keychain unavailable');
      }
      return encrypt(text);
    };
    fs.renameSync = (source, destination) => {
      if (fault.point === 'disk' && destination === manager.configFilePath) {
        const staged = JSON.parse(fs.readFileSync(source, 'utf8'))['*'];
        if (staged.accounts?.some(account => account.emailAddress === mailbox && account.authedAt !== priorAuth)) {
          fault.failures++;
          throw Object.assign(new Error('ENOSPC: fixture account save disk full'), { code: 'ENOSPC' });
        }
      }
      return renameSync(source, destination);
    };
  }, address);
  const waitForSaveFailure = async errorCount => {
    await until(() => run(`window.prSaveProbe.errors.length>=${errorCount} || window.prSaveProbe.handoffs>0`), 'save failure dialog');
    assert.equal(await run('window.prSaveProbe.handoffs'), 0, 'write failure must not hand off');
    assert.equal(await run('window.prSaveProbe.errors.at(-1)'), '无法保存邮箱账号');
    await connect().waitFor();
    assert(await connect().isEnabled());
    assert(await currentWindow().getByRole('button', { name: '返回上一步', exact: true }).isEnabled());
    assert.equal(await field('imap_host').inputValue(), fixture.settings.imap_host);
    assert.equal(await field('smtp_port_custom').inputValue(), String(fixture.settings.smtp_port));
    assert.equal(await field('imap_password').inputValue(), fixture.settings.imap_password);
    assert.equal(await app.evaluate(() => global.application.isSavingAccount()), false);
  };
  const exerciseFaults = async (address, priorErrors) => {
    await installFaults(address);
    const prior = await app.evaluate(() => global.prAccountSaveFault.snapshot());
    let writes = await run('window.prSaveProbe.writes');
    try {
      let errors = priorErrors;
      for (const point of ['keychain', 'disk']) {
        await app.evaluate((_electron, failurePoint) => { global.prAccountSaveFault.point = failurePoint; }, point);
        await connect().click();
        writes++;
        await until(() => run(`window.prSaveProbe.writes===${writes}`), `paused before ${point} failure`);
        await checkAccountSaveLocked({clickBack:false});
        await run('window.prSaveProbe.releaseWrite();true');
        await waitForSaveFailure(++errors);
        assert.equal(await run(`${accountStore}.accounts().length`), prior.memory.accounts.length);
        assert.deepEqual(await app.evaluate(() => global.prAccountSaveFault.snapshot()), prior);
        assert.equal(await app.evaluate(() => global.prAccountSaveFault.failures), errors - priorErrors);
      }
    } finally {
      await app.evaluate(() => global.prAccountSaveFault.restore());
    }
    return writes;
  };

  // A valid but long local part verifies the displayed identity wraps in a real narrow window.
  const address = 'maya-paper-reed-onboarding-account-verification-fixture@example.test';
  await activePage().locator('[data-provider=imap]').click();
  await activePage().locator('#name').fill('Maya Chen');
  await activePage().locator('#emailAddress').fill(address);
  await field('imap_password').fill(fixture.settings.imap_password);
  await activePage().locator('[data-manual-setup]').click();
  for (const protocol of ['imap', 'smtp']) {
    await field(`${protocol}_host`).fill(fixture.settings[`${protocol}_host`]);
    await field(`${protocol}_port`).selectOption('0');
    await field(`${protocol}_port_custom`).fill(String(fixture.settings[`${protocol}_port`]));
    await field(`${protocol}_security`).selectOption('none');
    await field(`${protocol}_username`).fill(fixture.settings[`${protocol}_username`]);
  }

  await installProbe();
  let writeCount = 0;
  try {
    if (phase !== 'before') {
      await run('window.prSaveProbe.pauseAndRejectSave();true');
      await connect().click();
      await until(() => run('!!window.prSaveProbe.failSave'), 'account save paused');
      await checkAccountSaveLocked();
      await status().getByText(address, { exact: true }).waitFor();
      await run('window.prSaveProbe.failSave();true');
      await waitForSaveFailure(1);
      writeCount = await exerciseFaults(address, 1);
    }

    await connect().click();
    writeCount++;
    await until(() => run(`window.prSaveProbe.writes===${writeCount}`), 'real credential write paused');
    await checkAccountSaveLocked({clickBack:false});
    assert.equal(await run(`${accountStore}.accounts().length`), 0);
    assert.equal(await run('window.prSaveProbe.handoffs'), 0);
    await settled();
    await resize(900, 600);
    await shot(`${phase}-saving-desktop`);
    await resize(420, 500);
    await shot(`${phase}-saving-narrow`);
    let savingPosition;
    if (phase !== 'before') {
      await status().getByText(address, { exact: true }).waitFor();
      const savingHeading = status().getByRole('heading');
      assert(await run(`document.activeElement === ${statusNode}.querySelector('h2')`));
      savingPosition = (await savingHeading.boundingBox()).y;
      assert.equal(await status().getByText('邮箱已连接', { exact: true }).count(), 0);
      assert(await run(`(()=>{
        const node=${statusNode};
        return node.scrollWidth <= node.clientWidth && node.getBoundingClientRect().bottom <= innerHeight;
      })()`), 'save status fits the narrow window');
      const animationName = () => run(`getComputedStyle(
        document.querySelector('.page-container:not([inert]) .pr-account-save-icon'),
        '::before'
      ).animationName`);
      await currentWindow().emulateMedia({ reducedMotion: 'reduce' });
      assert.equal(await animationName(), 'none');
      await currentWindow().emulateMedia({ reducedMotion: 'no-preference' });
      assert.equal(await animationName(), 'pr-account-save-spin');
      await checkNativeCloseAndQuit();
    }

    await run('window.prSaveProbe.releaseWrite();true');
    await until(() => run('window.prSaveProbe.handoffs===1'), 'main window handoff paused');
    await status().getByText('邮箱已连接', { exact: true }).waitFor();
    await status().getByText('正在打开收件箱…', { exact: true }).waitFor();
    await settled();
    assert.deepEqual(await run(`${accountStore}.accounts().map(account=>account.emailAddress)`), [address]);
    assert(await currentWindow().getByRole('button', { name: '返回上一步', exact: true }).isDisabled());
    assert.equal(await status().getByText('正在保存邮箱账号…', { exact: true }).count(), 0);
    if (phase !== 'before') {
      const persisted = await app.evaluate((_electron, mailbox) => {
        const fs = process.mainModule.require('node:fs');
        const configPath = global.application.configPersistenceManager.configFilePath;
        const settings = JSON.parse(fs.readFileSync(configPath, 'utf8'))['*'];
        return settings.accounts.length === 1 && settings.accounts[0].emailAddress === mailbox &&
          settings.credentials?.type === 'Buffer' && !('imap_password' in settings.accounts[0].settings);
      }, address);
      assert(persisted, 'account and encrypted credentials are on disk before handoff');
      const storedPassword = await run(`require("mailspring-exports").KeyManager.getPassword(${JSON.stringify(address+'-imap')})`);
      assert.equal(storedPassword, fixture.settings.imap_password);
      await status().getByText(address, { exact: true }).waitFor();
      const openingHeading = status().getByRole('heading');
      assert(await run(`document.activeElement === ${statusNode}.querySelector('h2')`));
      assert.equal((await openingHeading.boundingBox()).y, savingPosition, 'status stays in place');
      await run(`(()=>{
        const lib=AppEnv.getLoadSettings().resourcePath+'/internal_packages/onboarding/lib/';
        const store=require(lib+'onboarding-store').default;
        require(lib+'onboarding-actions').finishAndAddAccount(store.account());
        return true;
      })()`);
      assert.equal(await run('window.prSaveProbe.writes'), writeCount);
      assert.equal(await run('window.prSaveProbe.handoffs'), 1);
      await checkNativeCloseAndQuit();
    }
    await shot(`${phase}-opening-narrow`);
    if (phase !== 'before') {
      await checkHandoffRecovery({ app, run, until, activePage, status, shot, out, writeCount });
    }
    await resize(900, 600);
    await shot(`${phase}-opening-desktop`);
  } catch (error) {
    await run('window.prSaveProbe.restore();true').catch(() => {});
    throw error;
  }
  await resumeHandoff(phase === 'before' ? undefined : 8000);
  await until(() => run('document.querySelectorAll(".pr-mail-row").length===2'), 'real initial inbox');
  if (phase !== 'before') {
    assert(await app.evaluate(() => {
      const target = global.application.windowManager.get('default').browserWindow;
      return global.prLateFailedWorkspace.replacedCrashedWindow &&
        global.prSetupFailedWorkspace.replacedLateFailedWindow &&
        target.id !== global.prSetupFailedWorkspace.windowId && !target.webContents.isCrashed();
    }));
    console.log('PASS retries replace the crashed and late-failed targets; the first retry after bootstrap failure reaches the inbox');
  }

  // Reconnection uses the same real save and hands control back to the existing workspace.
  const workspace = currentWindow();
  const originalId = await run(`${accountStore}.accounts()[0].id`);
  await run(`(()=>{
    require('electron').ipcRenderer.send('command','application:add-account',{
      existingAccountJSON:${accountStore}.accounts()[0].toJSON(),
    });
    return true;
  })()`);
  await selectWindow('onboarding');
  for (const protocol of ['imap', 'smtp']) await field(`${protocol}_password`).fill(fixture.settings[`${protocol}_password`]);
  await installProbe({ reconnect: true });
  try {
    const writes = phase === 'before' ? 0 : await exerciseFaults(address, 0);
    await connect().click();
    await until(() => run(`window.prSaveProbe.writes===${writes + 1}`), 'reconnect credential write paused');
    await checkAccountSaveLocked();
    const priorErrors = await run('window.prSaveProbe.errors.length');
    if (phase !== 'before') await injectConfigNotificationFailure(app, address);
    try {
      await run('window.prSaveProbe.releaseWrite();true');
      await until(() => run('window.prSaveProbe.handoffs===1'), 'reconnect handoff paused');
      if (phase !== 'before') {
        const notifications = await app.evaluate(() => ({
          rejected: global.prConfigNotification.rejected, delivered: global.prConfigNotification.delivered,
        }));
        assert.equal(notifications.rejected, 1);
        assert(notifications.delivered > 0, 'the other window still receives the saved configuration');
        assert.equal(await run('window.prSaveProbe.errors.length'), priorErrors);
      }
    } finally {
      if (phase !== 'before') await app.evaluate(() => global.prConfigNotification.restore());
    }
    await status().getByText('邮箱已连接', { exact: true }).waitFor();
    if (phase !== 'before') {
      await status().getByText('正在返回 Paper Reed…', { exact: true }).waitFor();
      await status().getByText(address, { exact: true }).waitFor();
      assert.equal(await status().getByText('正在打开收件箱…', { exact: true }).count(), 0);
    }
    await settled();
    await resize(420, 500);
    await shot(`${phase}-returning-narrow`);
  } catch (error) {
    await run('window.prSaveProbe.restore();true').catch(() => {});
    throw error;
  }
  if (phase === 'before') {
    await resumeHandoff();
  } else {
    await checkReloadedWorkspaceHandoff({ app, run, until, onboarding: currentWindow() });
    await selectWindow('default');
  }
  assert.deepEqual(await run(`${accountStore}.accounts().map(account=>account.id)`), [originalId]);
  assert.equal(currentWindow(), workspace);

  if (phase !== 'before') {
    for (const reload of [true, false]) {
      await checkAbandonedSave({ app, currentWindow, selectWindow, run, until, fixture, reload });
    }
  }
  const result = { persistedBeforeHandoff: true, initialInbox: true, reconnectedSameAccount: true };
  if (phase !== 'before') {
    Object.assign(result, {
      saveFailureRestoresForm: true,
      secureStorageFailureCanRetry: true,
      configFailureLeavesNoAccountOrSecret: true,
      reconnectFailurePreservesAccountAndCredentials: true,
      nativeCloseQuitAndReloadLocked: true,
      handoffFailureCanRetryWithoutSaving: true,
      firstRetryReplacesCrashedWorkspace: true,
      retryReplacesWorkspaceAfterLateFailure: true,
      firstRetryReplacesWorkspaceAfterBootstrapFailure: true,
      retryReusesWorkspaceForLateReadiness: true,
      blockedNavigationKeepsReadinessAndSaveLock: true,
      handoffWaitsForCurrentWorkspaceDocument: true,
      notificationFailureDoesNotUndoCommit: true,
      rendererExitOrReplacementReleasesLockAfterWrite: true,
      focusAndAccountIdentity: true,
      savingAndOpeningLocked: true,
      stableStatusPosition: true,
      reducedMotionRespected: true,
      existingWorkspaceCopy: true,
    });
  }
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('PASS account save and handoff', JSON.stringify(result));
};
