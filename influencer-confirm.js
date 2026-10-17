/**
 * Desafio MOZ – Convite influencer só conta com ≥ 30 pontos
 * 1) Convidado marca no PRÓPRIO documento (sempre funciona)
 * 2) Tenta creditar o influencer (se regras permitirem)
 * 3) Página influencer sincroniza a contagem a partir dos confirmados
 * Incluir: <script src="influencer-confirm.js?v=3"></script>
 */
(function (global) {
  var MIN = 30;

  function perdaSegura() {}

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
   * Confirma no documento do CONVIDADO (próprio). Só com ≥ 30 pontos.
   * Depois tenta +1 no influencer; se falhar, a página influencer sincroniza.
   */
  function confirmar(db, usuario, docRef) {
    if (!db || !usuario) return Promise.resolve(false);
    var email = String(usuario.email || '').trim().toLowerCase();
    var pts = Number(usuario.pontos || 0);
    var codigo = String(usuario.indicadoPorInfluencer || '').trim().toUpperCase();
    if (!email || !codigo) return Promise.resolve(false);
    if (usuario.influencerConviteConfirmado === true) return Promise.resolve(false);
    if (pts < MIN) return Promise.resolve(false);

    var patch = {
      influencerConviteConfirmado: true,
      influencerConviteConfirmadoEm: new Date().toISOString(),
      influencerConviteConfirmadoPts: pts,
      influencerConviteCodigo: codigo
    };

    function marcarProprio() {
      if (docRef) return docRef.update(patch).then(function () { return true; });
      return db.collection('usuarios').where('email', '==', email).limit(1).get().then(function (q) {
        if (q.empty) return false;
        return q.docs[0].ref.update(patch).then(function () { return true; });
      });
    }

    return marcarProprio().then(function (ok) {
      if (!ok) return false;
      // Tenta creditar o influencer (pode falhar por regras — OK)
      return aplicarCredito(db, codigo, email).then(function () { return true; }).catch(function () { return true; });
    }).catch(function (e) {
      console.warn('DM_confirmarInfluencer', e);
      return false;
    });
  }

  /** Após actualizar pontos */
  function aposPontos(db, email, novosPontos, docRef, extraData) {
    email = String(email || '').trim().toLowerCase();
    if (!db || !email) return Promise.resolve(false);
    var base = Object.assign({}, extraData || {}, { email: email, pontos: novosPontos });
    if (base.indicadoPorInfluencer) {
      return confirmar(db, base, docRef || null);
    }
    var p = docRef
      ? docRef.get().then(function (s) { return s.exists ? s : null; })
      : db.collection('usuarios').where('email', '==', email).limit(1).get().then(function (s) {
          return s.empty ? null : s.docs[0];
        });
    return Promise.resolve(p).then(function (docOrSnap) {
      if (!docOrSnap) return false;
      var ref = docRef || (docOrSnap.ref ? docOrSnap.ref : null);
      var data = docOrSnap.data ? docOrSnap.data() : null;
      if (!data) return false;
      data.pontos = novosPontos;
      data.email = email;
      return confirmar(db, data, ref);
    }).catch(function (e) {
      console.warn('DM_aposPontosInfluencer', e);
      return false;
    });
  }

  /**
   * O influencer chama isto no load: conta convidados com ≥30 pts confirmados
   * e actualiza o PRÓPRIO documento (sem problemas de permissão).
   */
  function sincronizarContagem(db, influencerDoc, docRef) {
    if (!db || !influencerDoc || !docRef) return Promise.resolve(influencerDoc);
    var codigo = String(influencerDoc.codigoInfluencer || '').trim().toUpperCase();
    if (!codigo) return Promise.resolve(influencerDoc);

    return db.collection('usuarios').where('indicadoPorInfluencer', '==', codigo).limit(2000).get()
      .then(function (snap) {
        var reais = 0;
        snap.forEach(function (doc) {
          var u = doc.data() || {};
          var pts = Number(u.pontos || 0);
          var conf = u.influencerConviteConfirmado === true || u.influencerConviteConfirmado === 'true';
          // Conta se confirmado OU se já tem ≥ 30 (e marca se preciso)
          if (conf || pts >= MIN) {
            reais++;
            if (!conf && pts >= MIN) {
              try {
                doc.ref.update({
                  influencerConviteConfirmado: true,
                  influencerConviteConfirmadoEm: new Date().toISOString(),
                  influencerConviteConfirmadoPts: pts,
                  influencerConviteCodigo: codigo
                }).catch(function () {});
              } catch (e) {}
            }
          }
        });

        var ratio = parseInt(influencerDoc.influencerRatioApos900, 10);
        if (!ratio || ratio < 1) ratio = 5;
        var normal = influencerDoc.influencerContagemNormal === true;
        var contados;
        if (normal) {
          contados = reais;
        } else if (reais <= 900) {
          contados = reais;
        } else {
          contados = 900 + Math.floor((reais - 900) / ratio);
        }

        var atualReais = Number(influencerDoc.influencerConvidadosReais != null
          ? influencerDoc.influencerConvidadosReais
          : (influencerDoc.influencerConvidados || 0));
        var atualContados = Number(influencerDoc.influencerConvidados || 0);

        // Só sobe (nunca desce contagens por sync)
        if (reais <= atualReais && contados <= atualContados) {
          return influencerDoc;
        }

        var novosReais = Math.max(atualReais, reais);
        var novosContados = Math.max(atualContados, contados);
        var upd = {
          influencerConvidadosReais: novosReais,
          influencerConvidados: novosContados,
          ultimaAtualizacao: new Date().toISOString()
        };
        return docRef.update(upd).then(function () {
          influencerDoc.influencerConvidadosReais = novosReais;
          influencerDoc.influencerConvidados = novosContados;
          return influencerDoc;
        });
      })
      .catch(function (e) {
        console.warn('DM_sincronizarContagemInfluencer', e);
        return influencerDoc;
      });
  }

  global.DM_confirmarInfluencer = confirmar;
  global.DM_aposPontosInfluencer = aposPontos;
  global.DM_sincronizarContagemInfluencer = sincronizarContagem;
  global.DM_MIN_PTS_CONVITE_INFLUENCER = MIN;
})(typeof window !== 'undefined' ? window : this);
