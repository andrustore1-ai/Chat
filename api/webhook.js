const DB_URL = 'https://meopp-8f1fa-default-rtdb.firebaseio.com';
const ROOT = 'cashTopAI';

const clean = (v) => String(v ?? '').trim();
const nrm = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/[\u064B-\u065F\u0670]/g, '')
  .replace(/[إأآا]/g, 'ا')
  .replace(/ى/g, 'ي')
  .replace(/ؤ/g, 'و')
  .replace(/ئ/g, 'ي')
  .replace(/ة/g, 'ه')
  .replace(/ـ/g, '')
  .replace(/[^\u0600-\u06FFa-z0-9\s:/.+\-]/g, ' ')
  .replace(/\s+/g, ' ')
  .trim();

const keySafe = (s) => String(s || 'unknown')
  .replace(/[.#$\[\]\/]/g, '_')
  .slice(0, 180);

async function fbGet(path) {
  const r = await fetch(`${DB_URL}/${path}.json`, { cache: 'no-store' });
  if (!r.ok) throw new Error(`Firebase GET ${r.status}: ${await r.text()}`);
  return await r.json();
}
async function fbPut(path, data) {
  const r = await fetch(`${DB_URL}/${path}.json`, {
    method: 'PUT',
    headers: {'content-type':'application/json'},
    body: JSON.stringify(data)
  });
  if (!r.ok) throw new Error(`Firebase PUT ${r.status}: ${await r.text()}`);
  return await r.json();
}
async function fbPatch(path, data) {
  const r = await fetch(`${DB_URL}/${path}.json`, {
    method: 'PATCH',
    headers: {'content-type':'application/json'},
    body: JSON.stringify(data)
  });
  if (!r.ok) throw new Error(`Firebase PATCH ${r.status}: ${await r.text()}`);
  return await r.json();
}

function arr(obj) {
  return Object.entries(obj || {}).map(([id, v]) => ({ id, ...(v || {}) }));
}

function incomingText(body) {
  const md = body?.messageData || {};
  if (md.typeMessage === 'textMessage') {
    return clean(md.textMessageData?.textMessage);
  }
  if (md.typeMessage === 'extendedTextMessage') {
    return clean(md.extendedTextMessageData?.text);
  }
  return '';
}

function relevantQa(text, qa, limit = 10) {
  const q = nrm(text);
  const words = q.split(' ').filter(w => w.length > 2);
  return qa.map(item => {
    const question = nrm(item.question || '');
    const body = nrm([
      item.question,
      item.answer,
      item.normalized,
      ...(Array.isArray(item.keywords) ? item.keywords : [])
    ].join(' '));
    let score = 0;
    if (q && q === question) score += 30;
    if (question && q.includes(question)) score += 18;
    if (question && question.includes(q) && q.length > 3) score += 14;
    for (const w of words) if (body.includes(w)) score += 1;
    return {
      score,
      question: item.question || '',
      answer: item.answer || '',
      keywords: item.keywords || []
    };
  }).filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);
}

function relevantKnowledge(text, knowledge, limit = 6) {
  const words = nrm(text).split(' ').filter(w => w.length > 2);
  const out = [];
  for (const k of knowledge) {
    const chunks = Array.isArray(k.chunks) && k.chunks.length
      ? k.chunks
      : [{ text: k.text || '', keywords: k.keywords || [] }];
    for (const ch of chunks) {
      const body = nrm(`${ch.text || ''} ${(ch.keywords || []).join(' ')}`);
      let score = 0;
      for (const w of words) if (body.includes(w)) score++;
      if (score > 0) out.push({ score, text: String(ch.text || k.text || '').slice(0, 1000) });
    }
  }
  return out.sort((a, b) => b.score - a.score).slice(0, limit).map(x => x.text);
}

async function getHistory(chatId) {
  const data = await fbGet(`${ROOT}/whatsappSessions/${keySafe(chatId)}/history`);
  return arr(data)
    .sort((a,b) => Number(a.at || 0) - Number(b.at || 0))
    .slice(-14)
    .map(x => ({
      role: x.role === 'assistant' ? 'assistant' : 'user',
      content: String(x.content || '').slice(0, 1200)
    }));
}

async function appendHistory(chatId, role, content, senderName='') {
  const sessionPath = `${ROOT}/whatsappSessions/${keySafe(chatId)}`;
  const history = await fbGet(`${sessionPath}/history`);
  const list = arr(history).sort((a,b) => Number(a.at || 0) - Number(b.at || 0));
  const id = `${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  await fbPatch(sessionPath, {
    chatId,
    senderName: senderName || '',
    lastSeenAt: Date.now()
  });
  await fbPut(`${sessionPath}/history/${id}`, {
    role,
    content: String(content || '').slice(0, 2000),
    at: Date.now()
  });
  if (list.length >= 30) {
    for (const old of list.slice(0, list.length - 29)) {
      await fbPut(`${sessionPath}/history/${old.id}`, null);
    }
  }
}

async function wasProcessed(idMessage) {
  if (!idMessage) return false;
  const v = await fbGet(`${ROOT}/whatsappProcessed/${keySafe(idMessage)}`);
  return !!v;
}
async function markProcessed(idMessage, chatId) {
  if (!idMessage) return;
  await fbPut(`${ROOT}/whatsappProcessed/${keySafe(idMessage)}`, {
    chatId, at: Date.now()
  });
}

function greenConfig() {
  return {
    url: clean(process.env.GREEN_API_URL).replace(/\/$/,''),
    id: clean(process.env.GREEN_INSTANCE_ID),
    token: clean(process.env.GREEN_API_TOKEN)
  };
}

async function sendWhatsApp(chatId, message, quotedMessageId='') {
  const g = greenConfig();
  if (!g.url || !g.id || !g.token) throw new Error('GREEN_API_* environment variables are missing');
  const payload = { chatId, message };
  if (quotedMessageId) payload.quotedMessageId = quotedMessageId;
  const r = await fetch(`${g.url}/waInstance${g.id}/sendMessage/${g.token}`, {
    method: 'POST',
    headers: {'content-type':'application/json'},
    body: JSON.stringify(payload)
  });
  const txt = await r.text();
  if (!r.ok) throw new Error(`GREEN API ${r.status}: ${txt}`);
  try { return JSON.parse(txt); } catch { return { raw: txt }; }
}

async function aiAnswer({text, history, qaHits, knowledge, settings}) {
  const fallback = clean(settings?.whatsappFallback)
    || 'حالياً ما عندي معلومة مؤكدة عن هذا السؤال. اكتب سؤالك بطريقة ثانية أو تواصل مع الدعم.';

  const best = qaHits[0];
  const groqKey = clean(process.env.GROQ_API_KEY) || clean(settings?.groqKey);
  const model = clean(process.env.GROQ_MODEL) || clean(settings?.groqModel) || 'llama-3.1-8b-instant';

  if (!groqKey) return best?.answer || fallback;

  const context = {
    businessName: settings?.businessName || 'CASH TOP',
    whatsapp: settings?.whatsappNumber || '',
    qa: qaHits,
    knowledge,
    conversation: history
  };

  const sys = `أنت موظف دعم واتساب عربي ذكي.
أجب اعتماداً فقط على الأسئلة والأجوبة والمعرفة والسياق المرسل.
افهم السؤال الحالي مع آخر رسائل نفس العميل؛ إذا قال العميل "طيب وكم؟" أو "وهل فيه تجديد؟" اربطه بموضوع الرسائل السابقة.
يمكنك إعادة صياغة الإجابة بشكل طبيعي، لكن لا تخترع سعراً أو ميزة أو سياسة أو رقماً أو رابطاً غير موجود في السياق.
إذا لم توجد معلومة كافية، أجب بالنص التالي حرفياً:
${fallback}
لا تقل إنك ذكاء اصطناعي. اجعل الرد مناسباً ومختصراً لواتساب.`;

  const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type':'application/json',
      'authorization': `Bearer ${groqKey}`
    },
    body: JSON.stringify({
      model,
      messages: [
        { role:'system', content:sys },
        { role:'user', content:`السياق:\n${JSON.stringify(context).slice(0,18000)}\n\nرسالة العميل الحالية:\n${text}` }
      ],
      temperature: 0.15,
      max_tokens: 420
    })
  });

  const data = await r.json().catch(() => ({}));
  if (!r.ok) {
    console.error('Groq error', data);
    return best?.answer || fallback;
  }
  return clean(data?.choices?.[0]?.message?.content) || best?.answer || fallback;
}

export async function GET() {
  return Response.json({
    ok: true,
    service: 'Cash Top WhatsApp AI',
    endpoint: '/api/webhook'
  });
}

export async function POST(request) {
  try {
    const body = await request.json().catch(() => ({}));

    if (body?.typeWebhook !== 'incomingMessageReceived') {
      return Response.json({ ok:true, ignored:'webhook_type' });
    }

    const chatId = clean(body?.senderData?.chatId || body?.senderData?.sender);
    const idMessage = clean(body?.idMessage);
    const senderName = clean(body?.senderData?.senderName || body?.senderData?.senderContactName);
    const text = incomingText(body);

    if (!chatId) return Response.json({ ok:true, ignored:'no_chat' });
    if (chatId.endsWith('@g.us')) return Response.json({ ok:true, ignored:'group' });
    if (!text) return Response.json({ ok:true, ignored:'non_text' });

    if (idMessage && await wasProcessed(idMessage)) {
      return Response.json({ ok:true, ignored:'duplicate' });
    }

    const [settingsRaw, qaRaw, knowledgeRaw, history] = await Promise.all([
      fbGet(`${ROOT}/settings`),
      fbGet(`${ROOT}/qa`),
      fbGet(`${ROOT}/knowledge`),
      getHistory(chatId)
    ]);

    const settings = settingsRaw || {};
    const qa = arr(qaRaw).filter(x => x.active !== false);
    const knowledge = arr(knowledgeRaw);

    const qaHits = relevantQa(text, qa);
    const knowledgeHits = relevantKnowledge(text, knowledge);

    await appendHistory(chatId, 'user', text, senderName);

    const answer = await aiAnswer({
      text,
      history: [...history, {role:'user', content:text}].slice(-14),
      qaHits,
      knowledge: knowledgeHits,
      settings
    });

    await sendWhatsApp(chatId, answer, idMessage);
    await appendHistory(chatId, 'assistant', answer, senderName);
    await markProcessed(idMessage, chatId);

    return Response.json({ ok:true, replied:true });
  } catch (e) {
    console.error(e);
    return Response.json({
      ok:false,
      error: String(e?.message || e)
    }, { status:500 });
  }
}
