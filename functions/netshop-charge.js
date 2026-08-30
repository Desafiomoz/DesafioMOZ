// Cloudflare Pages Function
// Cria uma cobrança (M-Pesa) na NetShop para a loja do jogo Homejub.
// O valor a cobrar NUNCA vem do telemóvel do jogador — vem sempre do catálogo em _netshop-lib.js,
// para ninguém conseguir "enganar" o preço a pagar.
//
// URL desta função depois de publicada: https://SEUDOMINIO/netshop-charge

import { ITENS_LOJA, guardarPedido } from "./_netshop-lib.js";

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const email = (body.email || "").trim().toLowerCase();
    const msisdn = (body.msisdn || "").trim();
    const method = (body.method || "").trim().toLowerCase(); // só mpesa — e-Mola e mKesh removidos (recusados pela NetShop)
    const item = (body.item || "").trim();

    if (!email || !msisdn || !ITENS_LOJA[item] || method !== "mpesa") {
      return json({ erro: "Pedido inválido" }, 400);
    }
    if (!/^\+258\d{9}$/.test(msisdn)) {
      return json({ erro: "Número de telefone inválido — usa o formato +258XXXXXXXXX" }, 400);
    }

    const amountMT = ITENS_LOJA[item].mt; // a API espera o valor direto em Meticais, não em cêntimos
    const referencia = `HJ${Date.now()}`; // só para referência humana na NetShop — a ligação real usa o id da cobrança

    const resp = await fetch("https://www.netshop.co.mz/api/v1/charges", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.NETSHOP_API_KEY}`,
        "X-Wallet-ID": env.NETSHOP_WALLET_ID,
        "Idempotency-Key": crypto.randomUUID(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountMT,
        currency: "MZN",
        method: method,
        msisdn: msisdn,
        reference: referencia,
      }),
    });

    const textoResposta = await resp.text();
    let data = {};
    try { data = JSON.parse(textoResposta); } catch (e) { /* resposta não era JSON — fica em textoResposta */ }

    if (!resp.ok) {
      // guarda o detalhe técnico só nos registos do servidor (Cloudflare) — o jogador NUNCA vê isto
      console.error("Falha ao criar cobrança:", resp.status, textoResposta);
      return json({ erro: "Não foi possível processar o pagamento agora. Verifica o número de telefone e tenta novamente." }, 502);
    }

    // só agora guardamos o pedido, já com o ID real que a NetShop devolveu — é essa ligação
    // (id da cobrança → item + email) que garante a entrega, sem depender de mais nada
    await guardarPedido(data.id, item, email);

    return json({ id: data.id, status: data.status || "pending" }, 200);
  } catch (err) {
    console.error("Erro interno ao criar cobrança:", err);
    return json({ erro: "Não foi possível processar o pagamento agora. Tenta novamente." }, 500);
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
