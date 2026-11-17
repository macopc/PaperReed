"""Create deterministic offline multi-account cache fixtures from a synthetic native profile."""
import argparse, copy, html, json, pathlib, sqlite3
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--base',type=pathlib.Path,required=True)
p.add_argument('--output',type=pathlib.Path,required=True)
p.add_argument('--per-account',type=int,default=10000)
a=p.parse_args();cfg=json.loads((a.base/'config.json').read_text())
assert cfg['*']['accounts'] and all(x['emailAddress'].endswith('@example.test') for x in cfg['*']['accounts'])
a.output.mkdir(parents=True,exist_ok=False)
c=sqlite3.connect(':memory:');source=sqlite3.connect(a.base/'edgehill.db');source.backup(c);source.close();c.row_factory=sqlite3.Row
folders=[dict(r) for r in c.execute('SELECT * FROM Folder')]
t=dict(c.execute('SELECT * FROM Thread LIMIT 1').fetchone());m=dict(c.execute('SELECT * FROM Message WHERE draft=0 LIMIT 1').fetchone())
for table in ['ThreadSearch','Thread','ThreadCategory','Message','MessageFolder','MessageBody','Folder','Label','Task','PaperReedLocalThread','PaperReedLocalThreadLabel','PaperReedRuleProcessed','PaperReedSend']:
 if c.execute('SELECT 1 FROM sqlite_master WHERE type="table" AND name=?',(table,)).fetchone():c.execute('DELETE FROM '+table)
def insert(table,row):
 c.execute(f"INSERT INTO {table} ({','.join(row)}) VALUES ({','.join('?' for _ in row)})",list(row.values()))
accounts=[];manifest={'accounts':[], 'perAccountThreads':a.per_account,'longThreads':[], 'htmlThreads':[]}
for k in range(3):
 aid=f'load000{k}';email=f'load{k}@example.test';account=copy.deepcopy(cfg['*']['accounts'][0]);account.update(id=aid,emailAddress=email,name=f'Load {k}',label=f'Load {k}');accounts.append(account)
 roles={}
 for old in folders:
  row=copy.deepcopy(old);fid=f'{aid}-{old["role"]}';data=json.loads(row['data']);data.update(aid=aid,id=fid);row.update(id=fid,accountId=aid,data=json.dumps(data));insert('Folder',row);roles[old['role']]=(fid,data)
 manifest['accounts'].append({'id':aid,'email':email,'inbox':roles['inbox'][0]})
 for i in range(a.per_account):
  tid=f't:{aid}-{i:08d}';is_long=i==0;is_html=i%50==0;role='archive' if i%101==1 else 'inbox';fid,folder=roles[role];base_date=1794900000+i*3+k
  subject=f'Conversation {k}' if is_long else f'Project {k} note {i}'
  text=f'账户{k}专属 共同产品设计 Project account{k} item {i}.'
  if is_html:
   text+='\n'+'\n'.join(f'Row {j} — 财务预算、需求评审和多语言内容 café 日本語 العربية. '+('Quarterly planning details. '*12) for j in range(160))
   body='<html><body><h1>'+html.escape(subject)+'</h1><p>'+html.escape(text.split('\n')[0])+'</p><table>'+''.join('<tr><td>'+html.escape(line)+'</td></tr>' for line in text.split('\n')[1:])+'</table><blockquote><blockquote>Nested quoted reply 中文引用</blockquote></blockquote><p>BODY-END-MARKER</p></body></html>'
   manifest['htmlThreads'].append(tid)
  else:body=text
  count=30 if is_long else 1
  td=json.loads(t['data']);td.update(id=tid,aid=aid,subject=subject,folders=[folder],labels=[],participants=[{'email':email,'name':f'Load {k}'},{'email':'sender@example.test','name':'Sender'}],fmt=base_date,lmt=base_date+count-1,lmrt=base_date+count-1,lmst=0,unread=0)
  for j in range(count):
   mid=f'{aid}-{i:08d}-{j}';md=json.loads(m['data']);md.update(id=mid,aid=aid,threadId=tid,hMsgId=f'{mid}@example.test',subject=subject,date=base_date+j,folders={fid:0},labels=[],unread=False,plaintext=not is_html,snippet=text[:180],to=[{'email':email,'name':f'Load {k}'}],**{'from':[{'email':'sender@example.test','name':'Sender'}]})
   insert('Message',{**m,'id':mid,'accountId':aid,'threadId':tid,'data':json.dumps(md),'headerMessageId':md['hMsgId'],'date':base_date+j,'subject':subject,'unread':0})
   c.execute('INSERT INTO MessageBody VALUES(?,?,CURRENT_TIMESTAMP)',(mid,body))
   c.execute('INSERT INTO MessageFolder(accountId,messageId,folderId,remoteUID) VALUES(?,?,?,?)',(aid,mid,fid,i*30+j+1))
   c.execute('INSERT INTO PaperReedRuleProcessed VALUES(?,?)',(aid,mid))
  search=c.execute('INSERT INTO ThreadSearch(content_id,subject,to_,from_,categories,body) VALUES(?,?,?,?,?,?)',(tid,subject,email,'sender@example.test',role,text*count))
  td['searchRowId']=search.lastrowid
  insert('Thread',{**t,'id':tid,'accountId':aid,'data':json.dumps(td),'subject':subject,'firstMessageTimestamp':base_date,'lastMessageTimestamp':base_date+count-1,'lastMessageReceivedTimestamp':base_date+count-1,'lastMessageSentTimestamp':0,'unread':0})
  c.execute('INSERT INTO ThreadCategory VALUES(?,?,?,?,?,?)',(tid,fid,1,0,base_date+count-1,0))
  if i in [2,3]:c.execute('INSERT INTO PaperReedLocalThread(accountId,threadId,pinned) VALUES(?,?,1)',(aid,tid))
  if is_long:manifest['longThreads'].append(tid)
 c.execute('INSERT INTO PaperReedLocalThread(accountId,threadId,snoozeUntil) VALUES(?,?,?)',(aid,f't:{aid}-00000004',4102444800000))
c.execute('ANALYZE');c.commit();dest=sqlite3.connect(a.output/'edgehill.db');c.backup(dest);dest.close()
cfg['*']['accounts']=accounts;cfg['*']['core']['mcp']={'enabled':False};(a.output/'config.json').write_text(json.dumps(cfg))
manifest.update(messages=c.execute('SELECT COUNT(*) FROM Message').fetchone()[0],databaseBytes=(a.output/'edgehill.db').stat().st_size,bodyBytes=c.execute('SELECT SUM(length(CAST(value AS BLOB))) FROM MessageBody').fetchone()[0])
(a.output/'manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps({k:v for k,v in manifest.items() if k not in ['htmlThreads']},indent=2))
