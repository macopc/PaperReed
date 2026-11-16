#!/usr/bin/env node
// Experimental CLI. Uses the pinned desktop checkout's MCP SDK; never opens SQLite.
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const commands = { 'draft-get': 'get_draft', 'draft-create': 'create_draft',
  'draft-update': 'update_draft', 'draft-send': 'send_draft', 'operation-get': 'get_operation' };
(async () => {
  const [command] = process.argv.slice(2);
  if (command === '--help') { console.log('paper-reed.cjs draft-get|draft-create|draft-update|draft-send|operation-get < request.json'); return; }
  if (!commands[command]) throw new Error('Usage: paper-reed.cjs draft-get|draft-create|draft-update|draft-send|operation-get < request.json');
  const upstream = process.env.PAPER_REED_UPSTREAM;
  const tokenFile = process.env.PAPER_REED_TOKEN_FILE;
  if (!upstream || !tokenFile) throw new Error('Set PAPER_REED_UPSTREAM and PAPER_REED_TOKEN_FILE');
  const endpoint = new URL(process.env.PAPER_REED_MCP_URL || 'http://127.0.0.1:2587/mcp');
  if (endpoint.protocol !== 'http:' || endpoint.hostname !== '127.0.0.1' || endpoint.pathname !== '/mcp' || endpoint.username || endpoint.password)
    throw new Error('Only http://127.0.0.1:<port>/mcp is supported');
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (!input.accountId) throw new Error('accountId is required');
  const requireDesktop = createRequire(path.resolve(upstream, 'app/package.json'));
  const { Client } = requireDesktop('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = requireDesktop('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const token = fs.readFileSync(tokenFile, 'utf8').trim();
  if (!token) throw new Error('Token file is empty');
  const client = new Client({ name: 'paper-reed-cli', version: '0.0.1' });
  try {
    await client.connect(new StreamableHTTPClientTransport(endpoint, {
      requestInit: { headers: { Authorization: `Bearer ${token}` }, redirect: 'error' },
    }));
    const result = await client.callTool({ name: commands[command], arguments: input });
    const item = result.content?.find((c) => c.type === 'text');
    if (!item) throw new Error('Missing structured response');
    let output;
    try { output = JSON.parse(item.text); } catch {
      if (!result.isError) throw new Error('Invalid JSON response');
      output = { error: item.text };
    }
    process.stdout.write(JSON.stringify(output) + '\n');
    if (result.isError) process.exitCode = 1;
  } finally { await client.close(); }
})().catch((error) => {
  process.stderr.write(JSON.stringify({ error: error.message }) + '\n');
  process.exitCode = 1;
});
