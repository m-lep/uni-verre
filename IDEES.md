# Idées d'extensions — UNI.VERRE

## Déjà dans le jeu (v1)
- 🃏 **Cartes en main** : 2 au départ + cases pioche, jouables à tout moment,
  jamais mauvaises pour soi ; fourberies anonymes (💣 bombe piégée sur case
  vide, ⛓️ menottes, 🕵️ vol) et défenses 🛡️/🪞 (fenêtre 9 s).
- 🪑 **Places à table tactiles** au lobby : chacun tape sa place, l'ordre de
  jeu et les voisins droite/gauche suivent la vraie table.
- ⚖️ **Majorité pour tout** : bras de fer, freeze (armé 1 tour, bouton ⚡),
  méduse (chacun déclare qui il a regardé, paires mutuelles = shot),
  imitation notée 0–5⭐, valise, compliments, procès du mot interdit (affiché
  à l'écran 1 tour).
- 🔊 **Ambiance** : sons synthétisés, voix TTS (méduse/freeze), confettis,
  explosion + tremblement d'écran, vibration du tel quand tu bois.
- ⚔️ **Duel de dés** : le perdant boit la différence.
- 📜 **Règles inventées** affichées à l'écran pendant 1 tour.
- 🏺 **UNI.VERRE vivant** : compteur central, cases qui le remplissent ou le
  vident, le dernier du plateau le boit à la fin.
- 🗳️ **Vote « on le tèj ou on attend ? »** : joueur déconnecté à son tour ou
  inactif 45 s → tout le monde vote sur son téléphone. Tèj un déconnecté =
  mis de côté jusqu'à sa reconnexion ; égalité ou pas de vote en 30 s = tèj.
- Stats **partie + soirée entière** par joueur (gorgées, shots, verres finis).

## À ajouter ensuite (par ordre de fun/effort)

### Petit effort, gros fun
1. **Mini-jeux sur téléphone pour départager** : au lieu de « qui a perdu le
   freeze ? », un vrai réflexe-game (le premier qui tape quand l'écran passe au
   vert, shake-o-mètre, tape-la-taupe 10 s). Le perdant est décidé par le jeu,
   plus de mauvaise foi.
2. **Roue de la fortune** en case spéciale : la roue tourne à l'écran
   (gorgées ×2, immunité, shot, « tout le monde sauf toi »…).
3. **Sons** : dé, explosion, fanfare d'arrivée, « glou glou » quand quelqu'un
   boit (WebAudio, zéro dépendance).
4. **Votes** : case « Qui est le plus susceptible de… ? » — tout le monde vote
   sur son téléphone, le plus cité boit. Les questions défilent à l'écran.
5. **Thèmes de plateau** : le générateur a déjà un seed — ajouter des palettes
   (néon, tropical, casino, western) et un nom de plateau généré
   (« La Spirale de la Soif n°4832 »).

### Effort moyen
6. **Équipes** : 2v2v2, stats d'équipe, cases « ton coéquipier boit pour toi ».
7. **Mode Route de la Soif** : plateau infini qui se génère en avançant,
   la partie dure X minutes au lieu d'une course à l'arrivée.
8. **Paris** : avant chaque lancer de dé, les autres peuvent parier 1 gorgée
   sur pair/impair. Bien parié = tu donnes, mal parié = tu bois.
9. **Cases jumelles** : deux cases liées — quand quelqu'un tombe sur l'une,
   celui qui est sur l'autre trinque aussi.
10. **Historique/records de soirée** : sauvegarder les totaux dans un fichier
    JSON, écran « Hall of Fame » (le plus gros buveur, le plus gelé, la plus
    grosse bombe prise…).

### Ambitieux
11. **Éditeur de plateau** : l'hôte peut, au lobby, verrouiller des cases qu'il
    aime avant de régénérer le reste (le générateur respecte les cases fixées).
12. **Mode caméra** : la méduse filmée par la webcam du PC avec un compte à
    rebours et un gel d'image pour vérifier les regards.
13. **Twitch du salon** : un spectateur peut scanner un 2e QR « spectateur » et
    envoyer des malus payés en gorgées virtuelles.

## Notes de design
- Garder le rythme : jamais plus d'un choix téléphone par tour, les effets
  auto s'enchaînent avec bannière ~4 s.
- Les cases « sociales » (imite, question…) doivent rester majoritairement à
  l'honneur : le jeu affiche, les humains tranchent.
- Boire de l'eau existe aussi. 💧
