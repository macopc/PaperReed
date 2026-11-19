const assert = require('node:assert/strict');
module.exports = async ({ main, cdp, run, action, shot, until, cli, account, draft }) => {
  const selected = () => run('require("mailspring-exports").SignatureStore.selectedSignature()');
  await action('.pr-template-html');
  const customHtml = '<div>Keep this custom signature until I confirm.</div>';
  await main.locator('#signature-body').fill(customHtml);
  await until(async () => (await selected()).body === customHtml, 'custom HTML saved before switching');
  const original = await selected();
  // Only the native dialog response is substituted; the real editor checks and store writes run.
  await run(`window.prOriginalDialog=require('@electron/remote').dialog.showMessageBoxSync;
    window.prDialogCalls=0; window.prDialogResponse=0;
    require('@electron/remote').dialog.showMessageBoxSync=()=>{window.prDialogCalls++;return window.prDialogResponse;};true`);
  try {
    await action('[data-template="SignatureB"]');
    assert.equal(await run('window.prDialogCalls'), 1);
    assert.deepEqual(await selected(), original);
    await run('window.prDialogResponse=1;true');
    await action('[data-template="SignatureB"]');
    await until(async () => (await selected()).data.templateName === 'SignatureB', 'confirmed template replacement');
    assert.equal(await run('window.prDialogCalls'), 2);
  } finally {
    await run(`require('@electron/remote').dialog.showMessageBoxSync=window.prOriginalDialog;delete window.prOriginalDialog;true`);
  }
  await action('#name'); await main.keyboard.press('Meta+A'); await main.keyboard.insertText('Maya Chen');
  await action('#title'); await main.keyboard.press('Meta+A'); await main.keyboard.insertText('Design · Paper Reed');
  await run('document.querySelector("[data-template=SignatureC]").focus();true');
  await main.keyboard.press('Enter');
  await until(async () => (await selected()).data.templateName === 'SignatureC', 'keyboard template selection');
  assert((await selected()).body.includes('Maya Chen'));
  assert(await run('Array.from(document.querySelectorAll(".pr-template-preview")).every(el=>el.hasAttribute("inert"))'));
  const templated = await selected();
  await action('.pr-template-html');
  await until(async () => !(await selected()).data.templateName, 'HTML mode');
  assert.equal((await selected()).body, templated.body);
  await action('[data-template="SignatureC"]');
  await until(async () => (await selected()).data.templateName === 'SignatureC', 'unmodified HTML roundtrip');
  await action('[data-settings-tab="MCP"]');
  await until(() => run('!!document.querySelector(".container-mcp")'), 'real Agent settings');
  assert(await run('document.activeElement.matches("[data-settings-tab=MCP]")'));
  await run('document.querySelector("[data-settings-tab=Signatures]").focus();true');
  await main.keyboard.press('Enter');
  await until(() => run('!!document.querySelector(".pr-signature-settings")'), 'keyboard return to signatures');
  assert.equal((await selected()).data.templateName, 'SignatureC');
  assert(await run('document.activeElement.matches("[data-settings-tab=Signatures]")'));
  await shot('navigation-templates');
  await cdp.send('Emulation.setDeviceMetricsOverride', {width:900,height:700,deviceScaleFactor:1,mobile:false});
  await shot('navigation-compact');
  assert(await run(`(()=>{const els=['.pr-preferences-nav','.pr-signature-detail','.pr-template-grid'];return els.every(s=>{const e=document.querySelector(s),r=e.getBoundingClientRect();return r.left>=0 && r.right<=innerWidth+1 && e.scrollWidth<=e.clientWidth+1;});})()`));
  await action('.pr-settings-back');
  await until(() => run('!!document.querySelector("[data-mailbox=drafts]") && !document.querySelector(".pr-preferences-nav")'), 'return to mailbox');
  await until(() => run('!!document.querySelector("[contenteditable=true]")'), 'compose restored');
  const saved = await cli('draft-get', {accountId:account.id,draftId:draft.draftId});
  assert(saved.body.includes('请保留这段正文'));
  assert(saved.body.includes('data-emoji-name'));
  await cdp.send('Emulation.setDeviceMetricsOverride', {width:1440,height:900,deviceScaleFactor:1,mobile:false});
  console.log('PASS navigation, keyboard template, HTML replacement cancel/confirm, HTML roundtrip, compact layout, draft return');
};
