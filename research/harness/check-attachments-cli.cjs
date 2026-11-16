const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict');

module.exports = async ({ main, cdp, account, cli, work, evaluate, until, restartDesktop }) => {
  const out = path.resolve(__dirname, '../attachments-validation-2026-11-16');
  fs.mkdirSync(out, { recursive: true });
  const run = s => evaluate(cdp, s), q = JSON.stringify;
  const action = s => main.locator(s).first().click();
  const ref = d => ({ accountId: account.id, draftId: d.draftId });
  const get = d => cli('draft-get', ref(d));
  const core = "require(AppEnv.getLoadSettings().resourcePath+'/src/services/mail-core')";
  const shot = async name => {
    const image = await cdp.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
    fs.writeFileSync(path.join(out, name + '.png'), Buffer.from(image.data, 'base64'));
  };
  const fail = async (command, input, pattern) => {
    const result = await cli(command, input, true);
    assert.match(JSON.stringify(result), pattern);
  };
  const readFile = (d, f = d.files[0]) => cli('attachment-get', { messageId: d.messageId, fileId: f.id });

  // Change the account color through the real settings page, then check both mailbox scopes.
  await main.locator('.pr-sidebar button').filter({ hasText: '设置' }).click();
  await action('[data-settings-tab="Accounts"]');
  await main.locator('#account-color').fill('#997d67');
  await action('#account-label');
  await until(() => run(`require('mailspring-exports').AccountStore.accountForId(${q(account.id)}).color === '#997d67'`), 'color saved');
  await run('require("mailspring-exports").Actions.selectRootSheet(require("mailspring-exports").WorkspaceStore.Sheet.Threads);true');
  const color = () => run('getComputedStyle(document.querySelector(".pr-avatar")).borderTopColor');
  await until(async () => await color() === 'rgb(153, 125, 103)', 'unified inbox uses saved color');
  await main.locator('#pr-account').selectOption(account.id);
  assert.equal(await color(), 'rgb(153, 125, 103)');
  await shot('account-color');
  await main.locator('#pr-account').selectOption('');

  const threads = await cli('search', { accountId: account.id, query: 'in:inbox' });
  const source = threads.find(t => t.subject.includes('Design review'));
  const thread = await cli('thread-get', { threadId: source.id });
  const incoming = thread.messages.find(m => m.files?.length);
  assert(incoming, 'fixture attachment synced');
  const incomingFile = await cli('attachment-get', { messageId: incoming.id, fileId: incoming.files[0].id });
  assert.equal(fs.readFileSync(incomingFile.path, 'utf8'), 'Incoming attachment bytes\n');

  console.log('PASS account color / incoming attachment');
  let draft = await cli('draft-create', { accountId: account.id, to: [{ email: 'old@example.test' }], subject: 'Paper Reed attachment handoff', body: '<div>Original body</div>' });
  draft = await get(draft);
  draft = await cli('draft-update', { ...ref(draft), expectedRevision: draft.revision, changes: {
    to: [{ name: 'Recipient', email: 'recipient@example.test' }], cc: [{ email: 'cc@example.test' }], bcc: [{ email: 'bcc@example.test' }],
  } });
  assert.equal(draft.to[0].email, 'recipient@example.test');
  const sourceFile = path.join(work, "报告 ' paper.txt");
  fs.writeFileSync(sourceFile, 'Frozen attachment bytes\n');
  draft = await cli('draft-attach', { ...ref(draft), expectedRevision: draft.revision, path: sourceFile });
  fs.writeFileSync(sourceFile, 'Changed outside the app\n');
  let file = await readFile(draft);
  assert.equal(fs.readFileSync(file.path, 'utf8'), 'Frozen attachment bytes\n');
  assert.equal(draft.files[0].filename, path.basename(sourceFile));
  await fail('draft-update', { ...ref(draft), expectedRevision: draft.revision, changes: { to: [{ email: 'invalid' }] } }, /invalid-recipient/);
  await fail('draft-attach', { ...ref(draft), expectedRevision: draft.revision - 1, path: sourceFile }, /draft-conflict/);
  await fail('draft-detach', { ...ref(draft), expectedRevision: draft.revision - 1, fileId: draft.files[0].id }, /draft-conflict/);
  await fail('draft-attach', { ...ref(draft), expectedRevision: draft.revision, path: work }, /attachment-not-a-file/);
  await fail('draft-attach', { ...ref(draft), expectedRevision: draft.revision, path: 'relative.txt' }, /absolute/);
  assert.equal((await get(draft)).revision, draft.revision);

  await run("AppEnv.config.set('core.mcp.accessLevel','read-only');true");
  await fail('draft-attach', { ...ref(draft), expectedRevision: draft.revision, path: sourceFile }, /denied|read-only/i);
  await run("AppEnv.config.set('core.mcp.accessLevel','read-write-send');true");
  await fail('draft-update', { ...ref(draft), accountId: 'wrong-account', expectedRevision: draft.revision, changes: { body: 'wrong' } }, /account|denied|not-found/i);
  await fail('draft-reply', { accountId: 'wrong-account', threadId: source.id, body: 'wrong' }, /not found/i);

  console.log('PASS recipients / attachment import / permissions');
  const limitDraft = await cli('draft-create', { accountId: account.id, to: [], subject: 'Attachment limits', body: '' });
  await fail('draft-send', { ...ref(limitDraft), expectedRevision: limitDraft.revision, requestId: 'no-recipients' }, /recipients-required/);
  const large = path.join(work, 'large.bin');
  fs.writeFileSync(large, ''); fs.truncateSync(large, 25000001);
  await fail('draft-attach', { ...ref(limitDraft), expectedRevision: limitDraft.revision, path: large }, /attachments-too-large/);
  fs.truncateSync(large, 13000000);
  const half = await cli('draft-attach', { ...ref(limitDraft), expectedRevision: limitDraft.revision, path: large });
  await fail('draft-attach', { ...ref(half), expectedRevision: half.revision, path: large }, /attachments-too-large/);
  assert.equal((await get(half)).files.length, 1);
  await cli('draft-detach', { ...ref(half), expectedRevision: half.revision, fileId: half.files[0].id });
  const basicReply = await cli('draft-reply', { accountId: account.id, threadId: source.id, type: 'reply', body: 'Reply only' });
  const basic = await get(basicReply);
  assert.equal(basic.cc.length, 0);
  assert.deepEqual(basic.to.map(c => c.email), ['sender0@example.test']);
  const folders = await cli('folders', { accountId: account.id });
  const inbox = folders.find(f => f.role === 'inbox');
  await run(`AppEnv.config.set('core.mcp.enabledAccounts',${q({[account.id]:{enabled:true,excludedFolderIds:[inbox.id]}})});true`);
  await fail('attachment-get', { messageId: incoming.id, fileId: incoming.files[0].id }, /not found/i);
  await run(`AppEnv.config.set('core.mcp.enabledAccounts',${q({[account.id]:{enabled:true}})});true`);

  // Clean GUI refresh, then an unsaved GUI edit vs a CLI attachment removal.
  await action('[data-mailbox="drafts"]');
  await until(() => run(`!!document.querySelector('[data-draft-id="${draft.draftId}"]')`), 'draft list');
  await action(`[data-draft-id="${draft.draftId}"]`);
  await until(() => run('!!document.querySelector(".attachments-area .file-upload")'), 'GUI attachment visible');
  draft = await get(draft);
  draft = await cli('draft-update', { ...ref(draft), expectedRevision: draft.revision, changes: { cc: [], subject: 'Paper Reed CLI recipients' } });
  await until(async () => await main.locator('.pr-subject-heading textarea').inputValue() === draft.subject, 'CLI updates clean GUI');
  assert.deepEqual(draft.cc, []);
  await main.locator('.pr-subject-heading textarea').fill('Paper Reed GUI attachment copy');
  const remote = await cli('draft-detach', { ...ref(draft), expectedRevision: draft.revision, fileId: draft.files[0].id });
  assert.equal(remote.files.length, 0);
  assert.equal(fs.readFileSync(file.path, 'utf8'), 'Frozen attachment bytes\n', 'removal retains bytes needed by unsaved GUI');
  await until(() => run('!!document.querySelector(".pr-draft-status.needs-attention")'), 'revision conflict');
  await shot('attachment-conflict');
  await action('.pr-status-line button');
  await until(() => run('!!document.querySelector(".pr-reload-original")'), 'attachment copy saved');
  const rows = await run("require('mailspring-exports').DatabaseStore._query('SELECT copyDraftId FROM PaperReedDraftRecovery ORDER BY createdAt DESC')");
  let copy = await get({ draftId: rows[0].copyDraftId });
  assert.equal(copy.subject, 'Paper Reed GUI attachment copy');
  assert.equal(copy.files.length, 1);
  assert.notEqual(copy.files[0].id, draft.files[0].id);
  const copyFile = await readFile(copy);
  assert.equal(fs.readFileSync(copyFile.path, 'utf8'), 'Frozen attachment bytes\n');
  assert.equal((await get(draft)).files.length, 0);
  await action('.pr-reload-original');
  await until(() => run('!document.querySelector(".pr-draft-status.needs-attention")'), 'latest original restored');

  // GUI adds a local file using its actual attachment action and saves through the same core.
  await run(`require('mailspring-exports').Actions.addAttachment({headerMessageId:${q(draft.draftId)},filePath:${q(sourceFile)}});true`);
  await until(() => run('document.querySelectorAll(".attachments-area .file-upload").length===1'), 'GUI attached file');
  await until(async () => (await get(draft)).files.length === 1, 'GUI attachment persisted');
  const guiDraft = await get(draft);
  assert.equal((await readFile(guiDraft)).data, 'Changed outside the app\n');

  // Delay only the file-copy boundary; navigating must wait for the real copy and save.
  await run(`(()=>{const module=require(AppEnv.getLoadSettings().resourcePath+'/src/services/mail-core/draft-files');
    const original=module.importDraftFile;
    module.importDraftFile=(...args)=>new Promise((resolve,reject)=>{global.__finishAttachment=()=>{module.importDraftFile=original;original(...args).then(resolve,reject);};});
    require('mailspring-exports').Actions.addAttachment({headerMessageId:${q(draft.draftId)},filePath:${q(sourceFile)}});return true;})()`);
  await until(() => run('typeof global.__finishAttachment === "function"'), 'attachment copy pending');
  await action('[data-mailbox="inbox"]');
  assert(await run('!!document.querySelector(".pr-route-compose")'), 'navigation waits for attachment');
  await run('global.__finishAttachment();true');
  await until(() => run('!!document.querySelector(".pr-route-list")'), 'navigation after attachment persisted');
  assert.equal((await get(draft)).files.length, 2);
  await action('[data-mailbox="drafts"]');
  await action(`[data-draft-id="${draft.draftId}"]`);
  await until(() => run('document.querySelectorAll(".attachments-area .file-upload").length===2'), 'two attachments in GUI');
  await main.locator('.attachments-area .file-upload .file-action-icon').last().click();
  await until(async () => (await get(draft)).files.length === 1, 'GUI remove persisted');
  console.log('PASS GUI conflict / independent copy / GUI attach');
  ({ main, cdp } = await restartDesktop());
  await until(async () => await color() === 'rgb(153, 125, 103)', 'account color survives restart');
  await action('[data-mailbox="drafts"]');
  await until(() => run(`!!document.querySelector('[data-draft-id="${copy.draftId}"]')`), 'copy survives restart');
  await action(`[data-draft-id="${copy.draftId}"]`);
  await until(() => run('!!document.querySelector(".attachments-area .file-upload")'), 'copy attachment reopened');
  copy = await get(copy);
  assert.equal((await readFile(copy)).data, 'Frozen attachment bytes\n');
  await shot('attachment-copy');

  // Missing bytes must not create a send operation or silently omit the attachment.
  fs.renameSync(copyFile.path, copyFile.path + '.held');
  await fail('attachment-get', { messageId: copy.messageId, fileId: copy.files[0].id }, /not available locally/i);
  await fail('draft-send', { ...ref(copy), expectedRevision: copy.revision, requestId: 'missing-bytes' }, /attachment-copy-failed/);
  fs.renameSync(copyFile.path + '.held', copyFile.path);
  assert.equal((await run("require('mailspring-exports').DatabaseStore._query('SELECT requestId FROM PaperReedSend')")).length, 0);

  console.log('PASS restart / missing attachment blocks send');
  // A narrow boundary hook changes the old draft bytes after snapshot creation, before native queueing.
  await run(`(()=>{const bridge=AppEnv.mailsyncBridge, original=bridge.sendMessageToAccount;
    bridge.sendMessageToAccount=function(accountId, data){
      if(data.type==='queue-task' && data.task.constructor.name==='SendDraftTask') {
        bridge.sendMessageToAccount=original;
        global.__attachmentSnapshot=data.task.draft.files.map(f=>f.id);
        require('fs').writeFileSync(${q(copyFile.path)},'Changed after send snapshot\\n');
      }
      return original.call(this,accountId,data);
    };return true;})()`);
  await action('.btn-send .primary-item');
  await until(async () => (await run("require('mailspring-exports').DatabaseStore._query(\"SELECT phase,sentCopy FROM PaperReedSend\")")).some(r => r.phase === 'accepted' && r.sentCopy === 'filed'), 'GUI attachment send accepted', 45000);
  assert.notEqual((await run('global.__attachmentSnapshot'))[0], copy.files[0].id);

  let reply = await cli('draft-reply', { accountId: account.id, threadId: source.id, type: 'reply-all', body: '<div>Paper Reed CLI reply</div>' });
  reply = await get(reply);
  assert(reply.to.some(c => c.email === 'sender0@example.test'));
  assert(reply.cc.some(c => c.email === 'team@example.test'), 'reply-all retains other recipients');
  assert(![...reply.to, ...reply.cc].some(c => c.email === account.emailAddress));
  reply = await cli('draft-attach', { ...ref(reply), expectedRevision: reply.revision, path: incomingFile.path });
  const sent = await cli('draft-send', { ...ref(reply), expectedRevision: reply.revision, requestId: 'attachment-reply' });
  await until(async () => { const o = await cli('operation-get', { accountId: account.id, operationId: sent.operationId }); return o.state === 'accepted' && o.sentCopy === 'filed'; }, 'CLI reply accepted', 45000);
  const retry = await cli('draft-send', { ...ref(reply), expectedRevision: reply.revision, requestId: 'attachment-reply' });
  assert.equal(retry.operationId, sent.operationId);

  // Inline images preserve cid in a strict independent copy; deleting an in-use cid is refused.
  const inline = await run(`(async()=>{const core=${core};const d=await core.getDraft(${q(ref(guiDraft))},core.desktopAccess);
    d.files[0].contentId='paper-reed-inline';d.body='<div><img src="cid:paper-reed-inline"></div>';
    const saved=await core.saveDraft(d,core.desktopAccess);d.version=saved.savedDraftRevision;
    const copy=await core.saveDraftCopy(d,core.desktopAccess);return {source:core.draftResult(d),copy:core.draftResult(copy)};})()`);
  assert.equal(inline.copy.files[0].contentId, 'paper-reed-inline');
  assert.notEqual(inline.copy.files[0].id, inline.source.files[0].id);
  await fail('draft-detach', { ...ref(inline.source), expectedRevision: inline.source.revision, fileId: inline.source.files[0].id }, /inline-attachment-in-use/);

  const result = { incomingAttachmentRead: true, attachmentFolderPermission: true, attachmentSizeLimit: true, totalAttachmentSizeLimit: true, emptyRecipientsBlocked: true, CLIReply: true, recipientUpdate: true, clearRecipients: true, invalidRecipientRejected: true,
    attachCopiesBytes: true, staleAttachmentMutationRejected: true, invalidPathRejected: true, draftPermissionEnforced: true,
    accountIsolation: true, cleanGUIRefresh: true, dirtyGUIConflict: true, removedBytesRetainedForRecovery: true,
    attachmentRecoveryCopy: true, independentFileIds: true, GUIAttachSharedDraft: true, GUIRemoveSharedDraft: true, pendingAttachmentNavigation: true, restartRecovery: true,
    missingAttachmentBlocksSend: true, sendSnapshotIndependent: true, GUISend: true, CLIReplyAllSend: true,
    repeatSendReturnsSameOperation: true, inlineCopyPreservesCID: true, inlineRemovalGuard: true,
    accountColorUnifiedAndSingle: true, accountColorPersists: true, exactAttachmentPath: true, expectedSMTPSubmissions: 2 };
  fs.writeFileSync(path.join(out, 'result.json'), JSON.stringify(result, null, 2) + '\n');
  console.log('PASS attachments / CLI / color', JSON.stringify(result));
};
