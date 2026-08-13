const DB_URL='https://meopp-8f1fa-default-rtdb.firebaseio.com';
const ROOT='cashTopAI';
const clean=v=>String(v??'').trim();

function cfg(){
  return {
    url:clean(process.env.GREEN_API_URL).replace(/\/$/,''),
    id:clean(process.env.GREEN_INSTANCE_ID),
    token:clean(process.env.GREEN_API_TOKEN),
    secret:clean(process.env.POLL_SECRET)
  };
}
function allowed(request){
  const s=cfg().secret;
  if(!s)return true;
  return clean(new URL(request.url).searchParams.get('key'))===s;
}
async function greenGet(method){
  const g=cfg();
  if(!g.url||!g.id||!g.token) throw new Error('GREEN API environment variables are missing');
  const r=await fetch(`${g.url}/waInstance${g.id}/${method}/${g.token}`,{cache:'no-store'});
  const raw=await r.text();
  let data={}; try{data=raw?JSON.parse(raw):{}}catch{data={raw}};
  if(!r.ok)throw new Error(data?.message||data?.error||`${method} HTTP ${r.status}`);
  return data;
}
async function fbGet(path){
  const r=await fetch(`${DB_URL}/${path}.json`,{cache:'no-store'});
  if(!r.ok) throw new Error(`Firebase HTTP ${r.status}`);
  return await r.json();
}
function ago(ts){
  if(!ts)return null;
  return Math.max(0,Math.round((Date.now()-Number(ts))/1000));
}
export async function GET(request){
  if(!allowed(request))return Response.json({ok:false,error:'Unauthorized'},{status:401});

  const origin=new URL(request.url).origin;
  const expected=`${origin}/api/webhook`;
  const out={
    ok:true,
    checkedAt:new Date().toISOString(),
    expectedWebhook:expected,
    green:{},
    webhookHealth:{},
    ready:false,
    message:''
  };

  try{
    const [settings,state,count,health]=await Promise.all([
      greenGet('getSettings'),
      greenGet('getStateInstance'),
      greenGet('getWebhooksCount').catch(e=>({error:String(e?.message||e)})),
      fbGet(`${ROOT}/webhookHealth`).catch(e=>({error:String(e?.message||e)}))
    ]);

    out.green.webhookUrl=settings?.webhookUrl||'';
    out.green.incomingWebhook=settings?.incomingWebhook||'';
    out.green.stateInstance=state?.stateInstance||state||'';
    out.green.queueCount=typeof count==='number'?count:(count?.count??count?.webhooksCount??count);
    out.green.webhookExact=clean(settings?.webhookUrl).replace(/\/$/,'')===expected.replace(/\/$/,'');
    out.green.incomingEnabled=String(settings?.incomingWebhook||'').toLowerCase()==='yes';

    out.webhookHealth=health||{};
    if(out.webhookHealth?.lastReceived?.at) out.webhookHealth.lastReceived.secondsAgo=ago(out.webhookHealth.lastReceived.at);
    if(out.webhookHealth?.lastSuccess?.at) out.webhookHealth.lastSuccess.secondsAgo=ago(out.webhookHealth.lastSuccess.at);
    if(out.webhookHealth?.lastError?.at) out.webhookHealth.lastError.secondsAgo=ago(out.webhookHealth.lastError.at);

    out.ready=out.green.webhookExact&&out.green.incomingEnabled&&out.green.stateInstance==='authorized';

    if(!out.green.webhookExact){
      out.message='Webhook URL is not active yet. Run /api/webhook-on and wait up to 5 minutes.';
    }else if(!out.green.incomingEnabled){
      out.message='incomingWebhook is not yes.';
    }else if(out.green.stateInstance!=='authorized'){
      out.message='GREEN API instance is rebooting or not authorized yet. Wait and check again.';
    }else if(out.webhookHealth?.lastReceived?.at){
      out.message='Webhook is configured and Vercel has received at least one POST.';
    }else{
      out.message='Settings look ready. Send a new WhatsApp message, then refresh this check endpoint after a few seconds.';
    }

    return Response.json(out,{headers:{'cache-control':'no-store'}});
  }catch(e){
    return Response.json({ok:false,error:String(e?.message||e),partial:out},{status:500});
  }
}
