/**
 * Desafio MOZ – Admin API (Cloudflare Pages Function)
 * POST https://desafiomoz.pages.dev/api/admin
 *
 * Headers: Authorization: Bearer <Firebase ID Token>
 * Body JSON:
 *   { op: 'get'|'set'|'update'|'delete'|'add'|'query'|'list', ... }
 *
 * Só o e-mail admin autorizado. Usa FIREBASE_SERVICE_ACCOUNT (Admin).
 * Assim o painel continua a controlar tudo mesmo com regras fechadas ao público.
 */

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Content-Type': 'application/json; charset=utf-8',
};

/** E-mails com controlo total do admin */
const ADMIN_EMAILS = ['rochajosepaulo7@gmail.com'];

const WEB_API_KEY = 'AIzaSyDONfggnmf9OJX_AgfvcHTRf6tsuKD5nrA';

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

async function verifyIdToken(idToken) {
  const r = await fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + WEB_API_KEY,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    }
  );
  const data = await r.json();
  if (!r.ok || !data.users || !data.users[0]) {
    throw new Error('Token inválido ou expirado');
  }
  const u = data.users[0];
  const email = String(u.email || '')
    .trim()
    .toLowerCase();
  if (!ADMIN_EMAILS.includes(email)) {
    throw new Error('Sem permissão de administrador: ' + email);
  }
  return { email, localId: u.localId };
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
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map(toFsValue) } };
  }
  if (typeof v === 'object') {
    // Sentinels from client bridge
    if (v.__op === 'increment') {
      return {
        integerValue: String(Math.floor(Number(v.value) || 0)),
        // real transform applied in update via transform - for set we just use number
      };
    }
    if (v.__op === 'serverTimestamp') {
      return { timestampValue: new Date().toISOString() };
    }
    if (v.__op === 'delete') {
      return { nullValue: null };
    }
    const fields = {};
    for (const k of Object.keys(v)) {
      if (k === '__op') continue;
      fields[k] = toFsValue(v[k]);
    }
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
  if ('arrayValue' in v) {
    const vals = (v.arrayValue && v.arrayValue.values) || [];
    return vals.map(fromFsValue);
  }
  if ('mapValue' in v) {
    const f = (v.mapValue && v.mapValue.fields) || {};
    const o = {};
    for (const k of Object.keys(f)) o[k] = fromFsValue(f[k]);
    return o;
  }
  return null;
}

function docToClient(doc) {
  if (!doc) return null;
  const name = doc.name || '';
  const id = name.split('/').pop();
  const fields = doc.fields || {};
  const data = {};
  for (const k of Object.keys(fields)) data[k] = fromFsValue(fields[k]);
  return { id, data, path: name };
}

function dataToFields(data) {
  const fields = {};
  if (!data || typeof data !== 'object') return fields;
  for (const k of Object.keys(data)) {
    if (data[k] && typeof data[k] === 'object' && data[k].__op === 'delete') continue;
    fields[k] = toFsValue(data[k]);
  }
  return fields;
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
  let url = `${fsBase(projectId)}/${collection}`;
  if (docId) url += '?documentId=' + encodeURIComponent(docId);
  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ fields }),
  });
  if (!r.ok) throw new Error('FS CREATE ' + r.status + ' ' + (await r.text()));
  return r.json();
}

async function fsDelete(token, projectId, path) {
  const url = `${fsBase(projectId)}/${path}`;
  const r = await fetch(url, {
    method: 'DELETE',
    headers: { Authorization: 'Bearer ' + token },
  });
  if (r.status === 404) return true;
  if (!r.ok) throw new Error('FS DELETE ' + path + ' ' + r.status + ' ' + (await r.text()));
  return true;
}

async function fsList(token, projectId, collection, pageSize = 50, pageToken = null) {
  const size = Math.min(Math.max(1, Number(pageSize) || 50), 50);
  let url =
    `${fsBase(projectId)}/${collection}?pageSize=` +
    encodeURIComponent(String(size));
  if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
  if (!r.ok) throw new Error('FS LIST ' + r.status + ' ' + (await r.text()));
  const data = await r.json();
  const docs = data.documents || [];
  // segurança: no máximo 50
  return {
    documents: docs.slice(0, 50),
    nextPageToken: data.nextPageToken || null,
  };
}

async function fsQuery(token, projectId, collection, constraints, limit, orderBy) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const from = [{ collectionId: collection }];
  const structuredQuery = { from };

  if (constraints && constraints.length) {
    if (constraints.length === 1) {
      const c = constraints[0];
      structuredQuery.where = {
        fieldFilter: {
          field: { fieldPath: c.field },
          op: mapOp(c.op),
          value: toFsValue(c.value),
        },
      };
    } else {
      structuredQuery.where = {
        compositeFilter: {
          op: 'AND',
          filters: constraints.map((c) => ({
            fieldFilter: {
              field: { fieldPath: c.field },
              op: mapOp(c.op),
              value: toFsValue(c.value),
            },
          })),
        },
      };
    }
  }

  if (orderBy && orderBy.field) {
    structuredQuery.orderBy = [
      {
        field: { fieldPath: orderBy.field },
        direction: orderBy.dir === 'desc' ? 'DESCENDING' : 'ASCENDING',
      },
    ];
  }

  if (limit) structuredQuery.limit = Math.min(Math.max(1, Number(limit) || 50), 50);

  const r = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ structuredQuery }),
  });
  if (!r.ok) throw new Error('FS QUERY ' + r.status + ' ' + (await r.text()));
  const rows = await r.json();
  const docs = [];
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (row.document) docs.push(docToClient(row.document));
    }
  }
  return docs;
}

function mapOp(op) {
  const m = {
    '==': 'EQUAL',
    '!=': 'NOT_EQUAL',
    '<': 'LESS_THAN',
    '<=': 'LESS_THAN_OR_EQUAL',
    '>': 'GREATER_THAN',
    '>=': 'GREATER_THAN_OR_EQUAL',
    'array-contains': 'ARRAY_CONTAINS',
    in: 'IN',
  };
  return m[op] || 'EQUAL';
}

/** Apply FieldValue.increment properly via read-modify-write */
function applyIncrements(existingData, updateData) {
  const out = Object.assign({}, existingData || {});
  for (const k of Object.keys(updateData || {})) {
    const v = updateData[k];
    if (v && typeof v === 'object' && v.__op === 'increment') {
      out[k] = (Number(out[k]) || 0) + (Number(v.value) || 0);
    } else if (v && typeof v === 'object' && v.__op === 'delete') {
      delete out[k];
    } else if (v && typeof v === 'object' && v.__op === 'serverTimestamp') {
      out[k] = new Date().toISOString();
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }
  // GET = teste rápido no browser (sem token)
  if (request.method === 'GET') {
    return json({
      ok: true,
      msg: 'Admin API no ar. Usa POST com Authorization Bearer (token Firebase).',
      endpoint: '/api/admin',
    });
  }
  if (request.method !== 'POST') {
    return json({ ok: false, erro: 'Usa POST (ou GET para teste). Método: ' + request.method }, 405);
  }

  let sa;
  try {
    const raw = env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) return json({ ok: false, erro: 'FIREBASE_SERVICE_ACCOUNT em falta' }, 500);
    sa = parseServiceAccount(raw);
  } catch (e) {
    return json({ ok: false, erro: 'Secret inválido: ' + (e.message || String(e)) }, 500);
  }

  const authHeader = request.headers.get('Authorization') || '';
  const idToken = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!idToken) {
    return json({ ok: false, erro: 'Falta Authorization Bearer (token Firebase Auth)' }, 401);
  }

  let admin;
  try {
    admin = await verifyIdToken(idToken);
  } catch (e) {
    return json({ ok: false, erro: e.message || 'Não autorizado' }, 403);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, erro: 'JSON inválido' }, 400);
  }

  const op = String(body.op || '')
    .trim()
    .toLowerCase();
  const projectId = sa.project_id;

  try {
    const token = await getAccessToken(sa);

    if (op === 'ping') {
      return json({ ok: true, admin: admin.email, msg: 'Admin API activa' });
    }

    if (op === 'get') {
      const path = String(body.path || '').replace(/^\/+/, '');
      if (!path || path.includes('..')) return json({ ok: false, erro: 'path inválido' }, 400);
      const doc = await fsGet(token, projectId, path);
      return json({ ok: true, doc: docToClient(doc), exists: !!doc });
    }

    if (op === 'set') {
      const path = String(body.path || '').replace(/^\/+/, '');
      if (!path || path.includes('..')) return json({ ok: false, erro: 'path inválido' }, 400);
      const merge = !!body.merge;
      let data = body.data || {};
      if (merge) {
        const existing = await fsGet(token, projectId, path);
        const prev = existing ? docToClient(existing).data : {};
        data = applyIncrements(prev, data);
      } else {
        data = applyIncrements({}, data);
      }
      const fields = dataToFields(data);
      const mask = merge ? Object.keys(data).filter((k) => {
        const v = body.data[k];
        return !(v && v.__op === 'delete');
      }) : null;
      // For full set without merge, use PATCH with all fields (creates if missing)
      await fsPatch(token, projectId, path, fields, mask);
      return json({ ok: true });
    }

    if (op === 'update') {
      const path = String(body.path || '').replace(/^\/+/, '');
      if (!path || path.includes('..')) return json({ ok: false, erro: 'path inválido' }, 400);
      const existing = await fsGet(token, projectId, path);
      if (!existing) return json({ ok: false, erro: 'Documento não existe: ' + path }, 404);
      const prev = docToClient(existing).data;
      const data = applyIncrements(prev, body.data || {});
      // Only patch keys in body.data
      const keys = Object.keys(body.data || {});
      const fields = {};
      for (const k of keys) {
        if (body.data[k] && body.data[k].__op === 'delete') continue;
        fields[k] = toFsValue(data[k]);
      }
      const mask = keys.filter((k) => !(body.data[k] && body.data[k].__op === 'delete'));
      // Deletes: Firestore REST needs updateMask with field + null or separate
      // For delete fields, omit from fields and... actually need FieldTransform
      // Simplified: write full merged doc fields for updated keys only
      await fsPatch(token, projectId, path, fields, mask);
      return json({ ok: true });
    }

    if (op === 'delete') {
      const path = String(body.path || '').replace(/^\/+/, '');
      if (!path || path.includes('..')) return json({ ok: false, erro: 'path inválido' }, 400);
      await fsDelete(token, projectId, path);
      return json({ ok: true });
    }

    if (op === 'add') {
      const collection = String(body.collection || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!collection) return json({ ok: false, erro: 'collection inválida' }, 400);
      const data = applyIncrements({}, body.data || {});
      const fields = dataToFields(data);
      const doc = await fsCreate(token, projectId, collection, null, fields);
      const client = docToClient(doc);
      return json({ ok: true, id: client && client.id, doc: client });
    }

    if (op === 'count') {
      const collection = String(body.collection || 'usuarios').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!collection) return json({ ok: false, erro: 'collection inválida' }, 400);

      let total = 0;
      let method = 'aggregation';

      // 1) Tenta agregação (barata)
      try {
        const url =
          'https://firestore.googleapis.com/v1/projects/' +
          projectId +
          '/databases/(default)/documents:runAggregationQuery';
        const res = await fetch(url, {
          method: 'POST',
          headers: {
            Authorization: 'Bearer ' + token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            structuredAggregationQuery: {
              structuredQuery: { from: [{ collectionId: collection }] },
              aggregations: [{ alias: 'total', count: {} }],
            },
          }),
        });
        const data = await res.json();
        if (res.ok) {
          const rows = Array.isArray(data) ? data : [data];
          for (const row of rows) {
            const agg =
              (row && row.result && row.result.aggregateFields) ||
              (row && row.aggregateFields) ||
              {};
            const t = agg.total || {};
            if (t.integerValue != null) total = parseInt(String(t.integerValue), 10) || 0;
            else if (t.doubleValue != null) total = Math.round(Number(t.doubleValue)) || 0;
          }
        } else {
          method = 'list';
        }
      } catch (eAgg) {
        method = 'list';
      }

      // 2) Fallback: conta página a página (só IDs, 50 de cada vez) se agregação falhar ou der 0 suspeito
      if (method === 'list' || (total === 0 && body.forceList)) {
        method = 'list';
        total = 0;
        let pageToken = null;
        let guard = 0;
        while (guard++ < 200) {
          const listed = await fsList(token, projectId, collection, 50, pageToken);
          const batch = listed.documents || [];
          total += batch.length;
          pageToken = listed.nextPageToken || null;
          if (!pageToken || batch.length === 0) break;
        }
      }

      // Grava em sistema/contadores
      try {
        await fsPatch(
          token,
          projectId,
          'sistema/contadores',
          {
            totalUsuarios: toFsValue(total),
            actualizadoEm: toFsValue(new Date().toISOString()),
          },
          ['totalUsuarios', 'actualizadoEm']
        );
      } catch (e2) {
        try {
          await fsCreate(token, projectId, 'sistema', 'contadores', {
            totalUsuarios: toFsValue(total),
            actualizadoEm: toFsValue(new Date().toISOString()),
          });
        } catch (e3) {}
      }

      return json({ ok: true, total: total, collection: collection, method: method });
    }

    if (op === 'queryif (op === 'query' || op === 'list') {
      const collection = String(body.collection || '').replace(/[^a-zA-Z0-9_-]/g, '');
      if (!collection) return json({ ok: false, erro: 'collection inválida' }, 400);
      const limReq = Math.min(Math.max(1, Number(body.limit) || 50), 50);
      let docs;
      let nextPageToken = null;

      // Lista simples (sem where) → pageToken para paginação exacta de 50
      if (
        op === 'list' ||
        !body.constraints ||
        !body.constraints.length
      ) {
        const listed = await fsList(
          token,
          projectId,
          collection,
          limReq,
          body.pageToken || body.startAfter || null
        );
        docs = (listed.documents || []).map(docToClient).slice(0, 50);
        nextPageToken = listed.nextPageToken || null;
      } else {
        docs = await fsQuery(
          token,
          projectId,
          collection,
          body.constraints,
          limReq,
          body.orderBy
        );
        docs = (docs || []).slice(0, 50);
      }
      return json({ ok: true, docs: docs, nextPageToken: nextPageToken });
    }

    return json({ ok: false, erro: 'op desconhecida: ' + op }, 400);
  } catch (e) {
    return json({
      ok: false,
      erro: 'Erro admin: ' + (e && e.message ? e.message : String(e)),
    }, 500);
  }
}
