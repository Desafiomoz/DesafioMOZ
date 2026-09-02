// Cloudflare Pages Function — o jogo pergunta se o pagamento já foi confirmado
// URL: https://SEUDOMINIO/netshop-status?id=CHARGE_ID

const PROJECT = "desafio-moz-61b70";
const DOC_ROOT = "projects/" + PROJECT + "/databases/(default)/documents";
const FS_API = "https://firestore.googleapis.com/v1/" + DOC_ROOT;

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type"
    }
  });
}

function sleep(ms) {
  return new Promise(function (resolve) {
    setTimeout(resolve, ms);
  });
}

async function jaCreditado(chargeId) {
  try {
    var r = await fetch(
      FS_API + "/lojaCargas/" + encodeURIComponent(chargeId)
    );
    return r.status === 200;
  } catch (e) {
    return false;
  }
}

export async function onRequestOptions() {
  return json({}, 204);
}

export async function onRequestGet({ request, env }) {
  try {
    var url = new URL(request.url);
    var chargeId = url.searchParams.get("id");
    if (!chargeId) {
      return json({ erro: "Falta o id da cobrança" }, 400);
    }

    if (!env.NETSHOP_API_KEY || !env.NETSHOP_WALLET_ID) {
      return json({ status: "erro" }, 500);
    }

    var resp = await fetch(
      "https://www.netshop.co.mz/api/v1/charges/" + encodeURIComponent(chargeId),
      {
        headers: {
          Authorization: "Bearer " + env.NETSHOP_API_KEY,
          "X-Wallet-ID": env.NETSHOP_WALLET_ID
        }
      }
    );

    var cobranca = await resp.json();
    if (!resp.ok) {
      return json({ status: "erro" }, 502);
    }

    var estado = String(cobranca.status || "").toLowerCase();

    if (
      estado === "failed" ||
      estado === "cancelled" ||
      estado === "canceled" ||
      estado === "expired"
    ) {
      return json({ status: "failed" }, 200);
    }

    if (
      estado !== "paid" &&
      estado !== "succeeded" &&
      estado !== "completed"
    ) {
      return json({ status: "pending" }, 200);
    }

    var credited = false;
    for (var i = 0; i < 4; i++) {
      credited = await jaCreditado(chargeId);
      if (credited) break;
      await sleep(2000);
    }

    return json({
      status: "paid",
      credited: true,
      diagnostico: {
        chargeIdRecebido: chargeId,
        estadoNetShop: estado,
        lojaCargas: credited
      }
    }, 200);
  } catch (err) {
    return json({
      status: "erro",
      diagnostico: { mensagem: String(err && err.message || err) }
    }, 500);
  }
}
