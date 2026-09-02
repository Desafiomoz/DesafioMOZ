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
  var s = String(email).trim().toLowerCase();
  var out = "";
  for (var i = 0; i < s.length; i++) {
    var c = s.charAt(i);
    if (c === "@") out += "AT";
    else if (c === ".") out += "DOT";
    else if (c === "-" || c === "_" || (c >= "a" && c <= "z") || (c >= "0" && c <= "9")) out += c;
  }
  return out;
}

async function guardarPedido(chargeId, item, email) {
  try {
    await fetch(FS_API + "/pedidosLoja/" + encodeURIComponent(chargeId), {
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
    console.error("guardarPedido:", e);
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
      return json({ erro: "Falta NETSHOP_API_KEY ou NETSHOP_WALLET_ID no Cloudflare" }, 500);
    }

    var amountMT = ITENS_LOJA[item].mt;
    // HJ-item-timestamp-emailCodificado (sem base64)
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
        method: "mpesa",
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
      console.error("NetShop charge fail:", resp.status, textoResposta);
      // Mostra detalhe real para diagnosticar (podes tirar depois)
      var detalhe =
        (data && (data.message || data.error || data.erro)) ||
        textoResposta.slice(0, 120);
      return json({
        erro: "NetShop recusou: " + resp.status + " " + detalhe
      }, 502);
    }

    await guardarPedido(data.id, item, email);

    return json({ id: data.id, status: data.status || "pending" }, 200);
  } catch (err) {
    console.error("Erro interno:", err);
    return json({
      erro: "Erro servidor: " + String(err && err.message || err)
    }, 500);
  }
}