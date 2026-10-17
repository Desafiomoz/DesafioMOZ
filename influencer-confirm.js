/**
 * Desafio MOZ – Convite influencer só conta com ≥ 30 pontos
 * Incluir em páginas que actualizam pontos: <script src="influencer-confirm.js?v=2"></script>
 */
(function (global) {
  var MIN = 30;

  function aplicarCredito(db, infCodigo, emailConvidado) {
    infCodigo = String(infCodigo || '').trim().toUpperCase();
    emailConvidado = String(emailConvidado || '').trim().toLowerCase();
    if (!infCodigo || !emailConvidado || !db) return Promise.resolve(false);
    return db.collection('usuarios').where('codigoInfluencer', '==', infCodigo).limit(1).get().then(function (snap) {
      if (snap.empty) return false;
      var ref = snap.docs[0].ref;
      var d = snap.docs[0].data() || {};
      if ((d.email || '').toLowerCase() === emailConvidado) return false;
      if (d.influencerLinkBloqueado === true) return false;

      var reaisAntes = Number(d.influencerConvidadosReais != null ? d.influencerConvidadosReais : (d.influencerConvidados || 0));
      var contadosAntes = Number(d.influencerConvidados || 0);
      var reais = reaisAntes + 1;
      var ratio = parseInt(d.influencerRatioApos900, 10);
      if (!ratio || ratio < 1) ratio = 5;
      var normal = d.influencerContagemNormal === true;
      var contados = contadosAntes;
      if (normal) contados = contadosAntes + 1;
      else if (reaisAntes < 900) contados = contadosAntes + 1;
      else {
        var beyond = reais - 900;
        if (beyond > 0 && beyond % ratio === 0) contados = contadosAntes + 1;
      }

      var premios = Number(d.influencerPremios || 0);
      var pontos = Number(d.pontos || 0);
      var upd = {
        influencerConvidadosReais: reais,
        influencerConvidados: contados,
        ultimaAtualizacao: new Date().toISOString()
      };
      if (d.influencerBoostPts === true) {
        upd.pontos = pontos + 1;
        pontos = pontos + 1;
      }
      var ciclosAntes = Math.floor(contadosAntes / 1000);
      var ciclosAgora = Math.floor(contados / 1000);
      var novosPremios = ciclosAgora - ciclosAntes;
      if (novosPremios > 0) {
        var ptsPremio = novosPremios * 1600;
        upd.influencerPremios = premios + novosPremios;
        upd.pontos = pontos + ptsPremio;
        upd.influencerLinkBloqueado = true;
        upd.influencerLinkBloqueadoEm = new Date().toISOString();
        upd.influencerLinkBloqueadoMotivo = 'Atingiu meta de ' + contados + ' convites — aguarda liberação do admin';
        upd.ultimoPremioInfluencer = {
          em: new Date().toISOString(),
          ciclos: novosPremios,
          pontos: ptsPremio,
          contagem: contados,
          mt: novosPremios * 200
        };
      }
      return ref.update(upd).then(function () {
        if (novosPremios > 0 && typeof DM_histPontos === 'function') {
          return DM_histPontos(db, d.email || '', novosPremios * 1600, 'influencer',
            'Prémio influencer: ' + (novosPremios * 200) + ' MT por atingir ' + contados + ' convites').catch(function () {});
        }
        return true;
      }).then(function () { return true; });
    }).catch(function (e) {
      console.warn('DM_aplicarCreditoInfluencer', e);
      return false;
    });
  }

  /**
   * @param {Firestore} db
   * @param {object} usuario - data do user (email, pontos, indicadoPorInfluencer, influencerConviteConfirmado)
   * @param {DocumentReference|null} docRef
   */
  function confirmar(db, usuario, docRef) {
    if (!db || !usuario) return Promise.resolve(false);
    var email = String(usuario.email || '').trim().toLowerCase();
    var pts = Number(usuario.pontos || 0);
    var codigo = String(usuario.indicadoPorInfluencer || '').trim().toUpperCase();
    if (!email || !codigo) return Promise.resolve(false);
    if (usuario.influencerConviteConfirmado === true) return Promise.resolve(false);
    if (pts < MIN) return Promise.resolve(false);

    return aplicarCredito(db, codigo, email).then(function (ok) {
      if (!ok) return false;
      var patch = {
        influencerConviteConfirmado: true,
        influencerConviteConfirmadoEm: new Date().toISOString(),
        influencerConviteConfirmadoPts: pts
      };
      if (docRef) return docRef.update(patch).then(function () { return true; });
      return db.collection('usuarios').where('email', '==', email).limit(1).get().then(function (q) {
        if (q.empty) return false;
        return q.docs[0].ref.update(patch).then(function () { return true; });
      });
    }).catch(function (e) {
      console.warn('DM_confirmarInfluencer', e);
      return false;
    });
  }

  /** Após actualizar pontos: passa email + novos pontos + ref opcional */
  function aposPontos(db, email, novosPontos, docRef, extraData) {
    email = String(email || '').trim().toLowerCase();
    if (!db || !email) return Promise.resolve(false);
    var base = Object.assign({}, extraData || {}, { email: email, pontos: novosPontos });
    if (base.indicadoPorInfluencer && base.influencerConviteConfirmado != null) {
      return confirmar(db, base, docRef || null);
    }
    // precisa ler o user
    var p = docRef ? docRef.get() : db.collection('usuarios').where('email', '==', email).limit(1).get().then(function (s) {
      return s.empty ? null : s.docs[0];
    });
    return Promise.resolve(p).then(function (docOrSnap) {
      if (!docOrSnap) return false;
      var ref = docRef || (docOrSnap.ref ? docOrSnap.ref : null);
      var data = docOrSnap.data ? docOrSnap.data() : (docOrSnap.exists && docOrSnap.data());
      if (!data) return false;
      data.pontos = novosPontos;
      data.email = email;
      return confirmar(db, data, ref);
    }).catch(function (e) {
      console.warn('DM_aposPontosInfluencer', e);
      return false;
    });
  }

  global.DM_confirmarInfluencer = confirmar;
  global.DM_aposPontosInfluencer = aposPontos;
  global.DM_MIN_PTS_CONVITE_INFLUENCER = MIN;
})(typeof window !== 'undefined' ? window : this);
