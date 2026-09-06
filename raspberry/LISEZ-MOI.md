# Sonnette PILOT — poste dédié Raspberry Pi

Un Raspberry Pi 4 + Adafruit Speaker Bonnet, branché au comptoir, qui sonne
quand quelqu'un appuie sur la sonnette dans l'intranet. Pas de navigateur, pas
d'écran, pas de session à ouvrir : il est alimenté, il fonctionne. Après une
coupure de courant il revient seul.

**Ordre des opérations : le serveur d'abord (étape 1), le Raspberry ensuite.
Sans le jeton côté serveur, le poste sera refusé et vous chercherez au mauvais
endroit.**

---

## 1. Côté serveur (Railway)

Générer un jeton d'appareil, sur le Mac :

    openssl rand -hex 24

Puis, dans les variables du service Railway :

    SONNETTE_TOKEN=<la valeur générée>

Au redémarrage, les journaux affichent « 🔔 Jeton de sonnette actif ».

Ce jeton n'ouvre **que** le flux de la sonnette. Il ne donne accès ni aux
données, ni aux envois de SMS ou de mails — c'est vérifié par test. Un
Raspberry volé dans l'officine ne donne donc rien d'autre que le droit
d'entendre sonner.

## 2. Préparer la carte SD

Raspberry Pi Imager, **Raspberry Pi OS Lite (64 bits)** — la version sans
bureau : ce poste n'a pas d'écran, tout ce qui est graphique est du temps de
démarrage perdu et une surface d'attaque en plus.

Dans les réglages avancés de l'Imager, avant d'écrire la carte :

- nom d'hôte : `pilot-comptoir`
- utilisateur : `pilot` + un mot de passe
- SSH activé
- Wi-Fi renseigné — **ou mieux, prévoir un câble Ethernet** : une sonnette qui
  dépend du Wi-Fi de l'officine tombe le jour où la box redémarre.

## 3. Le Speaker Bonnet

En SSH sur le Pi :

    sudo apt update && sudo apt install -y wget python3-pip alsa-utils
    pip3 install --break-system-packages adafruit-python-shell
    wget https://github.com/adafruit/Raspberry-Pi-Installer-Scripts/raw/main/i2samp.py
    sudo -E env PATH=$PATH python3 i2samp.py

Le script demande de tester le son, puis **deux redémarrages** sont nécessaires
pour que le réglage de volume soit disponible. C'est normal, ce n'est pas un
échec.

Configuration manuelle, si l'on préfère : commenter `dtparam=audio=on` dans
`/boot/firmware/config.txt` et y ajouter `dtoverlay=max98357a`.

Réglage du volume : `alsamixer`. Commencer à 50 % — au-delà, le son sature et
devient désagréable plutôt que plus audible.

> À savoir : le noyau ne sort pas de mono sur l'interface I2S. Le fichier
> `sonnerie.wav` fourni est donc en stéréo. Un fichier mono resterait muet.

## 4. Installer le service

Copier les fichiers depuis le Mac (adapter l'adresse) :

    scp raspberry/sonnette.py raspberry/sonnerie.wav pilot@pilot-comptoir.local:/tmp/
    scp raspberry/pilot-sonnette.service pilot@pilot-comptoir.local:/tmp/

Puis sur le Pi :

    sudo mkdir -p /opt/pilot-sonnette
    sudo mv /tmp/sonnette.py /tmp/sonnerie.wav /opt/pilot-sonnette/
    sudo chmod 755 /opt/pilot-sonnette/sonnette.py
    sudo mv /tmp/pilot-sonnette.service /etc/systemd/system/

Configuration — c'est ce fichier qui contient le jeton :

    sudo nano /etc/pilot-sonnette.conf

Y coller le contenu de `pilot-sonnette.conf.exemple`, en renseignant `url` et
`token`. Puis restreindre sa lecture :

    sudo chown root:pilot /etc/pilot-sonnette.conf
    sudo chmod 640 /etc/pilot-sonnette.conf

Démarrer :

    sudo systemctl daemon-reload
    sudo systemctl enable --now pilot-sonnette

## 5. Vérifier

    sudo systemctl status pilot-sonnette
    journalctl -u pilot-sonnette -f

Attendu : « Connecté à https://pilot.pharmacie-mondeville.fr — en attente ».
Appuyer alors sur la sonnette depuis n'importe quel poste : le son part dans la
seconde, et le journal affiche l'appel et son auteur.

**Test à ne pas sauter avant la mise en service : débrancher l'alimentation du
Pi, rebrancher, et vérifier que la sonnerie fonctionne sans aucune
intervention.** C'est tout l'intérêt du poste, et c'est le seul moyen de
s'assurer que le démarrage automatique est correct.

## Diagnostic

| Symptôme | Cause probable |
|---|---|
| « Refus du serveur (401) » | jeton absent, mal recopié, ou `SONNETTE_TOKEN` pas encore posée dans Railway |
| Connecté mais aucun son | volume à zéro dans `alsamixer`, ou fichier mono ; tester avec `aplay /opt/pilot-sonnette/sonnerie.wav` |
| « Connexion perdue » régulière | Wi-Fi instable — passer en Ethernet |
| Rien au démarrage | `systemctl is-enabled pilot-sonnette` doit répondre `enabled` |

Le service se reconnecte seul, avec une attente qui double à chaque échec
jusqu'à une minute : une coupure réseau ne provoque ni martèlement du serveur,
ni abandon définitif.
