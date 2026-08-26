// Cloudflare Pages Function
// Cria uma cobrança (M-Pesa / e-Mola / mKesh) na NetShop para a loja do jogo Homejub.
// O valor a cobrar NUNCA vem do telemóvel do jogador — vem sempre desta lista fixa,
// para ninguém conseguir "enganar" o preço a pagar.
//
// URL desta função depois de publicada: https://SEUDOMINIO/netshop-charge

const ITENS_LOJA = {
  moedas30:  { mt: 2,  descricao: "30 moedas" },
  moedas70:  { mt: 4,  descricao: "70 moedas" },
  ajudas10:  { mt: 1,  descricao: "10 ajudas" },
  jogadas10: { mt: 2,  descricao: "10 jogadas extra" },
  bonus:     { mt: 5,  descricao: "Bónus: 6 vidas + 70 moedas + 6 ajudas + 10 jogadas" },
};

export async function onRequestPost({ request, env }) {
  try {
    const body = await request.json();
    const email = (body.email || "").trim().toLowerCase();
    const msisdn = (body.msisdn || "").trim();
    const method = (body.method || "").trim().toLowerCase(); // mpesa | emola | mkesh
    const item = (body.item || "").trim();

    if (!email || !msisdn || !ITENS_LOJA[item] || !["mpesa", "emola", "mkesh"].includes(method)) {
      return json({ erro: "Pedido inválido" }, 400);
    }
    if (!/^\+258\d{9}$/.test(msisdn)) {
      return json({ erro: "Número de telefone inválido — usa o formato +258XXXXXXXXX" }, 400);
    }

    const item_info = ITENS_LOJA[item];
    const amountCentavos = item_info.mt * 100; // a API espera a unidade mais pequena (centavos)

    const referencia = `HOMEJUB|${item}|${email}`;

    const resp = await fetch("https://www.netshop.co.mz/api/v1/charges", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${env.NETSHOP_API_KEY}`,
        "X-Wallet-ID": env.NETSHOP_WALLET_ID,
        "Idempotency-Key": crypto.randomUUID(),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountCentavos,
        currency: "MZN",
        method: method,
        msisdn: msisdn,
        reference: referencia,
      }),
    });

    const data = await resp.json();

    if (!resp.ok) {
      return json({ erro: data?.message || "Falha ao criar cobrança na NetShop" }, 502);
    }

    return json({ id: data.id, status: data.status || "pending" }, 200);
  } catch (err) {
    return json({ erro: "Erro interno ao criar cobrança" }, 500);
  }
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
