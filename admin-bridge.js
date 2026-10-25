/**
 * Desafio MOZ – Ponte Admin → Cloudflare Function
 * Lista com limite estrito; suporta startAfter para paginação.
 */
(function (global) {
  var API = 'https://desafiomoz.pages.dev/api/admin';
  var _auth = null;
  var _activo = false;

  function serializeData(data) {
    if (data == null) return data;
    if (typeof data !== 'object') return data;
    if (data.isEqual && data._methodName) {
      var m = data._methodName;
      if (m === 'FieldValue.increment') return { __op: 'increment', value: data._operand || 1 };
      if (m === 'FieldValue.delete') return { __op: 'delete' };
      if (m === 'FieldValue.serverTimestamp') return { __op: 'serverTimestamp' };
    }
    try {
      var s = String(data);
      if (s.indexOf('FieldValue.increment') !== -1) {
        var n = 1;
        try { n = data.va || data._operand || 1; } catch (e) {}
        return { __op: 'increment', value: Number(n) || 1 };
      }
      if (s.indexOf('FieldValue.delete') !== -1) return { __op: 'delete' };
      if (s.indexOf('FieldValue.serverTimestamp') !== -1) return { __op: 'serverTimestamp' };
    } catch (e2) {}
    if (Array.isArray(data)) return data.map(serializeData);
    var out = {};
    for (var k in data) {
      if (!Object.prototype.hasOwnProperty.call(data, k)) continue;
      out[k] = serializeData(data[k]);
    }
    return out;
  }

  function patchFieldValue() {
    try {
      if (!global.firebase || !firebase.firestore) return;
      var FV = firebase.firestore.FieldValue;
      if (!FV || FV.__dm_patched) return;
      FV.increment = function (n) {
        return { __op: 'increment', value: Number(n) || 0, isEqual: function () { return false; } };
      };
      FV.delete = function () {
        return { __op: 'delete', isEqual: function () { return false; } };
      };
      FV.serverTimestamp = function () {
        return { __op: 'serverTimestamp', isEqual: function () { return false; } };
      };
      FV.__dm_patched = true;
    } catch (e) {}
  }

  async function adminOp(body) {
    if (!_auth || !_auth.currentUser) throw new Error('Admin sem login');
    var token = await _auth.currentUser.getIdToken();
    var res = await fetch(API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify(body),
    });
    var text = await res.text();
    var data;
    try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    if (!res.ok) {
      var msg = (data && data.error) || text || ('HTTP ' + res.status);
      throw new Error(msg);
    }
    return data;
  }

  function normalizeOrderField(field) {
    if (field == null) return null;
    if (typeof field === 'string') return field;
    // FieldPath.documentId() → __name__
    try {
      if (field.isEqual || field.segments || field._segments) return '__name__';
      var s = String(field);
      if (s.indexOf('documentId') !== -1 || s.indexOf('__name__') !== -1) return '__name__';
    } catch (e) {}
    return String(field);
  }

  function makeDocRef(path) {
    var parts = path.split('/');
    var collection = parts[0];
    var id = parts.slice(1).join('/');
    return {
      id: id,
      path: path,
      get: async function () {
        var r = await adminOp({ op: 'get', path: path });
        return {
          id: id,
          exists: !!(r && r.exists),
          data: function () { return (r && r.data) || null; },
          ref: makeDocRef(path),
        };
      },
      set: async function (data, opts) {
        await adminOp({
          op: 'set',
          path: path,
          data: serializeData(data),
          merge: !!(opts && opts.merge),
        });
      },
      update: async function (data) {
        await adminOp({
          op: 'update',
          path: path,
          data: serializeData(data),
        });
      },
      delete: async function () {
        await adminOp({ op: 'delete', path: path });
      },
    };
  }

  function makeQuery(collection, constraints, lim, orderBy, startAfterId) {
    constraints = constraints || [];
    var q = {
      where: function (field, op, value) {
        return makeQuery(
          collection,
          constraints.concat([{ field: field, op: op, value: value }]),
          lim,
          orderBy,
          startAfterId
        );
      },
      limit: function (n) {
        return makeQuery(collection, constraints, n, orderBy, startAfterId);
      },
      orderBy: function (field, dir) {
        return makeQuery(
          collection,
          constraints,
          lim,
          { field: normalizeOrderField(field), dir: dir || 'asc' },
          startAfterId
        );
      },
      startAfter: function (docOrId) {
        var sid = docOrId;
        if (docOrId && typeof docOrId === 'object') {
          sid = docOrId.id || (docOrId._id) || null;
        }
        return makeQuery(collection, constraints, lim, orderBy, sid);
      },
      get: async function () {
        var hardLimit = Math.min(Math.max(1, Number(lim) || 50), 50);
        var r = await adminOp({
          op: constraints.length ? 'query' : 'list',
          collection: collection,
          constraints: constraints,
          limit: hardLimit,
          orderBy: orderBy || null,
          pageToken: startAfterId || null,
        });
        var docs = (r.docs || []).map(function (d) {
          return {
            id: d.id,
            exists: true,
            data: function () { return d.data; },
            ref: makeDocRef(collection + '/' + d.id),
          };
        });
        if (docs.length > 50) docs = docs.slice(0, 50);
        return {
          empty: docs.length === 0,
          size: docs.length,
          docs: docs,
          nextPageToken: r.nextPageToken || null,
          forEach: function (fn) { docs.forEach(fn); },
        };
      },
    };
    return q;
  }

  function makeCollection(name) {
    return {
      doc: function (id) {
        return makeDocRef(name + '/' + id);
      },
      add: async function (data) {
        var r = await adminOp({
          op: 'add',
          collection: name,
          data: serializeData(data),
        });
        return makeDocRef(name + '/' + (r.id || 'unknown'));
      },
      where: function (field, op, value) {
        return makeQuery(name, [{ field: field, op: op, value: value }], null, null, null);
      },
      limit: function (n) {
        return makeQuery(name, [], n, null, null);
      },
      orderBy: function (field, dir) {
        return makeQuery(name, [], null, { field: normalizeOrderField(field), dir: dir || 'asc' }, null);
      },
      get: async function () {
        // Sem limit explícito → no máximo 50 (protege cota)
        return makeQuery(name, [], 50, null, null).get();
      },
    };
  }

  function createProxyDb() {
    return {
      collection: function (name) {
        return makeCollection(name);
      },
    };
  }

  global.DM_ativarAdminBridge = async function (auth) {
    _auth = auth;
    patchFieldValue();
    try {
      await adminOp({ op: 'ping' });
    } catch (e) {
      console.error('Admin bridge ping falhou:', e);
      throw e;
    }
    global.db = createProxyDb();
    if (typeof window !== 'undefined') window.db = global.db;
    _activo = true;
    console.log('[DM] Admin bridge activo → /api/admin (max 50/lista)');
    return true;
  };

  global.DM_adminBridgeActivo = function () {
    return _activo;
  };

  /** Total exacto de documentos numa coleção (1 agregação) */
  global.DM_adminCount = async function (collection) {
    return adminOp({ op: 'count', collection: collection || 'usuarios' });
  };
})(typeof window !== 'undefined' ? window : this);
