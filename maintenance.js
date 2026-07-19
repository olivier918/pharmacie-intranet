// ─────────────────────────────────────────────────────────────
// Maintenance des données — Pharmacie du Centre (étape B)
//  1) Rétention : purge des livraisons > 15 j et des préparations > 3 mois
//     (par le champ `date` au format yyyy-mm-dd). Appliquée en lecture ET en
//     écriture => les postes ne revoient jamais les anciennes, donc pas de
//     « résurrection » via la fusion au save.
//  2) Allègement de l'historique : on retire les champs LOURDS et RÉGÉNÉRABLES
//     (bonPdfHtml, pdfVersions) des instantanés. On CONSERVE scanData (scan
//     d'ordonnance original, non régénérable) pour rester restaurable.
// Tout est paramétrable par variables d'environnement.
// ─────────────────────────────────────────────────────────────
const fs = require('fs');

const DELIV_DAYS = parseInt(process.env.RETENTION_DELIVERIES_DAYS || '15', 10);
const PREPS_DAYS = parseInt(process.env.RETENTION_PREPS_DAYS || '90', 10);
const HISTORY_MIN_INTERVAL_MIN = parseInt(process.env.HISTORY_MIN_INTERVAL_MIN || '5', 10);
// Champs volumineux et reconstructibles depuis les données : inutiles dans l'historique.
const HISTORY_STRIP_FIELDS = ['bonPdfHtml', 'pdfVersions'];

// Date-butoir yyyy-mm-dd : aujourd'hui - days
function cutoff(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().split('T')[0];
}

// Un item est « trop vieux » si sa date (yyyy-mm-dd) est antérieure à la butoir.
// En cas de date absente ou de format inattendu : on GARDE (prudence, jamais de purge à l'aveugle).
function isOlder(dateStr, cutoffStr) {
  if (!dateStr || typeof dateStr !== 'string') return false;
  const d = dateStr.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false;
  return d < cutoffStr; // comparaison lexicographique = chronologique pour yyyy-mm-dd
}

// Renvoie une COPIE du blob avec livraisons/préparations anciennes retirées.
function pruneRetention(blob) {
  if (!blob || typeof blob !== 'object') return blob;
  const out = Object.assign({}, blob);
  if (Array.isArray(out.deliveries)) {
    const c = cutoff(DELIV_DAYS);
    out.deliveries = out.deliveries.filter((x) => !isOlder(x && x.date, c));
  }
  if (Array.isArray(out.preps)) {
    const c = cutoff(PREPS_DAYS);
    out.preps = out.preps.filter((x) => !isOlder(x && x.date, c));
  }
  return out;
}

// Renvoie une version allégée du blob pour l'historique (champs lourds retirés).
// scanData est conservé (par référence, pas de copie inutile).
function slimForHistory(blob) {
  if (!blob || typeof blob !== 'object') return blob;
  const out = {};
  for (const k of Object.keys(blob)) {
    const v = blob[k];
    if (Array.isArray(v)) {
      out[k] = v.map((item) => {
        if (item && typeof item === 'object' && HISTORY_STRIP_FIELDS.some((f) => f in item)) {
          const c = Object.assign({}, item);
          for (const f of HISTORY_STRIP_FIELDS) delete c[f];
          return c;
        }
        return item;
      });
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Purge unique au démarrage (hygiène du stockage). Best-effort.
async function pruneStored(db, dataFile) {
  try {
    if (db) {
      const r = await db.query('SELECT data FROM app_data WHERE id = 1');
      const data = r.rows[0] && r.rows[0].data;
      if (data && Object.keys(data).length) {
        const pruned = pruneRetention(data);
        if (changed(data, pruned)) {
          await db.query('UPDATE app_data SET data = $1, updated_at = NOW() WHERE id = 1', [JSON.stringify(pruned)]);
          return true;
        }
      }
    } else if (dataFile && fs.existsSync(dataFile)) {
      const data = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      const pruned = pruneRetention(data);
      if (changed(data, pruned)) {
        fs.writeFileSync(dataFile, JSON.stringify(pruned, null, 2), 'utf8');
        return true;
      }
    }
  } catch (e) {
    console.warn('Purge rétention (démarrage):', e.message);
  }
  return false;
}

function len(a) { return Array.isArray(a) ? a.length : 0; }
function changed(before, after) {
  return len(before.deliveries) !== len(after.deliveries) || len(before.preps) !== len(after.preps);
}

module.exports = {
  pruneRetention, slimForHistory, pruneStored,
  DELIV_DAYS, PREPS_DAYS, HISTORY_MIN_INTERVAL_MIN, HISTORY_STRIP_FIELDS,
};
