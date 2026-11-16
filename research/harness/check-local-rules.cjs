const fs = require('node:fs'),
  path = require('node:path'),
  assert = require('node:assert/strict'),
  { execFileSync } = require('node:child_process');
module.exports = async ({
  main,
  cdp,
  account,
  cli,
  work,
  evaluate,
  until,
  restartDesktop,
}) => {
  const out = path.resolve(__dirname, '../rules-validation-2026-11-16');
  fs.mkdirSync(out, { recursive: true });
  const run = (s) => evaluate(cdp, s),
    click = (s) => main.locator(s).first().click(),
    mod =
      "require(AppEnv.getLoadSettings().resourcePath+'/src/services/mail-core/local-triage')";
  const shot = async (name) => {
    await run(
      'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'
    );
    const x = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    });
    fs.writeFileSync(
      path.join(out, name + '.png'),
      Buffer.from(x.data, 'base64')
    );
  };
  const rules = () => cli('rules', { accountId: account.id }),
    ref = (id) => ({ accountId: account.id, threadId: id }),
    state = async (id) =>
      (await cli('local-state', { targets: [ref(id)] }))[id];
  const threads = await cli('search', {
      accountId: account.id,
      query: 'in:inbox',
    }),
    target = threads.find((t) => t.subject.includes('Design review'));
  assert(target);
  const original = await run(
    `require('mailspring-exports').DatabaseStore._query('SELECT id,data FROM Message WHERE draft=0 ORDER BY id')`
  );
  const label = await cli('label-create', {
    name: '设计协作',
    color: '#957789',
  });
  await main
    .locator('.pr-sidebar button')
    .filter({ hasText: '设置' })
    .click();
  await click('[data-settings-tab="Mail Rules"]');
  await until(
    () => run('!!document.querySelector(".pr-local-rule-editor")'),
    'local rules editor'
  );
  await main.locator('#pr-local-rule-name').fill('评审归为通知');
  await main.getByLabel('匹配关键词', { exact: true }).fill('review');
  await main.locator('.pr-local-rule-editor button[type=submit]').click();
  await until(
    async () => (await rules()).rules.length === 1,
    'saved paused'
  );
  let first = (await rules()).rules[0];
  assert.equal(first.enabled, false);
  assert.equal((await state(target.id)).category, 'ordinary');
  await main.locator('.pr-rule-enabled input').check();
  await main.locator('.pr-local-rule-editor button[type=submit]').click();
  await until(
    async () => (await rules()).rules[0].enabled,
    'enabled rule'
  );
  assert.equal(
    (await state(target.id)).category,
    'ordinary',
    'enable must not replay cached mail'
  );
  const second = await cli('rule-save', {
    accountId: account.id,
    name: '添加协作标签',
    field: 'subject',
    query: 'REVIEW',
    action: 'label',
    value: label.id,
    enabled: true,
  });
  const third = await cli('rule-save', {
    accountId: account.id,
    name: '订阅优先',
    field: 'sender',
    query: 'sender0@',
    action: 'category',
    value: 'subscriptions',
    enabled: true,
  });
  const labelB = await cli('label-create', {
    name: '待复核',
    color: '#688177',
  });
  const extra = await cli('rule-save', {
    accountId: account.id,
    name: '另一标签',
    field: 'subject',
    query: 'review',
    action: 'label',
    value: labelB.id,
    enabled: true,
  });
  const multi = await cli('rules-preview', {
    accountId: account.id,
    targets: [ref(target.id)],
  });
  assert.deepEqual(
    new Set(multi.items[0].labelIds),
    new Set([label.id, labelB.id])
  );
  await cli('rule-delete', { accountId: account.id, id: extra.id });
  await cli('label-delete', { id: labelB.id });
  const snap = await cli('rules-preview', {
    accountId: account.id,
    targets: [ref(target.id)],
  });
  assert.equal(snap.items[0].category, 'subscriptions');
  assert.deepEqual(snap.items[0].labelIds, [label.id]);
  assert.equal((await state(target.id)).category, 'ordinary');
  await until(
    () => run('document.querySelectorAll("[data-local-rule]").length===3'),
    'CLI rules reflected'
  );
  await main.locator('#pr-rule-search').fill('subject:review');
  await main.locator('.pr-local-rule-preview form button').click();
  await until(
    () =>
      run(
        'document.querySelectorAll(".pr-rule-preview-list label").length>0'
      ),
    'preview list'
  );
  await main.locator('.pr-local-rule-preview').scrollIntoViewIfNeeded();
  await shot('preview');
  await main
    .locator('.pr-rule-preview-list input:not(:disabled)')
    .first()
    .check();
  await main.locator('.pr-local-rule-preview > button').click();
  await until(
    async () => (await state(target.id)).category === 'subscriptions',
    'GUI applies preview'
  );
  assert((await state(target.id)).labels.some((l) => l.id === label.id));
  assert.deepEqual(
    await run(
      `require('mailspring-exports').DatabaseStore._query('SELECT id,data FROM Message WHERE draft=0 ORDER BY id')`
    ),
    original,
    'rules only change local tables'
  );
  // Reorder via UI and reject older preview revisions, without changing old results.
  await click(`[data-local-rule="${third.id}"]`);
  const selectedRule = (await rules()).rules.find(
    (r) => r.id === third.id
  );
  await cli('rule-save', { ...selectedRule, name: '订阅优先 · 已更新' });
  await until(
    async () =>
      (await main.locator('#pr-local-rule-name').inputValue()) ===
      '订阅优先 · 已更新',
    'CLI edits reflected in clean editor'
  );

  await main
    .locator('.pr-local-rule-editor footer button')
    .filter({ hasText: '上移' })
    .click();
  await until(
    async () => (await rules()).rules[1].id === third.id,
    'move once'
  );
  await main
    .locator('.pr-local-rule-editor footer button')
    .filter({ hasText: '上移' })
    .click();
  await until(
    async () => (await rules()).rules[0].id === third.id,
    'move twice'
  );
  const stale = await cli(
    'rules-apply',
    {
      accountId: account.id,
      revision: snap.revision,
      targets: [{ ...ref(target.id), messageId: snap.items[0].messageId }],
    },
    true
  );
  assert(JSON.stringify(stale).includes('rules-changed'));
  assert.equal(
    (await state(target.id)).category,
    'subscriptions',
    'reorder does not replay history'
  );
  let next = await cli('rules-preview', {
    accountId: account.id,
    targets: [ref(target.id)],
  });
  assert.equal(next.items[0].category, 'notifications');
  await main.getByLabel('匹配关键词', { exact: true }).fill('unsaved');
  await cli('rule-save', {
    ...(await rules()).rules.find((r) => r.id === third.id),
    name: '订阅优先 · 外部更新',
  });
  await until(
    () =>
      run(
        `document.querySelector('[data-local-rule="${third.id}"]')?.innerText.includes('外部更新')`
      ),
    'external rule update while dirty'
  );
  assert.equal(
    await main.getByLabel('匹配关键词', { exact: true }).inputValue(),
    'unsaved'
  );

  await click('[data-settings-tab=Appearance]');
  assert(await run('!!document.querySelector(".pr-local-rule-editor")'));
  await main
    .locator('.pr-local-rule-editor footer button')
    .filter({ hasText: '放弃修改' })
    .click();
  assert.equal(
    await main.locator('.pr-local-rule-notice').count(),
    0,
    'discard clears obsolete warning'
  );
  next = await cli('rules-preview', {
    accountId: account.id,
    targets: [ref(target.id)],
  });
  await shot('rules');
  await main
    .locator('.pr-preferences-nav button')
    .filter({ hasText: '返回邮件' })
    .click();
  await until(
    () => run('!!document.querySelector(".pr-mail-row")'),
    'mail workspace'
  );
  await main
    .locator('.pr-mail-item')
    .filter({ has: main.locator(`[data-thread-id="${target.id}"]`) })
    .locator('input')
    .check();
  await main.getByLabel('分类', { exact: true }).selectOption('people');
  await until(
    async () => (await state(target.id)).categoryManual,
    'manual classification'
  );
  await cli('rules-apply', {
    accountId: account.id,
    revision: next.revision,
    targets: [{ ...ref(target.id), messageId: next.items[0].messageId }],
  });
  assert.equal((await state(target.id)).category, 'people');
  await click('[data-category=people]');
  await until(
    () => run('document.querySelectorAll(".pr-mail-row").length===1'),
    'category view'
  );
  await shot('category');
  // Seed a legacy star rule: Paper Reed mode must not run the remote-action rules.
  await run(
    `require('mailspring-exports').Actions.addMailRule({accountId:${JSON.stringify(account.id)},name:'Legacy',disabled:false,conditionMode:'all',conditions:[{templateKey:'subject',comparatorKey:'contains',value:'Review'}],actions:[{templateKey:'star',value:true}]});true`
  );
  const source = await run(
    `require('mailspring-exports').DatabaseStore.findAll(require('mailspring-exports').Message).where({threadId:${JSON.stringify(target.id)},draft:false}).then(ms=>({subject:ms[0].subject,mid:ms[0].headerMessageId}))`
  );
  function append(sender, n) {
    execFileSync('/usr/bin/python3', [
      '-c',
      `
import json,sys,imaplib,email.utils
from email.message import EmailMessage
a=json.load(open(sys.argv[1]));d=json.loads(sys.argv[2]);m=EmailMessage();m['From']=sys.argv[3];m['To']='test@example.test';m['Subject']='Re: '+d['subject'];m['Message-ID']='<rule-'+sys.argv[4]+'@example.test>';m['In-Reply-To']='<'+d['mid'].strip('<>')+'>';m['References']=m['In-Reply-To'];m['Date']=email.utils.formatdate(localtime=False);m.set_content('Rule message '+sys.argv[4]);c=imaplib.IMAP4(a['settings']['imap_host'],a['settings']['imap_port']);c.login('test','pass');assert c.append('INBOX',None,None,m.as_bytes())[0]=='OK';c.logout()
`,
      path.join(work, 'account.json'),
      JSON.stringify(source),
      sender,
      n,
    ]);
  }
  await cli('label-remove', {
    targets: [ref(target.id)],
    labelId: label.id,
  });
  append('test@example.test', 'own');
  await until(
    () =>
      run(
        `require('mailspring-exports').DatabaseStore.findAll(require('mailspring-exports').Message).where({threadId:${JSON.stringify(target.id)},draft:false}).then(ms=>ms.length>=2)`
      ),
    'own reply sync'
  );
  await run(`${mod}.processLocalRules()`);
  assert(!(await state(target.id)).labels.length, 'own reply ignored');
  append('sender0@example.test', 'incoming');
  // Wait for the real interval / workspace refresh, without manually invoking the processor.
  await until(
    async () =>
      (await state(target.id)).labels.some((l) => l.id === label.id),
    'automatic incoming rule',
    40000
  );
  assert.equal(
    (await state(target.id)).category,
    'people',
    'manual override survives new mail'
  );
  assert(
    await run(
      `require('mailspring-exports').DatabaseStore.findAll(require('mailspring-exports').Message).where({threadId:${JSON.stringify(target.id)},draft:false}).then(ms=>ms.every(m=>!m.starred))`
    ),
    'legacy rule not executed'
  );
  await cli('classify-auto', { targets: [ref(target.id)] });
  assert.equal((await state(target.id)).category, 'notifications');
  assert.equal((await state(target.id)).categoryManual, false);
  // Once marked, repeat scans and full restart must not reapply removed labels.
  await cli('label-remove', {
    targets: [ref(target.id)],
    labelId: label.id,
  });
  await run(`${mod}.processLocalRules()`);
  assert(!(await state(target.id)).labels.length);
  ({ main, cdp } = await restartDesktop());
  await until(
    () => run('!!document.querySelector(".pr-mail-row")'),
    'restart'
  );
  assert.equal((await state(target.id)).category, 'notifications');
  assert(!(await state(target.id)).labels.length);
  assert.equal((await rules()).rules.length, 3);
  // Save paused then enable: previously processed messages remain untouched.
  const secondData = (await rules()).rules.find((r) => r.id === second.id);
  await cli('rule-save', { ...secondData, enabled: false });
  await cli('rule-save', { ...secondData, enabled: true });
  await run(`${mod}.processLocalRules()`);
  assert(!(await state(target.id)).labels.length);
  const beforeNew = await cli('rules-preview', {
    accountId: account.id,
    targets: [ref(target.id)],
  });
  append('sender0@example.test', 'newer');
  await until(
    async () => (await state(target.id)).labels.length > 0,
    'new message after reenable',
    40000
  );
  const changedMessage = await cli(
    'rules-apply',
    {
      accountId: account.id,
      revision: beforeNew.revision,
      targets: [
        { ...ref(target.id), messageId: beforeNew.items[0].messageId },
      ],
    },
    true
  );
  assert.equal(changedMessage.items[0].error, 'preview-stale');
  const preview = await cli(
    'rules-preview',
    {
      accountId: account.id,
      targets: [
        ref(target.id),
        { accountId: 'other', threadId: target.id },
      ],
    },
    true
  );
  assert.equal(preview.items[1].status, 'rejected');
  const fresh = await cli('rules-preview', {
    accountId: account.id,
    targets: [ref(target.id)],
  });
  const partial = await cli(
    'rules-apply',
    {
      accountId: account.id,
      revision: fresh.revision,
      targets: [
        { ...ref(target.id), messageId: fresh.items[0].messageId },
        { ...ref('missing'), messageId: 'missing' },
      ],
    },
    true
  );
  assert.equal(partial.items[0].status, 'succeeded');
  assert.equal(partial.items[1].status, 'rejected');
  await run("AppEnv.config.set('core.mcp.accessLevel','read-only');true");
  assert(
    JSON.stringify(
      await cli('rule-save', { ...first, enabled: true }, true)
    ).includes('Access denied')
  );
  await run("AppEnv.config.set('core.mcp.accessLevel','read-write');true");
  const folder = (await cli('folders', { accountId: account.id })).find(
    (f) => f.role === 'trash'
  );
  await run(
    `AppEnv.config.set('core.mcp.enabledAccounts',{[${JSON.stringify(account.id)}]:{enabled:true,excludedFolderIds:[${JSON.stringify(folder.id)}]}});true`
  );
  assert(
    JSON.stringify(
      await cli('rule-save', { ...first, enabled: true }, true)
    ).includes('all folders')
  );
  await run(
    `AppEnv.config.set('core.mcp.enabledAccounts',{[${JSON.stringify(account.id)}]:{enabled:true}});true`
  );
  await cli('label-delete', { id: label.id });
  assert.equal(
    (await rules()).rules.find((r) => r.id === second.id).enabled,
    false
  );
  await cli('rule-delete', { accountId: account.id, id: third.id });
  assert.equal(
    (await state(target.id)).category,
    'notifications',
    'deleting rules retains results'
  );
  await main
    .locator('.pr-sidebar button')
    .filter({ hasText: '设置' })
    .click();
  await click('[data-settings-tab="Mail Rules"]');
  await until(
    () => run('!!document.querySelector(".pr-local-rule-editor")'),
    'final settings'
  );
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 900,
    height: 700,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await shot('compact');
  assert(
    await run(
      'document.querySelector(".pr-settings-page").scrollWidth<=document.querySelector(".pr-settings-page").clientWidth+1'
    )
  );
  const result = {
    newRulePaused: true,
    cliUpdatesCleanEditor: true,
    cliPreservesDirtyEditor: true,
    unsavedNavigationGuard: true,
    enableDoesNotBackfill: true,
    caseInsensitiveMatch: true,
    orderedCategoryLastWins: true,
    labelAccumulation: true,
    previewReadOnly: true,
    explicitSelectedApply: true,
    manualCorrection: true,
    manualOverridesAutomatic: true,
    followRulesAgain: true,
    staleRulesRejected: true,
    staleMessageRejected: true,
    automaticIMAPIncoming: true,
    ownReplyIgnored: true,
    processedOnceAcrossRestart: true,
    reenableDoesNotReplay: true,
    legacyRemoteRulesPaused: true,
    deleteLabelPausesRule: true,
    deleteRuleKeepsResult: true,
    partialResults: true,
    accountIsolation: true,
    writePermission: true,
    ruleFolderScope: true,
    remoteStateUnchanged: true,
    compactLayout: true,
    expectedSMTPSubmissions: 0,
  };
  fs.writeFileSync(
    path.join(out, 'result.json'),
    JSON.stringify(result, null, 2) + '\n'
  );
  console.log('PASS local rules', JSON.stringify(result));
};
