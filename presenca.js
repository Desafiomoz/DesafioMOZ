/**
 * Desafio MOZ – presença online no site
 * Uso: <script>window.__DM_PRESENCA__ = { pagina: 'desafios', jogando: null };</script>
 *      <script src="presenca.js?v=1"></script>
 *
 * Grava no documento do utilizador (coleção usuarios):
 *   ultimaPresenca (ISO), paginaActual, emJogo ('roleta'|'homejub'|null)
 *
 * Online = ultimaPresenca nos últimos ~3 minutos.
 */
(function () {
  var cfg = window.__DM_PRESENCA__ || {};
  var pagina = String(cfg.pagina || 'site');
  var jogando = cfg.jogando != null ? cfg.jogando : null;
  var INTERVALO_MS = 45000; // 45s
  var timer = null;
  var docRef = null;
  var email = '';

  function getEmail() {
    try {
      return (localStorage.getItem('emailUtilizador') || '').trim();
    } catch (e) {
      return '';
    }
  }

  function getDb() {
    if (window.db) return window.db;
    try {
      if (typeof firebase !== 'undefined' && firebase.apps && firebase.apps.length) {
        return firebase.firestore();
      }
    } catch (e) {}
    return null;
  }

  async function resolverDoc(db, em) {
    if (!em) return null;
    try {
      var snap = await db.collection('usuarios').where('email', '==', em).limit(1).get();
      if (snap.empty) {
        var norm = em.toLowerCase();
        if (norm !== em) {
          snap = await db.collection('usuarios').where('email', '==', norm).limit(1).get();
        }
      }
      if (!snap.empty) return snap.docs[0].ref;
    } catch (e) {
      console.warn('[presenca]', e);
    }
    return null;
  }

  async function ping() {
    var db = getDb();
    email = getEmail();
    if (!db || !email || email === '—') return;
    try {
      if (!docRef) docRef = await resolverDoc(db, email);
      if (!docRef) return;
      var payload = {
        ultimaPresenca: new Date().toISOString(),
        paginaActual: pagina,
        ultimaAtualizacao: new Date().toISOString()
      };
      if (jogando) payload.emJogo = String(jogando);
      else payload.emJogo = null;
      await docRef.update(payload);
    } catch (e) {
      console.warn('[presenca] update', e);
      docRef = null; // tenta de novo
    }
  }

  function arrancar() {
    email = getEmail();
    if (!email || email === '—') return;
    ping();
    if (timer) clearInterval(timer);
    timer = setInterval(ping, INTERVALO_MS);
  }

  // API pública para jogos
  window.DM_presenca = {
    setJogando: function (v) {
      jogando = v || null;
      ping();
    },
    setPagina: function (p) {
      pagina = p || 'site';
      ping();
    },
    ping: ping
  };

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) ping();
  });

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(arrancar, 800);
  } else {
    document.addEventListener('DOMContentLoaded', function () {
      setTimeout(arrancar, 800);
    });
  }
})();
