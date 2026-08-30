// Cloudflare Pages Function
// Recebe charge.paid / charge.failed da NetShop e credita a compra.
// URL: https://desafiomoz.pages.dev/netshop-webhook
//
// Env: NETSHOP_WEBHOOK_SECRET

import { ESTADOS_PAGOS, processarCobrancaPaga, json, corsOptions } from "./_netshop-lib.js";

export async function onRequestOptions() {
  return corsOptions();
}

export async function onRequestGet() {
  return json({ ok: true, service: "netshop-webhook" }, 200);
}

export async function onRequestPost({ request, env }) {
  try {
    const rawBody = await request.text();

    const secret = env.NETSHOP_WEBHOOK_SECRET || "";
    if (!secret) {
      console.error("NETSHOP_WEBHOOK_SECRET em falta");
      return json({ erro: "config" }, 500);
    }

    const signatureHeader = request.headers.get("X-NetShop-Signature") || "";
    const expected = await hmacSha256Hex(secret, rawBody);
    if (!timingSafeEqual(expected, signatureHeader)) {
      console.error("Assinatura webhook inválida");
      return json({ erro: "assinatura inválida" }, 401);
    }

    let evento;
    try {
      evento = JSON.parse(rawBody);
    } catch (e) {
      return json({ erro: "json inválido" }, 400);
    }

    const tipo = (evento.event || evento.type || evento.name || "").toLowerCase();
    const cobranca = evento.data || evento.charge || evento;

    const ePago =
      tipo.includes("charge.paid") ||
      tipo === "paid" ||
      ESTADOS_PAGOS.includes((cobranca.status || "").toLowerCase());

    if (!ePago) {
      return json({ ok: true, ignorado: tipo || "outro" }, 200);
    }

    const chargeId = cobranca.id || cobranca.charge_id || null;
    if (!chargeId) {
      console.error("Webhook sem id de cobrança", evento);
      return json({ ok: true, aviso: "sem id" }, 200);
    }

    const resultado = await processarCobrancaPaga(chargeId, "webhook");
    return json({
      ok: true,
      credited: !!resultado.credited,
      ja: !!resultado.ja,
    }, 200);
  } catch (err) {
    console.error("Erro webhook NetShop:", err);
    // 500 → NetShop faz retry
    return json({ erro: "interno" }, 500);
  }
}

async function hmacSha256Hex(secret, message) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function timingSafeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const na = a.replace(/^sha256=/i, "").toLowerCase().trim();
  const nb = b.replace(/^sha256=/i, "").toLowerCase().trim();
  if (na.length !== nb.length) return false;
  let diff = 0;
  for (let i = 0; i < na.length; i++) diff |= na.charCodeAt(i) ^ nb.charCodeAt(i);
  return diff === 0;
}
