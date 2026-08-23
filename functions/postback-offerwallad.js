// Cloudflare Pages Function - Postback Offerwall.ad
// URL: https://desafiomoz.pages.dev/postback-offerwallad?uid={subid}&amount={payout}&transaction_id={transaction_id}&offer_id={offer_id}&status={event}

const FIREBASE_PROJECT_ID = "desafio-moz-61b70";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const PONTOS_POR_DOLLAR = 100;

// Senha da Offerwall.ad (se usares password no postback). Deixa vazio se não usares.
const CALLBACK_PASSWORD = "601879b9e6613bba6c725c5041ac9373c03f284b55d696ce"; // cola a senha completa se for diferente

export async function onRequestGet({ request }) {
  try {
    const url = new URL(request.url);

    // Password (opcional)
    const password =
      url.searchParams.get("password") ||
      url.searchParams.get("senha") ||
      url.searchParams.get("secret") ||
      "";

    if (CALLBACK_PASSWORD && password && password !== CALLBACK_PASSWORD) {
      return new Response("0", { status: 403 });
    }

    // Parâmetros da Offerwall.ad
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

    const offerId = url.searchParams.get("offer_id") || "";

    // amount = {payout} em dólares
    const payout = parseFloat(
      url.searchParams.get("amount") ||
      url.searchParams.get("payout") ||
      "0"
    );

    const pontos = Math.round(payout * PONTOS_POR_DOLLAR);

    const status = (
      url.searchParams.get("status") ||
      url.searchParams.get("event") ||
      ""
    ).toLowerCase();

    if (!uid) {
      return new Response("0", { status: 400 });
    }

    // Evitar processar 2 vezes a mesma conversão
    const idempKey = `offerwallad_${transactionId}`;
    try {
      const checkRes = await fetch(
        `\( {FIRESTORE_BASE}/postbacksProcessados/ \){encodeURIComponent(idempKey)}`
      );
      if (checkRes.status === 200) {
        return new Response("1", { status: 200 });
      }
    } catch (e) {}

    // Só creditar se for aprovação
    const aprovado =
      status === "1" ||
      status === "approved" ||
      status === "conversion.approved" ||
      status === "conversion.released" ||
      status === "completed" ||
      status === "ok" ||
      status === "credited" ||
      status === "";

    if (aprovado && pontos > 0) {
      const email = decodeURIComponent(uid).toLowerCase().trim();

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

        // Somar pontos
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

    // Guardar que já processámos este transaction_id
    try {
      await fetch(
        `\( {FIRESTORE_BASE}/postbacksProcessados/ \){encodeURIComponent(idempKey)}?documentId=${encodeURIComponent(idempKey)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: {
              uid: { stringValue: uid },
              offerId: { stringValue: offerId },
              payout: { stringValue: String(payout) },
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