const PROJECT = "desafio-moz-61b70";
const DOC_ROOT = "projects/" + PROJECT + "/databases/(default)/documents";
const FS_API = "https://firestore.googleapis.com/v1/" + DOC_ROOT;

const ITENS_LOJA = {
  moedas30: { mt: 2 },
  moedas70: { mt: 4 },
  ajudas20: { mt: 2 },
  jogadas10: { mt: 2 },
  jogadasOferta20: { mt: 2 },
  bonus: { mt: 5 },
  bonus2: { mt: 10 },
  moedasInfinitas: { mt: 100 },
  ajudasInfinitas: { mt: 50 },
  desbloqueio10: { mt: 15 }
};

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

function emailParaRef(email) {
  // base64url — seguro na reference da NetShop
  var b64 = btoa(unescape(encodeURIComponent(String(email).trim().toLowerCase())));
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function guardarPedido(chargeId, item, email) {
  try {
    var url = FS_API + "/pedidosLoja/" + encodeURIComponent(chargeId);
    await fetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          email: { stringValue: String(email).trim().toLowerCase() },
          item: { stringValue: String(item) },
          createdAt: { timestampValue: new Date().toISOString() }
        }
      })
    });
  } catch (e) {
    console.error("guardarPedido falhou (ok, email vai na reference):", e);
  }
}

export async function onRequestOptions() {
  return json({}, 204);
}

export async function onRequestPost({ request, env }) {
  try {
    var body = await request.json();
    var email = (body.email || "").trim().toLowerCase();
    var msisdn = (body.msisdn || "").trim();
    var method = (body.method || "").trim().toLowerCase();
    var item = (body.item || "").trim();

    if (!email || !msisdn || !ITENS_LOJA[item] || method !== "mpesa") {
      return json({ erro: "Pedido inválido" }, 400);
    }
    if (!/^\+258\d{9}$/.test(msisdn)) {
      return json({
        erro: "Número de telefone inválido — usa o formato +258XXXXXXXXX"
      }, 400);
    }
    if (!env.NETSHOP_API_KEY || !env.NETSHOP_WALLET_ID) {
      return json({ erro: "Configuração do servidor em falta" }, 500);
    }

    var amountMT = ITENS_LOJA[item].mt;
    // Formato: HJ-{item}-{timestamp}-{emailEmBase64}
    var referencia =
      "HJ-" + item + "-" + Date.now() + "-" + emailParaRef(email);

    var resp = await fetch("https://www.netshop.co.mz/api/v1/charges", {
      method: "POST",
      headers: {
        Authorization: "Bearer " + env.NETSHOP_API_KEY,
        "X-Wallet-ID": env.NETSHOP_WALLET_ID,
        "Idempotency-Key": crypto.randomUUID(),
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount: amountMT,
        currency: "MZN",
        method: method,
        msisdn: msisdn,
        reference: referencia
      })
    });

    var textoResposta = await resp.text();
    var data = {};
    try {
      data = JSON.parse(textoResposta);
    } catch (e) {}

    if (!resp.ok || !data.id) {
      console.error("Falha cobrança:", resp.status, textoResposta);
      return json({
        erro: "Não foi possível processar o pagamento agora. Verifica o número e tenta novamente."
      }, 502);
    }

    await guardarPedido(data.id, item, email);

    return json({ id: data.id, status: data.status || "pending" }, 200);
  } catch (err) {
    console.error("Erro interno:", err);
    return json({
      erro: "Não foi possível processar o pagamento agora. Tenta novamente."
    }, 500);
  }
}