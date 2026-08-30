// Cloudflare Pages Function
// Recebe os avisos que a NetShop envia diretamente para o nosso site quando um pagamento
// é confirmado (charge.paid) ou falha (charge.failed) — mais rápido do que o jogo ter de
// ficar a perguntar repetidamente (netshop-status.js), que continua a existir como reserva.
//
// URL a configurar no painel da NetShop: https://SEUDOMINIO/netshop-webhook

import { processarCobrancaPaga } from "./_netshop-lib.js";

export async function onRequestPost({ request, env }) {
  try {
    const corpoTexto = await request.text();
    const assinaturaRecebida = request.headers.get("X-NetShop-Signature") || "";

    if (env.NETSHOP_WEBHOOK_SECRET) {
      const valida = await assinaturaValida(corpoTexto, assinaturaRecebida, env.NETSHOP_WEBHOOK_SECRET);
      if (!valida) {
        console.error("Webhook recusado — assinatura inválida");
        return new Response("assinatura inválida", { status: 401 });
      }
    } else {
      console.error("Aviso: NETSHOP_WEBHOOK_SECRET não configurado — webhook a processar sem verificação de assinatura");
    }

    const evento = JSON.parse(corpoTexto);
    const tipo = evento.type || evento.event || "";
    const cobranca = evento.data || evento.charge || evento;
    const estado = (cobranca.status || "").toLowerCase();

    if (tipo.includes("paid") || estado === "paid" || estado === "succeeded") {
      await processarCobrancaPaga(cobranca.id);
    }
    // "charge.failed" não precisa de ação aqui — o ecrã de pagamento do jogo já trata do aviso ao jogador

    return new Response("ok", { status: 200 });
  } catch (err) {
    console.error("Erro no webhook da NetShop:", err);
    return new Response("erro", { status: 500 });
  }
}

async function assinaturaValida(corpoTexto, assinaturaRecebida, segredo) {
  try {
    const codificador = new TextEncoder();
    const chave = await crypto.subtle.importKey(
      "raw", codificador.encode(segredo), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
    );
    const assinaturaCalculada = await crypto.subtle.sign("HMAC", chave, codificador.encode(corpoTexto));
    const hex = [...new Uint8Array(assinaturaCalculada)].map(b => b.toString(16).padStart(2, "0")).join("");
    const recebida = assinaturaRecebida.replace(/^sha256=/, "").trim().toLowerCase();
    return hex === recebida;
  } catch (e) {
    console.error("Erro a validar assinatura do webhook:", e);
    return false;
  }
}
