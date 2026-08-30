// Cloudflare Pages Function
// Polling de backup + crédito se o webhook ainda não tiver creditado.
// URL: https://desafiomoz.pages.dev/netshop-status?id=CHARGE_ID
//
// Variáveis: NETSHOP_API_KEY, NETSHOP_WALLET_ID

const PROJECT = "desafio-moz-61b70";
const DOC_ROOT = `projects/${PROJECT}/databases/(default)/documents`;
const API_ROOT = `https://firestore.googleapis.com/v1/${DOC_ROOT}`;

const ESTADOS_PAGOS = ["paid", "succeeded", "completed", "success"];
const ESTADOS_FALHADOS = ["failed", "expired", "cancelled", "canceled", "declined"];

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const chargeId = url.searchParams.get("id");
    if (!chargeId) return json({ erro: "Falta o id da cobrança" }, 400);

    if (!env.NETSHOP_API_KEY || !env.NETSHOP_WALLET_ID) {
      return json({ status: "erro" }, 500);
    }

    const resp = await fetch(
      `https://www.netshop.co.mz/api/v1/charges/${encodeURIComponent(chargeId)}`,
      {
        headers: {
          Authorization: `Bearer ${env.NETSHOP_API_KEY}`,
          "X-Wallet-ID": String(env.NETSHOP_WALLET_ID),
        },
      }
    );

    const cobranca = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      console.error("Falha ao consultar charge:", resp.status, cobranca);
      return json({ status: "erro" }, 502);
    }

    const estado = (cobranca.status || "").toLowerCase();

    if (ESTADOS_FALHADOS.includes(estado)) {
      return json({ status: "failed" }, 200);
    }
    if (!ESTADOS_PAGOS.includes(estado)) {
      return json({ status: "pending" }, 200);
    }

    // Já creditado?
    const ja = await fetch(`${API_ROOT}/lojaCargas/${encodeURIComponent(chargeId)}`);
    if (ja.status === 200) {
      return json({ status: "paid", credited: true }, 200);
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
      console.error("status: sem item/email", chargeId, referencia);
      return json({ status: "paid", credited: false }, 200);
    }

    email = String(email).trim().toLowerCase();
    await creditarCompra(item, email);

    // Marca como processado
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
            via: { stringValue: "status-poll" },
          },
        }),
      }
    );

    return json({ status: "paid", credited: true }, 200);
  } catch (err) {
    console.error("Erro netshop-status:", err);
    return json({ status: "erro" }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: corsHeaders() });
}

async function creditarCompra(item, email) {
  // Resource name para :commit (SEM https://...)
  const docName = `${DOC_ROOT}/jogoEstado/${email}`;
  // URL para PATCH
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

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
