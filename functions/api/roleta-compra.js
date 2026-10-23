/**
 * Desafio MOZ – Roleta compra (pontos + e-Mola)
 * URL: POST https://desafiomoz.pages.dev/api/roleta-compra
 *
 * Body metical:
 *   { "tipo": "metical", "email", "valorMT", "txId" }
 * Body pontos:
 *   { "tipo": "pontos", "email", "custoPontos" }
 *
 * Secret: FIREBASE_SERVICE_ACCOUNT (mesma do Homejub)
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
};

const ANCORAS_PONTOS = [
  [5, 3],
  [10, 8],
  [24, 18],
];
const ANCORAS_MT = [
  [2, 15],
  [5, 35],
  [10, 80],
];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

function normalizarTxId(s) {
  return String(s || '')
    .trim()
    .replace(/\s+/g, '')
    .toUpperCase();
}

function txIdValido(txId) {
  if (!txId || txId.length < 12 || txId.length > 64) return false;
  if (!txId.startsWith('PP')) return false;
  return /^PP[A-Z0-9.\-_]+$/i.test(txId);
}

function emailValido(email) {
  email = String(email || '')
    .trim()
    .toLowerCase();
  if (!email || email.length > 120) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function interpolarGiros(valor, ancoras) {
  valor = Number(valor) || 0;
  if (valor <= 0) return 0;
  if (valor <= ancoras[0][0]) {
    return Math.max(0, Math.round(valor * (ancoras[0][1] / ancoras[0][0])));
  }
  for (let i = 0; i < ancoras.length - 1; i++) {
    const [x1, y1] = ancoras[i];
    const [x2, y2] = ancoras[i + 1];
    if (valor >= x1 && valor <= x2) {
      return Math.round(y1 + ((valor - x1) * (y2 - y1)) / (x2 - x1));
    }
  }
  const [xa, ya] = ancoras[ancoras.length - 1];
  return Math.round(valor * (ya / xa));
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
    throw new Error('Service account incompleta (private_key / client_email / project_id)');
  }
  let pk = String(sa.private_key).replace(/\\n/g, '\n');
  if (!pk.includes('BEGIN PRIVATE KEY')) {
    throw new Error('private_key sem BEGIN PRIVATE KEY — cola o JSON completo');
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
  const pem = sa.private_key;
  const pemBody = pem
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
  if (!tok.access_token) {
    throw new Error('Falha token Google: ' + JSON.stringify(tok));
  }
  return tok.access_token;
}

function fsBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

async function fsGet(token, projectId, path) {
  const url = `${fsBase(projectId)}/${path}`;
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('FS GET ' + path + ' ' + r.status + ' ' + (await r.text()));
  return r.json();
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


function arrIntField(nums) {
  return {
    arrayValue: {
      values: (nums || []).map((n) => ({ integerValue: String(Math.floor(Number(n) || 0)) })),
    },
  };
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

// Índices alinhados com roleta-giro.js PREMIOS
const IDX_1_MT = 3;
const IDX_5_MT = 4;
const IDX_10_MT = 2;
const IDX_50_MT = 11;
const IDX_2_GIROS = 6;
const IDX_6_GIROS = 8;
const IDX_BOA = 7;
const IDX_QUASE = 9;

/** Fila exacta 2× pago em MT (ou 1× / 0 se maldição). Resto = perde / +giros. */
function montarListaPremiosMT(valorMT, girosComprados, maldicaoModo) {
  const pago = Math.max(0, Math.floor(Number(valorMT) || 0));
  const nGiros = Math.max(1, Math.floor(Number(girosComprados) || 0));
  let alvo = pago * 2;
  let maxMT = pago * 2;
  if (maldicaoModo === 'perder') {
    alvo = 0;
    maxMT = 0;
  } else if (maldicaoModo === 'so_pago') {
    alvo = pago;
    maxMT = pago;
  }
  if (alvo > maxMT) alvo = maxMT;
  if (alvo < 0) alvo = 0;

  const lista = [];
  let restante = alvo;

  let pecas;
  if (pago >= 50) {
    pecas = [
      { idx: IDX_50_MT, v: 50 },
      { idx: IDX_10_MT, v: 10 },
      { idx: IDX_5_MT, v: 5 },
      { idx: IDX_1_MT, v: 1 },
    ];
  } else if (pago >= 10) {
    pecas = [
      { idx: IDX_10_MT, v: 10 },
      { idx: IDX_5_MT, v: 5 },
      { idx: IDX_1_MT, v: 1 },
    ];
  } else if (pago >= 5) {
    pecas = [
      { idx: IDX_5_MT, v: 5 },
      { idx: IDX_1_MT, v: 1 },
    ];
  } else {
    pecas = [{ idx: IDX_1_MT, v: 1 }];
  }

  let guard = 0;
  while (restante > 0 && lista.length < nGiros && guard++ < 800) {
    const candidatas = pecas.filter((p) => p.v <= restante);
    if (!candidatas.length) break;
    const escolhida =
      Math.random() < 0.55
        ? candidatas[0]
        : candidatas[Math.floor(Math.random() * candidatas.length)];
    lista.push(escolhida.idx);
    restante -= escolhida.v;
  }
  while (restante >= 1 && lista.length < nGiros) {
    lista.push(IDX_1_MT);
    restante -= 1;
  }
  while (lista.length < nGiros) {
    const u = Math.random();
    if (u < 0.12) lista.push(IDX_6_GIROS);
    else if (u < 0.28) lista.push(IDX_2_GIROS);
    else if (u < 0.64) lista.push(IDX_QUASE);
    else lista.push(IDX_BOA);
  }
  if (lista.length > nGiros) lista.length = nGiros;

  // Validar total MT <= maxMT
  const valorPorIdx = {
    [IDX_1_MT]: 1,
    [IDX_5_MT]: 5,
    [IDX_10_MT]: 10,
    [IDX_50_MT]: 50,
  };
  let totalMT = 0;
  const limpa = [];
  for (const ix of lista) {
    const v = valorPorIdx[ix] || 0;
    if (v > 0 && totalMT + v > maxMT) {
      limpa.push(Math.random() < 0.5 ? IDX_BOA : IDX_QUASE);
    } else {
      limpa.push(ix);
      totalMT += v;
    }
  }
  // Shuffle para não sair tudo no início
  for (let i = limpa.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = limpa[i];
    limpa[i] = limpa[j];
    limpa[j] = tmp;
  }
  return { lista: limpa, alvoMT: alvo, totalMT };
}


function docPathId(doc) {
  // name: projects/.../documents/usuarios/ABC
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
    if (!raw) {
      return json({ ok: false, erro: 'FIREBASE_SERVICE_ACCOUNT em falta' }, 500);
    }
    sa = parseServiceAccount(raw);
  } catch (e) {
    return json(
      { ok: false, erro: 'Secret inválido: ' + (e && e.message ? e.message : String(e)) },
      500
    );
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, erro: 'JSON inválido' }, 400);
  }

  const email = emailValido(body.email);
  const tipo = String(body.tipo || '').trim().toLowerCase();
  if (!email) return json({ ok: false, erro: 'Email inválido' }, 400);
  if (tipo !== 'metical' && tipo !== 'pontos') {
    return json({ ok: false, erro: 'tipo deve ser metical ou pontos' }, 400);
  }

  const projectId = sa.project_id;

  try {
    const token = await getAccessToken(sa);
    const userDoc = await fsQueryUsuariosPorEmail(token, projectId, email);
    if (!userDoc) {
      return json({ ok: false, erro: 'Conta não encontrada no Desafio MOZ.' }, 404);
    }
    const userId = docPathId(userDoc);
    const userPath = 'usuarios/' + userId;

    // Maldição admin
    let maldicaoModo = null;
    try {
      const mm = lerMap(userDoc, 'roletaMaldicao');
      if (mm && mm.ativo && mm.ativo.booleanValue === true) {
        maldicaoModo = mm.modo && mm.modo.stringValue ? mm.modo.stringValue : 'perder';
      }
    } catch (eM) {}

    if (tipo === 'metical') {
      const valorMT = Math.floor(Number(body.valorMT) || 0);
      const txId = normalizarTxId(body.txId);
      if (valorMT < 2) {
        return json({ ok: false, erro: 'Mínimo de compra: 2 meticais.' }, 400);
      }
      if (valorMT > 5000) {
        return json({ ok: false, erro: 'Valor demasiado alto.' }, 400);
      }
      if (!txIdValido(txId)) {
        return json({
          ok: false,
          erro: 'ID de transacção inválido. Usa o ID completo da e-Mola (começa por PP).',
        }, 400);
      }

      const giros = interpolarGiros(valorMT, ANCORAS_MT);
      if (giros <= 0) {
        return json({ ok: false, erro: 'Valor inválido para giros.' }, 400);
      }

      // Orçamento + fila exacta 2× (maldição so_pago = 1×; perder = 0)
      const plano = montarListaPremiosMT(valorMT, giros, maldicaoModo);
      let orcMT = plano.alvoMT;

      try {
        await fsCreate(token, projectId, 'emolaTransacoes', txId, {
          email: strField(email),
          item: strField('roleta_giros'),
          jogo: strField('roleta'),
          mt: numField(valorMT),
          giros: numField(giros),
          descricao: strField('Roleta +' + giros + ' giros'),
          createdAt: strField(new Date().toISOString()),
          via: strField('api-roleta-compra'),
        });
      } catch (e) {
        if (e.message === 'TX_JA_USADO') {
          return json({
            ok: false,
            erro: 'Este ID de transacção já foi usado. Cada ID só funciona uma vez.',
          }, 409);
        }
        throw e;
      }

      const girosAct = lerNum(userDoc, 'roletaGiros', 0);
      const origemMet = lerNum(userDoc, 'roletaOrigemMetical', 0);
      const mtOrc = lerNum(userDoc, 'roletaMtOrcamento', 0);
      const garantiasAct = lerArrInt(userDoc, 'roletaGarantias');
      const garantiasNovas = garantiasAct.concat(plano.lista);
      const gastosMT = lerNum(userDoc, 'roletaMeticalGasto', 0);

      const fields = {
        roletaGiros: numField(girosAct + giros),
        roletaOrigemMetical: numField(origemMet + giros),
        roletaMtOrcamento: numField(mtOrc + orcMT),
        roletaGarantias: arrIntField(garantiasNovas),
        roletaMeticalGasto: numField(gastosMT + valorMT),
        roletaUltimaCompraMetical: strField(new Date().toISOString()),
        ultimaAtualizacao: strField(new Date().toISOString()),
      };
      await fsPatch(token, projectId, userPath, fields, Object.keys(fields));

      const logId = 'rt_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      try {
        await fsCreate(token, projectId, 'pagamentosManuais', logId, {
          jogo: strField('roleta'),
          email: strField(email),
          item: strField('giros_metical'),
          label: strField('+' + giros + ' giros'),
          mt: numField(valorMT),
          giros: numField(giros),
          txId: strField(txId),
          status: strField('entregue'),
          createdAt: strField(new Date().toISOString()),
          via: strField('api-roleta-compra'),
        });
      } catch (eLog) {}

      return json({
        ok: true,
        tipo: 'metical',
        email,
        valorMT,
        giros,
        mtOrcamentoAdd: orcMT,
        garantiasAdd: (plano && plano.lista) ? plano.lista.length : 0,
        girosTotais: girosAct + giros,
        mensagem: 'Giros creditados com sucesso.',
      });
    }

    // tipo === pontos
    const custoPontos = Math.floor(Number(body.custoPontos) || 0);
    if (custoPontos < 1) {
      return json({ ok: false, erro: 'Indica quantos pontos queres usar.' }, 400);
    }
    if (custoPontos > 100000) {
      return json({ ok: false, erro: 'Valor de pontos demasiado alto.' }, 400);
    }
    const giros = interpolarGiros(custoPontos, ANCORAS_PONTOS);
    if (giros <= 0) {
      return json({ ok: false, erro: 'Pontos insuficientes para gerar giros.' }, 400);
    }

    const pontosAct = lerNum(userDoc, 'pontos', 0);
    if (pontosAct < custoPontos) {
      return json({ ok: false, erro: 'Não tens pontos suficientes.' }, 400);
    }

    // Orçamento a devolver nos giros = metade (maldição → 0)
    let orcPts = Math.floor(custoPontos / 2);
    if (maldicaoModo === 'perder' || maldicaoModo === 'so_pago') orcPts = 0;

    const girosAct = lerNum(userDoc, 'roletaGiros', 0);
    const origemPts = lerNum(userDoc, 'roletaOrigemPontos', 0);
    const ptsOrc = lerNum(userDoc, 'roletaPtsOrcamentoRestante', 0);
    const gastosPts = lerNum(userDoc, 'roletaPontosGastos', 0);
    const girosPorPts = lerNum(userDoc, 'roletaGirosPorPontos', 0);

    const fields = {
      pontos: numField(pontosAct - custoPontos),
      roletaGiros: numField(girosAct + giros),
      roletaOrigemPontos: numField(origemPts + giros),
      roletaPtsOrcamentoRestante: numField(ptsOrc + orcPts),
      roletaPontosGastos: numField(gastosPts + custoPontos),
      roletaGirosPorPontos: numField(girosPorPts + giros),
      roletaUltimaCompraPontos: strField(new Date().toISOString()),
      ultimaAtualizacao: strField(new Date().toISOString()),
    };
    await fsPatch(token, projectId, userPath, fields, Object.keys(fields));

    const logId = 'rtp_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    try {
      await fsCreate(token, projectId, 'roletaComprasPontos', logId, {
        email: strField(email),
        pontos: numField(custoPontos),
        giros: numField(giros),
        createdAt: strField(new Date().toISOString()),
        via: strField('api-roleta-compra'),
      });
    } catch (eLog) {}

    return json({
      ok: true,
      tipo: 'pontos',
      email,
      custoPontos,
      giros,
      ptsOrcamentoAdd: orcPts,
      pontosRestantes: pontosAct - custoPontos,
      girosTotais: girosAct + giros,
      mensagem: 'Giros creditados com sucesso.',
    });
  } catch (e) {
    return json({
      ok: false,
      erro: 'Erro no servidor: ' + (e && e.message ? e.message : String(e)),
    }, 500);
  }
}
