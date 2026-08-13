const DB_URL = 'https://meopp-8f1fa-default-rtdb.firebaseio.com';
const ROOT = 'cashTopAI';

const clean = v => String(v ?? '').trim();
const nrm = s => String(s ?? '')
  .toLowerCase()
  .replace(/[\u064B-\u065F\u0670]/g,'')
  .replace(/[إأآا]/g,'ا').replace(/ى/g,'ي').replace(/ؤ/g,'و').replace(/ئ/g,'ي').replace(/ة/g,'ه').replace(/ـ/g,'')
  .replace(/[^\u0600-\u06FFa-z0-9\s:/.+\-]/g,' ')
  .replace(/\s+/g,' ')
  .trim();

const keySafe = s => String(s || 'unknown').replace(/[.#$\[\]\/]/g,'_').slice(0,180);
const arr = obj => Object.entries(obj || {}).map(([id,v]) => ({id,...(v||{})}));

function allowed(request){
  const url = new URL(request.url);
  const supplied = clean(url.searchParams.get('key'));
  const expected = clean(process.env.POLL_SECRET);
  return !!expected && supplied === expected;
}

function greenCfg(){
  return {
    url:clean(process.env.GREEN_API_URL).replace(/\/$/,''),
    id:clean(process.env.GREEN_INSTANCE_ID),
    token:clean(process.env.GREEN_API_TOKEN)
  };
}

async function greenGet(method,query=''){
  const g=greenCfg();
  if(!g.url||!g.id||!g.token) throw new Error('GREEN API environment variables are missing');
  const r=await fetch(`${g.url}/waInstance${g.id}/${method}/${g.token}${query}`,{cache:'no-store'});
  const text=await r.text();
  let data=null;
  try{data=text?JSON.parse(text):null}catch{data={raw:text}}
  if(!r.ok)throw new Error(data?.message||data?.error||`${method} HTTP ${r.status}`);
  return data;
}

async function greenPost(method,payload){
  const g=greenCfg();
  if(!g.url||!g.id||!g.token) throw new Error('GREEN API environment variables are missing');
  const r=await fetch(`${g.url}/waInstance${g.id}/${method}/${g.token}`,{
    method:'POST',
    headers:{'content-type':'application/json'},
    body:JSON.stringify(payload)
  });
  const text=await r.text();
  let data={};
  try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
  if(!r.ok)throw new Error(data?.message||data?.error||`${method} HTTP ${r.status}`);
  return data;
}

async function deleteNotification(receiptId){
  const g=greenCfg();
  const r=await fetch(`${g.url}/waInstance${g.id}/deleteNotification/${g.token}/${receiptId}`,{method:'DELETE'});
  const text=await r.text();
  let data={};
  try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
  if(!r.ok)throw new Error(data?.message||data?.error||`DeleteNotification HTTP ${r.status}`);
  return data;
}

async function fbGet(path){
  const r=await fetch(`${DB_URL}/${path}.json`,{cache:'no-store'});
  if(!r.ok)throw new Error(`Firebase GET ${r.status}: ${await r.text()}`);
  return await r.json();
}
async function fbPut(path,data){
  const r=await fetch(`${DB_URL}/${path}.json`,{
    method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify(data)
  });
  if(!r.ok)throw new Error(`Firebase PUT ${r.status}: ${await r.text()}`);
  return await r.json();
}
async function fbPatch(path,data){
  const r=await fetch(`${DB_URL}/${path}.json`,{
    method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(data)
  });
  if(!r.ok)throw new Error(`Firebase PATCH ${r.status}: ${await r.text()}`);
  return await r.json();
}

function incomingText(body){
  const md=body?.messageData||{};
  if(md.typeMessage==='textMessage')return clean(md.textMessageData?.textMessage);
  if(md.typeMessage==='extendedTextMessage')return clean(md.extendedTextMessageData?.text);
  if(md.textMessageData?.textMessage)return clean(md.textMessageData.textMessage);
  if(md.extendedTextMessageData?.text)return clean(md.extendedTextMessageData.text);
  return '';
}

function relevantQa(text,qa,limit=10){
  const q=nrm(text),words=q.split(' ').filter(w=>w.length>2);
  return qa.map(item=>{
    const question=nrm(item.question||'');
    const body=nrm([item.question,item.answer,item.normalized,...(Array.isArray(item.keywords)?item.keywords:[])].join(' '));
    let score=0;
    if(q&&q===question)score+=30;
    if(question&&q.includes(question))score+=18;
    if(question&&question.includes(q)&&q.length>3)score+=14;
    for(const w of words)if(body.includes(w))score++;
    return {score,question:item.question||'',answer:item.answer||'',keywords:item.keywords||[]};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,limit);
}

function relevantKnowledge(text,knowledge,limit=6){
  const words=nrm(text).split(' ').filter(w=>w.length>2),out=[];
  for(const k of knowledge){
    const chunks=Array.isArray(k.chunks)&&k.chunks.length?k.chunks:[{text:k.text||'',keywords:k.keywords||[]}];
    for(const ch of chunks){
      const body=nrm(`${ch.text||''} ${(ch.keywords||[]).join(' ')}`);
      let score=0;for(const w of words)if(body.includes(w))score++;
      if(score>0)out.push({score,text:String(ch.text||k.text||'').slice(0,1000)});
    }
  }
  return out.sort((a,b)=>b.score-a.score).slice(0,limit).map(x=>x.text);
}

async function history(chatId){
  try{
    const data=await fbGet(`${ROOT}/whatsappSessions/${keySafe(chatId)}/history`);
    return arr(data).sort((a,b)=>Number(a.at||0)-Number(b.at||0)).slice(-12)
      .map(x=>({role:x.role==='assistant'?'assistant':'user',content:String(x.content||'').slice(0,1200)}));
  }catch(e){
    console.warn('HISTORY_READ_FAILED',e.message);return [];
  }
}

async function saveHistory(chatId,role,content,senderName=''){
  try{
    const base=`${ROOT}/whatsappSessions/${keySafe(chatId)}`;
    await fbPatch(base,{chatId,senderName:senderName||'',lastSeenAt:Date.now()});
    const id=`${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
    await fbPut(`${base}/history/${id}`,{role,content:String(content||'').slice(0,2000),at:Date.now()});
  }catch(e){console.warn('HISTORY_WRITE_FAILED',e.message)}
}

async function processed(idMessage){
  if(!idMessage)return false;
  try{return !!(await fbGet(`${ROOT}/whatsappProcessed/${keySafe(idMessage)}`))}
  catch(e){console.warn('PROCESSED_READ_FAILED',e.message);return false}
}
async function markProcessed(idMessage,chatId){
  if(!idMessage)return;
  try{await fbPut(`${ROOT}/whatsappProcessed/${keySafe(idMessage)}`,{chatId,at:Date.now()})}
  catch(e){console.warn('PROCESSED_WRITE_FAILED',e.message)}
}

async function botData(){
  const [s,q,k]=await Promise.all([
    fbGet(`${ROOT}/settings`),
    fbGet(`${ROOT}/qa`),
    fbGet(`${ROOT}/knowledge`)
  ]);
  return {
    settings:s||{},
    qa:arr(q).filter(x=>x.active!==false),
    knowledge:arr(k)
  };
}

async function aiAnswer(text,hist,qaHits,knowledge,settings){
  const fallback=clean(settings?.whatsappFallback)||
    'حالياً ما عندي معلومة مؤكدة عن هذا السؤال. اكتب سؤالك بطريقة ثانية أو تواصل مع الدعم.';
  const best=qaHits[0];
  const key=clean(process.env.GROQ_API_KEY)||clean(settings?.groqKey);
  const model=clean(process.env.GROQ_MODEL)||clean(settings?.groqModel)||'llama-3.1-8b-instant';
  if(!key)return best?.answer||fallback;

  const context={
    businessName:settings?.businessName||'CASH TOP',
    whatsapp:settings?.whatsappNumber||'',
    qa:qaHits,
    knowledge,
    conversation:hist
  };

  const sys=`أنت موظف دعم واتساب عربي ذكي.
اعتمد فقط على الأسئلة والأجوبة والمعرفة والسياق المرسل.
افهم السؤال الحالي مع الرسائل السابقة لنفس العميل.
لا تخترع سعراً أو ميزة أو سياسة أو رقماً أو رابطاً غير موجود في السياق.
إذا لم توجد معلومة كافية أجب حرفياً:
${fallback}
اجعل الرد مختصراً وطبيعياً ومناسباً لواتساب.`;

  try{
    const r=await fetch('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST',
      headers:{'content-type':'application/json','authorization':`Bearer ${key}`},
      body:JSON.stringify({
        model,
        messages:[
          {role:'system',content:sys},
          {role:'user',content:`السياق:\n${JSON.stringify(context).slice(0,18000)}\n\nرسالة العميل:\n${text}`}
        ],
        temperature:.15,max_tokens:420
      })
    });
    const data=await r.json().catch(()=>({}));
    if(!r.ok){console.error('GROQ_FAILED',r.status,JSON.stringify(data));return best?.answer||fallback}
    return clean(data?.choices?.[0]?.message?.content)||best?.answer||fallback;
  }catch(e){console.error('GROQ_EXCEPTION',e.message);return best?.answer||fallback}
}

async function processOne(note,dataCache){
  const receiptId=note?.receiptId;
  const body=note?.body||{};
  if(!receiptId)return {kind:'empty'};

  // إشعارات أخرى لا نحتاجها: احذفها حتى لا تسد الطابور.
  if(body.typeWebhook!=='incomingMessageReceived'){
    await deleteNotification(receiptId);
    return {kind:'ignored',typeWebhook:body.typeWebhook||'unknown'};
  }

  const chatId=clean(body?.senderData?.chatId||body?.senderData?.sender);
  const senderName=clean(body?.senderData?.senderName||body?.senderData?.senderContactName);
  const idMessage=clean(body?.idMessage);
  const text=incomingText(body);

  if(!chatId || chatId.endsWith('@g.us') || !text){
    await deleteNotification(receiptId);
    return {kind:'ignored',reason:!chatId?'no_chat':chatId.endsWith('@g.us')?'group':'non_text'};
  }

  if(await processed(idMessage)){
    await deleteNotification(receiptId);
    return {kind:'duplicate',chatId};
  }

  const {settings,qa,knowledge}=dataCache;
  const hist=await history(chatId);
  const qaHits=relevantQa(text,qa);
  const knowledgeHits=relevantKnowledge(text,knowledge);
  const answer=await aiAnswer(text,[...hist,{role:'user',content:text}].slice(-13),qaHits,knowledgeHits,settings);

  // الإرسال أولاً. إذا فشل، لا نحذف Notification ليُعاد المحاولة في التشغيل القادم.
  const sent=await greenPost('sendMessage',{chatId,message:answer});

  await Promise.all([
    saveHistory(chatId,'user',text,senderName),
    saveHistory(chatId,'assistant',answer,senderName),
    markProcessed(idMessage,chatId)
  ]);

  await deleteNotification(receiptId);

  return {
    kind:'replied',
    chatId:chatId.replace(/^(.{0,3}).*(.{4}@)/,'$1***$2'),
    input:text.slice(0,80),
    output:answer.slice(0,120),
    sentId:sent?.idMessage||null
  };
}

export async function GET(request){
  if(!allowed(request))return Response.json({ok:false,error:'Unauthorized'}, {status:401});

  const started=Date.now();
  const results=[];
  let dataCache=null;

  try{
    // اسحب حتى 10 إشعارات في الاستدعاء الواحد.
    for(let i=0;i<10;i++){
      const note=await greenGet('receiveNotification','?receiveTimeout=1');
      if(!note || !note.receiptId){
        if(i===0)results.push({kind:'empty'});
        break;
      }

      if(!dataCache && note?.body?.typeWebhook==='incomingMessageReceived'){
        dataCache=await botData();
      }

      try{
        const r=await processOne(note,dataCache || {settings:{},qa:[],knowledge:[]});
        results.push(r);
      }catch(e){
        console.error('PROCESS_ONE_FAILED',e?.stack||e?.message||String(e));
        results.push({kind:'error',error:String(e?.message||e),receiptId:note?.receiptId});
        // لا نحذف الإشعار عند خطأ الرد.
        break;
      }
    }

    const replied=results.filter(x=>x.kind==='replied').length;
    return Response.json({
      ok:true,
      mode:'ReceiveNotification',
      replied,
      processed:results.length,
      results,
      ms:Date.now()-started
    },{headers:{'cache-control':'no-store'}});
  }catch(e){
    console.error('POLL_FATAL',e?.stack||e?.message||String(e));
    return Response.json({ok:false,error:String(e?.message||e),results},{status:500});
  }
}
