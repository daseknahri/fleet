const http=require('http'); const get=p=>new Promise((res,rej)=>http.get('http://127.0.0.1:9229'+p,r=>{let d='';r.on('data',x=>d+=x);r.on('end',()=>res(JSON.parse(d))) }).on('error',rej));
(async()=>{let ts=await get('/json'); console.log(ts.map(x=>({id:x.id,url:x.url})))})()
