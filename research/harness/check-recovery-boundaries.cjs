// Focused fault injection around real TS close/recovery methods. Not an Electron/engine test.
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const upstream = path.resolve(process.argv[2]);
const ts = createRequire(path.join(upstream, 'package.json'))('typescript');
const source = fs.readFileSync(path.join(upstream, 'app/src/flux/stores/draft-store.ts'), 'utf8');
const ast = ts.createSourceFile('draft-store.ts', source, ts.ScriptTarget.Latest, true);
const store = ast.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'DraftStore');
const names = ['_closeSaveInProgress', '_saveSessionBeforeClose', '_onBeforeUnload'];
const members = names.map(name => {
  const member = store.members.find(n => n.name?.getText(ast) === name);
  assert(member, name); return member.getText(ast);
});
class Message {
  constructor(data = {}) { Object.assign(this, data); }
  fromJSON(data) { Object.assign(this, data); return this; }
  toJSON() { return { ...this }; }
}
let choice, copySave, copies, errors, ready, dialogs;
const context = {
  Message, desktopAccess: {}, console, setTimeout, clearTimeout,
  localized: (s, value) => s.replace('%@', value),
  AppEnv: { isMainWindow: () => false, getCurrentWindow: () => ({}), showErrorDialog: s => errors.push(s) },
  saveDraftCopy: async draft => { copies++; return copySave(draft); },
  require: id => { assert.equal(id, '@electron/remote'); return { dialog: { showMessageBox: async () => { dialogs++; return { response: choice }; } } }; },
};
const code = ts.transpileModule(`class RecoveryHarness { _draftSessions = {}; ${members.join('\n')} }; globalThis.Harness = RecoveryHarness;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
vm.runInNewContext(code, context);
const flush = () => new Promise(r => setTimeout(r, 25));
function setup() {
  choice = 1; copies = 0; errors = []; ready = 0; dialogs = 0;
  copySave = async draft => draft;
  const draft = new Message({ id: 'source', headerMessageId: 'original', body: 'unsaved input', draft: true, pristine: false, files: [] });
  const session = { draft: () => draft, changes: { isDirty: () => true, commit: async () => { throw new Error('draft-conflict'); } } };
  const harness = new context.Harness(); harness._draftSessions.original = session;
  return { harness, draft, session, close: () => harness._onBeforeUnload(() => ready++) };
}
(async () => {
  let test = setup(); choice = 0; assert.equal(test.close(), false); await flush();
  assert.equal(copies, 0); assert.equal(ready, 0); assert.equal(test.harness._draftSessions.original, test.session);
  assert.equal(test.harness._closeSaveInProgress, false);
  console.log('PASS Keep Editing creates no copy and preserves session');

  test = setup(); copySave = async () => { throw new Error('injected-save-failure'); };
  test.close(); await flush(); assert.equal(ready, 0); assert.equal(copies, 1);
  assert.equal(test.harness._draftSessions.original, test.session); assert.equal(test.draft.body, 'unsaved input');
  assert.match(errors[0], /injected-save-failure/); assert.equal(test.harness._closeSaveInProgress, false);
  console.log('PASS failed copy cannot close or discard input; error is shown');

  test = setup(); let release;
  copySave = () => new Promise(resolve => { release = resolve; });
  test.close(); await flush(); test.close(); assert.equal(copies, 1); assert.equal(dialogs, 1); assert.equal(ready, 0);
  release(); await flush(); assert.equal(ready, 1);
  assert.equal(Object.keys(test.harness._draftSessions).length, 0);
  console.log('PASS pending receipt blocks close; repeated close creates no duplicate copy');

  test = setup(); let frozen;
  copySave = draft => { frozen = draft; return new Promise(resolve => { release = resolve; }); };
  test.close(); await flush(); test.draft.body = 'new input while copy saves'; release(); await flush();
  assert.equal(frozen.body, 'unsaved input'); assert.equal(ready, 0);
  assert.equal(test.harness._draftSessions.original, test.session); assert.match(errors[0], /more edits/);
  console.log('PASS copy is frozen; input typed during save keeps editor open');

  // Execute the shared copy service too, with only persistence/model adapters.
  let queued = [];
  class Save { constructor({draft}) { this.draft = draft; } }
  const deps = {
    crypto: require('node:crypto'), '../../flux/models/message': { Message },
    '../../flux/stores/database-store': {}, '../../flux/stores/account-store': {},
    '../../flux/tasks/syncback-draft-task': { SyncbackDraftTask: Save },
    '../../flux/tasks/send-draft-task': {},
    '../../flux/actions': { queueTask: task => queued.push(task) },
    '../../flux/stores/task-queue': { waitForPerformLocal: async () => ({ savedDraftId: 'copy-row', savedDraftRevision: 1, assertSaved() {} }) },
  };
  const coreModule = { exports: {} };
  const coreSource = fs.readFileSync(path.join(upstream, 'app/src/services/mail-core/index.ts'), 'utf8');
  vm.runInNewContext(ts.transpileModule(coreSource, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText, { module: coreModule, exports: coreModule.exports, require: id => { assert(Object.hasOwn(deps, id), id); return deps[id]; } });
  const { saveDraftCopy } = coreModule.exports;
  const access = { check() {}, visible: async () => true };
  const original = new Message({ accountId: 'a', headerMessageId: 'source', version: 3, files: [],
    body: 'unsaved input', subject: 'reply', plaintext: false, from: [{email:'from@example.test'}],
    to: [{email:'to@example.test'}], cc: [], bcc: [{email:'bcc@example.test'}], replyTo: [],
    replyToHeaderMessageId: 'parent', forwardedHeaderMessageId: '', pluginMetadata: [{ scheduledSend: true }] });
  await assert.rejects(saveDraftCopy(original, { ...access, check() { throw new Error('access-denied'); } }), /access-denied/);
  await assert.rejects(saveDraftCopy(original, { ...access, visible: async () => false }), /draft-not-found/);
  await assert.rejects(saveDraftCopy(new Message({...original, files:[{id:'attachment'}]}), access), /attachments/);
  assert.equal(queued.length, 0);
  const copied = await saveDraftCopy(original, access);
  assert.notEqual(copied.headerMessageId, original.headerMessageId); assert.equal(copied.id, 'copy-row'); assert.equal(copied.version, 1);
  for(const key of ['body','subject','plaintext','from','to','cc','bcc','replyTo','replyToHeaderMessageId']) assert.deepEqual(copied[key], original[key], key);
  assert.equal(copied.pluginMetadata, undefined); assert.equal(original.version, 3); assert.equal(original.headerMessageId, 'source');
  assert.equal(queued.length, 1); assert(queued[0] instanceof Save);
  console.log('PASS copy identity, fields and receipt; denied access/attachments enqueue nothing; scheduling metadata not copied');
})().catch(error => { console.error(error); process.exitCode = 1; });
