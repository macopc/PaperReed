// Run the actual desktop authorization module against a loopback browser callback.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(process.argv[2]);
const ts = require(path.join(root, 'node_modules/typescript'));
const source = fs.readFileSync(path.join(root, 'app/internal_packages/onboarding/lib/paper-reed-google-auth.ts'), 'utf8');
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
const scope = 'https://www.googleapis.com/auth/gmail.send';
(async () => {
  for (const mode of ['success', 'cancel-picker', 'cancel-consent', 'wrong-account', 'missing-scope', 'token-error']) {
    let authURL, tokenRequests = 0;
    const exports = {};
    const mocks = {
      '@electron/remote': { dialog: { showOpenDialog: async () => ({ canceled: mode === 'cancel-picker', filePaths: ['fixture.json'] }) } },
      fs: { promises: { readFile: async () => JSON.stringify({ installed: { client_id: 'own-client', client_secret: 'fixture-secret' } }) } },
      electron: { shell: { openExternal: async value => {
        authURL = new URL(value);
        assert.equal(authURL.hostname, 'accounts.google.com');
        const p = authURL.searchParams;
        assert.equal(p.get('client_id'), 'own-client');
        assert.equal(p.get('scope'), `openid email ${scope}`);
        assert.equal(p.get('code_challenge_method'), 'S256');
        const callback = new URL(p.get('redirect_uri'));
        assert.equal(callback.hostname, '127.0.0.1');
        callback.searchParams.set('state', 'incorrect-state');
        callback.searchParams.set('code', 'fixture-code');
        assert.equal((await fetch(callback)).status, 400);
        assert.equal(tokenRequests, 0, 'Wrong state must not exchange the code');
        callback.searchParams.set('state', p.get('state'));
        if (mode === 'cancel-consent') callback.searchParams.set('error', 'access_denied');
        assert.equal((await fetch(callback)).status, 200);
      } } },
    };
    vm.runInNewContext(js, {
      exports, require: name => mocks[name] || require(name), Buffer, URL, URLSearchParams,
      setTimeout, clearTimeout, AbortSignal,
      fetch: async (url, options) => {
        if (url === 'https://oauth2.googleapis.com/token') {
          tokenRequests++;
          const body = new URLSearchParams(options.body);
          assert.equal(body.get('client_secret'), 'fixture-secret');
          assert.equal(crypto.createHash('sha256').update(body.get('code_verifier')).digest('base64url'), authURL.searchParams.get('code_challenge'));
          return { ok: mode !== 'token-error', status: 400, json: async () => ({ access_token: 'fixture-access', refresh_token: 'fixture-refresh', scope: mode === 'missing-scope' ? 'openid email' : `openid email ${scope}` }) };
        }
        assert.equal(url, 'https://openidconnect.googleapis.com/v1/userinfo');
        assert.equal(options.headers.Authorization, 'Bearer fixture-access');
        return { ok: true, json: async () => ({ email: mode === 'wrong-account' ? 'another@example.test' : 'test@example.test', email_verified: true }) };
      },
    });
    if (mode === 'success') {
      const result = await exports.authorizeGmailSend('test@example.test');
      assert.equal(result.gmail_api_send, true);
      assert.equal(result.gmail_refresh_token, 'fixture-refresh');
      assert.equal(result.access_token, undefined, 'Access tokens are not persisted');
    } else if (mode === 'cancel-picker') {
      assert.equal(await exports.authorizeGmailSend('test@example.test'), null);
      assert.equal(tokenRequests, 0);
    } else {
      await assert.rejects(exports.authorizeGmailSend('test@example.test'));
    }
    console.log('PASS', mode);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
