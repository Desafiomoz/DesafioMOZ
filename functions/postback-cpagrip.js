// Cloudflare Pages Function - Postback CPAGrip
// URL final: https://desafiomoz.pages.dev/postback-cpagrip

const FIREBASE_PROJECT_ID = "desafio-moz-61b70";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

// Quantos pontos o utilizador ganha por cada $1 de payout
// Exemplo: payout $0.50 → 50 pontos
const PONTOS_POR_DOLLAR = 100;

export async function onRequestGet({ request }) {
  try {
    const url = new URL(request.url);

    // Parâmetros que o CPAGrip envia
    const trackingId =
      url.searchParams.get("tracking_id") ||
      url.searchParams.get("subid") ||
      url.searchParams.get("user_id") ||
      url.searchParams.get("sid");

    const transactionId =
      url.searchParams.get("transaction_id") ||
      url.searchParams.get("txid") ||
      url.searchParams.get("trans_id") ||
      Date.now().toString();

    const payout = parseFloat(
      url.searchParams.get("payout") ||
      url.searchParams.get("amount") ||
      url.searchParams.get("revenue") ||
      "0"
    );

    const status =
      url.searchParams.get("status") ||
      url.searchParams.get("event") ||
      "1";

    // Se não vier tracking_id, rejeita
    if (!trackingId) {
      return new Response("0", { status: 400 });
    }

    // Evitar processar o mesmo postback duas vezes
    const idempKey = `cpagrip_${transactionId}`;
    const checkRes = await fetch(
      `\( {FIRESTORE_BASE}/postbacksProcessados/ \){encodeURIComponent(idempKey)}`
    );
    if (checkRes.status === 200) {
      return new Response("1", { status: 200 });
    }

    // Verificar se a conversão foi aprovada
    const statusAprovado =
      status === "1" ||
      status.toLowerCase() === "approved" ||
      status.toLowerCase() === "completed" ||
      status === "ok";

    if (statusAprovado && payout > 0) {
      const pontos = Math.round(payout * PONTOS_POR_DOLLAR);
      const email = decodeURIComponent(trackingId).toLowerCase().trim();

      // Procurar o utilizador pelo email no Firestore
      const queryBody = {
        structuredQuery: {
          from: [{ collectionId: "usuarios" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "email" },
              op: "EQUAL",
              value: { stringValue: email },
            },
          },
          limit: 1,
        },
      };

      const queryRes = await fetch(`${FIRESTORE_BASE}:runQuery`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(queryBody),
      });

      const queryData = await queryRes.json();
      const match = queryData.find((r) => r.document);

      if (match && match.document) {
        const docPath = match.document.name;

        // Adicionar os pontos na conta do utilizador
        const commitBody = {
          writes: [
            {
              transform: {
                document: docPath,
                fieldTransforms: [
                  {
                    fieldPath: "pontos",
                    increment: { integerValue: pontos },
                  },
                ],
              },
            },
          ],
        };

        await fetch(`${FIRESTORE_BASE}:commit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(commitBody),
        });
      }
    }

    // Guardar que este postback já foi processado
    await fetch(
      `\( {FIRESTORE_BASE}/postbacksProcessados/ \){encodeURIComponent(idempKey)}?documentId=${encodeURIComponent(idempKey)}`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: {
            trackingId: { stringValue: trackingId || "" },
            payout: { stringValue: String(payout) },
            status: { stringValue: status || "" },
            processedAt: { timestampValue: new Date().toISOString() },
          },
        }),
      }
    );

    return new Response("1", { status: 200 });
  } catch (err) {
    return new Response("0", { status: 500 });
  }
}