const http=require('http'),fs=require('fs');
const get=p=>new Promise((res,rej)=>http.get('http://127.0.0.1:9229'+p,r=>{let d='';r.on('data',x=>d+=x);r.on('end',()=>res(JSON.parse(d))) }).on('error',rej));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const v=await get('/json/version'); const ws0=new WebSocket(v.webSocketDebuggerUrl); await new Promise(r=>ws0.addEventListener('open',r));
 const id=1; ws0.send(JSON.stringify({id,method:'Target.createTarget',params:{url:'http://localhost:3002/sign-in?fresh=1'}}));
 const ev=await new Promise(r=>ws0.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===id)r(x)})); ws0.close();
 const targets=await get('/json'); const t=targets.find(x=>x.id===ev.result.targetId||x.targetId===ev.result.targetId); const ws=new WebSocket(t.webSocketDebuggerUrl); await new Promise(r=>ws.addEventListener('open',r));
 let n=0,p=new Map(),errors=[]; ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.method==='Runtime.exceptionThrown') errors.push({type:'exception',text:m.params.exceptionDetails?.text||m.params.exceptionDetails?.exception?.description}); if(m.method==='Runtime.consoleAPICalled') errors.push({type:m.params.type,args:m.params.args?.map(a=>a.value||a.description).join(' ')}); if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id)}};
 const call=(method,params={})=>new Promise(r=>{const i=++n;p.set(i,r);ws.send(JSON.stringify({id:i,method,params}))});
 await call('Runtime.enable'); await call('Page.enable'); await sleep(1500);
 const fill=`(()=>{const a=[...document.querySelectorAll('input')]; const set=(e,v)=>{if(!e)return; const s=Object.getOwnPropertyDescriptor(e.__proto__,'value')?.set; if(s)s.call(e,v); else e.value=v; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}))}; set(a.find(x=>x.name==='email'),'admin@fleetrent.local'); set(a.find(x=>x.name==='password'),'B00kC4r5'); document.querySelector('form')?.requestSubmit(); return location.href})()`;
 await call('Runtime.evaluate',{expression:fill,returnByValue:true}); await sleep(4500);
 const routes=['/','/dashboard','/cars','/bookings','/locations','/suppliers','/users','/maintenance','/payments','/caisse','/reports']; let rows=[];
 for(const route of routes){errors=[]; await call('Page.navigate',{url:'http://localhost:3002'+route+'?fresh='+Date.now()}); await sleep(2200); const r=await call('Runtime.evaluate',{expression:`JSON.stringify({url:location.href,route:location.pathname,lang:document.documentElement.lang,dir:document.documentElement.dir,title:document.title,body:document.body.innerText.slice(0,500),articles:document.querySelectorAll('article').length,buttons:document.querySelectorAll('button').length,alerts:[...document.querySelectorAll('[role=alert]')].map(x=>x.innerText),errorBoundary:document.body.innerText.includes('Something went wrong.')})`,returnByValue:true}); let value=r.result?.result?.value||'{}'; let row=JSON.parse(value); row.errors=errors; rows.push(row); console.log(JSON.stringify(row)); }
 fs.writeFileSync('artifacts/browser-admin-route-matrix-latest.json',JSON.stringify({generatedAt:new Date().toISOString(),routes:rows},null,2)); ws.close();
})().catch(e=>{console.error(e);process.exit(1)});
