// Cloudflare Pages Function
// Cria uma cobrança (M-Pesa) na NetShop para a loja do jogo Homejub.
// O valor a cobrar NUNCA vem do telemóvel do jogador — vem sempre desta lista fixa,
// para ninguém conseguir "enganar" o preço a pagar.
//
// URL desta função depois de publicada: https://SEUDOMINIO/netshop-charge

const ITENS_LOJA = {
  moedas30:        { mt: 2, descricao: "30 moedas" },
  moedas70:        { mt: 4, descricao: "70 moedas" },
  ajudas20:        { mt: 2, descricao: "20 ajudas" },
  jogadas10:       { mt: 2, descricao: "10 jogadas extra" },
  jogadasOferta20: { mt: 2, descricao: "20 jogadas (continuação imediata)" },
  bonus:           { mt: 5, descricao: "Bónus: 6 vidas + 70 moedas + 6 ajudas + 10 jogadas" },
  bonus2:          { mt: 10, descricao: "Bónus grande: 8 vidas + 100 moedas + 20 ajudas + 20 jogadas" },
  moedasInfinitas: { mt: 100, descricao: "Moedas infinitas" },
  ajudasInfinitas: { mt: 50, descricao: "Ajudas infinitas" },
  desbloqueio10:   { mt: 15, descricao: "Desbloqueio de 10 níveis" },
};

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

    const item_info = ITENS_LOJA[item];
    const amountMT = item_info.mt; // a API espera o valor direto em Meticais, não em cêntimos

    // guarda o item e o e-mail de forma garantida na "reference" (não depende do "metadata" ser devolvido pela API)
    const emailCodificado = btoa(email);
    const referencia = `HOMEJUB-${item}-${emailCodificado}-${Date.now()}`;

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
        customer_email: email,
        reference: referencia,
        metadata: { item: item, email: email },
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
