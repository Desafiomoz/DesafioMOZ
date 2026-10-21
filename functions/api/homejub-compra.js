/**
 * Desafio MOZ – Homejub compra (e-Mola)
 * URL: POST https://desafiomoz.pages.dev/api/homejub-compra
 *
 * Body JSON: { "email": "...", "item": "moedas30", "txId": "PP...." }
 * Secret: FIREBASE_SERVICE_ACCOUNT (JSON da service account)
 *
 * O browser NÃO decide quantas moedas/níveis recebe — só esta Function.
 */

const ITENS = {
  moedas30:        { mt: 2,   label: '30 moedas' },
  moedas70:        { mt: 4,   label: '70 moedas' },
  ajudas20:        { mt: 2,   label: '20 ajudas' },
  jogadas10:       { mt: 2,   label: '10 jogadas extra' },
  jogadasOferta20: { mt: 2,   label: '20 jogadas (nível actual)' },
  bonus:           { mt: 5,   label: 'Bónus 6 vidas + 70 moedas + 6 ajudas + 10 jogadas' },
  bonus2:          { mt: 10,  label: 'Bónus grande' },
  moedasInfinitas: { mt: 100, label: 'Moedas infinitas' },
  ajudasInfinitas: { mt: 50,  label: 'Ajudas infinitas' },
  desbloqueio10:   { mt: 15,  label: '+10 níveis desbloqueados' },
};

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
};

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
  // e-Mola: começa por PP e tem formato razoável
  if (!txId || txId.length < 12 || txId.length > 64) return false;
  if (!txId.startsWith('PP')) return false;
  // só letras, números e pontuação típica
  return /^PP[A-Z0-9.\-_]+$/i.test(txId);
}

function emailValido(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email || email.length > 120) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/** JWT + access token Google (service account) para Firestore REST */
async function getAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };

  const enc = new TextEncoder();
  const b64 = (obj) =>
    btoa(String.fromCharCode(...enc.encode(JSON.stringify(obj))))
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

  const unsigned = `\( {b64(header)}. \){b64(claim)}`;

  // PKCS8 private key
  const pem = sa.private_key.replace(/\\n/g, '\n');
  const pemBody = pem
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\s+/g, '');
  const binary = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));

  const key = await crypto.subtle.importKey(
    'pkcs8',
    binary,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const sig = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5',
    key,
    enc.encode(unsigned)
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  const jwt = `\( {unsigned}. \){sigB64}`;

  const tokRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const tok = await tokRes.json();
  if (!tok.access_token) {
    throw new Error('Falha ao obter token Google: ' + JSON.stringify(tok));
  }
  return tok.access_token;
}

function fsBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

async function fsGet(token, projectId, path) {
  const url = `\( {fsBase(projectId)}/ \){path}`;
  const r = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('FS GET ' + path + ' ' + r.status + ' ' + (await r.text()));
  return r.json();
}

async function fsPatch(token, projectId, path, fields, mask) {
  let url = `\( {fsBase(projectId)}/ \){path}`;
  if (mask && mask.length) {
    url += '?' + mask.map((f) => 'updateMask.fieldPaths=' + encodeURIComponent(f)).join('&');
  }
  const r = await fetch(url, {
    method: 'PATCH',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error('FS PATCH ' + path + ' ' + r.status + ' ' + (await r.text()));
  return r.json();
}

async function fsCreate(token, projectId, collection, docId, fields) {
  // createDocument com nome fixo → falha se já existir (idempotência do txId)
  const url =
    `\( {fsBase(projectId)}/ \){collection}?documentId=${encodeURIComponent(docId)}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (r.status === 409) {
    const err = new Error('TX_JA_USADO');
    throw err;
  }
  if (!r.ok) throw new Error('FS CREATE ' + r.status + ' ' + (await r.text()));
  return r.json();
}

function numField(n) {
  return { integerValue: String(Math.floor(Number(n) || 0)) };
}
function strField(s) {
  return { stringValue: String(s ?? '') };
}
function boolField(b) {
  return { booleanValue: !!b };
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
function lerBool(doc, key) {
  try {
    return !!(doc.fields && doc.fields[key] && doc.fields[key].booleanValue);
  } catch (e) {
    return false;
  }
}

/** Aplica o item no documento jogoEstado (valores só do servidor) */
function aplicarItemNoEstado(estadoDoc, item) {
  const fields = (estadoDoc && estadoDoc.fields) || {};
  // clonar campos existentes que vamos manter/alterar
  let moedas = lerNum({ fields }, 'moedasTotais', 0);
  let ajudas = lerNum({ fields }, 'ajudasDisponiveis', 0);
  let vidas = lerNum({ fields }, 'vidas', 5);
  let jogadasExtra = lerNum({ fields }, 'jogadasExtraArmazenadas', 0);
  let nivelDesbloqueado = lerNum({ fields }, 'nivelDesbloqueado', 1);
  let moedasInf = lerBool({ fields }, 'moedasInfinitas');
  let ajudasInf = lerBool({ fields }, 'ajudasInfinitas');

  switch (item) {
    case 'moedas30':
      moedas += 30;
      break;
    case 'moedas70':
      moedas += 70;
      break;
    case 'ajudas20':
      ajudas += 20;
      break;
    case 'jogadas10':
      jogadasExtra += 10;
      break;
    case 'jogadasOferta20':
      // no nível actual o cliente soma jogadasRestantes; no estado guardamos extra
      jogadasExtra += 20;
      break;
    case 'bonus':
      vidas = Math.min(5, Math.max(vidas, 6)); // jogo usa max 5; bónus histórico
      vidas = 5;
      moedas += 70;
      ajudas += 6;
      jogadasExtra += 10;
      break;
    case 'bonus2':
      vidas = 5;
      moedas += 100;
      ajudas += 20;
      jogadasExtra += 20;
      break;
    case 'moedasInfinitas':
      moedasInf = true;
      break;
    case 'ajudasInfinitas':
      ajudasInf = true;
      break;
    case 'desbloqueio10':
      nivelDesbloqueado = Math.max(1, nivelDesbloqueado) + 10;
      break;
    default:
      throw new Error('ITEM_DESCONHECIDO');
  }

  return {
    moedasTotais: numField(moedas),
    ajudasDisponiveis: numField(ajudas),
    vidas: numField(vidas),
    jogadasExtraArmazenadas: numField(jogadasExtra),
    nivelDesbloqueado: numField(nivelDesbloqueado),
    moedasInfinitas: boolField(moedasInf),
    ajudasInfinitas: boolField(ajudasInf),
    actualizadoEm: strField(new Date().toISOString()),
  };
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  if (request.method !== 'POST') {
    return json({ ok: false, erro: 'Só POST' }, 405);
  }

  // Secret obrigatório
  let sa;
  try {
    const raw = env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) return json({ ok: false, erro: 'Secret FIREBASE_SERVICE_ACCOUNT em falta' }, 500);
    sa = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (e) {
    return json({ ok: false, erro: 'Secret FIREBASE_SERVICE_ACCOUNT inválido' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, erro: 'JSON inválido' }, 400);
  }

  const email = emailValido(body.email);
  const item = String(body.item || '').trim();
  const txId = normalizarTxId(body.txId);

  if (!email) return json({ ok: false, erro: 'Email inválido' }, 400);
  if (!ITENS[item]) return json({ ok: false, erro: 'Item inválido' }, 400);
  if (!txIdValido(txId)) {
    return json({
      ok: false,
      erro: 'ID de transacção inválido. Usa o ID completo da e-Mola (começa por PP).',
    }, 400);
  }

  const meta = ITENS[item];
  const projectId = sa.project_id;

  try {
    const token = await getAccessToken(sa);

    // 1) Registar txId — se já existir, rejeita (cada ID só uma vez)
    try {
      await fsCreate(token, projectId, 'emolaTransacoes', txId, {
        email: strField(email),
        item: strField(item),
        jogo: strField('homejub'),
        mt: numField(meta.mt),
        descricao: strField(meta.label),
        createdAt: strField(new Date().toISOString()),
        via: strField('api-homejub-compra'),
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

    // 2) Ler / criar jogoEstado e creditar
    const estadoPath = `jogoEstado/${encodeURIComponent(email)}`;
    let estado = await fsGet(token, projectId, `jogoEstado/${email}`);
    if (!estado) {
      // documento vazio inicial
      estado = {
        fields: {
          moedasTotais: numField(0),
          ajudasDisponiveis: numField(0),
          vidas: numField(5),
          jogadasExtraArmazenadas: numField(0),
          nivelDesbloqueado: numField(1),
          moedasInfinitas: boolField(false),
          ajudasInfinitas: boolField(false),
        },
      };
    }

    const novos = aplicarItemNoEstado(estado, item);
    await fsPatch(token, projectId, `jogoEstado/${email}`, novos, Object.keys(novos));

    // 3) Log admin
    const logId = `hj_\( {Date.now()}_ \){Math.random().toString(36).slice(2, 8)}`;
    try {
      await fsCreate(token, projectId, 'pagamentosManuais', logId, {
        jogo: strField('homejub'),
        email: strField(email),
        item: strField(item),
        label: strField(meta.label),
        mt: numField(meta.mt),
        txId: strField(txId),
        status: strField('entregue'),
        createdAt: strField(new Date().toISOString()),
        via: strField('api-homejub-compra'),
      });
    } catch (eLog) {
      // não falha a compra se o log falhar
    }

    return json({
      ok: true,
      item,
      label: meta.label,
      mt: meta.mt,
      email,
      mensagem: 'Compra creditada com sucesso.',
    });
  } catch (e) {
    return json({
      ok: false,
      erro: 'Erro no servidor: ' + (e && e.message ? e.message : String(e)),
    }, 500);
  }
}