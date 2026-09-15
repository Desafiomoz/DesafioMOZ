// Cloudflare Pages Function — cria cobrança NetShop (Homejub + Roleta, mesma carteira)
// URL: https://SEUDOMINIO/netshop-charge  (POST JSON)

const PROJECT = "desafio-moz-61b70";
const DOC_ROOT = "projects/" + PROJECT + "/databases/(default)/documents";
const FS_API = "https://firestore.googleapis.com/v1/" + DOC_ROOT;

// Homejub (loja) + Roleta (tiers fixos)
const ITENS_LOJA = {
  // —— Homejub ——
  moedas30: { mt: 2 },
  moedas70: { mt: 4 },
  ajudas20: { mt: 2 },
  jogadas10: { mt: 2 },
  jogadasOferta20: { mt: 2 },
  bonus: { mt: 5 },
  bonus2: { mt: 10 },
  moedasInfinitas: { mt: 100 },
  ajudasInfinitas: { mt: 50 },
  desbloqueio10: { mt: 15 },
  // —— Roleta (tiers) ——
  roleta_2: { mt: 2 },
  roleta_5: { mt: 5 },
  roleta_10: { mt: 10 }
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

/** Resolve item Homejub ou Roleta (inclui roleta_giros_N para valor custom ≥ 2 MT) */
function resolverPedido(item, body) {
  item = String(item || "").trim();
  if (ITENS_LOJA[item]) {
    return { item: item, mt: ITENS_LOJA[item].mt, jogo: item.indexOf("roleta") === 0 ? "roleta" : "homejub" };
  }
  // Roleta valor livre: roleta_giros_3 → 3 MT (mínimo 2)
  var m = /^roleta_giros_(\d+)$/.exec(item);
  if (m) {
    var mt = parseInt(m[1], 10);
    if (mt >= 2 && mt <= 500) {
      return { item: item, mt: mt, jogo: "roleta" };
    }
  }
  if (item === "roleta_custom") {
    var am = parseInt(body.amountMT || body.amount || "0", 10);
    if (am >= 2 && am <= 500) {
      return { item: "roleta_giros_" + am, mt: am, jogo: "roleta" };
    }
  }
  return null;
}

async function gravarDoc(colecao, id, item, email, extra) {
  if (!id) return;
  try {
    var fields = {
      email: { stringValue: String(email).trim().toLowerCase() },
      item: { stringValue: String(item) },
      createdAt: { timestampValue: new Date().toISOString() }
    };
    if (extra && extra.jogo) {
      fields.jogo = { stringValue: String(extra.jogo) };
    }
    if (extra && extra.mt != null) {
      fields.mt = { integerValue: String(extra.mt) };
    }
    if (extra && extra.giros != null) {
      fields.giros = { integerValue: String(extra.giros) };
    }
    var r = await fetch(
      FS_API + "/" + colecao + "/" + encodeURIComponent(String(id)),
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: fields })
      }
    );
    if (!r.ok) {
      console.error("gravar", colecao, id, r.status, await r.text());
    }
  } catch (e) {
    console.error("gravar", colecao, id, e);
  }
}

async function guardarTudo(data, item, email, reference, extra) {
  await gravarDoc("pedidosPorRef", reference, item, email, extra);

  var ids = {};
  function add(x) {
    if (typeof x === "string" && x.length >= 8) ids[x] = true;
  }
  add(data.id);
  add(data.uuid);
  add(data.charge_id);
  add(data.chargeId);
  var keys = Object.keys(data || {});
  for (var i = 0; i < keys.length; i++) {
    var v = data[keys[i]];
    if (typeof v !== "string") continue;
    if (v.indexOf("ch_") === 0) add(v);
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v)) {
      add(v);
    }
  }
  var list = Object.keys(ids);
  for (var j = 0; j < list.length; j++) {
    await gravarDoc("pedidosLoja", list[j], item, email, extra);
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
    var itemRaw = (body.item || "").trim();
    var girosPedido = parseInt(body.giros || "0", 10) || 0;

    var pedido = resolverPedido(itemRaw, body);
    if (!email || !msisdn || !pedido || method !== "mpesa") {
      return json({ erro: "Pedido inválido" }, 400);
    }
    if (!/^\+258\d{9}$/.test(msisdn)) {
      return json({
        erro: "Número inválido — usa +258XXXXXXXXX"
      }, 400);
    }
    if (!env.NETSHOP_API_KEY || !env.NETSHOP_WALLET_ID) {
      return json({ erro: "Falta NETSHOP_API_KEY ou WALLET_ID" }, 500);
    }

    var amountMT = pedido.mt;
    var item = pedido.item;
    var prefixo = pedido.jogo === "roleta" ? "RL" : "HJ";
    var referencia = prefixo + "-" + item + "-" + Date.now();

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
      console.error("NetShop:", resp.status, textoResposta);
      return json({
        erro: "NetShop " + resp.status + ": " + textoResposta.slice(0, 150)
      }, 502);
    }

    await guardarTudo(data, item, email, referencia, {
      jogo: pedido.jogo,
      mt: amountMT,
      giros: girosPedido || null
    });

    return json({
      id: data.id,
      status: data.status || "pending",
      reference: referencia,
      jogo: pedido.jogo,
      mt: amountMT
    }, 200);
  } catch (err) {
    console.error(err);
    return json({
      erro: "Erro: " + String(err && err.message || err)
    }, 500);
  }
}
