const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const { createHash } = require('node:crypto');
const { EventEmitter } = require('node:events');
const { mkdtempSync, readFileSync, rmSync } = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const desktop = path.resolve(process.argv[2]);
const ts = require(path.join(desktop, 'node_modules/typescript'));
const feedAsset = 'Paper-Reed-update-stable-macos-arm64.json';
const feedURL = `https://github.com/macopc/PaperReed/releases/latest/download/${feedAsset}`;

function updaterFixture({ version = '0.0.5-da520d2', appVersion = '0.0.5', packaged = true, specMode = false,
  platform = 'darwin', arch = 'arm64', paperReed = true } = {}) {
  const updater = new EventEmitter();
  const application = new EventEmitter();
  const feeds = [];
  const dialogs = [];
  const timers = [];
  const releases = [];
  const fixture = { checks: 0, installs: 0, response: 0 };
  updater.setFeedURL = (feed) => {
    feeds.push(feed);
    if (fixture.feedError) updater.emit('error', new Error('Invalid update source'));
  };
  updater.checkForUpdates = () => fixture.checks++;
  updater.quitAndInstall = () => fixture.installs++;
  application.windowManager = { sendToAllWindows: (...args) => releases.push(args) };
  const electron = {
    autoUpdater: updater,
    app: { isPackaged: packaged, getVersion: () => appVersion },
    BrowserWindow: { getFocusedWindow: () => ({}) },
    dialog: {
      showMessageBox: async (...args) => {
        dialogs.push(args.at(-1));
        return { response: fixture.response };
      },
    },
  };

  function load(file, extra = {}) {
    const source = readFileSync(path.join(desktop, 'app/src/browser', file), 'utf8');
    const compiled = ts.transpile(source, { module: ts.ModuleKind.CommonJS });
    const exports = {};
    vm.runInNewContext(compiled, {
      exports,
      require: (name) => Object.hasOwn(extra, name) ? extra[name] : require(name),
      process: { platform, arch },
      setTimeout: (fn) => timers.push(fn),
      setInterval: (fn) => timers.push(fn),
      console: { error() {}, log() {} },
      global: { application },
    });
    return exports;
  }
  const Manager = load('autoupdate-manager.ts', {
    electron,
    '../intl': { localized: (text) => text },
    './paper-reed-update-feed': load('paper-reed-update-feed.ts'),
  }).default;
  const manager = new Manager(version, {
    get: (key) => key === 'core.paperReed.enabled' && paperReed,
    onDidChange() {},
  }, specMode);
  timers.shift()?.();
  return Object.assign(fixture, { manager, updater, application, feeds, dialogs, releases, timers });
}

test('selects the stable macOS arm64 feed and keeps unsupported builds off the network', () => {
  for (const options of [
    { platform: 'linux' }, { arch: 'x64' }, { packaged: false },
    { specMode: true }, { appVersion: '0.0.5-preview.1' },
  ]) {
    const { manager, feeds, timers } = updaterFixture(options);
    assert.equal(manager.getState(), 'unsupported');
    manager.check();
    assert.equal(feeds.length, 0);
    assert.equal(timers.length, 0);
    assert.equal(manager.canInstall(), false);
  }
  const { manager, feeds, checks } = updaterFixture();
  assert.equal(checks, 1);
  assert.equal(manager.version, '0.0.5');
  assert.equal(feeds[0].url, feedURL);
  assert.equal(feeds[0].serverType, 'json');
  manager.updateFeedURL();
  assert.equal(manager.feedURL, feedURL);
  const upstream = updaterFixture({ paperReed: false });
  assert.equal(upstream.manager.version, '0.0.5-da520d2');
  assert.match(upstream.feeds[0], /updates\.getmailspring\.com/);
});

test('coalesces scheduled and manual checks and retries after an error', () => {
  const f = updaterFixture();
  f.manager.check();
  f.timers[0]();
  assert.equal(f.checks, 1);
  f.updater.emit('update-available');
  assert.equal(f.manager.getState(), 'downloading');
  assert.equal(f.manager.canInstall(), false);
  f.manager.install();
  assert.equal(f.installs, 0);

  f.updater.emit('error', new Error('Download failed'));
  assert.equal(f.manager.getState(), 'error');
  assert.equal(f.dialogs.length, 1);
  assert.equal(f.dialogs[0].detail, 'Download failed');
  f.feedError = true;
  f.manager.check();
  assert.equal(f.checks, 1);
  assert.equal(f.manager.getState(), 'error');
  f.feedError = false;
  f.timers[0]();
  f.updater.emit('update-not-available');
  assert.equal(f.checks, 2);
  assert.equal(f.dialogs.length, 2, 'automatic completion should stay silent');
  f.manager.check();
  f.updater.emit('update-not-available');
  assert.equal(f.dialogs.at(-1).message, '已是最新版本');
});

test('a downloaded update waits for the restart action', async () => {
  const f = updaterFixture();
  f.updater.emit('update-downloaded', {}, '', '0.0.6');
  await Promise.resolve();
  assert.equal(f.installs, 0);
  assert.equal(f.manager.getState(), 'update-available');
  assert.equal(f.releases[0][2].releaseVersion, '0.0.6');
  assert.equal(f.dialogs[0].buttons[1], '重启并安装');
  f.manager.check();
  assert.equal(f.checks, 1);
  f.manager.install();
  assert.equal(f.installs, 1);
  f.application.quitting = true;
  f.updater.emit('error', new Error('Restart failed'));
  assert.equal(f.application.quitting, false);
  assert.equal(f.manager.canInstall(), true);

  const confirm = updaterFixture();
  confirm.response = 1;
  confirm.application.on('application:install-update', () => confirm.manager.install());
  confirm.updater.emit('update-downloaded', {}, '', '0.0.6');
  await Promise.resolve();
  assert.equal(confirm.installs, 1);
});

test('the publication helper pins a stable release and checks its version and architecture', () => {
  const temp = mkdtempSync(path.join(os.tmpdir(), 'paper-reed-update-feed-'));
  const archiveName = 'Paper-Reed-0.0.6-macOS-arm64.zip';
  const archive = path.join(temp, archiveName);
  const script = path.resolve(__dirname, '../../scripts/make-update-feed.py');
  function writeArchive(version, cpu) {
    execFileSync('python3', ['-c', `
import plistlib, sys, zipfile
with zipfile.ZipFile(sys.argv[1], 'w') as archive:
    archive.writestr('Paper Reed.app/Contents/Info.plist', plistlib.dumps({
        'CFBundleIdentifier': 'io.github.macopc.paperreed',
        'CFBundleShortVersionString': sys.argv[2],
    }))
    archive.writestr('Paper Reed.app/Contents/MacOS/Paper Reed', bytes.fromhex(sys.argv[3]))
`, archive, version, cpu]);
  }

  try {
    writeArchive('0.0.6', 'cffaedfe0c000001');
    execFileSync('python3', [script, archive]);
    const feed = JSON.parse(readFileSync(path.join(temp, feedAsset), 'utf8'));
    const zip = readFileSync(archive);
    assert.equal(feed.currentRelease, '0.0.6');
    assert.deepEqual(feed.releases.map((r) => r.version), ['0.0.6']);
    const update = feed.releases[0].updateTo;
    assert.equal(update.url, `https://github.com/macopc/PaperReed/releases/download/v0.0.6/${archiveName}`);
    assert.equal(update.size, zip.length);
    assert.equal(update.sha256, createHash('sha256').update(zip).digest('hex'));
    writeArchive('0.0.5', 'cffaedfe0c000001');
    assert.throws(() => execFileSync('python3', [script, archive], { stdio: 'pipe' }),
      /named release version/);
    writeArchive('0.0.6', 'cffaedfe07000001');
    assert.throws(() => execFileSync('python3', [script, archive], { stdio: 'pipe' }),
      /must be macOS arm64/);
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
});
