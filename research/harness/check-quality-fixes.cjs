const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
module.exports=async({app,main,cdp,work,account,cli,evaluate,until,restartDesktop})=>{
 let run=s=>evaluate(cdp,s), q=JSON.stringify, result={};
 await until(()=>run('document.querySelectorAll(".pr-mail-row").length===8'),'synced inbox');
 const draft=await cli('draft-create',{accountId:account.id,to:[{email:'recipient@example.test'}],subject:'Quality review',body:'Original'});
 const ref={accountId:account.id,draftId:draft.draftId};
 // No mock of attachment failure: import a nonexistent file through the actual action.
 result.attachmentError=await run(`(async()=>{const store=require('mailspring-exports').AttachmentStore;
 const old=AppEnv.showErrorDialog;global.__dialogs=[];AppEnv.showErrorDialog=(e)=>{global.__dialogs.push(e);return new Promise(resolve=>global.__ackAttachment=resolve);};
 await store._onAddAttachment({headerMessageId:${q(draft.draftId)},filePath:${q(path.join(work,'missing.txt'))}}).catch(()=>{});
 const pending=store.hasPendingDraftAttachments(${q(draft.draftId)});
 const observed=await Promise.allSettled([store.waitForDraftAttachments(${q(draft.draftId)}),store.waitForDraftAttachments(${q(draft.draftId)})]);
 global.__ackAttachment();await Promise.resolve();AppEnv.showErrorDialog=old;
 return {pendingAfterFailure:pending,waiters:observed.map(x=>x.status),remainingPending:store.hasPendingDraftAttachments(${q(draft.draftId)}),dialogs:global.__dialogs.length};})()`);
 assert.deepEqual(result.attachmentError.waiters,['rejected','rejected']);
 console.log('ATTACHMENT_ERROR',JSON.stringify(result.attachmentError));
 const retrySource=path.join(work,'retry.txt');fs.writeFileSync(retrySource,'Retry attachment bytes');
 result.attachmentRetry=await run(`(async()=>{const {AttachmentStore,DraftStore}=require('mailspring-exports');
 await AttachmentStore._onAddAttachment({headerMessageId:${q(draft.draftId)},filePath:${q(retrySource)}});
 await AttachmentStore.waitForDraftAttachments(${q(draft.draftId)});
 const session=await DraftStore.sessionForClientId(${q(draft.draftId)});
 await session.changes.commit();const count=session.draft().files.length;DraftStore._doneWithSession(session);
 return count===1&&!AttachmentStore.hasPendingDraftAttachments(${q(draft.draftId)});})()`);
 assert.equal(result.attachmentRetry,true);
 // Count actual model reads made by localStates, excluding its two local SQL reads per row.
 const threads=await cli('search',{accountId:account.id,query:'in:inbox'});
 const targets=threads.map(t=>({accountId:account.id,threadId:t.id}));
 result.localStateReads=await run(`(async()=>{const {DatabaseStore,Thread}=require('mailspring-exports');
 const original=DatabaseStore.find;let finds=0;DatabaseStore.find=function(...args){if(args[0]===Thread)finds++;return original.apply(this,args);};
 try {await require(AppEnv.getLoadSettings().resourcePath+'/src/services/mail-core/local-triage').localStates(${q(targets)},require(AppEnv.getLoadSettings().resourcePath+'/src/services/mail-core/inbox').inboxDesktopAccess);return {threads:${targets.length},threadFinds:finds};}
 finally {DatabaseStore.find=original;}})()`);
 assert.equal(result.localStateReads.threadFinds,0);
 console.log('LOCAL_READS',JSON.stringify(result.localStateReads));
 // Delay one normal validation read to observe whether independent Inbox reads queue behind it.
 await run(`(()=>{const {DatabaseStore,Thread}=require('mailspring-exports'),original=DatabaseStore.find;
 DatabaseStore.find=function(...args){if(args[0]===Thread&&args[1]===${q(threads[0].id)}){DatabaseStore.find=original;return new Promise(resolve=>{global.__releaseTriage=()=>resolve(original.apply(this,args));});}return original.apply(this,args);};
 const triage=require(AppEnv.getLoadSettings().resourcePath+'/src/services/mail-core/local-triage'),inbox=require(AppEnv.getLoadSettings().resourcePath+'/src/services/mail-core/inbox');
 global.__pin=triage.changeLocalMail({action:'pin',targets:[${q(targets[0])}]},inbox.inboxDesktopAccess);return true;})()`);
 await until(()=>run('typeof global.__releaseTriage === "function"'),'triage read held');
 await run(`(()=>{const base=AppEnv.getLoadSettings().resourcePath+'/src/services/mail-core/';const t=require(base+'local-triage'),i=require(base+'inbox');
 global.__inboxDone=false;global.__labelsDone=false;
 global.__inbox=i.queryInbox({accountIds:[${q(account.id)}],folder:'inbox',limit:10},i.inboxDesktopAccess).then(()=>global.__inboxDone=true);
 global.__labels=t.localLabels().then(()=>global.__labelsDone=true);return true;})()`);
 await until(()=>run('global.__labelsDone && global.__inboxDone'),'reads finish without releasing writer');
 result.readQueuesBehindWrite=await run('({labelsFinished:global.__labelsDone,inboxFinished:global.__inboxDone})');
 assert.equal(result.readQueuesBehindWrite.inboxFinished,true);
 await run('global.__releaseTriage();Promise.all([global.__pin,global.__inbox]).then(()=>true)');
 console.log('READ_QUEUE',JSON.stringify(result.readQueuesBehindWrite));
 // Actual popout close: delay delivery of the native save receipt, keep editing while waiting.
 await run(`require('mailspring-exports').Actions.composePopoutDraft(${q(draft.draftId)});true`);
 const composer=await until(async()=>app.windows().find(w=>JSON.parse(new URL(w.url()||'about:blank').searchParams.get('loadSettings')||'{}').windowType==='composer'),'composer');
 composer.on('dialog',()=>{});
 const editor=await app.context().newCDPSession(composer), erun=s=>evaluate(editor,s);
 await erun(`global.__closeErrors=[];AppEnv.showErrorDialog=async e=>global.__closeErrors.push(e);true`);
 await until(()=>erun('!!document.querySelector("[contenteditable=true]")'),'editable');
 await composer.locator('[contenteditable=true]').first().click();await composer.keyboard.press('Meta+End');await composer.keyboard.insertText(' First edit.');
 await erun(`(()=>{const queue=require('mailspring-exports').TaskQueue,original=queue.waitForPerformLocal;
 queue.waitForPerformLocal=async function(task){const saved=await original.call(this,task);if(task.constructor.name==='SyncbackDraftTask'){
 queue.waitForPerformLocal=original;return new Promise(resolve=>{global.__releaseReceipt=()=>resolve(saved);});}return saved;};
 setTimeout(()=>AppEnv.close(),0);return true;})()`);
 await until(()=>erun('typeof global.__releaseReceipt === "function"'),'saved receipt held');
 const editable=await erun('!!document.querySelector("[contenteditable=true]")');
 if(editable){await composer.locator('[contenteditable=true]').first().click();await composer.keyboard.press('Meta+End');await composer.keyboard.insertText(' Late edit while closing.');}
 const stateBefore=await erun(`(async()=>{const s=await require('mailspring-exports').DraftStore.sessionForClientId(${q(draft.draftId)});return {body:s.draft().body,dirty:s.changes.isDirty()};})()`);
 await erun('global.__releaseReceipt();true');
 await until(()=>erun('!require("mailspring-exports").DraftStore._closeSaveInProgress'),'close attempt settled');
 assert.equal(composer.isClosed(),false);
 assert((await erun('global.__closeErrors.length'))>0);
 await erun('AppEnv.close();true');
 await until(async()=>composer.isClosed(),'second close saves later edits');
 const saved=await cli('draft-get',ref);
 result.closeRace={editableDuringSave:editable,beforeClose:stateBefore,persistedBody:saved.body,lateEditLost:stateBefore.body.includes('Late edit')&&!saved.body.includes('Late edit')};
 assert.equal(result.closeRace.lateEditLost,false);
 console.log('CLOSE_RACE',JSON.stringify(result.closeRace));

 // Failed import did not poison a later add. A removed file is reclaimed on restart,
 // while a saved draft still owns its attachment.
 const source=path.join(work,'cleanup.txt');fs.writeFileSync(source,'Owned attachment bytes');
 const retained=await cli('draft-attach',{...ref,expectedRevision:saved.revision,path:source});
 const paths=await run(`(async()=>{const base=AppEnv.getLoadSettings().resourcePath+'/src/services/mail-core/';
 const files=require(base+'draft-files'), core=require(base), store=require('mailspring-exports').AttachmentStore;
 const orphan=await files.importDraftFile(${q(source)});
 const draft=await core.getDraft(${q(ref)},core.desktopAccess);
 return {orphan:store.pathForFile(orphan),retained:store.pathForFile(draft.files[0]),directory:store._filesDirectory};})()`);
 const unmanaged=path.join(paths.directory,'lo','ca','unmanaged','keep.txt');fs.mkdirSync(path.dirname(unmanaged),{recursive:true});fs.writeFileSync(unmanaged,'keep');
 assert(fs.existsSync(paths.orphan));assert(fs.existsSync(paths.retained));
 const next=await restartDesktop();cdp=next.cdp;run=s=>evaluate(cdp,s);
 await until(()=>!fs.existsSync(paths.orphan),'startup removes unreferenced import');
 assert(fs.existsSync(paths.retained));assert(fs.existsSync(unmanaged));
 const current=await cli('draft-get',ref);
 await cli('draft-detach',{...ref,expectedRevision:current.revision,fileId:current.files[0].id});
 await until(()=>run(`require('mailspring-exports').DatabaseStore._query("SELECT data FROM Task WHERE json_extract(data,'$.headerMessageId')=? AND json_extract(data,'$.status') NOT IN ('complete','cancelled')",[${q(ref.draftId)}]).then(rows=>rows.length===0)`),'attachment detach completes remotely');
 const again=await restartDesktop();cdp=again.cdp;run=s=>evaluate(cdp,s);
 await until(()=>!fs.existsSync(paths.retained),'removed draft file reclaimed at startup');
 result.cleanup={orphanRemoved:true,savedDraftRetained:true,unmanagedRetained:true,detachedFileReclaimed:true};
 await require('./check-quality-pending.cjs')({cdp,work,account,cli,evaluate,until,result});
 const out=path.resolve(__dirname,'../quality-fixes-validation-2026-11-16');fs.mkdirSync(out,{recursive:true});
 fs.writeFileSync(path.join(out,'result.json'),JSON.stringify(result,null,2)+'\n');
};
