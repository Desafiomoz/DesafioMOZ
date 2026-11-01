/**
 * Desafio MOZ – AURAVIA: carregar/guardar progresso na conta
 * POST /api/auravia-salvar
 * Body: { email, action: "load"|"save", state?: {...} }
 * Coleção: auraviaEstado/{email}
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
function fsPathDoc(collection, docId) {
  return collection + '/' + encodeURIComponent(String(docId));
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
function lerStr(doc, key, def = '') {
  try {
    const f = doc && doc.fields && doc.fields[key];
    if (!f || f.stringValue == null) return def;
    return String(f.stringValue);
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

const DEFAULT_STATE = {
  lv: 1,
  maxLv: 1,
  orbs: 0,
  coins: 0,
  sh: 0,
  mg: 0,
  tu: 0,
  lt: 0,
  nt: 0,
  x2: 0,
  mo: 0,
  ag: 0,
  te: 0,
  fuel: 4,
  lock: 0,
  inf: 0,
  skin: 0,
  own: [0],
  vol: 0.6,
  ctl: 0,
  glow: 1,
  dn: '',
  progV: 2,
};

function parseState(raw) {
  try {
    if (!raw) return null;
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!o || typeof o !== 'object') return null;
    return o;
  } catch (e) {
    return null;
  }
}

/** Maior nível concluído (com estrelas) no dn + 1 = maxLv legítimo */
function maxLvFromDn(dn) {
  const s = String(dn || '');
  let highest = 0;
  for (let i = 0; i < s.length; i++) {
    const v = parseInt(s.charAt(i), 10);
    if (v > 0) highest = i + 1;
  }
  return highest ? Math.min(1100, highest + 1) : 1;
}

function sanitizeIncoming(state, base) {
  const out = Object.assign({}, DEFAULT_STATE, base || {});
  if (!state || typeof state !== 'object') return out;

  const dn = String(state.dn != null ? state.dn : out.dn || '').slice(0, 1200);
  const maxLvClient = clampInt(state.maxLv, 1, 1100);
  const lvClient = clampInt(state.lv, 1, 1100);
  const orbs = clampInt(state.orbs, 0, 500000);
  const coins = clampInt(state.coins, 0, 500000);

  if (base) {
    const bMax = clampInt(base.maxLv, 1, 1100);
    const bOrbs = clampInt(base.orbs, 0, 500000);
    const bCoins = clampInt(base.coins, 0, 500000);
    const fromDn = maxLvFromDn(dn);
    // Nunca baixar maxLv. Aceitar progresso real via dn ou +10 por gravação (rede lenta / várias vitórias)
    let nextMax = Math.max(bMax, fromDn, Math.min(maxLvClient, bMax + 10));
    out.maxLv = clampInt(nextMax, 1, 1100);
    // orbs/coins: permitir subida razoável (vitórias + recolha)
    out.orbs = Math.max(0, Math.min(orbs, bOrbs + 500));
    out.coins = Math.max(0, Math.min(coins, bCoins + 200));
    // consumíveis: não sobem no cliente (compras via Function)
    ['sh', 'mg', 'tu', 'lt', 'nt'].forEach((k) => {
      const nv = clampInt(state[k], 0, 999);
      const bv = clampInt(base[k], 0, 999);
      out[k] = Math.min(nv, bv);
    });
    out.x2 = base.x2 ? 1 : 0;
    ['mo', 'ag', 'te'].forEach((k) => {
      const nv = clampInt(state[k], 0, 5);
      const bv = clampInt(base[k], 0, 5);
      out[k] = Math.max(bv, Math.min(nv, bv + 1));
    });
    out.fuel = clampInt(state.fuel, 0, 4);
    out.lock = Math.max(0, Math.floor(Number(state.lock) || 0));
    out.inf = Math.max(0, Math.floor(Number(base.inf) || 0));
    if (state.inf && Number(state.inf) > out.inf && Number(state.inf) - out.inf < 1000) {
      // ignora subidas pequenas espúrias
    }
    // inf só por compra: manter base
    out.inf = Math.max(0, Math.floor(Number(base.inf) || 0));
    out.skin = clampInt(state.skin, 0, 5);
    out.vol = Math.max(0, Math.min(1, Number(state.vol) != null ? Number(state.vol) : 0.6));
    out.ctl = clampInt(state.ctl, 0, 3);
    out.glow = state.glow === 0 ? 0 : 1;
    out.dn = dn.length >= String(base.dn || '').length ? dn : String(base.dn || '');
    let own = Array.isArray(state.own) ? state.own.map((x) => clampInt(x, 0, 5)) : [0];
    own = Array.from(new Set(own)).filter((x) => x >= 0 && x <= 5);
    if (!own.includes(0)) own.unshift(0);
    const baseOwn = Array.isArray(base.own) ? base.own : [0];
    out.own = own.filter((i) => baseOwn.indexOf(i) >= 0 || i === 0);
    if (!out.own.length) out.own = [0];
  } else {
    // conta nova
    out.maxLv = 1;
    out.lv = 1;
    out.orbs = 0;
    out.coins = 0;
    out.sh = out.mg = out.tu = out.lt = out.nt = 0;
    out.x2 = 0;
    out.mo = out.ag = out.te = 0;
    out.fuel = 4;
    out.lock = 0;
    out.inf = 0;
    out.skin = 0;
    out.own = [0];
    out.dn = '';
    out.vol = 0.6;
    out.ctl = 0;
    out.glow = 1;
  }

  out.lv = clampInt(Math.min(lvClient, out.maxLv), 1, out.maxLv);
  out.progV = 2;
  return out;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method === 'GET') {
    return json({ ok: true, msg: 'AURAVIA salvar API no ar. Usa POST com action load|save.' });
  }
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
    if (!email) return json({ ok: false, erro: 'E-mail inválido. Faz login no Desafio MOZ.' }, 400);

    const action = String(body.action || 'load').toLowerCase();
    const path = fsPathDoc('auraviaEstado', email);
    const existente = await fsGet(token, projectId, path);

    if (action === 'load') {
      if (!existente || !existente.fields) {
        return json({ ok: true, novo: true, state: DEFAULT_STATE });
      }
      const raw = lerStr(existente, 'stateJson', '');
      const st = parseState(raw) || DEFAULT_STATE;
      const merged = Object.assign({}, DEFAULT_STATE, st);
      if (!merged.maxLv || merged.maxLv < 1) merged.maxLv = 1;
      if (!merged.lv || merged.lv < 1) merged.lv = 1;
      if (merged.lv > merged.maxLv) merged.lv = merged.maxLv;
      return json({ ok: true, novo: false, state: merged });
    }

    if (action === 'save') {
      const base = existente
        ? parseState(lerStr(existente, 'stateJson', '')) || DEFAULT_STATE
        : null;
      const clean = sanitizeIncoming(body.state, base);
      const fields = {
        stateJson: strField(JSON.stringify(clean)),
        email: strField(email),
        maxLv: numField(clean.maxLv),
        lv: numField(clean.lv),
        orbs: numField(clean.orbs),
        coins: numField(clean.coins),
        updatedAt: numField(Date.now()),
      };
      if (existente) {
        await fsPatch(token, projectId, path, fields, Object.keys(fields));
      } else {
        await fsCreate(token, projectId, 'auraviaEstado', email, fields);
      }
      return json({ ok: true, state: clean });
    }

    return json({ ok: false, erro: 'action inválida (load|save)' }, 400);
  } catch (e) {
    return json({ ok: false, erro: e.message || String(e) }, 500);
  }
}
