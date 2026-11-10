# Blind Test : mode d'emploi

## Sur Mac (première installation)

1. Installe **Node.js** (version LTS) depuis https://nodejs.org, si ce n'est pas déjà fait.
2. Dézippe le dossier, par exemple sur le Bureau.
3. Ouvre l'app **Terminal**, tape `bash ` (avec un espace), glisse le fichier **`LANCER.command`** dans la fenêtre, puis appuie sur Entrée.
   - La 1re fois, les composants s'installent (environ 1 minute, Internet nécessaire).
   - Si macOS demande d'autoriser les connexions entrantes pour « node », clique sur **Autoriser** : sinon les téléphones ne pourront pas se connecter.
4. L'écran animateur s'ouvre dans le navigateur. La suite est identique à Windows, voir plus bas.

Pour arrêter le jeu : ferme la fenêtre du Terminal, ou appuie sur **Ctrl + C** dedans.

## Le jour J

1. Connecte ton PC au **Wi-Fi de l'agence** et branche-le sur la TV et l'enceinte.
2. Double-clique sur **`LANCER.bat`**. Une fenêtre noire s'ouvre : **ne la ferme pas** pendant le jeu.
   - La 1re fois, Windows peut demander d'autoriser « Node.js » dans le pare-feu : clique sur **Autoriser** (cocher « réseaux privés », et aussi « publics » si le Wi-Fi de l'agence est classé public).
3. L'écran animateur s'ouvre dans le navigateur (sinon : `http://localhost:3000/ecran`). Clique sur **Activer le son**, puis appuie sur **F11** pour le plein écran.
4. Les collègues scannent le QR code et entrent leur prénom et leur nom. Leurs noms apparaissent à l'écran.
5. Clique sur **Lancer la partie** (ou appuie sur Espace).
6. Chaque manche se déroule ainsi : 3 s de préparation, puis **15 s pendant lesquelles la chanson joue et le QCM est affiché**. Les joueurs répondent pendant l'écoute.
7. À la fin du chrono, l'écran indique seulement combien de joueurs ont répondu. **Aucune bonne réponse ni aucun score n'est montré pendant la partie**, ni sur la TV ni sur les téléphones. Clique sur **Chanson suivante** (ou Espace) pour enchaîner.
8. Après 10 chansons, tout est dévoilé :
   - sur la TV : le podium, le classement complet et les réponses de chaque chanson ;
   - sur chaque téléphone : la place du joueur, ses points et le détail chanson par chanson (✓ / ✕).

   Le classement de **tous les joueurs** est affiché (points, bonnes réponses, temps cumulé).

## Points

- Bonne réponse : de **1000 points** (réponse dès le début de la chanson) à **500 points** (dernière seconde).
- **Égalité** : à égalité de points, on compare le **temps cumulé sur les bonnes réponses uniquement** ; le plus faible total l'emporte. Une mauvaise réponse ou une absence de réponse vaut 0 point et son temps n'est pas compté.
- Mauvaise réponse ou pas de réponse : 0 point.
- La chanson joue toujours ses 15 secondes complètes, même si tout le monde a déjà répondu.

## À tester avant le jour J (2 minutes)

Lance `LANCER.bat` au bureau, puis scanne le QR code avec ton téléphone **connecté au Wi-Fi de l'agence** (pas en 4G).

- **La page s'ouvre** : tout est bon.
- **La page ne s'ouvre pas** : soit le pare-feu bloque (voir l'étape 2), soit le Wi-Fi isole les appareils entre eux. Dans ce cas, choisis un autre réseau dans la liste « Réseau » sous le QR code, ou utilise le partage de connexion d'un téléphone pour le PC et les joueurs.

## Pendant la partie

- **Retirer un joueur** (doublon, faux nom) : clique sur son nom dans la salle d'attente.
- **Un joueur ferme son navigateur** : il rouvre le lien et retrouve sa partie, avec ses points. S'il change de téléphone, il lui suffit de retaper le même prénom et le même nom.
- **Boutons discrets en bas à droite** : « Passer le chrono » et « Réinitialiser ».
- Les inscriptions se ferment dès que la partie démarre.

## La playlist

- La liste est dans **`songs.json`**. À chaque partie, 10 titres sont tirés au hasard. Les mauvaises réponses de chaque QCM sont définies chanson par chanson (champ `choix`).
- Les extraits sont téléchargés depuis Deezer au démarrage (gratuit, sans compte). Il faut Internet sur le PC.
- Dans la salle d'attente, ouvre **Playlist** pour écouter chaque extrait (▶). Décoche un titre pour l'exclure du tirage.
- **Mauvaises réponses du QCM** : elles sont choisies parmi des chansons du **même style** (ou d'un style voisin), pour que la bonne réponse ne se devine pas. Le style est le champ `style` de chaque chanson dans `songs.json` : `chaabi-maroc`, `pop-maroc`, `rap-maroc`, `rai`, `orient`, `pop-inter`, `variete-fr`. Pour une nouvelle chanson, ajoute-le : `{ "artiste": "...", "titre": "...", "style": "rai" }`. Les voisinages entre styles se règlent dans `qcm.js`.
- **Chansons mises de côté** : `songs-reserve.json` garde les idées de titres à ajouter plus tard. Ce fichier n'est pas lu par le jeu : pour en retenir une, copie-la dans `songs.json` avec ses mauvaises réponses (`choix`).
- Pour ajouter une chanson absente de Deezer, ajoute un MP3 (voir `musiques/LISEZ-MOI.txt`).
- Certains titres sont fixés sur une version précise avec `deezerId` (Andou Zine, Hdi Rassek, Abdel Kader en live à Bercy, Douni Lbladi en version originale).
- **Mauvaise version** d'un titre : sur deezer.com, ouvre la bonne version, copie le numéro à la fin de l'adresse (`deezer.com/track/`**`3135556`**) et ajoute-le dans `songs.json` :
  `{ "artiste": "Daft Punk", "titre": "One More Time", "deezerId": 3135556 }`
  Clique ensuite sur « Recharger les extraits » ou relance le jeu.

## Réglages (`config.json`)

| Clé | Rôle |
|---|---|
| `manches` | nombre de chansons (aussi modifiable à l'écran) |
| `gagnants` | nombre de gagnants (2) |
| `secondesReponse` | durée de chaque chanson / QCM (15) |
| `lot` | texte affiché en haut à droite |
