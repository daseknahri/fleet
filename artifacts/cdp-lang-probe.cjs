const http=require('http');
const get=p=>new Promise((res,rej)=>http.get('http://127.0.0.1:9229'+p,r=>{let d='';r.on('data',x=>d+=x);r.on('end',()=>res(JSON.parse(d))) }).on('error',rej));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 const v=await get('/json/version'); const ws0=new WebSocket(v.webSocketDebuggerUrl); await new Promise(r=>ws0.addEventListener('open',r));
 const id=1; ws0.send(JSON.stringify({id,method:'Target.createTarget',params:{url:'http://localhost:3002/sign-in?probe=1'}}));
 const ev=await new Promise(r=>ws0.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===id)r(x)})); ws0.close();
 const targets=await get('/json'); const t=targets.find(x=>x.id===ev.result.targetId||x.targetId===ev.result.targetId); const ws=new WebSocket(t.webSocketDebuggerUrl); await new Promise(r=>ws.addEventListener('open',r));
 let n=0,p=new Map(); ws.onmessage=e=>{const m=JSON.parse(e.data); if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id)}};
 const call=(m,q={})=>new Promise(r=>{const i=++n;p.set(i,r);ws.send(JSON.stringify({id:i,method:m,params:q}))});
 await call('Runtime.enable'); await call('Page.enable'); await sleep(1200);
 const fill=`(()=>{const a=[...document.querySelectorAll('input')]; const set=(e,v)=>{if(!e)return; const s=Object.getOwnPropertyDescriptor(e.__proto__,'value')?.set; if(s)s.call(e,v); else e.value=v; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}))}; set(a.find(x=>x.name==='email'),'admin@fleetrent.local'); set(a.find(x=>x.name==='password'),'B00kC4r5'); document.querySelector('form')?.requestSubmit(); return 1})()`;
 await call('Runtime.evaluate',{expression:fill}); await sleep(4500);
 await call('Page.navigate',{url:'http://localhost:3002/bookings?probe='+Date.now()}); await sleep(2600);
 const r=await call('Runtime.evaluate',{expression:`JSON.stringify({htmlLang:document.documentElement.lang,dir:document.documentElement.dir,ls:JSON.parse(localStorage.getItem('bc-be-user')||'null')?.language,query:location.search})`,returnByValue:true});
 console.log(r.result?.result?.value);
 ws.close();
})().catch(e=>{console.error(e);process.exit(1)});
