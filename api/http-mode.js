const clean=v=>String(v??'').trim();

function allowed(request){
  const url=new URL(request.url);
  const supplied=clean(url.searchParams.get('key'));
  const expected=clean(process.env.POLL_SECRET);
  return !!expected && supplied===expected;
}
function cfg(){
  return {
    url:clean(process.env.GREEN_API_URL).replace(/\/$/,''),
    id:clean(process.env.GREEN_INSTANCE_ID),
    token:clean(process.env.GREEN_API_TOKEN)
  };
}
export async function GET(request){
  if(!allowed(request))return Response.json({ok:false,error:'Unauthorized'},{status:401});
  const g=cfg();
  if(!g.url||!g.id||!g.token)return Response.json({ok:false,error:'GREEN API environment variables are missing'},{status:400});
  try{
    const r=await fetch(`${g.url}/waInstance${g.id}/setSettings/${g.token}`,{
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        webhookUrl:'',
        incomingWebhook:'yes',
        outgoingWebhook:'no',
        outgoingMessageWebhook:'no',
        outgoingAPIMessageWebhook:'no'
      })
    });
    const text=await r.text();
    let data={};try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
    if(!r.ok)throw new Error(data?.message||data?.error||`GREEN API HTTP ${r.status}`);
    return Response.json({
      ok:true,
      mode:'ReceiveNotification',
      webhookUrl:'',
      incomingWebhook:'yes',
      green:data,
      note:'انتظر تطبيق إعدادات GREEN API ثم استعمل /api/poll.'
    });
  }catch(e){
    return Response.json({ok:false,error:String(e?.message||e)},{status:500});
  }
}
