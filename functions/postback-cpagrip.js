// Cloudflare Pages Function - Postback CPAGrip (versão completa)
const FIREBASE_PROJECT_ID = "desafio-moz-61b70";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const PONTOS_POR_DOLLAR = 100;

export async function onRequestGet({ request }) {
  try {
    const url = new URL(request.url);

    const trackingId =
      url.searchParams.get("tracking_id") ||
      url.searchParams.get("subid") ||
      url.searchParams.get("user_id") ||
      "";

    const transactionId =
      url.searchParams.get("transaction_id") ||
      url.searchParams.get("txid") ||
      Date.now().toString();

    const payout = parseFloat(
      url.searchParams.get("payout") ||
      url.searchParams.get("amount") ||
      "0"
    );

    const status = (url.searchParams.get("status") || "1").toLowerCase();

    if (!trackingId) {
      return new Response("0", { status: 400 });
    }

    // Evitar duplicados
    const idempKey = `cpagrip_${transactionId}`;
    try {
      const checkRes = await fetch(
        `\( {FIRESTORE_BASE}/postbacksProcessados/ \){encodeURIComponent(idempKey)}`
      );
      if (checkRes.status === 200) {
        return new Response("1", { status: 200 });
      }
    } catch (e) {}

    const aprovado = status === "1" || status === "approved" || status === "completed" || status === "ok";

    if (aprovado && payout > 0) {
      const pontos = Math.round(payout * PONTOS_POR_DOLLAR);
      const email = decodeURIComponent(trackingId).toLowerCase().trim();

      // Procurar utilizador pelo email
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

    // Marcar como processado
    try {
      await fetch(
        `\( {FIRESTORE_BASE}/postbacksProcessados/ \){encodeURIComponent(idempKey)}?documentId=${encodeURIComponent(idempKey)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: {
              trackingId: { stringValue: trackingId },
              payout: { stringValue: String(payout) },
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