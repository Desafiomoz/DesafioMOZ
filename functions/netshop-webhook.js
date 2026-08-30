// Cloudflare Pages Function
// Webhook NetShop — credita quando charge.paid chega.
// URL: https://desafiomoz.pages.dev/netshop-webhook
//
// Variável: NETSHOP_WEBHOOK_SECRET

const PROJECT = "desafio-moz-61b70";
const DOC_ROOT = `projects/${PROJECT}/databases/(default)/documents`;
const API_ROOT = `https://firestore.googleapis.com/v1/${DOC_ROOT}`;

const ESTADOS_PAGOS = ["paid", "succeeded", "completed", "success"];

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
      console.error("Webhook sem id", evento);
      return json({ ok: true, aviso: "sem id" }, 200);
    }

    const ja = await fetch(`${API_ROOT}/lojaCargas/${encodeURIComponent(chargeId)}`);
    if (ja.status === 200) {
      return json({ ok: true, credited: true, ja: true }, 200);
    }

    let item, email;
    const referencia = cobranca.reference || "";
    const partes = referencia.split("-");
    if (partes[0] === "HOMEJUB" && partes.length >= 4) {
      item = partes[1];
      try { email = atob(partes[2]); } catch (e) { email = null; }
    }
    if (!item || !email) {
      const meta = cobranca.metadata || {};
      item = item || meta.item;
      email = email || meta.email;
    }
    if (!item || !email) {
      console.error("Webhook: item/email em falta", chargeId, referencia, JSON.stringify(evento).slice(0, 500));
      return json({ ok: true, credited: false }, 200);
    }

    email = String(email).trim().toLowerCase();
    await creditarCompra(item, email);

    await fetch(
      `${API_ROOT}/lojaCargas/${encodeURIComponent(chargeId)}?documentId=${encodeURIComponent(chargeId)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: {
            item: { stringValue: item },
            email: { stringValue: email },
            processedAt: { timestampValue: new Date().toISOString() },
            via: { stringValue: "webhook" },
          },
        }),
      }
    );

    return json({ ok: true, credited: true }, 200);
  } catch (err) {
    console.error("Erro webhook NetShop:", err);
    return json({ erro: "interno" }, 500);
  }
}

export async function onRequestGet() {
  return json({ ok: true, service: "netshop-webhook" }, 200);
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

async function creditarCompra(item, email) {
  const docName = `${DOC_ROOT}/jogoEstado/${email}`;
  const docUrl = `${API_ROOT}/jogoEstado/${encodeURIComponent(email)}`;

  if (item === "bonus" || item === "bonus2") {
    const vidas = item === "bonus" ? 6 : 8;
    await fetch(
      `${docUrl}?updateMask.fieldPaths=vidas&updateMask.fieldPaths=proximaRecarga`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: {
            vidas: { integerValue: String(vidas) },
            proximaRecarga: { integerValue: "0" },
          },
        }),
      }
    );
    if (item === "bonus") {
      await incrementFields(docName, {
        moedasTotais: 70,
        ajudasDisponiveis: 6,
        jogadasExtraArmazenadas: 10,
      });
    } else {
      await incrementFields(docName, {
        moedasTotais: 100,
        ajudasDisponiveis: 20,
        jogadasExtraArmazenadas: 20,
      });
    }
    return;
  }

  if (item === "moedas30") return incrementFields(docName, { moedasTotais: 30 });
  if (item === "moedas70") return incrementFields(docName, { moedasTotais: 70 });
  if (item === "ajudas20") return incrementFields(docName, { ajudasDisponiveis: 20 });
  if (item === "jogadas10") return incrementFields(docName, { jogadasExtraArmazenadas: 10 });

  if (item === "moedasInfinitas") {
    return fetch(`${docUrl}?updateMask.fieldPaths=moedasInfinitas`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { moedasInfinitas: { booleanValue: true } } }),
    });
  }
  if (item === "ajudasInfinitas") {
    return fetch(`${docUrl}?updateMask.fieldPaths=ajudasInfinitas`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { ajudasInfinitas: { booleanValue: true } } }),
    });
  }
  if (item === "desbloqueio10") {
    return incrementFields(docName, { nivelDesbloqueado: 10 });
  }
}

async function incrementFields(docName, incrementos) {
  const fieldTransforms = Object.entries(incrementos).map(([campo, valor]) => ({
    fieldPath: campo,
    increment: { integerValue: String(valor) },
  }));
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents:commit`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        writes: [{ transform: { document: docName, fieldTransforms } }],
      }),
    }
  );
  if (!res.ok) {
    const t = await res.text();
    console.error("Firestore commit falhou:", res.status, t, docName);
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

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-NetShop-Signature",
  };
}
