// Cloudflare Pages Function
// Recebe o postback da CPX Research quando um usuário completa uma oferta,
// e credita os pontos correspondentes no Firestore (coleção "usuarios").
//
// URL desta função depois de publicada: https://SEUDOMINIO/postback-cpx

const FIREBASE_PROJECT_ID = "desafio-moz-61b70";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

export async function onRequestGet({ request }) {
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status");
    const transId = url.searchParams.get("trans_id");
    const userId = url.searchParams.get("user_id"); // e-mail do usuário
    const amountLocal = url.searchParams.get("amount_local"); // já em "pontos", conforme configuramos no CPX

    if (!transId || !userId) {
      return new Response("0", { status: 400 });
    }

    // 1. Verifica se este trans_id já foi processado antes (evita crédito duplicado)
    const checkRes = await fetch(`${FIRESTORE_BASE}/cpxPostbacks/${encodeURIComponent(transId)}`);
    if (checkRes.status === 200) {
      // já processado antes, responde OK sem creditar de novo
      return new Response("1", { status: 200 });
    }

    // Só credita pontos se status = 1 (oferta confirmada/completa)
    if (status === "1") {
      const emailDecoded = decodeURIComponent(userId);

      // 2. Busca o usuário no Firestore pelo campo "email"
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
        const docPath = match.document.name; // caminho completo do documento

        // 3. Credita os pontos usando um "increment" atômico
        const points = Number(amountLocal) || 0;
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

    // 4. Marca este trans_id como processado (guarda um registo simples)
    await fetch(`${FIRESTORE_BASE}/cpxPostbacks/${encodeURIComponent(transId)}?documentId=${encodeURIComponent(transId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          userId: { stringValue: userId },
          status: { stringValue: status || "" },
          amountLocal: { stringValue: amountLocal || "0" },
          processedAt: { timestampValue: new Date().toISOString() },
        },
      }),
    });

    return new Response("1", { status: 200 });
  } catch (err) {
    return new Response("0", { status: 500 });
  }
}
