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
const now = () => Date.now();

async function fbGet(path){
  const r = await fetch(`${DB_URL}/${path}.json`, {cache:'no-store'});
  if(!r.ok) throw new Error(`Firebase GET ${r.status}: ${await r.text()}`);
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

async function fbDelete(path){
  const r=await fetch(`${DB_URL}/${path}.json`,{method:'DELETE'});
  if(!r.ok) throw new Error(`Firebase DELETE ${r.status}: ${await r.text()}`);
  return true;
}

async function saveWebhookHealth(kind,data){
  try{ await fbPut(`${ROOT}/webhookHealth/${kind}`,{at:now(),...data}); }
  catch(e){ console.warn('WEBHOOK_HEALTH_WRITE_FAILED',kind,e.message); }
}

function getMessagePayload(body){
  const md=body?.messageData||{};
  let text=''; let selectionId=''; let selectionLabel='';

  if(md.typeMessage==='textMessage') text=clean(md.textMessageData?.textMessage);
  else if(md.typeMessage==='extendedTextMessage') text=clean(md.extendedTextMessageData?.text);
  else if(md.textMessageData?.textMessage) text=clean(md.textMessageData.textMessage);
  else if(md.extendedTextMessageData?.text) text=clean(md.extendedTextMessageData.text);

  const tb=md.templateButtonReplyMessage||md.templateButtonsReplyMessage;
  if(tb){
    selectionId=clean(tb.selectedId||tb.selectedButtonId);
    selectionLabel=clean(tb.selectedDisplayText||tb.selectedButtonText);
    text=selectionLabel||selectionId||text;
  }

  const lr=md.listResponseMessage;
  if(lr){
    selectionId=clean(lr.singleSelectReply||lr.selectedRowId);
    selectionLabel=clean(lr.title||lr.description);
    text=selectionLabel||selectionId||text;
  }

  const br=md.buttonsResponseMessage;
  if(br){
    selectionId=clean(br.selectedButtonId||br.buttonId);
    selectionLabel=clean(br.selectedDisplayText||br.selectedButtonText);
    text=selectionLabel||selectionId||text;
  }

  return {text,selectionId,selectionLabel,typeMessage:clean(md.typeMessage)};
}

function relevantQa(text,qa,limit=10){
  const q=nrm(text), words=q.split(' ').filter(w=>w.length>2);
  return qa.map(item=>{
    const question=nrm(item.question||'');
    const body=nrm([item.question,item.answer,item.normalized,...(Array.isArray(item.keywords)?item.keywords:[])].join(' '));
    let score=0;
    if(q && q===question)score+=30;
    if(question && q.includes(question))score+=18;
    if(question && question.includes(q) && q.length>3)score+=14;
    for(const w of words)if(body.includes(w))score++;
    return {score,question:item.question||'',answer:item.answer||'',keywords:item.keywords||[]};
  }).filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,limit);
}

function relevantHuman(text,examples,limit=10){
  const q=nrm(text), words=q.split(' ').filter(w=>w.length>2);
  return examples.map(item=>{
    const question=nrm(item.question||'');
    const body=nrm(`${item.question||''} ${item.answer||''}`);
    let score=0;
    if(q && q===question)score+=28;
    if(question && q.includes(question))score+=14;
    if(question && question.includes(q) && q.length>3)score+=12;
    for(const w of words) if(body.includes(w)) score++;
    return {
      score,
      question:String(item.question||'').slice(0,1200),
      answer:String(item.answer||'').slice(0,1600),
      source:item.source||'owner_phone',
      at:item.at||0
    };
  }).filter(x=>x.score>0 && x.question && x.answer)
    .sort((a,b)=>b.score-a.score || Number(b.at||0)-Number(a.at||0))
    .slice(0,limit);
}

function relevantKnowledge(text,knowledge,limit=6){
  const words=nrm(text).split(' ').filter(w=>w.length>2),out=[];
  for(const k of knowledge){
    const chunks=Array.isArray(k.chunks)&&k.chunks.length?k.chunks:[{text:k.text||'',keywords:k.keywords||[]}];
    for(const ch of chunks){
      const body=nrm(`${ch.text||''} ${(ch.keywords||[]).join(' ')}`);
      let score=0; for(const w of words)if(body.includes(w))score++;
      if(score>0)out.push({score,text:String(ch.text||k.text||'').slice(0,1000)});
    }
  }
  return out.sort((a,b)=>b.score-a.score).slice(0,limit).map(x=>x.text);
}


const GREETINGS = [
  'السلام عليكم','السلام عليكم ورحمه الله','السلام عليكم ورحمة الله','وعليكم السلام',
  'مرحبا','مرحبا بك','اهلا','اهلين','اهلا وسهلا','هلا','هلا والله','يا هلا','يا مرحبا',
  'صباح الخير','صباح النور','صباح الورد','صباح الفل','صباحك خير','صباحكم خير',
  'مساء الخير','مساء النور','مساء الورد','مساء الفل','مساءك خير','مساءكم خير',
  'سلام','هاي','هلو','hello','hi','hey','good morning','good afternoon','good evening'
].map(nrm);

function greetingKind(text){
  const q=nrm(text);
  if(!q)return '';
  if(q.includes('السلام عليكم')) return 'salam';
  if(q.includes('صباح')) return 'morning';
  if(q.includes('مساء')) return 'evening';
  if(GREETINGS.some(g=>q===g || (q.length<=28 && q.startsWith(g)))) return 'hello';
  return '';
}

function greetingReplies(kind,businessName='Cash Top'){
  if(kind==='salam') return [
    `وعليكم السلام ورحمة الله وبركاته 🌷 أهلاً وسهلاً بك في ${businessName}. كيف أقدر أخدمك؟`,
    `وعليكم السلام ورحمة الله وبركاته 🤍 نورت ${businessName}. شو بتحب تعرف؟`,
    `وعليكم السلام ورحمة الله 🌸 تفضل، كيف ممكن أساعدك؟`,
    `أهلاً وسهلاً، وعليكم السلام 🤍 أنا جاهز أخدمك.`
  ];
  if(kind==='morning') return [
    `صباح النور والورد 🌷 أهلاً في ${businessName}. كيف أقدر أساعدك؟`,
    `صباح الخير والسعادة ☀️ تفضل، أنا جاهز أساعدك.`,
    `صباح النور ☀️ نورتنا، شو بتحب تعرف؟`,
    `صباح الورد 🌷 تفضل، أنا معك.`
  ];
  if(kind==='evening') return [
    `مساء النور والورد 🌷 أهلاً في ${businessName}. كيف أقدر أساعدك؟`,
    `مساء الخير والسعادة ✨ تفضل، شو بتحب تعرف؟`,
    `مساء النور ✨ نورتنا، كيف أقدر أخدمك؟`,
    `مساء الورد 🌷 تفضل، أنا معك.`
  ];
  return [
    `أهلاً وسهلاً 🌷 نورت ${businessName}. كيف أقدر أساعدك؟`,
    `يا هلا ومرحبا 👋 تفضل، أنا جاهز أساعدك.`,
    `أهلاً فيك 🤍 شو بتحب تعرف؟`,
    `مرحبتين 🌷 تفضل، أنا معك.`
  ];
}

function courtesyKind(text){
  const q=nrm(text);
  if(!q)return '';
  if(/^(شكرا|شكرا لك|مشكور|يسلمو|تسلم|يعطيك العافيه|يعطيكم العافيه|thx|thanks|thank you)$/.test(q)) return 'thanks';
  if(/^(مع السلامه|باي|bye|تصبح على خير|في امان الله)$/.test(q)) return 'bye';
  if(/^(تمام|اوكي|اوك|ok|okay|تمام شكرا|خلص|خلاص)$/.test(q)) return 'ok';
  return '';
}

function courtesyReplies(kind){
  if(kind==='thanks') return ['العفو 🌷 بالخدمة دائماً.','تكرم 🤍 أي وقت أنا بالخدمة.'];
  if(kind==='bye') return ['مع السلامة 🌷 يومك سعيد.','في أمان الله 🤍 أهلاً وسهلاً فيك بأي وقت.'];
  return ['تمام 👍','تمام، بالخدمة 🌷'];
}

function isNoise(text){
  const raw=clean(text);
  if(!raw)return true;
  // نقاط/رموز/إيموجي فقط بدون أي حرف أو رقم.
  return !/[\p{L}\p{N}]/u.test(raw);
}

function recentAssistantTexts(history){
  return (Array.isArray(history)?history:[])
    .filter(x=>x?.role==='assistant' && clean(x?.content))
    .slice(-8).map(x=>nrm(x.content));
}

function chooseNotRepeated(options,history){
  const recent=new Set(recentAssistantTexts(history));
  return options.find(x=>!recent.has(nrm(x))) || options[0];
}

function avoidRepeatedPlan(plan,history,fallback){
  if(!plan?.text)return plan;
  const recent=recentAssistantTexts(history);
  if(!recent.includes(nrm(plan.text))) return plan;

  const fallbackAlts=[
    'ممكن توضحلي المقصود أكثر حتى أعطيك جواب دقيق؟',
    'إذا بتقصد نقطة ثانية بنفس الموضوع اكتبها مباشرة وأنا أكمل معك.',
    'المعلومة نفسها ما تغيّرت. إذا عندك تفصيل مختلف اذكره وأنا أجاوبك عليه.'
  ];
  const text=chooseNotRepeated(fallbackAlts,history);
  return {...plan,text,interaction:null};
}

async function safeRules(){
  try{
    const data=await fbGet(`${ROOT}/botRules`);
    return arr(data).filter(x=>x.active!==false && clean(x.text))
      .sort((a,b)=>Number(a.createdAt||0)-Number(b.createdAt||0))
      .slice(0,100);
  }catch(e){ console.warn('RULES_READ_FAILED',e.message); return []; }
}

function ruleSummary(rules){
  return (rules||[]).map(r=>({
    id:r.id,
    text:String(r.text||'').slice(0,1200),
    mediaUrl:clean(r.mediaMode)==='none'?'':clean(r.mediaUrl),
    mediaFileName:clean(r.mediaFileName),
    mediaMode:clean(r.mediaMode||'ai')
  }));
}

function automaticMediaRuleIds(rules,kind=''){
  const ids=[];
  for(const r of rules||[]){
    if(!clean(r.mediaUrl))continue;
    const mode=clean(r.mediaMode||'ai').toLowerCase();
    if(mode==='none')continue;
    if(mode==='always') ids.push(r.id);
    else if(mode==='greeting' && kind==='greeting') ids.push(r.id);
  }
  return ids.slice(0,2);
}

async function safeHistory(chatId){
  try{
    const data=await fbGet(`${ROOT}/whatsappSessions/${keySafe(chatId)}/history`);
    return arr(data).sort((a,b)=>Number(a.at||0)-Number(b.at||0)).slice(-12)
      .map(x=>({role:x.role==='assistant'?'assistant':'user',content:String(x.content||'').slice(0,1200)}));
  }catch(e){ console.warn('HISTORY_READ_FAILED',e.message); return []; }
}

async function safeHumanExamples(){
  try{
    const data=await fbGet(`${ROOT}/humanLearning/examples`);
    return arr(data).sort((a,b)=>Number(b.at||0)-Number(a.at||0)).slice(0,2000);
  }catch(e){ console.warn('HUMAN_EXAMPLES_READ_FAILED',e.message); return []; }
}

async function saveHistoryBestEffort(chatId,role,content,senderName=''){
  try{
    const base=`${ROOT}/whatsappSessions/${keySafe(chatId)}`;
    await fbPatch(base,{chatId,senderName:senderName||'',lastSeenAt:now()});
    const id=`${now()}_${Math.random().toString(36).slice(2,8)}`;
    await fbPut(`${base}/history/${id}`,{role,content:String(content||'').slice(0,2000),at:now()});
  }catch(e){ console.warn('HISTORY_WRITE_FAILED',e.message); }
}

async function rememberPendingCustomer(chatId,text,idMessage,senderName=''){
  try{
    await fbPut(`${ROOT}/humanLearning/pending/${keySafe(chatId)}`,{
      chatId,
      question:String(text||'').slice(0,2500),
      incomingIdMessage:idMessage||'',
      senderName:senderName||'',
      at:now()
    });
  }catch(e){ console.warn('PENDING_CUSTOMER_WRITE_FAILED',e.message); }
}

async function learnFromOwnerPhone(chatId,text,idMessage){
  if(!chatId || !text) return {learned:false,reason:'missing_data'};
  try{
    const pending=await fbGet(`${ROOT}/humanLearning/pending/${keySafe(chatId)}`);
    if(!pending?.question) return {learned:false,reason:'no_pending_customer'};
    if(now()-Number(pending.at||0) > 48*60*60*1000) return {learned:false,reason:'pending_too_old'};

    const pairKey=keySafe(pending.incomingIdMessage||`${chatId}_${pending.at}`);
    const path=`${ROOT}/humanLearning/examples/${pairKey}`;
    const existing=await fbGet(path).catch(()=>null);
    const previous=clean(existing?.answer);
    const nextAnswer=previous ? `${previous}\n${text}`.slice(0,3500) : String(text).slice(0,3500);

    await fbPut(path,{
      question:String(pending.question).slice(0,2500),
      answer:nextAnswer,
      chatId,
      customerName:pending.senderName||'',
      incomingIdMessage:pending.incomingIdMessage||'',
      ownerMessageIds:[...(Array.isArray(existing?.ownerMessageIds)?existing.ownerMessageIds:[]),idMessage].filter(Boolean).slice(-20),
      source:'owner_phone',
      imported:existing?.imported===true,
      at:now()
    });
    return {learned:true,pairKey};
  }catch(e){
    console.warn('LEARN_OWNER_FAILED',e.message);
    return {learned:false,reason:e.message};
  }
}

async function alreadyProcessed(idMessage){
  if(!idMessage)return false;
  try{ return !!(await fbGet(`${ROOT}/whatsappProcessed/${keySafe(idMessage)}`)); }
  catch(e){ console.warn('PROCESSED_READ_FAILED',e.message); return false; }
}
async function markProcessedBestEffort(idMessage,chatId){
  if(!idMessage)return;
  try{ await fbPut(`${ROOT}/whatsappProcessed/${keySafe(idMessage)}`,{chatId,at:now()}); }
  catch(e){ console.warn('PROCESSED_WRITE_FAILED',e.message); }
}

function greenCfg(){
  return {
    url:clean(process.env.GREEN_API_URL).replace(/\/$/,''),
    id:clean(process.env.GREEN_INSTANCE_ID),
    token:clean(process.env.GREEN_API_TOKEN)
  };
}

async function greenPost(method,payload){
  const g=greenCfg();
  if(!g.url||!g.id||!g.token) throw new Error('GREEN API environment variables are missing');
  const r=await fetch(`${g.url}/waInstance${g.id}/${method}/${g.token}`,{
    method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(payload)
  });
  const raw=await r.text();
  let data={}; try{data=raw?JSON.parse(raw):{}}catch{data={raw}};
  if(!r.ok){
    const err=new Error(data?.message||data?.error||`${method} GREEN API ${r.status}`);
    err.status=r.status; err.data=data; throw err;
  }
  return data;
}

async function sendText(chatId,message){
  console.log('SEND_TEXT',chatId,String(message).slice(0,100));
  return greenPost('sendMessage',{chatId,message});
}

function sanitizeOptions(interaction){
  if(!interaction || typeof interaction!=='object') return null;
  let type=clean(interaction.type).toLowerCase();
  if(!['buttons','list'].includes(type)) return null;
  let options=Array.isArray(interaction.options)?interaction.options:[];
  options=options.map((o,i)=>({
    id:keySafe(o?.id||`opt_${i+1}`).slice(0,40),
    label:clean(o?.label||o?.text||o?.value).slice(0,type==='buttons'?25:24),
    value:clean(o?.value||o?.label||o?.text).slice(0,500)
  })).filter(o=>o.label&&o.value);
  if(options.length<2) return null;
  if(type==='buttons' && options.length>3) type='list';
  if(type==='buttons') options=options.slice(0,3);
  else options=options.slice(0,10);
  return {type,options};
}

function normalizePlan(raw,fallback,rules=[]){
  if(!raw || typeof raw!=='object') return {text:fallback,interaction:null,mediaRuleIds:[]};
  const text=clean(raw.text||raw.reply||raw.answer)||fallback;
  const allowed=new Set((rules||[]).filter(r=>clean(r.mediaUrl)&&clean(r.mediaMode||'ai')!=='none').map(r=>String(r.id)));
  const mediaRuleIds=(Array.isArray(raw.mediaRuleIds)?raw.mediaRuleIds:[])
    .map(String).filter(id=>allowed.has(id)).slice(0,2);
  return {text,interaction:sanitizeOptions(raw.interaction),mediaRuleIds};
}

function parseJsonReply(content){
  const s=clean(content);
  if(!s)return null;
  try{return JSON.parse(s)}catch{}
  const a=s.indexOf('{'), b=s.lastIndexOf('}');
  if(a>=0&&b>a){try{return JSON.parse(s.slice(a,b+1))}catch{}}
  return null;
}

async function getBotData(){
  const [s,q,k,h,rules]=await Promise.all([
    fbGet(`${ROOT}/settings`).catch(()=>({})),
    fbGet(`${ROOT}/qa`).catch(()=>({})),
    fbGet(`${ROOT}/knowledge`).catch(()=>({})),
    safeHumanExamples(),
    safeRules()
  ]);
  return {
    settings:s||{},
    qa:arr(q).filter(x=>x.active!==false),
    knowledge:arr(k),
    humanExamples:h,
    rules
  };
}

async function answerAI(text,history,qaHits,humanHits,knowledge,settings,rules=[]){
  const fallback=clean(settings?.whatsappFallback)||
    'حالياً ما عندي معلومة مؤكدة عن هذا السؤال. اكتب سؤالك بطريقة ثانية أو تواصل مع الدعم.';
  const bestQa=qaHits[0];
  const bestHuman=humanHits[0];

  const key=clean(process.env.GROQ_API_KEY)||clean(settings?.groqKey);
  const model=clean(process.env.GROQ_MODEL)||clean(settings?.groqModel)||'llama-3.1-8b-instant';

  if(!key){
    return {text:bestQa?.answer||bestHuman?.answer||fallback,interaction:null,mediaRuleIds:automaticMediaRuleIds(rules,'normal')};
  }

  const context={
    businessName:settings?.businessName||'CASH TOP',
    whatsapp:settings?.whatsappNumber||'',
    qa:qaHits,
    humanExamples:humanHits,
    knowledge,
    managerRules:ruleSummary(rules),
    conversation:history
  };

  const sys=`أنت موظف دعم واتساب عربي ذكي لمتجر/برنامج Cash Top.
مصادر الحقائق مرتبة بالأولوية:
1) qa: قاعدة الأسئلة والأجوبة الرسمية. إذا فيها جواب واضح استخدمه أولاً.
2) humanExamples: أمثلة حقيقية من محادثات الزبائن وردود صاحب المتجر اليدوية من الهاتف. إذا لم تجد جواباً كافياً في qa، استنبط جواباً دقيقاً من هذه الأمثلة فقط.
3) knowledge: معرفة إضافية موثوقة.
conversation تستخدم فقط لفهم سياق كلام نفس العميل والضمائر والمتابعة، ولا تعتبر ردود assistant السابقة مصدراً للحقائق.
managerRules هي قواعد المدير وهي ملزمة في الأسلوب والسلوك طالما لا تجبرك على اختلاق معلومة غير موجودة. طبّقها كلها معاً.
إذا كانت قاعدة تطلب أن تكون إيجابياً تجاه البرنامج، حافظ على أسلوب مهني وإيجابي ولا تهاجم البرنامج، لكن لا تنكر حقيقة مؤكدة موجودة في المصادر.
ممنوع اعتبار أي رد سابق للبوت مادة تعليمية أو حقيقة جديدة.
لا تكرر نفس السؤال على العميل إذا سبق أن أجاب عنه في conversation.
لا تكرر نفس الرد حرفياً إذا سبق أن أرسلته؛ افهم متابعة العميل واختصر أو أكمل من النقطة السابقة.
الرسائل القصيرة مثل "بس؟" و"طيب؟" و"كيف؟" تعامل معها كمتابعة للسياق السابق، وليس كسؤال منفصل.
لا تخترع سعراً أو ميزة أو سياسة أو رقم أو رابط غير موجود بالمصادر.
إذا لم توجد معلومة كافية أجب بالنص التالي:
${fallback}

أخرج JSON صالحاً فقط بهذا الشكل:
{"text":"الرد النهائي","interaction":null,"mediaRuleIds":[]}
أو عند وجود اختيار طبيعي ومفيد فعلاً:
{"text":"السؤال/الرد قبل الاختيار","interaction":{"type":"buttons","options":[{"id":"opt_1","label":"نص قصير","value":"المعنى الكامل للاختيار"}]},"mediaRuleIds":[]}
mediaRuleIds: إذا كانت إحدى managerRules تحتوي mediaUrl وكانت القاعدة نفسها تطلب إرسال هذا الملصق/الصورة في هذا السياق، ضع معرف القاعدة فقط. لا تخترع روابط ولا معرفات.
قواعد التفاعل:
- استخدم buttons فقط إذا كان العميل يحتاج اختياراً واضحاً من 2 إلى 3 خيارات.
- استخدم list فقط إذا كان هناك 4 إلى 10 خيارات واضحة وموجودة في المصادر.
- لا تضف أزراراً لمجرد الزينة، ولا تخترع خيارات.
- اسم زر buttons لا يتجاوز 25 حرفاً، وعناصر list لا تتجاوز 24 حرفاً.
- الرد مختصر وطبيعي ومناسب لواتساب.`;

  try{
    const r=await fetch('https://api.groq.com/openai/v1/chat/completions',{
      method:'POST',
      headers:{'content-type':'application/json','authorization':`Bearer ${key}`},
      body:JSON.stringify({
        model,
        messages:[
          {role:'system',content:sys},
          {role:'user',content:`السياق الموثوق:\n${JSON.stringify(context).slice(0,22000)}\n\nرسالة العميل الحالية:\n${text}`}
        ],
        temperature:.1,
        max_tokens:650
      })
    });
    const data=await r.json().catch(()=>({}));
    if(!r.ok){
      console.error('GROQ_FAILED',r.status,JSON.stringify(data));
      return {text:bestQa?.answer||bestHuman?.answer||fallback,interaction:null,mediaRuleIds:automaticMediaRuleIds(rules,'normal')};
    }
    const content=clean(data?.choices?.[0]?.message?.content);
    const parsed=parseJsonReply(content);
    if(parsed) return normalizePlan(parsed,bestQa?.answer||bestHuman?.answer||fallback,rules);
    return {text:content||bestQa?.answer||bestHuman?.answer||fallback,interaction:null,mediaRuleIds:automaticMediaRuleIds(rules,'normal')};
  }catch(e){
    console.error('GROQ_EXCEPTION',e.message);
    return {text:bestQa?.answer||bestHuman?.answer||fallback,interaction:null,mediaRuleIds:automaticMediaRuleIds(rules,'normal')};
  }
}

async function saveLastInteraction(chatId,interaction,sentType){
  try{
    if(!interaction){
      await fbPut(`${ROOT}/whatsappSessions/${keySafe(chatId)}/lastInteraction`,null);
      return;
    }
    await fbPut(`${ROOT}/whatsappSessions/${keySafe(chatId)}/lastInteraction`,{
      type:sentType||interaction.type,
      options:interaction.options,
      at:now()
    });
  }catch(e){ console.warn('INTERACTION_SAVE_FAILED',e.message); }
}

async function resolveIncomingChoice(chatId,payload){
  let text=payload.text;
  try{
    const interaction=await fbGet(`${ROOT}/whatsappSessions/${keySafe(chatId)}/lastInteraction`);
    if(!interaction?.options || now()-Number(interaction.at||0)>6*60*60*1000) return text;
    const opts=Array.isArray(interaction.options)?interaction.options:[];
    let found=null;
    if(payload.selectionId) found=opts.find(o=>String(o.id)===String(payload.selectionId));
    if(!found && /^\d{1,2}$/.test(clean(text))){
      const idx=Number(clean(text))-1;
      if(idx>=0&&idx<opts.length) found=opts[idx];
    }
    if(!found && payload.selectionLabel) found=opts.find(o=>nrm(o.label)===nrm(payload.selectionLabel));
    if(found){
      await saveLastInteraction(chatId,null,'');
      return clean(found.value)||clean(found.label)||text;
    }
  }catch(e){ console.warn('INTERACTION_RESOLVE_FAILED',e.message); }
  return text;
}

function numberedMenu(text,options){
  return `${text}\n\n${options.map((o,i)=>`${i+1}) ${o.label}`).join('\n')}\n\nاكتب رقم الخيار.`;
}


function fileNameFromRule(rule){
  const explicit=clean(rule?.mediaFileName);
  if(explicit)return explicit.slice(0,120);
  try{
    const u=new URL(clean(rule?.mediaUrl));
    const name=decodeURIComponent(u.pathname.split('/').pop()||'').trim();
    if(name && name.includes('.'))return name.slice(0,120);
  }catch{}
  return 'cash-top-media.webp';
}

async function sendRuleMedia(chatId,plan,rules=[]){
  const wanted=new Set([...(plan?.mediaRuleIds||[]),...automaticMediaRuleIds(rules,'normal')].map(String));
  const sent=[];
  for(const rule of (rules||[])){
    if(!wanted.has(String(rule.id)) || !clean(rule.mediaUrl))continue;
    try{
      const r=await greenPost('sendFileByUrl',{
        chatId,
        urlFile:clean(rule.mediaUrl),
        fileName:fileNameFromRule(rule),
        caption:''
      });
      sent.push({ruleId:rule.id,idMessage:r?.idMessage||''});
    }catch(e){
      console.warn('RULE_MEDIA_FAILED',rule.id,e.status||'',e.message);
    }
    if(sent.length>=2)break;
  }
  return sent;
}

async function sendPlan(chatId,plan,rules=[]){
  const interaction=plan.interaction;
  if(!interaction){
    const sent=await sendText(chatId,plan.text);
    await saveLastInteraction(chatId,null,'');
    const media=await sendRuleMedia(chatId,plan,rules);
    return {sent,mode:'text',media};
  }

  if(interaction.type==='buttons'){
    try{
      const sent=await greenPost('sendInteractiveButtonsReply',{
        chatId,
        header:'',
        body:plan.text,
        footer:'Cash Top',
        buttons:interaction.options.map(o=>({buttonId:o.id,buttonText:o.label}))
      });
      await saveLastInteraction(chatId,interaction,'buttons');
      const media=await sendRuleMedia(chatId,plan,rules);
      return {sent,mode:'buttons',media};
    }catch(e){
      console.warn('BUTTONS_FAILED_FALLBACK_TEXT',e.status||'',e.message);
      const sent=await sendText(chatId,numberedMenu(plan.text,interaction.options));
      await saveLastInteraction(chatId,interaction,'numbered');
      const media=await sendRuleMedia(chatId,plan,rules);
      return {sent,mode:'numbered_fallback',media};
    }
  }

  if(interaction.type==='list'){
    try{
      const sent=await greenPost('sendListMessage',{
        chatId,
        message:plan.text,
        title:'Cash Top',
        footer:'اختر الخيار المناسب',
        buttonText:'عرض الخيارات',
        sections:[{title:'الخيارات',rows:interaction.options.map(o=>({title:o.label,rowId:o.id}))}]
      });
      await saveLastInteraction(chatId,interaction,'list');
      const media=await sendRuleMedia(chatId,plan,rules);
      return {sent,mode:'list',media};
    }catch(e){
      console.warn('LIST_FAILED_FALLBACK_TEXT',e.status||'',e.message);
      const sent=await sendText(chatId,numberedMenu(plan.text,interaction.options));
      await saveLastInteraction(chatId,interaction,'numbered');
      const media=await sendRuleMedia(chatId,plan,rules);
      return {sent,mode:'numbered_fallback',media};
    }
  }

  const sent=await sendText(chatId,plan.text);
  const media=await sendRuleMedia(chatId,plan,rules);
  return {sent,mode:'text',media};
}

export async function GET(){
  return Response.json({
    ok:true,
    service:'Cash Top WhatsApp AI',
    version:'5-rules-greetings-no-repeat',
    endpoint:'/api/webhook',
    accepts:'POST',
    learning:'owner phone replies only; API replies are excluded',
    interactions:'buttons + list + manager rules + optional rule media + no-repeat guard'
  },{headers:{'cache-control':'no-store'}});
}

export async function POST(request){
  const started=now();
  try{
    const raw=await request.text();
    let body={};
    try{ body=raw ? JSON.parse(raw) : {}; }
    catch{
      await saveWebhookHealth('lastReceived',{ok:false,reason:'bad_json',size:raw.length,preview:raw.slice(0,500)});
      return Response.json({ok:true,ignored:'bad_json'});
    }

    const typeWebhook=clean(body?.typeWebhook);
    const chatId=clean(body?.senderData?.chatId||body?.senderData?.sender);
    const senderName=clean(body?.senderData?.senderName||body?.senderData?.senderContactName||body?.senderData?.chatName);
    const idMessage=clean(body?.idMessage);
    const payload=getMessagePayload(body);

    console.log('WEBHOOK_RECEIVED',typeWebhook,idMessage||'');

    await saveWebhookHealth('lastReceived',{
      ok:true,typeWebhook,idMessage:idMessage||'',chatId:chatId||'',
      typeMessage:payload.typeMessage,textPreview:payload.text.slice(0,160),
      userAgent:request.headers.get('user-agent')||'',contentType:request.headers.get('content-type')||''
    });

    // نتعلم فقط من الرسائل التي يرسلها صاحب الحساب من الهاتف يدوياً.
    if(typeWebhook==='outgoingMessageReceived'){
      if(!chatId || chatId.endsWith('@g.us') || !payload.text) return Response.json({ok:true,ignored:'owner_non_text_or_group'});
      const learning=await learnFromOwnerPhone(chatId,payload.text,idMessage);
      await saveWebhookHealth('lastHumanLearning',{chatId,idMessage,textPreview:payload.text.slice(0,160),...learning});
      return Response.json({ok:true,ownerMessage:true,...learning});
    }

    // حتى لو تم تفعيل outgoingAPIMessageWebhook بالخطأ، لا نتعلم ولا نرد على رسائل البوت.
    if(typeWebhook==='outgoingAPIMessageReceived'){
      return Response.json({ok:true,ignored:'api_outgoing'});
    }

    if(typeWebhook!=='incomingMessageReceived') return Response.json({ok:true,ignored:'webhook_type'});
    if(!chatId)return Response.json({ok:true,ignored:'no_chat'});
    if(chatId.endsWith('@g.us'))return Response.json({ok:true,ignored:'group'});
    if(!payload.text)return Response.json({ok:true,ignored:'non_text'});
    if(await alreadyProcessed(idMessage))return Response.json({ok:true,ignored:'duplicate'});

    const resolvedText=await resolveIncomingChoice(chatId,payload);

    // الرموز/النقاط وحدها لا تستحق رداً حتى لا يكرر البوت رسالة عامة.
    if(isNoise(resolvedText)){
      await markProcessedBestEffort(idMessage,chatId);
      return Response.json({ok:true,ignored:'noise'});
    }

    const [{settings,qa,knowledge,humanExamples,rules},history]=await Promise.all([
      getBotData(),safeHistory(chatId)
    ]);

    const businessName=clean(settings?.businessName)||'Cash Top';
    const gKind=greetingKind(resolvedText);
    const cKind=courtesyKind(resolvedText);
    let qaHits=[],humanHits=[],knowledgeHits=[],plan=null;

    // الترحيبات والمجاملات لا تدخل في قاعدة التعلم حتى لا تلوّث أمثلة الدعم.
    if(gKind){
      plan={
        text:chooseNotRepeated(greetingReplies(gKind,businessName),history),
        interaction:null,
        mediaRuleIds:automaticMediaRuleIds(rules,'greeting')
      };
    }else if(cKind){
      plan={
        text:chooseNotRepeated(courtesyReplies(cKind),history),
        interaction:null,
        mediaRuleIds:automaticMediaRuleIds(rules,'normal')
      };
    }else{
      // نخزن آخر سؤال الحقيقي للعميل؛ عندما يرد صاحب المتجر يدوياً نتعلم من رده هو.
      await rememberPendingCustomer(chatId,resolvedText,idMessage,senderName);

      qaHits=relevantQa(resolvedText,qa);
      humanHits=relevantHuman(resolvedText,humanExamples);
      knowledgeHits=relevantKnowledge(resolvedText,knowledge);
      plan=await answerAI(
        resolvedText,
        [...history,{role:'user',content:resolvedText}].slice(-13),
        qaHits,humanHits,knowledgeHits,settings,rules
      );
      plan=avoidRepeatedPlan(
        plan,history,
        clean(settings?.whatsappFallback)||'حالياً ما عندي معلومة مؤكدة عن هذا السؤال.'
      );
    }

    const delivery=await sendPlan(chatId,plan,rules);

    Promise.allSettled([
      saveHistoryBestEffort(chatId,'user',resolvedText,senderName),
      saveHistoryBestEffort(chatId,'assistant',plan.text,senderName),
      markProcessedBestEffort(idMessage,chatId)
    ]).catch(()=>{});

    const elapsed=now()-started;
    await saveWebhookHealth('lastSuccess',{
      chatId,incomingIdMessage:idMessage||'',outgoingIdMessage:delivery?.sent?.idMessage||'',
      ms:elapsed,replyMode:delivery.mode,qaHits:qaHits.length,humanHits:humanHits.length,rules:rules.length,mediaSent:delivery?.media?.length||0
    });

    return Response.json({
      ok:true,replied:true,idMessage:delivery?.sent?.idMessage||null,
      mode:delivery.mode,usedHumanExamples:humanHits.length,rulesApplied:rules.length,mediaSent:delivery?.media?.length||0,ms:elapsed
    });
  }catch(e){
    const message=String(e?.message||e);
    console.error('WEBHOOK_FATAL',e?.stack||message);
    await saveWebhookHealth('lastError',{error:message,ms:now()-started});
    return Response.json({ok:false,error:message},{status:500});
  }
}
