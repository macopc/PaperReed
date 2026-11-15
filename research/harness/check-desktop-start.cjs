const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
// Run from the complete isolated Mailspring checkout; use its locked toolchain.
const upstreamRequire = createRequire(path.resolve('package.json'));
const { _electron } = upstreamRequire('playwright');
(async () => {
  let app;
  const configDir = fs.mkdtempSync(path.resolve('../ui-smoke-'));
  const launchEnv = { ...process.env };
  delete launchEnv.ELECTRON_RUN_AS_NODE;
  delete launchEnv.PLAYWRIGHT;
  const report = { mode: 'fresh isolated config; no PLAYWRIGHT fixture mode; loopback-only OS sandbox; Chromium sandbox disabled for nested-sandbox startup check', windows: [] };
  try {
    app = await _electron.launch({
      executablePath: upstreamRequire('electron'),
      args: [path.resolve('app'), '--dev', '--no-sandbox', '--crash-dumps-dir=' + path.join(configDir, 'crashes'), '--config-dir-path', configDir],
      env: launchEnv,
      timeout: 30000,
    });
    const page = await app.firstWindow({ timeout: 30000 });
    await page.waitForTimeout(8000);
    for (const window of app.windows()) {
      const session = await app.context().newCDPSession(window);
      const { root } = await session.send('DOM.getDocument', { depth: -1 });
      const chunks = [];
      function visit(node) {
        if (['SCRIPT', 'STYLE', 'HEAD'].includes(node.nodeName)) return;
        if (node.nodeType === 3 && node.nodeValue.trim()) chunks.push(node.nodeValue.trim());
        for (const child of node.children || []) visit(child);
      }
      visit(root);
      report.windows.push({ windowType: JSON.parse(new URL(window.url()).searchParams.get('loadSettings') || '{}').windowType, text: chunks.join(' ').slice(0, 1500) });
      await session.detach();
    }
    report.process = await app.evaluate(({ app }) => ({ version: app.getVersion(), userData: app.getPath('userData') }));
    report.ok = report.windows.some(w => /Mailspring|Welcome|Get Started|欢迎/.test(w.text || ''));
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    report.error = String(error);
    process.exitCode = 1;
  } finally {
    if (app) await app.close();
    fs.writeFileSync(path.resolve('../electron-smoke.json'), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  }
})();
