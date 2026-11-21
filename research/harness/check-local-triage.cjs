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
  const out = process.env.PAPER_REED_UI_OUTPUT || path.resolve(__dirname, '../triage-validation-2026-11-16');
  fs.mkdirSync(out, { recursive: true });
  const run = (s) => evaluate(cdp, s),
    action = (s) => main.locator(s).first().click();
  const mod =
    "require(AppEnv.getLoadSettings().resourcePath+'/src/services/mail-core/local-triage')";
  const rows = () =>
    run(
      'Array.from(document.querySelectorAll(".pr-mail-row")).map(e=>e.dataset.threadId)'
    );
  const shot = async (name) => {
    await run(
      'new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))'
    );
    const s = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    });
    fs.writeFileSync(
      path.join(out, name + '.png'),
      Buffer.from(s.data, 'base64')
    );
  };
  const ids = await rows(),
    targets = (list) =>
      list.map((threadId) => ({ accountId: account.id, threadId })),
    ref = (id) => ({ targets: targets([id]) });
  const state = async (id) => (await cli('local-state', ref(id)))[id];
  const list = (opts) =>
    cli('local-list', { accountId: account.id, ...opts });
  const nativeSnapshot = () =>
    run(
      `require('mailspring-exports').DatabaseStore._query('SELECT id,unread,starred,data FROM Message WHERE draft=0 ORDER BY id')`
    );
  const original = await nativeSnapshot();
  await cli('pin', ref(ids[7]));
  await until(
    async () => (await rows())[0] === ids[7],
    'pinned order before pagination'
  );
  assert.equal((await list({ folder: 'inbox', limit: 1 }))[0].id, ids[7]);
  await action('[data-mailbox=pinned]');
  await until(async () => (await rows()).length === 1, 'pinned view');
  await main.locator('.pr-mail-item > input').first().check();
  await action('[data-local-action=unpin]');
  await until(async () => (await rows()).length === 0, 'GUI unpin');
  await cli('pin', ref(ids[7]));
  // Create / rename / recolor through actual UI. Application and removal via common CLI.
  await action('.pr-local-label-heading button');
  await main.getByLabel('标签名称', { exact: true }).fill('项目跟进');
  await main.locator('.pr-label-manager button[type=submit]').click();
  let label = (await cli('labels', {})).find((l) => l.name === '项目跟进');
  assert(label);
  await cli('label-add', { ...ref(ids[7]), labelId: label.id });
  await cli('label-add', { ...ref(ids[0]), labelId: label.id });
  await main.locator(`[data-edit-label-id="${label.id}"]`).click();
  await main.getByLabel('标签名称', { exact: true }).fill('设计合作');
  await main.getByLabel('标签颜色', { exact: true }).fill('#957789');
  await main.locator('.pr-label-manager button[type=submit]').click();
  await until(
    async () =>
      (await cli('labels', {})).some(
        (l) =>
          l.id === label.id &&
          l.name === '设计合作' &&
          l.color === '#957789'
      ),
    'label edit'
  );
  await shot('labels');
  await main.getByLabel('关闭标签管理').click();
  await action(`[data-label-id="${label.id}"]`);
  await until(async () => (await rows()).length === 2, 'label filter');
  assert.deepEqual(
    new Set((await list({ view: 'label:' + label.id })).map((t) => t.id)),
    new Set([ids[0], ids[7]])
  );
  await shot('label-view');
  const duplicate = await cli(
    'label-create',
    { name: '  设计合作  ', color: '#688177' },
    true
  );
  assert(JSON.stringify(duplicate).includes('duplicate-label-name'));
  const injection = await list({ view: "label:x' OR 1=1 --" });
  assert.equal(injection.length, 0);
  await action('[data-mailbox=inbox]');
  await until(async () => (await rows()).length === 8, 'all inbox');
  await main
    .locator('.pr-mail-item')
    .filter({ has: main.locator(`[data-thread-id="${ids[0]}"]`) })
    .locator('input')
    .check();
  await action('[data-local-panel=labels]');
  await shot('label-picker');
  await main.locator('.pr-label-picker input').click();
  await until(
    async () => !(await state(ids[0])).labels.length,
    'GUI remove label'
  );
  await action('[data-local-panel=snooze]');
  await shot('snooze-picker');
  await main
    .locator('.pr-snooze-presets button')
    .filter({ hasText: '明天' })
    .click();
  await until(
    async () => !(await rows()).includes(ids[0]),
    'snoozed hidden'
  );
  assert((await state(ids[0])).snoozeUntil > Date.now());
  assert(!(await list({ folder: 'inbox' })).some((t) => t.id === ids[0]));
  assert(
    (
      await cli('search', { accountId: account.id, query: 'in:inbox' })
    ).some((t) => t.id === ids[0]),
    'ordinary search can still find snoozed mail'
  );
  await action('[data-mailbox=snoozed]');
  await until(async () => (await rows()).length === 1, 'snoozed view');
  await shot('snoozed');
  assert.deepEqual(
    await nativeSnapshot(),
    original,
    'pin, snooze, labels must not alter provider mail'
  );
  // Full desktop restart: persisted local state and IDs survive a new renderer and engine.
  await cli('snooze', {
    ...ref(ids[5]),
    until: new Date(Date.now() + 3000).toISOString(),
  });
  ({ main, cdp } = await restartDesktop(3500));
  await until(
    () => run('document.querySelectorAll(".pr-mail-row").length===7'),
    'restart restores hidden inbox'
  );
  assert(
    !(await state(ids[5])).snoozeUntil,
    'expired while closed clears on startup'
  );
  assert((await state(ids[7])).pinned);
  assert.equal((await state(ids[7])).labels[0].name, '设计合作');
  assert((await state(ids[0])).snoozeUntil > Date.now());
  await cli('unsnooze', ref(ids[0]));
  await until(
    async () => (await rows()).includes(ids[0]),
    'cancel snooze'
  );
  await cli('snooze', {
    ...ref(ids[0]),
    until: new Date(Date.now() + 4000).toISOString(),
  });
  await until(
    async () => !(await rows()).includes(ids[0]),
    'short snooze hidden'
  );
  await until(
    async () =>
      (await list({ folder: 'inbox' })).some((t) => t.id === ids[0]),
    'due restores locally'
  );
  // Mixed label memberships and keyboard dismissal retain the selection.
  await action('[data-mailbox=inbox]');
  await until(
    async () => (await rows()).length === 8,
    'inbox after expiry'
  );
  for (const id of [ids[0], ids[7]])
    await main
      .locator('.pr-mail-item')
      .filter({ has: main.locator(`[data-thread-id="${id}"]`) })
      .locator('input')
      .check();
  await action('[data-local-panel=labels]');
  assert(
    await run(
      'document.querySelector(".pr-label-picker input").indeterminate'
    )
  );
  await main.locator('.pr-label-picker input').click();
  await until(
    async () =>
      (await state(ids[0])).labels.some((l) => l.id === label.id),
    'mixed selection adds label'
  );
  await action('[data-local-panel=labels]');
  await main.locator('[data-local-panel=labels]').press('Escape');
  assert.equal(
    await run('document.querySelectorAll(".pr-label-picker").length'),
    0
  );
  assert.equal(
    await run(
      'document.querySelectorAll(".pr-mail-item.selected").length'
    ),
    2
  );
  await action('[data-mailbox=inbox]');
  // Reader supports the same local controls even after the row leaves Inbox.
  await main.locator(`[data-thread-id="${ids[4]}"]`).click();
  await action('[data-local-panel=snooze]');
  await main.locator('.pr-snooze-presets button').first().click();
  await until(
    () => run('!!document.querySelector("[data-local-action=unsnooze]")'),
    'reader snooze state retained'
  );
  await shot('reader');
  await action('[data-local-action=unsnooze]');
  await action('.pr-back');
  // Local-view handoff uses local-list, not the provider's labels or Snoozed folder.
  await run(
    `require(AppEnv.getLoadSettings().resourcePath+'/internal_packages/mcp-server/lib/paper-reed-cli').installCLI().then(()=>true)`
  );
  await action(`[data-label-id="${label.id}"]`);
  await until(
    async () => (await rows()).length === 2,
    'label view for handoff'
  );
  await run(
    `window.prClipboard=require('@electron/remote').clipboard.writeText;window.prTask='';require('@electron/remote').clipboard.writeText=t=>window.prTask=t;true`
  );
  try {
    await action('.pr-agent-button');
    await main
      .locator('.pr-agent-panel button')
      .filter({ hasText: '复制给 Agent' })
      .click();
    const handoff = JSON.parse(await run('window.prTask'));
    assert.equal(handoff.context.localView.view, 'label:' + label.id);
    assert(handoff.cli.commands[1].includes('local-list'));
  } finally {
    await run(
      `require('@electron/remote').clipboard.writeText=window.prClipboard;delete window.prClipboard;delete window.prTask;true`
    );
  }
  await action('[data-mailbox=inbox]');
  const bad = await cli(
    'snooze',
    { ...ref(ids[0]), until: '2000-01-01T09:00:00Z' },
    true
  );
  assert(JSON.stringify(bad).includes('invalid-snooze-time'));
  for (const untilValue of [
    '2027-01-01T09:00:00',
    '2027-02-30T09:00:00Z',
  ]) {
    assert(
      JSON.stringify(
        await cli('snooze', { ...ref(ids[0]), until: untilValue }, true)
      ).includes('invalid-snooze-time')
    );
  }
  // Historical members absent from a snooze snapshot still have lower UIDs; they must not wake it.
  await cli('snooze', {
    ...ref(ids[1]),
    until: new Date(Date.now() + 3600000).toISOString(),
  });
  await run(
    `(async()=>{const db=require('mailspring-exports').DatabaseStore;const [s]=await db._query('SELECT baseline FROM PaperReedLocalThread WHERE accountId=? AND threadId=?',[${JSON.stringify(account.id)},${JSON.stringify(ids[1])}]);const b=JSON.parse(s.baseline);b.knownIds=[];const writer=new (require('better-sqlite3'))(db._databasePath);writer.prepare('UPDATE PaperReedLocalThread SET baseline=? WHERE accountId=? AND threadId=?').run([JSON.stringify(b),${JSON.stringify(account.id)},${JSON.stringify(ids[1])}]);writer.close();return ${mod}.reconcileLocalSnoozes();})()`
  );
  assert(
    (await state(ids[1])).snoozeUntil,
    'historical cache does not wake'
  );
  // Real remote replies enter via IMAP and native sync, not model injection.
  const thread = await cli('thread-get', { threadId: ids[1] });
  const message = await run(
    `require('mailspring-exports').DatabaseStore.findAll(require('mailspring-exports').Message).where({threadId:${JSON.stringify(ids[1])},draft:false}).then(ms=>({subject:ms[0].subject,mid:ms[0].headerMessageId}))`
  );
  function append(sender, n) {
    execFileSync('/usr/bin/python3', [
      '-c',
      `
import json,sys,imaplib,email.utils
from email.message import EmailMessage
a=json.load(open(sys.argv[1]));d=json.loads(sys.argv[2]);m=EmailMessage();m['From']=sys.argv[3];m['To']='test@example.test';m['Subject']='Re: '+d['subject'];m['Message-ID']='<triage-'+sys.argv[4]+'@example.test>';m['In-Reply-To']='<'+d['mid'].strip('<>')+'>';m['References']=m['In-Reply-To'];m['Date']=email.utils.formatdate(localtime=False);m.set_content('Triage reply '+sys.argv[4]);c=imaplib.IMAP4(a['settings']['imap_host'],a['settings']['imap_port']);c.login('test','pass');assert c.append('INBOX',None,None,m.as_bytes())[0]=='OK';c.logout()
`,
      path.join(work, 'account.json'),
      JSON.stringify(message),
      sender,
      n,
    ]);
  }
  append('test@example.test', 'self');
  await until(
    () =>
      run(
        `require('mailspring-exports').DatabaseStore.findAll(require('mailspring-exports').Message).where({threadId:${JSON.stringify(ids[1])},draft:false}).then(ms=>ms.length>=2)`
      ),
    'own reply synced'
  );
  await run(`${mod}.reconcileLocalSnoozes()`);
  assert((await state(ids[1])).snoozeUntil, 'own reply must not wake');
  append('reply@example.test', 'external');
  await until(async () => {
    await list({ view: 'snoozed' });
    return !(await state(ids[1])).snoozeUntil;
  }, 'external reply wakes snooze');
  // Spam/trash never gets restored by a local timer.
  await cli('snooze', {
    ...ref(ids[2]),
    until: new Date(Date.now() + 3600000).toISOString(),
  });
  const moved = await cli('trash', {
    ...ref(ids[2]),
    requestId: 'triage-trash',
  });
  await until(
    async () =>
      (
        await cli('change-get', {
          accountId: account.id,
          taskId: moved.items[0].taskId,
        })
      ).status === 'succeeded',
    'trash sync'
  );
  await list({ view: 'snoozed' });
  assert(!(await state(ids[2])).snoozeUntil);
  assert(!(await list({ folder: 'inbox' })).some((t) => t.id === ids[2]));
  // Same operation shapes are safe to repeat, partial errors retain successful targets.
  const partial = await cli(
    'pin',
    {
      targets: [
        ...targets([ids[3]]),
        { accountId: account.id, threadId: 'missing' },
      ],
    },
    true
  );
  assert.equal(partial.items[0].status, 'succeeded');
  assert.equal(partial.items[1].status, 'rejected');
  const wrong = await cli(
    'pin',
    { targets: [{ accountId: 'wrong', threadId: ids[3] }] },
    true
  );
  assert.equal(wrong.items[0].status, 'rejected');
  await run("AppEnv.config.set('core.mcp.accessLevel','read-only');true");
  assert(
    JSON.stringify(await cli('pin', ref(ids[4]), true)).includes(
      'Access denied'
    )
  );
  await run("AppEnv.config.set('core.mcp.accessLevel','read-write');true");
  const folders = await cli('folders', { accountId: account.id });
  const inbox = folders.find((f) => f.role === 'inbox');
  await run(
    `AppEnv.config.set('core.mcp.enabledAccounts',{[${JSON.stringify(account.id)}]:{enabled:true,excludedFolderIds:[${JSON.stringify(inbox.id)}]}});true`
  );
  assert(
    JSON.stringify(await cli('local-state', ref(ids[7]), true)).includes(
      'thread-not-found'
    )
  );
  assert(
    JSON.stringify(
      await cli('label-update', { id: label.id, name: 'forbidden' }, true)
    ).includes('Access denied')
  );
  await run(
    `AppEnv.config.set('core.mcp.enabledAccounts',{[${JSON.stringify(account.id)}]:{enabled:true}});true`
  );
  // Deleting a definition removes membership without deleting mail.
  const disposable = await cli('label-create', {
    name: '临时',
    color: '#78849a',
  });
  await cli('label-add', { ...ref(ids[7]), labelId: disposable.id });
  await cli('label-delete', { id: disposable.id });
  assert(
    !(await state(ids[7])).labels.some((l) => l.id === disposable.id)
  );
  await action('[data-mailbox=inbox]');
  await until(async () => (await rows()).length === 7, 'final inbox');
  await shot('inbox');
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width: 900,
    height: 700,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await main.locator('.pr-mail-item > input').first().check();
  await action('[data-local-panel=snooze]');
  await shot('compact');
  assert(
    await run(
      'document.querySelector(".pr-main").scrollWidth<=document.querySelector(".pr-main").clientWidth+1'
    )
  );
  const result = {
    pinOrderBeforePagination: true,
    pinAndUnpin: true,
    labelCRUD: true,
    labelFilter: true,
    labelColors: true,
    mixedMembership: true,
    snoozeCancel: true,
    snoozeExpiry: true,
    desktopRestartPersistence: true,
    expiryWhileClosed: true,
    readerControls: true,
    localViewAgentHandoff: true,
    keyboardDismissal: true,
    remoteStateUnchanged: true,
    historicalUIDIgnored: true,
    ownReplyIgnored: true,
    newIMAPReplyWakes: true,
    trashNotRestored: true,
    partialResults: true,
    accountIsolation: true,
    writePermission: true,
    folderExclusion: true,
    invalidTimeRejected: true,
    compactLayout: true,
    expectedSMTPSubmissions: 0,
  };
  fs.writeFileSync(
    path.join(out, 'result.json'),
    JSON.stringify(result, null, 2) + '\n'
  );
  console.log('PASS local triage', JSON.stringify(result));
};
