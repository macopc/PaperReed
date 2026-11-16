#!/usr/bin/env node
// Ships with the desktop app and uses its pinned MCP SDK. Never opens the mail database.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const VERSION = '0.1.0-experimental';
const mailActions = {
  'mark-read': 'read',
  'mark-unread': 'unread',
  archive: 'archive',
  spam: 'spam',
  trash: 'trash',
  'restore-inbox': 'inbox',
};
const commands = {
  ...Object.fromEntries(
    Object.keys(mailActions).map((name) => [name, ['organize_mail', null]])
  ),
  'change-get': ['mail_task_status', 'accountId'],
  undo: ['undo_mail_task', 'accountId'],
  accounts: ['list_accounts', null],
  folders: ['list_folders', 'accountId'],
  threads: ['list_threads', 'accountId'],
  search: ['search_mail', 'accountId'],
  'thread-get': ['get_thread', 'threadId'],
  'draft-get': ['get_draft', 'accountId'],
  'draft-create': ['create_draft', 'accountId'],
  'draft-update': ['update_draft', 'accountId'],
  'draft-send': ['send_draft', 'accountId'],
  'operation-get': ['get_operation', 'accountId'],
};
const examples = {
  ...Object.fromEntries(
    Object.keys(mailActions).map((name) => [
      name,
      {
        targets: [{ accountId: 'ACCOUNT_ID', threadId: 'THREAD_ID' }],
        requestId: 'UNIQUE_REQUEST_ID',
      },
    ])
  ),
  'change-get': { accountId: 'ACCOUNT_ID', taskId: 'TASK_ID' },
  undo: { accountId: 'ACCOUNT_ID', taskId: 'TASK_ID' },
  accounts: {},
  folders: { accountId: 'ACCOUNT_ID' },
  threads: { accountId: 'ACCOUNT_ID', folderId: 'FOLDER_ID', limit: 25 },
  search: { accountId: 'ACCOUNT_ID', query: 'in:inbox', limit: 25 },
  'thread-get': { threadId: 'THREAD_ID' },
  'draft-get': { accountId: 'ACCOUNT_ID', draftId: 'DRAFT_ID' },
  'draft-create': {
    accountId: 'ACCOUNT_ID',
    to: [],
    subject: '',
    body: '<div></div>',
  },
  'draft-update': {
    accountId: 'ACCOUNT_ID',
    draftId: 'DRAFT_ID',
    expectedRevision: 1,
    changes: { body: '<div>Updated</div>' },
  },
  'draft-send': {
    accountId: 'ACCOUNT_ID',
    draftId: 'DRAFT_ID',
    expectedRevision: 1,
    requestId: 'STABLE_REQUEST_ID',
  },
  'operation-get': { accountId: 'ACCOUNT_ID', operationId: 'OPERATION_ID' },
};
function fail(code, message, hint) {
  return Object.assign(new Error(message), { code, hint });
}
function endpointURL(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw fail(
      'invalid-endpoint',
      'Invalid connection address.',
      'Reinstall/update CLI connection in Paper Reed settings.'
    );
  }
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    url.pathname !== '/mcp' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    throw fail(
      'invalid-endpoint',
      'Only http://127.0.0.1:<port>/mcp is supported.',
      'Use the local connection from Paper Reed settings.'
    );
  return url;
}
function connection() {
  if (process.env.PAPER_REED_TOKEN_FILE) {
    return {
      endpoint: endpointURL(
        process.env.PAPER_REED_MCP_URL || 'http://127.0.0.1:2587/mcp'
      ),
      token: fs.readFileSync(process.env.PAPER_REED_TOKEN_FILE, 'utf8').trim(),
    };
  }
  const file = process.env.PAPER_REED_CLI_PROFILE;
  if (!file || !fs.existsSync(file))
    throw fail(
      'not-connected',
      'CLI connection is missing.',
      'Open Paper Reed → Settings → Agent → Install CLI / Update connection.'
    );
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.mode & 0o077)
    throw fail(
      'insecure-profile',
      'Connection file must be a private regular file (0600).',
      'Update the CLI connection in Paper Reed settings.'
    );
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    throw fail(
      'invalid-profile',
      'Connection file is invalid.',
      'Update the CLI connection in Paper Reed settings.'
    );
  }
  return { endpoint: endpointURL(data.endpoint), token: data.token };
}
function inputFor(command, args) {
  if (command === 'doctor' || command === 'accounts') {
    if (args.length)
      throw fail(
        'invalid-arguments',
        'This command takes no arguments.',
        'Run paper-reed --help.'
      );
    return {};
  }
  let raw;
  if (args.length === 2 && args[0] === '--input') raw = args[1];
  else if (!args.length && !process.stdin.isTTY)
    raw = fs.readFileSync(0, 'utf8');
  else
    throw fail(
      'input-required',
      'Pass JSON with --input or stdin.',
      `Run paper-reed ${command} --help.`
    );
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw fail(
      'invalid-json',
      'Input is not valid JSON.',
      `Run paper-reed ${command} --help for an example.`
    );
  }
  if (!data || typeof data !== 'object' || Array.isArray(data))
    throw fail(
      'invalid-input',
      'Input must be a JSON object.',
      `Run paper-reed ${command} --help.`
    );
  const required = commands[command][1];
  if (
    required &&
    (typeof data[required] !== 'string' || !data[required].trim())
  )
    throw fail(
      'invalid-input',
      `${required} is required.`,
      `Run paper-reed ${command} --help.`
    );
  return data;
}
function help(command) {
  if (commands[command])
    return `paper-reed ${command} --input '${JSON.stringify(examples[command])}'\nOr pass the same JSON through stdin. Results are JSON; failures exit 1.\n${mailActions[command] ? 'Returns per-target task receipts. queued is not success; poll change-get. Reuse requestId only for the same targets/action while task history remains.\n' : ''}${command === 'draft-send' ? 'Send only with explicit user approval. Keep requestId stable across retries; inspect operation-get after uncertain results.\n' : ''}`;
  return `Paper Reed CLI ${VERSION}\n\nStart here:\n  paper-reed doctor             Check the local connection (read-only)\n  paper-reed accounts           List authorized accounts\n  paper-reed <command> --help   Show a JSON example\n\nRead: accounts, folders, threads, search, thread-get\nDrafts: draft-get, draft-create, draft-update, draft-send, operation-get\nOrganize: mark-read, mark-unread, archive, spam, trash, restore-inbox, change-get, undo\n\nJSON input: --input '{...}' or stdin. JSON output; errors exit 1.\nInstall/connect from Paper Reed → Settings → Agent. Keep the app running.\nNo mail is sent by installation or doctor. Sending requires permission and user approval.\n`;
}
async function main() {
  const [command, ...args] = process.argv.slice(2);
  if (command === '--version') {
    console.log(VERSION);
    return;
  }
  if (!command || command === '--help' || command === 'help') {
    console.log(help());
    return;
  }
  if (!commands[command] && command !== 'doctor')
    throw fail(
      'unknown-command',
      `Unknown command: ${command}`,
      'Run paper-reed --help.'
    );
  if (args.length === 1 && args[0] === '--help') {
    console.log(command === 'doctor' ? help() : help(command));
    return;
  }
  const input = inputFor(command, args);
  if (mailActions[command]) input.action = mailActions[command];
  const { endpoint, token } = connection();
  if (typeof token !== 'string' || !token.trim())
    throw fail(
      'not-connected',
      'Connection token is empty.',
      'Update the CLI connection in Paper Reed settings.'
    );
  const appRoot = process.env.PAPER_REED_UPSTREAM
    ? path.resolve(process.env.PAPER_REED_UPSTREAM, 'app')
    : path.resolve(__dirname, '../../..');
  let Client, Transport;
  try {
    const requireApp = createRequire(path.join(appRoot, 'package.json'));
    ({ Client } = requireApp('@modelcontextprotocol/sdk/client/index.js'));
    ({ StreamableHTTPClientTransport: Transport } = requireApp(
      '@modelcontextprotocol/sdk/client/streamableHttp.js'
    ));
  } catch {
    throw fail(
      'runtime-missing',
      'Desktop CLI dependencies are unavailable.',
      'Reinstall CLI from the current Paper Reed app. Source runs also need PAPER_REED_UPSTREAM.'
    );
  }
  const client = new Client({ name: 'paper-reed-cli', version: VERSION });
  const transport = new Transport(endpoint, {
    requestInit: {
      headers: { Authorization: `Bearer ${token}` },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
    },
  });
  try {
    await client.connect(transport, { timeout: 10000 });
    const result = await client.callTool(
      {
        name: command === 'doctor' ? 'list_accounts' : commands[command][0],
        arguments: input,
      },
      undefined,
      { timeout: 10000 }
    );
    const item = result.content?.find((c) => c.type === 'text');
    if (!item)
      throw fail(
        'invalid-response',
        'No structured response received.',
        'Update Paper Reed and its CLI together.'
      );
    let output;
    try {
      output = JSON.parse(item.text);
    } catch {
      if (!result.isError)
        throw fail(
          'invalid-response',
          'Invalid JSON response.',
          'Update Paper Reed and its CLI together.'
        );
      output = { error: item.text };
    }
    if (result.isError) {
      process.stdout.write(JSON.stringify(output) + '\n');
      process.exitCode = 1;
      return;
    }
    if (
      output?.items?.some((item) =>
        ['rejected', 'failed'].includes(item.status)
      )
    )
      process.exitCode = 1;
    if (command === 'doctor')
      output = {
        ok: true,
        version: VERSION,
        endpoint: endpoint.href,
        authorizedAccounts: output.length,
        next: output.length
          ? 'Run paper-reed accounts.'
          : 'Allow an account in Paper Reed → Settings → Agent.',
      };
    process.stdout.write(JSON.stringify(output) + '\n');
  } catch (error) {
    if (/401|Unauthorized/i.test(error.message))
      throw fail(
        'authentication-failed',
        'The connection token was rejected.',
        'Click Update connection in Paper Reed → Settings → Agent, then retry doctor.'
      );
    if (/fetch failed|ECONNREFUSED|timeout|timed out/i.test(error.message))
      throw fail(
        'connection-unavailable',
        'Cannot reach Paper Reed.',
        command === 'draft-send'
          ? 'Send outcome may be unknown. Keep requestId unchanged; inspect the operation or mailbox before retrying.'
          : 'Keep Paper Reed running, enable Agent access, and update the CLI connection if the port changed.'
      );
    throw error;
  } finally {
    // Release the per-invocation HTTP session. Cleanup must not mask a send result.
    try {
      await transport.terminateSession();
    } catch {}
    await client.close();
  }
}
main().catch((error) => {
  process.stderr.write(
    JSON.stringify({
      error: error.message,
      code: error.code || 'cli-error',
      hint:
        error.hint ||
        'Run paper-reed doctor or check Agent permissions in Paper Reed.',
    }) + '\n'
  );
  process.exitCode = 1;
});
