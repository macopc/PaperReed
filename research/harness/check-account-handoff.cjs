const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

async function checkBlockedRendererNavigation(app, windowKey) {
  const result = await app.evaluate(async (_electron, key) => {
    const application = global.application;
    const main = application.windowManager.get(key);
    const window = main.browserWindow;
    const contents = window.webContents;
    const url = contents.getURL();
    const loaded = main.isLoaded();
    const locked = application.isSavingAccount(window);
    let started = false;
    const start = details => { started = details.isMainFrame && !!details.initiator; };
    contents.on('did-start-navigation', start);
    try {
      await contents.executeJavaScript(`(()=>{
        const form = document.createElement('form');
        form.action = 'http://127.0.0.1:1/navigation-probe';
        document.body.append(form);
        form.submit();
        setTimeout(() => form.remove(), 100);
        return true;
      })()`);
      await new Promise(resolve => setTimeout(resolve, 50));
      return {
        started, blocked: contents.getURL() === url, ready: loaded && main.isLoaded(),
        lockedBefore: locked, lockedAfter: application.isSavingAccount(window),
      };
    } finally {
      contents.removeListener('did-start-navigation', start);
    }
  }, windowKey);
  const shouldBeLocked = windowKey === 'onboarding';
  assert.deepEqual(result, {
    started: true, blocked: true, ready: true,
    lockedBefore: shouldBeLocked, lockedAfter: shouldBeLocked,
  });
}

async function checkHandoffRecovery({ app, run, until, activePage, status, shot, out, writeCount }) {
  const ready = await run('window.prSaveProbe.handoffs');
  const snapshot = () => app.evaluate(() => {
    const config = global.application.config;
    return JSON.stringify({ accounts: config.get('accounts'), credentials: config.get('credentials') });
  });
  const stored = await snapshot();
  const failingBootstrap = path.join(out, 'fixture-failing-bootstrap.cjs');
  fs.writeFileSync(failingBootstrap, "throw new Error('fixture main window bootstrap failure');\n");
  for (const [index, point] of ['closed', 'load-failed', 'crashed', 'late-failure', 'setup-failed'].entries()) {
    await app.evaluate(({ dialog }, { fault, failingBootstrap }) => {
      const manager = global.application.windowManager;
      const ensureWindow = manager.ensureWindow;
      manager.ensureWindow = function (key, options, ...args) {
        if (key !== 'default') return ensureWindow.call(this, key, options, ...args);
        manager.ensureWindow = ensureWindow;
        if (fault === 'setup-failed') options = { ...options, bootstrapScript: failingBootstrap };
        const result = ensureWindow.call(this, key, options, ...args);
        const main = manager.get(key);
        const target = main.browserWindow;
        if (fault === 'setup-failed') {
          const probe = global.prSetupFailedWorkspace = {
            windowId: target.id,
            replacedLateFailedWindow: target.id !== global.prLateFailedWorkspace.windowId,
            reportedGeneration: null,
            nativeFailures: 0,
          };
          target.prependOnceListener('window:setup-failed', generation => { probe.reportedGeneration = generation; });
          target.webContents.on('did-fail-load', () => { probe.nativeFailures++; });
          return result;
        }
        main.loaded = false;
        main.waitForLoad = () => {};
        if (fault === 'closed') {
          setImmediate(() => target.destroy());
        } else if (fault === 'load-failed') {
          setImmediate(() => target.webContents.emit(
            'did-fail-load', {}, -2, 'fixture failed to load', target.webContents.getURL(), true
          ));
        } else if (fault === 'crashed') {
          const probe = global.prCrashedWorkspace = { windowId: target.id, keptOpen: false };
          setImmediate(() => {
            main.loaded = false;
            main.hasLoaded = false;
            target.webContents.isCrashed = () => true;
            const show = dialog.showMessageBoxSync;
            dialog.showMessageBoxSync = (...args) => {
              const keep = args.at(-1).buttons?.indexOf('Keep It Open');
              if (keep < 0 || keep === undefined) return show(...args);
              probe.keptOpen = true;
              return keep;
            };
            try {
              target.webContents.emit('render-process-gone', {}, { reason: 'crashed' });
            } finally {
              dialog.showMessageBoxSync = show;
            }
          });
        } else if (fault === 'late-failure') {
          const { emit } = target;
          target.emit = function (name, ...eventArgs) {
            if (name === 'window:loaded') return true;
            return emit.call(this, name, ...eventArgs);
          };
          global.prLateFailedWorkspace = {
            windowId: target.id,
            replacedCrashedWindow: target.id !== global.prCrashedWorkspace.windowId,
            fail: () => {
              const contents = target.webContents;
              const failLoad = (code, isMainFrame) => contents.emit(
                'did-fail-load', {}, code, 'fixture failed to load', contents.getURL(), isMainFrame
              );
              failLoad(-2, false);
              failLoad(-3, true);
              const ignoredNonTerminalErrors = !main.hasLoadFailed();
              failLoad(-2, true);
              target.emit = emit;
              return { ignoredNonTerminalErrors, terminalFailure: main.hasLoadFailed() };
            },
          };
        }
        return result;
      };
    }, { fault: point, failingBootstrap });
    await run('window.prSaveProbe.releaseHandoff();true');
    const retry = activePage().getByRole('button', { name: '重试打开主窗口', exact: true });
    await retry.waitFor({ timeout: 16000 });
    assert(await activePage().getByRole('button', { name: '关闭设置', exact: true }).isEnabled());
    assert.equal(await status().getByRole('button').count(), 0, 'actions are outside the live status');
    assert.equal(await app.evaluate(() => global.application.isSavingAccount()), false);
    if (point === 'late-failure') {
      const failure = await app.evaluate(() => {
        const probe = global.prLateFailedWorkspace;
        const target = global.application.windowManager.get('default')?.browserWindow;
        return {
          retainedUntilFailure: target?.id === probe.windowId && !target.isDestroyed(),
          replacedCrashedWindow: probe.replacedCrashedWindow,
          ...probe.fail(),
        };
      });
      assert.deepEqual(failure, {
        retainedUntilFailure: true,
        replacedCrashedWindow: true,
        ignoredNonTerminalErrors: true,
        terminalFailure: true,
      });
    }
    if (point === 'crashed') {
      assert(await app.evaluate(() => {
        const probe = global.prCrashedWorkspace;
        const target = global.application.windowManager.get('default')?.browserWindow;
        return probe.keptOpen && target?.id === probe.windowId && target.webContents.isCrashed();
      }), 'the crash target stays registered until the user retries');
    }
    if (point === 'setup-failed') {
      assert(await app.evaluate(() => {
        const probe = global.prSetupFailedWorkspace;
        return probe.replacedLateFailedWindow && Number.isInteger(probe.reportedGeneration) && probe.nativeFailures === 0;
      }), 'the actual bootstrap exception is reported for the current document without a native load error');
    }
    assert(await run('document.activeElement.textContent==="重试打开主窗口"'));
    assert.deepEqual(await snapshot(), stored, 'an interrupted handoff leaves the saved account intact');
    if (index === 0) await shot('after-handoff-failure-narrow');
    await retry.click();
    await until(() => run(`window.prSaveProbe.handoffs===${ready + index + 1}`), `retry handoff after ${point}`);
    assert.equal(await run('window.prSaveProbe.writes'), writeCount, 'retry opening never saves again');
    console.log(`PASS workspace handoff recovery after ${point}`);
  }
}

async function checkReloadedWorkspaceHandoff({ app, run, until, onboarding }) {
  await checkBlockedRendererNavigation(app, 'default');
  await app.evaluate(async () => {
    const main = global.application.windowManager.get('default');
    const window = main.browserWindow;
    const { emit } = window;
    const oldGeneration = await window.webContents.executeJavaScript(
      "require('electron').ipcRenderer.sendSync('window-document-generation')"
    );
    const probe = global.prReloadedWorkspace = {
      oldGeneration,
      windowId: window.id,
      release: () => {
        window.emit = emit;
        emit.call(window, 'window:loaded', ...probe.readyArgs);
      },
      sendOldResults: () => {
        emit.call(window, 'window:loaded', oldGeneration);
        emit.call(window, 'window:setup-failed', oldGeneration);
      },
    };
    window.emit = function (name, ...args) {
      if (name === 'window:loaded') {
        probe.readyArgs = args;
        return true;
      }
      return emit.call(this, name, ...args);
    };
    window.webContents.reload();
  });
  await until(() => app.evaluate(() => !!global.prReloadedWorkspace.readyArgs), 'new workspace document sent readiness');
  const readiness = await app.evaluate(() => {
    const probe = global.prReloadedWorkspace;
    return {
      generationChanged: Number.isInteger(probe.readyArgs[0]) &&
        Number.isInteger(probe.oldGeneration) && probe.readyArgs[0] !== probe.oldGeneration,
      loaded: global.application.windowManager.get('default').isLoaded(),
    };
  });
  assert.deepEqual(readiness, { generationChanged: true, loaded: false });
  const writes = await run('window.prSaveProbe.writes');
  await run('setTimeout(window.prSaveProbe.releaseHandoff,0);true');
  await until(() => app.evaluate(() => (
    !global.application.windowManager.get('onboarding') ||
    !!global.application._accountSaveLock?.cancelHandoff
  )), 'handoff waits on the reloaded workspace');
  assert(!onboarding.isClosed());
  const waiting = await app.evaluate(() => {
    global.prReloadedWorkspace.sendOldResults();
    const main = global.application.windowManager.get('default');
    return global.application.isSavingAccount() && !main.isLoaded() && !main.hasLoadFailed();
  });
  assert(waiting, 'the previous document cannot complete or fail the new handoff');
  const retry = onboarding.getByRole('button', { name: '重试打开主窗口', exact: true });
  await retry.waitFor({ timeout: 16000 });
  assert(await app.evaluate(() => {
    const main = global.application.windowManager.get('default');
    return main?.browserWindow.id === global.prReloadedWorkspace.windowId &&
      !global.application.isSavingAccount() && !main.isLoaded() && !main.hasLoadFailed();
  }), 'the timed-out but healthy workspace is still waiting for readiness');
  await retry.click();
  await until(() => run('window.prSaveProbe.handoffs===2'), 'retry the existing workspace after timeout');
  assert.equal(await run('window.prSaveProbe.writes'), writes);
  await run('window.prSaveProbe.restore();setTimeout(window.prSaveProbe.releaseHandoff,0);true');
  await until(() => app.evaluate(() => !!global.application._accountSaveLock?.cancelHandoff), 'retry waits for the same workspace');
  assert(await app.evaluate(() => (
    global.application.windowManager.get('default').browserWindow.id === global.prReloadedWorkspace.windowId
  )));
  await checkBlockedRendererNavigation(app, 'onboarding');
  await app.evaluate(() => global.prReloadedWorkspace.release());
  await until(() => onboarding.isClosed(), 'the current document completes handoff');
  console.log('PASS current-document readiness after timeout completes retry in the same workspace; old readiness is ignored');
}

async function injectConfigNotificationFailure(app, address) {
  await app.evaluate(({ BrowserWindow }, mailbox) => {
    const priorAuth = global.application.config.get('accounts').find(a => a.emailAddress === mailbox).authedAt;
    const restorers = [];
    const probe = global.prConfigNotification = {
      rejected: 0,
      delivered: 0,
      restore: () => restorers.forEach(restore => restore()),
    };
    for (const window of BrowserWindow.getAllWindows()) {
      const contents = window.webContents;
      const send = contents.send;
      restorers.push(() => { if (!contents.isDestroyed()) contents.send = send; });
      contents.send = function (channel, ...args) {
        if (channel === 'on-config-reloaded' && args[0].accounts?.some(
          a => a.emailAddress === mailbox && a.authedAt !== priorAuth
        )) {
          if (probe.rejected === 0) {
            probe.rejected++;
            throw new Error('fixture configuration notification failure');
          }
          probe.delivered++;
        }
        return send.call(this, channel, ...args);
      };
    }
  }, address);
}

async function checkAbandonedSave({ app, currentWindow, selectWindow, run, until, fixture, reload }) {
  await run(`(()=>{
    const {AccountStore}=require('mailspring-exports');
    require('electron').ipcRenderer.send('command','application:add-account',{
      existingAccountJSON:AccountStore.accounts()[0].toJSON(),
    });
    return true;
  })()`);
  await selectWindow('onboarding');
  const onboarding = currentWindow();
  await app.evaluate(({ app }) => {
    const { secureStorage } = process.mainModule.require(app.getAppPath() + '/src/browser/credential-store');
    const { encrypt } = secureStorage;
    const probe = global.prAbandonedSave = { restore: () => { secureStorage.encrypt = encrypt; } };
    secureStorage.encrypt = async text => {
      await new Promise(resolve => { probe.release = resolve; });
      return encrypt(text);
    };
  });
  try {
    for (const protocol of ['imap', 'smtp']) {
      await onboarding.locator(`[id="settings.${protocol}_password"]`).fill(fixture.settings[`${protocol}_password`]);
    }
    await onboarding.getByRole('button', { name: '连接邮箱', exact: true }).click();
    await until(() => app.evaluate(() => !!global.prAbandonedSave.release), 'in-progress encryption before renderer exit');
    await app.evaluate((_electron, forceReload) => {
      const window = global.application.windowManager.get('onboarding').browserWindow;
      if (forceReload) {
        const probe = global.prAbandonedSave;
        probe.reloaded = false;
        window.webContents.once('did-finish-load', () => { probe.reloaded = true; });
        window.webContents.reload();
      } else {
        window.webContents.emit('render-process-gone', {}, { reason: 'killed' });
      }
    }, reload);
    if (reload) {
      await until(() => app.evaluate(() => global.prAbandonedSave.reloaded), 'onboarding renderer replaced');
    } else {
      await until(() => onboarding.isClosed(), 'abandoned onboarding window closes');
    }
    assert.equal(await app.evaluate(() => global.application.isSavingAccount()), true);
    await app.evaluate(() => { global.prAbandonedSave.release(); });
    await until(() => app.evaluate(() => !global.application.isSavingAccount()), 'abandoned account save releases its lock');
    if (reload) {
      await app.evaluate(() => global.application.windowManager.get('onboarding').close());
      await until(() => onboarding.isClosed(), 'reloaded onboarding window closes normally');
    }
    await selectWindow('default');
    console.log(`PASS renderer ${reload ? 'replacement' : 'exit'} releases the native close lock after encryption settles`);
  } finally {
    await app.evaluate(() => {
      global.prAbandonedSave.release?.();
      global.prAbandonedSave.restore();
    });
  }
}

module.exports = {
  checkHandoffRecovery, checkReloadedWorkspaceHandoff, injectConfigNotificationFailure,
  checkAbandonedSave,
};
