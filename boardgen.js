// Générateur procédural de plateaux UNI.VERRE.
// Chaque plateau est différent (seed) mais reste cohérent : caps par type
// d'effet, pas de doublons adjacents, sauts/retours toujours valides,
// présence garantie des cases "signature" (carte, bombe, méduse…).

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const QUESTIONS = [
  'TON BODYCOUNT ?',
  'TON CRUSH DANS LA PIÈCE ?',
  'LIS TON DERNIER SMS',
  'TA PIRE HONTE ?',
  'TON RED FLAG ?',
  'PIRE DATE DE TA VIE ?',
  'TON DERNIER MENSONGE ?',
  'QUI ICI EMBRASSE LE MIEUX ?',
];

const FICHAS = [
  'MONTRE UNE FICHA',
  'MONTRE TA DERNIÈRE PHOTO',
  'MONTRE TON ÉCRAN VERROUILLÉ',
  'MONTRE TA GALERIE 5 SEC',
];

// type → définition. w = poids, cap = max par plateau, min = minimum garanti.
// n() tire l'intensité de la case.
const TYPES = {
  boit:            { w: 6,   cap: 8, n: r => 2 + Math.floor(r() * 5) },
  distribue:       { w: 6,   cap: 7, n: r => 3 + Math.floor(r() * 4) },
  shot:            { w: 2.5, cap: 4 },
  'fini-verre':    { w: 2,   cap: 3 },
  'fini-droite':   { w: 1,   cap: 1 },
  'fini-gauche':   { w: 1,   cap: 1 },
  'tous-boivent':  { w: 2,   cap: 3, n: r => 2 + Math.floor(r() * 2) },
  'uni-plus':      { w: 3,   cap: 4, n: r => 2 + Math.floor(r() * 3) },
  'uni-gorgees':   { w: 2.5, cap: 4, n: r => 2 + Math.floor(r() * 2) },
  saute:           { w: 2.5, cap: 4 },
  retourne:        { w: 2.5, cap: 4 },
  gel:             { w: 2,   cap: 3 },
  'gel-suivant':   { w: 1.5, cap: 2 },
  roulette:        { w: 1,   cap: 2, n: () => 6 },
  'mot-interdit':  { w: 1.5, cap: 2, min: 1 },
  meduse:          { w: 1.5, cap: 2, min: 1 },
  'bras-de-fer':   { w: 1.5, cap: 2 },
  freeze:          { w: 1.5, cap: 2, n: () => 6 },
  imite:           { w: 1,   cap: 2 },
  'invente-regle': { w: 1.5, cap: 2, min: 1 },
  question:        { w: 2,   cap: 3 },
  'change-recipient': { w: 1, cap: 1 },
  'echange-verre': { w: 1.5, cap: 2 },
  ficha:           { w: 1,   cap: 2 },
  valise:          { w: 1,   cap: 1, n: () => 6 },
  carte:           { w: 5.5, cap: 7, min: 4 },
  duel:            { w: 2,   cap: 3, min: 1 },
  'bois-pour-tous':{ w: 1,   cap: 1 },
  compliments:     { w: 1.5, cap: 2 },
};

function makeCell(type, rnd) {
  const def = TYPES[type];
  const n = def.n ? def.n(rnd) : 0;
  const c = { type, n };
  switch (type) {
    case 'boit': c.label = `BOIT ${n} GORGÉES`; c.icon = '🍺'; break;
    case 'distribue': c.label = `DISTRIBUE ${n} GORGÉES`; c.icon = '🫗'; break;
    case 'shot': c.label = 'BOIT 1 SHOT'; c.icon = '🥃'; break;
    case 'fini-verre': c.label = 'FINI TON VERRE'; c.icon = '🍻'; break;
    case 'fini-droite': c.label = 'FINI LE VERRE À TA DROITE'; c.icon = '👉'; break;
    case 'fini-gauche': c.label = 'FINI LE VERRE À TA GAUCHE'; c.icon = '👈'; break;
    case 'tous-boivent': c.label = `TOUT LE MONDE BOIT ${n}`; c.icon = '🌍'; break;
    case 'uni-plus': c.label = `+${n} POUR L'UNI.VERRE`; c.icon = '🏺'; break;
    case 'uni-gorgees': c.label = `BOIT ${n} UNI.GORGÉES`; c.icon = '🌀'; break;
    case 'saute': c.label = 'SAUTE …'; c.icon = '⏩'; break;
    case 'retourne': c.label = 'RETOURNE …'; c.icon = '⏪'; break;
    case 'gel': c.label = 'GEL — 1 TOUR'; c.icon = '❄️'; break;
    case 'gel-suivant': c.label = 'GEL LE SUIVANT'; c.icon = '🧊'; break;
    case 'roulette': c.label = `TOURNE 6 TOURS ET ${n} GORGÉES`; c.icon = '💫'; break;
    case 'mot-interdit': c.label = 'MOT INTERDIT'; c.icon = '🤫'; break;
    case 'meduse': c.label = 'MÉDUSE POUR 1 SHOT'; c.icon = '🪼'; break;
    case 'bras-de-fer': c.label = 'BRAS DE FER POUR 1 SHOT'; c.icon = '💪'; break;
    case 'freeze': c.label = `FREEZE POUR ${n} GORGÉES`; c.icon = '🥶'; break;
    case 'imite': c.label = "IMITE QUELQU'UN ICI"; c.icon = '🎭'; break;
    case 'invente-regle': c.label = 'INVENTE UNE RÈGLE'; c.icon = '📜'; break;
    case 'question': c.label = QUESTIONS[Math.floor(rnd() * QUESTIONS.length)]; c.icon = '❓'; break;
    case 'change-recipient': c.label = 'CHANGE DE RÉCIPIENT'; c.icon = '🏆'; break;
    case 'echange-verre': c.label = 'ÉCHANGE DE VERRE'; c.icon = '🔄'; break;
    case 'ficha': c.label = FICHAS[Math.floor(rnd() * FICHAS.length)]; c.icon = '📸'; break;
    case 'valise': c.label = `DANS MA VALISE — ${n} GORGÉES`; c.icon = '🧳'; break;
    case 'carte': c.label = 'PIOCHE UNE CARTE'; c.icon = '🃏'; break;
    case 'compliments': c.label = 'COMPLIMENT SINCÈRE À CHACUN'; c.icon = '💝'; break;
    case 'duel': c.label = 'DUEL DE DÉS'; c.icon = '⚔️'; break;
    case 'bois-pour-tous': c.label = 'TU BOIS POUR TOUS PENDANT 1 TOUR'; c.icon = '🐫'; break;
  }
  return c;
}

function generateBoard(seed) {
  const rnd = mulberry32(seed);
  const N = 46 + Math.floor(rnd() * 7); // 46..52 cases
  const cells = new Array(N);
  cells[0] = { type: 'depart', label: 'DÉPART', icon: '🏁', n: 0 };
  cells[N - 1] = { type: 'arrivee', label: 'ARRIVÉE', icon: '🏆', n: 0 };

  const counts = {};
  const keys = Object.keys(TYPES);

  function pick(i) {
    const prev1 = cells[i - 1] && cells[i - 1].type;
    const prev2 = cells[i - 2] && cells[i - 2].type;
    let pool = keys.filter(k => {
      if ((counts[k] || 0) >= TYPES[k].cap) return false;
      if (k === prev1 || k === prev2) return false;
      // les sauts avant ont besoin de place devant, les retours de place derrière
      if (k === 'saute' && i > N - 6) return false;
      if (k === 'retourne' && i < 5) return false;
      // pas de grosse case punitive dès la case 1
      if (i === 1 && (k === 'shot' || k === 'fini-verre')) return false;
      return true;
    });
    if (!pool.length) pool = ['boit'];
    let total = 0;
    for (const k of pool) total += TYPES[k].w;
    let t = rnd() * total;
    for (const k of pool) { t -= TYPES[k].w; if (t <= 0) return k; }
    return pool[pool.length - 1];
  }

  for (let i = 1; i < N - 1; i++) {
    const type = pick(i);
    counts[type] = (counts[type] || 0) + 1;
    cells[i] = makeCell(type, rnd);
  }

  // garanties : les cases signature doivent exister au moins `min` fois
  for (const k of keys) {
    const min = TYPES[k].min || 0;
    while ((counts[k] || 0) < min) {
      // remplace une case générique (boit/distribue) au hasard
      const generic = [];
      for (let i = 1; i < N - 1; i++) {
        if ((cells[i].type === 'boit' || cells[i].type === 'distribue') &&
            cells[i - 1].type !== k && cells[i + 1].type !== k) generic.push(i);
      }
      if (!generic.length) break;
      const i = generic[Math.floor(rnd() * generic.length)];
      counts[cells[i].type]--;
      counts[k] = (counts[k] || 0) + 1;
      cells[i] = makeCell(k, rnd);
    }
  }

  // cibles des sauts / retours (calculées après coup pour rester valides)
  for (let i = 1; i < N - 1; i++) {
    const c = cells[i];
    if (c.type === 'saute') {
      c.target = Math.min(N - 2, i + 3 + Math.floor(rnd() * 6));
      // éviter d'atterrir sur un autre déplacement (limite les chaînes)
      if (cells[c.target] && (cells[c.target].type === 'saute' || cells[c.target].type === 'retourne')) {
        c.target = Math.min(N - 2, c.target + 1);
      }
      c.label = `SAUTE À LA CASE ${c.target + 1}`;
    } else if (c.type === 'retourne') {
      c.target = Math.max(1, i - (3 + Math.floor(rnd() * 6)));
      if (cells[c.target] && (cells[c.target].type === 'saute' || cells[c.target].type === 'retourne')) {
        c.target = Math.max(1, c.target - 1);
      }
      c.label = `RETOURNE CASE ${c.target + 1}`;
    }
  }

  return { seed, cells };
}

// ——— Cartes Mystère ———
// Chaque joueur démarre avec 2 cartes ; la case 🃏 en fait piocher une.
// kind: instant (effet immédiat), window (proposée quand on reçoit à boire,
// valable sur la dernière boisson reçue). needs: ce que le joueur doit choisir avant de jouer la carte.
// anonymous: l'écran ne dit pas qui l'a jouée.
const CARDS = [
  { id: 'tous2', kind: 'instant', title: 'SANTÉ GÉNÉRALE', text: 'Tout le monde boit 2 gorgées, toi compris', icon: '🌍', count: 3 },
  { id: 'dist5', kind: 'instant', title: 'GÉNÉREUX', text: 'Distribue 5 gorgées aux autres joueurs, comme tu veux', icon: '🫗', count: 3, needs: 'alloc' },
  { id: 'uni4', kind: 'instant', title: 'OFFRANDE', text: "Verse 4 doses dans l'UNI.VERRE (le dernier le boira)", icon: '🏺', count: 2 },
  { id: 'turbo', kind: 'instant', title: 'TURBO', text: "Avance de 3 cases, sans appliquer l'effet de la case (ne mène jamais sur l'arrivée)", icon: '🚀', count: 3 },
  { id: 'premier3', kind: 'instant', title: 'IMPÔT SUR LA FORTUNE', text: 'Le joueur le plus avancé du plateau boit 3 gorgées (même si c\'est toi)', icon: '👑', count: 2 },
  { id: 'dernier3', kind: 'instant', title: 'DOUBLE PEINE', text: 'Le joueur le moins avancé du plateau boit 3 gorgées (même si c\'est toi)', icon: '🐢', count: 2 },
  { id: 'putsch', kind: 'instant', title: 'PUTSCH', text: 'Échange ta place avec un joueur encore en course tiré au hasard (sans effet de case)', icon: '♟️', count: 2 },
  { id: 'bombe', kind: 'instant', title: 'BOMBE PIÉGÉE', text: 'Pose une bombe sur une case vide : le premier qui s\'y arrête boit 1 shot', icon: '💣', count: 3, needs: 'cell', anonymous: true },
  { id: 'menottes', kind: 'instant', title: 'MENOTTES', text: 'Lie deux joueurs pendant 1 tour de table : quand l\'un boit, l\'autre boit autant', icon: '⛓️', count: 2, needs: 'pair', anonymous: true },
  { id: 'vol', kind: 'instant', title: 'VOL À LA TIRE', text: 'Vole une carte au hasard à un joueur. S\'il n\'en a pas : raté, pas de seconde chance', icon: '🕵️', count: 3, needs: 'player', anonymous: true },
  { id: 'corbeau', kind: 'instant', title: 'CORBEAU', text: 'Écris un message anonyme, puis envoie-le à l\'écran quand tu veux (plus tard si tu préfères)', icon: '💌', count: 2, needs: 'message', anonymous: true },
  { id: 'rejoue', kind: 'instant', title: 'REJOUE', text: 'À jouer à ton tour, avant de lancer le dé : tu enchaîneras un deuxième tour complet', icon: '🔁', count: 2 },
  { id: 'ancre', kind: 'instant', title: 'ANCRE', text: 'Le prochain lancer de dé du joueur visé est divisé par deux', icon: '⚓', count: 2, needs: 'player' },
  { id: 'bouclier', kind: 'window', title: 'BOUCLIER', text: 'Quand tu reçois à boire, annule tout ce que tu viens de recevoir', icon: '🛡️', count: 2 },
  { id: 'miroir', kind: 'window', title: 'MIROIR', text: 'Quand tu reçois à boire, renvoie tout sur le joueur de ton choix', icon: '🪞', count: 2, needs: 'player' },
];

function makeDeck(seed) {
  const rnd = mulberry32(seed ^ 0xbeef);
  const deck = [];
  for (const c of CARDS) for (let k = 0; k < (c.count || 1); k++) deck.push(c);
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

module.exports = { generateBoard, makeDeck, mulberry32, CARDS };
