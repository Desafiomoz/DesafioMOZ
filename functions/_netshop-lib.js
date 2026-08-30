// Biblioteca partilhada entre netshop-charge.js, netshop-status.js e netshop-webhook.js
// Ficheiros que começam com "_" não viram rotas do site — só podem ser importados por outras Functions.
//
// TUDO o que uma compra custa e TUDO o que ela entrega vive só AQUI, numa única tabela.
// Isto existe para nunca mais haver um item "esquecido" ou desalinhado entre o preço e o que é entregue.

export const FIREBASE_PROJECT_ID = "desafio-moz-61b70";
export const FIRESTORE_BASE = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/(default)/documents`;

export const ESTADOS_PAGOS = ["paid", "succeeded", "completed", "success"];
export const ESTADOS_FALHADOS = ["failed", "expired", "cancelled", "canceled", "declined"];

// vidas: se definido, PÕE as vidas neste valor exato (não soma)
// credito: campos que SOMAM ao que o jogador já tinha (moedas, ajudas, jogadas, níveis)
// flag: campo booleano que passa a "true" para sempre (moedas/ajudas infinitas)
export const ITENS_LOJA = {
  moedas30:        { mt: 2,   descricao: "30 moedas",                                   credito: { moedasTotais: 30 } },
  moedas70:        { mt: 4,   descricao: "70 moedas",                                   credito: { moedasTotais: 70 } },
  ajudas20:        { mt: 2,   descricao: "20 ajudas",                                   credito: { ajudasDisponiveis: 20 } },
  jogadas10:       { mt: 2,   descricao: "10 jogadas extra",                            credito: { jogadasExtraArmazenadas: 10 } },
  jogadasOferta20: { mt: 2,   descricao: "20 jogadas (continuação imediata)",            credito: null }, // aplicado no telemóvel, não no servidor
  bonus:           { mt: 5,   descricao: "Bónus: 6 vidas + 70 moedas + 6 ajudas + 10 jogadas",       vidas: 6, credito: { moedasTotais: 70, ajudasDisponiveis: 6, jogadasExtraArmazenadas: 10 } },
  bonus2:          { mt: 10,  descricao: "Bónus grande: 8 vidas + 100 moedas + 20 ajudas + 20 jogadas", vidas: 8, credito: { moedasTotais: 100, ajudasDisponiveis: 20, jogadasExtraArmazenadas: 20 } },
  moedasInfinitas: { mt: 100, descricao: "Moedas infinitas",                            flag: "moedasInfinitas" },
  ajudasInfinitas: { mt: 50,  descricao: "Ajudas infinitas",                            flag: "ajudasInfinitas" },
  desbloqueio10:   { mt: 15,  descricao: "Desbloqueio de 10 níveis",                     credito: { nivelDesbloqueado: 10 } },
};

export async function commitIncrementos(docPath, incrementos) {
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

export async function creditarCompra(item, email) {
  const def = ITENS_LOJA[item];
  if (!def) { console.error("Item desconhecido ao creditar:", item); return; }

  const docPath = `${FIRESTORE_BASE}/jogoEstado/${encodeURIComponent(email)}`;

  if (def.vidas) {
    const urlComMask = `${docPath}?updateMask.fieldPaths=vidas&updateMask.fieldPaths=proximaRecarga`;
    await fetch(urlComMask, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          vidas: { integerValue: def.vidas },
          proximaRecarga: { integerValue: 0 },
        },
      }),
    });
  }

  if (def.flag) {
    await fetch(`${docPath}?updateMask.fieldPaths=${def.flag}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fields: { [def.flag]: { booleanValue: true } } }),
    });
  }

  if (def.credito) {
    await commitIncrementos(docPath, def.credito);
  }
}

// pedido guardado no Firebase logo a seguir a criar a cobrança — guardado com o PRÓPRIO ID da
// cobrança (não uma referência à parte), para nunca depender de a NetShop devolver mais nada
// além do id, que sabemos sempre com certeza.
export async function guardarPedido(chargeId, item, email) {
  await fetch(`${FIRESTORE_BASE}/pedidosLoja/${encodeURIComponent(chargeId)}?documentId=${encodeURIComponent(chargeId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: {
        item: { stringValue: item },
        email: { stringValue: email },
        criadoEm: { timestampValue: new Date().toISOString() },
      },
    }),
  });
}

export async function buscarPedido(chargeId) {
  const resp = await fetch(`${FIRESTORE_BASE}/pedidosLoja/${encodeURIComponent(chargeId)}`);
  if (resp.status !== 200) return null;
  const doc = await resp.json();
  return {
    item: doc.fields?.item?.stringValue,
    email: doc.fields?.email?.stringValue,
  };
}

export async function jaProcessado(chargeId) {
  const resp = await fetch(`${FIRESTORE_BASE}/lojaCargas/${encodeURIComponent(chargeId)}`);
  return resp.status === 200;
}

export async function marcarProcessado(chargeId, item, email) {
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
}

// processa uma cobrança confirmada como paga — usado tanto pelo webhook como pelo polling,
// para nunca haver duas versões diferentes da mesma lógica de crédito.
export async function processarCobrancaPaga(chargeId) {
  if (await jaProcessado(chargeId)) return { credited: true }; // já tinha sido processada — nada a fazer

  const pedido = await buscarPedido(chargeId);
  if (!pedido || !pedido.item || !pedido.email) {
    console.error("Pedido original não encontrado para a cobrança", chargeId);
    return { credited: false };
  }

  await creditarCompra(pedido.item, pedido.email);
  await marcarProcessado(chargeId, pedido.item, pedido.email);
  return { credited: true, item: pedido.item, email: pedido.email };
}
