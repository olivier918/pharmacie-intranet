// ─────────────────────────────────────────────────────────────
// Portail d'authentification côté serveur — Pharmacie du Centre
// Ferme le trou « API ouverte » : sans session valide, /api/* renvoie 401
// et toute page renvoie l'écran de connexion. N'AFFECTE PAS index.html.
//
// Activation par variables d'environnement (déploiement sûr) :
//   GATE_PASSWORD   : mot de passe commun du portail. NON défini => portail DÉSACTIVÉ
//                     (comportement identique à aujourd'hui, aucun risque de blocage).
//   SESSION_SECRET  : secret de signature des cookies (sinon généré au démarrage
//                     => déconnexion à chaque redéploiement ; à définir en prod).
//   AUTH_DISABLED   : 'true' pour forcer la désactivation (soupape de secours).
// La 2e sécurité (PIN individuel dans l'appli) reste inchangée par-dessus.
// ─────────────────────────────────────────────────────────────
const crypto = require('crypto');

const GATE_PASSWORD = process.env.GATE_PASSWORD || '';
const AUTH_DISABLED = process.env.AUTH_DISABLED === 'true' || !GATE_PASSWORD;
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const COOKIE = 'phc_session';
const MAX_AGE_MS = 12 * 60 * 60 * 1000; // 12 h
const SECURE = process.env.NODE_ENV === 'production' || !!process.env.DATABASE_URL;

const ALLOW = new Set(['/api/login', '/api/logout', '/api/health', '/login']);

function b64url(buf) { return Buffer.from(buf).toString('base64url'); }

function sign(payloadObj) {
  const payload = b64url(JSON.stringify(payloadObj));
  const mac = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  return payload + '.' + mac;
}

function verify(token) {
  if (!token || token.indexOf('.') < 0) return null;
  const [payload, mac] = token.split('.');
  const expected = crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
  const a = Buffer.from(mac), b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let obj;
  try { obj = JSON.parse(Buffer.from(payload, 'base64url').toString()); } catch (e) { return null; }
  if (!obj || !obj.exp || Date.now() > obj.exp) return null;
  return obj;
}

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function isAuthed(req) {
  if (AUTH_DISABLED) return true;
  return !!verify(parseCookies(req)[COOKIE]);
}

// Comparaison de mots de passe à temps constant (longueurs différentes tolérées)
function samePassword(input, expected) {
  const a = crypto.createHash('sha256').update(String(input)).digest();
  const b = crypto.createHash('sha256').update(String(expected)).digest();
  return crypto.timingSafeEqual(a, b);
}

function setCookie(res) {
  const token = sign({ exp: Date.now() + MAX_AGE_MS });
  const parts = [`${COOKIE}=${token}`, 'HttpOnly', 'Path=/', 'SameSite=Lax', `Max-Age=${Math.floor(MAX_AGE_MS / 1000)}`];
  if (SECURE) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearCookie(res) {
  const parts = [`${COOKIE}=`, 'HttpOnly', 'Path=/', 'Max-Age=0'];
  if (SECURE) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

const LOGIN_HTML = `<!doctype html><html lang="fr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Pharmacie du Centre — Accès</title>
<style>
  *{box-sizing:border-box} body{margin:0;font-family:'Segoe UI',system-ui,Arial,sans-serif;
    background:linear-gradient(135deg,#1D5C3A,#0f3d25);min-height:100vh;display:flex;align-items:center;justify-content:center}
  .card{background:#fff;border-radius:16px;padding:34px 30px;width:min(92vw,360px);box-shadow:0 18px 50px rgba(0,0,0,.25);text-align:center}
  h1{font-size:18px;color:#1D5C3A;margin:0 0 4px} p{color:#666;font-size:13px;margin:0 0 20px}
  input{width:100%;padding:12px 14px;font-size:15px;border:1px solid #cfe0d6;border-radius:10px;outline:none}
  input:focus{border-color:#1D5C3A}
  button{width:100%;margin-top:14px;padding:12px;font-size:15px;font-weight:600;color:#fff;background:#1D5C3A;border:none;border-radius:10px;cursor:pointer}
  button:disabled{opacity:.6;cursor:default}
  .err{color:#c62828;font-size:13px;margin-top:12px;min-height:18px}
</style></head><body>
<form class="card" id="f">
  <h1>Pharmacie du Centre</h1>
  <p>Accès sécurisé — intranet</p>
  <input type="password" id="pw" placeholder="Mot de passe d'accès" autocomplete="current-password" autofocus>
  <button type="submit" id="b">Entrer</button>
  <div class="err" id="e"></div>
</form>
<script>
  const f=document.getElementById('f'),pw=document.getElementById('pw'),b=document.getElementById('b'),e=document.getElementById('e');
  f.addEventListener('submit',async(ev)=>{ev.preventDefault();e.textContent='';b.disabled=true;b.textContent='…';
    try{const r=await fetch('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:pw.value})});
      if(r.ok){location.replace('/');return;}
      e.textContent='Mot de passe incorrect.';}catch(err){e.textContent='Erreur de connexion.';}
    b.disabled=false;b.textContent='Entrer';pw.select();
  });
</script></body></html>`;

// Enregistre les routes de connexion (AVANT le portail pour rester joignables)
function install(app) {
  app.post('/api/login', (req, res) => {
    if (AUTH_DISABLED) return res.json({ ok: true, disabled: true });
    const pw = (req.body && req.body.password) || '';
    if (pw && samePassword(pw, GATE_PASSWORD)) { setCookie(res); return res.json({ ok: true }); }
    return res.status(401).json({ ok: false, error: 'invalid_password' });
  });
  app.post('/api/logout', (req, res) => { clearCookie(res); res.json({ ok: true }); });
}

// Middleware portail : à placer AVANT express.static et les routes /api de données
function gate(req, res, next) {
  if (AUTH_DISABLED) return next();
  if (ALLOW.has(req.path)) return next();
  if (isAuthed(req)) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ ok: false, error: 'auth_required' });
  return res.status(200).type('html').send(LOGIN_HTML);
}

module.exports = { install, gate, AUTH_DISABLED };
