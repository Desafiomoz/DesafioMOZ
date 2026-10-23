/**
 * Desafio MOZ – Roleta giro (sorteio + crédito no servidor)
 * POST https://desafiomoz.pages.dev/api/roleta-giro
 * Body: { "email": "..." }
 *
 * Prioridade do prémio:
 *  1) Maldição "perder" → sempre perde
 *  2) Maldição "forcar" → índice forçado
 *  3) Fila roletaGarantias (compra em metical 2×) → exacta
 *  4) Sorteio livre com caps de orçamento
 *
 * Compra em metical: prémios em MT vêm da fila e creditam pontos = MT × 8.
 * Compra em pontos: orçamento ptsOrc (metade do gasto); sem MT.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
};

const PTS_POR_MT = 8;

const PREMIOS = [
  { label: '1000 PTS', tipo: 'pontos', valor: 1000, peso: 0, emoji: '👑' },
  { label: '500 PTS', tipo: 'pontos', valor: 500, peso: 0, emoji: '🌟' },
  { label: '10 MT', tipo: 'mt', valor: 10, peso: 0, emoji: '💵' },
  { label: '1 MT', tipo: 'mt', valor: 1, peso: 12, emoji: '💸' },
  { label: '5 MT', tipo: 'mt', valor: 5, peso: 0, emoji: '💰' },
  { label: '100 PTS', tipo: 'pontos', valor: 100, peso: 0, emoji: '✨' },
  { label: '+2 GIROS', tipo: 'giros', valor: 2, peso: 90, emoji: '🎡' },
  { label: 'BOA SORTE', tipo: 'nada', valor: 0, peso: 820, emoji: '🍀' },
  { label: '+6 GIROS', tipo: 'giros', valor: 6, peso: 1, emoji: '🎡' },
  { label: 'QUASE!', tipo: 'nada', valor: 0, peso: 820, emoji: '😅' },
  { label: '20 PTS', tipo: 'pontos', valor: 20, peso: 55, emoji: '✨' },
  { label: '50 MT', tipo: 'mt', valor: 50, peso: 0, emoji: '🏆' },
];

const IDX_BOA = 7;
const IDX_QUASE = 9;
const IDX_1_MT = 3;
const IDX_20_PTS = 10;
const IDX_2_GIROS = 6;
const IDX_6_GIROS = 8;

function pesoTotal() {
  return PREMIOS.reduce((s, p) => s + (Number(p.peso) || 0), 0);
}

function perdaIdx() {
  return Math.random() < 0.5 ? IDX_BOA : IDX_QUASE;
}

function sortearLivre() {
  const total = pesoTotal();
  let r = Math.random() * total;
  for (let i = 0; i < PREMIOS.length; i++) {
    const p = Number(PREMIOS[i].peso) || 0;
    if (r < p) return i;
    r -= p;
  }
  return perdaIdx();
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

function emailValido(email) {
  email = String(email || '')
    .trim()
    .toLowerCase();
  if (!email || email.length > 120) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function b64url(input) {
  let bytes;
  if (typeof input === 'string') {
    bytes = new TextEncoder().encode(input);
  } else if (input instanceof ArrayBuffer) {
    bytes = new Uint8Array(input);
  } else {
    bytes = new Uint8Array(input);
  }
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function parseServiceAccount(raw) {
  let sa = typeof raw === 'string' ? JSON.parse(raw) : raw;
  if (!sa || !sa.private_key || !sa.client_email || !sa.project_id) {
    throw new Error('Service account incompleta');
  }
  let pk = String(sa.private_key).replace(/\\n/g, '\n');
  if (!pk.includes('BEGIN PRIVATE KEY')) {
    throw new Error('private_key sem BEGIN PRIVATE KEY');
  }
  sa.private_key = pk;
  return sa;
}

async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(
    JSON.stringify({
      iss: sa.client_email,
      sub: sa.client_email,
      scope:
        'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    })
  );
  const unsigned = header + '.' + claim;
  const pemBody = sa.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/g, '')
    .replace(/-----END PRIVATE KEY-----/g, '')
    .replace(/\s+/g, '');
  const binary = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'pkcs8',
    binary.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    new TextEncoder().encode(unsigned)
  );
  const jwt = unsigned + '.' + b64url(signature);
  const body =
    'grant_type=' +
    encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') +
    '&assertion=' +
    encodeURIComponent(jwt);
  const tokRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const tok = await tokRes.json();
  if (!tok.access_token) throw new Error('Falha token Google');
  return tok.access_token;
}

function fsBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

async function fsPatch(token, projectId, path, fields, mask) {
  let url = `${fsBase(projectId)}/${path}`;
  if (mask && mask.length) {
    url += '?' + mask.map((f) => 'updateMask.fieldPaths=' + encodeURIComponent(f)).join('&');
  }
  const r = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error('FS PATCH ' + path + ' ' + r.status + ' ' + (await r.text()));
  return r.json();
}

async function fsCreate(token, projectId, collection, docId, fields) {
  const url =
    `${fsBase(projectId)}/${collection}?documentId=` + encodeURIComponent(docId);
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (r.status === 409) throw new Error('TX_JA_USADO');
  if (!r.ok) throw new Error('FS CREATE ' + r.status + ' ' + (await r.text()));
  return r.json();
}

async function fsQueryUsuariosPorEmail(token, projectId, email) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const body = {
    structuredQuery: {
      from: [{ collectionId: 'usuarios' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'email' },
          op: 'EQUAL',
          value: { stringValue: email },
        },
      },
      limit: 1,
    },
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error('FS QUERY ' + r.status + ' ' + (await r.text()));
  const rows = await r.json();
  if (!Array.isArray(rows)) return null;
  for (const row of rows) {
    if (row.document) return row.document;
  }
  return null;
}

function numField(n) {
  return { integerValue: String(Math.floor(Number(n) || 0)) };
}
function strField(s) {
  return { stringValue: String(s ?? '') };
}
function arrIntField(nums) {
  return {
    arrayValue: {
      values: (nums || []).map((n) => ({ integerValue: String(Math.floor(Number(n) || 0)) })),
    },
  };
}

function lerNum(doc, key, def = 0) {
  try {
    const f = doc.fields && doc.fields[key];
    if (!f) return def;
    if (f.integerValue != null) return parseInt(f.integerValue, 10) || def;
    if (f.doubleValue != null) return Number(f.doubleValue) || def;
    return def;
  } catch (e) {
    return def;
  }
}

function lerMap(doc, key) {
  try {
    const f = doc.fields && doc.fields[key];
    if (!f || !f.mapValue || !f.mapValue.fields) return null;
    return f.mapValue.fields;
  } catch (e) {
    return null;
  }
}

function lerArrInt(doc, key) {
  try {
    const f = doc.fields && doc.fields[key];
    if (!f || !f.arrayValue || !Array.isArray(f.arrayValue.values)) return [];
    return f.arrayValue.values.map((v) => {
      if (v.integerValue != null) return parseInt(v.integerValue, 10) || 0;
      if (v.doubleValue != null) return Math.floor(Number(v.doubleValue) || 0);
      return 0;
    });
  } catch (e) {
    return [];
  }
}

function docPathId(doc) {
  const name = doc.name || '';
  const parts = name.split('/');
  return parts[parts.length - 1];
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method !== 'POST') {
    return json({ ok: false, erro: 'Só POST' }, 405);
  }

  let sa;
  try {
    const raw = env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) return json({ ok: false, erro: 'FIREBASE_SERVICE_ACCOUNT em falta' }, 500);
    sa = parseServiceAccount(raw);
  } catch (e) {
    return json({ ok: false, erro: 'Secret inválido: ' + (e.message || String(e)) }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, erro: 'JSON inválido' }, 400);
  }

  const email = emailValido(body.email);
  if (!email) return json({ ok: false, erro: 'Email inválido' }, 400);

  try {
    const token = await getAccessToken(sa);
    const projectId = sa.project_id;
    const userDoc = await fsQueryUsuariosPorEmail(token, projectId, email);
    if (!userDoc) return json({ ok: false, erro: 'Conta não encontrada.' }, 404);

    const userId = docPathId(userDoc);
    const userPath = 'usuarios/' + userId;

    let giros = lerNum(userDoc, 'roletaGiros', 0);
    if (giros <= 0) {
      return json({ ok: false, erro: 'Sem giros. Compra mais na loja.' }, 400);
    }

    let pontos = lerNum(userDoc, 'pontos', 0);
    let mtOrc = lerNum(userDoc, 'roletaMtOrcamento', 0);
    let ptsOrc = lerNum(userDoc, 'roletaPtsOrcamentoRestante', 0);
    let girosPerdedores = lerNum(userDoc, 'roletaGirosPerdedores', 0);
    let ganhos = lerNum(userDoc, 'roletaGanhos', 0);
    let perdas = lerNum(userDoc, 'roletaPerdas', 0);
    let pontosGanhos = lerNum(userDoc, 'roletaPontosGanhos', 0);
    let mtGanhos = lerNum(userDoc, 'roletaMtGanhos', 0);
    let origemPremio = lerNum(userDoc, 'roletaOrigemPremio', 0);
    let totalGiros = lerNum(userDoc, 'roletaTotalGiros', 0);
    let garantias = lerArrInt(userDoc, 'roletaGarantias');

    // Maldição
    let maldicaoModo = null;
    let forcarIdx = -1;
    try {
      const mm = lerMap(userDoc, 'roletaMaldicao');
      if (mm && mm.ativo && mm.ativo.booleanValue === true) {
        maldicaoModo = mm.modo && mm.modo.stringValue ? mm.modo.stringValue : 'perder';
        if (maldicaoModo === 'forcar' && mm.premioIdx != null) {
          forcarIdx = parseInt(
            mm.premioIdx.integerValue || mm.premioIdx.stringValue || '-1',
            10
          );
        }
      }
    } catch (eM) {}

    giros -= 1;
    totalGiros += 1;

    let idx;
    let daFila = false;

    if (maldicaoModo === 'perder') {
      // Sempre perde — esvazia orçamentos e fila desta rodada
      mtOrc = 0;
      ptsOrc = 0;
      garantias = [];
      idx = perdaIdx();
    } else if (maldicaoModo === 'forcar' && forcarIdx >= 0 && forcarIdx < PREMIOS.length) {
      idx = forcarIdx;
    } else if (garantias.length > 0) {
      // Fila de garantia da compra em metical (2× exacto)
      idx = garantias.shift();
      if (idx < 0 || idx >= PREMIOS.length) idx = perdaIdx();
      daFila = true;
    } else if (girosPerdedores > 0) {
      girosPerdedores -= 1;
      idx = perdaIdx();
    } else {
      idx = sortearLivre();
    }

    // Maldição so_pago: não permite prémios só de pontos (orçamento pts a 0)
    if (maldicaoModo === 'so_pago') {
      ptsOrc = 0;
    }

    let premio = Object.assign({}, PREMIOS[idx]);
    let ptsAdd = 0;
    let mtAdd = 0;

    // --- Aplicar prémio ---
    if (premio.tipo === 'mt') {
      let v = Number(premio.valor) || 0;
      if (v <= 0) {
        premio = Object.assign({}, PREMIOS[perdaIdx()]);
        idx = premio.label === 'BOA SORTE' ? IDX_BOA : IDX_QUASE;
      } else if (daFila) {
        // Da fila de garantia: credita sempre (orçamento já foi planeado na compra)
        if (mtOrc > 0 && v > mtOrc) v = mtOrc;
        if (v > 0 && mtOrc > 0) {
          mtOrc -= v;
          const pts = v * PTS_POR_MT;
          pontos += pts;
          ptsAdd = pts;
          mtAdd = v;
          premio = { label: v + ' MT', tipo: 'mt', valor: v, emoji: premio.emoji || '💸' };
          if (v === 1) idx = IDX_1_MT;
        } else {
          // Sem orçamento residual → perde visualmente
          premio = Object.assign({}, PREMIOS[perdaIdx()]);
          idx = premio.label === 'BOA SORTE' ? IDX_BOA : IDX_QUASE;
        }
      } else if (mtOrc >= v) {
        mtOrc -= v;
        const pts = v * PTS_POR_MT;
        pontos += pts;
        ptsAdd = pts;
        mtAdd = v;
        premio = { label: v + ' MT', tipo: 'mt', valor: v, emoji: premio.emoji || '💸' };
        if (v === 1) idx = IDX_1_MT;
      } else if (mtOrc > 0) {
        // Corta ao orçamento restante
        v = mtOrc;
        mtOrc = 0;
        const pts = v * PTS_POR_MT;
        pontos += pts;
        ptsAdd = pts;
        mtAdd = v;
        premio = { label: v + ' MT', tipo: 'mt', valor: v, emoji: premio.emoji || '💸' };
        if (v === 1) idx = IDX_1_MT;
      } else {
        // Sem orçamento MT: não paga MT aleatório
        premio = Object.assign({}, PREMIOS[perdaIdx()]);
        idx = premio.label === 'BOA SORTE' ? IDX_BOA : IDX_QUASE;
      }
    } else if (premio.tipo === 'pontos') {
      let v = Number(premio.valor) || 0;
      // Só prémios de pontos vindos de compra em pontos (ptsOrc)
      // Nunca inventar 20 PTS sem orçamento — evita "mostrou 20 / creditou 2"
      if (ptsOrc <= 0 || v <= 0) {
        premio = Object.assign({}, PREMIOS[perdaIdx()]);
        idx = premio.label === 'BOA SORTE' ? IDX_BOA : IDX_QUASE;
      } else {
        if (v > ptsOrc) v = ptsOrc;
        // Limite de segurança: prémios altos de pontos só se o orçamento cobrir
        ptsOrc -= v;
        pontos += v;
        ptsAdd = v;
        premio = {
          label: v + ' pontos',
          tipo: 'pontos',
          valor: v,
          emoji: premio.emoji || '✨',
        };
        if (v === 20) idx = IDX_20_PTS;
      }
    } else if (premio.tipo === 'giros') {
      const g = Number(premio.valor) || 0;
      if (g > 0) {
        giros += g;
        origemPremio += g;
        // Giros ganhos na roleta não pagam prémio em dinheiro
        girosPerdedores += g;
      }
    }

    if (premio.tipo === 'nada') perdas += 1;
    else ganhos += 1;
    if (premio.tipo === 'pontos') pontosGanhos += Number(premio.valor) || 0;
    if (premio.tipo === 'mt') mtGanhos += Number(premio.valor) || mtAdd;

    const fields = {
      pontos: numField(pontos),
      roletaGiros: numField(giros),
      roletaMtOrcamento: numField(mtOrc),
      roletaPtsOrcamentoRestante: numField(ptsOrc),
      roletaGirosPerdedores: numField(girosPerdedores),
      roletaOrigemPremio: numField(origemPremio),
      roletaTotalGiros: numField(totalGiros),
      roletaGanhos: numField(ganhos),
      roletaPerdas: numField(perdas),
      roletaPontosGanhos: numField(pontosGanhos),
      roletaMtGanhos: numField(mtGanhos),
      roletaGarantias: arrIntField(garantias),
      roletaUltimoGiroAt: strField(new Date().toISOString()),
      ultimaAtualizacao: strField(new Date().toISOString()),
    };
    await fsPatch(token, projectId, userPath, fields, Object.keys(fields));

    if (ptsAdd > 0) {
      try {
        const hid = 'rg_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
        await fsCreate(token, projectId, 'historicoPontos', hid, {
          email: strField(email),
          pontos: numField(ptsAdd),
          origem: strField('roleta'),
          detalhe: strField('Roleta: ' + (premio.label || '')),
          dia: strField(new Date().toISOString().slice(0, 10)),
          createdAt: strField(new Date().toISOString()),
        });
      } catch (eH) {}
    }

    return json({
      ok: true,
      indice: idx,
      premio: {
        label: premio.label,
        tipo: premio.tipo,
        valor: Number(premio.valor) || 0,
        emoji: premio.emoji || '🎡',
      },
      pontos,
      giros,
      ptsAdd,
      mtAdd,
      mtOrcamentoRestante: mtOrc,
      ptsOrcamentoRestante: ptsOrc,
      garantiasRestantes: garantias.length,
    });
  } catch (e) {
    return json({
      ok: false,
      erro: 'Erro no servidor: ' + (e && e.message ? e.message : String(e)),
    }, 500);
  }
}
