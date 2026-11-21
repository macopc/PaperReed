const assert = require('node:assert/strict');
const { execFile } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { mkdtemp, readFile, readlink, rm, symlink, writeFile } = require('node:fs/promises');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { test } = require('node:test');

const cli = process.env.PAPER_REED_NATIVE_CLI;
const baseline = path.resolve(__dirname, '../cli-comparison-2026-11-21/node-baseline.cjs');
if (!cli) throw new Error('Set PAPER_REED_NATIVE_CLI to the built executable.');
const protocol = '2025-06-18';
const sessionId = 'fixture-session';

async function withDesktop(handler, run) {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'paper-reed-transport-'));
  const token = randomUUID();
  const tokenFile = path.join(dir, 'token');
  const calls = [];
  let fixtureError;
  const server = http.createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : null;
      calls.push(body?.method ?? req.method);
      assert.equal(req.url, '/mcp');
      assert.equal(req.headers.authorization, `Bearer ${token}`);
      handler(req, res, body);
    } catch (error) {
      fixtureError = error;
      res.destroy();
    }
  });

  try {
    await writeFile(tokenFile, token, { mode: 0o600 });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const env = {
      ...process.env,
      PAPER_REED_MCP_URL: `http://127.0.0.1:${server.address().port}/mcp`,
      PAPER_REED_TOKEN_FILE: tokenFile,
    };
    const exec = (file, args, customEnv = {}) => new Promise((resolve, reject) => {
      execFile(file, args, { env: { ...env, ...customEnv }, timeout: 5000 }, (error, stdout, stderr) => {
        if (error && typeof error.code !== 'number') reject(error);
        else resolve({ code: error?.code ?? 0, stdout, stderr });
      });
    });
    await run((...args) => exec(cli, args), calls, exec, env, dir);
    if (fixtureError) throw fixtureError;
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
}

function reply(res, body, result, sse) {
  const frame = { jsonrpc: '2.0', id: body.id, result };
  if (sse) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.write(': fixture comment\r\n\r\nevent: message\r\ndata: ');
    res.end(JSON.stringify(frame) + '\r\n\r\n');
  } else {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(frame));
  }
}

function desktop(tool, { sse = true, stateful = true, cleanupStatus = 200 } = {}) {
  return (req, res, body) => {
    if (body?.method === 'initialize') {
      if (stateful) res.setHeader('Mcp-Session-Id', sessionId);
      reply(res, body, { protocolVersion: protocol, capabilities: {}, serverInfo: { name: 'Fixture', version: '1' } }, sse);
      return;
    }
    assert.equal(req.headers['mcp-session-id'], stateful ? sessionId : undefined);
    assert.equal(req.headers['mcp-protocol-version'], protocol);
    if (req.method === 'DELETE') {
      res.writeHead(cleanupStatus).end();
    } else if (body?.method === 'notifications/initialized') {
      res.writeHead(202).end();
    } else {
      assert.equal(body.method, 'tools/call');
      tool(req, res, body, sse);
    }
  };
}

test('stateful SSE uses the negotiated headers and preserves tool output when cleanup fails', async () => {
  const response = [{ subject: '邮件 🚀' }];
  await withDesktop(desktop((req, res, body, sse) => {
    assert.deepEqual(body.params, { name: 'search_mail', arguments: { accountId: 'work', query: 'subject:邮件' } });
    reply(res, body, { content: [{ type: 'text', text: JSON.stringify(response) }] }, sse);
  }, { cleanupStatus: 500 }), async (invoke, calls) => {
    const result = await invoke('search', '--input', '{"accountId":"work","query":"subject:邮件"}');
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), response);
    assert.deepEqual(calls, ['initialize', 'notifications/initialized', 'tools/call', 'DELETE']);
  });
});

test('stateless JSON preserves application error output and exit status', async () => {
  await withDesktop(desktop((req, res, body, sse) => {
    reply(res, body, { isError: true, content: [{ type: 'text', text: '{"error":"account-forbidden"}' }] }, sse);
  }, { sse: false, stateful: false }), async (invoke, calls) => {
    const result = await invoke('accounts');
    assert.equal(result.code, 1);
    assert.deepEqual(JSON.parse(result.stdout), { error: 'account-forbidden' });
    assert.deepEqual(calls, ['initialize', 'notifications/initialized', 'tools/call']);
  });
});

test('an interrupted send is never retried and retains receipt recovery guidance', async () => {
  await withDesktop(desktop((req, res, body) => {
    assert.equal(body.params.arguments.requestId, 'send-once');
    res.destroy();
  }), async (invoke, calls) => {
    const result = await invoke('draft-send', '--input', '{"accountId":"work","draftId":"draft","expectedRevision":1,"requestId":"send-once"}');
    assert.equal(result.code, 1);
    assert.equal(result.stdout, '');
    const failure = JSON.parse(result.stderr);
    assert.equal(failure.code, 'connection-unavailable');
    assert.match(failure.hint, /original input.*requestId/);
    assert.deepEqual(calls, ['initialize', 'notifications/initialized', 'tools/call', 'DELETE']);
  });
});

test('denied requests and redirects end before tool invocation', async () => {
  for (const [status, expected] of [[401, 'authentication-failed'], [307, 'cli-error']]) {
    await withDesktop((req, res) => res.writeHead(status, { Location: '/elsewhere' }).end(), async (invoke, calls) => {
      const result = await invoke('accounts');
      assert.equal(result.code, 1);
      assert.equal(JSON.parse(result.stderr).code, expected);
      assert.deepEqual(calls, ['initialize']);
    });
  }
});

test('native CLI matches the Node baseline for every help example and tool call', async () => {
  const { commands } = JSON.parse(await readFile(path.resolve(__dirname, '../cli/native/catalog.json')));
  const names = [...Object.keys(commands), 'doctor'];
  const sendCalls = [];
  await withDesktop(desktop((req, res, body, sse) => {
    let data = body.params.name === 'list_accounts' ? [{ id: 'work' }] : body.params;
    if (body.params.name === 'send_draft') {
      sendCalls.push(body.params.arguments);
      data = { operationId: 'fixture-operation', state: 'queued' };
    }
    reply(res, body, { content: [{ type: 'text', text: JSON.stringify(data) }] }, sse);
  }), async (invoke, calls, exec) => {
    const node = (...args) => exec(process.execPath, [baseline, ...args]);
    for (const args of [['--help'], ['--version'], ...names.map((name) => [name, '--help'])]) {
      assert.deepEqual(await invoke(...args), await node(...args), args.join(' '));
    }
    for (const name of names) {
      const entry = commands[name];
      const args = !entry || entry.noInput ? [name] : [name, '--input', JSON.stringify(entry.example)];
      const actual = await invoke(...args);
      const legacy = await node(...args);
      assert.equal(actual.code, 0, name + actual.stderr);
      assert.equal(actual.code, legacy.code, name);
      assert.deepEqual(JSON.parse(actual.stdout), JSON.parse(legacy.stdout), name);
    }
    for (const args of [['missing-command'], ['doctor', 'extra'], ['search', '--input', '[]'],
      ['search', '--input', '{'], ['search', '--input', '{}'], ['draft-send', '--wrong']]) {
      assert.deepEqual(JSON.parse((await invoke(...args)).stderr), JSON.parse((await node(...args)).stderr), args.join(' '));
    }
    assert.equal(calls.filter((method) => method === 'tools/call').length, names.length * 2);
    assert.deepEqual(sendCalls, [commands['draft-send'].example, commands['draft-send'].example]);
  });
});

test('desktop installer upgrades an owned launcher, preserves its profile and executes native', async () => {
  const installer = require('../cli/install.cjs');
  const { copyFile, chmod, mkdir, unlink } = require('node:fs/promises');
  await withDesktop(desktop((req, res, body, sse) => {
    reply(res, body, { content: [{ type: 'text', text: '[{"id":"work"}]' }] }, sse);
  }), async (invoke, calls, exec, env, dir) => {
    const appRoot = path.join(dir, 'App with spaces', 'app.asar');
    const paths = installer.paths({ appRoot, configDir: path.join(dir, "Profile with ' quote"), binDir: path.join(dir, 'bin') });
    await mkdir(path.dirname(paths.executable), { recursive: true });
    await copyFile(cli, paths.executable);
    await chmod(paths.executable, 0o755);
    await mkdir(path.dirname(paths.command));
    const conn = { endpoint: env.PAPER_REED_MCP_URL, token: await readFile(env.PAPER_REED_TOKEN_FILE, 'utf8') };
    await writeFile(paths.command, `#!/bin/sh\n# Paper Reed CLI v1 ${JSON.stringify(paths.profile)}\nexit 1\n`, {mode: 0o755});
    assert.deepEqual(installer.status(paths, conn), { installed: true, ready: false });
    assert.deepEqual(await installer.install(paths, conn), { installed: true, ready: true });
    assert.equal(await readlink(paths.command), paths.installedExecutable);
    assert.equal(await readlink(paths.installedExecutable), paths.executable);
    const result = await exec('paper-reed', ['doctor'], { PATH: path.dirname(paths.command) + path.delimiter + env.PATH, PAPER_REED_MCP_URL: 'http://127.0.0.1:1/mcp' });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(JSON.parse(result.stdout).authorizedAccounts, 1);
    const alias = path.join(dir, 'mail-alias');
    await symlink(path.relative(dir, paths.command), alias);
    const viaAlias = await exec(alias, ['doctor'], { PAPER_REED_CLI_PROFILE: '/foreign/profile' });
    assert.equal(viaAlias.code, 0, viaAlias.stderr);
    assert.equal(JSON.parse(viaAlias.stdout).authorizedAccounts, 1);
    assert.equal((await exec(cli, ['doctor'], { PAPER_REED_TOKEN_FILE: '', PAPER_REED_CLI_PROFILE: paths.profile })).code, 0);
    await chmod(paths.executable, 0o644);
    assert.deepEqual(installer.status(paths, conn), { installed: true, ready: false });
    await unlink(paths.executable);
    assert.deepEqual(installer.status(paths, conn), { installed: true, ready: false });
    await mkdir(paths.executable);
    assert.deepEqual(installer.status(paths, conn), { installed: true, ready: false });
    await rm(paths.executable, { recursive: true });
    await copyFile(cli, paths.executable);
    await chmod(paths.executable, 0o755);
    assert.deepEqual(installer.status(paths, conn), { installed: true, ready: true });
    await chmod(paths.profile, 0o644);
    const invalid = await exec(cli, ['doctor'], { PAPER_REED_TOKEN_FILE: '', PAPER_REED_CLI_PROFILE: paths.profile });
    assert.equal(JSON.parse(invalid.stderr).code, 'insecure-profile');
    installer.uninstall(paths);
    assert.deepEqual(installer.status(paths, conn), { installed: false, ready: false });
  });
});

test('unknown send outcomes retain recovery guidance and never report success', async () => {
  for (const damaged of ['trailing', 'missing-content', 'invalid-text']) {
    await withDesktop(desktop((req, res, body) => {
      const text = damaged === 'invalid-text' ? 'corrupt' : '{"status":"queued"}';
      const content = damaged === 'missing-content' ? [] : [{ type: 'text', text }];
      const rpc = { jsonrpc: '2.0', id: body.id, result: { content } };
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify(rpc) + (damaged === 'trailing' ? '{}garbage' : ''));
    }), async (invoke, calls) => {
      const failure = await invoke('draft-send', '--input', '{"accountId":"work","draftId":"draft","expectedRevision":1,"requestId":"send-once"}');
      assert.equal(failure.code, 1, damaged);
      assert.equal(failure.stdout, '', damaged);
      const error = JSON.parse(failure.stderr);
      assert.equal(error.code, 'invalid-response', damaged);
      assert.match(error.hint, /unknown.*operation-get.*requestId/, damaged);
      assert.deepEqual(calls, ['initialize', 'notifications/initialized', 'tools/call', 'DELETE'], damaged);
    });
  }
});

test('MCP accepts a CR-only terminal SSE frame with a whitespace-prefixed reply batch', async () => {
  await withDesktop(desktop((req, res, body) => {
    res.setHeader('Content-Type', 'Text/Event-Stream; charset=utf-8');
    res.end('data:\r\rdata: {"jsonrpc":"2.0","id":"irrelevant","method":"fixture"}\r\rdata:  ' + JSON.stringify([{
      jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: '[]' }] },
    }]) + '\r');
  }), async (invoke) => {
    const result = await invoke('accounts');
    assert.equal(result.code, 0, result.stderr);
    assert.deepEqual(JSON.parse(result.stdout), []);
  });
});

test('non-2xx JSON retains the server diagnostic', async () => {
  await withDesktop((req, res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' }).end('{"error":{"message":"test diagnostic"}}');
  }, async (invoke) => {
    const result = await invoke('accounts');
    assert.equal(result.code, 1);
    assert.equal(JSON.parse(result.stderr).error, 'MCP HTTP 500: test diagnostic');
  });
});

test('draft admission requires an operation ID and state; explicit tool rejection still passes through', async () => {
  const args = ['draft-send', '--input', '{"accountId":"work","draftId":"draft","expectedRevision":1,"requestId":"send-once"}'];
  for (const data of [null, {}, { state: 'queued' }, { operationId: 'op' }]) {
    await withDesktop(desktop((req, res, body, sse) => {
      reply(res, body, { content: [{ type: 'text', text: JSON.stringify(data) }] }, sse);
    }), async (invoke, calls) => {
      const result = await invoke(...args);
      assert.equal(result.code, 1);
      assert.equal(result.stdout, '');
      const failure = JSON.parse(result.stderr);
      assert.equal(failure.code, 'invalid-response');
      assert.match(failure.hint, /unknown.*operation-get.*requestId/);
      assert.equal(calls.filter((method) => method === 'tools/call').length, 1);
    });
  }
  for (const rejection of [false, true]) {
    const value = rejection ? { error: 'send-not-authorized' } : { operationId: 'fixture-id', state: 'pending-admission' };
    await withDesktop(desktop((req, res, body, sse) => {
      reply(res, body, { isError: rejection, content: [{ type: 'text', text: JSON.stringify(value) }] }, sse);
    }), async (invoke) => {
      const result = await invoke(...args);
      assert.equal(result.code, rejection ? 1 : 0);
      assert.deepEqual(JSON.parse(result.stdout), value);
      assert.equal(result.stderr, '');
    });
  }
});

test('post-dispatch HTTP 500 preserves its detail and the send recovery hint', async () => {
  for (const [error, message] of [
    ['Internal server error', 'Internal server error'],
    [{ message: 'handler timeout after admission' }, 'handler timeout after admission'],
  ]) {
    await withDesktop(desktop((req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' }).end(JSON.stringify({ error }));
    }), async (invoke, calls) => {
      const result = await invoke('draft-send', '--input', '{"accountId":"work","draftId":"draft","expectedRevision":1,"requestId":"send-once"}');
      assert.equal(result.code, 1);
      assert.equal(result.stdout, '');
      const failure = JSON.parse(result.stderr);
      assert.equal(failure.error, `MCP HTTP 500: ${message}`);
      assert.match(failure.hint, /unknown.*operation-get.*requestId/);
      assert.deepEqual(calls, ['initialize', 'notifications/initialized', 'tools/call', 'DELETE']);
    });
  }
});
