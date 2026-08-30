// Biblioteca partilhada entre netshop-charge, netshop-status e netshop-webhook.
// Ficheiros com "_" NÃO viram rota pública — só podem ser importados.
//
// Preço + entrega de cada item ficam AQUI (uma única fonte de verdade).

export const PROJECT_ID = "desafio-moz-61b70";
export const DOC_ROOT = `projects/${PROJECT_ID}/databases/(default)/documents`;
export const API_ROOT = `https://firestore.googleapis.com/v1/${DOC_ROOT}`;

export const ESTADOS_PAGOS = ["paid", "succeeded", "completed", "success"];
export const ESTADOS_FALHADOS = ["failed", "expired", "cancelled", "canceled", "declined"];

// vidas  → PÕE este valor exacto (não soma)
// credito → SOMA aos campos existentes
// flag   → boolean true permanente
// credito: null → aplicado só no telemóvel (ex.: jogadasOferta20)
export const ITENS_LOJA = {
  moedas30:        { mt: 2,   descricao: "30 moedas", credito: { moedasTotais: 30 } },
  moedas70:        { mt: 4,   descricao: "70 moedas", credito: { moedasTotais: 70 } },
  ajudas20:        { mt: 2,   descricao: "20 ajudas", credito: { ajudasDisponiveis: 20 } },
  jogadas10:       { mt: 2,   descricao: "10 jogadas extra", credito: { jogadasExtraArmazenadas: 10 } },
  jogadasOferta20: { mt: 2,   descricao: "20 jogadas (continuação imediata)", credito: null },
  bonus: {
    mt: 5,
    descricao: "Bónus: 6 vidas + 70 moedas + 6 ajudas + 10 jogadas",
    vidas: 6,
    credito: { moedasTotais: 70, ajudasDisponiveis: 6, jogadasExtraArmazenadas: 10 },
  },
  bonus2: {
    mt: 10,
    descricao: "Bónus grande: 8 vidas + 100 moedas + 20 ajudas + 20 jogadas",
    vidas: 8,
    credito: { moedasTotais: 100, ajudasDisponiveis: 20, jogadasExtraArmazenadas: 20 },
  },
  moedasInfinitas: { mt: 100, descricao: "Moedas infinitas", flag: "moedasInfinitas" },
  ajudasInfinitas: { mt: 50,  descricao: "Ajudas infinitas", flag: "ajudasInfinitas" },
  desbloqueio10:   { mt: 15,  descricao: "Desbloqueio de 10 níveis", credito: { nivelDesbloqueado: 10 } },
};

/** Incremento atómico. documentName = resource name SEM https:// */
export async function commitIncrementos(documentName, incrementos) {
  const fieldTransforms = Object.entries(incrementos).map(([campo, valor]) => ({
    fieldPath: campo,
    increment: { integerValue: String(valor) },
  }));
  const res = await fetch(
    `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents:commit`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        writes: [{ transform: { document: documentName, fieldTransforms } }],
      }),
    }
  );
  if (!res.ok) {
    const t = await res.text();
    console.error("Firestore commit falhou:", res.status, t, documentName);
    throw new Error("commit_failed");
  }
}

export async function creditarCompra(item, email) {
  const def = ITENS_LOJA[item];
  if (!def) {
    console.error("Item desconhecido ao creditar:", item);
    return;
  }

  email = String(email).trim().toLowerCase();
  const documentName = `${DOC_ROOT}/jogoEstado/${email}`;
  const docUrl = `${API_ROOT}/jogoEstado/${encodeURIComponent(email)}`;

  if (def.vidas != null) {
    const res = await fetch(
      `${docUrl}?updateMask.fieldPaths=vidas&updateMask.fieldPaths=proximaRecarga`,
      {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fields: {
            vidas: { integerValue: String(def.vidas) },
            proximaRecarga: { integerValue: "0" },
          },
        }),
      }
    );
    if (!res.ok) console.error("PATCH vidas falhou:", res.status, await res.text());
  }

  if (def.flag) {
    const res = await fetch(`${docUrl}?updateMask.fieldPaths=${def.flag}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: { [def.flag]: { booleanValue: true } },
      }),
    });
    if (!res.ok) console.error("PATCH flag falhou:", res.status, await res.text());
  }

  if (def.credito) {
    await commitIncrementos(documentName, def.credito);
  }
}

/** Guarda item+email com o ID real da cobrança NetShop */
export async function guardarPedido(chargeId, item, email) {
  const res = await fetch(
    `${API_ROOT}/pedidosLoja/${encodeURIComponent(chargeId)}?documentId=${encodeURIComponent(chargeId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          item: { stringValue: item },
          email: { stringValue: String(email).trim().toLowerCase() },
          criadoEm: { timestampValue: new Date().toISOString() },
        },
      }),
    }
  );
  if (!res.ok) {
    console.error("guardarPedido falhou:", res.status, await res.text());
    throw new Error("guardar_pedido_failed");
  }
}

export async function buscarPedido(chargeId) {
  const resp = await fetch(`${API_ROOT}/pedidosLoja/${encodeURIComponent(chargeId)}`);
  if (resp.status !== 200) return null;
  const doc = await resp.json();
  return {
    item: doc.fields?.item?.stringValue || null,
    email: doc.fields?.email?.stringValue || null,
  };
}

export async function jaProcessado(chargeId) {
  const resp = await fetch(`${API_ROOT}/lojaCargas/${encodeURIComponent(chargeId)}`);
  return resp.status === 200;
}

export async function marcarProcessado(chargeId, item, email, via) {
  await fetch(
    `${API_ROOT}/lojaCargas/${encodeURIComponent(chargeId)}?documentId=${encodeURIComponent(chargeId)}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields: {
          item: { stringValue: item },
          email: { stringValue: email },
          processedAt: { timestampValue: new Date().toISOString() },
          via: { stringValue: via || "unknown" },
        },
      }),
    }
  );
}

/**
 * Usado pelo webhook e pelo polling.
 * Idempotente: se já creditou, devolve credited:true sem repetir.
 */
export async function processarCobrancaPaga(chargeId, via) {
  if (await jaProcessado(chargeId)) {
    return { credited: true, ja: true };
  }

  const pedido = await buscarPedido(chargeId);
  if (!pedido || !pedido.item || !pedido.email) {
    console.error("Pedido original não encontrado para a cobrança", chargeId);
    return { credited: false };
  }

  await creditarCompra(pedido.item, pedido.email);
  await marcarProcessado(chargeId, pedido.item, pedido.email, via);
  return { credited: true, item: pedido.item, email: pedido.email };
}

export function json(obj, status, extraHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-NetShop-Signature",
      ...(extraHeaders || {}),
    },
  });
}

export function corsOptions() {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, X-NetShop-Signature",
    },
  });
}
