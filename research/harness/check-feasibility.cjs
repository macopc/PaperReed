// Runs upstream handlers with isolated dependencies. No real accounts or messages are used.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const test = require('node:test');
const ts = require('typescript');
const { z } = require('zod');
const root = path.resolve(__dirname, '../..');

test('Mailspring actual stdio bridge forwards calls and reloads a rotated token', { timeout: 10000 }, async (t) => {
  const http = require('node:http');
  const os = require('node:os');
  const { spawn } = require('node:child_process');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'mail-route-research-'));
  const requests = [];
  const server = http.createServer(async (req, res) => {
    if (req.method === 'DELETE') { res.writeHead(200); res.end(); return; }
    let body = '';
    for await (const chunk of req) body += chunk;
    const rpc = JSON.parse(body);
    requests.push({ rpc, token: req.headers.authorization });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Mcp-Session-Id', 'research-session');
    const result = rpc.method === 'initialize'
      ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'research-fixture', version: '1' } }
      : { content: [{ type: 'text', text: JSON.stringify(rpc.params) }] };
    res.end(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const saveToken = (token) => fs.writeFileSync(path.join(temp, 'config.json'), JSON.stringify({ '*': { core: { mcp: { enabled: true, token, port: server.address().port } } } }));
  saveToken('fixture-token-1');
  const child = spawn(process.execPath, [path.join(root, 'Mailspring/app/internal_packages/mcp-server/lib/mcp-stdio-bridge.js'), '--config-dir', temp], { stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(async () => {
    child.kill('SIGTERM');
    await new Promise((resolve) => child.exitCode !== null ? resolve() : child.once('exit', resolve));
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(temp, { recursive: true, force: true });
  });
  let buffer = '';
  const waiting = new Map();
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString();
    for (;;) {
      const boundary = buffer.indexOf('\n');
      if (boundary < 0) break;
      const message = JSON.parse(buffer.slice(0, boundary));
      buffer = buffer.slice(boundary + 1);
      const resolve = waiting.get(message.id);
      if (resolve) { waiting.delete(message.id); resolve(message); }
    }
  });
  const call = (id, method, params) => new Promise((resolve) => {
    waiting.set(id, resolve);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  assert.ok((await call(1, 'initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'research', version: '1' } })).result);
  saveToken('fixture-token-2');
  const response = await call(2, 'tools/call', { name: 'search_mail', arguments: { query: 'subject:research' } });
  assert.equal(JSON.parse(response.result.content[0].text).name, 'search_mail');
  assert.equal(requests[0].token, 'Bearer fixture-token-1');
  assert.equal(requests[1].token, 'Bearer fixture-token-2');
});

function load(relative, dependencies, globals = {}) {
  const filename = path.join(root, relative);
  const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
  }).outputText;
  const module = { exports: {} };
  const requireStub = (id) => {
    if (Object.hasOwn(dependencies, id)) return dependencies[id];
    if (['fs', 'path', 'crypto', 'http', 'os', 'zod'].includes(id)) return require(id);
    throw new Error(`Unmocked import ${id} in ${relative}`);
  };
  vm.runInNewContext('(function(require,module,exports){' + code + '\n})', {
    console, Buffer, setTimeout, clearTimeout, ...globals,
  }, { filename })(requireStub, module, module.exports);
  return module.exports;
}

const mp = 'Mailspring/app/internal_packages/mcp-server/lib/';
function mailspring() {
  const config = { 'core.mcp.accessLevel': 'read-only', 'core.mcp.enabledAccounts': {} };
  const globals = { AppEnv: { config: { get: (key) => config[key] } } };
  const queued = [];
  const waited = [];
  const draft = { id: 'draft-1', headerMessageId: 'header-1', accountId: 'account-a', draft: true, folderIds: [] };
  class Model { constructor(fields) { Object.assign(this, fields); } }
  class Task extends Model {}
  const chain = new Proxy(function () {}, { get: (_, k) => k === 'then' ? undefined : chain, apply: () => chain });
  class Message extends Model {}
  Message.attributes = chain;
  class Thread extends Model {}
  Thread.attributes = chain;
  const db = {
    findBy: () => ({ include: async () => draft }),
    modelify: async (_, ids) => ids.map((id) => ({ id, accountId: 'account-a', categories: [] })),
  };
  const exports = {
    DatabaseStore: db, Thread, Message, Contact: Model,
    DraftFactory: { useHTML: () => false, createDraft: async (fields) => ({ ...draft, ...fields }) },
    SyncbackDraftTask: Task,
    SendDraftTask: { forSending: (d, options) => new Task({ draft: d, options, kind: 'send' }) },
    Actions: { queueTask: (t) => queued.push(t) },
    TaskFactory: { tasksForArchiving: ({ threads, source }) => [new Task({ threads, source, kind: 'archive' })] },
    TaskQueue: { waitForPerformLocal: async (t) => waited.push(t) },
  };
  const grant = load('Mailspring/app/src/services/mail-access/grant.ts', {});
  const access = load(mp + 'mcp-access-control.ts', {
    'mailspring-exports': exports,
    '../../../src/services/mail-access/grant': grant,
  }, globals);
  const tools = load(mp + 'mcp-tools.ts', {
    '@modelcontextprotocol/sdk/server/mcp.js': {},
    'mailspring-exports': exports,
    './mcp-access-control': access,
    './mcp-serializers': {},
    '../../../src/services/mail-access/audit': { audited: async (_, __, ___, fn) => fn() },
    '../../../src/services/mail-access/queries': {},
    '../../../src/services/mail-access/filter': {},
    '../../../src/services/mail-access/counts': { DIMS: ['sender', 'domain'] },
    '../../../src/services/mail-access/identity': {},
  }, globals);
  const handlers = {};
  const schemas = {};
  tools.registerTools({ tool: (name, _, schema, handler) => {
    handlers[name] = handler;
    schemas[name] = schema;
  } });
  return { config, queued, waited, handlers, schemas, access };
}

test('Mailspring registers 24 upstream mail tools', () => {
  const { handlers } = mailspring();
  assert.equal(Object.keys(handlers).length, 24);
  for (const name of ['search_mail', 'get_thread', 'create_draft', 'reply_to_thread', 'archive_threads', 'send_draft']) assert.equal(typeof handlers[name], 'function');
});

test('Mailspring read-only denies draft/write/send before queuing', async () => {
  const { handlers, queued } = mailspring();
  for (const name of ['create_draft', 'archive_threads', 'send_draft']) {
    assert.equal((await handlers[name]({})).isError, true);
  }
  assert.equal(queued.length, 0);
});

test('Mailspring draft invokes sync task and waits for local completion', async () => {
  const { handlers, config, queued, waited } = mailspring();
  config['core.mcp.accessLevel'] = 'read-draft';
  const result = await handlers.create_draft({ to: [{ email: 'recipient@example.invalid' }], subject: 'Research', body: 'hello' });
  assert.ok(!result.isError);
  assert.equal(queued.length, 1);
  assert.equal(queued[0].draft.pristine, false);
  assert.equal(queued[0].draft.subject, 'Research');
  assert.equal(waited[0], queued[0]);
  assert.equal(JSON.parse(result.content[0].text).headerMessageId, 'header-1');
  assert.equal((await handlers.send_draft({ headerMessageId: 'header-1' })).isError, true);
});

test('Mailspring disallowed default account cannot persist a draft', async () => {
  const { handlers, config, queued } = mailspring();
  config['core.mcp.accessLevel'] = 'read-draft';
  config['core.mcp.enabledAccounts'] = { 'account-b': { enabled: true } };
  assert.equal((await handlers.create_draft({ to: [], subject: 'Research', body: 'hello' })).isError, true);
  assert.equal(queued.length, 0);
});

test('Mailspring archive success currently means queued, not remotely complete', async () => {
  const { handlers, config, queued, waited } = mailspring();
  config['core.mcp.accessLevel'] = 'read-write';
  const result = await handlers.archive_threads({ threadIds: ['thread-1'] });
  assert.equal(JSON.parse(result.content[0].text).archived, 1);
  assert.equal(queued[0].kind, 'archive');
  assert.equal(waited.length, 0);
});

test('Mailspring send reports sent:true before any sync completion wait', async () => {
  const { handlers, config, queued, waited } = mailspring();
  config['core.mcp.accessLevel'] = 'read-write-send';
  const result = await handlers.send_draft({ headerMessageId: 'header-1' });
  assert.equal(JSON.parse(result.content[0].text).sent, true);
  assert.equal(queued[0].kind, 'send');
  assert.equal(waited.length, 0);
});

// Characterization of the pinned handler, not a claim that a real SMTP server
// receives two messages: the database and queue are fixtures here.
test('Mailspring repeated send calls enqueue separate tasks for the same cached draft', async () => {
  const { handlers, config, queued } = mailspring();
  config['core.mcp.accessLevel'] = 'read-write-send';
  for (let i = 0; i < 2; i++) {
    const result = await handlers.send_draft({ headerMessageId: 'header-1' });
    assert.equal(result.isError, undefined);
    assert.equal(JSON.parse(result.content[0].text).sent, true);
  }
  assert.equal(queued.length, 2);
  assert.notEqual(queued[0], queued[1]);
  assert.equal(queued[0].draft.headerMessageId, queued[1].draft.headerMessageId);
});

test('Mailspring MCP draft handoff lacks update and send revision/request-id inputs', () => {
  const { handlers, schemas } = mailspring();
  assert.equal(handlers.update_draft, undefined);
  assert.deepEqual(Object.keys(schemas.send_draft), ['headerMessageId']);
});

test('Zero MCP account switch leaves ordinary mail handlers bound to initial account', async () => {
  const accounts = [{ id: 'account-a', email: 'a@example.invalid', providerId: 'google' }, { id: 'account-b', email: 'b@example.invalid', providerId: 'imap' }];
  const db = { query: { connection: {
    findFirst: async ({ where }) => where?.and
      ? accounts.find((a) => a.email === where.and.find((c) => c.column === 'email')?.value)
      : where?.column === 'id' ? accounts.find((a) => a.id === where.value) : accounts[0],
    findMany: async () => accounts,
  } } };
  const calls = [];
  class McpServer {
    constructor() { this.handlers = {}; }
    registerTool(name, _, handler) { this.handlers[name] = handler; }
  }
  class McpAgent { constructor() { this.props = { userId: 'user-1' }; this.ctx = { waitUntil: () => {} }; } }
  const { ZeroMCP } = load('Zero/apps/server/src/routes/agent/mcp.ts', {
    '../../lib/thread-short-summary': {},
    '@modelcontextprotocol/sdk/server/mcp.js': { McpServer },
    '../../trpc/routes/ai/compose': {}, '../../lib/prompts': {},
    '../../lib/server-utils': { getZeroAgent: async (id) => ({ create: async () => calls.push(id) }) },
    '../../db/schema': { connection: { id: 'id', userId: 'userId', email: 'email' } },
    '../../lib/utils': { FOLDERS: { INBOX: 'inbox' } },
    'drizzle-orm': { eq: (column, value) => ({ column, value }), and: (...and) => ({ and }) },
    'agents/mcp': { McpAgent },
    '../../db': { createDb: () => ({ db, conn: { end: async () => {} } }) },
    '../../env': { env: { HYPERDRIVE: { connectionString: 'unused' } } },
  });
  const instance = new ZeroMCP();
  await instance.init();
  await instance.server.handlers.setActiveConnection({ email: accounts[1].email });
  assert.equal(instance.activeConnectionId, 'account-b');
  await instance.server.handlers.sendEmail({ to: [], subject: 'Research', message: 'hello' });
  assert.deepEqual(calls, ['account-a']);
});
