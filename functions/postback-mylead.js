// Cloudflare Pages Function - Postback MyLead
const FIREBASE_PROJECT_ID = "desafio-moz-61b70";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const PONTOS_POR_DOLLAR = 100;

export async function onRequestGet({ request }) {
  try {
    const url = new URL(request.url);

    const playerId =
      url.searchParams.get("player_id") ||
      url.searchParams.get("playerid") ||
      url.searchParams.get("user_id") ||
      "";

    const transactionId =
      url.searchParams.get("transaction_id") ||
      url.searchParams.get("transactionid") ||
      url.searchParams.get("txid") ||
      "";

    const amount = parseFloat(
      url.searchParams.get("amount") ||
      url.searchParams.get("payout_decimal") ||
      "0"
    );

    const virtualAmount = parseFloat(
      url.searchParams.get("virtual_amount") || "0"
    );

    const status = (url.searchParams.get("status") || "1").toString();

    if (!transactionId || !playerId) {
      return new Response("0", { status: 400 });
    }

    // Evitar duplicados
    const idempKey = `mylead_${transactionId}`;
    try {
      const checkRes = await fetch(
        `\( {FIRESTORE_BASE}/postbacksProcessados/ \){encodeURIComponent(idempKey)}`
      );
      if (checkRes.status === 200) {
        return new Response("1", { status: 200 });
      }
    } catch (e) {}

    const statusAprovado =
      status === "1" ||
      status === "2" ||
      status.toLowerCase() === "approved";

    // Calcular pontos
    let pontos = 0;
    if (virtualAmount > 0) {
      pontos = Math.round(virtualAmount);
    } else if (amount > 0) {
      // se amount for pequeno (< 10) trata como dólares
      pontos = amount < 10
        ? Math.round(amount * PONTOS_POR_DOLLAR)
        : Math.round(amount);
    }

    let emailDecoded = null;

    if (statusAprovado) {
      // 1) Se player_id já parece email, usa directamente
      if (playerId.includes("@")) {
        emailDecoded = decodeURIComponent(playerId).toLowerCase().trim();
      } else {
        // 2) Senão, tenta mapear UUID → email
        try {
          const playerRes = await fetch(
            `\( {FIRESTORE_BASE}/myleadPlayers/ \){encodeURIComponent(playerId)}`
          );
          if (playerRes.status === 200) {
            const playerData = await playerRes.json();
            emailDecoded = playerData?.fields?.email?.stringValue || null;
          }
        } catch (e) {}
      }
    }

    if (statusAprovado && emailDecoded && pontos > 0) {
      const queryBody = {
        structuredQuery: {
          from: [{ collectionId: "usuarios" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "email" },
              op: "EQUAL",
              value: { stringValue: emailDecoded }
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
      const match = Array.isArray(queryData)
        ? queryData.find((r) => r.document)
        : null;

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
              origem: { stringValue: "mylead" },
              playerId: { stringValue: playerId },
              email: { stringValue: emailDecoded || "" },
              status: { stringValue: status },
              amount: { stringValue: String(amount) },
              pontos: { stringValue: String(pontos) },
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