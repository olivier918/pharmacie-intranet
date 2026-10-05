/* ═══════════════════════════════════════════════════════════════════════════
   QUALIFICATION À LA VACCINATION — la check-list, et la signature

   L'écran vit dans l'espace général parce que la qualification se fait AU
   COMPTOIR, devant la personne, pas dans un bureau après coup. On déroule les
   points avec elle, on fait dire ceux qui se disent, et on signe.

   CE N'EST PAS LA SESSION QUI SIGNE, C'EST LE CODE. Le poste est ouvert au nom
   de n'importe qui — souvent au nom de la personne qu'on qualifie. Le
   pharmacien tape son propre code ; le serveur vérifie l'empreinte, confirme
   qu'il s'agit bien d'un pharmacien, et n'y touche pas à la session du poste.

   LA GRILLE VIENT DU SERVEUR. Elle n'est pas recopiée ici : une check-list en
   double finit par diverger, et c'est la copie périmée qu'on remplit.

   Ce qui est signé remonte seul dans l'espace RH, en habilitation valable un
   an. Rien ici n'affiche d'appréciation : on voit des dates, pas des jugements.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  const ETAT_LBL = { oui: '✓', non: '✗', so: 's.o.' };
  const ETAT_TIT = { oui: 'Oui, vérifié', non: 'Non — une réserve sera demandée', so: 'Sans objet pour ce statut' };

  let vqEtat = null, vqGrille = null, vqUid = null, vqRep = {}, vqOuvert = false;

  function E(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  const pad = n => String(n).padStart(2, '0');
  function vqIso(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function vqFr(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
    return m ? m[3] + '/' + m[2] + '/' + m[1] : '—';
  }
  function vqStaff() {
    return (typeof staffDB !== 'undefined' && Array.isArray(staffDB)) ? staffDB : [];
  }
  function vqNom(uid) {
    const s = vqStaff().find(x => x && x.id === uid);
    if (!s) return uid || '—';
    return ((s.prenom || '') + ' ' + (s.nom || '')).trim() || s.id;
  }
  function vqMsg(t, err) {
    const z = document.getElementById('vq-msg'); if (!z) return;
    z.textContent = t; z.className = 'vq-msg' + (err ? ' ko' : ' ok');
    setTimeout(function () { if (z.textContent === t) { z.textContent = ''; z.className = 'vq-msg'; } }, 8000);
  }

  async function vqCharger() {
    const r = await fetch('/api/rh/vaccination/etat', { cache: 'no-store' });
    const j = await r.json();
    if (!j || !j.ok) throw new Error((j && j.error) || 'état indisponible');
    vqEtat = j; vqGrille = j.grille;
  }

  // ── QUI PEUT VACCINER AUJOURD'HUI ─────────────────────────────────────────
  // La question du lundi matin. Elle ne montre que des dates : savoir qui est
  // habilité est une affaire d'organisation, pas de management.
  function vqTableau() {
    const par = {};
    (vqEtat.etats || []).forEach(function (e) { par[e.uid] = e; });
    const gens = vqStaff().slice().sort(function (a, b) {
      return String(a.prenom || '').localeCompare(String(b.prenom || ''));
    });
    if (!gens.length) return '<div class="vq-vide">L’équipe n’est pas encore chargée.</div>';
    return '<div class="vq-tbl">' + gens.map(function (s) {
      const e = par[s.id];
      let cls = 'non', txt = 'non qualifié';
      if (e && e.valide) {
        cls = (e.jours != null && e.jours <= 60) ? 'bientot' : 'oui';
        txt = 'jusqu’au ' + vqFr(e.echeance) + (cls === 'bientot' ? ' · dans ' + e.jours + ' j' : '');
      } else if (e) {
        cls = 'perime'; txt = 'périmée le ' + vqFr(e.echeance);
      }
      return '<div class="vq-l vq-l-' + cls + '">'
        + '<span class="vq-l-n">' + E(((s.prenom || '') + ' ' + (s.nom || '')).trim() || s.id) + '</span>'
        + '<span class="vq-l-p">' + E(s.poste || '') + '</span>'
        + '<span class="vq-l-e">' + txt + '</span>'
        + '<button type="button" class="btn bs sm" onclick="vqQualifier(\'' + E(s.id) + '\')">'
        +   (e ? 'Refaire' : 'Qualifier') + '</button>'
        + '</div>';
    }).join('') + '</div>';
  }

  window.vqOuvrir = async function () {
    const z = document.getElementById('vq-host'); if (!z) return;
    vqOuvert = true;
    z.innerHTML = '<div class="vq-vide">Chargement…</div>';
    try { await vqCharger(); } catch (e) {
      z.innerHTML = '<div class="vq-vide">Indisponible : ' + E(e.message) + '</div>'; return;
    }
    vqRendre();
  };

  function vqRendre() {
    const z = document.getElementById('vq-host'); if (!z) return;
    z.innerHTML = '<div id="vq-msg" class="vq-msg"></div>'
      + '<div class="vq-h">Qui peut vacciner aujourd’hui</div>'
      + vqTableau()
      + '<div id="vq-grille"></div>';
    if (vqUid) vqRendreGrille();
  }

  // ── LA GRILLE ─────────────────────────────────────────────────────────────
  window.vqQualifier = function (uid) {
    vqUid = uid; vqRep = {};
    vqRendre();
    const g = document.getElementById('vq-grille');
    if (g) g.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  window.vqAbandonner = function () { vqUid = null; vqRep = {}; vqRendre(); };

  function vqRendreGrille() {
    const z = document.getElementById('vq-grille'); if (!z || !vqUid) return;
    let n = 0;
    const blocs = (vqGrille || []).map(function (b) {
      return '<div class="vq-bloc"><div class="vq-bloc-t">' + E(b.bloc) + '</div>'
        + b.points.map(function (p) {
            const i = n++;
            return '<div class="vq-p" id="vq-p-' + E(p.clef) + '">'
              + '<div class="vq-p-c">'
              +   '<div class="vq-p-t">' + E(p.titre) + '</div>'
              +   (p.aide ? '<div class="vq-p-a">' + E(p.aide) + '</div>' : '')
              +   (p.ref ? '<div class="vq-p-r">' + E(p.ref) + '</div>' : '')
              + '</div>'
              + '<div class="vq-p-e">' + ['oui', 'non', 'so'].map(function (k) {
                  return '<button type="button" class="vq-e vq-e-' + k
                    + (vqRep[p.clef] === k ? ' on' : '') + '" title="' + E(ETAT_TIT[k]) + '"'
                    + ' onclick="vqRepondre(' + i + ',\'' + k + '\')">' + ETAT_LBL[k] + '</button>';
                }).join('') + '</div>'
              + '</div>';
          }).join('')
        + '</div>';
    }).join('');

    const refuses = vqPoints().filter(function (c) { return vqRep[c] === 'non'; });
    const repondus = vqPoints().filter(function (c) { return vqRep[c]; }).length;
    const total = vqPoints().length;

    z.innerHTML = '<div class="vq-carte">'
      + '<div class="vq-carte-h"><b>Qualifier ' + E(vqNom(vqUid)) + '</b>'
      +   '<span class="vq-compte">' + repondus + ' / ' + total + '</span>'
      +   '<button type="button" class="btn bs sm" onclick="vqAbandonner()">Abandonner</button></div>'
      + '<div class="vq-intro">Déroulez les points avec la personne. Ceux qui se disent se vérifient '
      +   'en les faisant dire — pas en les faisant cocher.</div>'
      + blocs
      + (refuses.length
          ? '<div class="vq-reserve"><label for="vq-res">'
            + refuses.length + ' point(s) non satisfait(s) — écrivez la réserve et le délai</label>'
            + '<textarea id="vq-res" rows="3" placeholder="Ce qui manque, et sous quel délai ce sera réglé."'
            + ' oninput="vqMajSignature()"></textarea></div>'
          : '')
      + '<div class="vq-sign">'
      +   '<div class="vq-sign-t">Signature du pharmacien</div>'
      +   '<div class="vq-sign-a">Tapez <b>votre</b> code. Il ne change pas la session de ce poste — '
      +     'il dit seulement qui engage cette qualification.</div>'
      +   '<div class="vq-sign-l">'
      +     '<input type="password" id="vq-code" inputmode="numeric" autocomplete="off"'
      +       ' maxlength="8" placeholder="Code" oninput="vqMajSignature()">'
      +     '<input type="date" id="vq-le" value="' + vqIso(new Date()) + '">'
      +     '<button type="button" class="btn bp" id="vq-ok" onclick="vqSigner()">Signer la qualification</button>'
      +   '</div>'
      +   '<div class="vq-verdict" id="vq-verdict"></div>'
      + '</div></div>';
    vqMajSignature();
  }

  function vqPoints() {
    const l = [];
    (vqGrille || []).forEach(function (b) { b.points.forEach(function (p) { l.push(p.clef); }); });
    return l;
  }

  // Un gestionnaire ne reçoit qu'un indice et un état, jamais du texte saisi.
  window.vqRepondre = function (i, etat) {
    const c = vqPoints()[i]; if (!c) return;
    vqRep[c] = (vqRep[c] === etat) ? undefined : etat;
    vqRendreGrille();
    const el = document.getElementById('vq-p-' + c);
    if (el) el.scrollIntoView({ block: 'nearest' });
  };

  // LE VERDICT EST AFFICHÉ AVANT LE CLIC, pas après. Un bouton qu'on presse
  // pour apprendre ce qui manque fait perdre la saisie et la patience.
  window.vqMajSignature = function () {
    const z = document.getElementById('vq-verdict'), b = document.getElementById('vq-ok');
    if (!z || !b) return;
    const pts = vqPoints();
    const manquants = pts.filter(function (c) { return !vqRep[c]; });
    const refuses = pts.filter(function (c) { return vqRep[c] === 'non'; });
    const res = String((document.getElementById('vq-res') || {}).value || '').trim();
    const code = String((document.getElementById('vq-code') || {}).value || '').trim();
    let motif = '';
    if (manquants.length) motif = 'Il reste ' + manquants.length + ' point(s) sans réponse.';
    else if (refuses.length && res.length < 10) motif = 'Écrivez la réserve et le délai.';
    else if (!/^\d{4,8}$/.test(code)) motif = 'Le code du pharmacien est attendu.';
    b.disabled = !!motif;
    z.textContent = motif || (refuses.length
      ? 'Qualification avec réserve, valable un an.'
      : 'Tout est vérifié. Qualification valable un an.');
    z.className = 'vq-verdict' + (motif ? ' ko' : refuses.length ? ' reserve' : ' ok');
  };

  window.vqSigner = async function () {
    const code = String((document.getElementById('vq-code') || {}).value || '');
    const le = String((document.getElementById('vq-le') || {}).value || '');
    const res = String((document.getElementById('vq-res') || {}).value || '');
    try {
      const r = await fetch('/api/rh/qualifier', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: vqUid, code: code, le: le, reserves: res, reponses: vqRep })
      });
      const j = await r.json();
      if (!j || !j.ok) {
        const c = document.getElementById('vq-code'); if (c) { c.value = ''; c.focus(); }
        vqMsg((j && j.error) || 'qualification refusée', true);
        vqMajSignature();
        return;
      }
      const qui = j.prenom || j.par, nom = vqNom(vqUid);
      vqDernier = { nom: nom, par: qui, le: j.le, echeance: j.echeance,
                    avecReserve: j.avecReserve, reserves: res, reponses: Object.assign({}, vqRep) };
      vqUid = null; vqRep = {};
      await vqCharger(); vqRendre();
      vqMsg(nom + ' est qualifiée jusqu’au ' + vqFr(j.echeance) + ', par ' + qui
        + (j.avecReserve ? ', avec réserve' : '') + '.', false);
      vqImprimable();
    } catch (e) { vqMsg('Enregistrement impossible : ' + e.message, true); }
  };

  // ── LA TRACE PAPIER ───────────────────────────────────────────────────────
  // Proposée, jamais imposée : certains classeurs vivent encore sur une
  // étagère, et une qualification qu'on ne peut pas montrer ne rassure
  // personne un jour de contrôle.
  let vqDernier = null;
  function vqImprimable() {
    const z = document.getElementById('vq-grille'); if (!z || !vqDernier) return;
    const d = vqDernier;
    z.innerHTML = '<div class="vq-fait">'
      + '<div class="vq-fait-t">✓ ' + E(d.nom) + ' est qualifiée jusqu’au ' + vqFr(d.echeance) + '</div>'
      + '<div class="vq-fait-s">Signée le ' + vqFr(d.le) + ' par ' + E(d.par)
      +   (d.avecReserve ? ' · <b>avec réserve</b>' : '')
      +   '. C’est enregistré dans son suivi RH.</div>'
      + '<button type="button" class="btn bs sm" onclick="vqImprimer()">Imprimer la fiche</button>'
      + '</div>';
  }

  window.vqImprimer = function () {
    const d = vqDernier; if (!d) return;
    const lignes = (vqGrille || []).map(function (b) {
      return '<h4>' + E(b.bloc) + '</h4><table>' + b.points.map(function (p) {
        const e = d.reponses[p.clef];
        return '<tr><td class="e">' + (e === 'oui' ? '✓' : e === 'non' ? '✗' : 's.o.')
          + '</td><td>' + E(p.titre) + '</td></tr>';
      }).join('') + '</table>';
    }).join('');
    const w = window.open('', '_blank');
    if (!w) { vqMsg('Le navigateur a bloqué la fenêtre d’impression.', true); return; }
    w.document.write('<!DOCTYPE html><html lang="fr"><head><meta charset="utf-8">'
      + '<title>Qualification vaccination — ' + E(d.nom) + '</title><style>'
      + 'body{font:11pt/1.45 Georgia,serif;margin:20mm 16mm;color:#111}'
      + 'h1{font-size:15pt;margin:0 0 2px}.s{color:#555;font-size:10pt;margin-bottom:16px}'
      + 'h4{font-size:10pt;text-transform:uppercase;letter-spacing:.05em;margin:16px 0 5px}'
      + 'table{width:100%;border-collapse:collapse}td{padding:3px 0;vertical-align:top}'
      + 'td.e{width:34px;font-weight:bold}'
      + '.r{margin-top:16px;padding:9px 12px;border:1px solid #999;border-radius:4px}'
      + '.sg{margin-top:26px;font-size:10pt}'
      + '</style></head><body>'
      + '<h1>Qualification à l’administration des vaccins</h1>'
      + '<div class="s">' + E(d.nom) + ' · signée le ' + vqFr(d.le)
      +   ' · valable jusqu’au ' + vqFr(d.echeance) + '</div>'
      + lignes
      + (d.avecReserve ? '<div class="r"><b>Réserve :</b> ' + E(d.reserves) + '</div>' : '')
      + '<div class="sg">Pharmacien signataire : ' + E(d.par) + '</div>'
      + '<script>setTimeout(function(){window.print();},200);<\/script></body></html>');
    w.document.close();
  };

  // ── Style ─────────────────────────────────────────────────────────────────
  const VQ_CSS = `
  #vq-host{margin-top:14px}
  .vq-msg{font-size:.85rem;min-height:0;margin-bottom:8px}
  .vq-msg.ok{color:var(--g-dark,#1D5C3A);font-weight:600}
  .vq-msg.ko{color:#C62828;font-weight:600}
  .vq-h{font-size:.74rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
    color:var(--gray-500,#6b7280);margin:14px 0 8px}
  .vq-tbl{display:flex;flex-direction:column;gap:5px}
  .vq-l{display:flex;align-items:center;gap:10px;flex-wrap:wrap;background:#fff;
    border:1px solid var(--gray-200,#e5e7eb);border-left-width:4px;border-radius:9px;padding:9px 13px}
  .vq-l-oui{border-left-color:#2E7D54}
  .vq-l-bientot{border-left-color:#E65100}
  .vq-l-perime{border-left-color:#C62828}
  .vq-l-non{border-left-color:#d8e2dc}
  .vq-l-n{font-weight:700;font-size:.9rem;flex:1 1 150px;min-width:0}
  .vq-l-p{font-size:.76rem;color:var(--gray-500,#6b7280);flex:0 1 150px}
  .vq-l-e{font-size:.8rem;flex:0 1 215px}
  .vq-l-oui .vq-l-e{color:#2E7D54;font-weight:600}
  .vq-l-bientot .vq-l-e{color:#E65100;font-weight:700}
  .vq-l-perime .vq-l-e{color:#C62828;font-weight:700}
  .vq-l-non .vq-l-e{color:var(--gray-500,#6b7280)}
  .vq-carte{background:#fff;border:1px solid var(--gray-200,#e5e7eb);border-radius:13px;
    padding:16px 18px;margin-top:16px}
  .vq-carte-h{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:6px}
  .vq-carte-h b{font-size:1rem;flex:1;min-width:0}
  .vq-compte{font-size:.78rem;color:var(--gray-500,#6b7280);background:var(--gray-100,#f3f4f6);
    border-radius:999px;padding:2px 10px}
  .vq-intro{font-size:.82rem;color:var(--gray-500,#6b7280);line-height:1.55;margin-bottom:12px}
  .vq-bloc{margin-top:14px}
  .vq-bloc-t{font-size:.72rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
    color:var(--g-dark,#1D5C3A);margin-bottom:7px}
  .vq-p{display:flex;align-items:flex-start;gap:12px;padding:9px 0;
    border-top:1px solid var(--gray-100,#f3f4f6)}
  .vq-p-c{flex:1;min-width:0}
  .vq-p-t{font-size:.89rem;font-weight:600;line-height:1.4}
  .vq-p-a{font-size:.78rem;color:var(--gray-500,#6b7280);line-height:1.5;margin-top:3px}
  .vq-p-r{font-size:.71rem;color:#9aa5a0;margin-top:3px;font-style:italic}
  .vq-p-e{display:flex;gap:4px;flex:none}
  .vq-e{width:38px;height:32px;border:1px solid #d8e2dc;background:#fff;border-radius:8px;
    cursor:pointer;font:inherit;font-size:.82rem;font-weight:700;color:#9bb0a4;line-height:1}
  .vq-e:hover{border-color:#9ccbb2}
  .vq-e-oui.on{background:#2E7D54;border-color:#2E7D54;color:#fff}
  .vq-e-non.on{background:#C62828;border-color:#C62828;color:#fff}
  .vq-e-so.on{background:var(--gray-100,#f3f4f6);border-color:#b9c4bf;color:#5b6b64}
  .vq-e:focus-visible{outline:2px solid var(--g-mid,#2E7D54);outline-offset:1px}
  .vq-reserve{margin-top:14px;background:#FFF3E0;border:1px solid #E6B07A;border-radius:10px;
    padding:11px 13px}
  .vq-reserve label{display:block;font-size:.78rem;font-weight:700;color:#7c3a00;margin-bottom:6px}
  .vq-reserve textarea{width:100%;font:inherit;font-size:.88rem;border:1px solid #E6B07A;
    border-radius:8px;padding:8px 10px;box-sizing:border-box;resize:vertical}
  .vq-sign{margin-top:16px;border-top:2px solid var(--gray-100,#f3f4f6);padding-top:14px}
  .vq-sign-t{font-size:.74rem;font-weight:700;text-transform:uppercase;letter-spacing:.06em;
    color:var(--gray-500,#6b7280)}
  .vq-sign-a{font-size:.78rem;color:var(--gray-500,#6b7280);line-height:1.5;margin:5px 0 10px}
  .vq-sign-l{display:flex;gap:8px;flex-wrap:wrap;align-items:center}
  .vq-sign-l input{font:inherit;font-size:.9rem;border:1px solid var(--gray-200,#e5e7eb);
    border-radius:9px;padding:9px 11px}
  #vq-code{width:120px;letter-spacing:.35em;text-align:center}
  .vq-sign-l input:focus{outline:none;border-color:var(--g-mid,#2E7D54)}
  .vq-sign-l .btn[disabled]{opacity:.45;cursor:not-allowed}
  .vq-verdict{font-size:.8rem;margin-top:8px;line-height:1.5}
  .vq-verdict.ok{color:#2E7D54;font-weight:600}
  .vq-verdict.reserve{color:#7c3a00;font-weight:600}
  .vq-verdict.ko{color:var(--gray-500,#6b7280)}
  .vq-fait{margin-top:16px;background:#E8F5E9;border:1px solid #A5D6A7;border-radius:12px;
    padding:14px 16px}
  .vq-fait-t{font-weight:700;color:#1D5C3A;font-size:.95rem}
  .vq-fait-s{font-size:.82rem;color:#2E7D54;margin:4px 0 10px;line-height:1.5}
  .vq-vide{padding:16px 2px;color:var(--gray-500,#6b7280);font-size:.86rem;line-height:1.6}
  @media print{#vq-host{display:none}}
  `;

  function vqInjecter() {
    if (document.getElementById('vq-css')) return;
    const st = document.createElement('style');
    st.id = 'vq-css'; st.textContent = VQ_CSS;
    document.head.appendChild(st);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', vqInjecter);
  else vqInjecter();
}());
