/**
 * Desafio MOZ – Ponte Admin → Cloudflare Function
 * Substitui window.db por um proxy que envia tudo para /api/admin
 * com o token Firebase Auth do administrador.
 *
 * Incluir DEPOIS do firebase init e DEPOIS de auth estar definido.
 * Chamar: window.DM_ativarAdminBridge(auth)
 */
(function (global) {
  var API = 'https://desafiomoz.pages.dev/api/admin';
  var _auth = null;
  var _activo = false;

  function serializeData(data) {
    if (data == null) return data;
    if (typeof data !== 'object') return data;
    // Detect Firebase FieldValue sentinels
    if (data.constructor && data.constructor.name === 'FieldValueImpl') {
      // Fallback string inspection
    }
    // Our markers
    if (data.isEqual && data._methodName) {
      var m = data._methodName;
      if (m === 'FieldValue.increment') return { __op: 'increment', value: data._operand || 1 };
      if (m === 'FieldValue.delete') return { __op: 'delete' };
      if (m === 'FieldValue.serverTimestamp') return { __op: 'serverTimestamp' };
    }
    // firebase.firestore.FieldValue.increment returns object with toString
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

  // Patch FieldValue helpers to emit markers
  function patchFieldValue() {
    try {
      if (!global.firebase || !firebase.firestore) return;
      var FV = firebase.firestore.FieldValue;
      if (!FV || FV.__dm_patched) return;
      var origInc = FV.increment.bind(FV);
      var origDel = FV.delete.bind(FV);
      var origTs = FV.serverTimestamp.bind(FV);
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
      FV.__dm_orig = { increment: origInc, delete: origDel, serverTimestamp: origTs };
    } catch (e) {}
  }

  async function adminOp(body) {
    if (!_auth || !_auth.currentUser) {
      throw new Error('Admin não autenticado');
    }
    var token = await _auth.currentUser.getIdToken(true);
    var resp = await fetch(API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + token,
      },
      body: JSON.stringify(body),
    });
    var data = await resp.json().catch(function () { return {}; });
    if (!resp.ok || data.ok === false) {
      throw new Error((data && data.erro) || ('Admin API ' + resp.status));
    }
    return data;
  }

  function makeDocRef(path) {
    return {
      id: path.split('/').pop(),
      path: path,
      get: async function () {
        var r = await adminOp({ op: 'get', path: path });
        return {
          exists: !!r.exists,
          id: r.doc ? r.doc.id : path.split('/').pop(),
          data: function () { return r.doc ? r.doc.data : undefined; },
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
        await adminOp({ op: 'update', path: path, data: serializeData(data) });
      },
      delete: async function () {
        await adminOp({ op: 'delete', path: path });
      },
    };
  }

  function makeQuery(collection, constraints, lim, orderBy) {
    constraints = constraints || [];
    var q = {
      where: function (field, op, value) {
        return makeQuery(
          collection,
          constraints.concat([{ field: field, op: op, value: value }]),
          lim,
          orderBy
        );
      },
      limit: function (n) {
        return makeQuery(collection, constraints, n, orderBy);
      },
      orderBy: function (field, dir) {
        return makeQuery(collection, constraints, lim, { field: field, dir: dir || 'asc' });
      },
      get: async function () {
        var r = await adminOp({
          op: constraints.length ? 'query' : 'list',
          collection: collection,
          constraints: constraints,
          limit: lim || 300,
          orderBy: orderBy || null,
        });
        var docs = (r.docs || []).map(function (d) {
          return {
            id: d.id,
            exists: true,
            data: function () { return d.data; },
            ref: makeDocRef(collection + '/' + d.id),
          };
        });
        return {
          empty: docs.length === 0,
          size: docs.length,
          docs: docs,
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
        return makeQuery(name, [{ field: field, op: op, value: value }], null, null);
      },
      limit: function (n) {
        return makeQuery(name, [], n, null);
      },
      orderBy: function (field, dir) {
        return makeQuery(name, [], null, { field: field, dir: dir || 'asc' });
      },
      get: async function () {
        return makeQuery(name, [], 300, null).get();
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
    console.log('[DM] Admin bridge activo → /api/admin');
    return true;
  };

  global.DM_adminBridgeActivo = function () {
    return _activo;
  };
})(typeof window !== 'undefined' ? window : this);
