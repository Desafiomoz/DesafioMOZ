/**
 * Desafio MOZ – Homejub: guardar progresso (Cloudflare Pages Function)
 * POST /api/homejub-salvar
 * Body: { email, vidas, proximaRecarga, nivelDesbloqueado, moedasTotais,
 *         ajudasDisponiveis, jogadasExtraArmazenadas }
 *
 * O browser NÃO escreve em jogoEstado (regras fechadas).
 * Esta Function valida anti-trapaça e grava com a service account.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
}

function emailValido(email) {
  email = String(email || '').trim().toLowerCase();
  if (!email || email.length > 120) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

function b64url(input) {
  let bytes;
  if (typeof input === 'string') bytes = new TextEncoder().encode(input);
  else if (input instanceof ArrayBuffer) bytes = new Uint8Array(input);
  else bytes = new Uint8Array(input);
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
  if (!tok.access_token) throw new Error('Falha token Google: ' + JSON.stringify(tok));
  return tok.access_token;
}

function fsBase(projectId) {
  return `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;
}

async function fsGet(token, projectId, path) {
  const url = `${fsBase(projectId)}/${path}`;
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('FS GET ' + path + ' ' + r.status);
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
  if (r.status === 409) {
    return fsPatch(token, projectId, collection + '/' + docId, fields, Object.keys(fields));
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

function lerNum(doc, key, def = 0) {
  try {
    const f = doc && doc.fields && doc.fields[key];
    if (!f) return def;
    if (f.integerValue != null) return parseInt(f.integerValue, 10) || def;
    if (f.doubleValue != null) return Number(f.doubleValue) || def;
    return def;
  } catch (e) {
    return def;
  }
}

function clampInt(n, min, max) {
  n = Math.floor(Number(n) || 0);
  if (n < min) n = min;
  if (max != null && n > max) n = max;
  return n;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json({ ok: false, erro: 'Método inválido' }, 405);

  try {
    const rawSa = env.FIREBASE_SERVICE_ACCOUNT;
    if (!rawSa) return json({ ok: false, erro: 'FIREBASE_SERVICE_ACCOUNT em falta' }, 500);
    const sa = parseServiceAccount(rawSa);
    const token = await getAccessToken(sa);
    const projectId = sa.project_id;

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ ok: false, erro: 'JSON inválido' }, 400);
    }

    const email = emailValido(body.email);
    if (!email) return json({ ok: false, erro: 'E-mail inválido' }, 400);

    // Valores pedidos pelo cliente
    let vidas = clampInt(body.vidas, 0, 5);
    let proximaRecarga = Math.max(0, Math.floor(Number(body.proximaRecarga) || 0));
    let nivelDesbloqueado = clampInt(body.nivelDesbloqueado, 1, 500);
    let moedasTotais = clampInt(body.moedasTotais, 0, 999999);
    let ajudasDisponiveis = clampInt(body.ajudasDisponiveis, 0, 9999);
    let jogadasExtra = clampInt(body.jogadasExtraArmazenadas, 0, 9999);

    const existente = await fsGet(token, projectId, 'jogoEstado/' + email);

    if (existente && existente.fields) {
      const baseNivel = lerNum(existente, 'nivelDesbloqueado', 1);
      const baseMoedas = lerNum(existente, 'moedasTotais', 0);
      const baseAjudas = lerNum(existente, 'ajudasDisponiveis', 0);
      const baseJogadas = lerNum(existente, 'jogadasExtraArmazenadas', 0);
      const baseVidas = lerNum(existente, 'vidas', 5);

      // Anti-trapaça no servidor (igual espírito do cliente)
      // Nível: no máximo +1 por gravação (vitória). Saltos grandes só via compra (Function compra).
      if (nivelDesbloqueado > baseNivel + 1) nivelDesbloqueado = baseNivel + 1;
      if (nivelDesbloqueado < baseNivel) nivelDesbloqueado = baseNivel; // não baixa nível

      // Moedas: no máximo +40 por gravação
      if (moedasTotais > baseMoedas + 40) moedasTotais = baseMoedas + 40;
      // Ajudas: só podem baixar (uso) — não sobem sem compra
      if (ajudasDisponiveis > baseAjudas) ajudasDisponiveis = baseAjudas;
      // Jogadas extra: não sobem sem compra
      if (jogadasExtra > baseJogadas) jogadasExtra = baseJogadas;
      // Vidas: 0–5
      if (vidas > 5) vidas = 5;
      if (vidas < 0) vidas = 0;
      // Não permitir vidas > base+1 excepto se estava a 0 e regenerou (simplificado: max 5)
      void baseVidas;
    } else {
      // Conta nova: começa limpa
      if (nivelDesbloqueado > 1) nivelDesbloqueado = 1;
      if (moedasTotais > 0) moedasTotais = 0;
      if (ajudasDisponiveis > 0) ajudasDisponiveis = 0;
      if (jogadasExtra > 0) jogadasExtra = 0;
      if (vidas > 5) vidas = 5;
    }

    const fields = {
      vidas: numField(vidas),
      proximaRecarga: numField(proximaRecarga),
      nivelDesbloqueado: numField(nivelDesbloqueado),
      moedasTotais: numField(moedasTotais),
      ajudasDisponiveis: numField(ajudasDisponiveis),
      jogadasExtraArmazenadas: numField(jogadasExtra),
      actualizadoEm: strField(new Date().toISOString()),
    };
    const mask = Object.keys(fields);

    if (existente) {
      await fsPatch(token, projectId, 'jogoEstado/' + email, fields, mask);
    } else {
      // Conta nova: flags e marcos só no servidor (nunca do cliente)
      fields.moedasInfinitas = { booleanValue: false };
      fields.ajudasInfinitas = { booleanValue: false };
      fields.marcosPagos = { arrayValue: { values: [] } };
      await fsCreate(token, projectId, 'jogoEstado', email, fields);
    }

    return json({
      ok: true,
      estado: {
        vidas,
        proximaRecarga,
        nivelDesbloqueado,
        moedasTotais,
        ajudasDisponiveis,
        jogadasExtraArmazenadas: jogadasExtra,
      },
    });
  } catch (e) {
    return json(
      { ok: false, erro: e && e.message ? e.message : String(e) },
      500
    );
  }
}
