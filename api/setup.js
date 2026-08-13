function cfg() {
  return {
    url: String(process.env.GREEN_API_URL || '').trim().replace(/\/$/,''),
    id: String(process.env.GREEN_INSTANCE_ID || '').trim(),
    token: String(process.env.GREEN_API_TOKEN || '').trim()
  };
}

export async function GET(request) {
  const origin = new URL(request.url).origin;
  return Response.json({
    ok:true,
    webhookUrl:`${origin}/api/webhook`,
    note:'POST to this endpoint to configure GREEN API.'
  });
}

export async function POST(request) {
  try {
    const g = cfg();
    if (!g.url || !g.id || !g.token) {
      return Response.json({
        ok:false,
        error:'أضف GREEN_API_URL و GREEN_INSTANCE_ID و GREEN_API_TOKEN في Vercel Environment Variables أولاً.'
      }, {status:400});
    }

    const origin = new URL(request.url).origin;
    const webhookUrl = `${origin}/api/webhook`;

    const r = await fetch(`${g.url}/waInstance${g.id}/setSettings/${g.token}`, {
      method:'POST',
      headers:{'content-type':'application/json'},
      body:JSON.stringify({
        webhookUrl,
        incomingWebhook:'yes',
        outgoingWebhook:'no',
        outgoingMessageWebhook:'no',
        outgoingAPIMessageWebhook:'no'
      })
    });
    const text = await r.text();
    let data; try { data = text ? JSON.parse(text) : {}; } catch { data = {raw:text}; }
    if (!r.ok) throw new Error(data?.message || data?.error || `GREEN API HTTP ${r.status}`);

    return Response.json({ok:true, webhookUrl, green:data});
  } catch (e) {
    return Response.json({ok:false,error:String(e?.message||e)}, {status:500});
  }
}
