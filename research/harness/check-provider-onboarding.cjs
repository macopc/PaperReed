// Execute the production onboarding helpers and browser callback against local fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const {createRequire} = require('node:module');
const root = path.resolve(process.argv[2]), r = createRequire(path.join(root,'app/package.json'));
const ts = r('typescript');
const folder = path.join(root,'app/internal_packages/onboarding/lib');
let ownClient = 'paper-reed-test-client', mode = 'success', tested = [], exchanged = 0;
const requests = [], results = [];
const AppEnv = {config:{get:key=>key==='core.paperReed.enabled'?true:key==='core.paperReed.microsoftClientId'?ownClient:undefined},
 getLoadSettings:()=>({}),focus(){},showErrorDialog(e){throw Error(e.message)},reportError(){}};
class Account {
 constructor(data){Object.assign(this,data);this.settings=data.settings||{}}
 clone(){return new Account(JSON.parse(JSON.stringify(this)))}
 usesOAuth(){return ['outlook','office365','gmail'].includes(this.provider)}
}
const exportsMock = {Account, AccountStore:{containerFolderDefaultGetter:()=> 'Paper Reed'},
 IdentityStore:{identity:()=>null}, localized:(x,...args)=>x.replace(/%@/g,()=>args.shift()),
 MailsyncProcess:class {async test(){tested.push(this.account)}}};
const crypto = require('node:crypto'), verifier = crypto.randomBytes(32).toString('base64url');
const constants = {O365_CLIENT_ID:'upstream-client-must-not-be-used', LOCAL_SERVER_PORT:0,
 O365_SCOPES:['Contacts.ReadWrite','Calendars.ReadWrite'], O365_GRAPH_SEND_SCOPES:['Mail.ReadWrite','Mail.Send'],
 CODE_VERIFIER:verifier,CODE_CHALLENGE:crypto.createHash('sha256').update(verifier).digest('base64url'),
 createOAuthState:()=>crypto.randomBytes(24).toString('hex')};
const dns = {resolveMx:(domain,cb)=>cb(null,[]),Resolver:class{resolveSrv(name,cb){cb(null,[])}}};
const xml = '<clientConfig><emailProvider id="custom.example.test"><incomingServer type="imap"><hostname>imap.custom.example.test</hostname><port>993</port><socketType>SSL</socketType><username>%EMAILADDRESS%</username></incomingServer><outgoingServer type="smtp"><hostname>smtp.custom.example.test</hostname><port>587</port><socketType>STARTTLS</socketType><username>%EMAILADDRESS%</username></outgoingServer></emailProvider></clientConfig>';
async function fixtureFetch(url, options){
 requests.push(url);
 if(url.includes('/token')){
  exchanged++;
  const form=new URLSearchParams(options.body);
  assert.equal(form.get('client_id'),ownClient);
  assert.equal(form.get('code_verifier'),verifier);
  assert(!form.get('scope').includes('outlook.office.com'));
  assert(!form.get('scope').includes('Contacts.'));
  return {ok:mode!=='token-error',status:400,json:async()=>mode==='token-error'?{error:'invalid_grant'}:{
   access_token:'fixture-access',refresh_token:mode==='no-refresh'?undefined:'fixture-refresh',
   scope:mode==='missing-scope'?'User.Read':'https://graph.microsoft.com/Mail.ReadWrite https://graph.microsoft.com/Mail.Send'}};
 }
 if(url==='https://graph.microsoft.com/v1.0/me'){
  assert.equal(options.headers.Authorization,'Bearer fixture-access');
  return {ok:true,json:async()=>({displayName:'Fixture',mail:mode==='wrong-account'?'other@example.test':'test@example.test'})};
 }
 if(url.includes('autoconfig.custom.example.test')) return {ok:true,text:async()=>xml};
 return {ok:false,status:404};
}
function load(file, extra={}){
 const exports={};
 const mocks={'mailspring-exports':exportsMock,'./onboarding-constants':constants,dns,...extra};
 const source=ts.transpileModule(fs.readFileSync(path.join(folder,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.React,esModuleInterop:true}}).outputText;
 vm.runInNewContext(source,{exports,require:name=>mocks[name]||(name.startsWith('.')?r(path.join(folder,name)):r(name)),
  AppEnv,process:{env:{}},console:{log(){}},Buffer,URL,URLSearchParams,setTimeout,clearTimeout,fetch:fixtureFetch,AbortController});
 return exports;
}
const helpers=load('onboarding-helpers.ts');
function pass(name){results.push(name);console.log('PASS',name)}
async function waitFor(fn){const end=Date.now()+10000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,20))}throw Error('Timed out')}
(async()=>{
 const googleGrant = {emailAddress:'test@example.test', settings:{gmail_api_send:true,
  gmail_client_id:'own-google-client',gmail_client_secret:'fixture-secret',refresh_token:'full-mail-refresh'}};
 tested=[];
 const gmail=await helpers.buildPaperReedGmailAccount(googleGrant);
 assert.equal(gmail.provider,'gmail');assert.equal(gmail.settings.imap_host,'imap.gmail.com');
 assert.equal(gmail.settings.refresh_token,'full-mail-refresh');assert.equal(gmail.settings.imap_password,undefined);
 assert.equal(tested.length,1);
 const old=new Account({id:'stable-local-id',emailAddress:'test@example.test',name:'My mailbox',color:'#556677',
  provider:'imap',settings:{imap_password:'old-password',smtp_password:'old-password',gmail_refresh_token:'old-send-grant'}});
 const reconnected=await helpers.buildPaperReedGmailAccount(googleGrant,old);
 assert.equal(reconnected.id,old.id);assert.equal(tested[1].id,old.id);
 assert.equal(reconnected.name,old.name);assert.equal(reconnected.color,old.color);
 assert.equal(reconnected.settings.gmail_refresh_token,undefined);assert.equal(reconnected.settings.smtp_password,undefined);
 assert.equal(old.settings.imap_password,'old-password','Failed validation must leave existing account untouched');
 pass('Gmail new login and legacy reconnect keep identity, replace password/send-only grant');
 let finishCount=0, finishValidation;
 const GooglePage=load('paper-reed-google-page.tsx',{
  './paper-reed-google-auth':{authorizeGoogle:async()=>googleGrant},
  './onboarding-helpers':{buildPaperReedGmailAccount:()=>new Promise(resolve=>{finishValidation=resolve})},
  './onboarding-actions':{finishAndAddAccount:()=>finishCount++},
  'mailspring-exports':{...exportsMock,AccountStore:{accounts:()=>[old]}},
 }).default;
 const googlePage=new GooglePage({account:old});googlePage.setState=next=>Object.assign(googlePage.state,next);
 const connecting=googlePage.connect();await waitFor(()=>finishValidation);
 assert.equal(googlePage.state.phase,'connecting');
 googlePage.componentWillUnmount();finishValidation(reconnected);await connecting;
 assert.equal(finishCount,0);pass('Leaving Google login during connection validation cannot save the account');
 ownClient='';assert.throws(()=>helpers.buildO365AuthURL(),/未配置/);assert.equal(exchanged,0);
 ownClient='paper-reed-test-client';
 const auth=new URL(helpers.buildO365AuthURL());
 assert.equal(auth.searchParams.get('client_id'),ownClient);
 assert.equal(auth.searchParams.get('code_challenge'),constants.CODE_CHALLENGE);
 assert(!/Contacts|Calendars/.test(auth.searchParams.get('scope')));
 assert(auth.searchParams.get('scope').includes('IMAP.AccessAsUser.All'));
 pass('own Microsoft identity, PKCE and mail-only scopes; no upstream fallback');
 for(mode of ['success','missing-scope','no-refresh','wrong-account','token-error']){
  tested=[];
  const build=()=>helpers.buildMicrosoftAccountFromAuthResponse('fixture-code','office365',{withGraphSend:true,expectedEmail:'test@example.test'});
  if(mode==='success'){
   const account=await build();assert.equal(account.settings.imap_host,'outlook.office365.com');
   assert.equal(account.settings.graph_send,true);assert.equal(account.settings.refresh_client_id,ownClient);
   assert.equal(account.settings.smtp_verification,'login');assert.equal(account.settings.create_helper_folders,false);
   assert.equal(tested.length,1);
  }else{await assert.rejects(build());assert.equal(tested.length,0)}
  pass('Microsoft '+mode);
 }
 mode='success';
 for(const [provider,email,imap,smtp] of [
  ['icloud','test@icloud.com','imap.mail.me.com','smtp.mail.me.com'],
  ['icloud','test@company.example.test','imap.mail.me.com','smtp.mail.me.com'],
  ['imap','test@qq.com','imap.qq.com','smtp.qq.com'],
  ['imap','test@163.com','imap.163.com','smtp.163.com'],
  ['imap','test@fastmail.com','imap.fastmail.com','smtp.fastmail.com'],
  ['imap','test@custom.example.test','imap.custom.example.test','smtp.custom.example.test']]){
  const {account}=await helpers.expandAccountForSetup(new Account({provider,emailAddress:email,name:'Fixture',settings:{imap_password:'fixture-pass'}}));
  assert.equal(account.settings.imap_host,imap);assert.equal(account.settings.smtp_host,smtp);
  assert.equal(account.settings.imap_security,'SSL / TLS');assert.equal(account.settings.smtp_password,'fixture-pass');
  if(provider==='icloud') {assert.equal(Number(account.settings.smtp_port),587);assert.equal(account.settings.smtp_security,'STARTTLS')}
  pass('existing configuration '+provider+' '+email.split('@')[1]);
 }
 let opened, success;
 const Page=load('oauth-signin-page.tsx',{
  electron:{shell:{openExternal:async url=>{opened=url}}},
  'mailspring-component-kit':{},'./form-error-message':()=>null,'./account-providers':[],
 }).default;
 const page=new Page({providerAuthPageUrl:auth.toString(),serviceName:'Microsoft',
  buildAccountFromAuthResponse:code=>helpers.buildMicrosoftAccountFromAuthResponse(code,'office365',{withGraphSend:true}),
  onSuccess:a=>{success=a}});
 page.setState=next=>Object.assign(page.state,next);
 try{
  page.componentDidMount();await waitFor(()=>opened);
  assert.equal(page._server.address().address,'127.0.0.1');
  const callback=new URL(`http://127.0.0.1:${page._server.address().port}/desktop`);
  callback.searchParams.set('code','fixture-code');callback.searchParams.set('state','wrong');
  const previous=exchanged;assert.equal((await fetch(callback)).status,400);assert.equal(exchanged,previous);
  callback.searchParams.set('state',auth.searchParams.get('state'));
  const response=await fetch(callback,{redirect:'manual'});assert.equal(response.status,200);assert.equal(response.headers.get('location'),null);
  assert((await response.text()).includes('Paper Reed'));
  assert.equal((await fetch(callback)).status,409);
  await waitFor(()=>success);assert.equal(exchanged,previous+1);
  pass('loopback callback, state rejection, single code exchange and local completion page');
 }finally{page.componentWillUnmount()}
 opened=null;
 const declined=new Page({providerAuthPageUrl:auth.toString(),serviceName:'Microsoft',
  buildAccountFromAuthResponse:()=>{throw Error('Declined consent must not exchange a code')},onSuccess:()=>{throw Error('Unexpected success')}});
 declined.setState=next=>Object.assign(declined.state,next);
 try{
  declined.componentDidMount();await waitFor(()=>opened);
  const callback=new URL(`http://127.0.0.1:${declined._server.address().port}/desktop`);
  callback.searchParams.set('state',auth.searchParams.get('state'));callback.searchParams.set('error','access_denied');
  assert.equal((await fetch(callback)).status,200);assert.equal(declined.state.authorizationDeclined,true);
  pass('Microsoft consent cancellation does not create an account');
 }finally{declined.componentWillUnmount()}
 if(process.argv[3])fs.writeFileSync(process.argv[3],JSON.stringify({realProviderAccounts:false,passed:results},null,2)+'\n');
})().catch(error=>{console.error(error);process.exitCode=1});
