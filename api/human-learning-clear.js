const DB_URL='https://meopp-8f1fa-default-rtdb.firebaseio.com';
const ROOT='cashTopAI';
const clean=v=>String(v??'').trim();
function allowed(request){
  const secret=clean(process.env.POLL_SECRET);
  if(!secret)return true;
  return clean(new URL(request.url).searchParams.get('key'))===secret;
}
async function fbDelete(path){
  const r=await fetch(`${DB_URL}/${path}.json`,{method:'DELETE'});
  if(!r.ok)throw new Error(`Firebase DELETE ${r.status}: ${await r.text()}`);
}
export async function POST(request){
  if(!allowed(request))return Response.json({ok:false,error:'Unauthorized'},{status:401});
  try{
    await Promise.all([
      fbDelete(`${ROOT}/humanLearning/examples`),
      fbDelete(`${ROOT}/humanLearning/pending`),
      fbDelete(`${ROOT}/humanLearning/importJob`),
      fbDelete(`${ROOT}/humanLearning/importMeta`)
    ]);
    return Response.json({
      ok:true,
      cleared:true,
      note:'تم حذف التعلم المستخرج من محادثات الزبائن وردود صاحب الحساب فقط. لم يتم حذف Q&A أو Knowledge أو ذاكرة المحادثات.'
    });
  }catch(e){return Response.json({ok:false,error:String(e?.message||e)},{status:500});}
}
