// Cloudflare Pages Function
// Polling de backup: o jogo pergunta se o pagamento já foi confirmado.
// O crédito principal deve vir do webhook; esta função só garante a UX no ecrã
// e serve de rede de segurança se o webhook falhar.
//
// URL: https://desafiomoz.pages.dev/netshop-status?id=CHARGE_ID
//
// Variáveis: NETSHOP_API_KEY, NETSHOP_WALLET_ID

const FIREBASE_PROJECT_ID = "desafio-moz-61b70";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

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

    const jaProcessado = await fetch(
      `${FIRESTORE_BASE}/lojaCargas/${encodeURIComponent(chargeId)}`
    );
    if (jaProcessado.status === 200) {
      return json({ status: "paid", credited: true }, 200);
    }

    let item, email;
    const referencia = cobranca.reference || "";
    const partes = referencia.split("-");
    if (partes[0] === "HOMEJUB" && partes.length >= 4) {
      item = partes[1];
      try {
        email = atob(partes[2]);
      } catch (e) {
        email = null;
      }
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

    await creditarCompra(item, email);

    await fetch(
      `${FIRESTORE_BASE}/lojaCargas/${encodeURIComponent(chargeId)}?documentId=${encodeURIComponent(chargeId)}`,
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
  const docPath = `${FIRESTORE_BASE}/jogoEstado/${encodeURIComponent(email)}`;

  if (item === "bonus" || item === "bonus2") {
    const vidasPrometidas = item === "bonus" ? 6 : 8;
    await fetch(
      `${docPath}?updateMask.fieldPaths=vidas&updateMask.fieldPaths=proximaRecarga`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: {
            vidas: { integerValue: vidasPrometidas },
            proximaRecarga: { integerValue: 0 },
          },
        }),
      }
    );
    if (item === "bonus") {
      await commitIncrementos(docPath, {
        moedasTotais: 70,
        ajudasDisponiveis: 6,
        jogadasExtraArmazenadas: 10,
      });
    } else {
      await commitIncrementos(docPath, {
        moedasTotais: 100,
        ajudasDisponiveis: 20,
        jogadasExtraArmazenadas: 20,
      });
    }
    return;
  }

  if (item === "moedas30") return commitIncrementos(docPath, { moedasTotais: 30 });
  if (item === "moedas70") return commitIncrementos(docPath, { moedasTotais: 70 });
  if (item === "ajudas20") return commitIncrementos(docPath, { ajudasDisponiveis: 20 });
  if (item === "jogadas10")
    return commitIncrementos(docPath, { jogadasExtraArmazenadas: 10 });

  if (item === "moedasInfinitas") {
    return fetch(`${docPath}?updateMask.fieldPaths=moedasInfinitas`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: { moedasInfinitas: { booleanValue: true } },
      }),
    });
  }
  if (item === "ajudasInfinitas") {
    return fetch(`${docPath}?updateMask.fieldPaths=ajudasInfinitas`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: { ajudasInfinitas: { booleanValue: true } },
      }),
    });
  }
  if (item === "desbloqueio10") {
    return commitIncrementos(docPath, { nivelDesbloqueado: 10 });
  }
}

async function commitIncrementos(docPath, incrementos) {
  const fieldTransforms = Object.entries(incrementos).map(([campo, valor]) => ({
    fieldPath: campo,
    increment: { integerValue: valor },
  }));
  await fetch(`${FIRESTORE_BASE}:commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      writes: [{ transform: { document: docPath, fieldTransforms } }],
    }),
  });
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
