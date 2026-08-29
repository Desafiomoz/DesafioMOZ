// Cloudflare Pages Function
// O jogo pergunta a esta função, repetidamente, "este pagamento já foi feito?"
// Esta função é que pergunta à NetShop (pedido a sair do nosso servidor, não a entrar —
// por isso não é bloqueado pela proteção anti-bot do domínio pages.dev, ao contrário
// de um webhook que a NetShop tentasse mandar para nós).
//
// URL desta função depois de publicada: https://SEUDOMINIO/netshop-status?id=CHARGE_ID

const FIREBASE_PROJECT_ID = "desafio-moz-61b70";
const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

const ESTADOS_PAGOS = ["paid", "succeeded", "completed", "success"];
const ESTADOS_FALHADOS = ["failed", "expired", "cancelled", "canceled", "declined"];

export async function onRequestGet({ request, env }) {
  try {
    const url = new URL(request.url);
    const chargeId = url.searchParams.get("id");
    if (!chargeId) return json({ erro: "Falta o id da cobrança" }, 400);

    // 1. Pergunta à NetShop qual é o estado atual desta cobrança
    const resp = await fetch(`https://www.netshop.co.mz/api/v1/charges/${encodeURIComponent(chargeId)}`, {
      headers: {
        "Authorization": `Bearer ${env.NETSHOP_API_KEY}`,
        "X-Wallet-ID": env.NETSHOP_WALLET_ID,
      },
    });
    const cobranca = await resp.json();
    if (!resp.ok) return json({ status: "erro" }, 502);

    const estado = (cobranca.status || "").toLowerCase();

    if (ESTADOS_FALHADOS.includes(estado)) {
      return json({ status: "failed", motivo: cobranca.failed_reason || null }, 200);
    }
    if (!ESTADOS_PAGOS.includes(estado)) {
      return json({ status: "pending" }, 200); // ainda a aguardar confirmação do jogador no telemóvel
    }

    // 2. Já está pago — verifica se já não foi processado antes (evita creditar duas vezes)
    const jaProcessado = await fetch(`${FIRESTORE_BASE}/lojaCargas/${encodeURIComponent(chargeId)}`);
    if (jaProcessado.status === 200) {
      return json({ status: "paid", credited: true }, 200); // já tinha sido creditado — só confirma ao jogo
    }

    // 3. Extrai o item comprado e o e-mail a partir do metadata que enviámos ao criar a cobrança
    const meta = cobranca.metadata || {};
    const item = meta.item;
    const email = meta.email;
    if (!item || !email) {
      return json({ status: "paid", credited: false, erro: "metadata em falta na cobrança" }, 200);
    }

    await creditarCompra(item, email);

    // 4. Marca esta cobrança como processada, para nunca mais creditar de novo
    await fetch(`${FIRESTORE_BASE}/lojaCargas/${encodeURIComponent(chargeId)}?documentId=${encodeURIComponent(chargeId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          item: { stringValue: item },
          email: { stringValue: email },
          processedAt: { timestampValue: new Date().toISOString() },
        },
      }),
    });

    return json({ status: "paid", credited: true }, 200);
  } catch (err) {
    return json({ status: "erro" }, 500);
  }
}

async function creditarCompra(item, email) {
  const docPath = `${FIRESTORE_BASE}/jogoEstado/${encodeURIComponent(email)}`;

  if (item === "bonus" || item === "bonus2") {
    // atualiza só "vidas" e "proximaRecarga" (updateMask) — sem isto, o PATCH apagaria os outros campos do documento
    const urlComMask = `${docPath}?updateMask.fieldPaths=vidas&updateMask.fieldPaths=proximaRecarga`;
    await fetch(urlComMask, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          vidas: { integerValue: 5 }, // o jogo tem um máximo de 5 vidas — "8 vidas" do pacote enche a barra e o resto fica como bónus de moedas/ajudas/jogadas
          proximaRecarga: { integerValue: 0 },
        },
      }),
    });
    if (item === "bonus") {
      await commitIncrementos(docPath, { moedasTotais: 70, ajudasDisponiveis: 6, jogadasExtraArmazenadas: 10 });
    } else {
      await commitIncrementos(docPath, { moedasTotais: 100, ajudasDisponiveis: 20, jogadasExtraArmazenadas: 20 });
    }
    return;
  }

  if (item === "moedas30") return commitIncrementos(docPath, { moedasTotais: 30 });
  if (item === "moedas70") return commitIncrementos(docPath, { moedasTotais: 70 });
  if (item === "ajudas20") return commitIncrementos(docPath, { ajudasDisponiveis: 20 });
  if (item === "jogadas10") return commitIncrementos(docPath, { jogadasExtraArmazenadas: 10 });
  // "jogadasOferta20" não credita nada aqui — é aplicado de imediato no telemóvel do jogador (partida em curso)
}

async function commitIncrementos(docPath, incrementos) {
  const fieldTransforms = Object.entries(incrementos).map(([campo, valor]) => ({
    fieldPath: campo,
    increment: { integerValue: valor },
  }));
  await fetch(`${FIRESTORE_BASE}:commit`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      writes: [{ transform: { document: docPath, fieldTransforms } }],
    }),
  });
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
