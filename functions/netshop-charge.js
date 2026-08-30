// Cloudflare Pages Function
// Cria cobrança M-Pesa na NetShop e guarda o pedido no Firestore.
// URL: https://desafiomoz.pages.dev/netshop-charge
//
// Env: NETSHOP_API_KEY, NETSHOP_WALLET_ID

import { ITENS_LOJA, guardarPedido, json, corsOptions } from "./_netshop-lib.js";

export async function onRequestOptions() {
  return corsOptions();
}

export async function onRequestPost({ request, env }) {
  try {
    if (!env.NETSHOP_API_KEY || !env.NETSHOP_WALLET_ID) {
      console.error("Faltam NETSHOP_API_KEY ou NETSHOP_WALLET_ID");
      return json({ erro: "Pagamento temporariamente indisponível. Tenta mais tarde." }, 500);
    }

    const body = await request.json();
    const email = (body.email || "").trim().toLowerCase();
    let msisdn = (body.msisdn || body.telefone || "").trim().replace(/\s+/g, "");
    const method = (body.method || "mpesa").trim().toLowerCase();
    const item = (body.item || "").trim();

    // Normalizar número MZ
    if (/^8[45]\d{7}$/.test(msisdn)) msisdn = "+258" + msisdn;
    if (msisdn.startsWith("258") && msisdn.length === 12) msisdn = "+" + msisdn;

    if (!email || !msisdn || !ITENS_LOJA[item] || method !== "mpesa") {
      return json({ erro: "Pedido inválido. Verifica o item e o número de telefone." }, 400);
    }
    if (!/^\+258[0-9]{9}$/.test(msisdn)) {
      return json({ erro: "Número inválido. Usa 84XXXXXXX ou +25884XXXXXXX" }, 400);
    }

    const amountMT = ITENS_LOJA[item].mt;
    const referencia = `HJ-${item}-${Date.now()}`;

    const resp = await fetch("https://www.netshop.co.mz/api/v1/charges", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.NETSHOP_API_KEY}`,
        "X-Wallet-ID": String(env.NETSHOP_WALLET_ID),
        "Idempotency-Key": crypto.randomUUID(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountMT,
        currency: "MZN",
        method: "mpesa",
        msisdn,
        customer_email: email,
        reference: referencia,
        metadata: { item, email },
      }),
    });

    const textoResposta = await resp.text();
    let data = {};
    try {
      data = JSON.parse(textoResposta);
    } catch (e) {
      /* ignore */
    }

    if (!resp.ok) {
      console.error("NetShop charge falhou:", resp.status, textoResposta);
      const codigo = (data.error || data.code || data.message || "").toString().toLowerCase();
      if (codigo.includes("min_amount") || codigo.includes("below_minimum")) {
        return json({ erro: "Valor abaixo do mínimo permitido pela NetShop." }, 502);
      }
      if (codigo.includes("msisdn") || codigo.includes("phone")) {
        return json({ erro: "Número de telefone recusado. Confirma se é M-Pesa activo." }, 502);
      }
      if (resp.status === 401 || resp.status === 403) {
        return json({ erro: "Erro de configuração do pagamento. Contacta o suporte." }, 502);
      }
      return json({
        erro: "Não foi possível processar o pagamento agora. Verifica o número e tenta novamente.",
      }, 502);
    }

    if (!data.id) {
      console.error("NetShop OK sem id:", textoResposta);
      return json({ erro: "Resposta inválida do gateway. Tenta novamente." }, 502);
    }

    // Ligação chargeId → item + email (fonte de verdade para o crédito)
    await guardarPedido(data.id, item, email);

    return json({
      id: data.id,
      status: (data.status || "pending").toLowerCase(),
    }, 200);
  } catch (err) {
    console.error("Erro interno netshop-charge:", err);
    return json({ erro: "Não foi possível processar o pagamento agora. Tenta novamente." }, 500);
  }
}
