const DB_URL='https://meopp-8f1fa-default-rtdb.firebaseio.com';
const ROOT='cashTopAI';
const clean=v=>String(v??'').trim();
function allowed(request){
  const secret=clean(process.env.POLL_SECRET);
  if(!secret)return true;
  return clean(new URL(request.url).searchParams.get('key'))===secret;
}
async function fbGet(path){
  const r=await fetch(`${DB_URL}/${path}.json`,{cache:'no-store'});
  if(!r.ok) throw new Error(`Firebase ${r.status}`);
  return await r.json();
}
export async function GET(request){
  if(!allowed(request)) return Response.json({ok:false,error:'Unauthorized'},{status:401});
  try{
    const [examples,pending,meta,health,rules]=await Promise.all([
      fbGet(`${ROOT}/humanLearning/examples`).catch(()=>({})),
      fbGet(`${ROOT}/humanLearning/pending`).catch(()=>({})),
      fbGet(`${ROOT}/humanLearning/importMeta`).catch(()=>({})),
      fbGet(`${ROOT}/webhookHealth/lastHumanLearning`).catch(()=>({})),
      fbGet(`${ROOT}/botRules`).catch(()=>({}))
    ]);
    const vals=Object.values(examples||{});
    return Response.json({
      ok:true,
      examples:vals.length,
      importedExamples:vals.filter(x=>x?.imported===true).length,
      liveExamples:vals.filter(x=>x?.imported!==true).length,
      pendingCustomers:Object.keys(pending||{}).length,
      lastImport:meta||{},
      lastHumanLearning:health||{},
      rules:Object.keys(rules||{}).length,
      activeRules:Object.values(rules||{}).filter(x=>x?.active!==false).length
    },{headers:{'cache-control':'no-store'}});
  }catch(e){ return Response.json({ok:false,error:String(e?.message||e)},{status:500}); }
}
