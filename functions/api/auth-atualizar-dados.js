/**
 * Desafio MOZ – Actualizar dados da conta (nome, telemóvel, senha)
 * Secret: FIREBASE_SERVICE_ACCOUNT
 * POST { email, nome, telemovel, senha }
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

async function fsGet(token, projectId, path) {
  const r = await fetch(`${fsBase(projectId)}/${path}`, {
    headers: { Authorization: 'Bearer ' + token },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error('GET ' + path + ' ' + r.status);
  return r.json();
}

async function fsQuery(token, projectId, collection, field, op, value, limit = 5) {
  const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents:runQuery`;
  const structuredQuery = {
    from: [{ collectionId: collection }],
    where: {
      fieldFilter: {
        field: { fieldPath: field },
        op: op === '==' ? 'EQUAL' : op,
        value: toFsValue(value),
      },
    },
    limit: limit,
  };
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
  if (Array.isArray(rows)) {
    for (const row of rows) {
      if (row.document) {
        out.push({
          id: docIdFromName(row.document.name),
          path: row.document.name.replace(/^.*\/documents\//, ''),
          data: docToData(row.document),
        });
      }
    }
  }
  return out;
}

async function sha256Hex(text) {
  const data = new TextEncoder().encode(String(text));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function emailGmailValido(email) {
  return /^[^\s@]+@gmail\.com$/i.test(String(email || '').trim());
}

function telMozValido(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (d.indexOf('258') === 0) d = d.slice(3);
  return /^8\d{8}$/.test(d);
}

function normalizarTelMoz(tel) {
  let d = String(tel || '').replace(/\D/g, '');
  if (d.indexOf('258') === 0) d = d.slice(3);
  return '+258' + d;
}

async function emailBanido(token, projectId, email) {
  const e = String(email || '').trim().toLowerCase();
  if (!e) return false;
  try {
    const doc = await fsGet(token, projectId, 'sistema/emailsBanidos');
    if (doc && doc.fields) {
      const data = docToData(doc);
      for (const k of Object.keys(data)) {
        const d = data[k];
        if (d && typeof d === 'object' && String(d.email || '').trim().toLowerCase() === e) return d;
      }
    }
  } catch (err) {}
  try {
    const doc2 = await fsGet(token, projectId, 'emailsBanidos/' + e);
    if (doc2 && doc2.fields) {
      const d2 = docToData(doc2);
      if (d2.email || d2.motivo || d2.banidoEm) return d2.email ? d2 : { email: e };
    }
  } catch (err2) {}
  return false;
}

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method === 'GET') return json({ ok: true, msg: 'auth-atualizar-dados API no ar. Usa POST.' });
  if (request.method !== 'POST') return json({ ok: false, erro: 'Só POST' }, 405);

  let sa;
  try {
    const raw = env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) return json({ ok: false, erro: 'FIREBASE_SERVICE_ACCOUNT em falta' }, 500);
    sa = parseServiceAccount(raw);
  } catch (e) {
    return json({ ok: false, erro: 'Secret inválido' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch (e) {
    return json({ ok: false, erro: 'JSON inválido' }, 400);
  }

  const nome = String(body.nome || '').trim();
  let telemovel = String(body.telemovel || body.telefone || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const senha = String(body.senha || body.password || '');

  if (!nome || nome.length < 2) return json({ ok: false, erro: 'Nome inválido' }, 400);
  if (!emailGmailValido(email)) return json({ ok: false, erro: 'Só são aceites e-mails @gmail.com' }, 400);
  if (!telMozValido(telemovel)) return json({ ok: false, erro: 'Só números de Moçambique (8XXXXXXXX ou +258...)' }, 400);
  if (senha.length < 6) return json({ ok: false, erro: 'Senha mínima 6 caracteres' }, 400);

  telemovel = normalizarTelMoz(telemovel);

  try {
    const token = await getAccessToken(sa);
    const projectId = sa.project_id;

    const ban = await emailBanido(token, projectId, email);
    if (ban) {
      return json(
        {
          ok: false,
          banido: true,
          erro:
            'Este e-mail está banido permanentemente do Desafio MOZ' +
            (ban.motivo ? ' (' + String(ban.motivo).slice(0, 70) + ')' : '') +
            '.',
        },
        403
      );
    }

    const users = await fsQuery(token, projectId, 'usuarios', 'email', '==', email, 1);
    if (!users.length) {
      return json({ ok: false, erro: 'Este e-mail não está registado no Desafio MOZ.' }, 404);
    }
    const user = users[0];

    // telemóvel já usado por outra conta?
    const tels = await fsQuery(token, projectId, 'usuarios', 'telemovel', '==', telemovel, 5);
    let telConflito = tels.some(
      (u) => String((u.data && u.data.email) || '').toLowerCase() !== email
    );
    if (!telConflito) {
      const telAlt = telemovel.replace(/^\+258/, '');
      const tels2 = await fsQuery(token, projectId, 'usuarios', 'telemovel', '==', telAlt, 5);
      telConflito = tels2.some(
        (u) => String((u.data && u.data.email) || '').toLowerCase() !== email
      );
    }
    if (telConflito) {
      return json({ ok: false, erro: 'Este número já está ligado a outra conta.' }, 409);
    }

    const senhaHash = await sha256Hex(senha);
    const agora = new Date().toISOString();
    const fields = {
      nome: toFsValue(nome),
      telemovel: toFsValue(telemovel),
      senha: toFsValue(senhaHash),
      dadosActualizados: toFsValue(true),
      dadosActualizadosEm: toFsValue(agora),
      ultimaAtualizacao: toFsValue(agora),
    };
    await fsPatch(token, projectId, user.path, fields, [
      'nome',
      'telemovel',
      'senha',
      'dadosActualizados',
      'dadosActualizadosEm',
      'ultimaAtualizacao',
    ]);

    return json({
      ok: true,
      usuario: {
        email: email,
        nome: nome,
        telemovel: telemovel,
        dadosActualizados: true,
      },
    });
  } catch (e) {
    return json({ ok: false, erro: String(e.message || e) }, 500);
  }
}
