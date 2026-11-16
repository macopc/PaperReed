const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
module.exports = async ({ app, main, cdp, work, account, cli, click, evaluate, until }) => {
  app.windows().forEach(page => page.on('dialog', () => {}));
  const phase = process.env.PAPER_REED_CONTROLS_PHASE || 'after';
  const out = path.resolve(__dirname, '../controls-validation-2026-11-16');
  fs.mkdirSync(out, { recursive: true });
  const run = expression => evaluate(cdp, expression);
  const action = async selector => { await run(`document.querySelector(${JSON.stringify(selector)})?.scrollIntoView({block:'nearest'});new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`); return click(main, cdp, selector); };
  const screenshot = async name => {
    await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const shot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(out, `${phase}-${name}.png`), Buffer.from(shot.data, 'base64'));
  };
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await until(() => run('document.querySelectorAll(".pr-mail-row").length===8'), 'synced fixture inbox');
  // Only the harness seeds the isolated contact fixture; the product uses its real search index.
  const contacts = await run(`['maya@studio.example.test','maya@personal.example.test'].map((email,i)=>new (require('mailspring-exports').Contact)({id:'pr-fixture-'+i,accountId:${JSON.stringify(account.id)},name:'Maya Chen',email,refs:10-i,hidden:false,source:'mail',version:1}).toJSON())`);
  require('node:child_process').execFileSync('/usr/bin/python3', ['-c', `
import json,sqlite3,sys
c=sqlite3.connect(sys.argv[1],timeout=10)
for r in json.load(sys.stdin):
 c.execute('INSERT INTO Contact (id,data,accountId,email,refs,hidden,source,version) VALUES (?,?,?,?,?,0,?,1)',(r['id'],json.dumps(r),r['aid'],r['email'],r['refs'],'mail'))
 c.execute('INSERT INTO ContactSearch (content_id,content) VALUES (?,?)',(r['id'],r['name']+' '+r['email']))
c.commit()
`, path.join(work, 'config/edgehill.db')], { input: JSON.stringify(contacts) });
  await until(() => run('require("mailspring-exports").ContactStore.searchContacts("Maya").then(r=>r.length===2)'), 'two real same-name contacts');
  await run(`AppEnv.config.set('signatures', {
    studio: {id:'studio',title:'工作',body:'<div>Maya Chen</div><div>Paper Reed · Design</div>',data:{}},
    short: {id:'short',title:'简短',body:'<div>谢谢，Maya</div>',data:{}}
  });true`);
  const draft = await cli('draft-create', { accountId: account.id, to: [], subject: '关于下一版编辑器的细节', body: '<div>你好，</div><div>这封信讨论收件人、签名与格式工具。</div><div>请保留这段正文。</div>' });
  await action('[data-mailbox="drafts"]');
  await until(() => run('document.querySelectorAll(".pr-mail-row").length===1'), 'created draft');
  await action('.pr-mail-row');
  await until(() => run('!!document.querySelector(".to-field input[role=combobox]")'), 'recipient editor');
  await action('.to-field input[role=combobox]');
  await main.keyboard.insertText('Maya');
  await until(() => run('document.querySelectorAll(".to-field [role=option]").length===2'), 'completion suggestions');
  await screenshot('recipients');
  await main.keyboard.press('Escape');
  await main.keyboard.press('Meta+A');
  await main.keyboard.press('Backspace');
  await until(() => run(phase === 'before' ? '!!document.querySelector(".signature-button-dropdown .only-item")' : '!!document.querySelector(".pr-signature-picker summary")'), 'signature component');
  await action(phase === 'before' ? '.signature-button-dropdown .only-item' : '.pr-signature-picker summary');
  await screenshot('signatures');
  await action('.pr-subject-heading textarea');
  await action('.pr-format-toggle');
  await until(() => run('!!document.querySelector(".RichEditor-toolbar .fa-bold")'), 'format tools');
  await screenshot('format');
  if (phase === 'before') { console.log('PASS captured actual controls baseline'); return; }
  const ref = { accountId: account.id, draftId: draft.draftId };
  const saved = async () => {
    if (await run('!!document.querySelector(".pr-status-line button:not(:disabled)")')) await action('.pr-status-line button:not(:disabled)');
    await until(() => run('document.querySelector(".pr-status-line").innerText.includes("已保存到本机")'), 'saved controls edit');
    return cli('draft-get', ref);
  };
  // Choose between identical names using the real combobox keyboard interaction.
  await action('.to-field input[role=combobox]');
  await main.keyboard.insertText('Maya');
  await until(() => run('document.querySelectorAll(".to-field .content-container [role=option]").length===2'), 'same-name results');
  assert(await run(`(()=>{const e=new KeyboardEvent('keydown',{key:'Enter',isComposing:true,bubbles:true,cancelable:true});document.querySelector('.to-field input[role=combobox]').dispatchEvent(e);return !e.defaultPrevented;})()`));
  assert.equal(await run('document.querySelectorAll(".to-field .token").length'), 0);
  await main.keyboard.press('ArrowDown'); await main.keyboard.press('Enter');
  await until(() => run('document.querySelector(".to-field .token")?.getAttribute("aria-label").includes("personal")'), 'selected second address');
  await main.keyboard.insertText('new.person@example.test'); await main.keyboard.press('Enter');
  await until(() => run('document.querySelectorAll(".to-field .token").length===2'), 'manual address');
  await main.keyboard.insertText('new.person@example.test'); await main.keyboard.press('Enter');
  await until(() => run('document.querySelector(".to-field input[role=combobox]").value===""'), 'duplicate committed');
  assert.equal(await run('document.querySelectorAll(".to-field .token").length'), 2);
  await main.keyboard.insertText('not-an-address'); await main.keyboard.press('Enter');
  await until(() => run('!!document.querySelector(".to-field .token.invalid")'), 'invalid address retained');
  await screenshot('invalid-recipient');
  await main.keyboard.press('Backspace'); await main.keyboard.press('Backspace');
  await until(() => run('!document.querySelector(".to-field .token.invalid")'), 'invalid address removed');
  const recipients = (await saved()).to.map(r => r.email).sort();
  assert.deepEqual(recipients, ['maya@personal.example.test', 'new.person@example.test']);
  await screenshot('selected-recipients');

  // Native buttons: keyboard selection, replacement and explicit removal preserve prose.
  await action('.pr-signature-picker summary');
  await main.keyboard.press('ArrowDown'); await main.keyboard.press('ArrowDown'); await main.keyboard.press('Enter');
  await until(() => run('document.querySelector(".pr-signature-value").innerText==="工作"'), 'keyboard signature choice');
  let body = (await saved()).body;
  assert(body.includes('请保留这段正文')); assert.equal((body.match(/<signature /g) || []).length, 1); assert(body.includes('id="studio"'));
  await action('.pr-signature-picker summary');
  await screenshot('signature-selected');
  await action('.pr-signature-menu button:nth-of-type(3)');
  await until(() => run('document.querySelector(".pr-signature-value").innerText==="简短"'), 'signature replacement');
  body = (await saved()).body;
  assert.equal((body.match(/<signature /g) || []).length, 1); assert(body.includes('id="short"')); assert(!body.includes('id="studio"')); assert(body.includes('请保留这段正文'));
  await action('.pr-signature-picker summary');
  await action('.pr-signature-menu button:first-of-type');
  body = (await saved()).body;
  assert(!body.includes('<signature')); assert(body.includes('请保留这段正文'));
  await action('.pr-signature-picker summary'); await main.keyboard.press('Escape');
  assert(await run('!document.querySelector(".pr-signature-picker").open && document.activeElement.matches(".pr-signature-picker summary")'));

  await action('[contenteditable=true]'); await main.keyboard.press('Meta+A');
  await main.keyboard.insertText('请保留这段正文，用于格式验证。');
  await until(() => run('document.querySelector("[contenteditable]").innerText.includes("用于格式验证")'), 'inserted text rendered');
  await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
  await main.keyboard.press('Meta+A');
  await until(() => run('window.getSelection().toString()==="请保留这段正文，用于格式验证。"'), 'text selected before formatting');
  await screenshot('selection');
  await action('.RichEditor-toolbar button[aria-label="加粗"]');
  await until(() => run('!!document.querySelector("[contenteditable] strong")'), 'bold applied');
  await run('document.querySelector(".RichEditor-toolbar button[aria-label=斜体]").focus();true');
  await main.keyboard.press('Space');
  await until(() => run('!!document.querySelector("[contenteditable] em")'), 'italic applied');
  await action('.RichEditor-toolbar button[aria-label="添加链接"]');
  await until(() => run('document.activeElement?.getAttribute("aria-label")==="链接地址"'), 'link input focused');
  await main.keyboard.insertText('https://example.test/design');
  await screenshot('link');
  await main.keyboard.press('Enter');
  body = (await saved()).body;
  assert(body.includes('<strong>') && body.includes('<em>')); assert(body.includes('href="https://example.test/design"')); assert(body.includes('请保留这段正文'));
  await screenshot('formatted');
  await action('.RichEditor-toolbar button[aria-label="文字颜色"]');
  await screenshot('color');
  await action('.pr-color-options button[aria-label="苇绿"]');
  body = (await saved()).body;
  assert(/#4b634f|rgb\(75, 99, 79\)/i.test(body));
  await action('.RichEditor-toolbar button[aria-label="文字颜色"]');
  await action('.pr-color-options button[aria-label="默认"]');
  body = (await saved()).body;
  assert(!/#4b634f|rgb\(75, 99, 79\)/i.test(body));
  await action('.RichEditor-toolbar button[aria-label="文字颜色"]');
  await main.keyboard.press('Escape');
  assert(await run('!document.querySelector(".color-picker .dropdown")'));
  await action('.pr-format-toggle');
  assert.equal(await run('getComputedStyle(document.querySelector(".RichEditor-toolbar")).display'), 'none');
  assert((await saved()).body.includes('<strong>'), 'hiding tools preserves formatting');
  await action('.pr-format-toggle');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 900, height: 700, deviceScaleFactor: 1, mobile: false });
  await action('.RichEditor-toolbar button[aria-label="添加链接"], .RichEditor-toolbar button[aria-label="编辑链接"]');
  await until(() => run('!!document.querySelector(".link-picker .dropdown")'), 'compact link picker');
  const bounds = await run('(()=>{const r=document.querySelector(".link-picker .dropdown").getBoundingClientRect();return {left:r.left,right:r.right,width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth};})()');
  assert(bounds.left >= 0 && bounds.right <= bounds.width && !bounds.overflow);
  await screenshot('compact'); await main.keyboard.press('Escape');
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await run('AppEnv.config.set("signatures",{});true');
  await action('.pr-signature-picker summary');
  await screenshot('signature-empty');
  assert(await run('document.querySelector(".pr-picker-empty").innerText.includes("还没有签名")'));
  const result = { sameNameKeyboardSelection:true, manualAddress:true, duplicateDeduped:true, invalidAddressVisible:true, composingEnterPreserved:true, signatureInsertReplaceRemove:true, signatureEscapeReturnsFocus:true, signatureEmptyState:true, mouseBold:true, keyboardItalic:true, linkPreservesSelection:true, colorApplyAndReset:true, compactLinkWithinViewport:true, formattingSurvivesCollapse:true, expectedSMTPSubmissions:0 };
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2)+'\n');
  fs.writeFileSync(path.join(work, 'controls-result.json'), JSON.stringify(result));
  console.log('PASS actual editor controls:', JSON.stringify(result));
};
