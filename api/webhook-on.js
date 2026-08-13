const clean = v => String(v ?? '').trim();

function cfg(){
  return {
    url: clean(process.env.GREEN_API_URL).replace(/\/$/,''),
    id: clean(process.env.GREEN_INSTANCE_ID),
    token: clean(process.env.GREEN_API_TOKEN),
    secret: clean(process.env.POLL_SECRET)
  };
}

function allowed(request){
  const g=cfg();
  if(!g.secret) return true;
  const key=clean(new URL(request.url).searchParams.get('key'));
  return key===g.secret;
}

async function greenCall(method, options={}){
  const g=cfg();
  if(!g.url||!g.id||!g.token) throw new Error('GREEN API environment variables are missing');
  const r=await fetch(`${g.url}/waInstance${g.id}/${method}/${g.token}`,{
    cache:'no-store',
    ...options
  });
  const raw=await r.text();
  let data={};
  try{ data=raw?JSON.parse(raw):{}; }catch{ data={raw}; }
  if(!r.ok) throw new Error(data?.message||data?.error||`${method} HTTP ${r.status}`);
  return data;
}

export async function GET(request){
  if(!allowed(request)) return Response.json({ok:false,error:'Unauthorized'},{status:401});

  try{
    const origin=new URL(request.url).origin;
    const webhookUrl=`${origin}/api/webhook`;

    const green=await greenCall('setSettings',{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        webhookUrl,
        webhookUrlToken:'',
        incomingWebhook:'yes',
        outgoingWebhook:'no',
        outgoingMessageWebhook:'no',
        outgoingAPIMessageWebhook:'no',
        stateWebhook:'no'
      })
    });

    return Response.json({
      ok:true,
      mode:'Webhook Endpoint',
      webhookUrl,
      saveSettings:green?.saveSettings===true,
      important:'GREEN API reboots the instance when setSettings is called and says settings can take up to 5 minutes to apply. Do not call /api/http-mode or /api/poll.',
      next:`${origin}/api/webhook-check${cfg().secret?'?key=YOUR_POLL_SECRET':''}`
    },{headers:{'cache-control':'no-store'}});
  }catch(e){
    return Response.json({ok:false,error:String(e?.message||e)},{status:500});
  }
}
