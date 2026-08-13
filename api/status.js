const DB_URL='https://meopp-8f1fa-default-rtdb.firebaseio.com';

export async function GET(){
  try{
    const r=await fetch(`${DB_URL}/cashTopAI/qa.json`,{cache:'no-store'});
    if(!r.ok)throw new Error(`Firebase HTTP ${r.status}`);
    const qa=await r.json()||{};
    return Response.json({
      ok:true,
      firebase:true,
      qaCount:Object.keys(qa).length,
      greenConfigured:!!(process.env.GREEN_API_URL&&process.env.GREEN_INSTANCE_ID&&process.env.GREEN_API_TOKEN),
      groqEnvConfigured:!!process.env.GROQ_API_KEY,
      note:'Groq can also be read from cashTopAI/settings/groqKey.'
    });
  }catch(e){
    return Response.json({ok:false,error:String(e?.message||e)},{status:500});
  }
}
