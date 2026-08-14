const DB_URL='https://meopp-8f1fa-default-rtdb.firebaseio.com';
const ROOT='cashTopAI';
const clean=v=>String(v??'').trim();
const keySafe=s=>String(s||'rule').replace(/[.#$\[\]\/]/g,'_').slice(0,120);

function allowed(request){
  const secret=clean(process.env.POLL_SECRET);
  if(!secret)return true;
  return clean(new URL(request.url).searchParams.get('key'))===secret;
}
async function fb(path,options={}){
  const r=await fetch(`${DB_URL}/${path}.json`,{
    cache:'no-store',
    headers:{'content-type':'application/json',...(options.headers||{})},
    ...options
  });
  const raw=await r.text();
  let data=null;
  try{ data=raw?JSON.parse(raw):null; }catch{ data={raw}; }
  if(!r.ok)throw new Error(`Firebase ${options.method||'GET'} ${r.status}: ${raw.slice(0,500)}`);
  return data;
}
function asList(obj){
  return Object.entries(obj||{}).map(([id,v])=>({id,...(v||{})}))
    .sort((a,b)=>Number(b.createdAt||0)-Number(a.createdAt||0));
}
function cleanMode(v){
  const mode=clean(v).toLowerCase();
  return ['none','ai','greeting','always'].includes(mode)?mode:'none';
}

export async function GET(request){
  if(!allowed(request))return Response.json({ok:false,error:'Unauthorized',source:'rules-v2'},{status:401});
  try{
    const raw=await fb(`${ROOT}/botRules`);
    return Response.json({
      ok:true,
      source:'rules-v2',
      count:Object.keys(raw||{}).length,
      rules:asList(raw)
    },{headers:{'cache-control':'no-store, no-cache, must-revalidate'}});
  }catch(e){
    return Response.json({ok:false,source:'rules-v2',error:String(e?.message||e)},{status:500});
  }
}

export async function POST(request){
  if(!allowed(request))return Response.json({ok:false,error:'Unauthorized',source:'rules-v2'},{status:401});
  try{
    const body=await request.json().catch(()=>({}));
    const text=clean(body.text);
    if(!text)return Response.json({ok:false,error:'اكتب نص القاعدة أولاً',source:'rules-v2'},{status:400});
    const id=keySafe(`rule_${Date.now()}_${Math.random().toString(36).slice(2,8)}`);
    const rule={
      text:text.slice(0,1800),
      active:body.active!==false,
      mediaUrl:clean(body.mediaUrl).slice(0,1200),
      mediaFileName:clean(body.mediaFileName).slice(0,120),
      mediaMode:cleanMode(body.mediaMode),
      createdAt:Date.now(),
      updatedAt:Date.now()
    };
    if(!rule.mediaUrl){rule.mediaFileName='';rule.mediaMode='none';}
    else if(rule.mediaMode==='none')rule.mediaMode='ai';
    await fb(`${ROOT}/botRules/${id}`,{method:'PUT',body:JSON.stringify(rule)});
    return Response.json({ok:true,source:'rules-v2',id,rule:{id,...rule}});
  }catch(e){
    return Response.json({ok:false,source:'rules-v2',error:String(e?.message||e)},{status:500});
  }
}

export async function PATCH(request){
  if(!allowed(request))return Response.json({ok:false,error:'Unauthorized',source:'rules-v2'},{status:401});
  try{
    const u=new URL(request.url);
    const id=keySafe(clean(u.searchParams.get('id')));
    if(!id)return Response.json({ok:false,error:'Missing id',source:'rules-v2'},{status:400});
    const body=await request.json().catch(()=>({}));
    const patch={updatedAt:Date.now()};
    if('text' in body){
      const text=clean(body.text);
      if(!text)return Response.json({ok:false,error:'القاعدة لا يمكن أن تكون فارغة',source:'rules-v2'},{status:400});
      patch.text=text.slice(0,1800);
    }
    if('active' in body)patch.active=body.active!==false;
    if('mediaUrl' in body)patch.mediaUrl=clean(body.mediaUrl).slice(0,1200);
    if('mediaFileName' in body)patch.mediaFileName=clean(body.mediaFileName).slice(0,120);
    if('mediaMode' in body)patch.mediaMode=cleanMode(body.mediaMode);
    await fb(`${ROOT}/botRules/${id}`,{method:'PATCH',body:JSON.stringify(patch)});
    return Response.json({ok:true,source:'rules-v2',id,patch});
  }catch(e){
    return Response.json({ok:false,source:'rules-v2',error:String(e?.message||e)},{status:500});
  }
}

export async function DELETE(request){
  if(!allowed(request))return Response.json({ok:false,error:'Unauthorized',source:'rules-v2'},{status:401});
  try{
    const id=keySafe(clean(new URL(request.url).searchParams.get('id')));
    if(!id)return Response.json({ok:false,error:'Missing id',source:'rules-v2'},{status:400});
    await fb(`${ROOT}/botRules/${id}`,{method:'DELETE'});
    return Response.json({ok:true,source:'rules-v2',deleted:id});
  }catch(e){
    return Response.json({ok:false,source:'rules-v2',error:String(e?.message||e)},{status:500});
  }
}
