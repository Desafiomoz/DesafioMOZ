/**
 * Desafio MOZ – Convidar / Influencer (dados + ranking via Admin)
 * Secret: FIREBASE_SERVICE_ACCOUNT
 *
 * POST JSON:
 *   { action: "me", email: "..." }
 *   { action: "ranking" }
 */
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS, GET',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Content-Type': 'application/json; charset=utf-8',
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: CORS });
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
  if (!pk.includes('BEGIN PRIVATE KEY')) throw new Error('private_key inválida');
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

function toFsValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return { integerValue: String(v) };
    return { doubleValue: v };
  }
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toFsValue) } };
  if (typeof v === 'object') {
    const fields = {};
    for (const k of Object.keys(v)) fields[k] = toFsValue(v[k]);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

function fromFsValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return parseInt(v.integerValue, 10);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(fromFsValue);
  if ('mapValue' in v) {
    const f = (v.mapValue && v.mapValue.fields) || {};
    const o = {};
    for (const k of Object.keys(f)) o[k] = fromFsValue(f[k]);
    return o;
  }
  return null;
}

function docToData(doc) {
  if (!doc || !doc.fields) return {};
  const o = {};
  for (const k of Object.keys(doc.fields)) o[k] = fromFsValue(doc.fields[k]);
  return o;
}

function docIdFromName(name) {
  return (name || '').split('/').pop();
}

async function fsGet(token, projectId, path) {
  const r = await fetch(`${fsBase(projectId)}/${path}`, {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('GET ' + path + ' ' + r.status);
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
  if (!r.ok) throw new Error('PATCH ' + path + ' ' + r.status + ' ' + (await r.text()));
  return r.json();
}

async function fsQuery(token, projectId, structuredQuery) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!r.ok) throw new Error('QUERY ' + r.status + ' ' + (await r.text()));
  const rows = await r.json();
  const out = [];
  for (const row of rows || []) {
    if (row.document) out.push(row.document);
  }
  return out;
}

function gerarCodigo(nome, email) {
  const base = String(nome || email || 'INF')
    .replace(/[^a-zA-Z0-9]/g, '')
    .toUpperCase()
    .slice(0, 4);
  const b = base.length < 2 ? 'INF' : base;
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return b + rnd;
}

async function findUserByEmail(token, projectId, email) {
  const emailL = String(email || '').trim().toLowerCase();
  if (!emailL) return null;

  // 1) doc id = email
  try {
    const d = await fsGet(token, projectId, 'usuarios/' + encodeURIComponent(emailL));
    if (d && d.fields) return { id: docIdFromName(d.name), data: docToData(d), name: d.name };
  } catch (e) {}

  // 2) where email ==
  const docs = await fsQuery(token, projectId, {
    from: [{ collectionId: 'usuarios' }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'email' },
        op: 'EQUAL',
        value: { stringValue: emailL },
      },
    },
    limit: 1,
  });
  if (docs.length) {
    return { id: docIdFromName(docs[0].name), data: docToData(docs[0]), name: docs[0].name };
  }

  // 3) try original casing
  if (email !== emailL) {
    const docs2 = await fsQuery(token, projectId, {
      from: [{ collectionId: 'usuarios' }],
      where: {
        fieldFilter: {
          field: { fieldPath: 'email' },
          op: 'EQUAL',
          value: { stringValue: String(email).trim() },
        },
      },
      limit: 1,
    });
    if (docs2.length) {
      return { id: docIdFromName(docs2[0].name), data: docToData(docs2[0]), name: docs2[0].name };
    }
  }
  return null;
}

async function actionMe(token, projectId, email) {
  const user = await findUserByEmail(token, projectId, email);
  if (!user) {
    return json({ ok: false, error: 'Utilizador não encontrado' }, 404);
  }

  let data = user.data || {};
  let codigo = data.codigoInfluencer || '';
  const total = Number(data.influencerConvidados || 0);
  const premios = Number(data.influencerPremios || 0);
  const bloqueado = data.convitesBloqueados === true || data.influencerBloqueado === true;

  if (!codigo) {
    codigo = gerarCodigo(data.nome, data.email || email);
    // ensure unique (simple retry)
    for (let t = 0; t < 3; t++) {
      const exists = await fsQuery(token, projectId, {
        from: [{ collectionId: 'usuarios' }],
        where: {
          fieldFilter: {
            field: { fieldPath: 'codigoInfluencer' },
            op: 'EQUAL',
            value: { stringValue: codigo },
          },
        },
        limit: 1,
      });
      if (!exists.length) break;
      codigo = gerarCodigo(data.nome, (data.email || email) + Date.now() + t);
    }
    await fsPatch(
      token,
      projectId,
      'usuarios/' + user.id,
      {
        codigoInfluencer: toFsValue(codigo),
        influencerConvidados: toFsValue(total),
        influencerPremios: toFsValue(premios),
      },
      ['codigoInfluencer', 'influencerConvidados', 'influencerPremios']
    );
  }

  return json({
    ok: true,
    email: data.email || email,
    nome: data.nome || '',
    codigoInfluencer: codigo,
    influencerConvidados: total,
    influencerPremios: premios,
    bloqueado: !!bloqueado,
  });
}

async function actionRanking(token, projectId) {
  let docs = [];
  try {
    docs = await fsQuery(token, projectId, {
      from: [{ collectionId: 'usuarios' }],
      orderBy: [{ field: { fieldPath: 'influencerConvidados' }, direction: 'DESCENDING' }],
      limit: 8,
    });
  } catch (e) {
    // fallback without order (no index) — sort in memory
    docs = await fsQuery(token, projectId, {
      from: [{ collectionId: 'usuarios' }],
      limit: 40,
    });
  }

  const list = [];
  for (const d of docs) {
    const data = docToData(d);
    const n = Number(data.influencerConvidados || 0);
    if (n <= 0 && !data.codigoInfluencer) continue;
    list.push({
      nome: data.nome || (data.email ? String(data.email).split('@')[0] : 'Influencer'),
      codigoInfluencer: data.codigoInfluencer || '',
      influencerConvidados: n,
    });
  }
  list.sort((a, b) => b.influencerConvidados - a.influencerConvidados);
  return json({ ok: true, ranking: list.slice(0, 5) });
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  if (request.method === 'GET') {
    return json({ ok: true, msg: 'influencer-convidar API no ar. Usa POST com action me|ranking.' });
  }
  if (request.method !== 'POST') {
    return json({ ok: false, error: 'Só POST' }, 405);
  }

  try {
    const rawSa = env && env.FIREBASE_SERVICE_ACCOUNT;
    if (!rawSa) return json({ ok: false, error: 'FIREBASE_SERVICE_ACCOUNT em falta' }, 500);
    const sa = parseServiceAccount(rawSa);
    const token = await getAccessToken(sa);

    let body = {};
    try {
      body = await request.json();
    } catch (e) {
      return json({ ok: false, error: 'JSON inválido' }, 400);
    }

    const action = String(body.action || 'me').toLowerCase();

    if (action === 'ranking') {
      return await actionRanking(token, sa.project_id);
    }

    if (action === 'me') {
      const email = String(body.email || '').trim().toLowerCase();
      if (!email || email.indexOf('@') < 0) {
        return json({ ok: false, error: 'Email inválido' }, 400);
      }
      return await actionMe(token, sa.project_id, email);
    }

    return json({ ok: false, error: 'action inválida (me | ranking)' }, 400);
  } catch (e) {
    return json({ ok: false, error: String(e && e.message ? e.message : e) }, 500);
  }
}

export async function onRequestPost(context) {
  return onRequest(context);
}

export async function onRequestGet(context) {
  return json({ ok: true, msg: 'influencer-convidar API no ar. Usa POST com action me|ranking.' });
}

export async function onRequestOptions() {
  return new Response(null, { status: 204, headers: CORS });
}
