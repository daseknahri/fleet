const http=require('http'),fs=require('fs');
const get=p=>new Promise((res,rej)=>http.get('http://127.0.0.1:9229'+p,r=>{let d='';r.on('data',x=>d+=x);r.on('end',()=>res(JSON.parse(d))) }).on('error',rej));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const FRENCH=['NOUVELLE VOITURE','Nouvelle voiture','NOUVELLE RÉSERVATION','Nouvelle réservation','Fournisseur','Cocher tout','Classement','Spécificités du véhicule','Lieu de prise en charge','Lieu de restitution','Kilométrage','Transmission','Politique carburant','Sièges','Multimédia','Gamme'];
(async()=>{
 const v=await get('/json/version'); const ws0=new WebSocket(v.webSocketDebuggerUrl); await new Promise(r=>ws0.addEventListener('open',r));
 const id=1; ws0.send(JSON.stringify({id,method:'Target.createTarget',params:{url:'http://localhost:3002/sign-in?ar=1'}}));
 const ev=await new Promise(r=>ws0.addEventListener('message',e=>{const x=JSON.parse(e.data);if(x.id===id)r(x)})); ws0.close();
 const targets=await get('/json'); const t=targets.find(x=>x.id===ev.result.targetId||x.targetId===ev.result.targetId); const ws=new WebSocket(t.webSocketDebuggerUrl); await new Promise(r=>ws.addEventListener('open',r));
 let n=0,p=new Map(),errors=[],missing=[];
 ws.onmessage=e=>{const m=JSON.parse(e.data);
  if(m.method==='Runtime.exceptionThrown') errors.push({type:'exception',text:m.params.exceptionDetails?.text||m.params.exceptionDetails?.exception?.description});
  if(m.method==='Runtime.consoleAPICalled'){
    const txt=m.params.args?.map(a=>a.value||a.description).join(' ')||'';
    if(/not found in localizedStrings/.test(txt)) missing.push(txt);
    else if(m.params.type==='error') errors.push({type:'console.error',args:txt});
  }
  if(m.id&&p.has(m.id)){p.get(m.id)(m);p.delete(m.id)}};
 const call=(method,params={})=>new Promise(r=>{const i=++n;p.set(i,r);ws.send(JSON.stringify({id:i,method,params}))});
 await call('Runtime.enable'); await call('Page.enable'); await sleep(1500);
 const fill=`(()=>{const a=[...document.querySelectorAll('input')]; const set=(e,v)=>{if(!e)return; const s=Object.getOwnPropertyDescriptor(e.__proto__,'value')?.set; if(s)s.call(e,v); else e.value=v; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true}))}; set(a.find(x=>x.name==='email'),'admin@fleetrent.local'); set(a.find(x=>x.name==='password'),'B00kC4r5'); document.querySelector('form')?.requestSubmit(); return location.href})()`;
 await call('Runtime.evaluate',{expression:fill,returnByValue:true}); await sleep(4500);
 const rows=[];
 for(const route of ['/cars','/bookings','/locations','/suppliers','/users']){
   errors=[]; missing=[];
   await call('Page.navigate',{url:'http://localhost:3002'+route+'?l=ar&v='+Date.now()});
   await sleep(2600);
   const r=await call('Runtime.evaluate',{expression:`JSON.stringify({route:location.pathname,lang:document.documentElement.lang,dir:document.documentElement.dir,text:document.body.innerText,errorBoundary:document.body.innerText.includes('Something went wrong.')})`,returnByValue:true});
   const info=JSON.parse(r.result?.result?.value||'{}');
   const found=FRENCH.filter(f=>(info.text||'').includes(f));
   rows.push({route:info.route,lang:info.lang,dir:info.dir,errorBoundary:info.errorBoundary,frenchFallback:found,missingKeyWarnings:[...new Set(missing)].length,runtimeErrors:errors.filter(e=>e.type==='exception'||e.type==='console.error').length,sample:(info.text||'').slice(0,260)});
   console.log(JSON.stringify(rows[rows.length-1]));
 }
 fs.writeFileSync('artifacts/browser-arabic-localization-latest.json',JSON.stringify({generatedAt:new Date().toISOString(),rows},null,2));
 ws.close();
})().catch(e=>{console.error(e);process.exit(1)});
