#!/usr/bin/env python3
"""
Sonnette PILOT — poste dédié Raspberry Pi.

Écoute le flux temps réel de l'intranet (/api/sonnette/stream) et joue une
sonnerie sur le Speaker Bonnet. Aucun navigateur, aucune session, aucun écran :
l'appareil est branché, il sonne. Il redémarre seul après une coupure.

Le jeton d'appareil part dans l'en-tête Authorization, jamais dans l'URL :
une adresse se retrouve dans les journaux des serveurs et des proxys, un
en-tête non.
"""
import json, os, subprocess, sys, time
import urllib.request, urllib.error, urllib.parse

CONF = "/etc/pilot-sonnette.conf"

def config():
    c = {"url": "", "token": "", "son": "/opt/pilot-sonnette/sonnerie.wav",
         "nom": "Comptoir", "id": "rpi-comptoir", "carte": "sndrpigooglevoi"}
    try:
        with open(CONF) as f:
            for ligne in f:
                ligne = ligne.strip()
                if not ligne or ligne.startswith("#") or "=" not in ligne:
                    continue
                k, v = ligne.split("=", 1)
                c[k.strip()] = v.strip()
    except FileNotFoundError:
        pass
    return c

def journal(msg):
    # systemd horodate lui-meme : on ecrit brut, sans doubler la date.
    print(msg, flush=True)

# Sonneries disponibles. Le nom arrive dans l'evenement, choisi depuis le
# back-office : l'appareil n'a donc aucune configuration a recharger quand on
# change de sonnerie. On verifie tout de meme le nom ici — un nom recu du reseau
# ne doit jamais pouvoir designer un fichier hors de ce dossier.
SONS_OK = {"dingdong", "westminster", "carillon3", "grelot", "electrique",
           "moderne", "doux", "marimba", "harpe"}

def fichier_son(c, nom):
    if nom in SONS_OK:
        chemin = os.path.join(os.path.dirname(c["son"]), "sons", nom + ".wav")
        if os.path.exists(chemin):
            return chemin
    return c["son"]          # repli : la sonnerie par defaut, toujours presente

# Volume pilote depuis le back-office. On ne rejoue la commande que lorsque la
# valeur change : inutile de solliciter le mixeur a chaque appel. Un echec n'est
# jamais bloquant — mieux vaut une sonnerie au mauvais volume que pas de
# sonnerie du tout.
_volume_courant = [None]

def regler_volume(c, pct):
    try:
        pct = max(10, min(100, int(pct)))
    except Exception:
        return
    if _volume_courant[0] == pct:
        return
    try:
        subprocess.run(["amixer", "-c", c.get("carte", "sndrpigooglevoi"),
                        "sset", "PCM", "%d%%" % pct],
                       timeout=8, check=False,
                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        _volume_courant[0] = pct
        journal("Volume regle a %d%%" % pct)
    except Exception as e:
        journal("Reglage du volume impossible : %s" % e)

def sonner(fichier, repetitions=1):
    for i in range(max(1, min(5, repetitions))):
        try:
            subprocess.run(["aplay", "-q", fichier], timeout=15, check=False)
        except Exception as e:
            journal("Lecture du son impossible : %s" % e)
            return

def ecouter(c):
    """Ouvre le flux et joue a chaque evenement 'ring'. Retourne a la fin du flux."""
    url = c["url"].rstrip("/") + "/api/sonnette/stream?id=%s&nom=%s&rx=1" % (
        urllib.parse.quote(c["id"]), urllib.parse.quote(c["nom"]))
    req = urllib.request.Request(url, headers={
        "Authorization": "Bearer " + c["token"],
        "Accept": "text/event-stream",
        "Cache-Control": "no-cache",
    })
    with urllib.request.urlopen(req, timeout=40) as flux:
        journal("Connecté à %s — en attente" % c["url"])
        evenement = None
        while True:
            brut = flux.readline()
            if not brut:
                return                      # flux ferme proprement : on rouvrira
            ligne = brut.decode("utf-8", "replace").rstrip("\n")
            if ligne.startswith(":"):
                continue                    # battement de coeur du serveur
            if ligne.startswith("event:"):
                evenement = ligne[6:].strip()
            elif ligne.startswith("data:"):
                if evenement == "ring":
                    try:
                        d = json.loads(ligne[5:].strip())
                    except Exception:
                        d = {}
                    regler_volume(c, d.get("vol", 80))
                    son = fichier_son(c, str(d.get("son", "")))
                    journal("Appel : %s (%s) — %s" % (
                        d.get("type", "comptoir"), d.get("par", "?"), os.path.basename(son)))
                    sonner(son, int(d.get("rep", 1) or 1))
                evenement = None

def main():
    c = config()
    if not c["url"] or not c["token"]:
        journal("Configuration incomplète : renseignez url= et token= dans " + CONF)
        sys.exit(1)
    if not os.path.exists(c["son"]):
        journal("Fichier son introuvable : " + c["son"])
        sys.exit(1)
    # Attente progressive : un Pi qui demarre avant que le reseau ne soit pret
    # ne doit pas marteler le serveur, ni abandonner.
    attente = 2
    while True:
        try:
            ecouter(c)
            attente = 2                     # le flux a vecu : on repart court
        except urllib.error.HTTPError as e:
            journal("Refus du serveur (%s) — jeton invalide ?" % e.code)
            attente = 60
        except Exception as e:
            journal("Connexion perdue (%s)" % e)
        time.sleep(attente)
        attente = min(attente * 2, 60)

if __name__ == "__main__":
    main()
