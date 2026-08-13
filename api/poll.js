export async function GET(){
  return Response.json({
    ok:false,
    disabled:true,
    mode:'Webhook only',
    message:'Polling is disabled. Incoming messages must arrive by POST /api/webhook.'
  },{status:410,headers:{'cache-control':'no-store'}});
}
