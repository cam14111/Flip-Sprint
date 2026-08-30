# Flip Sprint

**Flip Sprint** est un jeu de cartes qui tourne entièrement dans le navigateur,
jouable en **solo** contre l'ordinateur, à **plusieurs sur un même appareil**
(2 à 8 joueurs) ou **en ligne de 2 à 8 joueurs**, chacun sur son téléphone,
synchronisés en temps réel via Firebase — sans compte à créer.

C'est une **PWA** : installable sur mobile et ordinateur, et **jouable
hors-ligne** une fois chargée (modes solo et local).

Le principe tient en une phrase : **accélérer** pour prendre une carte de plus,
ou **souffler** pour encaisser. Mais si tu tires un numéro que tu as déjà,
c'est la **crampe** — tu perds tout ce que tu avais accumulé pour cette course.

## Le jeu

| Terme | Ce que ça fait |
|---|---|
| **Accélérer** | Prendre une carte de plus |
| **Souffler** | Encaisser ses points et sortir de la course |
| **Crampe** | Un doublon : zéro point pour la course |
| **Sprint parfait** | 7 numéros différents → +15 points, la course s'arrête pour tout le monde |
| **Coup de sifflet** | Le coureur visé encaisse et sort de la course |
| **Rafale** | Le coureur visé doit prendre trois cartes d'affilée |
| **Second souffle** | Annule un doublon. Une seule en main à la fois |
| **Turbo (×2)** | Double la somme des numéros, avant les bonus |
| **Bonus (+2 à +10)** | Ajoutés après le turbo |

Le paquet compte **94 cartes** : un `0`, un `1`, deux `2`… **douze `12`**, plus
6 modificateurs et 9 cartes action. C'est toute la tension du jeu — les gros
numéros rapportent le plus et sont ceux qui cramponnent le plus souvent.

**Formats** : Éclair (5 courses), Sprint (200 points), Marathon (300 points).

## Coups bas — la variante

Un second jeu de règles complet, choisi avant la partie et figé pour toute sa
durée. Ce n'est pas le paquet classique avec quelques cartes en plus : le
paquet, la détection des doublons, le calcul des scores et la liste des
coureurs qu'on peut viser changent tous.

**108 cartes** : 92 numéros de 0 à 13 (jusqu'à **treize `13`**), 6 pénalités à
la place des bonus et du turbo, 10 cartes action. Ni Second souffle, ni Coup de
sifflet, ni Rafale.

| Carte | Ce que ça fait |
|---|---|
| **Faux départ** | Le seul `0`. Score nul pour la course — sauf Sprint parfait — et interdiction de souffler |
| **Le Mur** | Un `7` qui vide le couloir de celui qui le reçoit. Il ne reste que lui |
| **Dossard fétiche** | Un `13` qui en autorise un second. Les deux comptent vers le Sprint parfait |
| **Pénalités −2 à −10** | Données au coureur de ton choix, retirées à la fin |
| **Coup de barre (÷2)** | Divise la somme des numéros par deux, **avant** les pénalités |
| **Dernière ligne droite** | La cible prend une carte, puis doit souffler |
| **Bourrasque** | La cible prend quatre cartes d'affilée |
| **Relais** | Échange deux cartes entre deux couloirs |
| **Aspiration** | Tu prends une carte dans le couloir d'un rival |
| **Faux pas** | La cible perd une carte de ton choix |

Deux règles changent la façon de jouer plus que les cartes elles-mêmes :

- **Souffler ne met plus à l'abri.** Un coureur qui s'est arrêté garde ses
  cartes sur la table : il reste ciblable, peut recevoir une pénalité, se faire
  voler une carte — et **cramper après coup**. Seul un couloir crampé est hors
  de portée.
- **Le Relais est atomique.** On échange, *puis* on juge les deux couloirs :
  un seul Relais peut faire cramper les deux coureurs à la fois.

**Nuit noire** est une sous-option de Coups bas. Elle change trois règles : les
scores de course peuvent passer **sous zéro**, une pénalité peut être collée à
un couloir déjà crampé, et un **Sprint parfait pose une question** — garder les
`+15`, ou renoncer au bonus pour retirer `15` points du **total** d'un rival.

> Les mécaniques de jeu ne sont pas protégeables ; les noms et les visuels le
> sont. Comme pour le reste de Flip Sprint, cette variante n'emprunte que des
> règles : le nom, celui de chaque carte, les textes et les dessins sont
> originaux.

## Fonctionnalités

- **Moteur de jeu pur et testé** (`src/game/`) : toutes les règles vivent dans
  un réducteur pur, sans React, sans timer et sans hasard ambiant. Couvert par
  138 tests, dont plus de 1400 parties aléatoires de 2 à 8 coureurs — sous les
  deux jeux de règles — qui vérifient à chaque transition la conservation des
  cartes, l'absence de doublon dans un couloir, la terminaison et le
  déterminisme.
- **Jauge de risque** : toutes les cartes étant retournées face visible, la
  probabilité de crampe affichée avant chaque décision est **exacte**, pas une
  heuristique — et l'IA raisonne sur exactement le même calcul.
- **IA à trois niveaux** (Débutant / Confirmé / Expert), fondée sur l'espérance
  de gain et sur la lecture de la table.
- **Reprise de partie** : la course en cours est sauvegardée à chaque coup et
  survit à un rechargement ou à la fermeture de la PWA par l'OS.
- **Mode en ligne 2-8 joueurs** : partie créée en un tap, invitation par **code
  à 6 caractères ou lien de partage**, salon en direct, démarrage automatique
  quand tout le monde est là (ou démarrage anticipé par l'hôte), présence de
  chacun, reconnexion transparente après un rafraîchissement ou une coupure
  réseau, exclusion d'un joueur absent validée côté base.
- **Annonce des cartes subies** : un coup de sifflet ou une rafale arrive
  pendant le tour de quelqu'un d'autre et change ce que tu dois faire ensuite.
  Quand l'une des deux vise un joueur humain, elle est annoncée en plein écran
  — la carte, qui l'envoie, ce qu'elle fait. Une touche pour reprendre.
- **Sons synthétisés** (Web Audio, aucun fichier audio) et **retour haptique**,
  désactivables.
- **Statistiques** locales et **écran de règles** illustré avec les vraies cartes.

## Architecture

```
src/game/      moteur pur : types, deck, engine, scoring, odds, ai, settings,
               stats, persistence, copy (tous les textes)
src/online/    protocol · dealer · replay · client (RTDB) · firebase · session
src/hooks/     useGame (solo & local, pilote l'IA) · useOnlineGame
src/ui/        Card, Lane, RiskGauge, GameScreen, Incoming, Overlays, écrans
scripts/       generate-icons · build-rules · emulators · test-rules ·
               e2e-online · smoke-local · check-notch · check-alerts ·
               screenshot
database.rules.json   règles de sécurité RTDB (généré, voir plus bas)
```

Les **cartes sont dessinées en CSS** (`src/ui/Card.tsx`, couleurs dans
`src/ui/theme.ts`) : aucune image n'est chargée, le rendu est net à toutes les
tailles et le poids hors-ligne est quasi nul. Les numéros sont colorés par le
**risque** — bleu calme (0-4), ambre (5-8), magenta (9-12), et rouge
incandescent pour le `13` de Coups bas.

### Le piège de l'encoche

Sur une PWA installée, l'écran physique est plus haut que la page : la bande
derrière l'encoche et le débord de défilement sont peints par l'OS avec **une
couleur unie** prise à la racine du document. Le CSS ne peut pas dessiner là.

Cette couleur doit donc correspondre à ce que l'application peint **en haut**
de l'écran — le sommet du dégradé, bien plus clair que le reste du plateau —
et non à sa teinte moyenne. Une couleur choisie sur le bas du dégradé donne
une **bande noire** sous l'encoche, invisible au navigateur et flagrante sur un
téléphone. Trois endroits doivent rester alignés : `html { background-color }`,
`<meta name="theme-color">` et les couleurs du manifeste.

`npm run check:notch` mesure les pixels réellement peints et refuse un écart
visible, plutôt que de faire confiance à la feuille de style.

## Mode en ligne

### Comment ça marche

Tous les appareils rejouent le **même journal d'actions append-only** à travers
le moteur pur : états, scores et animations sont identiques par construction.
Les départs (abandons, exclusions) sont eux-mêmes des actions du journal, donc
appliqués au même moment partout.

Flip Sprint retourne toutes ses cartes face visible, donc **le seul secret est
l'ordre de la pioche**. Il vit dans un sous-arbre `secrets/` illisible en bloc ;
une valeur ne devient publique qu'incluse dans une action, et les règles
vérifient qu'elle correspond au secret.

### Ce que les règles de sécurité garantissent

- seul un joueur assis peut lire ou écrire une partie ;
- les sièges se prennent un par un, restent contigus, et le nombre de joueurs
  est figé au démarrage ;
- le journal est **append-only** : une écriture doit utiliser exactement la clé
  `state.next`, et une action inscrite ne peut jamais être modifiée ;
- seul `state.actor` peut jouer — et pendant une Rafale, c'est sa cible, pas le
  joueur dont c'est le tour ;
- le type d'action doit correspondre à la phase en cours ;
- la valeur d'une carte doit être égale au secret qu'elle prétend révéler, et un
  client ne peut lire **qu'une seule carte à la fois** : celle que son propre
  marqueur désigne, et seulement pendant qu'il est l'acteur ;
- un coureur ne peut être exclu qu'après **60 secondes d'absence réelle**, ou
  après avoir signé lui-même son départ ;
- le **jeu de règles est figé** dans le salon : le paquet en découle, il ne peut
  donc pas changer une fois une carte distribuée.

Une limite à connaître sur la variante Coups bas : ses cartes désignent une
carte précise dans un couloir, or la base ne stocke **que le journal d'actions**
— elle n'a jamais vu un couloir. Elle vérifie donc qui parle et à quel moment,
mais pas que la carte désignée s'y trouve vraiment. Cette légalité-là est
attrapée par le rejeu de chaque appareil, qui marque la partie corrompue plutôt
que de l'accepter : un coup forgé est **détecté partout, pas silencieusement
exploitable**. C'est le même compromis que le client qui mélange le paquet,
décrit juste en dessous.

`npm run test:rules` lance **34 sondes** contre l'émulateur, avec ces règles et
de vraies identités de joueurs — chacune correspond à une attaque qu'un client
modifié pourrait réellement tenter. Elles ont déjà trouvé deux failles réelles
avant toute mise en ligne : un joueur sans enregistrement de présence traité
comme absent, et surtout une **propagation de règle** — un `.write` accordé sur
`secrets/{code}` s'appliquait à tous ses descendants, ce qui annulait le verrou
« écrite une seule fois » et permettait de réécrire le paquet en pleine course.

### Limite connue et assumée

Sans serveur, **c'est un client joueur qui mélange le paquet** d'une course : il
en connaît donc transitoirement l'ordre. Dans un jeu de stop-ou-encore, cette
connaissance serait très exploitable par un client modifié — elle dit exactement
quand s'arrêter.

Flip Sprint assume ce compromis : il est fait pour des parties privées entre
gens qui se connaissent, et n'engage aucun service payant. Tout le reste est
verrouillé par les règles ci-dessus. La génération de la donne est isolée dans
`src/online/dealer.ts` : c'est le seul endroit à changer le jour où elle devrait
venir d'une source de confiance (une Cloud Function, sur plan Blaze).

### Configuration Firebase

Le projet est `flip-sprint-live`, et sa configuration web est **déjà renseignée**
dans `src/online/firebase.ts`. Ces valeurs — clé d'API et identifiant
d'application — sont **publiques par nature** : ce sont des identifiants, pas
des secrets, et toute la sécurité vient des règles de la base. Elles peuvent
donc être committées sans risque. Elles restent surchargeables au build via
`VITE_FIREBASE_API_KEY` et `VITE_FIREBASE_APP_ID`.

**Le point critique : les règles doivent être déployées.** Une base laissée en
mode verrouillé est sûre mais totalement inerte — toute lecture et toute
écriture sont refusées, donc le mode en ligne ne se connecte jamais.

```sh
npx firebase login
npx firebase deploy --only database
```

ou, sans outillage : coller le contenu de `database.rules.json` dans
**Console → Realtime Database → Règles → Publier**.

> À refaire après toute modification de `scripts/build-rules.mjs`. Les règles
> publiées ne sont pas versionnées côté Firebase : seul le fichier du dépôt
> fait foi, et lui seul est couvert par les sondes.

Pour savoir où en est le projet réel à tout moment :

```sh
npm run check:live         # connexion anonyme, et règles déployées ou non
npm run check:rules-live   # les règles déployées sont-elles bien CELLES-CI ?
```

Le premier dit si la base répond et si elle est sortie du mode verrouillé. Le
second va plus loin : il crée une partie de test sous un code aléatoire, vérifie
les deux comportements qui distinguent les règles corrigées de celles qu'elles
remplacent — impossible de réécrire un paquet en cours, possible d'effacer une
partie finie — puis efface sa partie. Utile après chaque publication, car
« des » règles déployées ne veut pas dire « les bonnes ».

Enfin, une fois le site publié : **Authentication → Settings → Domaines
autorisés** → ajouter le domaine GitHub Pages.

Tant que la configuration n'est pas renseignée, l'application fonctionne
normalement et le mode en ligne affiche « non configuré ».

Le mode tient confortablement dans le **plan gratuit Spark** : environ 1 Ko par
coup, présence par connexions WebSocket (limite : 100 simultanées), aucun
service payant.

## Développement

```sh
npm install
npm run dev            # http://localhost:8080
```

### Vérifier

```sh
npm test               # moteur, IA, rejeu — 138 tests
npm run lint
npm run build          # typecheck + build de production
npm run smoke          # joue une partie locale entière dans un vrai navigateur
npm run smoke:coupsbas # la même chose sous les règles Coups bas
npm run check:notch    # la zone derrière l'encoche se raccorde-t-elle au plateau ?
npm run check:alerts   # l'annonce d'une carte subie se referme-t-elle seule ?
npm run test:rules     # sondes de sécurité contre l'émulateur
npm run e2e:online     # deux navigateurs, une vraie course en ligne (14 vérifs)
npm run e2e:online:coupsbas  # la même course, sous les règles Coups bas
```

Les deux derniers demandent **Java** (l'émulateur Realtime Database est un
processus JVM) et **Chromium** via Playwright.

### Règles de sécurité

`database.rules.json` est **généré** par `npm run build:rules`. Le langage de
règles RTDB n'a pas de fonctions : chaque contrôle « l'appelant occupe-t-il un
des huit sièges ? » doit être écrit en entier, ce qui donne des kilo-octets de
JSON quasi identique où un mauvais indice serait invisible. Le script est la
source de vérité ; le JSON produit est committé pour qu'un déploiement n'en
dépende jamais.

### Icônes

```sh
npm run generate:icons
```

Écrit les PNG et l'ICO à la main, sans aucune dépendance. À relancer seulement
si le dessin change ; les fichiers produits sont committés.

## Déploiement — GitHub Pages

Le dépôt contient un workflow GitHub Actions qui **build et publie
automatiquement** à chaque push sur `main` (lint → tests → build → Pages).

Configuration **à faire une seule fois** : **Settings → Pages → Source :
« GitHub Actions »**.

Le build utilise un **chemin de base relatif** (`base: "./"`) : le site
fonctionne sous n'importe quel sous-chemin, quel que soit le nom du dépôt.
**Renommer le dépôt ne nécessite aucune modification du code.**

## Technologies

Vite · TypeScript · React · Tailwind CSS · Firebase Realtime Database ·
Vitest · Playwright · vite-plugin-pwa (Workbox)

## Avis / marques

Flip Sprint est un **projet indépendant et non commercial**, développé à titre
personnel. Il **n'est affilié à, ni approuvé ou sponsorisé par aucun éditeur de
jeux**. Les mécaniques de jeu de cartes ne sont pas protégeables en tant que
telles ; cette application n'utilise **aucun nom de marque, logo ou visuel de
tiers** — le nom, l'univers, les textes, les cartes et les icônes sont
originaux. Toute ressemblance avec un jeu du commerce se limite aux règles, qui
relèvent du domaine des idées.

## Licence

MIT — voir [LICENSE](LICENSE).
