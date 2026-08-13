export const maxDuration = 60;

const DB_URL='https://meopp-8f1fa-default-rtdb.firebaseio.com';
const ROOT='cashTopAI';
const clean=v=>String(v??'').trim();
const keySafe=s=>String(s||'unknown').replace(/[.#$\[\]\/]/g,'_').slice(0,180);

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
async function greenGet(method,query=''){
  const g=cfg();
  const r=await fetch(`${g.url}/waInstance${g.id}/${method}/${g.token}${query}`,{cache:'no-store'});
  const raw=await r.text(); let data={}; try{data=raw?JSON.parse(raw):{}}catch{data={raw}};
  if(!r.ok) throw new Error(data?.message||data?.error||`${method} HTTP ${r.status}`);
  return data;
}
async function greenPost(method,payload){
  const g=cfg();
  const r=await fetch(`${g.url}/waInstance${g.id}/${method}/${g.token}`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload),cache:'no-store'
  });
  const raw=await r.text(); let data={}; try{data=raw?JSON.parse(raw):{}}catch{data={raw}};
  if(!r.ok) throw new Error(data?.message||data?.error||`${method} HTTP ${r.status}`);
  return data;
}
async function fbGet(path){
  const r=await fetch(`${DB_URL}/${path}.json`,{cache:'no-store'});
  if(!r.ok) throw new Error(`Firebase GET ${r.status}`);
  return await r.json();
}
async function fbPut(path,data){
  const r=await fetch(`${DB_URL}/${path}.json`,{
    method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(data)
  });
  if(!r.ok) throw new Error(`Firebase PUT ${r.status}: ${await r.text()}`);
  return await r.json();
}
async function fbPatch(path,data){
  const r=await fetch(`${DB_URL}/${path}.json`,{
    method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(data)
  });
  if(!r.ok) throw new Error(`Firebase PATCH ${r.status}: ${await r.text()}`);
  return await r.json();
}

function textOf(m){
  if(!m)return '';
  if(m.typeMessage==='textMessage'||m.typeMessage==='extendedTextMessage')
    return clean(m.textMessage||m.extendedTextMessage?.text);
  if(m.typeMessage==='quotedMessage')
    return clean(m.textMessage||m.extendedTextMessage?.text);
  return '';
}

function pairsFromHistory(history,chatId,chatName=''){
  const messages=[...(Array.isArray(history)?history:[])].sort((a,b)=>Number(a.timestamp||0)-Number(b.timestamp||0));
  const out=[];
  let incoming=[];
  let manual=[];

  function flush(){
    if(!incoming.length || !manual.length){ incoming=[]; manual=[]; return; }
    const question=incoming.map(x=>x.text).filter(Boolean).join('\n').slice(0,2500);
    const answer=manual.map(x=>x.text).filter(Boolean).join('\n').slice(0,3500);
    if(question && answer){
      const first=incoming[0], last=manual[manual.length-1];
      const id=keySafe(`hist_${first.id||first.ts}_${last.id||last.ts}`);
      out.push([id,{
        question,
        answer,
        chatId,
        customerName:chatName||'',
        incomingIdMessage:first.id||'',
        ownerMessageIds:manual.map(x=>x.id).filter(Boolean).slice(-30),
        source:'owner_phone',
        imported:true,
        at:Number(last.ts||0)*1000||Date.now()
      }]);
    }
    incoming=[]; manual=[];
  }

  for(const m of messages){
    const text=textOf(m);
    if(!text)continue;

    if(m.type==='incoming'){
      if(manual.length) flush();
      incoming.push({text,id:m.idMessage||'',ts:m.timestamp||0});
      continue;
    }

    if(m.type==='outgoing'){
      // لا نتعلم من رسائل البوت المرسلة عبر API.
      if(m.sendByApi===true) continue;
      if(incoming.length) manual.push({text,id:m.idMessage||'',ts:m.timestamp||0});
    }
  }
  flush();
  return out;
}

async function startImport(u){
  // بدون count: نطلب قائمة المحادثات التي ترجعها GREEN API للحساب.
  const chats=await greenGet('getChats');
  const users=(Array.isArray(chats)?chats:[])
    .filter(c=>c?.type==='user' && String(c?.id||'').includes('@'))
    .map(c=>({id:c.id,name:c.name||''}));

  const messageLimit=Math.min(2000,Math.max(50,Number(u.searchParams.get('messages')||500)));

  const job={
    status:users.length?'running':'done',
    chats:users,
    totalChats:users.length,
    nextIndex:0,
    processedChats:0,
    importedPairs:0,
    messageLimit,
    startedAt:Date.now(),
    updatedAt:Date.now(),
    finishedAt:users.length?null:Date.now(),
    errors:0
  };

  await fbPut(`${ROOT}/humanLearning/importJob`,job);
  await fbPatch(`${ROOT}/humanLearning/importMeta`,{
    lastImportStartedAt:Date.now(),
    requestedAllChats:true,
    availableChats:users.length,
    messageLimit
  });

  return {
    ok:true,
    action:'start',
    totalChats:users.length,
    messageLimit,
    note:'Queued all personal chats returned by GREEN API. API/bot replies are excluded.'
  };
}

async function runBatch(u){
  const job=await fbGet(`${ROOT}/humanLearning/importJob`);
  if(!job || !Array.isArray(job.chats)){
    return {ok:false,error:'No import job. Start import first.'};
  }

  if(job.status==='done' || Number(job.nextIndex||0)>=Number(job.totalChats||0)){
    return {
      ok:true,action:'batch',done:true,
      totalChats:Number(job.totalChats||0),
      processedChats:Number(job.processedChats||0),
      importedPairs:Number(job.importedPairs||0),
      errors:Number(job.errors||0),
      progress:100
    };
  }

  const started=Date.now();
  const batchSize=Math.min(8,Math.max(1,Number(u.searchParams.get('batch')||5)));
  const start=Number(job.nextIndex||0);
  const batch=job.chats.slice(start,start+batchSize);
  const messageLimit=Math.min(2000,Math.max(50,Number(job.messageLimit||500)));

  const got=await Promise.all(batch.map(async chat=>{
    try{
      const history=await greenPost('getChatHistory',{chatId:chat.id,count:messageLimit});
      const pairs=pairsFromHistory(history,chat.id,chat.name||'');
      return {chat,pairs,error:null};
    }catch(e){
      return {chat,pairs:[],error:String(e?.message||e)};
    }
  }));

  const allPairs={};
  let batchErrors=0;
  const details=[];

  for(const item of got){
    for(const [id,data] of item.pairs) allPairs[id]=data;
    if(item.error)batchErrors++;
    details.push({
      chatId:item.chat.id,
      name:item.chat.name||'',
      pairs:item.pairs.length,
      error:item.error
    });
  }

  if(Object.keys(allPairs).length){
    await fbPatch(`${ROOT}/humanLearning/examples`,allPairs);
  }

  const newIndex=start+batch.length;
  const done=newIndex>=Number(job.totalChats||0);
  const importedPairs=Number(job.importedPairs||0)+Object.keys(allPairs).length;
  const processedChats=Number(job.processedChats||0)+batch.length;
  const errors=Number(job.errors||0)+batchErrors;

  const update={
    nextIndex:newIndex,
    processedChats,
    importedPairs,
    errors,
    updatedAt:Date.now(),
    status:done?'done':'running'
  };
  if(done) update.finishedAt=Date.now();

  await fbPatch(`${ROOT}/humanLearning/importJob`,update);
  await fbPatch(`${ROOT}/humanLearning/importMeta`,{
    lastImportAt:Date.now(),
    lastImportedPairs:importedPairs,
    lastChatsProcessed:processedChats,
    totalChats:Number(job.totalChats||0),
    errors,
    done
  });

  return {
    ok:true,
    action:'batch',
    done,
    totalChats:Number(job.totalChats||0),
    processedChats,
    importedPairs,
    errors,
    progress:Number(job.totalChats||0)
      ? Math.round((processedChats/Number(job.totalChats))*100)
      : 100,
    batch:details,
    ms:Date.now()-started
  };
}

async function status(){
  const job=await fbGet(`${ROOT}/humanLearning/importJob`).catch(()=>null);
  if(!job)return {ok:true,action:'status',exists:false};

  return {
    ok:true,
    action:'status',
    exists:true,
    status:job.status||'unknown',
    totalChats:Number(job.totalChats||0),
    processedChats:Number(job.processedChats||0),
    importedPairs:Number(job.importedPairs||0),
    errors:Number(job.errors||0),
    progress:Number(job.totalChats||0)
      ? Math.round((Number(job.processedChats||0)/Number(job.totalChats))*100)
      : 100,
    messageLimit:Number(job.messageLimit||0),
    startedAt:job.startedAt||null,
    finishedAt:job.finishedAt||null
  };
}

export async function GET(request){
  if(!allowed(request))return Response.json({ok:false,error:'Unauthorized'},{status:401});
  const u=new URL(request.url);
  const action=clean(u.searchParams.get('action')||'status').toLowerCase();

  try{
    let data;
    if(action==='start') data=await startImport(u);
    else if(action==='batch') data=await runBatch(u);
    else data=await status();

    return Response.json(data,{
      status:data?.ok===false?400:200,
      headers:{'cache-control':'no-store'}
    });
  }catch(e){
    return Response.json({ok:false,error:String(e?.message||e),action},{status:500});
  }
}
