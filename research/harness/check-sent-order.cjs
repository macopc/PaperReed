const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
const { DatabaseSync } = require('node:sqlite');

const desktop = path.resolve(process.argv[2]);
const ts = createRequire(path.join(desktop, 'package.json'))('typescript');
const db = new DatabaseSync(':memory:');
db.exec(`
  CREATE TABLE Thread (id TEXT PRIMARY KEY, accountId TEXT, data TEXT,
    lastMessageReceivedTimestamp INTEGER, lastMessageSentTimestamp INTEGER);
  CREATE TABLE ThreadCategory (id TEXT, value TEXT);
  CREATE TABLE Message (id TEXT PRIMARY KEY, accountId TEXT, threadId TEXT, date INTEGER, draft INTEGER, data TEXT);
  CREATE TABLE MessageOrphan (messageId TEXT PRIMARY KEY, accountId TEXT, since INTEGER);
  CREATE TABLE PaperReedLocalThread (accountId TEXT, threadId TEXT, pinned INTEGER);
`);
for (const [id, sent, received] of [['A', 300, 500], ['B', 200, 200], ['C', 200, 700], ['P', 90, 90]]) {
  db.prepare('INSERT INTO Thread VALUES (?, ?, ?, ?, ?)').run(id, 'account', JSON.stringify({id}), received, sent);
  db.prepare('INSERT INTO ThreadCategory VALUES (?, ?)').run(id, 'sent-folder');
}
for (const [id, thread, date, folders, labels] of [
  ['a-inbound', 'A', 500, {'inbox-folder':1}, []],
  ['a-new', 'A', 300, {'sent-folder':1}, []],
  ['a-old', 'A', 100, {'sent-folder':1}, []],
  ['b-gmail', 'B', 200, {'all-mail':1}, ['\\Sent']],
  ['b-old', 'B', 50, {'sent-folder':1}, []],
  ['c-1', 'C', 200, {'sent-folder':1}, []],
  ['c-2', 'C', 200, {'sent-folder':1}, []],
  ['p', 'P', 90, {'sent-folder':1}, []],
]) {
  db.prepare('INSERT INTO Message VALUES (?, ?, ?, ?, 0, ?)').run(
    id, 'account', thread, date, JSON.stringify({id, date, folders, labels})
  );
}
db.prepare("INSERT INTO PaperReedLocalThread VALUES ('account', 'P', 1)").run();

// The real inbox service runs its generated SQL through this isolated store.
// Represent only the shared thread builder's role filter and sort defaults.
class Model { constructor(data) { Object.assign(this, data); } }
const threadQuery = (_grant, options) => {
  let limit = options.limit;
  const where = ["EXISTS (SELECT 1 FROM ThreadCategory WHERE id = Thread.id AND value = 'sent-folder')"];
  const orders = [options.priorityOrder, 'Thread.lastMessageReceivedTimestamp DESC'].filter(Boolean);
  const query = {
    where: matcher => { where.push(matcher.sql); return query; },
    order: order => { orders.push(order); return query; },
    idsOnly: () => query,
    limit: value => { limit = value; return query; },
    sql: () => `SELECT Thread.id FROM Thread WHERE ${where.join(' AND ')} ORDER BY ${orders.join(',')} LIMIT ${limit}`,
  };
  return query;
};
const imports = {
  'mailspring-exports': {
    Thread: Object.assign(class Thread extends Model {}, {attributes:{
      id:{ascending:()=>'Thread.id ASC'},
      lastMessageSentTimestamp:{descending:()=>'Thread.lastMessageSentTimestamp DESC'},
    }}),
    Message: Model, AccountStore:{accountForId:()=>({})},
    CategoryStore:{categories:()=>[{id:'sent-folder', role:'sent'}]},
    DatabaseStore:{_query:async (sql, params)=>db.prepare(sql).all(...params)},
  },
  './local-triage': {ensureLocalTriage:async()=>{}, localViewSQL:()=> '1'},
  '../mail-access/filter': {FilterMatcher: class {constructor(sql) { this.sql = sql; }}},
  '../mail-access/queries': {threadQuery},
  '../mail-access/grant': {FULL_GRANT:{accountIds:null, excludedFolderIds:{}},
    isThreadAllowed:()=>true, isMessageAllowed:()=>true},
};
const source = fs.readFileSync(path.join(desktop, 'app/src/services/mail-core/inbox.ts'), 'utf8');
const script = ts.transpileModule(source, {compilerOptions:{module:ts.ModuleKind.CommonJS, target:ts.ScriptTarget.ES2022}}).outputText;
const exportsObject = {};
vm.runInNewContext(script, {exports:exportsObject, require: name => imports[name] || {},
  Map, Set, JSON, Object, Error});

(async () => {
  const {queryInboxPage, inboxDesktopAccess} = exportsObject;
  const read = options => queryInboxPage({accountIds:['account'], folder:'sent', pinFirst:true, limit:4, ...options}, inboxDesktopAccess);
  const ids = result => Array.from(result.rows, row => row.id);
  assert.deepEqual(ids(await read()).slice(0, 2), ['P','A']);
  db.prepare("DELETE FROM Message WHERE id = 'a-new'").run();
  const result = await read();
  assert.deepEqual(ids(result), ['P','B','C','A'], 'deleting the newest sent message must update sort order');
  assert.deepEqual(ids(await read({offset:1, limit:2})), ['B','C'], 'sent-time order must precede paging');
  assert.equal(result.sent.messages.A.id, 'a-old');
  assert.equal(result.sent.messages.A.date, 100);
  assert.equal(result.sent.messages.B.id, 'b-gmail');
  assert.equal(result.sent.messages.C.id, 'c-2');
  assert.deepEqual(ids(await read({pinFirst:false})), ['B','C','A','P']);
  console.log('PASS actual Sent SQL shares the displayed message, deletion ordering, ties and pagination');

  db.prepare("UPDATE Message SET data = json_set(data, '$.folders', json('{}')) WHERE id = 'b-gmail'").run();
  db.prepare("INSERT INTO MessageOrphan VALUES ('b-gmail', 'account', 1)").run();
  const fallback = await read();
  assert.deepEqual(ids(fallback), ['P','C','A','B'], 'orphaned Gmail labels must not rank the conversation');
  assert.equal(fallback.sent.messages.B.id, 'b-old', 'the latest remaining copy supplies the preview');
  db.prepare("DELETE FROM Message WHERE id = 'b-old'").run();
  assert.deepEqual(ids(await read()), ['P','C','A'], 'threads without a live sent message leave the list');
  assert.deepEqual(ids(await read({offset:1, limit:2})), ['C','A'], 'orphaned threads are excluded before paging');
  console.log('PASS Gmail Sent membership, preview and pagination exclude messages without a local copy');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => db.close());
