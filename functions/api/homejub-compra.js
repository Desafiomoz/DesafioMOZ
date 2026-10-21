/**
 * Desafio MOZ – Homejub compra (e-Mola)
 * URL: POST https://desafiomoz.pages.dev/api/homejub-compra
 * Body: { "email", "item", "txId" }
 * Secret: FIREBASE_SERVICE_ACCOUNT (JSON service account)
 */

const ITENS = {
  moedas30:        { mt: 2,   label: '30 moedas' },
  moedas70:        { mt: 4,   label: '70 moedas' },
  ajudas20:        { mt: 2,   label: '20 ajudas' },
  jogadas10:       { mt: 2,   label: '10 jogadas extra' },
  jogadasOferta20: { mt: 2,   label: '20 jogadas (nível actual)' },
  bonus:           { mt: 5,   label: 'Bónus' },
  bonus2:          { mt: 10,  label: 'Bónus grande' },
  moedasInfinitas: { mt: 100, label: 'Moedas infinitas' },
  ajudasInfinitas: { mt: 50,  label: 'Ajudas infinitas' },
  desbloqueio10:   { mt: 15,  label: '+10 níveis' },
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
  return String(s || '').trim().replace(/\s+/g, '').toUpperCase();
}

function txIdValido(txId) {
  if (!txId || txId.length < 12 || txId.length > 64) return false;
  if (!txId.startsWith('PP')) return false;
  return /^PP[A-Z0-9.\-_]+$/i.test(txId);
}

function emailValido(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email || email.length > 120) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/** Base64 URL-safe (string UTF-8 ou ArrayBuffer/Uint8Array) */
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
  // Normalizar quebras de linha da chave privada
  let pk = String(sa.private_key);
  pk = pk.replace(/\\n/g, '\n');
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
      scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform',
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
    throw new Error(
      'Falha ao obter token Google: ' +
        JSON.stringify(tok) +
        ' | email=' +
        (sa.client_email || '?')
    );
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

function aplicarItemNoEstado(estadoDoc, item) {
  const fields = (estadoDoc && estadoDoc.fields) || {};
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
      jogadasExtra += 20;
      break;
    case 'bonus':
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

  let sa;
  try {
    const raw = env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) {
      return json(
        {
          ok: false,
          erro:
            'Secret FIREBASE_SERVICE_ACCOUNT em falta. Nome exacto na Cloudflare: FIREBASE_SERVICE_ACCOUNT',
        },
        500
      );
    }
    sa = parseServiceAccount(raw);
  } catch (e) {
    return json({
      ok: false,
      erro: 'Secret inválido: ' + (e && e.message ? e.message : String(e)),
    }, 500);
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

    let estado = await fsGet(token, projectId, 'jogoEstado/' + email);
    if (!estado) {
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
    await fsPatch(token, projectId, 'jogoEstado/' + email, novos, Object.keys(novos));

    const logId = 'hj_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
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
    } catch (eLog) {}

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
