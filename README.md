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

## Fonctionnalités

- **Moteur de jeu pur et testé** (`src/game/`) : toutes les règles vivent dans
  un réducteur pur, sans React, sans timer et sans hasard ambiant. Couvert par
  94 tests, dont 1050 parties aléatoires de 2 à 8 coureurs qui vérifient à
  chaque transition la conservation des 94 cartes, l'absence de doublon dans un
  couloir, la terminaison et le déterminisme.
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
- **Sons synthétisés** (Web Audio, aucun fichier audio) et **retour haptique**,
  désactivables.
- **Statistiques** locales et **écran de règles** illustré avec les vraies cartes.

## Architecture

```
src/game/      moteur pur : types, deck, engine, scoring, odds, ai, settings,
               stats, persistence, copy (tous les textes)
src/online/    protocol · dealer · replay · client (RTDB) · firebase · session
src/hooks/     useGame (solo & local, pilote l'IA) · useOnlineGame
src/ui/        Card, Lane, RiskGauge, GameScreen, Overlays, écrans
scripts/       generate-icons · build-rules · emulators · test-rules ·
               e2e-online · smoke-local · screenshot
database.rules.json   règles de sécurité RTDB (généré, voir plus bas)
```

Les **cartes sont dessinées en CSS** (`src/ui/Card.tsx`, couleurs dans
`src/ui/theme.ts`) : aucune image n'est chargée, le rendu est net à toutes les
tailles et le poids hors-ligne est quasi nul. Les numéros sont colorés par le
**risque** — bleu calme (0-4), ambre (5-8), magenta incandescent (9-12).

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
  après avoir signé lui-même son départ.

`npm run test:rules` lance **29 sondes** contre l'émulateur, avec ces règles et
de vraies identités de joueurs — chacune correspond à une attaque qu'un client
modifié pourrait réellement tenter.

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

Pour savoir où en est le projet réel à tout moment :

```sh
npm run check:live
```

Il vérifie la connexion anonyme et dit si les règles du dépôt sont bien en
place ou si la base tourne encore en mode verrouillé.

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
npm test               # moteur, IA, rejeu — 94 tests
npm run lint
npm run build          # typecheck + build de production
npm run smoke          # joue une partie locale entière dans un vrai navigateur
npm run test:rules     # 29 sondes de sécurité contre l'émulateur
npm run e2e:online     # deux navigateurs, une vraie course en ligne
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
