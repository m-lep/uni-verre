# UNI.VERRE 🍻

Jeu de plateau apéro multijoueur local : **l'ordinateur est le plateau**, les
**téléphones sont les pions/manettes**. Inspiré d'un plateau fait maison, mais le
plateau est **généré procéduralement** — chaque partie a un plateau différent,
tout en restant cohérent (mêmes familles de cases, sauts valides, cases
signature garanties).

## Lancer

```bash
npm install
npm start
```

- **Écran (PC/TV)** : http://localhost:3018
- **Téléphones** : scannez le QR code affiché au lobby (`http://IP-LOCALE:3018/play`)

Chaque joueur se prend en photo → ça devient son pion sur le plateau.
Le **1er joueur inscrit** (👑) est l'hôte : il peut **régénérer le plateau**
(autant de fois qu'il veut au lobby) et **lancer la partie**.

## Ce qu'on voit

- **Écran** : le plateau spirale, les pions-photos qui avancent, le dé animé,
  une grande bannière à chaque effet (*qui boit, combien*), l'UNI.VERRE central,
  les règles inventées, le mot interdit actif, la bombe qui circule, et un
  panneau par joueur avec **ses gorgées 🍺, shots 🥃 et verres finis 🍻**.
- **Téléphone** : ses stats de la partie **et de la soirée entière**, le bouton
  dé quand c'est son tour, les choix (distribution de gorgées, adversaire de
  duel, mot interdit…), les cartes gardées en main (🛡️ Bouclier, 🪞 Miroir),
  et le gros bouton rouge pour **passer la bombe**.

## Les cases

Boit / distribue / shot / fini ton verre (ou celui du voisin) / tout le monde
boit / UNI.VERRE (+N ou bois N uni.gorgées) / saute & retourne / gel / roulette /
mot interdit / méduse / bras de fer / freeze / imite / invente une règle /
questions chaudes / montre une ficha / dans ma valise / échange de verre /
change de récipient / **Carte Mystère** 🃏 / **Bombe** 💣 / **Duel de dés** ⚔️ /
tu bois pour tous.

À l'arrivée : le premier gagne, **le dernier boit l'UNI.VERRE**.

## Techniquement

- `boardgen.js` — générateur de plateau seedé (46–52 cases, poids/caps par type,
  pas de doublons adjacents, sauts calculés après coup) + paquet de cartes.
- `server.js` — Express + Socket.IO, moteur de tour autoritaire (états
  `pending`, garde-fous anti-blocage, reconnexion par pseudo).
- `public/screen.js` — plateau dessiné en SVG : anneaux rectangulaires arrondis
  concentriques découpés le long du périmètre, dernier anneau partiel (spirale),
  rangée centrale vers l'ARRIVÉE.

Voir `IDEES.md` pour les extensions prévues.

## Mettre en ligne (Render)

Le serveur est prêt pour Render : il écoute `$PORT` et le QR code pointe
automatiquement vers l'URL publique (`RENDER_EXTERNAL_URL` / en-têtes proxy).

1. Pousser ce dossier sur GitHub (dépôt `uni-verre`).
2. Sur [render.com](https://render.com) : **New + → Blueprint** → choisir le
   dépôt → le `render.yaml` fait le reste (service web Node, plan Free).
3. Ouvrir `https://uni-verre-XXXX.onrender.com` sur l'ordi : c'est l'écran ;
   les téléphones scannent le QR comme d'habitude.

À savoir sur le plan Free : le serveur s'endort après ~15 min d'inactivité
(1re visite un peu lente), et il n'héberge **qu'une seule partie à la fois** —
tous ceux qui ouvrent l'URL rejoignent la même table.
