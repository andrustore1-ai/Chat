const clean=v=>String(v??'').trim();
function allowed(request){
  const secret=clean(process.env.POLL_SECRET);
  if(!secret)return true;
  return clean(new URL(request.url).searchParams.get('key'))===secret;
}
export async function GET(request){
  if(!allowed(request))return Response.json({ok:false,error:'Unauthorized'},{status:401});
  try{
    const origin=new URL(request.url).origin;
    const r=await fetch(`${origin}/api/webhook`,{
      method:'POST',
      headers:{'content-type':'application/json','user-agent':'CashTop-Webhook-SelfTest/1.0'},
      body:JSON.stringify({
        typeWebhook:'cashTopSelfTest',
        timestamp:Math.floor(Date.now()/1000),
        test:true
      })
    });
    const raw=await r.text();
    let data={}; try{data=raw?JSON.parse(raw):{}}catch{data={raw}};
    return Response.json({ok:r.ok,httpStatus:r.status,webhookResponse:data},{status:r.ok?200:500,headers:{'cache-control':'no-store'}});
  }catch(e){
    return Response.json({ok:false,error:String(e?.message||e)},{status:500});
  }
}
