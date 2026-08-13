const DB_URL = 'https://meopp-8f1fa-default-rtdb.firebaseio.com';
const ROOT = 'cashTopAI';

const clean = v => String(v ?? '').trim();

function greenCfg(){
  return {
    url: clean(process.env.GREEN_API_URL).replace(/\/$/,''),
    id: clean(process.env.GREEN_INSTANCE_ID),
    token: clean(process.env.GREEN_API_TOKEN)
  };
}

async function greenGet(method){
  const g = greenCfg();
  if(!g.url || !g.id || !g.token) throw new Error('متغيرات GREEN API غير مكتملة في Vercel');
  const r = await fetch(`${g.url}/waInstance${g.id}/${method}/${g.token}`, {cache:'no-store'});
  const text = await r.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {raw:text}; }
  if(!r.ok) throw new Error(data?.message || data?.error || `${method} HTTP ${r.status}`);
  return data;
}

async function firebaseGet(path){
  const r = await fetch(`${DB_URL}/${path}.json`, {cache:'no-store'});
  if(!r.ok) throw new Error(`Firebase HTTP ${r.status}`);
  return await r.json();
}

function maskPhone(v){
  const d = String(v || '').replace(/\D/g,'');
  if(!d) return '';
  return d.length <= 4 ? d : '***' + d.slice(-4);
}

export async function GET(request){
  const origin = new URL(request.url).origin;
  const expectedWebhook = `${origin}/api/webhook`;

  const result = {
    ok: true,
    checkedAt: new Date().toISOString(),
    expectedWebhook,
    environment: {
      greenApiUrl: !!process.env.GREEN_API_URL,
      greenInstanceId: !!process.env.GREEN_INSTANCE_ID,
      greenToken: !!process.env.GREEN_API_TOKEN,
      groqEnv: !!process.env.GROQ_API_KEY
    },
    checks: {},
    green: {},
    firebase: {},
    recommendations: []
  };

  // Firebase + Groq in Firebase
  try{
    const [qaRaw, settings] = await Promise.all([
      firebaseGet(`${ROOT}/qa`),
      firebaseGet(`${ROOT}/settings`)
    ]);
    result.firebase.connected = true;
    result.firebase.qaCount = Object.keys(qaRaw || {}).length;
    result.firebase.groqInFirebase = !!clean(settings?.groqKey);
    result.checks.firebase = true;
    result.checks.groq = !!process.env.GROQ_API_KEY || !!clean(settings?.groqKey);
    if(!result.checks.groq){
      result.recommendations.push('لا يوجد GROQ_API_KEY في Vercel ولا groqKey في Firebase.');
    }
  }catch(e){
    result.firebase.connected = false;
    result.firebase.error = String(e?.message || e);
    result.checks.firebase = false;
    result.checks.groq = !!process.env.GROQ_API_KEY;
    result.recommendations.push('تعذر قراءة Firebase. راجع قواعد Realtime Database أو رابط قاعدة البيانات.');
  }

  // GREEN API state
  try{
    const state = await greenGet('getStateInstance');
    result.green.stateInstance = state?.stateInstance ?? state ?? null;
    result.checks.authorized = result.green.stateInstance === 'authorized';

    if(!result.checks.authorized){
      result.recommendations.push(`حالة GREEN API الحالية: ${result.green.stateInstance || 'غير معروفة'}. المطلوب عادة authorized.`);
    }
  }catch(e){
    result.green.stateError = String(e?.message || e);
    result.checks.authorized = false;
    result.recommendations.push('فشل GetStateInstance. راجع GREEN_API_URL و Instance ID و Token.');
  }

  // GREEN API settings
  try{
    const s = await greenGet('getSettings');
    result.green.webhookUrl = s?.webhookUrl || '';
    result.green.incomingWebhook = s?.incomingWebhook || '';
    result.green.markIncomingMessagesReadedOnReply = s?.markIncomingMessagesReadedOnReply || '';
    result.green.wid = maskPhone(s?.wid);

    result.checks.webhookExact = clean(s?.webhookUrl).replace(/\/$/,'') === expectedWebhook.replace(/\/$/,'');
    result.checks.incomingWebhook = String(s?.incomingWebhook || '').toLowerCase() === 'yes';

    if(!result.checks.webhookExact){
      result.recommendations.push(`Webhook الحالي لا يطابق هذا المشروع. الحالي: ${s?.webhookUrl || '(فارغ)'}`);
    }
    if(!result.checks.incomingWebhook){
      result.recommendations.push(`incomingWebhook=${s?.incomingWebhook || '(فارغ)'} ويجب أن يكون yes لاستقبال الرسائل.`);
    }
  }catch(e){
    result.green.settingsError = String(e?.message || e);
    result.checks.webhookExact = false;
    result.checks.incomingWebhook = false;
    result.recommendations.push('فشل GetSettings من GREEN API.');
  }

  // WhatsApp account info - useful but non-fatal
  try{
    const wa = await greenGet('getWaSettings');
    result.green.waState = wa?.stateInstance || '';
    result.green.phone = maskPhone(wa?.phone);
    result.green.historySyncProgress = wa?.historySyncProgress ?? null;
    result.green.suspendedUntil = wa?.suspendedUntil ?? null;
  }catch(e){
    result.green.waSettingsError = String(e?.message || e);
  }

  result.checks.greenEnvironment =
    result.environment.greenApiUrl &&
    result.environment.greenInstanceId &&
    result.environment.greenToken;

  const required = [
    result.checks.greenEnvironment,
    result.checks.firebase,
    result.checks.groq,
    result.checks.authorized,
    result.checks.webhookExact,
    result.checks.incomingWebhook
  ];

  result.ready = required.every(Boolean);

  if(result.ready){
    result.recommendations.push('الإعدادات الأساسية سليمة. أرسل رسالة نصية من رقم آخر ثم راقب Vercel Logs لطلب POST /api/webhook.');
  }

  return Response.json(result, {
    headers: {'cache-control':'no-store'}
  });
}
