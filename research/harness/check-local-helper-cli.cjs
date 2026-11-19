const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {spawn}=require('node:child_process');
module.exports=async({run,page,port,token,profile,root,out})=>{
  const tokenFile=path.join(profile,'audit-cli-token');fs.writeFileSync(tokenFile,token,{mode:0o600});
  const checks=[];
  const cli=(command,input={},expectFailure=false)=>new Promise((resolve,reject)=>{
    const p=spawn(process.execPath,[path.join(root,'research/cli/paper-reed.cjs'),command],{env:{...process.env,PAPER_REED_UPSTREAM:path.join(root,'research/.local/Mailspring'),PAPER_REED_TOKEN_FILE:tokenFile,PAPER_REED_MCP_URL:`http://127.0.0.1:${port}/mcp`},stdio:['pipe','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',v=>stdout+=v);p.stderr.on('data',v=>stderr+=v);p.on('error',reject);p.on('exit',code=>{try{assert(expectFailure?code!==0:code===0,command+': '+stdout+stderr);resolve(JSON.parse(stdout||stderr));}catch(e){reject(e)}});p.stdin.end(JSON.stringify(input));
  });
  await run("AppEnv.config.set('core.mcp.accessLevel','read-write');AppEnv.config.set('core.mcp.enabledAccounts',{});true");
  const target=await run("auditInbox.queryInbox({accountIds:['load0000'],folder:'inbox',limit:1},auditInbox.inboxDesktopAccess).then(r=>({accountId:r[0].accountId,threadId:r[0].id,subject:r[0].subject}))");
  const ref={accountId:target.accountId,threadId:target.threadId},targets=[ref],state=async()=>(await cli('local-state',{targets}))[target.threadId];
  await cli('pin',{targets});assert((await state()).pinned);await cli('unpin',{targets});assert(!(await state()).pinned);checks.push('CLI pin/unpin and read state');
  const label=await cli('label-create',{name:'Release audit',color:'#688177'});
  await cli('label-add',{targets,labelId:label.id});assert((await state()).labels.some(l=>l.id===label.id));
  await cli('label-update',{id:label.id,name:'Release verified',color:'#78849a'});assert((await state()).labels.some(l=>l.id===label.id&&l.name==='Release verified'));
  // Wait for the normal workspace subscription, then capture the actual app.
  await page.locator('.pr-search-input').fill('subject:"'+target.subject+'"');
  await page.locator('[data-thread-id="'+target.threadId+'"]').waitFor();
  await page.locator('.pr-local-label').filter({hasText:'Release verified'}).first().scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,'cli-label-in-gui.png')});
  await page.locator('.pr-search-input').fill('');
  await cli('label-remove',{targets,labelId:label.id});assert(!(await state()).labels.some(l=>l.id===label.id));checks.push('CLI labels create/update/membership reflected in GUI');
  await cli('snooze',{targets,until:new Date(Date.now()+60000).toISOString()});assert((await state()).snoozeUntil>Date.now());
  await cli('unsnooze',{targets});assert.equal((await state()).snoozeUntil,null);checks.push('CLI snooze/unsnooze');
  const ruleBase={accountId:target.accountId,name:'Audit classification',field:'subject',query:target.subject,action:'category',value:'notifications',enabled:true};
  const categoryRule=await cli('rule-save',ruleBase);
  const labelRule=await cli('rule-save',{...ruleBase,name:'Audit label',action:'label',value:label.id});
  const preview=await cli('rules-preview',{accountId:target.accountId,targets});
  assert.equal(preview.items[0].ruleIds.length,2);
  const applyInput={accountId:target.accountId,revision:preview.revision,targets:[{...ref,messageId:preview.items[0].messageId}]};
  await cli('rules-apply',applyInput);assert.equal((await state()).category,'notifications');assert((await state()).labels.some(l=>l.id===label.id));
  await cli('rules-reorder',{accountId:target.accountId,ids:[labelRule.id,categoryRule.id]});
  assert.deepEqual((await cli('rules',{accountId:target.accountId})).rules.map(r=>r.id),[labelRule.id,categoryRule.id]);
  const stale=await cli('rules-apply',applyInput,true);assert(JSON.stringify(stale).includes('rules-changed'));checks.push('CLI rule save, preview, apply, reorder and stale preview rejection');
  const mid=preview.items[0].messageId;
  // Simulate a newly discovered UID in the synthetic mailbox, then use real rule processing.
  await run(`(async()=>{
    const baseline=await auditEnv.DatabaseStore._query('SELECT baseline FROM PaperReedLocalRule WHERE id=?',[${JSON.stringify(labelRule.id)}]);const b=JSON.parse(baseline[0].baseline);
    await auditEnv.DatabaseStore._localTransaction([
      {query:'UPDATE MessageFolder SET remoteUID=? WHERE messageId=? AND folderId=?',values:[b.nextUID+10,${JSON.stringify(mid)},b.folderId]},
      {query:'DELETE FROM PaperReedRuleProcessed WHERE messageId=?',values:[${JSON.stringify(mid)}]},
      {query:'DELETE FROM PaperReedLocalThreadLabel WHERE threadId=?',values:[${JSON.stringify(target.threadId)}]},
      {query:"UPDATE PaperReedLocalThread SET category='ordinary',categoryManual=0 WHERE threadId=?",values:[${JSON.stringify(target.threadId)}]},
    ]);await auditTriage.processLocalRules();
  })()`);
  assert.equal((await state()).category,'notifications');assert((await state()).labels.some(l=>l.id===label.id));
  await cli('classify',{targets,category:'people'});assert.equal((await state()).category,'people');
  await cli('rules-apply',{...(await cli('rules-preview',{accountId:target.accountId,targets})),accountId:target.accountId,targets:[{...ref,messageId:mid}]});assert.equal((await state()).category,'people');
  checks.push('Automatic rule batch and manual-category precedence');
  await cli('label-delete',{id:label.id});assert(!(await state()).labels.some(l=>l.id===label.id));assert.equal((await cli('rules',{accountId:target.accountId})).rules.find(r=>r.id===labelRule.id).enabled,false);checks.push('Label deletion removes memberships and disables dependent rules atomically');
  await cli('rule-delete',{accountId:target.accountId,id:labelRule.id});await cli('rule-delete',{accountId:target.accountId,id:categoryRule.id});
  const rolledBack=await run(`(async()=>{try{await auditEnv.DatabaseStore._localTransaction([{query:"INSERT INTO PaperReedLocalLabel (id,name,nameKey,color) VALUES ('audit-rollback','rollback','audit-rollback','#688177')"},{query:'SELECT * FROM audit_nonexistent_table'}]);return false}catch{return (await auditEnv.DatabaseStore._query("SELECT id FROM PaperReedLocalLabel WHERE id='audit-rollback'")).length===0}})()`);assert(rolledBack);checks.push('Helper transaction rollback on real SQL failure');
  await run("AppEnv.config.set('core.mcp.accessLevel','read-only');true");await cli('pin',{targets},true);checks.push('CLI write denied after permission revocation');
  fs.unlinkSync(tokenFile);
  console.log('PASS local helper and CLI regressions',JSON.stringify(checks));return checks;
};
