// Cloudflare Pages Function
// Recebe o postback da MyLead quando um usuário completa uma oferta,
// e credita os pontos correspondentes no Firestore (coleção "usuarios").
//
// URL desta função depois de publicada: https://SEUDOMINIO/postback-mylead

const FIREBASE_PROJECT_ID = "desafio-moz-61b70";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

export async function onRequestGet({ request }) {
  try {
    const url = new URL(request.url);

    // Tolerante a variações de nome de parâmetro, caso a MyLead use
    // um nome ligeiramente diferente do esperado.
    const playerId =
      url.searchParams.get("player_id") ||
      url.searchParams.get("playerid") ||
      url.searchParams.get("user_id");

    const transactionId =
      url.searchParams.get("transaction_id") ||
      url.searchParams.get("transactionid") ||
      url.searchParams.get("txid");

    const amount =
      url.searchParams.get("amount") ||
      url.searchParams.get("payout_decimal") ||
      url.searchParams.get("reward") ||
      "0";

    const status = url.searchParams.get("status") || "1";

    if (!transactionId || !playerId) {
      return new Response("0", { status: 400 });
    }

    // 1. Evita crédito duplicado se o mesmo aviso chegar mais de uma vez
    const idempKey = `mylead_${transactionId}`;
    const checkRes = await fetch(`${FIRESTORE_BASE}/postbacksProcessados/${encodeURIComponent(idempKey)}`);
    if (checkRes.status === 200) {
      return new Response("1", { status: 200 });
    }

    // Só credita se o status indicar aprovado (status "1" ou "approved")
    const statusAprovado = status === "1" || status.toLowerCase() === "approved";

    // 2. O player_id agora é um UUID — precisamos descobrir o e-mail
    //    associado a ele (guardado quando o usuário abriu o mylead.html).
    let emailDecoded = null;
    if (statusAprovado) {
      const playerRes = await fetch(`${FIRESTORE_BASE}/myleadPlayers/${encodeURIComponent(playerId)}`);
      if (playerRes.status === 200) {
        const playerData = await playerRes.json();
        emailDecoded = playerData?.fields?.email?.stringValue || null;
      }
    }

    if (statusAprovado && emailDecoded) {
      // 3. Busca o usuário no Firestore pelo campo "email"
      const queryBody = {
        structuredQuery: {
          from: [{ collectionId: "usuarios" }],
          where: {
            fieldFilter: {
              field: { fieldPath: "email" },
              op: "EQUAL",
              value: { stringValue: emailDecoded },
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
        const points = Math.round(Number(amount)) || 0;

        const commitBody = {
          writes: [
            {
              transform: {
                document: docPath,
                fieldTransforms: [
                  {
                    fieldPath: "pontos",
                    increment: { integerValue: points },
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

    // 3. Marca este aviso como processado
    await fetch(`${FIRESTORE_BASE}/postbacksProcessados/${encodeURIComponent(idempKey)}?documentId=${encodeURIComponent(idempKey)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          origem: { stringValue: "mylead" },
          playerId: { stringValue: playerId || "" },
          status: { stringValue: status || "" },
          amount: { stringValue: String(amount) },
          processedAt: { timestampValue: new Date().toISOString() },
        },
      }),
    });

    return new Response("1", { status: 200 });
  } catch (err) {
    return new Response("0", { status: 500 });
  }
}
