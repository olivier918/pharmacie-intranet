/* ════════════════════════════════════════════════════════════════════════════
   Module OFFRES — l'affiche, son adresse, et le SMS qui la porte.

   Une opération commerciale, côté officine, c'est trois gestes : déposer
   l'affiche, choisir le jour, envoyer le lien. Cet écran ne fait que ça.

   CE QU'IL NE FAIT PAS, ET POURQUOI. Il n'envoie pas le SMS lui-même. Une
   campagne commerciale vers des patients n'est pas un rappel de vaccination :
   elle suppose un consentement préalable, et la liste des destinataires n'est
   pas la même. L'écran prépare donc le texte, compte les segments, et s'arrête
   là — l'envoi passe par le module SMS, en conscience.

   Préfixe `of` / `of-` : rien ici ne touche à l'existant.
   ════════════════════════════════════════════════════════════════════════════ */
(function () {
  'use strict';

  // L'ADRESSE DE DIFFUSION. C'est elle qui part dans les SMS, et elle vient du
  // SERVEUR (variable OFFRE_BASE_URL), pas d'ici : changer de domaine ne doit
  // pas demander de reécrire une ligne et de pousser une version. Tant qu'elle
  // n'est pas réglée, on diffuse sous l'adresse courante — le lien est valide,
  // il porte seulement le nom du back-office. Le bouton bascule de l'une à
  // l'autre, pour vérifier avant que le DNS ne soit posé.
  let OF_DIFFUSION = '';
  const OF_CLE_HOTE = 'pilot_offre_hote';
  const OF_MAX_PX = 1400;      // côté long de l'affiche servie aux téléphones

  const E = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
  const pad = n => String(n).padStart(2, '0');
  const ofJour = () => { const d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const ofFr = iso => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || '')); return m ? m[3] + '/' + m[2] : ''; };

  let ofListe = [], ofRedacteur = false, ofJourServeur = '', ofEdite = null, ofImage = null;
  let ofCodeTouche = false;

  function ofBase() {
    if (!OF_DIFFUSION) return location.origin;
    try { if (localStorage.getItem(OF_CLE_HOTE) === 'local') return location.origin; } catch (e) {}
    return OF_DIFFUSION;
  }
  function ofLien(o) {
    return ofBase() + '/offre' + (o && !o.veille ? '/' + o.code : '');
  }
  // Ce qu'on voit dans le SMS : sans le protocole, le lien tient mieux dans la
  // tête. Les téléphones le rendent cliquable de la même façon.
  function ofLienCourt(o) { return ofLien(o).replace(/^https?:\/\//, ''); }

  function ofEtat(o) {
    if (!o) return { cls: '', mot: '' };
    if (o.veille) return { cls: 'of-e-veille', mot: 'Image de veille' };
    const j = ofJourServeur || ofJour();
    if (o.debut && j < o.debut) return { cls: 'of-e-avenir', mot: 'À partir du ' + ofFr(o.debut) };
    if (o.fin && j > o.fin) return { cls: 'of-e-fini', mot: 'Terminée le ' + ofFr(o.fin) };
    return { cls: 'of-e-vive', mot: 'En ligne' };
  }
  function ofPeriode(o) {
    if (!o || o.veille) return 'en permanence, quand rien n’est en cours';
    if (o.debut && o.fin) return o.debut === o.fin ? 'le ' + ofFr(o.fin) : 'du ' + ofFr(o.debut) + ' au ' + ofFr(o.fin);
    if (o.fin) return 'jusqu’au ' + ofFr(o.fin);
    if (o.debut) return 'à partir du ' + ofFr(o.debut);
    return 'sans date de fin';
  }
  // Celle que l'adresse générale sert aujourd'hui — la même règle que le
  // serveur : la plus proche de sa fin d'abord.
  function ofCourante() {
    const j = ofJourServeur || ofJour();
    const vives = ofListe.filter(o => !o.veille
      && (!o.debut || j >= o.debut) && (!o.fin || j <= o.fin))
      .sort((a, b) => ((a.fin || '9999') < (b.fin || '9999') ? -1 : 1));
    return vives[0] || ofListe.find(o => o.veille) || null;
  }

  function ofVignette(o) {
    return ofBase() + '/offre/i/' + encodeURIComponent(o.code)
      + '?v=' + encodeURIComponent(String(o.empreinte || '').slice(0, 12));
  }

  // ── Le texte du SMS ───────────────────────────────────────────────────────
  // SANS ACCENT HORS GSM-7 et sans fioriture : un « ê » ou un tiret cadratin
  // fait basculer le message en Unicode, et la limite tombe de 160 à 70
  // caractères. Sur six cents envois, c'est six cents crédits de plus.
  function ofTexteSms(o) {
    if (!o) return '';
    const t = String(o.titre || '').trim();
    return 'Pharmacie du Centre : ' + t + '. Details et conditions : ' + ofLienCourt(o);
  }
  function ofCompte(t) {
    if (typeof smsSegments === 'function') return smsSegments(t);
    return { len: String(t || '').length, uni: false, parts: 1 };
  }

  // ── Rendu ─────────────────────────────────────────────────────────────────
  function ofCarteCourante() {
    const o = ofCourante();
    if (!o) {
      return '<div class="of-vide"><b>Aucune affiche pour le moment.</b>'
        + '<div>Le lien reste valable : il montrera l’image de veille tant '
        + 'qu’aucune opération n’est en cours.</div></div>';
    }
    const sms = ofTexteSms(o), c = ofCompte(sms), e = ofEtat(o);
    return '<div class="of-vedette">'
      + '<img class="of-aff" src="' + E(ofVignette(o)) + '" alt="">'
      + '<div class="of-v-d">'
      +   '<span class="of-badge ' + e.cls + '">' + E(e.mot) + '</span>'
      +   '<div class="of-v-t">' + E(o.titre) + '</div>'
      +   '<div class="of-v-p">' + E(ofPeriode(o)) + ' · <b>' + (o.vues || 0) + '</b> ouverture'
      +     ((o.vues || 0) > 1 ? 's' : '') + '</div>'
      +   '<div class="of-lien"><code>' + E(ofLien(o)) + '</code>'
      +     '<button class="btn bs sm" onclick="ofCopier(\'' + E(o.code) + '\',\'lien\')">Copier le lien</button></div>'
      +   '<div class="of-lbl">Texte prêt pour le SMS</div>'
      +   '<textarea class="of-sms" id="of-sms" oninput="ofRecompter()">' + E(sms) + '</textarea>'
      +   '<div class="of-pied"><span id="of-compte">' + c.len + ' caractères · '
      +     c.parts + ' SMS' + (c.uni ? ' (Unicode)' : '') + '</span>'
      +     '<button class="btn bp sm" onclick="ofCopier(\'' + E(o.code) + '\',\'sms\')">Copier le texte</button></div>'
      +   '<div class="of-note">Le lien ouvre l’affiche en plein écran sur le téléphone. '
      +     'L’envoi se fait depuis <b>SMS patients</b>, vers les personnes qui ont accepté '
      +     'd’être informées des offres.</div>'
      + '</div></div>';
  }

  function ofLigne(o) {
    const e = ofEtat(o);
    return '<div class="of-l">'
      + '<img class="of-l-i" src="' + E(ofVignette(o)) + '" alt="">'
      + '<div class="of-l-d"><div class="of-l-t">' + E(o.titre) + '</div>'
      +   '<div class="of-l-p">' + E(ofPeriode(o)) + ' · ' + E(ofLienCourt(o)) + '</div></div>'
      + '<span class="of-badge ' + e.cls + '">' + E(e.mot) + '</span>'
      + '<div class="of-l-n">' + (o.vues || 0) + '</div>'
      + (ofRedacteur
          ? '<button class="btn bs sm" onclick="ofOuvrirForm(\'' + E(o.code) + '\')">Modifier</button>'
            + '<button class="btn bs sm of-sup" onclick="ofSupprimer(\'' + E(o.code) + '\')">Supprimer</button>'
          : '')
      + '</div>';
  }

  function ofForm() {
    if (!ofRedacteur) return '';
    const o = ofEdite ? (ofListe.find(x => x.code === ofEdite) || {}) : {};
    const neuf = !ofEdite;
    return '<div class="card" id="of-form-card" style="display:none">'
      + '<div class="ch"><span class="ct">' + (neuf ? 'Nouvelle affiche' : 'Modifier l’affiche') + '</span>'
      +   '<button class="btn bs sm" onclick="ofFermerForm()">Annuler</button></div>'
      + '<div class="cb of-f">'
      +   '<label class="of-depot" id="of-depot">'
      +     '<input type="file" id="of-f" accept="image/jpeg,image/png,image/webp" onchange="ofChoisir(this)">'
      +     '<span id="of-depot-txt">'
      +       (neuf ? 'Déposer l’affiche (JPEG, PNG ou WebP)' : 'Remplacer l’affiche — facultatif')
      +     '</span>'
      +   '</label>'
      +   '<img id="of-apercu" class="of-apercu" style="display:none" alt="">'
      +   '<div class="fg"><label>Titre de l’offre</label>'
      +     '<input class="inp" id="of-titre" maxlength="120" value="' + E(o.titre || '') + '" '
      +       'oninput="ofTitreChange()" placeholder="Journee Avene -20%"></div>'
      +   '<div class="fg"><label>Adresse du lien</label>'
      +     '<div class="of-code"><span>' + E(ofBase().replace(/^https?:\/\//, '')) + '/offre/</span>'
      +     '<input class="inp" id="of-code" maxlength="32" value="' + E(o.code || '') + '" '
      +       (neuf ? '' : 'readonly ') + 'placeholder="avene"></div>'
      +     '<div class="of-aide">' + (neuf
             ? 'Lettres, chiffres et tirets. C’est ce que lira le patient dans son SMS.'
             : 'L’adresse ne change plus : des SMS la portent peut-être déjà.') + '</div></div>'
      +   '<div class="of-2"><div class="fg"><label>Premier jour</label>'
      +     '<input class="inp" type="date" id="of-debut" value="' + E(o.debut || '') + '"></div>'
      +     '<div class="fg"><label>Dernier jour (inclus)</label>'
      +     '<input class="inp" type="date" id="of-fin" value="' + E(o.fin || '') + '"></div></div>'
      +   '<div class="fg"><label>Mentions sous l’affiche</label>'
      +     '<textarea class="inp" id="of-mentions" rows="2" maxlength="600" '
      +       'placeholder="Offre valable le vendredi 16 octobre 2026, dans la limite des stocks disponibles. Hors medicaments.">'
      +       + E(o.mentions || '') + '</textarea>'
      +     '<div class="of-aide">C’est ici que se lit l’astérisque de l’affiche.</div></div>'
      +   '<label class="of-chk"><input type="checkbox" id="of-veille"' + (o.veille ? ' checked' : '') + '>'
      +     '<span>C’est l’image de <b>veille</b> — celle qu’on montre quand aucune offre n’est en cours. '
      +     'Elle n’a pas de date, et il ne peut y en avoir qu’une.</span></label>'
      +   '<div class="of-act"><button class="btn bp" onclick="ofEnregistrer()">Enregistrer</button>'
      +     '<span class="of-msg" id="of-msg"></span></div>'
      + '</div></div>';
  }

  window.ofRender = function () {
    const h = document.getElementById('of-host');
    if (!h) return;
    h.innerHTML =
      '<div class="card"><div class="ch"><span class="ct">'
      + '<svg class="ico"><use href="#ic-messagerie"></use></svg> L’offre en ligne</span>'
      + (ofRedacteur ? '<button class="btn bp sm" onclick="ofOuvrirForm(null)">Nouvelle affiche</button>' : '')
      + '</div><div class="cb">' + ofCarteCourante() + '</div></div>'
      + ofForm()
      + (ofListe.length
          ? '<div class="card"><div class="ch"><span class="ct">Toutes les affiches</span>'
            + '<span class="of-th">ouvertures</span></div>'
            + '<div class="cb of-liste">' + ofListe.map(ofLigne).join('') + '</div></div>'
          : '')
      + '<div class="of-hote">Adresse de diffusion : <b>' + E(ofBase().replace(/^https?:\/\//, '')) + '</b>'
      +   (OF_DIFFUSION
            ? ' <button class="btn bs sm" onclick="ofBasculerHote()">'
              + (ofBase() === OF_DIFFUSION ? 'Utiliser l’adresse de secours' : 'Revenir au domaine principal')
              + '</button>'
            : ' — aucun domaine public réglé (variable <code>OFFRE_BASE_URL</code>)')
      +   '</div>';
  };

  window.ofRecompter = function () {
    const t = document.getElementById('of-sms'), c = document.getElementById('of-compte');
    if (!t || !c) return;
    const n = ofCompte(t.value);
    c.textContent = n.len + ' caractères · ' + n.parts + ' SMS' + (n.uni ? ' (Unicode — 70 par segment)' : '');
    c.className = (n.uni || n.parts > 1) ? 'of-cher' : '';
  };

  window.ofBasculerHote = function () {
    try {
      const local = localStorage.getItem(OF_CLE_HOTE) === 'local';
      localStorage.setItem(OF_CLE_HOTE, local ? 'public' : 'local');
    } catch (e) {}
    window.ofRender();
  };

  function ofFlash(t) {
    const m = document.getElementById('of-compte');
    if (!m) return;
    const avant = m.textContent;
    m.textContent = t;
    setTimeout(function () { m.textContent = avant; }, 1800);
  }

  window.ofCopier = async function (code, quoi) {
    const o = ofListe.find(x => x.code === code); if (!o) return;
    const zone = document.getElementById('of-sms');
    const txt = (quoi === 'sms') ? (zone ? zone.value : ofTexteSms(o)) : ofLien(o);
    try { await navigator.clipboard.writeText(txt); ofFlash('Copié.'); }
    catch (e) {
      // Pas de presse-papier (navigateur ancien, page non sécurisée) : on
      // sélectionne, et la personne fait Ctrl+C. Jamais d'échec muet.
      if (zone && quoi === 'sms') { zone.focus(); zone.select(); ofFlash('Appuyez sur Ctrl+C.'); }
      else ofFlash('Copie impossible — le lien est affiché ci-dessus.');
    }
  };

  // ── Le formulaire ─────────────────────────────────────────────────────────
  window.ofOuvrirForm = function (code) {
    ofEdite = code || null; ofImage = null; ofCodeTouche = !!code;
    window.ofRender();
    const c = document.getElementById('of-form-card');
    if (c) { c.style.display = ''; c.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
  };
  window.ofFermerForm = function () { ofEdite = null; ofImage = null; window.ofRender(); };

  // Le code se devine du titre tant que personne ne l'a touché : « Journée
  // Avène -20% » donne « journee-avene-20 ». Dès qu'on écrit dedans, on ne
  // l'écrase plus.
  window.ofTitreChange = function () {
    const ti = document.getElementById('of-titre'), co = document.getElementById('of-code');
    if (!ti || !co || co.readOnly || ofCodeTouche) return;
    co.value = ofSlug(ti.value);
  };
  function ofSlug(v) {
    return String(v || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
      .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
      .slice(0, 32).replace(/-+$/g, '');
  }

  // L'affiche est RÉDUITE AVANT L'ENVOI. Un export d'agence pèse volontiers
  // quatre mégaoctets ; ouvert en 4G devant la pharmacie, c'est une page qui
  // n'arrive pas. 1400 pixels de côté long suffisent à tout téléphone.
  function ofReduire(fichier) {
    return new Promise(function (ok, non) {
      const url = URL.createObjectURL(fichier);
      const img = new Image();
      img.onload = function () {
        URL.revokeObjectURL(url);
        const r = Math.min(1, OF_MAX_PX / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * r)), h = Math.max(1, Math.round(img.height * r));
        const c = document.createElement('canvas'); c.width = w; c.height = h;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h);   // un PNG transparent ne vire pas au noir
        ctx.drawImage(img, 0, 0, w, h);
        const d = c.toDataURL('image/jpeg', 0.86);
        ok({ mime: 'image/jpeg', data: d.split(',')[1], largeur: w, hauteur: h, apercu: d });
      };
      img.onerror = function () { URL.revokeObjectURL(url); non(new Error('Image illisible.')); };
      img.src = url;
    });
  }

  window.ofChoisir = async function (inp) {
    const f = inp && inp.files && inp.files[0];
    if (!f) return;
    const t = document.getElementById('of-depot-txt');
    if (t) t.textContent = 'Préparation…';
    try {
      ofImage = await ofReduire(f);
      const ap = document.getElementById('of-apercu');
      if (ap) { ap.src = ofImage.apercu; ap.style.display = ''; }
      if (t) t.textContent = 'Affiche prête (' + ofImage.largeur + '×' + ofImage.hauteur + ') — en choisir une autre';
    } catch (e) {
      ofImage = null;
      if (t) t.textContent = 'Image illisible — réessayer';
      ofDire(e.message, true);
    }
  };

  function ofDire(t, mal) {
    const m = document.getElementById('of-msg');
    if (m) { m.textContent = t; m.className = 'of-msg' + (mal ? ' of-mal' : ''); }
  }

  window.ofEnregistrer = async function () {
    const v = function (id) { const e = document.getElementById(id); return e ? e.value.trim() : ''; };
    const corps = {
      code: ofEdite || v('of-code'),
      titre: v('of-titre'),
      mentions: v('of-mentions'),
      debut: v('of-debut') || null,
      fin: v('of-fin') || null,
      veille: !!(document.getElementById('of-veille') || {}).checked
    };
    if (ofImage) {
      corps.mime = ofImage.mime; corps.data = ofImage.data;
      corps.largeur = ofImage.largeur; corps.hauteur = ofImage.hauteur;
    }
    if (!corps.titre) return ofDire('Il manque le titre.', true);
    if (!corps.code) return ofDire('Il manque l’adresse du lien.', true);
    if (!ofEdite && !ofImage) return ofDire('Il manque l’affiche.', true);
    ofDire('Envoi…');
    try {
      const r = await fetch('/api/offres', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corps)
      });
      const j = await r.json();
      if (!r.ok || !j.ok) return ofDire(j.error || 'Enregistrement impossible.', true);
      ofEdite = null; ofImage = null; ofCodeTouche = false;
      await window.ofCharger();
    } catch (e) { ofDire('Enregistrement impossible : ' + e.message, true); }
  };

  window.ofSupprimer = async function (code) {
    const o = ofListe.find(x => x.code === code); if (!o) return;
    if (!confirm('Supprimer « ' + o.titre + ' » ?\n\nLes SMS déjà envoyés qui portent cette adresse '
      + 'montreront l’image de veille.')) return;
    try {
      await fetch('/api/offres/supprimer', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: code })
      });
      await window.ofCharger();
    } catch (e) {}
  };

  window.ofCharger = async function () {
    try {
      const r = await fetch('/api/offres');
      const j = await r.json();
      if (r.ok && j.ok) {
        ofListe = j.offres || []; ofRedacteur = !!j.redacteur; ofJourServeur = j.jour || '';
        OF_DIFFUSION = j.base || '';
      }
    } catch (e) {}
    window.ofRender();
  };

  // ── Injection ─────────────────────────────────────────────────────────────
  const OF_CSS = [
    '.of-vedette{display:flex;gap:18px;flex-wrap:wrap}',
    '.of-aff{width:168px;flex:none;border-radius:12px;border:1px solid var(--gray-200);background:#fff;object-fit:contain;align-self:flex-start}',
    '.of-v-d{flex:1;min-width:260px}',
    '.of-v-t{font-size:1.15rem;font-weight:700;color:var(--gray-900);margin:8px 0 3px}',
    '.of-v-p{font-size:.84rem;color:var(--gray-500)}',
    '.of-badge{display:inline-block;font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;border-radius:20px;padding:3px 10px;background:var(--gray-100);color:var(--gray-500)}',
    '.of-e-vive{background:var(--g-pale);color:var(--g-dark)}',
    '.of-e-avenir{background:var(--b-pale);color:var(--b-dark)}',
    '.of-e-fini{background:var(--gray-100);color:var(--gray-500)}',
    '.of-e-veille{background:var(--amber-pale);color:var(--amber)}',
    '.of-lien{display:flex;align-items:center;gap:9px;flex-wrap:wrap;margin:13px 0 4px}',
    '.of-lien code{flex:1;min-width:200px;background:var(--gray-100);border:1px solid var(--gray-200);border-radius:8px;padding:9px 12px;font-size:.85rem;color:var(--g-dark);word-break:break-all}',
    '.of-lbl{font-size:.7rem;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--gray-500);margin:14px 0 5px}',
    '.of-sms{width:100%;min-height:72px;border:1px solid var(--gray-300);border-radius:8px;padding:10px 12px;font-family:inherit;font-size:.9rem;line-height:1.5;resize:vertical}',
    '.of-pied{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-top:7px;font-size:.8rem;color:var(--gray-500);flex-wrap:wrap}',
    '.of-cher{color:var(--amber);font-weight:600}',
    '.of-note{font-size:.78rem;color:var(--gray-500);line-height:1.6;margin-top:12px}',
    '.of-vide{padding:22px;text-align:center;color:var(--gray-500);font-size:.88rem;line-height:1.7}',
    '.of-vide b{display:block;color:var(--gray-900);font-size:.98rem;margin-bottom:4px}',
    '.of-liste{display:flex;flex-direction:column;gap:2px}',
    '.of-l{display:flex;align-items:center;gap:12px;padding:9px 4px;border-top:1px solid var(--gray-200)}',
    '.of-l:first-child{border-top:none}',
    '.of-l-i{width:38px;height:50px;object-fit:cover;border-radius:6px;border:1px solid var(--gray-200);flex:none}',
    '.of-l-d{flex:1;min-width:0}',
    '.of-l-t{font-weight:600;font-size:.92rem}',
    '.of-l-p{font-size:.78rem;color:var(--gray-500);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
    '.of-l-n{font-variant-numeric:tabular-nums;font-weight:600;color:var(--gray-500);min-width:38px;text-align:right}',
    '.of-th{font-size:.68rem;text-transform:uppercase;letter-spacing:.05em;color:var(--gray-500)}',
    '.of-sup{color:var(--red)}',
    '.of-f .fg{margin-bottom:13px}',
    '.of-f label{display:block;font-size:.76rem;font-weight:600;color:var(--gray-700);margin-bottom:4px}',
    '.of-2{display:grid;grid-template-columns:1fr 1fr;gap:12px}',
    '.of-depot{display:block;border:2px dashed var(--gray-300);border-radius:12px;padding:20px;text-align:center;cursor:pointer;color:var(--gray-500);font-size:.88rem;margin-bottom:13px}',
    '.of-depot:hover{border-color:var(--g-mid);color:var(--g-dark)}',
    '.of-depot input{display:none}',
    '.of-apercu{display:block;max-width:190px;border-radius:10px;border:1px solid var(--gray-200);margin-bottom:13px}',
    '.of-code{display:flex;align-items:center;gap:0}',
    '.of-code span{font-size:.84rem;color:var(--gray-500);background:var(--gray-100);border:1px solid var(--gray-300);border-right:none;border-radius:8px 0 0 8px;padding:9px 10px;white-space:nowrap}',
    '.of-code .inp{border-radius:0 8px 8px 0}',
    '.of-aide{font-size:.76rem;color:var(--gray-500);margin-top:4px}',
    '.of-chk{display:flex;gap:9px;align-items:flex-start;font-size:.82rem;color:var(--gray-700);line-height:1.55;background:var(--gray-100);border-radius:10px;padding:12px 14px}',
    '.of-chk input{margin-top:2px;flex:none}',
    '.of-act{display:flex;align-items:center;gap:14px;margin-top:16px}',
    '.of-msg{font-size:.84rem;color:var(--g-dark)}',
    '.of-mal{color:var(--red)}',
    '.of-hote{font-size:.78rem;color:var(--gray-500);text-align:center;padding:4px 0 10px}',
    '@media(max-width:600px){.of-aff{width:100%;max-width:220px;margin:0 auto}.of-2{grid-template-columns:1fr}}'
  ].join('\n');

  function ofInject() {
    if (document.getElementById('of-css')) return;
    const st = document.createElement('style');
    st.id = 'of-css'; st.textContent = OF_CSS;
    document.head.appendChild(st);

    const ref = document.querySelector('.sb-item[data-sec="sms"]')
      || document.querySelector('.sb-item[data-sec="messagerie"]')
      || document.querySelector('.sb-item[data-sec="livraisons"]');
    if (ref && !document.querySelector('.sb-item[data-sec="offres"]')) {
      const b = document.createElement('button');
      b.className = 'sb-item';
      b.setAttribute('data-sec', 'offres');
      b.setAttribute('onclick', "showSec('offres',this)");
      b.innerHTML = '<svg class="ico sb-ico"><use href="#ic-idee"></use></svg>'
        + '<span class="sb-label">Offres</span>';
      ref.insertAdjacentElement('afterend', b);
    }
    const secRef = document.getElementById('sec-livraisons');
    if (secRef && !document.getElementById('sec-offres')) {
      const sec = document.createElement('section');
      sec.id = 'sec-offres'; sec.className = 'sec';
      sec.innerHTML = '<div id="of-host"></div>';
      secRef.parentNode.appendChild(sec);
    }
    if (typeof SEC_LABEL === 'object' && SEC_LABEL) SEC_LABEL.offres = 'Offres — affiches et liens';
    // Le code cesse de suivre le titre dès qu'on écrit dedans. L'écouteur est
    // posé sur le document : le formulaire est redessiné à chaque rendu, et un
    // écouteur posé sur le champ disparaîtrait avec lui.
    document.addEventListener('input', function (e) {
      if (e.target && e.target.id === 'of-code') ofCodeTouche = true;
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', ofInject);
  else ofInject();
})();
