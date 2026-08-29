// Cloudflare Pages Function
// Cria uma cobrança M-Pesa na NetShop (loja Homejub).
// URL: https://desafiomoz.pages.dev/netshop-charge
//
// Variáveis Cloudflare:
//   NETSHOP_API_KEY
//   NETSHOP_WALLET_ID

const ITENS_LOJA = {
  moedas30:        { mt: 2,  descricao: "30 moedas" },
  moedas70:        { mt: 4,  descricao: "70 moedas" },
  ajudas20:        { mt: 2,  descricao: "20 ajudas" },
  jogadas10:       { mt: 2,  descricao: "10 jogadas extra" },
  jogadasOferta20: { mt: 2,  descricao: "20 jogadas (continuação imediata)" },
  bonus:           { mt: 5,  descricao: "Bónus: 6 vidas + 70 moedas + 6 ajudas + 10 jogadas" },
  bonus2:          { mt: 10, descricao: "Bónus grande: 8 vidas + 100 moedas + 20 ajudas + 20 jogadas" },
  moedasInfinitas: { mt: 100, descricao: "Moedas infinitas" },
  ajudasInfinitas: { mt: 50, descricao: "Ajudas infinitas" },
  desbloqueio10:   { mt: 15, descricao: "Desbloqueio de 10 níveis" },
};

export async function onRequestPost({ request, env }) {
  try {
    if (!env.NETSHOP_API_KEY || !env.NETSHOP_WALLET_ID) {
      console.error("Faltam NETSHOP_API_KEY ou NETSHOP_WALLET_ID nas variáveis de ambiente");
      return json({ erro: "Pagamento temporariamente indisponível. Tenta mais tarde." }, 500);
    }

    const body = await request.json();
    const email = (body.email || "").trim().toLowerCase();
    let msisdn = (body.msisdn || body.telefone || "").trim().replace(/\s+/g, "");
    const method = (body.method || "mpesa").trim().toLowerCase();
    const item = (body.item || "").trim();

    // Aceitar 84/85... sem +258 e normalizar
    if (/^8[45]\d{7}$/.test(msisdn)) {
      msisdn = "+258" + msisdn;
    }
    if (msisdn.startsWith("258") && msisdn.length === 12) {
      msisdn = "+" + msisdn;
    }

    if (!email || !msisdn || !ITENS_LOJA[item] || method !== "mpesa") {
      return json({ erro: "Pedido inválido. Verifica o item e o número de telefone." }, 400);
    }
    if (!/^\+258[0-9]{9}$/.test(msisdn)) {
      return json({
        erro: "Número inválido. Usa o formato 84XXXXXXX ou +25884XXXXXXX",
      }, 400);
    }

    const item_info = ITENS_LOJA[item];
    const amountMT = item_info.mt;

    // reference garante item + email mesmo se o metadata não voltar
    const emailCodificado = btoa(email);
    const referencia = `HOMEJUB-${item}-${emailCodificado}-${Date.now()}`;

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
        msisdn: msisdn,
        customer_email: email,
        reference: referencia,
        metadata: { item: item, email: email },
      }),
    });

    const textoResposta = await resp.text();
    let data = {};
    try {
      data = JSON.parse(textoResposta);
    } catch (e) {
      /* resposta não-JSON */
    }

    if (!resp.ok) {
      console.error("NetShop charge falhou:", resp.status, textoResposta);

      const codigo = (data.error || data.code || data.message || "").toString().toLowerCase();
      if (codigo.includes("min_amount") || codigo.includes("below_minimum")) {
        return json({ erro: "Valor abaixo do mínimo permitido pela NetShop." }, 502);
      }
      if (codigo.includes("msisdn") || codigo.includes("phone") || codigo.includes("invalid")) {
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
      console.error("NetShop respondeu OK mas sem id:", textoResposta);
      return json({ erro: "Resposta inválida do gateway. Tenta novamente." }, 502);
    }

    return json({
      id: data.id,
      status: (data.status || "pending").toLowerCase(),
    }, 200);
  } catch (err) {
    console.error("Erro interno netshop-charge:", err);
    return json({ erro: "Não foi possível processar o pagamento agora. Tenta novamente." }, 500);
  }
}

export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders(),
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      ...corsHeaders(),
    },
  });
}

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}
