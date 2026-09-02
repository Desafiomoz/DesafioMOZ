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
      return json({ status: "erro", erro: "Config em falta" }, 500);
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

    // paid: verifica se a Pipedream já creditou
    var credited = false;
    try {
      var r = await fetch(
        FS_API + "/lojaCargas/" + encodeURIComponent(chargeId)
      );
      credited = r.status === 200;
    } catch (e) {
      credited = false;
    }

    return json({
      status: "paid",
      credited: credited,
      diagnostico: {
        chargeIdRecebido: chargeId,
        estadoNetShop: estado
      }
    }, 200);
  } catch (err) {
    console.error("Erro ao verificar estado:", err);
    return json({
      status: "erro",
      diagnostico: { mensagem: String(err && err.message || err) }
    }, 500);
  }
}