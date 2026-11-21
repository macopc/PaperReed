const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const [upstream, accountId] = process.argv.slice(2);
const ts = createRequire(path.join(upstream, 'package.json'))('typescript');
const rl = require('node:readline').createInterface({ input: process.stdin });
let sequence = 0;
const pending = new Map();
rl.on('line', (line) => { const a = JSON.parse(line), p = pending.get(a.id); pending.delete(a.id); a.error ? p.reject(new Error(a.error)) : p.resolve(a.result); });
function rpc(method, ...args) { const id = ++sequence; return new Promise((resolve,reject) => { pending.set(id,{resolve,reject}); process.stdout.write(JSON.stringify({id,method,args})+'\n'); }); }
class Message {
  static attributes = { body: {} };
  constructor(v={}) { Object.assign(this,v); }
  fromJSON(v) { Object.assign(this,v,{accountId:v.aid,headerMessageId:v.hMsgId,version:v.v}); return this; }
  toJSON() { const v={...this,aid:this.accountId,hMsgId:this.headerMessageId,v:this.version,__cls:'Message'}; delete v.accountId;delete v.headerMessageId;delete v.version; return v; }
}
class Save {
  constructor({draft}) { this.draft=draft;this.id=randomUUID(); }
  assertSaved() { if(this.error)throw new Error(this.error.key);return this; }
}
class Send extends Save { static forSending(draft) { return new Send({draft}); } }
const db = {
  _query:(...args)=>rpc('query',...args),
  findBy:(_, ref)=>({ include:async()=>{
    const rows=await rpc('query','SELECT m.data, b.value AS body FROM Message m JOIN MessageBody b ON m.id=b.id WHERE m.accountId = ? AND m.headerMessageId = ?', [ref.accountId,ref.headerMessageId]);
    return rows.length ? new Message().fromJSON({...JSON.parse(rows[0].data),body:rows[0].body}) : null;
  } }),
};
const deps = {
  crypto:require('node:crypto'), '../../flux/stores/database-store':db,
  '../../flux/stores/account-store':{AccountStore:{accountForId:(id)=>id===accountId}},
  '../../flux/stores/task-queue':{waitForPerformLocal:async(t)=>Object.assign(new Save({draft:t.draft}),await rpc('wait',t.id))},
  '../../flux/models/message':{Message}, '../../flux/tasks/syncback-draft-task':{SyncbackDraftTask:Save},
  '../../flux/tasks/send-draft-task':{SendDraftTask:Send},
  '../../flux/actions':{queueTask(t){ rpc('enqueue',{id:t.id,__cls:t instanceof Send?'SendDraftTask':'SyncbackDraftTask',draft:t.draft.toJSON(),perRecipientBodies:null}).catch(e=>{throw e;}); }},
};
const moduleCore={exports:{}};
const source=fs.readFileSync(path.join(upstream,'app/src/services/mail-core/index.ts'),'utf8');
const code=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,esModuleInterop:true}}).outputText;
vm.runInNewContext(code,{module:moduleCore,exports:moduleCore.exports,require:(name)=>{if(!(name in deps))throw new Error(name);return deps[name];},setTimeout,clearTimeout,navigator:{onLine:true}});
const core=moduleCore.exports;
const access={check(id){if(id!==accountId)throw new Error('access-denied');},visible:async()=>true};
async function checkCLI(operation) {
  const requireDesktop=createRequire(path.join(upstream,'app/package.json'));
  const {McpServer}=requireDesktop('@modelcontextprotocol/sdk/server/mcp.js');
  const {StreamableHTTPServerTransport}=requireDesktop('@modelcontextprotocol/sdk/server/streamableHttp.js');
  const {z}=requireDesktop('zod');
  const http=require('node:http'), os=require('node:os'), {spawn}=require('node:child_process');
  const token=randomUUID(), temp=fs.mkdtempSync(path.join(os.tmpdir(),'paper-reed-cli-'));
  const tokenFile=path.join(temp,'token');fs.writeFileSync(tokenFile,token,{mode:0o600});
  const listener=http.createServer(async(req,res)=>{
    if(req.headers.authorization!==`Bearer ${token}`){res.writeHead(401);res.end();return;}
    const server=new McpServer({name:'paper-reed-test-adapter',version:'0.0.1'});
    server.tool('get_operation','Read actual engine operation',{accountId:z.string(),operationId:z.string()},async(args)=>({
      content:[{type:'text',text:JSON.stringify(await core.getOperation(args.accountId,args.operationId,access))}],
    }));
    const transport=new StreamableHTTPServerTransport({sessionIdGenerator:undefined,enableJsonResponse:true});
    res.on('close',()=>{transport.close();server.close();});
    try{await server.connect(transport);await transport.handleRequest(req,res);}catch(e){if(!res.headersSent)res.writeHead(500);res.end();}
  });
  await new Promise(r=>listener.listen(0,'127.0.0.1',r));
  try{
    const child=spawn(path.join(upstream,'app','paper-reed-cli'),['operation-get'],{
      env:{...process.env,PAPER_REED_UPSTREAM:upstream,PAPER_REED_TOKEN_FILE:tokenFile,PAPER_REED_MCP_URL:`http://127.0.0.1:${listener.address().port}/mcp`},stdio:['pipe','pipe','pipe'],
    });
    let stdout='',stderr='';child.stdout.on('data',b=>stdout+=b);child.stderr.on('data',b=>stderr+=b);
    child.stdin.end(JSON.stringify({accountId,operationId:operation.operationId}));
    const status=await new Promise((resolve,reject)=>{child.on('exit',resolve);child.on('error',reject);});
    assert.equal(status,0,stderr);const received=JSON.parse(stdout);
    assert.equal(received.operationId,operation.operationId);assert.equal(received.state,'accepted');
    console.error('PASS actual CLI process -> authenticated local MCP -> shared service -> actual engine operation');
  }finally{listener.closeAllConnections();await new Promise(r=>listener.close(r));fs.rmSync(temp,{recursive:true});}
}
(async()=>{
  const draft=new Message({accountId,headerMessageId:'shared@example.test',version:0,subject:'shared draft',body:'agent draft',plaintext:true,
    from:[{email:'test@example.test'}],to:[{email:'recipient@example.test'}],cc:[],bcc:[],replyTo:[],files:[],rthMsgId:'',fwdMsgId:''});
  const saved=await core.saveDraft(draft,access);
  const ref={accountId,draftId:draft.headerMessageId};
  const first=await core.getDraft(ref,access);
  assert.equal(first.version,saved.savedDraftRevision);
  const gui=await core.updateDraft(ref,first.version,{body:'用户修改\n第二行'},core.desktopAccess);
  assert.equal((await core.getDraft(ref,access)).body,'用户修改\n第二行');
  await assert.rejects(core.updateDraft(ref,first.version,{body:'stale agent edit'},access),/draft-conflict/);
  await assert.rejects(core.getDraft({...ref,accountId:'other'},access),/access-denied/);
  const noSend={...access,check(id,action){access.check(id);if(action==='send')throw new Error('send-not-authorized');}};
  await assert.rejects(core.submitSend(ref,gui.revision,'unauthorized',noSend),/send-not-authorized/);
  assert.equal(await rpc('smtp-count'),0);
  const operation=await core.submitSend(ref,gui.revision,'request-one',access);
  const replay=await core.submitSend(ref,gui.revision,'request-one',access);
  assert.equal(replay.operationId,operation.operationId);
  await assert.rejects(core.submitSend(ref,gui.revision+1,'request-one',access),/request-conflict/);
  await assert.rejects(core.submitSend(ref,gui.revision,'request-two',access));
  let final;
  for(let i=0;i<100;i++){
    final=await core.getOperation(accountId,operation.operationId,access);
    if(final.state==='accepted' && final.sentCopy!=='pending')break;
    await new Promise(r=>setTimeout(r,100));
  }
  assert.equal(final.state,'accepted');assert.equal(await rpc('smtp-count'),1);
  await rpc('churn');
  await rpc('restart');
  assert.equal((await rpc('query','SELECT id FROM Task WHERE id = ?',[operation.operationId])).length,0);
  assert.equal((await core.submitSend(ref,gui.revision,'request-one',access)).operationId,operation.operationId);
  assert.equal((await core.getOperation(accountId,operation.operationId,access)).state,'accepted');
  await assert.rejects(core.getOperation('other',operation.operationId,access),/access-denied/);
  assert.equal(await rpc('smtp-count'),1);
  await checkCLI(final);
  console.error('PASS shared draft revisions, stale edit rejection, account isolation, durable operation replay/conflict, restart without resend');
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>rl.close());
