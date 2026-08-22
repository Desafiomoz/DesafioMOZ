// Cloudflare Pages Function - Postback Offerwall.ad
const FIREBASE_PROJECT_ID = "desafio-moz-61b70";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const PONTOS_POR_DOLLAR = 100;
const CALLBACK_PASSWORD = "7d2b30d98ad7b0fe463fc9e8519d7b84d56c83e9621868d5";

export async function onRequestGet({ request }) {
  try {
    const url = new URL(request.url);

    // Verificar password
    const password =
      url.searchParams.get("password") ||
      url.searchParams.get("secret") ||
      url.searchParams.get("token") ||
      "";

    if (password && password !== CALLBACK_PASSWORD) {
      return new Response("0", { status: 403 });
    }

    const uid =
      url.searchParams.get("uid") ||
      url.searchParams.get("subid") ||
      url.searchParams.get("user_id") ||
      "";

    const transactionId =
      url.searchParams.get("transaction_id") ||
      url.searchParams.get("conversion_id") ||
      url.searchParams.get("txid") ||
      Date.now().toString();

    let pontos = parseFloat(
      url.searchParams.get("amount") ||
      url.searchParams.get("reward") ||
      url.searchParams.get("points") ||
      "0"
    );

    const payout = parseFloat(
      url.searchParams.get("payout") ||
      url.searchParams.get("revenue") ||
      "0"
    );

    if (pontos <= 0 && payout > 0) {
      pontos = Math.round(payout * PONTOS_POR_DOLLAR);
    } else {
      pontos = Math.round(pontos);
    }

    const status = (
      url.searchParams.get("status") ||
      url.searchParams.get("event") ||
      "1"
    ).toLowerCase();

    if (!uid) {
      return new Response("0", { status: 400 });
    }

    // Evitar duplicados
    const idempKey = `offerwallad_${transactionId}`;
    try {
      const checkRes = await fetch(
        `\( {FIRESTORE_BASE}/postbacksProcessados/ \){encodeURIComponent(idempKey)}`
      );
      if (checkRes.status === 200) {
        return new Response("1", { status: 200 });
      }
    } catch (e) {}

    // Só creditar em conversões aprovadas
    const aprovado =
      status === "1" ||
      status === "approved" ||
      status === "conversion.approved" ||
      status === "completed" ||
      status === "ok" ||
      status === "credited" ||
      status === "conversion.released";

    if (aprovado && pontos > 0) {
      const email = decodeURIComponent(uid).toLowerCase().trim();

      const queryBody = {
        structuredQuery: {
          from: [{ collectionId: "usuarios" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "email" },
              op: "EQUAL",
              value: { stringValue: email }
            }
          },
          limit: 1
        }
      };

      const queryRes = await fetch(`${FIRESTORE_BASE}:runQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(queryBody)
      });

      const queryData = await queryRes.json();
      const match = Array.isArray(queryData) ? queryData.find(r => r.document) : null;

      if (match && match.document) {
        const docPath = match.document.name;
        const commitBody = {
          writes: [{
            transform: {
              document: docPath,
              fieldTransforms: [{
                fieldPath: "pontos",
                increment: { integerValue: String(pontos) }
              }]
            }
          }]
        };

        await fetch(`${FIRESTORE_BASE}:commit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(commitBody)
        });
      }
    }

    try {
      await fetch(
        `\( {FIRESTORE_BASE}/postbacksProcessados/ \){encodeURIComponent(idempKey)}?documentId=${encodeURIComponent(idempKey)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: {
              uid: { stringValue: uid },
              pontos: { stringValue: String(pontos) },
              status: { stringValue: status },
              processedAt: { timestampValue: new Date().toISOString() }
            }
          })
        }
      );
    } catch (e) {}

    return new Response("1", { status: 200 });
  } catch (err) {
    return new Response("0", { status: 500 });
  }
}

export async function onRequestPost(context) {
  return onRequestGet(context);
}