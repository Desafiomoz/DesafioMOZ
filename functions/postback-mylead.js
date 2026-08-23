// DEBUG - Postback MyLead
const FIREBASE_PROJECT_ID = "desafio-moz-61b70";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;
const PONTOS_POR_DOLLAR = 100;

export async function onRequestGet({ request }) {
  const url = new URL(request.url);

  const playerId =
    url.searchParams.get("player_id") ||
    url.searchParams.get("uid") ||
    "";

  const transactionId =
    url.searchParams.get("transaction_id") ||
    "sem_id";

  const amount = parseFloat(url.searchParams.get("amount") || "0");
  const virtualAmount = parseFloat(url.searchParams.get("virtual_amount") || "0");
  const status = (url.searchParams.get("status") || "").toString();

  let pontos = 0;
  if (virtualAmount > 0) {
    pontos = Math.round(virtualAmount);
  } else if (amount > 0) {
    pontos = Math.round(amount * PONTOS_POR_DOLLAR);
  }

  const email = decodeURIComponent(playerId).toLowerCase().trim();

  let userFound = false;
  let docPath = "";
  let writeOk = false;
  let erro = "";

  try {
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
      userFound = true;
      docPath = match.document.name;

      if (pontos > 0) {
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

        const writeRes = await fetch(`${FIRESTORE_BASE}:commit`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(commitBody)
        });

        writeOk = writeRes.ok;
        if (!writeOk) {
          erro = await writeRes.text();
        }
      }
    }
  } catch (e) {
    erro = e.message || String(e);
  }

  // Resposta em JSON para veres o que aconteceu
  return new Response(JSON.stringify({
    ok: true,
    email: email,
    pontos_a_creditar: pontos,
    status: status,
    userFound: userFound,
    writeOk: writeOk,
    docPath: docPath,
    erro: erro,
    transactionId: transactionId
  }, null, 2), {
    status: 200,
    headers: { "Content-Type": "application/json" }
  });
}