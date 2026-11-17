#!/usr/bin/env node
// Regenerate the checked-in macOS icon from its SVG; no external assets or font dependency.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const upstream = path.resolve(process.argv[2] || path.join(root, 'research/.local/Mailspring'));
const { chromium } = require(path.join(upstream, 'node_modules/playwright'));
const brand = path.join(root, 'assets/brand');
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PAPER_REED_CHROMIUM });
  const work = fs.mkdtempSync(path.join(os.tmpdir(), 'paper-reed-icon-'));
  const iconset = path.join(work, 'paper-reed.iconset');
  fs.mkdirSync(iconset);
  try {
    const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
    await page.setContent('<style>html,body{margin:0;width:100%;height:100%;background:transparent}svg{display:block;width:100%;height:100%}</style>' + fs.readFileSync(path.join(brand, 'app-icon.svg'), 'utf8'));
    const sizes = [16, 32, 128, 256, 512];
    for (const size of sizes) for (const scale of [1, 2]) {
      await page.setViewportSize({ width: size * scale, height: size * scale });
      await page.screenshot({ path: path.join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`), omitBackground: true });
    }
    fs.copyFileSync(path.join(iconset, 'icon_512x512@2x.png'), path.join(brand, 'app-icon.png'));
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', path.join(brand, 'paper-reed.icns')]);
    console.log('Generated Paper Reed PNG and ICNS (16–1024 px)');
  } finally {
    await browser.close();
    fs.rmSync(work, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
