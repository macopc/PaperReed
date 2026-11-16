// Run real patched TypeScript methods with narrow adapters, not a GUI or engine.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const upstream = path.resolve(process.argv[2]);
const ts = createRequire(path.join(upstream, 'package.json'))('typescript');
const dialogs = [], delivered = [], failed = [];
const app = { showErrorDialog: (s) => dialogs.push(s), config: { get: () => false } };
let clock = 1;
function load(relative, deps = {}) {
  const module = { exports: {} };
  const code = ts.transpileModule(fs.readFileSync(path.join(upstream, 'app/src', relative), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const requireMock = (id) => {
    if (Object.hasOwn(deps, id)) return deps[id];
    if (id === 'events') return require('node:events');
    throw new Error(`Unmocked dependency ${id} in ${relative}`);
  };
  vm.runInNewContext(code, { module, exports: module.exports, require: requireMock,
    AppEnv: app, performance: { now: () => ++clock }, setTimeout, clearTimeout, console }, { filename: relative });
  return module.exports;
}
const { DraftChangeSet } = load('flux/stores/draft-change-set.ts');
class Task {
  static Status = { Cancelled: 'cancelled' };
  static attributes = {};
  constructor(data) { Object.assign(this, data); }
}
class Message {
  constructor(data = {}) { Object.assign(this, data); }
  toJSON() { return { body: this.body, version: this.version, accountId: this.accountId, headerMessageId: this.headerMessageId }; }
  static attributes = { version: {}, body: {}, subject: {}, headerMessageId: {}, id: {} };
}
const common = {
  './task': { Task }, '../attributes': new Proxy({}, { get: () => (v) => v }),
  '../models/message': { Message }, '../../intl': { localized: (s) => s },
};
const { SyncbackDraftTask } = load('flux/tasks/syncback-draft-task.ts', common);
const actions = { queueTask() {}, draftDeliverySucceeded: (v) => delivered.push(v),
  draftDeliveryFailed: (v) => failed.push(v) };
const { SendDraftTask } = load('flux/tasks/send-draft-task.ts', {
  ...common, '../stores/account-store': {}, '../actions': actions,
  '../../registries/sound-registry': {}, '../../registries/extension-registry': { Composer: { extensions: () => [] } },
  '../../mailsync-process': { LocalizedErrorStrings: {} },
  '../../components/composer-editor/plaintext': { ZERO_WIDTH_SPACE: '\u200b' },
});

(async () => {
  let calls = 0;
  const changes = new DraftChangeSet({ onAddChanges() {}, onCommit: async () => {
    calls++; if (calls === 1) throw new Error('draft-conflict');
  } });
  changes.add({ body: 'unsaved user edit' });
  await assert.rejects(changes.commit(), /draft-conflict/);
  assert.equal(changes.isDirty(), true);
  assert.equal(changes._commitPromise, null);
  assert.equal(changes.saveError.message, 'draft-conflict');
  assert.equal(changes.saving, false);
  await changes.commit();
  assert.equal(changes.isDirty(), false);
  assert.equal(changes.saveError, null);

  let release;
  const during = new DraftChangeSet({ onAddChanges() {}, onCommit: () => new Promise((r) => { release = r; }) });
  during.add({ body: 'snapshot' });
  const pending = during.commit();
  await Promise.resolve();
  assert.equal(during.saving, true);
  assert.throws(() => during.resetAfterReload(), /draft-save-in-progress/);
  during.add({ body: 'typed while saving' });
  release(); await pending;
  assert.equal(during.isDirty(), true);
  assert.equal(during.saving, false);
  during.clearDelayedCommit();
  console.log('PASS rejected save retains dirty edits; later edits remain dirty after successful save');

  const save = new SyncbackDraftTask({ draft: { accountId: 'a', headerMessageId: 'h' } });
  save.error = { key: 'draft-conflict' };
  assert.throws(() => save.assertSaved(), /not saved/);
  save.error = null; save.status = 'cancelled';
  assert.throws(() => save.assertSaved(), /not saved/);
  save.status = 'complete'; assert.equal(save.assertSaved(), save);

  const send = new SendDraftTask({});
  send.draft = { headerMessageId: 'h', accountId: 'a', files: [] };
  send.sendOutcome = 'unknown'; send.onSuccess();
  assert.equal(delivered.length, 0);
  assert.match(failed[0].errorMessage, /unknown/);
  send.sendOutcome = 'accepted'; send.sentCopy = 'failed'; send.onSuccess();
  assert.equal(delivered.length, 1);
  assert.match(dialogs.at(-1), /Do not resend/);
  console.log('PASS save/cancel errors stop callers; unknown is not success; copy failure is not delivery failure');

  class Store { listenTo() {} trigger() {} }
  let receipt, readSaved;
  const { DraftEditingSession } = load('flux/stores/draft-editing-session.ts', {
    immutable: {}, 'mailspring-store': Store, slate: {}, '../../regexp-utils': {}, '../../intl': common['../../intl'],
    '../../services/mail-core': { saveDraft: async () => receipt.assertSaved(), getDraft: () => readSaved(), desktopAccess: {} },
    './task-queue': { waitForPerformLocal: async () => receipt }, '../models/message': { Message },
    '../models/utils': {}, '../actions': actions, './contact-store': {},
    './database-store': { findBy: () => ({ include: () => new Promise(() => {}) }) }, './account-store': {},
    './draft-change-set': { DraftChangeSet }, './database-change-record': {}, '../tasks/destroy-draft-task': {},
    '../../registries/extension-registry': {}, '../../services/quoted-html-transformer': {},
    '../tasks/syncback-draft-task': { SyncbackDraftTask }, './draft-store': {},
  });
  const session = new DraftEditingSession('h');
  const body = { get: () => 'my edit', set() {}, configurable: true };
  session._draft = { version: 1, headerMessageId: 'h', accountId: 'a', id: 'draft',
    __bodyPropDescriptor: body, __bodyEditorValuePropDescriptor: { value: null, configurable: true } };
  session.changes._lastModifiedTimes.body = ++clock;
  session._onDraftChanged({ type: 'persist', objects: [{ version: 3, headerMessageId: 'h', body: 'agent edit' }] });
  assert.equal(session._draft.version, 1); // Cannot silently rebase an unsaved body.
  receipt = save; save.savedDraftRevision = 5; save.savedDraftId = 'draft';
  await session.changeSetCommit();
  assert.equal(session._draft.version, 5);
  save.error = { key: 'draft-conflict' };
  await assert.rejects(session.changeSetCommit(), /not saved/);
  assert.equal(session._draft.version, 5);
  save.error = null; save.draft.accountId = 'b';
  save.savedDraftId = 'b-draft'; save.savedDraftRevision = 1;
  session.acceptSaveReceipt(save);
  assert.equal(session._draft.accountId, 'b');
  assert.equal(session._draft.id, 'b-draft');
  assert.equal(session._draft.version, 1);
  assert.equal(session._draft.body, 'my edit');
  console.log('PASS dirty editor retains base revision; only successful save receipt advances it');
  session._draft = new Message({ body: 'copied edit', version: 1, accountId: 'a', headerMessageId: 'h' });
  const copiedSnapshot = JSON.stringify(session._draft.toJSON());
  let resolveRead;
  readSaved = () => new Promise(resolve => { resolveRead = resolve; });
  const reload = session.reloadAfterCopy(copiedSnapshot);
  session._draft.body = 'typed during reload';
  resolveRead(new Message({ body: 'agent latest', version: 2, accountId: 'a', headerMessageId: 'h' }));
  await assert.rejects(reload, /draft-edited-after-copy/);
  assert.equal(session._draft.body, 'typed during reload');
  assert(session.changes.isDirty());
  const latestCopy = JSON.stringify(session._draft.toJSON());
  readSaved = async () => new Message({ body: 'agent latest', version: 2, accountId: 'a', headerMessageId: 'h' });
  await session.reloadAfterCopy(latestCopy);
  assert.equal(session._draft.body, 'agent latest');
  assert.equal(session._draft.version, 2);
  assert.equal(session.changes.isDirty(), false);
  console.log('PASS reload refuses edits made during read; explicit reload resets saved state');

})().catch((error) => { console.error(error); process.exitCode = 1; });
