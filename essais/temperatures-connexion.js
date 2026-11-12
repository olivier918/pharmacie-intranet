// LE DISJONCTEUR D'AUTHENTIFICATION SAVERIS.
// node essais/temperatures-connexion.js
//
// CE QUI S'EST PASSÉ. Le 12 novembre 2026, Testo a bloqué le compte de la
// pharmacie. Le motif tenait en une ligne dans leur courriel : « several
// failed login attempts ». Il n'y avait aucune intrusion — c'était PILOT.
//
// Le jeton vit vingt-quatre heures : une seule connexion par jour quand tout
// va bien. Mais une connexion qui ÉCHOUE ne met rien en cache, et le cycle de
// quinze minutes la retentait. Quatre-vingt-seize refus par jour, jusqu'au
// blocage — et un compte bloqué, ici, c'est la surveillance des frigos qui
// s'arrête.
//
// Un mot de passe refusé ne devient pas bon parce qu'on le represente.
const T = require('../temperatures.js');
const A = T._auth;

let ok = 0, ko = 0;
const t = (n, c) => { c ? (ok++, console.log('  ✓ ' + n)) : (ko++, console.log('  ✗ ' + n)); };
console.log('\nLA CONNEXION À SAVERIS, QUAND ELLE EST REFUSÉE\n');

// ── Trois refus, et l'on s'abstient ────────────────────────────────────────
console.log('Trois refus de suite, et PILOT cesse de demander');
A.rearmer();
t('au départ, rien ne bloque', !A.ouvert() && A.etat().refus === 0);
A.noter(403, 'too_many_attempts — compte bloqué');
t('un premier refus ne suspend rien — une faute de frappe se corrige', !A.ouvert());
A.noter(403, 'too_many_attempts');
t('le deuxième non plus', !A.ouvert() && A.etat().refus === 2);
A.noter(403, 'too_many_attempts');
t('LE TROISIÈME SUSPEND LA CONNEXION', A.ouvert() && A.etat().suspendu);
t('... et l’état dit pourquoi, sans jamais montrer d’identifiant',
  /too_many_attempts/.test(A.etat().message) && !/pass|mot de passe/i.test(A.etat().message));
t('... et depuis quand', !!A.etat().depuis && !!A.etat().prochainEssai);

// ── L'attente double, et se plafonne ───────────────────────────────────────
console.log('\nL’attente double à chaque nouveau refus');
const attente = () => new Date(A.etat().prochainEssai) - Date.now();
const heures = () => Math.round(attente() / 36e5);
t('la première attente est d’une heure', heures() === 1);
A.noter(401, 'invalid_grant');
t('... puis de deux', heures() === 2);
A.noter(401, 'invalid_grant');
t('... puis de quatre', heures() === 4);
A.noter(401, 'invalid_grant'); A.noter(401, 'invalid_grant');
t('... puis de seize ? non : DOUZE HEURES AU PLUS', heures() === 12);
A.noter(401, 'invalid_grant');
t('... et elle ne monte plus', heures() === 12);
// LE COMPTE EST CE QUI FAIT BLOQUER : on le borne, et on le dit.
t('AU PIRE, DEUX CONNEXIONS PAR JOUR — contre quatre-vingt-seize avant',
  Math.round(24 / heures()) === 2);

// ── Ce qui n'est pas un refus ne compte pas ────────────────────────────────
// Un 500 ou une coupure ne dit rien du mot de passe : s'en abstenir
// reviendrait à éteindre la surveillance parce que Testo a éternué.
console.log('\nUne panne chez eux n’est pas un refus');
A.rearmer();
A.noter(500, 'Internal Server Error');
A.noter(502, 'Bad Gateway');
A.noter(503, 'Service Unavailable');
t('TROIS ERREURS SERVEUR NE SUSPENDENT RIEN', !A.ouvert() && A.etat().refus === 0);
A.noter(0, 'Delai depasse');
t('... un délai dépassé non plus', !A.ouvert());

// ── Le temps rouvre, un humain rouvre plus vite ────────────────────────────
console.log('\nCe qui rouvre la connexion');
A.rearmer();
A.noter(403, 'bloqué'); A.noter(403, 'bloqué'); A.noter(403, 'bloqué');
t('suspendu maintenant', A.ouvert());
t('... mais plus dans deux heures', !A.ouvert(Date.now() + 2 * 36e5));
A.rearmer();
t('UN HUMAIN QUI RÉARME ROUVRE TOUT DE SUITE', !A.ouvert() && A.etat().refus === 0);
t('... et l’état repart vierge', A.etat().message === '' && A.etat().depuis === null);

// ── Le code tient ces promesses ────────────────────────────────────────────
console.log('\nLe reste du module s’en sert');
const fs = require('fs'), path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'temperatures.js'), 'utf8');
t('le jeton consulte le disjoncteur AVANT d’appeler Auth0',
  /if \(authOuvert\(\)\) \{[\s\S]{0,400}\}\n\n  const payload/.test(src));
t('... y compris pour une reprise forcée après un 401 — c’est le nombre qui bloque',
  /LE DISJONCTEUR VAUT AUSSI POUR `force`/.test(src));
t('un refus est enregistré', /authNoter\(r\.statut, msg\);/.test(src));
t('UNE CONNEXION RÉUSSIE EFFACE L’ARDOISE', /authRearmer\(\);\s+\/\/ une connexion réussie/.test(src));
t('l’état de la connexion est rendu à l’écran', /auth: authEtat\(\), points: q\.rows/.test(src));
t('et le diagnostic réarme, parce qu’il y a quelqu’un derrière ce clic',
  /if \(avant\.refus\) etapes\.push\(\{ etape: 'disjoncteur'/.test(src) && /authRearmer\(\);\n      const jt = await jeton\(true\);/.test(src));
// LE RYTHME DE FOND N'A PAS CHANGÉ : c'est le rattrapage d'échec qui est bridé.
t('le cycle reste à quinze minutes — on n’a pas ralenti la surveillance',
  /const PERIODE_MS   = 15 \* 60 \* 1000;/.test(src));

console.log('\n' + ok + ' vérifications, ' + ko + ' échec(s)\n');
process.exit(ko ? 1 : 0);
