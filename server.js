const express = require('express');
const http = require('http');
const os = require('os');
const path = require('path');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { generateBoard, makeDeck, CARDS } = require('./boardgen');

// Render (et la plupart des hébergeurs) imposent leur port via $PORT
const PORT = parseInt(process.env.PORT, 10) || 3018;

const app = express();
const server = http.createServer(app);
// maxHttpBufferSize élargi pour laisser passer les photos d'avatar (dataURL)
const io = new Server(server, { maxHttpBufferSize: 5e6 });

app.use(express.static(path.join(__dirname, 'public')));
app.get('/', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'screen.html')));
app.get('/play', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'controller.html')));

function lanIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

app.get('/state', (_req, res) => {
  res.json({
    snapshot: snapshot(),
    awaitingAnim: game ? game.awaitingAnim || null : null,
    fullPending: game ? game.pending : null,
    collect: game ? game.collect : null,
  });
});

app.get('/info', async (req, res) => {
  // en local : IP du réseau pour que les téléphones du salon se connectent ;
  // hébergé (Render…) : l'URL publique vue par le navigateur de l'écran
  const host = req.headers.host || '';
  let base;
  if (process.env.RENDER_EXTERNAL_URL) {
    base = process.env.RENDER_EXTERNAL_URL;
  } else if (/^(localhost|127\.|0\.0\.0\.0)/.test(host)) {
    base = `http://${lanIP()}:${PORT}`;
  } else {
    const proto = req.headers['x-forwarded-proto'] || 'http';
    base = `${proto}://${host}`;
  }
  const url = `${base.replace(/\/$/, '')}/play`;
  const qr = await QRCode.toDataURL(url, { width: 360, margin: 1 });
  res.json({ url, qr });
});

// ——————————————————— État du jeu (serveur autoritaire) ———————————————————

const COLORS = ['#4fc3f7', '#ff8a65', '#aed581', '#ba68c8', '#ffd54f', '#f06292', '#4db6ac', '#a1887f'];
const BANNER_MS = 4200;
const SEATS = 12; // places autour de la table du lobby
// délais (surchageables pour les tests)
const IDLE_MS = parseInt(process.env.IDLE_MS, 10) || 45000; // inactivité avant vote tèj
const VOTE_MS = parseInt(process.env.VOTE_MS, 10) || 30000; // durée max d'un vote tèj
const WAIT_MS = parseInt(process.env.WAIT_MS, 10) || 45000; // délai avant re-vote après « on attend »
const COLLECT_MS = { // durée max des décisions collectives
  meduse: 30000, accusation: 25000, bdf: 30000, freeze: 30000,
  valise: 90000, imite: 45000, compliments: 60000, pret: 45000,
};
for (const k of Object.keys(COLLECT_MS)) {
  if (process.env.COLLECT_MS) COLLECT_MS[k] = parseInt(process.env.COLLECT_MS, 10);
}

let seed = Math.floor(Math.random() * 1e9);
let game = null;
const lobbySettings = { noShots: false }; // réglé par l'hôte au lobby
let players = []; // persiste entre les parties
let nextPlayerId = 1;

function freshBoard() {
  seed = Math.floor(Math.random() * 1e9);
  return generateBoard(seed);
}

let lobbyBoard = freshBoard();

function resetGame() {
  game = null;
  for (const p of players) {
    p.pos = 0; p.gorgees = 0; p.shots = 0; p.finis = 0;
    p.frozen = 0; p.hand = []; p.boitPourTous = false; p.benched = false;
    p.corbeau = null; p.ancre = false; p.finished = false;
  }
}

function publicPlayer(p) {
  return {
    id: p.id, name: p.name, avatar: p.avatar, color: p.color, online: p.online,
    seat: p.seat === undefined ? null : p.seat,
    pos: p.pos || 0, gorgees: p.gorgees || 0, shots: p.shots || 0, finis: p.finis || 0,
    frozen: p.frozen || 0, boitPourTous: !!p.boitPourTous, benched: !!p.benched,
    ancre: !!p.ancre, finished: !!p.finished,
    handCount: (p.hand || []).length,
    totalGorgees: p.totalGorgees || 0, totalShots: p.totalShots || 0,
  };
}

function snapshot() {
  const collect = game && game.collect ? {
    purpose: game.collect.purpose,
    prompt: game.collect.prompt,
    meta: game.collect.publicMeta || null,
    waitingIds: game.collect.playerIds.filter(id => !(id in game.collect.answers)),
    answered: Object.keys(game.collect.answers).length,
    total: game.collect.playerIds.length,
  } : null;
  return {
    phase: game ? game.phase : 'lobby',
    board: game ? game.board.cells : lobbyBoard.cells,
    seed: game ? game.board.seed : lobbyBoard.seed,
    players: players.map(publicPlayer),
    seats: SEATS,
    order: game ? game.order : seatedOrder().map(p => p.id),
    turn: game ? game.order[game.turnIdx] : null,
    pending: game ? publicPending() : null,
    collect,
    uniVerre: game ? game.uniVerre : 0,
    rules: game ? game.rules.map(r => ({ by: r.by, text: r.text })) : [],
    motInterdit: game && game.motInterdit ? { by: game.motInterdit.by, word: game.motInterdit.word } : null,
    freeze: game && game.freeze ? { by: game.freeze.by, n: game.freeze.n } : null,
    chains: game ? game.chains.map(c => ({ a: c.a, b: c.b })) : [],
    traps: game ? game.traps.map(t => t.cell) : [],
    corbeaux: game ? game.corbeaux.map(c => c.text) : [],
    noShots: game ? game.noShots : lobbySettings.noShots,
    vote: game && game.vote ? {
      targetId: game.vote.targetId,
      reason: game.vote.reason,
      tej: Object.values(game.vote.votes).filter(x => x === 'tej').length,
      wait: Object.values(game.vote.votes).filter(x => x === 'wait').length,
      total: game.vote.voters.length,
    } : null,
    ranking: game && game.phase === 'over' ? game.ranking : null,
  };
}

function publicPending() {
  if (!game.pending) return null;
  const { type, playerId, purpose, options, n, allowNone, label } = game.pending;
  return { type, playerId, purpose: purpose || null, options: options || null, n: n || 0, allowNone: !!allowNone, label: label || null };
}

function seatedOrder() {
  return players.filter(p => p.seat !== null && p.seat !== undefined)
    .sort((a, b) => a.seat - b.seat);
}

function broadcast() {
  io.to('screens').emit('game', snapshot());
  for (const p of players) {
    if (p.socketId) io.to(p.socketId).emit('you', personal(p));
  }
}

function personal(p) {
  const snap = snapshot();
  const c = game && game.collect;
  return {
    ...snap,
    me: publicPlayer(p),
    hand: (p.hand || []).map(x => ({ id: x.id, title: x.title, text: x.text, icon: x.icon, kind: x.kind, needs: x.needs || null })),
    myTurn: snap.turn === p.id,
    myPending: game && game.pending && game.pending.playerId === p.id ? publicPending() : null,
    myCollect: c && c.playerIds.includes(p.id) && !(p.id in c.answers)
      ? { purpose: c.purpose, prompt: c.prompt, meta: c.publicMeta || null } : null,
    isHost: players[0] && players[0].id === p.id,
    freezeMine: !!(game && game.freeze && game.freeze.by === p.id),
    myCorbeau: p.corbeau || null,
    shieldWindow: !!(p.lastDrink && !p.lastDrink.used),
    myLastDrink: p.lastDrink && !p.lastDrink.used
      ? { g: p.lastDrink.g, s: p.lastDrink.s, source: p.lastDrink.source, ts: p.lastDrink.ts } : null,
    myVote: game && game.vote ? (game.vote.votes[p.id] || null) : null,
    isVoter: !!(game && game.vote && game.vote.voters.includes(p.id)),
    allSeated: players.length >= 2 && players.every(x => x.seat !== null && x.seat !== undefined),
  };
}

function event(ev) {
  io.to('screens').emit('event', ev);
  io.to('controllers').emit('event', ev);
}

function byId(id) { return players.find(p => p.id === id); }

// ——— attribution de gorgées / shots ———
// gère : mode sans shots (1 shot → 5 gorgées), « X boit pour tout le monde »
// (redirection vers le chameau 🐫), menottes, fenêtre bouclier/miroir
function applyDrink(p, { g = 0, s = 0, fini = 0 }, sourceLabel, viaChain, viaRedirect) {
  if (game && game.noShots && s > 0) { g += s * 5; s = 0; }
  if (!viaRedirect && game && game.phase === 'playing' && (g > 0 || s > 0 || fini > 0)) {
    const camel = players.find(x => x.boitPourTous && x.id !== p.id);
    if (camel) {
      event({ kind: 'drink', icon: '🐫', playerId: camel.id, text: `${camel.name} boit à la place de ${p.name} !` });
      return applyDrink(camel, { g, s, fini }, `${sourceLabel} (pour ${p.name})`, viaChain, true);
    }
  }
  p.gorgees += g; p.shots += s; p.finis += fini;
  p.totalGorgees = (p.totalGorgees || 0) + g;
  p.totalShots = (p.totalShots || 0) + s;
  if (g > 0 || s > 0) {
    p.lastDrink = { g, s, ts: Date.now(), used: false, source: sourceLabel };
    // menottes : le partenaire boit autant
    if (!viaChain && game && game.chains) {
      for (const c of game.chains) {
        const otherId = c.a === p.id ? c.b : c.b === p.id ? c.a : null;
        const partner = otherId !== null ? byId(otherId) : null;
        if (partner) {
          applyDrink(partner, { g, s }, 'Menottes ⛓️', true, false);
          event({ kind: 'drink', icon: '⛓️', playerId: partner.id, text: `Menottes ! ${partner.name} boit autant que ${p.name}` });
        }
      }
    }
  }
}

// ——————————————————— Moteur de tour ———————————————————

let timers = [];
function after(ms, fn) {
  const t = setTimeout(() => { timers = timers.filter(x => x !== t); fn(); }, ms);
  timers.push(t);
}
function clearTimers() { timers.forEach(clearTimeout); timers = []; }

function draw() {
  if (!game.deck.length) {
    game.deck = game.discard.filter(Boolean);
    game.discard = [];
    for (let i = game.deck.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [game.deck[i], game.deck[j]] = [game.deck[j], game.deck[i]];
    }
  }
  return game.deck.pop();
}

function startGame() {
  resetGame();
  game = {
    phase: 'playing',
    board: lobbyBoard,
    order: seatedOrder().map(p => p.id),
    turnIdx: -1,
    uniVerre: 0,
    rules: [],       // {by, byId, text, expiresOnTurnOf}
    deck: makeDeck(lobbyBoard.seed),
    discard: [],
    pending: null,
    collect: null,
    motInterdit: null, // {by, word}
    freeze: null,      // {by, n}
    chains: [],        // {a, b, expiresOnTurnOf}
    traps: [],         // {cell}
    corbeaux: [],      // {text, expiresOnTurnOf} — messages anonymes envoyés
    extraTurn: null,   // id du joueur qui rejoue (carte REJOUE)
    vote: null,
    chainDepth: 0,
    noShots: lobbySettings.noShots,
    finishOrder: [], // ids dans l'ordre d'arrivée
  };
  // chaque joueur démarre avec 2 cartes en main
  for (const p of players) p.hand = [draw(), draw()];
  if (game.noShots) {
    after(1300, () => event({ kind: 'status', icon: '🚫', voice: true, text: 'Mode sans shots : chaque shot vaut 5 gorgées !' }));
  }
  // DEV_DEAL=corbeau,rejoue : force ces cartes en main (tests uniquement)
  if (process.env.DEV_DEAL) {
    const ids = process.env.DEV_DEAL.split(',');
    for (const p of players) for (const id of ids) {
      const def = CARDS.find(c => c.id === id.trim());
      if (def) p.hand.push(def);
    }
  }
  broadcast();
  after(1200, nextTurn);
}

function nextTurn() {
  if (!game || game.phase !== 'playing') return;
  game.chainDepth = 0;
  // carte REJOUE : le même joueur enchaîne un tour complet
  let p = null, isExtra = false;
  const extra = game.extraTurn ? byId(game.extraTurn) : null;
  game.extraTurn = null;
  if (extra && extra.online && !extra.benched && !extra.finished) {
    p = extra; isExtra = true; // turnIdx est déjà sur lui
  } else {
    game.turnIdx = (game.turnIdx + 1) % game.order.length;
    p = byId(game.order[game.turnIdx]);
  }
  if (!p) return nextTurn();
  if (p.finished) return nextTurn(); // déjà à l'arrivée : plus de tours

  // expiration des statuts « 1 tour complet » liés à ce joueur
  // (pas pendant un tour bonus : REJOUE ne doit pas raccourcir ses effets)
  if (!isExtra) {
    // menottes et corbeaux durent un tour de table complet
    for (const c of game.chains) c.turnsLeft--;
    if (game.chains.some(c => c.turnsLeft <= 0)) {
      game.chains = game.chains.filter(c => c.turnsLeft > 0);
      event({ kind: 'info', icon: '⛓️', text: 'Des menottes se déverrouillent' });
    }
    for (const c of game.corbeaux) c.turnsLeft--;
    game.corbeaux = game.corbeaux.filter(c => c.turnsLeft > 0);
  }
  if (!isExtra && game.motInterdit && game.motInterdit.by === p.id) {
    event({ kind: 'info', icon: '🤫', text: `Le mot interdit « ${game.motInterdit.word} » expire, personne ne s'est fait avoir` });
    game.motInterdit = null;
  }
  if (!isExtra && game.freeze && game.freeze.by === p.id) game.freeze = null;
  const expRules = isExtra ? [] : game.rules.filter(r => r.expiresOnTurnOf === p.id);
  if (expRules.length) {
    game.rules = game.rules.filter(r => r.expiresOnTurnOf !== p.id);
    event({ kind: 'info', icon: '📜', text: `La règle de ${p.name} expire` });
  }
  if (p.boitPourTous) p.boitPourTous = false;

  if (p.frozen > 0) {
    p.frozen--;
    event({ kind: 'skip', icon: '❄️', playerId: p.id, text: `${p.name} est gelé·e et passe son tour` });
    broadcast();
    after(2600, nextTurn);
    return;
  }
  if (!p.online) {
    if (p.benched) {
      event({ kind: 'skip', icon: '🚪', playerId: p.id, text: `${p.name} est tèj, on passe` });
      broadcast();
      after(2000, nextTurn);
      return;
    }
    startVote(p, 'offline');
    return;
  }
  game.pending = { type: 'roll', playerId: p.id };
  broadcast();
  armIdleGuard();
}

// garde-fou : si le joueur tenu de jouer ne fait rien, on déclenche un vote tèj
function armIdleGuard(ms = IDLE_MS) {
  if (!game || !game.pending) return;
  const stamp = Date.now() + Math.random();
  game.pending.stamp = stamp;
  after(ms, () => {
    if (game && game.phase === 'playing' && game.pending &&
        game.pending.stamp === stamp && !game.vote && !game.collect) {
      const p = byId(game.pending.playerId);
      if (p) startVote(p, 'idle');
    }
  });
}

// ——— Vote « on le tèj ou on attend ? » ———
function startVote(target, reason) {
  if (!game || game.phase !== 'playing' || game.vote) return;
  const voters = players.filter(x => x.online && x.id !== target.id).map(x => x.id);
  if (!voters.length) return applyTej(target, reason);
  const stamp = Date.now() + Math.random();
  game.vote = { targetId: target.id, reason, votes: {}, voters, stamp };
  event({ kind: 'action', icon: '🗳️', playerId: target.id, text: reason === 'offline'
    ? `${target.name} est déconnecté·e — on l'attend ou on le tèj ? Votez sur vos téléphones !`
    : `${target.name} ne joue pas — on l'attend ou on le tèj ? Votez sur vos téléphones !` });
  broadcast();
  after(VOTE_MS, () => { if (game && game.vote && game.vote.stamp === stamp) finishVote(); });
}

function cancelVoteFor(p) {
  if (game && game.vote && game.vote.targetId === p.id) {
    game.vote = null;
    event({ kind: 'info', icon: '✨', playerId: p.id, text: `${p.name} est là, le vote est annulé !` });
  }
}

function finishVote() {
  const v = game.vote;
  if (!v) return;
  game.vote = null;
  const vals = Object.values(v.votes);
  const tej = vals.filter(x => x === 'tej').length;
  const wait = vals.filter(x => x === 'wait').length;
  const target = byId(v.targetId);
  if (!target) return nextTurn();
  if (tej >= wait) {
    applyTej(target, v.reason, `${tej} tèj / ${wait} attend`);
  } else {
    event({ kind: 'info', icon: '⏳', playerId: target.id, text: `On attend ${target.name} (${wait} attend / ${tej} tèj)` });
    broadcast();
    if (v.reason === 'offline') {
      const stamp = Date.now() + Math.random();
      game.waitStamp = stamp;
      after(WAIT_MS, () => {
        if (game && game.phase === 'playing' && game.waitStamp === stamp) {
          const t = byId(v.targetId);
          if (!t) return;
          if (t.online) { game.pending = { type: 'roll', playerId: t.id }; broadcast(); armIdleGuard(); }
          else startVote(t, 'offline');
        }
      });
    } else {
      armIdleGuard();
    }
  }
}

function applyTej(target, reason, tally) {
  const score = tally ? ` (${tally})` : '';
  if (reason === 'offline') {
    target.benched = true;
    event({ kind: 'status', icon: '🚪', playerId: target.id, text: `${target.name} est tèj${score} — il/elle reviendra en se reconnectant` });
  } else {
    event({ kind: 'status', icon: '🚪', playerId: target.id, text: `${target.name} est tèj pour ce tour${score} !` });
  }
  game.pending = null;
  broadcast();
  after(2000, nextTurn);
}

// ——— Décisions collectives (majorité, notes, méduse…) ———
function startCollect(purpose, playerIds, meta, prompt, publicMeta) {
  if (!game || game.phase !== 'playing') return;
  const ids = playerIds.filter(id => { const x = byId(id); return x && x.online; });
  const stamp = Date.now() + Math.random();
  game.collect = { purpose, playerIds: ids, answers: {}, meta: meta || {}, prompt, publicMeta: publicMeta || null, stamp };
  if (!ids.length) return resolveCollect();
  broadcast();
  after(COLLECT_MS[purpose] || 40000, () => {
    if (game && game.collect && game.collect.stamp === stamp) resolveCollect();
  });
}

// pluralité : renvoie les ids les plus cités (ex-aequo inclus)
function plurality(values) {
  const counts = {};
  for (const v of values) if (v !== null && v !== undefined) counts[v] = (counts[v] || 0) + 1;
  const max = Math.max(0, ...Object.values(counts));
  if (!max) return [];
  return Object.keys(counts).filter(k => counts[k] === max).map(Number);
}

function resolveCollect() {
  const c = game.collect;
  if (!c) return;
  game.collect = null;
  const answers = Object.values(c.answers);
  switch (c.purpose) {
    case 'meduse': {
      // paires mutuelles : A a désigné B et B a désigné A → shot chacun
      const pairs = [];
      const seen = new Set();
      for (const [idStr, target] of Object.entries(c.answers)) {
        const a = parseInt(idStr, 10);
        if (target === null || seen.has(a)) continue;
        const b = parseInt(target, 10);
        if (c.answers[b] !== undefined && parseInt(c.answers[b], 10) === a && !seen.has(b)) {
          seen.add(a); seen.add(b);
          pairs.push([byId(a), byId(b)]);
        }
      }
      if (!pairs.length) {
        bannerThenNext({ kind: 'info', icon: '🪼', text: 'Méduse : aucun regard croisé. Quelle concentration.' }, 3000);
      } else {
        for (const [a, b] of pairs) { if (a) applyDrink(a, { s: 1 }, 'Méduse'); if (b) applyDrink(b, { s: 1 }, 'Méduse'); }
        const txt = pairs.map(([a, b]) => `${a ? a.name : '?'} 👀 ${b ? b.name : '?'}`).join(', ');
        bannerThenNext({ kind: 'drink', icon: '🪼', text: `MÉDUSE : ${txt} → 1 shot chacun !` });
      }
      break;
    }
    case 'pret': {
      if (c.meta.then === 'meduse') {
        io.to('screens').emit('meduse');
        broadcast();
        after(9000, () => {
          startCollect('meduse', players.map(x => x.id), {},
            'MÉDUSE — qui as-tu regardé ?', { kind: 'meduse' });
        });
      }
      break;
    }
    case 'accusation': {
      // majorité stricte de « oui » → shot pour l'accusé
      const oui = answers.filter(a => a === 'oui').length;
      const non = answers.filter(a => a === 'non').length;
      const accused = byId(c.meta.accusedId);
      if (accused && oui > non) {
        applyDrink(accused, { s: 1 }, 'Mot interdit');
        event({ kind: 'drink', icon: '💥', playerId: accused.id, text: `Coupable (${oui} oui / ${non} non) ! ${accused.name} a dit « ${c.meta.word} » : 1 shot !` });
        if (game.motInterdit && game.motInterdit.word === c.meta.word) game.motInterdit = null;
      } else {
        event({ kind: 'info', icon: '⚖️', text: `Acquitté·e (${oui} oui / ${non} non) — le mot interdit reste en jeu` });
      }
      broadcast();
      break; // mi-tour : on ne touche pas au tour en cours
    }
    case 'bdf': {
      const win = plurality(answers);
      const { aId, bId } = c.meta;
      const a = byId(aId), b = byId(bId);
      if (win.length !== 1) {
        if (a) applyDrink(a, { g: 2 }, 'Bras de fer');
        if (b) applyDrink(b, { g: 2 }, 'Bras de fer');
        bannerThenNext({ kind: 'drink', icon: '💪', text: `Bras de fer : la table est partagée, ${a ? a.name : '?'} et ${b ? b.name : '?'} boivent 2 !` });
      } else {
        const winner = byId(win[0]);
        const loser = win[0] === aId ? b : a;
        if (loser) applyDrink(loser, { s: 1 }, 'Bras de fer');
        bannerThenNext({ kind: 'drink', icon: '💪', playerId: loser ? loser.id : null, text: `${winner ? winner.name : '?'} gagne le bras de fer, ${loser ? loser.name : '?'} boit 1 shot !` });
      }
      break;
    }
    case 'freeze': {
      const losers = plurality(answers).map(byId).filter(Boolean);
      if (!losers.length) {
        event({ kind: 'info', icon: '🥶', text: 'Freeze : personne de désigné, tout le monde s\'en sort' });
      } else {
        for (const l of losers) applyDrink(l, { g: c.meta.n }, 'Freeze');
        event({ kind: 'drink', icon: '🥶', playerId: losers[0].id, text: `Freeze : ${losers.map(l => l.name).join(' et ')} bo${losers.length > 1 ? 'ivent' : 'it'} ${c.meta.n} gorgées !` });
      }
      broadcast();
      break; // mi-tour
    }
    case 'valise': {
      const losers = plurality(answers).map(byId).filter(Boolean);
      if (!losers.length) {
        bannerThenNext({ kind: 'info', icon: '🧳', text: 'Dans ma valise : mémoire collective parfaite, personne ne boit' }, 3000);
      } else {
        for (const l of losers) applyDrink(l, { g: c.meta.n }, 'Valise');
        bannerThenNext({ kind: 'drink', icon: '🧳', playerId: losers[0].id, text: `La table a tranché : ${losers.map(l => l.name).join(' et ')} bo${losers.length > 1 ? 'ivent' : 'it'} ${c.meta.n} gorgées !` });
      }
      break;
    }
    case 'imite': {
      const t = byId(c.meta.targetId);
      const notes = answers.map(Number).filter(n => !isNaN(n));
      if (!t || !notes.length) { bannerThenNext({ kind: 'info', icon: '🎭', text: 'Pas de jury, pas de sentence' }, 2500); break; }
      const avg = notes.reduce((x, y) => x + y, 0) / notes.length;
      const drinks = Math.max(0, 5 - Math.round(avg));
      if (drinks > 0) applyDrink(t, { g: drinks }, 'Imitation');
      bannerThenNext({ kind: drinks ? 'drink' : 'info', icon: '🎭', playerId: t.id,
        text: `Note du jury : ${avg.toFixed(1)}/5 ⭐ — ${drinks ? `${t.name} boit ${drinks} gorgée${drinks > 1 ? 's' : ''} !` : `${t.name} ne boit rien, standing ovation !`}` });
      break;
    }
    case 'compliments': {
      const t = byId(c.meta.targetId);
      const oui = answers.filter(a => a === 'oui').length;
      const non = answers.filter(a => a === 'non').length;
      if (t && non > oui) {
        applyDrink(t, { g: 3 }, 'Compliments');
        bannerThenNext({ kind: 'drink', icon: '💝', playerId: t.id, text: `Pas assez sincère (${non} non / ${oui} oui) : ${t.name} boit 3 gorgées !` });
      } else {
        bannerThenNext({ kind: 'info', icon: '💝', playerId: t ? t.id : null, text: `La table valide la sincérité (${oui} oui / ${non} non), bravo` }, 3200);
      }
      break;
    }
  }
  // les décisions mi-tour (accusation, freeze) laissent le tour en cours :
  // on ré-arme le garde-fou d'inactivité du pending s'il y en a un
  if (game && game.phase === 'playing' && game.pending) armIdleGuard();
}

function rollDice(p) {
  cancelVoteFor(p);
  let value = 1 + Math.floor(Math.random() * 6);
  let anchored = false;
  if (p.ancre) {
    p.ancre = false;
    anchored = true;
    value = Math.max(1, Math.floor(value / 2));
  }
  game.pending = null;
  io.to('screens').emit('dice', { playerId: p.id, value, anchored });
  if (anchored) event({ kind: 'info', icon: '⚓', playerId: p.id, text: `L'ancre freine ${p.name} : dé divisé par deux → ${value} !` });
  broadcast();
  after(1800, () => movePlayer(p, Math.min(p.pos + value, game.board.cells.length - 1)));
}

function movePlayer(p, to) {
  const from = p.pos;
  p.pos = to;
  game.awaitingAnim = { playerId: p.id, to };
  io.to('screens').emit('move', { playerId: p.id, from, to });
  broadcast();
  after(Math.abs(to - from) * 260 + 2500, () => {
    if (game && game.awaitingAnim && game.awaitingAnim.playerId === p.id) {
      game.awaitingAnim = null;
      arrive(p);
    }
  });
}

function arrive(p) {
  if (!game || game.phase !== 'playing') return;
  const N = game.board.cells.length;
  if (p.pos >= N - 1) return playerFinishes(p);
  // bombe piégée posée par une carte ?
  const trapIdx = game.traps.findIndex(t => t.cell === p.pos);
  if (trapIdx !== -1) {
    game.traps.splice(trapIdx, 1);
    applyDrink(p, { s: 1 }, 'Bombe piégée');
    io.to('screens').emit('trap-boom', { playerId: p.id, cell: p.pos });
    event({ kind: 'drink', icon: '💥', playerId: p.id, text: `BOOM ! ${p.name} marche sur une bombe piégée : 1 shot !` });
    broadcast();
    after(2600, () => resolveCell(p, game.board.cells[p.pos]));
    return;
  }
  resolveCell(p, game.board.cells[p.pos]);
}

function bannerThenNext(ev, ms = BANNER_MS) {
  event(ev);
  broadcast();
  after(ms, nextTurn);
}

function resolveCell(p, cell) {
  const others = () => players.filter(x => x.id !== p.id);
  const all = () => players.map(x => x.id);
  switch (cell.type) {
    case 'boit':
      applyDrink(p, { g: cell.n }, cell.label);
      bannerThenNext({ kind: 'drink', icon: '🍺', playerId: p.id, text: `${p.name} boit ${cell.n} gorgées !` });
      break;
    case 'shot':
      applyDrink(p, { s: 1 }, cell.label);
      bannerThenNext({ kind: 'drink', icon: '🥃', playerId: p.id, text: `${p.name} boit 1 shot !` });
      break;
    case 'fini-verre':
      applyDrink(p, { fini: 1 }, cell.label);
      bannerThenNext({ kind: 'drink', icon: '🍻', playerId: p.id, text: `${p.name} finit son verre !` });
      break;
    case 'fini-droite': case 'fini-gauche': {
      const idx = game.order.indexOf(p.id);
      const dir = cell.type === 'fini-droite' ? 1 : -1;
      const t = byId(game.order[(idx + dir + game.order.length) % game.order.length]);
      applyDrink(t, { fini: 1 }, cell.label);
      bannerThenNext({ kind: 'drink', icon: cell.icon, playerId: t.id, text: `${t.name} (à ${dir > 0 ? 'droite' : 'gauche'} de ${p.name}) finit son verre !` });
      break;
    }
    case 'tous-boivent':
      for (const x of players) applyDrink(x, { g: cell.n }, cell.label);
      bannerThenNext({ kind: 'drink', icon: '🌍', text: `Tout le monde boit ${cell.n} gorgées !` });
      break;
    case 'uni-plus':
      game.uniVerre += cell.n;
      bannerThenNext({ kind: 'uni', icon: '🏺', playerId: p.id, text: `${p.name} verse ${cell.n} doses dans l'UNI.VERRE (total : ${game.uniVerre})` });
      break;
    case 'uni-gorgees':
      if (game.uniVerre >= cell.n) {
        game.uniVerre -= cell.n;
        applyDrink(p, { g: cell.n }, cell.label);
        bannerThenNext({ kind: 'drink', icon: '🌀', playerId: p.id, text: `${p.name} boit ${cell.n} gorgées de l'UNI.VERRE (reste : ${game.uniVerre})` });
      } else {
        game.uniVerre += cell.n;
        bannerThenNext({ kind: 'uni', icon: '🌀', playerId: p.id, text: `UNI.VERRE trop vide : ${p.name} y verse ${cell.n} doses (total : ${game.uniVerre})` });
      }
      break;
    case 'saute': case 'retourne': {
      event({ kind: 'move', icon: cell.icon, playerId: p.id, text: `${p.name} : ${cell.label.toLowerCase()}` });
      broadcast();
      game.chainDepth++;
      after(1600, () => {
        if (game.chainDepth > 2) { bannerThenNext({ kind: 'info', icon: '😮‍💨', playerId: p.id, text: `${p.name} a assez voyagé pour ce tour` }); return; }
        movePlayer(p, cell.target);
      });
      break;
    }
    case 'gel':
      p.frozen += 1;
      bannerThenNext({ kind: 'status', icon: '❄️', playerId: p.id, text: `${p.name} est gelé·e pour 1 tour !` });
      break;
    case 'gel-suivant': {
      let idx = game.turnIdx, t = null;
      for (let i = 0; i < game.order.length; i++) {
        idx = (idx + 1) % game.order.length;
        const cand = byId(game.order[idx]);
        if (cand && !cand.finished) { t = cand; break; }
      }
      if (!t) { after(600, nextTurn); break; }
      t.frozen += 1;
      bannerThenNext({ kind: 'status', icon: '🧊', playerId: t.id, text: `${t.name} est gelé·e pour 1 tour !` });
      break;
    }
    case 'roulette':
      applyDrink(p, { g: cell.n }, cell.label);
      setPending({ type: 'ok', playerId: p.id, label: `Tourne 6 fois sur toi-même, puis bois ${cell.n} gorgées 😵` },
        { kind: 'drink', icon: '💫', playerId: p.id, text: `${p.name} tourne 6 fois sur soi-même et boit ${cell.n} gorgées !` });
      break;
    case 'bois-pour-tous':
      p.boitPourTous = true;
      bannerThenNext({ kind: 'status', icon: '🐫', playerId: p.id, text: `${p.name} boit à la place de tout le monde pendant 1 tour !` });
      break;
    case 'distribue':
      setPending({ type: 'distribute', playerId: p.id, n: cell.n },
        { kind: 'action', icon: '🫗', playerId: p.id, text: `${p.name} distribue ${cell.n} gorgées…` });
      break;
    case 'mot-interdit':
      setPending({ type: 'text', playerId: p.id, purpose: 'mot', label: 'Choisis le mot interdit (il sera affiché à l\'écran)' },
        { kind: 'action', icon: '🤫', playerId: p.id, text: `${p.name} choisit un mot interdit…` });
      break;
    case 'invente-regle':
      setPending({ type: 'text', playerId: p.id, purpose: 'regle', label: 'Invente une règle (valable 1 tour complet)' },
        { kind: 'action', icon: '📜', playerId: p.id, text: `${p.name} invente une règle…` });
      break;
    case 'meduse':
      game.pending = null;
      event({ kind: 'action', icon: '🪼', text: 'MÉDUSE ! Appuyez tous sur PRÊT sur vos téléphones…' });
      startCollect('pret', all(), { then: 'meduse' },
        'MÉDUSE — appuie sur PRÊT !', { kind: 'pret' });
      break;
    case 'bras-de-fer':
      setPending({ type: 'pick', playerId: p.id, purpose: 'bdf-adversaire', options: others().map(x => x.id), label: 'Choisis ton adversaire au bras de fer' },
        { kind: 'action', icon: '💪', playerId: p.id, text: `${p.name} choisit un adversaire pour un bras de fer…` });
      break;
    case 'freeze':
      game.freeze = { by: p.id, n: cell.n };
      bannerThenNext({ kind: 'status', icon: '🥶', playerId: p.id,
        text: `FREEZE armé pour 1 tour : quand ${p.name} s'arrête de bouger, imitez — le dernier boit ${cell.n} gorgées !` });
      break;
    case 'valise':
      game.pending = null;
      startCollect('valise', all(), { n: cell.n },
        `« Dans ma valise il y a… » ${p.name} commence ! Puis désignez le perdant`, { kind: 'valise' });
      event({ kind: 'action', icon: '🧳', text: `« Dans ma valise il y a… » — ${p.name} commence, chacun ajoute un objet. Le premier qui se trompe boit ${cell.n} gorgées (désignation à la majorité) !` });
      broadcast();
      break;
    case 'echange-verre':
      setPending({ type: 'pick', playerId: p.id, purpose: 'echange', options: others().map(x => x.id), label: 'Avec qui échanges-tu ton verre ?' },
        { kind: 'action', icon: '🔄', playerId: p.id, text: `${p.name} va échanger son verre…` });
      break;
    case 'duel':
      setPending({ type: 'pick', playerId: p.id, purpose: 'duel', options: others().map(x => x.id), label: 'Choisis ton adversaire pour le duel de dés' },
        { kind: 'action', icon: '⚔️', playerId: p.id, text: `${p.name} lance un duel de dés…` });
      break;
    case 'imite':
      game.pending = null;
      startCollect('imite', others().map(x => x.id), { targetId: p.id },
        `Notez l'imitation de ${p.name} (0 à 5 ⭐)`, { kind: 'imite', targetId: p.id });
      event({ kind: 'action', icon: '🎭', playerId: p.id, text: `${p.name} imite quelqu'un dans la pièce — le jury note de 0 à 5 ⭐ (5 = ne boit pas)` });
      broadcast();
      break;
    case 'compliments':
      game.pending = null;
      startCollect('compliments', others().map(x => x.id), { targetId: p.id },
        `Les compliments de ${p.name} étaient-ils sincères ?`, { kind: 'compliments', targetId: p.id });
      event({ kind: 'action', icon: '💝', playerId: p.id, text: `${p.name} fait un compliment sincère à chaque joueur. La table jugera : pas sincère = 3 gorgées !` });
      broadcast();
      break;
    case 'question':
      setPending({ type: 'ok', playerId: p.id, label: `${cell.label} (réponds ou bois 3)` },
        { kind: 'action', icon: '❓', playerId: p.id, text: `${p.name} — ${cell.label} Réponse ou 3 gorgées !` });
      break;
    case 'ficha':
      setPending({ type: 'ok', playerId: p.id, label: `${cell.label} (ou bois 3)` },
        { kind: 'action', icon: '📸', playerId: p.id, text: `${p.name} — ${cell.label} ! Refus = 3 gorgées` });
      break;
    case 'change-recipient':
      setPending({ type: 'ok', playerId: p.id, label: 'Change de récipient : verse ton verre dans autre chose (bol, tasse, entonnoir…)' },
        { kind: 'action', icon: '🏆', playerId: p.id, text: `${p.name} change de récipient : le verre est trop mainstream` });
      break;
    case 'carte': {
      const card = draw();
      p.hand.push(card);
      io.to('screens').emit('card-draw', { playerId: p.id });
      bannerThenNext({ kind: 'card', icon: '🃏', playerId: p.id, voice: true, text: `${p.name} pioche une carte mystère…` }, 3200);
      break;
    }
    default:
      after(600, nextTurn);
  }
}

function setPending(pending, ev) {
  game.pending = pending;
  if (ev) event(ev);
  broadcast();
  armIdleGuard();
}

// ——— Cartes jouées depuis la main ———
function playCard(p, cardId, payload) {
  const idx = p.hand.findIndex(c => c.id === cardId);
  if (idx === -1) return;
  const card = p.hand[idx];
  // bloqué pendant les décisions collectives, les votes et les déplacements en cours
  if (game.collect || game.vote) return;
  if (game.awaitingAnim && (cardId === 'turbo' || cardId === 'putsch')) return;
  const N = game.board.cells.length;

  const discard = () => { p.hand.splice(idx, 1); game.discard.push(card); broadcast(); };
  // les cartes jouées sont annoncées à voix haute par l'écran
  const cardEvent = (ev) => event({ ...ev, voice: true });
  const anon = card.anonymous;

  switch (cardId) {
    case 'tous2':
      discard();
      for (const x of players) applyDrink(x, { g: 2 }, card.title);
      cardEvent({ kind: 'drink', icon: '🌍', playerId: p.id, text: `${p.name} joue SANTÉ GÉNÉRALE : tout le monde boit 2 !` });
      break;
    case 'dist5': {
      let total = 0; const parts = [];
      for (const [idStr, nRaw] of Object.entries(payload && payload.alloc || {})) {
        const n = Math.max(0, Math.min(5, parseInt(nRaw, 10) || 0));
        const t = byId(parseInt(idStr, 10));
        if (t && t.id !== p.id && n > 0) { parts.push([t, n]); total += n; }
      }
      if (total !== 5) return;
      discard();
      for (const [t, n] of parts) applyDrink(t, { g: n }, card.title);
      cardEvent({ kind: 'drink', icon: '🫗', playerId: p.id, text: `${p.name} joue GÉNÉREUX : ${parts.map(([t, n]) => `${t.name} ×${n}`).join(', ')}` });
      break;
    }
    case 'uni4':
      discard();
      game.uniVerre += 4;
      cardEvent({ kind: 'uni', icon: '🏺', playerId: p.id, text: `${p.name} joue OFFRANDE : +4 dans l'UNI.VERRE (total : ${game.uniVerre})` });
      break;
    case 'turbo': {
      discard();
      const to = Math.min(N - 2, p.pos + 3);
      const from = p.pos; p.pos = to;
      io.to('screens').emit('move', { playerId: p.id, from, to });
      cardEvent({ kind: 'move', icon: '🚀', playerId: p.id, text: `${p.name} joue TURBO : +3 cases !` });
      break;
    }
    case 'premier3': {
      discard();
      const t = [...players].sort((a, b) => b.pos - a.pos)[0];
      applyDrink(t, { g: 3 }, card.title);
      cardEvent({ kind: 'drink', icon: '👑', playerId: t.id, text: `${p.name} joue IMPÔT : ${t.name} est en tête et boit 3 !` });
      break;
    }
    case 'dernier3': {
      discard();
      const t = [...players].sort((a, b) => a.pos - b.pos)[0];
      applyDrink(t, { g: 3 }, card.title);
      cardEvent({ kind: 'drink', icon: '🐢', playerId: t.id, text: `${p.name} joue DOUBLE PEINE : ${t.name} est dernier·e et boit 3 !` });
      break;
    }
    case 'putsch': {
      const opts = players.filter(x => x.id !== p.id && !x.finished);
      if (!opts.length) return;
      discard();
      const t = opts[Math.floor(Math.random() * opts.length)];
      const tmp = t.pos; t.pos = p.pos; p.pos = tmp;
      cardEvent({ kind: 'move', icon: '♟️', playerId: p.id, text: `${p.name} joue PUTSCH : le hasard désigne ${t.name}, ils échangent leurs places !` });
      break;
    }
    case 'bombe': {
      const cellIdx = parseInt(payload && payload.cell, 10);
      if (isNaN(cellIdx) || cellIdx < 1 || cellIdx > N - 2) return;
      if (players.some(x => x.pos === cellIdx)) return;          // case occupée
      if (game.traps.some(t => t.cell === cellIdx)) return;       // déjà piégée
      discard();
      game.traps.push({ cell: cellIdx });
      cardEvent({ kind: 'status', icon: '💣', text: `Quelqu'un a posé une bombe sur la case ${cellIdx + 1}…` });
      break;
    }
    case 'menottes': {
      const a = byId(parseInt(payload && payload.a, 10));
      const b = byId(parseInt(payload && payload.b, 10));
      if (!a || !b || a.id === b.id) return;
      discard();
      game.chains.push({ a: a.id, b: b.id, turnsLeft: game.order.length });
      cardEvent({ kind: 'status', icon: '⛓️', text: `Quelqu'un a menotté ${a.name} et ${b.name} pour 1 tour : quand l'un boit, l'autre boit !` });
      break;
    }
    case 'corbeau': {
      const text = String(payload && payload.text || '').slice(0, 90).trim();
      if (!text) return;
      discard();
      p.corbeau = text;
      cardEvent({ kind: 'info', icon: '💌', text: 'Un corbeau a été écrit quelque part…' });
      break;
    }
    case 'rejoue': {
      // seulement à ton tour, avant de lancer le dé
      if (!game.pending || game.pending.type !== 'roll' || game.pending.playerId !== p.id) return;
      discard();
      game.extraTurn = p.id;
      cardEvent({ kind: 'status', icon: '🔁', playerId: p.id, text: `${p.name} joue REJOUE : deux tours d'affilée !` });
      break;
    }
    case 'ancre': {
      const t = byId(parseInt(payload && payload.target, 10));
      if (!t || t.id === p.id) return;
      discard();
      t.ancre = true;
      cardEvent({ kind: 'status', icon: '⚓', playerId: t.id, text: `${p.name} jette l'ancre sur ${t.name} : son prochain dé sera divisé par deux !` });
      break;
    }
    case 'vol': {
      const t = byId(parseInt(payload && payload.target, 10));
      if (!t || t.id === p.id) return;
      discard();
      if (t.hand.length) {
        const stolen = t.hand.splice(Math.floor(Math.random() * t.hand.length), 1)[0];
        p.hand.push(stolen);
        cardEvent({ kind: 'status', icon: '🕵️', text: `Une carte a été dérobée à ${t.name} !` });
      } else {
        cardEvent({ kind: 'info', icon: '🕵️', text: `Tentative de vol sur ${t.name}… aucune carte en poche, raté !` });
      }
      break;
    }
    case 'bouclier': {
      const ld = p.lastDrink;
      if (!ld || ld.used) return;
      discard();
      ld.used = true;
      p.gorgees -= ld.g; p.shots -= ld.s;
      p.totalGorgees -= ld.g; p.totalShots -= ld.s;
      cardEvent({ kind: 'status', icon: '🛡️', playerId: p.id, text: `${p.name} bloque tout avec le BOUCLIER !` });
      break;
    }
    case 'miroir': {
      const ld = p.lastDrink;
      const t = byId(parseInt(payload && payload.target, 10));
      if (!ld || ld.used || !t || t.id === p.id) return;
      discard();
      ld.used = true;
      p.gorgees -= ld.g; p.shots -= ld.s;
      p.totalGorgees -= ld.g; p.totalShots -= ld.s;
      applyDrink(t, { g: ld.g, s: ld.s }, 'Miroir');
      cardEvent({ kind: 'drink', icon: '🪞', playerId: t.id, text: `${p.name} renvoie tout sur ${t.name} avec le MIROIR !` });
      break;
    }
    default:
      return;
  }
  broadcast();
}

// ——— Arrivée d'un joueur : la partie continue jusqu'à l'avant-dernier ———
function playerFinishes(p) {
  p.finished = true;
  game.finishOrder.push(p.id);
  const rank = game.finishOrder.length;
  // ses statuts « jusqu'à mon prochain tour » n'expireront jamais : on purge
  if (game.motInterdit && game.motInterdit.by === p.id) game.motInterdit = null;
  if (game.freeze && game.freeze.by === p.id) game.freeze = null;
  game.rules = game.rules.filter(r => r.expiresOnTurnOf !== p.id);
  p.boitPourTous = false;
  game.pending = null;

  const remaining = players.filter(x => !x.finished);
  if (remaining.length <= 1) return endGame(remaining[0] || null);

  event({ kind: 'win', icon: '🏁', playerId: p.id, voice: true,
    text: `${p.name} atteint l'ARRIVÉE (${rank === 1 ? '1er' : rank + 'e'}) ! La course continue pour les autres…` });
  broadcast();
  after(BANNER_MS, nextTurn);
}

// ——— Fin de partie : il ne reste qu'un joueur en course ———
function endGame(last) {
  game.phase = 'over';
  game.pending = null;
  game.collect = null;
  game.vote = null;
  if (last && game.uniVerre > 0) {
    applyDrink(last, { g: game.uniVerre }, 'UNI.VERRE final');
  }
  const order = [...game.finishOrder];
  if (last) order.push(last.id);
  game.ranking = {
    order,
    winner: game.finishOrder[0] || (last && last.id),
    uniVerreLoser: last ? last.id : null,
    uniVerreAmount: game.uniVerre,
  };
  const winner = byId(game.ranking.winner);
  event({ kind: 'win', icon: '🏆', playerId: winner ? winner.id : null,
    text: `Course terminée !${last && game.uniVerre > 0 ? ` ${last.name} (dernier·e) boit l'UNI.VERRE : ${game.uniVerre} gorgées !` : ''}` });
  broadcast();
}

// ——————————————————— Socket.IO ———————————————————

io.on('connection', (socket) => {
  socket.on('register-screen', () => {
    socket.join('screens');
    socket.emit('game', snapshot());
  });

  socket.on('join', ({ name, avatar }) => {
    name = String(name || '').slice(0, 16).trim() || 'Joueur';
    let p = players.find(x => x.name.toLowerCase() === name.toLowerCase());
    if (p) {
      p.socketId = socket.id; p.online = true;
      if (avatar) p.avatar = avatar;
      if (game && game.phase === 'playing') {
        if (p.benched) {
          p.benched = false;
          event({ kind: 'info', icon: '🎉', playerId: p.id, text: `${p.name} est de retour dans la partie !` });
        }
        if (game.vote && game.vote.targetId === p.id && game.vote.reason === 'offline') cancelVoteFor(p);
        if (game.order[game.turnIdx] === p.id && !game.pending && !game.vote && !game.collect && !game.awaitingAnim) {
          game.pending = { type: 'roll', playerId: p.id };
          armIdleGuard();
        }
      }
    } else {
      if (game && game.phase === 'playing') {
        socket.emit('join-refused', 'Partie en cours — reprends un pseudo existant ou attends la fin.');
        return;
      }
      p = {
        id: nextPlayerId++, name, avatar, color: COLORS[players.length % COLORS.length],
        socketId: socket.id, online: true, seat: null,
        pos: 0, gorgees: 0, shots: 0, finis: 0, frozen: 0, hand: [],
        totalGorgees: 0, totalShots: 0,
      };
      players.push(p);
    }
    socket.join('controllers');
    socket.data.playerId = p.id;
    socket.emit('joined', { id: p.id });
    broadcast();
  });

  function me() {
    const p = players.find(x => x.id === socket.data.playerId);
    return p && p.socketId === socket.id ? p : null;
  }
  function isHost(p) { return players[0] && players[0].id === p.id; }

  // choisir / changer sa place autour de la table (au lobby uniquement)
  socket.on('seat', (idxRaw) => {
    const p = me();
    if (!p || (game && game.phase === 'playing')) return;
    const idx = parseInt(idxRaw, 10);
    if (isNaN(idx) || idx < 0 || idx >= SEATS) return;
    if (players.some(x => x.id !== p.id && x.seat === idx)) return; // place prise
    p.seat = idx;
    broadcast();
  });

  socket.on('toggle-shots', () => {
    const p = me();
    if (!p || !isHost(p) || (game && game.phase === 'playing')) return;
    lobbySettings.noShots = !lobbySettings.noShots;
    broadcast();
  });

  socket.on('new-board', () => {
    const p = me();
    if (!p || !isHost(p) || (game && game.phase === 'playing')) return;
    lobbyBoard = freshBoard();
    if (game && game.phase === 'over') game = null;
    broadcast();
  });

  socket.on('start', () => {
    const p = me();
    if (!p || !isHost(p) || players.length < 2) return;
    if (players.some(x => x.seat === null || x.seat === undefined)) return; // tout le monde doit être assis
    if (game && game.phase === 'playing') return;
    clearTimers();
    startGame();
  });

  socket.on('replay', () => {
    const p = me();
    if (!p || !isHost(p) || !game || game.phase !== 'over') return;
    clearTimers();
    lobbyBoard = freshBoard();
    game = null;
    resetGame();
    broadcast();
  });

  socket.on('anim-done', () => {
    if (game && game.awaitingAnim) {
      const p = byId(game.awaitingAnim.playerId);
      game.awaitingAnim = null;
      if (p) arrive(p);
    }
  });

  socket.on('roll', () => {
    const p = me();
    if (!p || !game || game.phase !== 'playing') return;
    if (!game.pending || game.pending.type !== 'roll' || game.pending.playerId !== p.id) return;
    rollDice(p);
  });

  socket.on('distribute', (alloc) => {
    const p = me();
    if (!p || !game || !game.pending || game.pending.type !== 'distribute' || game.pending.playerId !== p.id) return;
    cancelVoteFor(p);
    const max = game.pending.n;
    let total = 0;
    const parts = [];
    for (const [idStr, nRaw] of Object.entries(alloc || {})) {
      const n = Math.max(0, Math.min(max, parseInt(nRaw, 10) || 0));
      const t = byId(parseInt(idStr, 10));
      if (t && n > 0) { parts.push([t, n]); total += n; }
    }
    if (total !== max) return;
    game.pending = null;
    for (const [t, n] of parts) applyDrink(t, { g: n }, 'Distribution');
    const txt = parts.map(([t, n]) => `${t.name} ×${n}`).join(', ');
    bannerThenNext({ kind: 'drink', icon: '🫗', playerId: p.id, text: `${p.name} distribue : ${txt}` });
  });

  socket.on('text-submit', (raw) => {
    const p = me();
    if (!p || !game || !game.pending || game.pending.type !== 'text' || game.pending.playerId !== p.id) return;
    cancelVoteFor(p);
    const text = String(raw || '').slice(0, 80).trim();
    if (!text) return;
    const purpose = game.pending.purpose;
    game.pending = null;
    if (purpose === 'mot') {
      game.motInterdit = { by: p.id, word: text };
      bannerThenNext({ kind: 'status', icon: '🤫', playerId: p.id, text: `MOT INTERDIT : « ${text} » — celui qui le dit boit 1 shot (valable 1 tour complet) !` });
    } else if (purpose === 'regle') {
      game.rules.push({ by: p.name, byId: p.id, text, expiresOnTurnOf: p.id });
      bannerThenNext({ kind: 'status', icon: '📜', playerId: p.id, text: `Nouvelle règle de ${p.name} (1 tour) : « ${text} »` });
    }
  });

  // quelqu'un signale que le mot interdit a été prononcé → procès à la majorité
  socket.on('mot-report', (accusedIdRaw) => {
    const p = me();
    if (!p || !game || game.phase !== 'playing' || !game.motInterdit || game.collect || game.vote) return;
    const accused = byId(parseInt(accusedIdRaw, 10));
    if (!accused || accused.id === p.id) return;
    const word = game.motInterdit.word;
    const voters = players.filter(x => x.id !== accused.id).map(x => x.id);
    event({ kind: 'action', icon: '⚖️', playerId: accused.id, text: `${p.name} accuse ${accused.name} d'avoir dit « ${word} » ! La table vote…` });
    startCollect('accusation', voters, { accusedId: accused.id, word },
      `${accused.name} a-t-il/elle dit « ${word} » ?`, { kind: 'accusation', accusedId: accused.id, word });
  });

  // le poseur du freeze déclenche le jugement
  socket.on('freeze-now', () => {
    const p = me();
    if (!p || !game || game.phase !== 'playing' || !game.freeze || game.freeze.by !== p.id || game.collect || game.vote) return;
    const n = game.freeze.n;
    game.freeze = null;
    io.to('screens').emit('freeze');
    event({ kind: 'action', icon: '🥶', playerId: p.id, text: `${p.name} a freezé ! Qui a bougé en dernier ? La table désigne…` });
    startCollect('freeze', players.map(x => x.id), { n },
      `FREEZE — qui s'est immobilisé en dernier ? (${n} gorgées)`, { kind: 'freeze' });
  });

  socket.on('collect-answer', (value) => {
    const p = me();
    if (!p || !game || !game.collect) return;
    const c = game.collect;
    if (!c.playerIds.includes(p.id) || p.id in c.answers) return;
    // validation par type de décision
    switch (c.purpose) {
      case 'meduse': {
        const v = value === null ? null : parseInt(value, 10);
        if (v !== null && (isNaN(v) || v === p.id || !byId(v))) return;
        c.answers[p.id] = v;
        break;
      }
      case 'accusation': case 'compliments':
        if (value !== 'oui' && value !== 'non') return;
        c.answers[p.id] = value;
        break;
      case 'bdf': {
        const v = parseInt(value, 10);
        if (v !== c.meta.aId && v !== c.meta.bId) return;
        c.answers[p.id] = v;
        break;
      }
      case 'freeze': case 'valise': {
        const v = value === null ? null : parseInt(value, 10);
        if (v !== null && !byId(v)) return;
        c.answers[p.id] = v;
        break;
      }
      case 'imite': {
        const v = parseInt(value, 10);
        if (isNaN(v) || v < 0 || v > 5) return;
        c.answers[p.id] = v;
        break;
      }
      case 'pret':
        c.answers[p.id] = 'ok';
        break;
      default: return;
    }
    broadcast();
    if (c.playerIds.every(id => id in c.answers)) resolveCollect();
  });

  socket.on('pick', (targetIdRaw) => {
    const p = me();
    if (!p || !game || !game.pending || game.pending.type !== 'pick' || game.pending.playerId !== p.id) return;
    cancelVoteFor(p);
    const pending = game.pending;
    const targetId = targetIdRaw === null ? null : parseInt(targetIdRaw, 10);
    if (targetId !== null && !pending.options.includes(targetId)) return;
    if (targetId === null && !pending.allowNone) return;
    const t = targetId === null ? null : byId(targetId);
    game.pending = null;
    switch (pending.purpose) {
      case 'bdf-adversaire': {
        event({ kind: 'action', icon: '💪', text: `BRAS DE FER : ${p.name} 🆚 ${t.name} ! Faites-le, la table votera pour le gagnant` });
        startCollect('bdf', players.map(x => x.id), { aId: p.id, bId: t.id },
          `Qui a gagné le bras de fer ?`, { kind: 'bdf', aId: p.id, bId: t.id });
        break;
      }
      case 'echange':
        bannerThenNext({ kind: 'action', icon: '🔄', playerId: p.id, text: `${p.name} et ${t.name} échangent leurs verres !` });
        break;
      case 'duel': {
        const d1 = 1 + Math.floor(Math.random() * 6);
        const d2 = 1 + Math.floor(Math.random() * 6);
        io.to('screens').emit('duel', { a: { playerId: p.id, value: d1 }, b: { playerId: t.id, value: d2 } });
        broadcast();
        after(3800, () => {
          if (!game || game.phase !== 'playing') return;
          if (d1 === d2) {
            applyDrink(p, { g: 2 }, 'Duel'); applyDrink(t, { g: 2 }, 'Duel');
            bannerThenNext({ kind: 'drink', icon: '⚔️', text: `Égalité ${d1}-${d2} : ${p.name} et ${t.name} boivent 2 !` });
          } else {
            const loser = d1 < d2 ? p : t;
            const diff = Math.abs(d1 - d2);
            applyDrink(loser, { g: diff }, 'Duel');
            bannerThenNext({ kind: 'drink', icon: '⚔️', playerId: loser.id, text: `Duel ${d1}-${d2} : ${loser.name} boit ${diff} gorgées !` });
          }
        });
        break;
      }
    }
  });

  socket.on('ok', () => {
    const p = me();
    if (!p || !game || !game.pending || game.pending.type !== 'ok' || game.pending.playerId !== p.id) return;
    cancelVoteFor(p);
    game.pending = null;
    broadcast();
    after(600, nextTurn);
  });

  socket.on('send-corbeau', () => {
    const p = me();
    if (!p || !game || game.phase !== 'playing' || !p.corbeau) return;
    game.corbeaux.push({ text: p.corbeau, turnsLeft: game.order.length });
    p.corbeau = null;
    event({ kind: 'status', icon: '💌', voice: true, text: `CORBEAU anonyme : « ${game.corbeaux[game.corbeaux.length - 1].text} »` });
    broadcast();
  });

  socket.on('use-card', ({ id, payload } = {}) => {
    const p = me();
    if (!p || !game || game.phase !== 'playing') return;
    playCard(p, id, payload || {});
  });

  socket.on('vote', (choice) => {
    const p = me();
    if (!p || !game || !game.vote) return;
    if (!game.vote.voters.includes(p.id)) return;
    if (choice !== 'tej' && choice !== 'wait') return;
    game.vote.votes[p.id] = choice;
    broadcast();
    if (Object.keys(game.vote.votes).length >= game.vote.voters.length) finishVote();
  });

  socket.on('disconnect', () => {
    const p = players.find(x => x.socketId === socket.id);
    if (!p) return;
    p.online = false;
    p.socketId = null;
    // une décision collective ne doit pas attendre un déconnecté
    if (game && game.collect) {
      const c = game.collect;
      c.playerIds = c.playerIds.filter(id => id !== p.id || id in c.answers);
      if (c.playerIds.length && c.playerIds.every(id => id in c.answers)) resolveCollect();
    }
    if (!game) {
      players = players.filter(x => x.id !== p.id);
    }
    broadcast();
  });
});

server.listen(PORT, () => {
  console.log(`UNI.VERRE — écran : http://localhost:${PORT}`);
  console.log(`Manettes : http://${lanIP()}:${PORT}/play`);
});
