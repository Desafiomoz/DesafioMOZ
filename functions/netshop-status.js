// Cloudflare Pages Function
// O jogo pergunta a esta função, repetidamente, "este pagamento já foi feito?" — funciona
// como reserva mesmo que o webhook (netshop-webhook.js) já tenha tratado tudo mais depressa.
//
// URL desta função depois de publicada: https://SEUDOMINIO/netshop-status?id=CHARGE_ID

import { ESTADOS_PAGOS, ESTADOS_FALHADOS, processarCobrancaPaga } from "./_netshop-lib.js";

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const chargeId = url.searchParams.get("id");
    if (!chargeId) return json({ erro: "Falta o id da cobrança" }, 400);

    const resp = await fetch(`https://www.netshop.co.mz/api/v1/charges/${encodeURIComponent(chargeId)}`, {
      headers: {
        "Authorization": `Bearer ${env.NETSHOP_API_KEY}`,
        "X-Wallet-ID": env.NETSHOP_WALLET_ID,
      },
    });
    const cobranca = await resp.json();
    if (!resp.ok) return json({ status: "erro" }, 502);

    const estado = (cobranca.status || "").toLowerCase();

    if (ESTADOS_FALHADOS.includes(estado)) {
      console.error("Pagamento falhou:", cobranca.failed_reason || "sem motivo indicado");
      return json({ status: "failed" }, 200);
    }
    if (!ESTADOS_PAGOS.includes(estado)) {
      return json({ status: "pending" }, 200); // ainda a aguardar confirmação do jogador no telemóvel
    }

    const resultado = await processarCobrancaPaga(chargeId);
    return json({ status: "paid", credited: resultado.credited }, 200);
  } catch (err) {
    console.error("Erro ao verificar estado do pagamento:", err);
    return json({ status: "erro" }, 500);
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
