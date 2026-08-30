// Cloudflare Pages Function
// Polling de backup: o jogo pergunta se já pagou.
// Crédito principal deve vir do webhook; isto garante a UX e cobre falhas.
// URL: https://desafiomoz.pages.dev/netshop-status?id=CHARGE_ID
//
// Env: NETSHOP_API_KEY, NETSHOP_WALLET_ID

import {
  ESTADOS_PAGOS,
  ESTADOS_FALHADOS,
  processarCobrancaPaga,
  json,
  corsOptions,
} from "./_netshop-lib.js";

export async function onRequestOptions() {
  return corsOptions();
}

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

    // Pago → creditar (idempotente; se o webhook já creditou, só confirma)
    const resultado = await processarCobrancaPaga(chargeId, "status-poll");
    return json({
      status: "paid",
      credited: !!resultado.credited,
    }, 200);
  } catch (err) {
    console.error("Erro netshop-status:", err);
    return json({ status: "erro" }, 500);
  }
}
