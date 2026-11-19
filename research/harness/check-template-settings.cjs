const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({ main, cdp, account, cli, draft, work, evaluate, until }) => {
  const out = path.resolve(__dirname, '../template-agent-validation-2026-11-16');
  fs.mkdirSync(out, { recursive: true });
  const before = process.env.PAPER_REED_TEMPLATE_AGENT_PHASE === 'before';
  const prefix = before ? 'before' : 'after';
  const run = (expression) => evaluate(cdp, expression);
  const action = (selector) => main.locator(selector).first().click();
  const store = "require(AppEnv.getLoadSettings().resourcePath+'/internal_packages/composer-templates/lib/template-store').default";
  const directory = await run(`${store}.directory()`);
  assert.equal(path.resolve(directory), path.resolve(work, 'config/templates'));
  const items = () => run(`${store}.items()`);
  const holdDirectoryScan = async () => {
    await run(`(() => {
      const fs=require('fs');
      const filenames=fs.readdirSync(${store}.directory());
      const readdir=fs.promises.readdir;
      fs.promises.readdir=()=>new Promise(resolve=>{window.prReleaseTemplateScan=()=>resolve(filenames)});
      try { window.prPendingTemplateScan=${store}._populate(); }
      finally { fs.promises.readdir=readdir; }
      return true;
    })()`);
    return () => run('window.prReleaseTemplateScan();window.prPendingTemplateScan.then(()=>true)');
  };
  const shot = async (name) => {
    if (await run('!!document.querySelector(".pr-template-detail .RichEditor-root")')) {
      await until(() => run('!!document.querySelector(".pr-template-detail .RichEditor-toolbar button")'), 'template toolbar rendered');
    }
    await run('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
    const screenshot = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(out, `${prefix}-${name}.png`), Buffer.from(screenshot.data, 'base64'));
  };
  const nativeWidth = async (width) => {
    await cdp.send('Emulation.clearDeviceMetricsOverride');
    await run(`require('@electron/remote').getCurrentWindow().setContentSize(${width},700);true`);
    await until(() => run(`innerWidth===${width} && innerHeight===700`), `native ${width} by 700 window`);
  };
  const scrollTop = () => run(
    'document.querySelector(".preferences-content .scroll-region-content").scrollTop=0;true',
  );
  const fixture = [
    ['项目跟进', '关于项目的下一步安排', '<div>你好，</div><div>想跟进一下会上讨论的安排。请告诉我你方便确认的时间，我会整理下一步。</div><div>谢谢！</div>'],
    ['会后纪要', '今天的会议小结', '<div>以下是今天讨论的要点和待办。</div>'],
    ['交付确认', '请确认收到交付文件', '<div>交付文件已附上，请查收。</div>'],
    ['约定时间', '', '<div>请告诉我你方便的两个时间段。</div>'],
    ['礼貌催复', '', '<div>想确认这封信是否已收到。</div>'],
    ['周末值班交接与下周的对外事项汇总', '本周进展与后续', '<div>这里是本周需要同步的事项。</div>'],
  ];

  await main.getByRole('button', { name: '设置', exact: true }).click();
  await action('[data-settings-tab="Templates"]');
  const page = main.locator('.pr-templates');
  await page.waitFor();
  await until(() => run(`!!${store}._watcher`), 'isolated template directory ready');
  await run(`${store}.unwatch();true`);
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.isFile()) fs.unlinkSync(path.join(directory, entry.name));
  }
  await run(`${store}._populate().then(()=>true)`);
  await until(async () => (await items()).length === 0, 'empty templates');
  await shot('template-empty');
  if (!before) {
    assert.equal(await page.getByRole('button', { name: /^(新建模板|创建第一个模板)$/ }).count(), 1);
    assert.equal(await page.locator('.pr-template-detail').count(), 0);
  }
  for (const [name, subject, body] of fixture) {
    fs.writeFileSync(path.join(directory, name + '.html'),
      subject ? `<meta name="subject" content="${subject}"/>\n${body}` : body, 'utf8');
  }
  await run(`${store}._populate().then(()=>{${store}.watch();return true})`);
  await until(async () => (await items()).length === fixture.length, 'local HTML template fixtures');
  await page.locator('nav button').filter({ hasText: '项目跟进' }).click();
  await until(() => run('document.querySelector("#template-title")?.value==="项目跟进"'), 'selected fixture template');
  await scrollTop();
  await shot('template-desktop');

  await nativeWidth(740);
  await scrollTop();
  await shot('template-narrow');
  if (before) {
    const list = await run(`(()=>{
      const nav = document.querySelector('.pr-template-layout nav');
      return { clientWidth:nav.clientWidth, scrollWidth:nav.scrollWidth };
    })()`);
    console.log('PASS template baseline', JSON.stringify(list));
    return;
  }
  const picker = page.getByRole('combobox', { name: '当前模板' });
  const newTemplate = page.getByRole('button', { name: '新建模板' });
  const title = page.getByRole('textbox', { name: '模板名称' });
  const subject = page.getByRole('textbox', { name: '邮件主题' });
  const body = page.locator('.pr-template-detail [contenteditable=true]');
  const active = (id) => run(`document.activeElement.id===${JSON.stringify(id)}`);
  assert.equal(await picker.locator('option').count(), fixture.length);
  assert.equal(await picker.inputValue(), '项目跟进.html');
  assert.equal(await page.locator('nav').isVisible(), false);
  assert.equal(await run(`(() => {
    const page=document.querySelector('.pr-templates');
    const body=page.querySelector('[contenteditable=true]').getBoundingClientRect();
    return page.scrollWidth<=page.clientWidth+1 && body.top<innerHeight-50;
  })()`), true);
  await newTemplate.focus();
  await main.keyboard.press('Tab');
  assert(await active('pr-template-selection'));
  await picker.selectOption('会后纪要.html');
  assert.equal(await title.inputValue(), '会后纪要');
  assert(await active('pr-template-selection'));
  await picker.selectOption('项目跟进.html');
  assert.equal(await title.inputValue(), '项目跟进');

  await newTemplate.focus();
  await run(`${store}.unwatch();true`);
  const importedFile = '从文件夹导入.html';
  fs.writeFileSync(path.join(directory, importedFile), '<div>导入的常用回信。</div>');
  const finishScanBeforeCreate = await holdDirectoryScan();
  // Keep the delayed scan as the only watcher notification for the imported file.
  await run(`window.prTemplateWatch=${store}.watch;${store}.watch=()=>{};true`);
  try {
    await main.keyboard.press('Enter');
    await until(() => run(`(() => {
      const title=document.getElementById('template-title');
      return title?.value==='新模板' && document.activeElement===title;
    })()`), 'create focuses the name');
    await finishScanBeforeCreate();
    await until(async () => (await items()).some((item) => item.id === importedFile), 'an import is visible even when its scan overlaps creation');
    assert.equal(await picker.inputValue(), '新模板.html', 'create selection survives a directory scan started before the write');
    assert(await active('template-title'));
  } finally {
    await run(`${store}.watch=window.prTemplateWatch;${store}.watch();true`);
  }
  assert(await run(`(() => {
    const title=document.activeElement;
    return title.selectionStart===0 && title.selectionEnd===title.value.length;
  })()`));
  await title.fill('只改到一半');
  await main.keyboard.press('Escape');
  assert.equal(await title.inputValue(), '新模板');
  assert(await active('template-title'));
  const finishScanBeforeRename = await holdDirectoryScan();
  await title.fill('版本跟进');
  await main.keyboard.press('Tab');
  await finishScanBeforeRename();
  assert(await active('template-subject'), 'Tab after rename preserves subject focus across a stale directory scan');
  assert.equal(await picker.inputValue(), '版本跟进.html');
  assert.equal(fs.existsSync(path.join(directory, '新模板.html')), false);
  await subject.fill('新的版本安排');
  await body.click();
  await main.keyboard.insertText('请确认本周的新版本安排。');
  await until(async () => (await body.innerText()).includes('请确认本周的新版本安排'), 'template editor renders typed content');
  await subject.click();
  const templatePath = path.join(directory, '版本跟进.html');
  await until(async () => fs.readFileSync(templatePath, 'utf8').includes('请确认本周的新版本安排'), 'leaving body writes template HTML');
  const saved = fs.readFileSync(templatePath, 'utf8');
  assert(saved.includes('新的版本安排'));
  assert(saved.includes('请确认本周的新版本安排'));
  await title.focus();
  await title.fill('版本安排回信');
  await main.keyboard.press('Enter');
  assert(await active('template-subject'));
  const renamedPath = path.join(directory, '版本安排回信.html');
  assert.equal(fs.readFileSync(renamedPath, 'utf8'), saved);
  assert.equal(fs.existsSync(templatePath), false);
  await scrollTop();
  await shot('template-narrow-edited');

  await newTemplate.click();
  await until(() => run('document.activeElement.id==="template-title" && document.activeElement.value==="新模板"'), 'create disposable template');
  await run(`window.prTemplateErrorOriginal=AppEnv.showErrorDialog;window.prTemplateError=null;
    AppEnv.showErrorDialog=(options)=>{window.prTemplateError=options;return 0};true`);
  try {
    await title.fill('版本安排回信');
    await subject.focus();
    assert.equal(await title.inputValue(), '新模板');
    assert.match(await run('window.prTemplateError.message'), /同名/);
    assert.equal(fs.readFileSync(renamedPath, 'utf8'), saved);
  } finally {
    await run('AppEnv.showErrorDialog=window.prTemplateErrorOriginal;true');
  }

  await run(`(() => {
    const {dialog,getCurrentWindow}=require('@electron/remote');
    window.prTemplateDialogOriginal=dialog.showMessageBoxSync;
    window.prTemplateWarnings=[];
    dialog.showMessageBoxSync=(parent, options)=>{
      window.prTemplateWarnings.push({options:options||parent,parentBound:!!options && parent.id===getCurrentWindow().id});
      return window.prTemplateDialogChoice || 0;
    };
    return true;
  })()`);
  try {
    const remove = page.getByRole('button', { name: '删除模板…' });
    await remove.focus();
    await main.keyboard.press('Enter');
    const warning = await run('window.prTemplateWarnings.at(-1)');
    assert(warning.parentBound);
    assert.equal(warning.options.buttons[warning.options.defaultId], '取消');
    assert.equal(warning.options.defaultId, warning.options.cancelId);
    assert.equal(warning.options.message, '删除「新模板」？');
    assert.match(warning.options.detail, /草稿/);
    assert.equal(fs.existsSync(path.join(directory, '新模板.html')), true);
    assert(await run('document.activeElement.matches(".pr-template-delete")'));
    await run('window.prTemplateDialogChoice=1');
    await main.keyboard.press('Enter');
    await until(async () => (await items()).every((item) => item.name !== '新模板'), 'deleted template removed from the list');
    assert.equal(fs.existsSync(path.join(directory, '新模板.html')), false);
    assert(await active('pr-template-selection'));
    await shot('template-narrow-delete-focus');

    const firstPath = path.join(directory, '项目.html');
    const secondPath = path.join(directory, '项目.htm');
    const spacedPath = path.join(directory, ' 已存模板.html');
    const firstContents = '<meta name="subject" content="第一份"/>\n<div>第一份模板。</div>';
    const secondContents = '<meta name="subject" content="第二份"/>\n<div>第二份模板。</div>';
    await run(`${store}.unwatch();true`);
    fs.writeFileSync(firstPath, firstContents);
    fs.writeFileSync(secondPath, secondContents);
    fs.writeFileSync(spacedPath, '<div>名称前有空格。</div>');
    await run(`${store}._populate().then(()=>{${store}.watch();return true})`);

    await picker.selectOption(' 已存模板.html');
    await title.focus();
    await main.keyboard.press('Tab');
    assert(await active('template-subject'));
    assert.equal(await picker.inputValue(), ' 已存模板.html');
    assert.equal(await title.inputValue(), ' 已存模板');
    assert.equal(fs.readFileSync(spacedPath, 'utf8'), '<div>名称前有空格。</div>');

    assert.equal(await picker.locator('option[value="项目.html"]').textContent(), '项目.html');
    assert.equal(await picker.locator('option[value="项目.htm"]').textContent(), '项目.htm');
    await picker.selectOption('项目.htm');
    assert.equal(await subject.inputValue(), '第二份');
    await run(`${store}._populate().then(()=>true)`);
    assert.equal(await picker.inputValue(), '项目.htm');
    assert.equal(await subject.inputValue(), '第二份');

    await remove.focus();
    await main.keyboard.press('Enter');
    const duplicateWarning = await run('window.prTemplateWarnings.at(-1)');
    assert.equal(duplicateWarning.options.message, '删除「项目.htm」？');
    await until(async () => (await items()).every((item) => item.id !== '项目.htm'), 'delete the selected file');
    assert.equal(fs.existsSync(secondPath), false);
    assert.equal(fs.readFileSync(firstPath, 'utf8'), firstContents);
    assert(await active('pr-template-selection'));

    await run(`${store}.unwatch();true`);
    fs.writeFileSync(secondPath, secondContents);
    await run(`${store}._populate().then(()=>{${store}.watch();return true})`);
    await picker.selectOption('项目.htm');
    await title.fill('项目副本');
    await main.keyboard.press('Tab');
    assert(await active('template-subject'));
    assert.equal(await picker.inputValue(), '项目副本.html');
    assert.equal(fs.existsSync(secondPath), false);
    assert.equal(fs.readFileSync(firstPath, 'utf8'), firstContents);
    assert.equal(fs.readFileSync(path.join(directory, '项目副本.html'), 'utf8'), secondContents);

    await nativeWidth(1440);
    await remove.focus();
    await main.keyboard.press('Enter');
    await until(() => run('document.activeElement.matches(".pr-template-list nav button[aria-current]")'), 'desktop delete restores focus to the selected template');
    assert.equal(fs.existsSync(path.join(directory, '项目副本.html')), false);

    await run('window.prTemplateDialogChoice=0');
    await action('.pr-settings-back');
    await until(() => run('!!document.querySelector(".btn-templates")'), 'composer restored');
    await action('.btn-templates');
    await main.locator('.template-picker .template').filter({ hasText: '版本安排回信' }).click();
    await until(() => run(`[...document.querySelectorAll('.pr-editor [contenteditable=true]')].some(editor=>
      editor.textContent.includes('请确认本周的新版本安排')
    )`), 'saved template applied to a real draft');
    await run(`require('mailspring-exports').DraftStore.sessionForClientId(${JSON.stringify(draft.draftId)}).then(s=>s.changes.commit()).then(()=>true)`);
    const applied = await cli('draft-get', { accountId: account.id, draftId: draft.draftId });
    assert.equal(applied.subject, '新的版本安排');
    assert(applied.body.includes('请确认本周的新版本安排'));
    await shot('template-in-draft');

    await main.getByRole('button', { name: '设置', exact: true }).click();
    await action('[data-settings-tab="Templates"]');
    await page.waitFor();
    await run(`${store}.unwatch();true`);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, entry.name);
      if (entry.isFile() && file !== renamedPath) fs.unlinkSync(file);
    }
    await run(`${store}._populate().then(()=>{${store}.watch();return true})`);
    assert.equal((await items()).length, 1);
    assert.equal(await title.inputValue(), '版本安排回信');
    const finishScanBeforeDelete = await holdDirectoryScan();
    await run('window.prTemplateDialogChoice=1');
    await remove.focus();
    await main.keyboard.press('Enter');
    await until(async () => (await items()).length === 0, 'last template deleted');
    await finishScanBeforeDelete();
    assert.equal((await items()).length, 0, 'a stale scan cannot restore a deleted template');
    assert.equal(await page.locator('.pr-template-detail').count(), 0);
    assert(await run('document.activeElement.matches(".pr-template-add")'));
    assert.equal(fs.existsSync(renamedPath), false);
  } finally {
    await run("require('@electron/remote').dialog.showMessageBoxSync=window.prTemplateDialogOriginal;true");
  }

  const result = {
    emptyHasOnePrimaryAction: true,
    narrowNativeSelector: true,
    allTemplatesReachableAt740: true,
    keyboardNewFocusAndSelection: true,
    staleScanPreservesNewTemplate: true,
    importVisibleAfterOverlappingCreate: true,
    keyboardRenameContinuesEditing: true,
    staleScanPreservesRenamedTemplate: true,
    templateSubjectAndBodyPersistAfterRename: true,
    duplicateNameProtected: true,
    duplicateFilesStayDistinctAfterRefreshRenameAndDelete: true,
    unchangedNamePreservedOnBlur: true,
    deletionDefaultsToCancelAndRestoresFocus: true,
    desktopDeletionRestoresFocus: true,
    staleScanDoesNotRestoreDeletedTemplate: true,
    templateAppliedToDraft: true,
    expectedSMTPSubmissions: 0,
  };
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('PASS template settings', JSON.stringify(result));
};
