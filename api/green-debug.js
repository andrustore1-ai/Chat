const clean = v => String(v ?? '').trim();

function cfg(){
  return {
    url: clean(process.env.GREEN_API_URL).replace(/\/$/,''),
    id: clean(process.env.GREEN_INSTANCE_ID),
    token: clean(process.env.GREEN_API_TOKEN)
  };
}

async function greenGet(method, query=''){
  const g=cfg();
  if(!g.url||!g.id||!g.token) throw new Error('GREEN API environment variables are missing');
  const r=await fetch(`${g.url}/waInstance${g.id}/${method}/${g.token}${query}`,{cache:'no-store'});
  const text=await r.text();
  let data={};
  try{data=text?JSON.parse(text):{}}catch{data={raw:text}}
  if(!r.ok)throw new Error(data?.message||data?.error||`${method} HTTP ${r.status}`);
  return data;
}

function maskChat(chatId){
  const raw=String(chatId||'');
  const p=raw.split('@')[0];
  if(!p)return '';
  const masked=p.length>4?'***'+p.slice(-4):p;
  return raw.includes('@')?masked+'@'+raw.split('@')[1]:masked;
}

function preview(m){
  const text =
    m?.textMessage ||
    m?.extendedTextMessage?.text ||
    m?.caption ||
    '';
  return String(text||'').slice(0,140);
}

export async function GET(){
  const out={
    ok:true,
    checkedAt:new Date().toISOString(),
    queue:null,
    incomingJournal:[],
    conclusions:[]
  };

  try{
    const q=await greenGet('getWebhooksCount');
    out.queue=q;
    const count=Number(q?.count ?? q?.['сount'] ?? 0);
    out.queueCount=count;
    if(count>0) out.conclusions.push(`يوجد ${count} إشعار/إشعارات عالقة في طابور GREEN API.`);
    else out.conclusions.push('طابور GREEN API حالياً فارغ.');
  }catch(e){
    out.queueError=String(e?.message||e);
    out.ok=false;
  }

  try{
    const list=await greenGet('lastIncomingMessages','?minutes=30');
    const arr=Array.isArray(list)?list:[];
    out.incomingJournal=arr.slice(0,12).map(m=>({
      timestamp:m.timestamp||null,
      typeMessage:m.typeMessage||'',
      chatId:maskChat(m.chatId||m.senderId||''),
      idMessage:m.idMessage||'',
      text:preview(m)
    }));
    out.incomingCount30m=arr.length;
    if(arr.length) out.conclusions.push(`GREEN API يرى ${arr.length} رسالة واردة خلال آخر 30 دقيقة.`);
    else out.conclusions.push('GREEN API لا يعرض رسائل واردة خلال آخر 30 دقيقة.');
  }catch(e){
    out.journalError=String(e?.message||e);
    out.ok=false;
  }

  try{
    const s=await greenGet('getSettings');
    out.settings={
      webhookUrl:s?.webhookUrl||'',
      incomingWebhook:s?.incomingWebhook||'',
      webhookUrlTokenConfigured:!!s?.webhookUrlToken
    };
  }catch(e){
    out.settingsError=String(e?.message||e);
  }

  return Response.json(out,{headers:{'cache-control':'no-store'}});
}
