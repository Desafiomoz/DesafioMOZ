// Cloudflare Pages Function
// https://desafiomoz.pages.dev/postback-cpagrip
// CPAGrip envia POST (password, payout, offer_id, tracking_id)

const PIPEDREAM = "https://eo3170ax1lhte5v.m.pipedream.net/";

async function lerParams(request) {
  const url = new URL(request.url);
  const out = {};

  url.searchParams.forEach((v, k) => {
    out[k] = v;
  });

  if (request.method === "POST") {
    try {
      const ct = (request.headers.get("content-type") || "").toLowerCase();
      if (ct.includes("application/json")) {
        const j = await request.json();
        Object.assign(out, j || {});
      } else {
        const text = await request.text();
        const body = new URLSearchParams(text);
        body.forEach((v, k) => {
          out[k] = v;
        });
      }
    } catch (_) {}
  }
  return out;
}

export async function onRequest(context) {
  const { request } = context;

  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  try {
    const p = await lerParams(request);
    const target = new URL(PIPEDREAM);

    // Normalizar nomes
    const tracking_id = p.tracking_id || p.trackingId || p.subid || p.user_id || "";
    const payout = p.payout || p.amount || "0";
    const offer_id = p.offer_id || p.offerId || "";
    const password = p.password || "";

    target.searchParams.set("tracking_id", tracking_id);
    target.searchParams.set("payout", payout);
    target.searchParams.set("offer_id", offer_id);
    if (password) target.searchParams.set("password", password);

    // Repassar resto
    Object.keys(p).forEach((k) => {
      if (!target.searchParams.has(k)) target.searchParams.set(k, p[k]);
    });

    await fetch(target.toString(), {
      method: "GET",
      headers: { "User-Agent": "DesafioMoz-CPAGrip-Proxy/1.0" },
    });

    return new Response("OK", {
      status: 200,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (e) {
    return new Response("OK", {
      status: 200,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}
