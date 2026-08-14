const DB_URL='https://meopp-8f1fa-default-rtdb.firebaseio.com';
const ROOT='cashTopAI';
const clean=v=>String(v??'').trim();
const keySafe=s=>String(s||'rule').replace(/[.#$\[\]\/]/g,'_').slice(0,120);

function allowed(request){
  const secret=clean(process.env.POLL_SECRET);
  if(!secret)return true;
  return clean(new URL(request.url).searchParams.get('key'))===secret;
}
async function fbGet(path){
  const r=await fetch(`${DB_URL}/${path}.json`,{cache:'no-store'});
  if(!r.ok)throw new Error(`Firebase GET ${r.status}`);
  return await r.json();
}
async function fbPut(path,data){
  const r=await fetch(`${DB_URL}/${path}.json`,{
    method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(data)
  });
  if(!r.ok)throw new Error(`Firebase PUT ${r.status}: ${await r.text()}`);
  return await r.json();
}
async function fbPatch(path,data){
  const r=await fetch(`${DB_URL}/${path}.json`,{
    method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(data)
  });
  if(!r.ok)throw new Error(`Firebase PATCH ${r.status}: ${await r.text()}`);
  return await r.json();
}
async function fbDelete(path){
  const r=await fetch(`${DB_URL}/${path}.json`,{method:'DELETE'});
  if(!r.ok)throw new Error(`Firebase DELETE ${r.status}: ${await r.text()}`);
  return true;
}
function asList(obj){
  return Object.entries(obj||{}).map(([id,v])=>({id,...(v||{})}))
    .sort((a,b)=>Number(a.createdAt||0)-Number(b.createdAt||0));
}
function cleanMode(v){
  const mode=clean(v).toLowerCase();
  return ['none','ai','greeting','always'].includes(mode)?mode:'none';
}

export async function GET(request){
  if(!allowed(request))return Response.json({ok:false,error:'Unauthorized'},{status:401});
  try{
    const rules=asList(await fbGet(`${ROOT}/botRules`).catch(()=>({})));
    return Response.json({ok:true,rules},{headers:{'cache-control':'no-store'}});
  }catch(e){return Response.json({ok:false,error:String(e?.message||e)},{status:500});}
}

export async function POST(request){
  if(!allowed(request))return Response.json({ok:false,error:'Unauthorized'},{status:401});
  try{
    const body=await request.json().catch(()=>({}));
    const text=clean(body.text);
    if(!text)return Response.json({ok:false,error:'اكتب نص القاعدة أولاً'},{status:400});
    const id=keySafe(`rule_${Date.now()}_${Math.random().toString(36).slice(2,7)}`);
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
    await fbPut(`${ROOT}/botRules/${id}`,rule);
    return Response.json({ok:true,id,rule:{id,...rule}});
  }catch(e){return Response.json({ok:false,error:String(e?.message||e)},{status:500});}
}

export async function PATCH(request){
  if(!allowed(request))return Response.json({ok:false,error:'Unauthorized'},{status:401});
  try{
    const u=new URL(request.url); const rawId=clean(u.searchParams.get('id'));
    if(!rawId)return Response.json({ok:false,error:'Missing id'},{status:400});
    const id=keySafe(rawId);
    const body=await request.json().catch(()=>({}));
    const patch={updatedAt:Date.now()};
    if('text' in body){
      const text=clean(body.text);
      if(!text)return Response.json({ok:false,error:'القاعدة لا يمكن أن تكون فارغة'},{status:400});
      patch.text=text.slice(0,1800);
    }
    if('active' in body)patch.active=body.active!==false;
    if('mediaUrl' in body)patch.mediaUrl=clean(body.mediaUrl).slice(0,1200);
    if('mediaFileName' in body)patch.mediaFileName=clean(body.mediaFileName).slice(0,120);
    if('mediaMode' in body)patch.mediaMode=cleanMode(body.mediaMode);
    await fbPatch(`${ROOT}/botRules/${id}`,patch);
    return Response.json({ok:true,id,patch});
  }catch(e){return Response.json({ok:false,error:String(e?.message||e)},{status:500});}
}

export async function DELETE(request){
  if(!allowed(request))return Response.json({ok:false,error:'Unauthorized'},{status:401});
  try{
    const rawId=clean(new URL(request.url).searchParams.get('id'));
    if(!rawId)return Response.json({ok:false,error:'Missing id'},{status:400});
    const id=keySafe(rawId);
    await fbDelete(`${ROOT}/botRules/${id}`);
    return Response.json({ok:true,deleted:id});
  }catch(e){return Response.json({ok:false,error:String(e?.message||e)},{status:500});}
}
