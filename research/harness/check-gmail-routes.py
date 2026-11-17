import socket,ssl,json,urllib.request,concurrent.futures,time
hosts=['smtp.gmail.com','smtp.googlemail.com']
targets=[]
for h in hosts:
 try:
  ips=sorted(set(x[4][0] for x in socket.getaddrinfo(h,465,type=socket.SOCK_STREAM)))
  print('system DNS',h,ips,flush=True)
  targets.append((h,h,'system',465));targets.append((h,h,'system',587))
  with urllib.request.urlopen('https://dns.google/resolve?name='+h+'&type=A',timeout=10) as r:d=json.load(r)
  ips=[x['data'] for x in d.get('Answer',[]) if x['type']==1]
  print('public DNS',h,ips,flush=True)
  if ips: targets.extend([(h,ips[0],'public-address',465),(h,ips[0],'public-address',587)])
 except Exception as e:print(h,type(e).__name__)
def probe(t):
 h,address,source,port=t;start=time.monotonic();stage='connect'
 try:
  with socket.create_connection((address,port),timeout=8) as s:
   stage='TLS' if port==465 else 'greeting'
   if port==465:
    with ssl.create_default_context().wrap_socket(s,server_hostname=h) as tls: value=tls.recv(512).decode().strip()
   else:value=s.recv(512).decode().strip()
  return dict(host=h,source=source,port=port,stage=stage,result=value or 'EOF',seconds=round(time.monotonic()-start,2))
 except Exception as e:return dict(host=h,source=source,port=port,stage=stage,result=str(e),seconds=round(time.monotonic()-start,2))
with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
 for r in pool.map(probe,targets):print(json.dumps(r),flush=True)
