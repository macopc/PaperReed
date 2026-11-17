const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const {createRequire}=require('node:module');
const upstream=path.resolve(process.argv[2] || 'research/.local/Mailspring'), ts=createRequire(path.join(upstream,'package.json'))('typescript');
class Component {setState(value){this.state={...this.state,...value}}}
let queries=[];
const db={_query:(sql,values)=>new Promise((resolve,reject)=>queries.push({resolve,reject,sql,values}))};
const dependencies={
 'react':{Component},'electron':{},'crypto':require('node:crypto'),'@electron/remote':{},
 'mailspring-exports':{DatabaseStore:db,AccountStore:{accountIds:()=>['a']}},
 '../../../src/decorators/inflates-draft-client-id':v=>v,
};
const filename=path.join(upstream,'app/internal_packages/paper-reed/lib/workspace.tsx');
const compiled=ts.transpileModule(fs.readFileSync(filename,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
const moduleTest={exports:{}};
vm.runInNewContext(compiled,{exports:moduleTest.exports,require:name=>dependencies[name]||{},console,setTimeout,clearTimeout,setInterval,clearInterval});
const Workspace=moduleTest.exports.default;
const row=phase=>[{accountId:'a',requestId:'same-send',phase,sentCopy:'pending',payload:JSON.stringify({draft:{subject:'fixture'}})}];
(async()=>{
 const view=new Workspace();view.mounted=true;
 const first=view.refreshOperations();const second=view.refreshOperations();
 queries[1].resolve(row('accepted'));await second;
 queries[0].resolve(row('queued'));await first;
 assert.equal(view.state.operations[0].phase,'accepted','late query must not overwrite newer result');
 const older=view.refreshOperations(),newer=view.refreshOperations();
 queries[3].resolve(row('accepted'));await newer;
 queries[2].reject(Error('delayed database error'));await older;
 assert.equal(view.state.operations[0].phase,'accepted','stale failure must not clear newer result');
 assert.equal(view.state.operationsError,'');
 view.state.accountId='a';const filtered=view.refreshOperations();
 assert.match(queries[4].sql,/WHERE accountId IN \(\?\).*LIMIT 10/s);
 assert.deepEqual(Array.from(queries[4].values),['a']);
 // Execute the actual SQL against SQLite: ten newer records from another account
 // must not hide this account's older send result.
 const {execFileSync}=require('node:child_process');
 execFileSync('python3',['-c',`
import sqlite3,sys,json
c=sqlite3.connect(':memory:')
c.execute('CREATE TABLE PaperReedSend(accountId,requestId,phase,sentCopy,payload)')
c.execute("INSERT INTO PaperReedSend VALUES ('a','one','accepted','filed','{}')")
c.executemany("INSERT INTO PaperReedSend VALUES ('b',?,'accepted','filed','{}')",[(str(i),) for i in range(10)])
r=c.execute(sys.argv[1],json.loads(sys.argv[2])).fetchall()
assert len(r)==1 and r[0][0]=='a',r
`,queries[4].sql,JSON.stringify(queries[4].values)]);
 view.state.accountId='b';queries[4].resolve(row('queued'));await filtered;
 assert.equal(view.state.operations[0].phase,'accepted','query from previous account ignored');
 console.log('PASS send-result ordering, stale errors, account switch and SQL filtering before limit');
})().catch(e=>{console.error(e);process.exitCode=1});
