/**
 * Desafio MOZ – notificações de menção no chat + convite idle
 * Incluir após Firebase: <script src="notificacoes-chat.js"></script>
 * Opções: window.__DM_NOTIF__ = { mencao: true, idle: true, idleSegundos: 20, idleMaxDia: 2 }
 */
(function () {
  if (window.__DM_NOTIF_LOADED__) return;
  window.__DM_NOTIF_LOADED__ = true;

  var cfg = Object.assign({
    mencao: true,
    idle: false,
    idleSegundos: 20,
    idleMaxDia: 2,
    pagina: (location.pathname.split('/').pop() || '').toLowerCase()
  }, window.__DM_NOTIF__ || {});

  // Não no chat nem em saques
  if (cfg.pagina.indexOf('chat') !== -1 || cfg.pagina.indexOf('saque') !== -1) {
    cfg.mencao = false;
    cfg.idle = false;
  }

  function emailSessao() {
    try {
      var keys = ['emailUtilizador', 'email', 'userEmail'];
      for (var i = 0; i < keys.length; i++) {
        var v = (localStorage.getItem(keys[i]) || '').trim();
        if (v && v !== '—' && v.indexOf('@') !== -1) return v;
      }
    } catch (e) {}
    return '';
  }

  function injetaCSS() {
    if (document.getElementById('dm-notif-css')) return;
    var s = document.createElement('style');
    s.id = 'dm-notif-css';
    s.textContent = [
      '#dm-toast-mencao,#dm-toast-idle{position:fixed;left:50%;z-index:99999;transform:translateX(-50%) translateY(-20px);',
      'max-width:min(420px,92vw);width:100%;opacity:0;pointer-events:none;transition:opacity .35s,transform .35s;}',
      '#dm-toast-mencao.mostrar,#dm-toast-idle.mostrar{opacity:1;transform:translateX(-50%) translateY(0);pointer-events:auto;}',
      '#dm-toast-mencao{top:18px;}',
      '#dm-toast-idle{bottom:88px;}',
      '.dm-toast-card{border-radius:18px;padding:14px 16px;display:flex;gap:12px;align-items:flex-start;',
      'background:linear-gradient(135deg,rgba(40,28,70,.97),rgba(12,40,36,.97));',
      'border:1px solid rgba(168,85,247,.55);',
      'box-shadow:0 0 28px rgba(168,85,247,.45),0 0 48px rgba(34,255,153,.2),0 12px 40px rgba(0,0,0,.45);',
      'animation:dmPulse 2s ease-in-out infinite;}',
      '@keyframes dmPulse{0%,100%{box-shadow:0 0 22px rgba(168,85,247,.4),0 0 36px rgba(34,255,153,.15);}',
      '50%{box-shadow:0 0 34px rgba(34,255,153,.4),0 0 50px rgba(168,85,247,.35);}}',
      '.dm-toast-ico{width:44px;height:44px;border-radius:14px;flex-shrink:0;display:flex;align-items:center;justify-content:center;',
      'font-size:22px;background:linear-gradient(135deg,#a855f7,#22FF99);box-shadow:0 0 18px rgba(34,255,153,.4);}',
      '.dm-toast-body{flex:1;min-width:0;}',
      '.dm-toast-body h4{margin:0 0 4px;font-size:14px;font-weight:800;color:#fff;',
      'background:linear-gradient(90deg,#fff,#22FF99,#FFC94D);-webkit-background-clip:text;background-clip:text;color:transparent;}',
      '.dm-toast-body p{margin:0;font-size:12.5px;color:#c5cdd8;line-height:1.4;}',
      '.dm-toast-body b{color:#22FF99;}',
      '.dm-toast-btn{margin-top:10px;display:inline-flex;align-items:center;gap:6px;padding:8px 14px;border-radius:10px;border:none;',
      'font-size:12.5px;font-weight:800;cursor:pointer;color:#04140a;',
      'background:linear-gradient(90deg,#22FF99,#a855f7);box-shadow:0 4px 16px rgba(34,255,153,.35);text-decoration:none;}',
      '.dm-toast-x{background:transparent;border:none;color:#aaa;font-size:18px;cursor:pointer;padding:2px 6px;line-height:1;}'
    ].join('');
    document.head.appendChild(s);
  }

  function toastMencao(titulo, texto, onClick) {
    injetaCSS();
    var el = document.getElementById('dm-toast-mencao');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dm-toast-mencao';
      document.body.appendChild(el);
    }
    el.innerHTML =
      '<div class="dm-toast-card">' +
        '<div class="dm-toast-ico">💬</div>' +
        '<div class="dm-toast-body">' +
          '<h4>' + titulo + '</h4>' +
          '<p>' + texto + '</p>' +
          '<a class="dm-toast-btn" href="chat.html">Abrir bate-papo</a>' +
        '</div>' +
        '<button type="button" class="dm-toast-x" aria-label="Fechar">×</button>' +
      '</div>';
    el.classList.add('mostrar');
    var x = el.querySelector('.dm-toast-x');
    if (x) x.onclick = function () { el.classList.remove('mostrar'); };
    if (onClick) {
      var btn = el.querySelector('.dm-toast-btn');
      if (btn) btn.onclick = function (e) { e.preventDefault(); onClick(); };
    }
    setTimeout(function () { el.classList.remove('mostrar'); }, 5000);
  }

  function toastIdle() {
    injetaCSS();
    var el = document.getElementById('dm-toast-idle');
    if (!el) {
      el = document.createElement('div');
      el.id = 'dm-toast-idle';
      document.body.appendChild(el);
    }
    el.innerHTML =
      '<div class="dm-toast-card">' +
        '<div class="dm-toast-ico">✨</div>' +
        '<div class="dm-toast-body">' +
          '<h4>A comunidade está no bate-papo</h4>' +
          '<p>Entra agora, conversa e responde — a sala está <b>ao vivo</b>.</p>' +
          '<a class="dm-toast-btn" href="chat.html">Ir ao bate-papo</a>' +
        '</div>' +
        '<button type="button" class="dm-toast-x" aria-label="Fechar">×</button>' +
      '</div>';
    el.classList.add('mostrar');
    var x = el.querySelector('.dm-toast-x');
    if (x) x.onclick = function () { el.classList.remove('mostrar'); };
    setTimeout(function () { el.classList.remove('mostrar'); }, 8000);
  }

  function diaKey() {
    var d = new Date();
    return d.getFullYear() + '-' + (d.getMonth() + 1) + '-' + d.getDate();
  }

  function idleCount() {
    try {
      var raw = localStorage.getItem('dmIdleChat') || '';
      var o = raw ? JSON.parse(raw) : {};
      if (o.dia !== diaKey()) return 0;
      return o.n || 0;
    } catch (e) { return 0; }
  }

  function bumpIdle() {
    try {
      var n = idleCount() + 1;
      localStorage.setItem('dmIdleChat', JSON.stringify({ dia: diaKey(), n: n }));
    } catch (e) {}
  }

  function iniciarIdle() {
    if (!cfg.idle) return;
    if (idleCount() >= cfg.idleMaxDia) return;
    var timer = null;
    function reset() {
      if (timer) clearTimeout(timer);
      if (idleCount() >= cfg.idleMaxDia) return;
      timer = setTimeout(function () {
        if (idleCount() >= cfg.idleMaxDia) return;
        bumpIdle();
        toastIdle();
      }, (cfg.idleSegundos || 20) * 1000);
    }
    ['touchstart', 'mousedown', 'scroll', 'keydown', 'click'].forEach(function (ev) {
      document.addEventListener(ev, reset, { passive: true });
    });
    reset();
  }

  function jaMostrou(id) {
    try {
      var arr = JSON.parse(localStorage.getItem('dmMencoesVistas') || '[]');
      return arr.indexOf(id) !== -1;
    } catch (e) { return false; }
  }

  function marcarVista(id) {
    try {
      var arr = JSON.parse(localStorage.getItem('dmMencoesVistas') || '[]');
      if (arr.indexOf(id) === -1) arr.push(id);
      if (arr.length > 80) arr = arr.slice(-80);
      localStorage.setItem('dmMencoesVistas', JSON.stringify(arr));
    } catch (e) {}
  }

  function escutarMencoes() {
    if (!cfg.mencao) return;
    var email = emailSessao();
    if (!email) return;
    if (typeof firebase === 'undefined' || !window.db) return;
    var db = window.db;
    var emailLow = email.toLowerCase();

    try {
      db.collection('notificacoesChat')
        .where('email', '==', emailLow)
        .orderBy('createdAt', 'desc')
        .limit(15)
        .onSnapshot(function (snap) {
          snap.docChanges().forEach(function (ch) {
            if (ch.type !== 'added') return;
            var id = ch.doc.id;
            if (jaMostrou(id)) return;
            var d = ch.doc.data() || {};
            // só notificações recentes (últimos 2 min) para não floodar ao abrir a página
            var t = d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().getTime() : 0;
            if (t && Date.now() - t > 120000) {
              marcarVista(id);
              return;
            }
            marcarVista(id);
            var quem = d.deNome || 'Alguém';
            var trecho = (d.texto || '').slice(0, 80);
            toastMencao(
              'Foste mencionado no bate-papo',
              '<b>' + quem + '</b> ' + (d.tipo === 'resposta' ? 'respondeu-te' : 'mencionou-te') +
                (trecho ? ': “' + trecho + '”' : '')
            );
            try {
              ch.doc.ref.update({ lida: true }).catch(function () {});
            } catch (e) {}
          });
        }, function (err) {
          console.warn('notif chat', err);
          // fallback sem orderBy (sem índice)
          db.collection('notificacoesChat')
            .where('email', '==', emailLow)
            .limit(10)
            .onSnapshot(function (snap2) {
              snap2.docChanges().forEach(function (ch) {
                if (ch.type !== 'added') return;
                var id = ch.doc.id;
                if (jaMostrou(id)) return;
                var d = ch.doc.data() || {};
                var t = d.createdAt && d.createdAt.toDate ? d.createdAt.toDate().getTime() : Date.now();
                if (Date.now() - t > 120000) { marcarVista(id); return; }
                marcarVista(id);
                var quem = d.deNome || 'Alguém';
                toastMencao('Foste mencionado no bate-papo', '<b>' + quem + '</b> falou de ti no chat.');
              });
            });
        });
    } catch (e) {
      console.warn(e);
    }
  }

  function boot() {
    injetaCSS();
    escutarMencoes();
    iniciarIdle();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
