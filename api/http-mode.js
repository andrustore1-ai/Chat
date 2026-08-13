export async function GET(){
  return Response.json({
    ok:false,
    disabled:true,
    mode:'Webhook only',
    message:'HTTP polling mode is disabled. Use /api/webhook-on instead.'
  },{status:410,headers:{'cache-control':'no-store'}});
}
