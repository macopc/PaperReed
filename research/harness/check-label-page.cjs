const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

module.exports = async ({main, cdp, evaluate, until, account, cli}) => {
  const phase = process.env.PAPER_REED_LABEL_PAGE_CHECK;
  const before = phase === 'before';
  const out = process.env.PAPER_REED_UI_OUTPUT;
  fs.mkdirSync(out, {recursive: true});
  const run = script => evaluate(cdp, script);
  const labels = () => cli('labels', {});
  const capture = async (name, width = 900, height = 640) => {
    await cdp.send('Emulation.setDeviceMetricsOverride', {width, height, deviceScaleFactor: 1, mobile: false});
    await run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
    const shot = await cdp.send('Page.captureScreenshot', {format: 'png', fromSurface: true});
    fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(shot.data, 'base64'));
  };
  const manager = main.locator('.pr-label-manager');
  const trigger = main.locator('.pr-local-label-heading button');
  const rows = main.locator('.pr-mail-row');
  const name = manager.getByLabel('标签名称', {exact: true});
  const close = manager.getByLabel('关闭标签管理');
  const title = manager.getByRole('heading', {name: '标签与分类', exact: true});
  const isFocused = selector => run(`document.activeElement.matches(${JSON.stringify(selector)})`);
  const edit = id => manager.locator(`[data-edit-label-id="${id}"]`);
  const submit = manager.locator('button[type=submit]');
  const palette = main.locator('.pr-command-trigger');
  const rules = manager.getByRole('button', {name: /自动分类规则/});
  const settings = main.locator('.pr-rules');
  const leaveNotice = manager.getByRole('alert').getByText('请先保存或放弃这次修改。');
  const discard = manager.getByRole('button', {name: '放弃修改', exact: true});
  const twoFrames = () => run('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  await until(async () => (await rows.count()) === 8, 'eight inbox conversations');
  const threadId = await rows.first().getAttribute('data-thread-id');
  const target = {accountId: account.id, threadId};
  const fixtures = [
    ['项目跟进', '#688177'],
    ['设计合作', '#957789'],
    ['差旅与报销', '#b39168'],
    ['稍后查阅', '#698da2'],
  ];
  for (const [name, color] of fixtures) await cli('label-create', {name, color});
  const project = (await labels()).find(label => label.name === '项目跟进');
  assert(project);
  await cli('label-add', {targets: [target], labelId: project.id});
  await until(async () => !!await main.locator(`[data-label-id="${project.id}"]`).count(), 'labels in sidebar');
  if (before) {
    await trigger.click();
    await manager.getByLabel('编辑标签', {exact: true}).selectOption(project.id);
    await capture('labels-desktop', 1440, 760);
    await capture('labels-narrow', 740, 680);
    assert.equal(await rows.count(), 0, 'label management has its own view');
    return;
  }
  await trigger.press('Enter');
  await title.waitFor();
  assert(await isFocused('#pr-organization-title'), 'opening lands on the management heading');
  assert.equal(await rows.count(), 0, 'label management has its own view');
  assert.equal(await main.locator('.pr-sidebar [aria-current=page]').count(), 0);
  await edit(project.id).press('Enter');
  assert(await isFocused('.pr-label-manager input[aria-label="标签名称"]'));
  assert.equal(await name.inputValue(), project.name);
  await capture('labels-desktop', 1440, 760);
  await capture('labels-narrow', 740, 680);
  assert(await run(`(() => {
    const e = document.querySelector('.pr-label-manager');
    return e.scrollWidth <= e.clientWidth + 1 && e.getBoundingClientRect().right <= innerWidth;
  })()`), '740px management pane fits without horizontal scrolling');

  await run(`(() => {
    const drafts = require('mailspring-exports').DraftStore;
    const persist = drafts._finalizeAndPersistNewMessage;
    window.labelNavigationFixture = {started: 0, release: null};
    drafts._finalizeAndPersistNewMessage = async function (...args) {
      const reject = await new Promise(resolve => {
        labelNavigationFixture.release = resolve;
        labelNavigationFixture.started++;
      });
      if (reject) throw new Error('fixture draft save failure');
      drafts._finalizeAndPersistNewMessage = persist;
      return persist.apply(this, args);
    };
  })()`);
  const composer = main.locator('.pr-editor .pr-composer');
  const startCompose = async (count) => {
    await main.locator('.pr-compose-button').click();
    await until(() => run(`labelNavigationFixture.started === ${count}`), 'draft persistence is held');
  };
  const readOnlyName = () => run('document.querySelector(".pr-label-manager input[aria-label=标签名称]")?.readOnly');
  await startCompose(1);
  await name.press('End');
  await main.keyboard.insertText('（切换中）');
  const nameDuringTransition = await name.inputValue();
  if (phase === 'navigation-control') {
    await run('labelNavigationFixture.release(false)');
    await composer.waitFor();
    assert.equal(nameDuringTransition, project.name,
      'label input cannot change before a pending Compose transition removes it');
    return;
  }
  assert.equal(nameDuringTransition, project.name, 'label input is locked while opening Compose');
  assert.equal(await readOnlyName(), true);
  assert.equal(await manager.getByLabel('标签颜色', {exact: true}).isDisabled(), true);
  assert.equal(await submit.getAttribute('aria-disabled'), 'true');
  await submit.press('Enter');
  assert.deepEqual((await labels()).find(label => label.id === project.id), project);
  await manager.getByRole('status').getByText('正在切换页面…').waitFor();
  await capture('labels-opening-compose');
  await run('labelNavigationFixture.release(true)');
  await manager.getByRole('alert').getByText('操作未完成，请重试。').waitFor();
  await until(async () => (await readOnlyName()) === false, 'failed transition unlocks the label editor');
  await name.fill('仍可编辑');
  assert.equal(await name.inputValue(), '仍可编辑');
  await discard.press('Enter');
  assert.equal(await name.inputValue(), project.name);
  await startCompose(2);
  assert.equal(await readOnlyName(), true);
  await run('labelNavigationFixture.release(false)');
  await composer.waitFor();
  assert.equal(await manager.count(), 0);
  await trigger.press('Enter');
  await title.waitFor();
  await edit(project.id).press('Enter');
  assert.equal(await name.inputValue(), project.name);

  if (phase !== 'focus-control') {
    await name.fill('未保存的项目标签');
    await rules.press('Enter');
    await until(async () => await leaveNotice.count() || await settings.count(), 'rules navigation resolves');
    assert.equal(await settings.count(), 0, 'opening Rules keeps the unsaved label on screen');
    assert.equal(await name.inputValue(), '未保存的项目标签');
    assert.deepEqual((await labels()).find(label => label.id === project.id), project);
    await close.press('Enter');
    assert.equal(await name.inputValue(), '未保存的项目标签', 'closing the manager also guards unsaved edits');
    await main.locator('[data-mailbox=sent]').click();
    await leaveNotice.waitFor();
    await twoFrames();
    assert(await isFocused('.pr-label-edit [role=alert]'), 'guard moves keyboard focus to the guidance');
    await capture('labels-unsaved');
    await discard.press('Enter');
    assert.equal(await name.inputValue(), project.name, 'discard restores the persisted name');
    assert.equal(await leaveNotice.count(), 0);
  }

  await manager.getByRole('button', {name: /新建标签/}).press('Space');
  assert.equal(await name.inputValue(), '');
  await name.fill('设计合作');
  await submit.press('Enter');
  await manager.getByRole('alert').getByText('已有同名标签，请换一个名称。').waitFor();
  assert.equal(await name.inputValue(), '设计合作');
  await name.fill('客户反馈');
  await submit.press('Enter');
  await manager.getByRole('status').getByText('已创建标签。').waitFor();
  const created = (await labels()).find(label => label.name === '客户反馈');
  assert(created);
  assert.equal(await edit(created.id).getAttribute('aria-pressed'), 'true');

  await edit(project.id).press('Enter');
  await name.fill('项目协调');
  await cli('label-update', {id: project.id, color: '#5b8792'});
  await submit.press('Enter');
  await manager.getByRole('status').getByText('已保存标签。').waitFor();
  assert.deepEqual((await labels()).find(label => label.id === project.id),
    {...project, name: '项目协调', color: '#5b8792'}, 'saving a name keeps a concurrent CLI color change');
  const deleteLabel = manager.getByRole('button', {name: '删除标签', exact: true});
  await deleteLabel.press('Enter');
  const confirmation = manager.getByRole('group', {name: '确认删除标签'});
  await confirmation.waitFor();
  assert.equal(await manager.getByText('已保存标签。', {exact: true}).count(), 0,
    'delete confirmation clears the previous save feedback');
  assert.match(await confirmation.textContent(), /邮件会保留，使用此标签的规则将暂停/);
  const cancel = confirmation.getByRole('button', {name: '取消', exact: true});
  assert(await isFocused('.pr-label-confirm button:first-child'), 'destructive confirmation focuses Cancel');
  await capture('labels-confirm');
  await cancel.press('Escape');
  assert(await isFocused('.pr-delete-label'));
  assert((await labels()).some(label => label.id === project.id));

  await edit(created.id).press('Enter');
  await deleteLabel.press('Enter');
  await confirmation.waitFor();
  assert(await isFocused('.pr-label-confirm button:first-child'));
  await cli('label-delete', {id: created.id});
  await manager.getByRole('alert').getByText('这个标签已被删除，请重新选择。').waitFor();
  assert.equal(await submit.getAttribute('aria-disabled'), 'true');
  await twoFrames();
  assert(await isFocused('.pr-label-collection-head button'),
    'external deletion transfers focus from the vanished confirmation to New Label');
  assert.equal(await confirmation.count(), 0);
  await edit(project.id).press('Enter');
  await close.press('Enter');
  await until(async () => await manager.count() === 0, 'label management closes');
  assert(await isFocused('.pr-local-label-heading button'), 'closing restores the management trigger');
  await main.locator(`[data-label-id="${project.id}"]`).click();
  await until(async () => (await rows.count()) === 1 &&
    (await rows.first().getAttribute('data-thread-id')) === threadId, 'label still marks its original conversation');

  await run(`(() => {
    const api = require(AppEnv.getLoadSettings().resourcePath + '/src/services/mail-core/local-triage');
    const original = api.localLabels;
    window.labelFixture = {fail: true, release: null};
    const gate = new Promise(resolve => { labelFixture.release = resolve; });
    api.localLabels = async (...args) => {
      if (document.querySelector('.pr-label-manager') && labelFixture.fail) {
        await gate;
        throw new Error('fixture label read failure');
      }
      return original(...args);
    };
  })()`);
  await trigger.press('Enter');
  await manager.getByText('正在读取标签…', {exact: true}).waitFor();
  assert.equal(await manager.getByText('还没有自定义标签。', {exact: true}).count(), 0);
  await capture('labels-loading');
  await run('labelFixture.release()');
  await manager.getByRole('alert').getByText('标签暂时无法读取。').waitFor();
  await capture('labels-error');
  await run('labelFixture.fail = false');
  await manager.getByRole('button', {name: '重新读取'}).press('Enter');
  await edit(project.id).waitFor();
  await until(() => isFocused('#pr-organization-title'), 'retry restores focus');
  await edit(project.id).press('Enter');
  await name.fill('已保存后进入规则');
  await rules.press('Enter');
  await leaveNotice.waitFor();
  await submit.press('Enter');
  await manager.getByRole('status').getByText('已保存标签。').waitFor();
  await until(async () => (await submit.getAttribute('aria-disabled')) === 'false', 'label save settles');
  await rules.press('Enter');
  await settings.waitFor();
  await capture('labels-rules');
  await main.locator('.pr-preferences-nav button').filter({hasText: '返回邮件'}).click();
  await title.waitFor();
  await edit(project.id).press('Enter');
  assert.equal(await name.inputValue(), '已保存后进入规则');
  await deleteLabel.press('Enter');
  await confirmation.getByRole('button', {name: '确认删除'}).press('Enter');
  await manager.getByRole('status').getByText('已删除标签。').waitFor();
  assert(!(await labels()).some(label => label.id === project.id));
  assert(await isFocused('.pr-label-manager input[aria-label="标签名称"]'));
  await close.press('Enter');
  await main.getByRole('status').getByText('该标签已删除，原有邮件仍保留。').waitFor();
  await main.getByRole('button', {name: '返回收件箱', exact: true}).waitFor();
  await trigger.press('Enter');
  await title.waitFor();
  await palette.click();
  await main.getByRole('textbox', {name: '查找命令'}).fill('前往收件箱');
  await main.getByRole('textbox', {name: '查找命令'}).press('Enter');
  await until(async () => (await rows.count()) === 8, 'command navigation leaves management for the inbox');
  assert.equal(await manager.count(), 0);
  assert((await rows.first().count()) === 1, 'the inbox and its messages survive deleting a label');
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify({
    checks: {dedicatedView: true, desktopAndNarrow: true, keyboard: true, duplicate: true,
      concurrentFields: true, staleLabel: true, deleteConfirmation: true, readRetry: true,
      rulesRoundTrip: true, labelMembership: true, removedLabelMailbox: true, commandNavigation: true,
      unsavedNavigationGuard: true, saveThenRules: true, externalDeletionFocus: true,
      confirmationClearsOldFeedback: true, asyncComposeLock: true, failedComposeUnlocks: true},
  }, null, 2) + '\n');
  console.log('PASS label management, scoped edits, Rules return and keyboard navigation');
};
