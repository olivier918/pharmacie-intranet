// ─────────────────────────────────────────────────────────────────────────────
//  SMS programmés — départ automatique le matin à 8 h 30
// ─────────────────────────────────────────────────────────────────────────────
//
//  POURQUOI CÔTÉ SERVEUR. Un envoi differé ne peut pas dependre d'un poste
//  allume : le matin ou personne n'ouvre PILOT, les rappels ne partiraient pas.
//  C'est donc le serveur qui envoie, seul, a heure fixe.
//
//  CE QUI COMPTE ICI, c'est de ne JAMAIS envoyer deux fois. Un SMS en double a
//  un patient est genant ; sur un rappel de sante, il fait douter du message.
//  La marque `sentAt` est donc ecrite sur l'enregistrement AVANT la boucle
//  suivante, et un envoi en echec n'est retente que trois fois.
//
//  HEURE DE PARIS, jamais l'heure du serveur : Railway tourne en UTC, et en ete
//  8 h 30 a Paris est 6 h 30 UTC. Un calcul naif enverrait les rappels a 10 h 30.
// ─────────────────────────────────────────────────────────────────────────────

const HEURE_ENVOI = 8 * 60 + 30;     // 8 h 30, en minutes depuis minuit (Paris)
const PAS_MS      = 5 * 60 * 1000;   // on regarde toutes les 5 minutes
const ESSAIS_MAX  = 3;

// ── L'heure et le jour, à Paris ──
function partiesParis(d) {
  const f = new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false
  }).formatToParts(d || new Date());
  const g = t => (f.find(p => p.type === t) || {}).value;
  return { jour: g('year') + '-' + g('month') + '-' + g('day'),
           minutes: parseInt(g('hour'), 10) * 60 + parseInt(g('minute'), 10) };
}

// ── Les jours où l'officine est fermée ──
// Un rappel « venez nous voir » reçu un dimanche matin est un rappel oublié le
// lundi. Dimanches et jours fériés sont donc écartés, et la date glisse au
// jour d'ouverture suivant.
function paques(an) {
  // Algorithme de Butcher — le reste des fêtes mobiles en découle.
  const a = an % 19, b = Math.floor(an / 100), c = an % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mois = Math.floor((h + l - 7 * m + 114) / 31), jour = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(an, mois - 1, jour));
}
function feries(an) {
  const p = paques(an), j = n => { const d = new Date(p); d.setUTCDate(d.getUTCDate() + n); return iso(d); };
  const iso = d => d.toISOString().slice(0, 10);
  return new Set([
    an + '-01-01', an + '-05-01', an + '-05-08', an + '-07-14',
    an + '-08-15', an + '-11-01', an + '-11-11', an + '-12-25',
    j(1),    // lundi de Pâques
    j(39),   // Ascension
    j(50)    // lundi de Pentecôte
  ]);
}
const _cacheFeries = new Map();
function estFerie(isoJour) {
  const an = parseInt(String(isoJour).slice(0, 4), 10);
  if (!_cacheFeries.has(an)) _cacheFeries.set(an, feries(an));
  return _cacheFeries.get(an).has(isoJour);
}
// Dimanche = 0. On lit le jour de la semaine sur une date construite en UTC pour
// que le fuseau du serveur ne le décale pas.
function estDimanche(isoJour) {
  const p = String(isoJour).split('-');
  return new Date(Date.UTC(+p[0], +p[1] - 1, +p[2])).getUTCDay() === 0;
}
function estFerme(isoJour) { return estDimanche(isoJour) || estFerie(isoJour); }

// Prochain jour d'ouverture, à partir de la date donnée (incluse).
function jourOuvrable(isoJour) {
  let j = String(isoJour).slice(0, 10);
  for (let n = 0; n < 20 && estFerme(j); n++) {
    const p = j.split('-'); const d = new Date(Date.UTC(+p[0], +p[1] - 1, +p[2]));
    d.setUTCDate(d.getUTCDate() + 1); j = d.toISOString().slice(0, 10);
  }
  return j;
}

// ─────────────────────────────────────────────────────────────────────────────
//  La tournée d'envoi
// ─────────────────────────────────────────────────────────────────────────────
function installer(app, deps) {
  const { getDb, envoyerSms, smsConfigure, toMsisdn } = deps;

  // Lecture-modification-écriture de l'état, comme le webhook de paiement.
  // `updatedAt` est réhaussé pour que la fusion par enregistrement fasse gagner
  // cette version sur la copie qu'un poste resté ouvert renverrait ensuite.
  async function majEtat(modifier) {
    const db = getDb(); if (!db) return false;
    const cur = await db.query('SELECT data FROM app_data WHERE id = 1');
    const data = (cur.rows[0] && cur.rows[0].data) || {};
    if (!modifier(data)) return false;
    await db.query('UPDATE app_data SET data = $1, updated_at = NOW() WHERE id = 1', [JSON.stringify(data)]);
    return true;
  }

  async function tournee() {
    const db = getDb(); if (!db || !smsConfigure()) return;
    const { jour, minutes } = partiesParis();
    if (minutes < HEURE_ENVOI) return;          // pas encore l'heure, à Paris

    const cur = await db.query('SELECT data FROM app_data WHERE id = 1');
    const data = (cur.rows[0] && cur.rows[0].data) || {};
    const liste = Array.isArray(data.smsProg) ? data.smsProg : [];
    const aPartir = liste.filter(s => s && !s.sentAt && !s.annule
      && (s.essais || 0) < ESSAIS_MAX
      && String(s.date || '').slice(0, 10) <= jour);
    if (!aPartir.length) return;

    for (const s of aPartir) {
      const msisdn = toMsisdn(s.tel);
      let resultat = null, erreur = null;
      if (!msisdn) erreur = 'Numéro de mobile invalide';
      else {
        try { resultat = await envoyerSms({ to: msisdn, text: s.text, tag: s.tag || 'programme' }); }
        catch (e) { erreur = e.message; }
      }
      // On réécrit l'état APRÈS chaque envoi, et non à la fin de la tournée :
      // si le serveur redémarre au milieu, ce qui est parti est déjà marqué.
      await majEtat(function (d) {
        const arr = Array.isArray(d.smsProg) ? d.smsProg : null; if (!arr) return false;
        const r = arr.find(x => x && x.id === s.id); if (!r || r.sentAt) return false;
        if (erreur) { r.essais = (r.essais || 0) + 1; r.erreur = String(erreur).slice(0, 200); }
        else {
          r.sentAt = new Date().toISOString(); r.smsId = (resultat && resultat.id) || null;
          r.erreur = null; r.to = msisdn;
          // Le SMS rejoint l'historique commun : un envoi automatique ne doit pas
          // être moins traçable qu'un envoi fait à la main.
          if (!Array.isArray(d.smsLog)) d.smsLog = [];
          d.smsLog.unshift({
            id: Date.now() + Math.floor(Math.random() * 1000),
            date: new Date().toISOString(), nom: r.nom || '', prenom: r.prenom || '',
            to: msisdn, text: r.text, smsId: r.smsId, source: 'programme',
            by: r.par || null, updatedAt: Date.now()
          });
        }
        r.updatedAt = Date.now();
        return true;
      });
      if (erreur) console.error('  ✉️  SMS programmé en échec (' + s.id + ') :', erreur);
    }
    console.log('  ✉️  SMS programmés : ' + aPartir.length + ' traité(s) à ' + jour);
  }

  // Renvoie ce que le front a besoin de savoir sans recalculer les fêtes mobiles.
  app.get('/api/sms-prog/jour', (req, res) => {
    const d = String(req.query.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return res.status(400).json({ ok: false, error: 'date invalide' });
    const ouvre = jourOuvrable(d);
    res.json({ ok: true, demande: d, ferme: estFerme(d), retenu: ouvre,
               motif: estFerme(d) ? (estDimanche(d) ? 'dimanche' : 'jour férié') : null });
  });

  let minuterie = null;
  function demarrer() {
    if (minuterie) clearInterval(minuterie);
    tournee().catch(e => console.error('SMS programmés :', e.message));
    minuterie = setInterval(() => tournee().catch(e => console.error('SMS programmés :', e.message)), PAS_MS);
    console.log('  ⏰ SMS programmés : tournée toutes les 5 min, départ à partir de 8 h 30 (Paris)');
  }
  return { demarrer, tournee };
}

module.exports = { installer, jourOuvrable, estFerme, estFerie, estDimanche, partiesParis };
