# -*- coding: utf-8 -*-
"""Prototype d'analyse des PDF ASCA. On lit les MOTS AVEC LEUR ABSCISSE, pas des
lignes decoupees aux espaces : plusieurs colonnes sont vides une ligne sur deux
(Code, CIP13, Stock), et un decoupage aux espaces les decalerait en silence."""
import pdfplumber, re, sys, json, io

U = '/root/.claude/uploads/5a09dafc-f411-5ede-a260-e032a5fbfb2f/'

def lignes_mots(pdf, page):
    """Rend les lignes de la page comme des listes de (x0, texte)."""
    mots = sorted(page.extract_words(x_tolerance=1.4, y_tolerance=2),
                  key=lambda m: (m['top'], m['x0']))
    # ON REGROUPE PAR PROXIMITE, PAS PAR ARRONDI. Deux mots d'une meme ligne
    # peuvent avoir des ordonnees de 100.4 et 101.6 : arrondis au tiers de
    # point, ils tombent de part et d'autre d'une frontiere et la ligne se
    # coupe en deux — on perd alors tout sauf le code produit, en silence.
    lignes, courante, ref = [], [], None
    for m in mots:
        if ref is None or abs(m['top'] - ref) <= 3.5:
            courante.append((m['x0'], m['text']))
            ref = m['top'] if ref is None else ref
        else:
            lignes.append(sorted(courante)); courante = [(m['x0'], m['text'])]; ref = m['top']
    if courante: lignes.append(sorted(courante))
    return lignes

def colonnes(ligne_entete, noms):
    """Abscisse de depart de chaque colonne, relevee sur la ligne d'en-tete."""
    col = {}
    for x, t in ligne_entete:
        for n in noms:
            if t.startswith(n.split()[0]) and n not in col:
                col[n] = x
    return col

def decouper(ligne, col, noms):
    """Range chaque mot dans la colonne dont il part le plus pres, a droite."""
    bornes = [(col[n], n) for n in noms if n in col]
    bornes.sort()
    out = {n: [] for _, n in bornes}
    for x, t in ligne:
        cible = bornes[0][1]
        for bx, n in bornes:
            if x >= bx - 12: cible = n
            else: break
        out[cible].append(t)
    d = {n: ' '.join(v).strip() for n, v in out.items()}
    # LE SIGNE MOINS EST UN GLYPHE A PART : le stock negatif sort « - 1 », et
    # non « -1 ». Un parseFloat naif le lit comme vide, et un stock de -6 passe
    # pour un stock de zero — soit exactement le contraire d'une urgence.
    for k in d:
        if re.match(r'^-\s+\d', d[k]): d[k] = d[k].replace(' ', '', 1)
    return d

def dedoubler(s):
    """LE FAUX GRAS D'ASCA. Les noms de laboratoires sont imprimes DEUX FOIS,
    decales d'un poil, pour faire du gras sans police grasse. A l'extraction,
    chaque caractere apparait donc en double : « AABBOOCCAA » pour ABOCA. On ne
    peut pas le deviner en lisant le PDF a l'ecran — il faut l'avoir extrait."""
    if len(s) >= 4 and len(s) % 2 == 0 and s[0::2] == s[1::2]:
        return s[0::2]
    return s

EAN = re.compile(r'^\d{8,14}$')
NOMBRE = re.compile(r'^-?\d+([.,]\d+)?$')

def est_labo(ligne):
    """Une ligne de laboratoire ne porte ni code ni nombre : que du texte."""
    if not ligne: return False
    txt = [t for _, t in ligne]
    if any(EAN.match(t) or NOMBRE.match(t) for t in txt): return False
    j = ' '.join(txt)
    if re.search(r'Page\s*\d|Pharmacie|^Liste|^Code$', j): return False
    return bool(j) and j.upper() == j and len(j) > 2

def pied(ligne):
    j = ' '.join(t for _, t in ligne)
    return bool(re.search(r'Page\s+\d+$|^Pharmacie\b|\bau\s+\w+\s+\d+\s+\w+\s+\d{4}', j))

def date_synthese(chemin):
    with pdfplumber.open(chemin) as p:
        t = p.pages[0].extract_text() or ''
        t += (p.pages[-1].extract_text() or '')
    m = re.search(r'au\s+\w+\s+(\d{1,2})\s+(\w+)\.?\s+(\d{4})\s+à\s+(\d{1,2}):(\d{2})', t)
    return m.groups() if m else None

def analyser(chemin, noms, entete_mot):
    labo, lignes, entete = None, [], None
    with pdfplumber.open(chemin) as pdf:
        for page in pdf.pages:
            for l in lignes_mots(pdf, page):
                txt = [t for _, t in l]
                if entete_mot in txt and 'Produit' in txt:
                    entete = colonnes(l, noms); continue      # en-tete, repete a chaque page
                if not entete or pied(l): continue
                if est_labo(l): labo = ' '.join(dedoubler(t) for t in txt); continue
                if not any(EAN.match(t) or NOMBRE.match(t) for t in txt): continue
                d = decouper(l, entete, noms); d['labo'] = labo
                # « 24 j » se coupe en deux : le « j » deborde dans la colonne
                # suivante. « 5j » ne se coupe pas. Les deux existent.
                if 'Moy.Vte' in d and d['Moy.Vte'].startswith('j '):
                    d['depuis'] = (d.get('depuis','') + ' j').strip()
                    d['Moy.Vte'] = d['Moy.Vte'][2:].strip()
                for k in ('depuis',):
                    if k in d: d[k] = d[k].replace(' ', '').rstrip('j')
                lignes.append(d)
    return lignes

SANS = ['Code', 'EAN', 'CIP13', 'Produit', 'Forme', 'Etiquette', 'Stock', 'Dern.Vte', 'depuis', 'Moy.Vte']
RISQ = ['Code', 'EAN', 'CIP13', 'Produit', 'Stk', 'à Cder', 'Moy.Vte']
AVEC = ['Code', 'Produit', 'Dern.Vte', 'Stock', 'Dt.Liv', 'En Cde', 'Moy.Vte']

jeux = {
  'sans_commande': (U + '99f2e122-Produits_en_rupture_sans_commande.PDF', SANS, 'Etiquette'),
  'risque_15j':    (U + '81c42a1e-Risque_de_Ruptures_par_rapport_aux_ventes_sur_15_Jours.PDF', RISQ, 'Stk'),
  'avec_commande': (U + '34540d17-Produits_en_Ruptures_avec_Commandes.PDF', AVEC, 'Dt.Liv'),
}
res = {}
for cle, (ch, noms, mot) in jeux.items():
    l = analyser(ch, noms, mot)
    res[cle] = l
    labos = sorted({x['labo'] for x in l if x['labo']})
    print('%-15s %3d lignes, %2d laboratoires, date %s' % (cle, len(l), len(labos), date_synthese(ch)))
    print('   exemple :', json.dumps(l[0], ensure_ascii=False) if l else '—')
    sansLabo = [x for x in l if not x['labo']]
    if sansLabo: print('   ⚠ %d ligne(s) sans laboratoire' % len(sansLabo))
io.open('brut.json','w',encoding='utf-8').write(json.dumps(res, ensure_ascii=False))
