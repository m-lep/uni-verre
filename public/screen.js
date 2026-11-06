/* UNI.VERRE — écran principal.
   Le plateau est dessiné intégralement en SVG : une spirale d'anneaux
   rectangulaires arrondis, découpés en cases le long du périmètre, puis une
   rangée centrale qui se termine sur l'ARRIVÉE (comme un vrai plateau apéro). */

const socket = io();
const $ = (id) => document.getElementById(id);
const svg = $('board');
const NS = 'http://www.w3.org/2000/svg';

let snap = null;          // dernier snapshot serveur
let boardSeed = null;     // seed du plateau actuellement dessiné
let cellCentroids = [];   // index de case → {x, y}
let animating = new Set(); // playerIds en cours d'animation de pion

// ————————————————— Géométrie : rectangle arrondi paramétré —————————————————

// Construit la liste des segments (lignes + arcs) d'un rectangle arrondi,
// parcouru depuis le milieu du bas, vers la droite, puis en remontant.
function rrSegments(x, y, w, h, r) {
  const segs = [];
  const line = (x1, y1, x2, y2) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    segs.push({ len, at: t => ({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t }) });
  };
  const arc = (cx, cy, a1, a2) => {
    const len = Math.abs(a2 - a1) * r;
    segs.push({ len, at: t => {
      const a = a1 + (a2 - a1) * t;
      return { x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) };
    } });
  };
  const D = Math.PI / 180;
  line(x + w / 2, y + h, x + w - r, y + h);              // bas, moitié droite
  arc(x + w - r, y + h - r, 90 * D, 0);                  // coin bas-droit
  line(x + w, y + h - r, x + w, y + r);                  // côté droit (monte)
  arc(x + w - r, y + r, 0, -90 * D);                     // coin haut-droit
  line(x + w - r, y, x + r, y);                          // haut (vers la gauche)
  arc(x + r, y + r, -90 * D, -180 * D);                  // coin haut-gauche
  line(x, y + r, x, y + h - r);                          // côté gauche (descend)
  arc(x + r, y + h - r, 180 * D, 90 * D);                // coin bas-gauche
  line(x + r, y + h, x + w / 2, y + h);                  // bas, retour au centre
  let total = 0;
  for (const s of segs) { s.start = total; total += s.len; }
  return { segs, total };
}

// Point à la fraction u ∈ [0,1] du périmètre.
function rrPoint(rr, u) {
  const d = ((u % 1) + 1) % 1 * rr.total;
  for (const s of rr.segs) {
    if (d <= s.start + s.len + 1e-6) return s.at(Math.max(0, (d - s.start) / s.len));
  }
  return rr.segs[rr.segs.length - 1].at(1);
}

// ————————————————— Construction du plateau —————————————————

const VW = 1520, VH = 1080; // viewBox du plateau

function buildBoard(cells) {
  svg.setAttribute('viewBox', `0 0 ${VW} ${VH}`);
  svg.innerHTML = '';
  cellCentroids = [];

  const defs = document.createElementNS(NS, 'defs');
  svg.appendChild(defs);

  const gCells = document.createElementNS(NS, 'g');
  const gCenter = document.createElementNS(NS, 'g');
  const gTraps = document.createElementNS(NS, 'g');
  gTraps.id = 'traps';
  const gPawns = document.createElementNS(NS, 'g');
  gPawns.id = 'pawns';
  svg.appendChild(gCells); svg.appendChild(gCenter); svg.appendChild(gTraps); svg.appendChild(gPawns);

  const N = cells.length;
  const M = 34;                 // marge extérieure
  const lw = 118, gap = 12;     // largeur de couloir + espace entre anneaux

  // répartit les cases : anneaux concentriques (le dernier peut être partiel,
  // effet spirale) puis une rangée centrale qui se termine sur l'ARRIVÉE
  let placed = 0, ring = 0;
  const layout = []; // par case : {pts}
  let innerRect = null;
  const IDEAL = 172; // longueur cible d'une case le long de l'anneau
  const ROW = 5;     // cases réservées à la rangée centrale

  while (placed < N) {
    const inset = M + ring * (lw + gap);
    const rx = inset, ry = inset, rw = VW - 2 * inset, rh = VH - 2 * inset;
    const remaining = N - placed;

    // plus assez de place pour un anneau, ou presque fini → rangée centrale
    if (rw - 2 * lw < 3 * lw || rh - 2 * lw < 3 * lw || remaining <= ROW + 3) {
      innerRect = { x: rx, y: ry, w: rw, h: rh };
      break;
    }

    const rOut = Math.max(26, Math.min(96, rw / 5, rh / 5));
    const rIn = Math.max(14, rOut - lw * 0.75);
    const outer = rrSegments(rx, ry, rw, rh, rOut);
    const inner = rrSegments(rx + lw, ry + lw, rw - 2 * lw, rh - 2 * lw, rIn);

    // capacité naturelle de l'anneau ; s'il reste moins, l'anneau sera partiel
    // (les cases gardent leur taille normale au lieu de s'étirer)
    const cap = Math.max(8, Math.floor(outer.total / IDEAL));
    let m = remaining - cap < ROW + 2 ? Math.max(1, remaining - ROW) : cap;
    m = Math.min(m, cap);
    const frac = 1 / cap;

    for (let j = 0; j < m; j++) {
      const u1 = j * frac, u2 = (j + 1) * frac;
      const S = 7;
      const pts = [];
      for (let k = 0; k <= S; k++) pts.push(rrPoint(outer, u1 + (u2 - u1) * (k / S)));
      for (let k = S; k >= 0; k--) pts.push(rrPoint(inner, u1 + (u2 - u1) * (k / S)));
      layout.push({ pts });
      placed++;
      if (placed >= N) break;
    }
    ring++;
  }
  if (!innerRect) {
    const inset = M + ring * (lw + gap);
    innerRect = { x: inset, y: inset, w: VW - 2 * inset, h: VH - 2 * inset };
  }

  // rangée centrale pour les cases restantes
  const remaining = N - placed;
  if (remaining > 0 && innerRect) {
    const cw = Math.min(170, (innerRect.w - 40) / remaining);
    const ch = Math.min(120, innerRect.h - 20);
    const totalW = cw * remaining;
    const x0 = innerRect.x + (innerRect.w - totalW) / 2;
    const yMid = innerRect.y + innerRect.h * 0.62 - ch / 2;
    for (let j = 0; j < remaining; j++) {
      const x = x0 + j * cw;
      layout.push({ pts: [
        { x: x + 3, y: yMid }, { x: x + cw - 3, y: yMid },
        { x: x + cw - 3, y: yMid + ch }, { x: x + 3, y: yMid + ch },
      ] });
      placed++;
    }
  }

  // ——— dessin des cases ———
  cells.forEach((cell, i) => {
    const { pts } = layout[i];
    let cx = 0, cy = 0;
    pts.forEach(p => { cx += p.x; cy += p.y; });
    cx /= pts.length; cy /= pts.length;
    cellCentroids[i] = { x: cx, y: cy };

    const poly = document.createElementNS(NS, 'polygon');
    poly.setAttribute('points', pts.map(p => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' '));
    poly.setAttribute('fill', cellColor(cell));
    poly.setAttribute('stroke', 'rgba(247, 232, 195, .55)');
    poly.setAttribute('stroke-width', '3');
    poly.setAttribute('stroke-linejoin', 'round');
    gCells.appendChild(poly);

    // numéro
    const num = document.createElementNS(NS, 'text');
    num.setAttribute('x', cx); num.setAttribute('y', cy - 32);
    num.setAttribute('font-size', '16');
    num.setAttribute('opacity', '.7');
    num.textContent = `${i + 1}.`;
    gCells.appendChild(num);

    // libellé seul (sans emoji : lisibilité maximale), contour sombre
    const lines = wrapLabel(displayLabel(cell));
    const fs = lines.length >= 3 ? 20.5 : 24;
    lines.forEach((line, li) => {
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', cx);
      t.setAttribute('y', cy - 9 + li * (fs + 2) + (3 - lines.length) * 8);
      t.setAttribute('font-size', fs);
      t.setAttribute('stroke', '#1c0f08');
      t.setAttribute('stroke-width', '3.5');
      t.setAttribute('paint-order', 'stroke');
      t.setAttribute('stroke-linejoin', 'round');
      t.textContent = line;
      gCells.appendChild(t);
    });
  });

  // ——— zone centrale : UNI.VERRE ———
  if (innerRect) {
    const gx = innerRect.x + innerRect.w / 2;
    const gy = innerRect.y + innerRect.h * 0.24;
    const g = document.createElementNS(NS, 'g');
    g.setAttribute('transform', `translate(${gx}, ${gy})`);
    g.innerHTML = `
      <rect x="-190" y="-46" width="380" height="112" rx="24"
            fill="rgba(0,0,0,.55)" stroke="#e8c877" stroke-width="3"/>
      <text x="-52" y="8" font-size="46" letter-spacing="4" fill="#e8c877">UNI.VERRE</text>
      <text x="-52" y="44" font-size="20" fill="#f7e8c3" opacity=".8">le dernier le boira…</text>
      <clipPath id="uniClip"><path d="M 96 -30 L 156 -30 L 148 18 Q 146 30 126 30 Q 106 30 104 18 Z"/></clipPath>
      <rect id="uniLiquid" x="96" y="30" width="60" height="0" fill="rgba(255, 170, 60, .55)" clip-path="url(#uniClip)"/>
      <path d="M 96 -30 L 156 -30 L 148 18 Q 146 30 126 30 Q 106 30 104 18 Z"
            fill="rgba(255, 210, 120, .12)" stroke="#e8c877" stroke-width="3"/>
      <rect x="104" y="34" width="44" height="6" rx="3" fill="#e8c877"/>
      <text id="uniCount" x="126" y="8" font-size="34" fill="#ffe9b0" stroke="#1c0f08" stroke-width="3" paint-order="stroke">0</text>
    `;
    gCenter.appendChild(g);
  }
}

function displayLabel(cell) {
  if (snap && snap.noShots) return cell.label.replace(/1 SHOT/g, '5 GORGÉES');
  return cell.label;
}

function wrapLabel(label) {
  const words = label.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > 13 && cur) { lines.push(cur); cur = w; }
    else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3);
}

// Chaque famille d'effet a SA couleur : les cases du même style se ressemblent.
const FAMILIES = {
  boire:   { color: 'hsl(14, 62%, 31%)',  label: 'Tu bois',        types: ['boit', 'shot', 'fini-verre'] },
  donner:  { color: 'hsl(33, 65%, 33%)',  label: 'Tu fais boire',  types: ['distribue', 'fini-droite', 'fini-gauche', 'tous-boivent', 'bois-pour-tous'] },
  uni:     { color: 'hsl(165, 45%, 26%)', label: 'Uni.verre',      types: ['uni-plus', 'uni-gorgees'] },
  deplace: { color: 'hsl(215, 50%, 34%)', label: 'Déplacement',    types: ['saute', 'retourne'] },
  gel:     { color: 'hsl(197, 58%, 34%)', label: 'Gel / Freeze',   types: ['gel', 'gel-suivant', 'freeze'] },
  defi:    { color: 'hsl(345, 50%, 33%)', label: 'Défi',           types: ['bras-de-fer', 'duel', 'roulette', 'valise', 'imite', 'meduse'] },
  gage:    { color: 'hsl(300, 38%, 33%)', label: 'Parole & gages', types: ['question', 'ficha', 'mot-interdit', 'compliments', 'invente-regle', 'echange-verre', 'change-recipient'] },
  carte:   { color: 'hsl(262, 52%, 38%)', label: 'Pioche 🃏',      types: ['carte'] },
};
const TYPE_COLOR = {};
for (const f of Object.values(FAMILIES)) for (const t of f.types) TYPE_COLOR[t] = f.color;

function cellColor(cell) {
  if (cell.type === 'depart') return 'hsl(95, 45%, 30%)';
  if (cell.type === 'arrivee') return 'hsl(45, 70%, 34%)';
  return TYPE_COLOR[cell.type] || 'hsl(25, 35%, 32%)';
}

// ————————————————— Pions —————————————————

function pawnPos(cellIdx, slot, count) {
  const c = cellCentroids[cellIdx] || { x: VW / 2, y: VH / 2 };
  if (count <= 1) return { x: c.x, y: c.y + 26 };
  const a = (slot / count) * Math.PI * 2 - Math.PI / 2;
  return { x: c.x + Math.cos(a) * 26, y: c.y + 26 + Math.sin(a) * 14 };
}

function renderTraps() {
  const g = document.getElementById('traps');
  if (!g || !snap) return;
  g.innerHTML = '';
  for (const cellIdx of snap.traps || []) {
    const c = cellCentroids[cellIdx];
    if (!c) continue;
    const grp = document.createElementNS(NS, 'g');
    grp.setAttribute('class', 'trapBadge');
    grp.innerHTML = `
      <circle cx="${c.x + 38}" cy="${c.y + 34}" r="19" fill="#200808" stroke="#ff5c5c" stroke-width="2.5"/>
      <text x="${c.x + 38}" y="${c.y + 42}" font-size="22" text-anchor="middle">💣</text>`;
    g.appendChild(grp);
  }
}

function renderPawns() {
  const gPawns = $('pawns');
  if (!gPawns || !snap) return;
  const byCell = {};
  for (const p of snap.players) (byCell[p.pos] = byCell[p.pos] || []).push(p);

  for (const p of snap.players) {
    let el = document.getElementById(`pawn-${p.id}`);
    if (!el) {
      el = document.createElementNS(NS, 'g');
      el.id = `pawn-${p.id}`;
      el.style.transition = 'transform .24s cubic-bezier(.34, 1.7, .5, 1)';
      el.innerHTML = `
        <circle class="halo" r="34" fill="none" stroke="${p.color}" stroke-width="3" opacity="0"/>
        <circle r="26" fill="${p.color}" stroke="#1c0f08" stroke-width="3"/>
        <clipPath id="clip-${p.id}"><circle r="22"/></clipPath>
        <image href="${avatarSrc(p)}" x="-22" y="-22" width="44" height="44"
               clip-path="url(#clip-${p.id})" preserveAspectRatio="xMidYMid slice"/>
        <circle r="26" fill="none" stroke="${p.color}" stroke-width="3.5"/>`;
      gPawns.appendChild(el);
    }
    if (!animating.has(p.id)) {
      const group = byCell[p.pos];
      const pos = pawnPos(p.pos, group.indexOf(p), group.length);
      el.setAttribute('transform', `translate(${pos.x}, ${pos.y})`);
      el.style.opacity = p.online ? 1 : 0.45;
    }
    const halo = el.querySelector('.halo');
    if (halo) halo.classList.toggle('on', snap.turn === p.id && snap.phase === 'playing');
  }
  // retire les pions des joueurs partis
  for (const el of [...gPawns.children]) {
    const id = parseInt(el.id.replace('pawn-', ''), 10);
    if (!snap.players.find(p => p.id === id)) el.remove();
  }
}

function animateMove(playerId, from, to) {
  const el = document.getElementById(`pawn-${playerId}`);
  if (!el) { socket.emit('anim-done', playerId); return; }
  animating.add(playerId);
  const dir = to > from ? 1 : -1;
  let cur = from;
  const step = () => {
    cur += dir;
    SFX.step();
    const pos = pawnPos(cur, 0, 1);
    el.setAttribute('transform', `translate(${pos.x}, ${pos.y - 8})`);
    if (cur !== to) setTimeout(step, 240);
    else setTimeout(() => {
      animating.delete(playerId);
      renderPawns();
      landRipple(to);
      socket.emit('anim-done', playerId);
    }, 260);
  };
  if (from === to) { animating.delete(playerId); socket.emit('anim-done', playerId); return; }
  step();
}

// ondulation dorée quand un pion atterrit sur une case
function landRipple(cellIdx) {
  const c = cellCentroids[cellIdx];
  const gPawns = document.getElementById('pawns');
  if (!c || !gPawns) return;
  const r = document.createElementNS(NS, 'circle');
  r.setAttribute('cx', c.x); r.setAttribute('cy', c.y + 26);
  r.setAttribute('class', 'ripple');
  gPawns.parentNode.insertBefore(r, gPawns);
  setTimeout(() => r.remove(), 700);
}

// ————————————————— HUD latéral —————————————————

// avatar de secours : initiale sur fond de la couleur du joueur
function fallbackAvatar(p) {
  const letter = (p.name || '?')[0].toUpperCase();
  const s = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100" fill="${p.color || '#888'}"/><text x="50" y="68" font-size="52" font-family="sans-serif" font-weight="bold" fill="#fff" text-anchor="middle">${letter}</text></svg>`;
  return 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(s)));
}
function avatarSrc(p) { return p.avatar || fallbackAvatar(p); }
function avatarImg(p, cls = '') {
  return `<img class="${cls}" src="${avatarSrc(p)}" alt=""/>`;
}

function renderSide() {
  if (!snap) return;
  $('seedTag').textContent = `plateau #${snap.seed}`;

  const turnP = snap.players.find(p => p.id === snap.turn);
  if (snap.phase === 'playing' && turnP) {
    let hint = 'lance le dé…';
    if (snap.pending) {
      const map = { distribute: 'distribue des gorgées…', pick: 'fait un choix…', text: 'écrit…', ok: 'exécute sa mission…', roll: 'lance le dé…' };
      hint = map[snap.pending.type] || '…';
    } else if (snap.collect) {
      hint = 'la table décide…';
    }
    $('turnbox').innerHTML = `${avatarImg(turnP)}<div><div class="t1">Au tour de</div><div class="t2">${esc(turnP.name)} <small style="font-size:15px;opacity:.7">${hint}</small></div></div>`;
  } else {
    $('turnbox').innerHTML = `<div class="t1">${snap.phase === 'lobby' ? 'En attente de joueurs…' : 'Partie terminée'}</div>`;
  }

  $('playersPanel').innerHTML = snap.players.map(p => {
    const badges = [
      p.frozen ? '❄️' : '',
      p.benched ? '🚪' : '',
      p.boitPourTous ? '🐫' : '',
      p.finished ? '🏁' : '',
      p.handCount ? `🃏×${p.handCount}` : '',
      p.ancre ? '⚓' : '',
      snap.motInterdit && snap.motInterdit.by === p.id ? '🤫' : '',
      snap.freeze && snap.freeze.by === p.id ? '🥶' : '',
      (snap.chains || []).some(c => c.a === p.id || c.b === p.id) ? '⛓️' : '',
    ].join(' ');
    return `<div class="pcard ${p.id === snap.turn ? 'turn' : ''} ${p.online ? '' : 'offline'}" style="border-left-color:${p.color}">
      ${avatarImg(p)}
      <div class="pname">${esc(p.name)} <span class="badges">${badges}</span></div>
      <div class="pstats"><span>🍺 ${p.gorgees}</span><span>🥃 ${p.shots}</span>${p.finis ? `<span>🍻 ${p.finis}</span>` : ''}</div>
    </div>`;
  }).join('');

  const rules = snap.rules || [];
  $('rulesPanel').classList.toggle('hidden', rules.length === 0);
  $('rulesList').innerHTML = rules.map(r => `<li>« ${esc(r.text)} » <small>— ${esc(r.by)}</small></li>`).join('');

  const chips = [];
  if (snap.noShots) {
    chips.push('🚫🥃 Mode sans shots : chaque shot vaut 5 gorgées');
  }
  // qui doit jouer / répondre en ce moment (toujours visible)
  if (snap.phase === 'playing') {
    if (snap.collect) {
      const waiting = (snap.collect.waitingIds || []).map(id => { const p = snap.players.find(x => x.id === id); return p ? p.name : '?'; });
      chips.push(`<b>⌛ ${esc(snap.collect.prompt || 'Décision en cours')}</b><br/>On attend : ${waiting.map(esc).join(', ') || 'personne'} (${snap.collect.answered}/${snap.collect.total} réponses)`);
    } else if (snap.pending && snap.pending.type !== 'roll') {
      const p = snap.players.find(x => x.id === snap.pending.playerId);
      const map = { distribute: 'distribue des gorgées', pick: 'fait un choix', text: 'écrit', ok: 'fait sa mission' };
      chips.push(`⌛ On attend <b>${esc(p ? p.name : '?')}</b> : ${map[snap.pending.type] || 'joue'} sur son téléphone…`);
    }
  }
  if (snap.vote) {
    const t = snap.players.find(p => p.id === snap.vote.targetId);
    const why = snap.vote.reason === 'offline' ? 'est déconnecté·e' : 'ne joue pas';
    chips.push(`🗳️ ${esc(t ? t.name : '?')} ${why} — vote en cours : 🚪 tèj ${snap.vote.tej} / 🕰 attend ${snap.vote.wait} (${snap.vote.tej + snap.vote.wait}/${snap.vote.total})`);
  }
  if (snap.motInterdit) {
    const by = snap.players.find(p => p.id === snap.motInterdit.by);
    chips.push(`🤫 MOT INTERDIT : « <b>${esc(snap.motInterdit.word)}</b> » (posé par ${esc(by ? by.name : '?')}) — le dire = ${snap.noShots ? '5 gorgées' : '1 shot'} ! Balancez sur vos téléphones`);
  }
  if (snap.freeze) {
    const by = snap.players.find(p => p.id === snap.freeze.by);
    chips.push(`🥶 FREEZE armé par ${esc(by ? by.name : '?')} — dès qu'il/elle se fige, figez-vous : le dernier immobile boit ${snap.freeze.n} !`);
  }
  for (const p of snap.players) {
    if (p.boitPourTous) chips.push(`🐫 <b>${esc(p.name)}</b> boit à la place de tout le monde jusqu'à son prochain tour`);
    if (p.frozen) chips.push(`❄️ <b>${esc(p.name)}</b> est gelé·e : passe son prochain tour`);
    if (p.ancre) chips.push(`⚓ Prochain dé de <b>${esc(p.name)}</b> divisé par deux`);
  }
  const nTraps = (snap.traps || []).length;
  if (nTraps) chips.push(`💣 ${nTraps} bombe${nTraps > 1 ? 's' : ''} piégée${nTraps > 1 ? 's' : ''} sur le plateau : s'y arrêter = ${snap.noShots ? '5 gorgées' : '1 shot'}`);
  for (const cb of snap.corbeaux || []) {
    chips.push(`💌 Corbeau anonyme : « ${esc(cb)} »`);
  }
  for (const ch of snap.chains || []) {
    const a = snap.players.find(p => p.id === ch.a), b = snap.players.find(p => p.id === ch.b);
    chips.push(`⛓️ ${esc(a ? a.name : '?')} et ${esc(b ? b.name : '?')} sont menottés : quand l'un boit, l'autre boit`);
  }
  $('statusPanel').innerHTML = chips.map(c => `<div class="statusChip">${c}</div>`).join('');

  const uniEl = document.getElementById('uniCount');
  if (uniEl && uniEl.textContent !== String(snap.uniVerre)) {
    uniEl.textContent = snap.uniVerre;
    uniEl.style.animation = 'none';
    void uniEl.getBBox && uniEl.getBoundingClientRect();
    uniEl.style.animation = 'uniPop .5s';
    SFX.pour && SFX.pour();
  }
  const liquid = document.getElementById('uniLiquid');
  if (liquid) {
    const h = Math.min(56, snap.uniVerre * 3.2);
    liquid.setAttribute('y', 30 - h);
    liquid.setAttribute('height', h);
    liquid.style.transition = 'y .6s, height .6s';
  }
}

function esc(s) { return String(s).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c])); }

// ————————————————— Bannière + fil —————————————————

// chaque action bloque l'écran quelques secondes, façon FREEZE :
// grand icône + avatar + texte, pour que toute la table voie ce qui se passe
let takeTimer = null;
function showBanner(ev) {
  const p = ev.playerId ? snap.players.find(x => x.id === ev.playerId) : null;
  const t = $('takeover');
  t.className = 'tk-' + (['drink', 'card', 'status', 'uni', 'win', 'move', 'action'].includes(ev.kind) ? ev.kind : 'info');
  $('tkIcon').textContent = ev.icon || '';
  const av = $('tkAvatar');
  if (p) { av.src = avatarSrc(p); av.classList.remove('hidden'); }
  else av.classList.add('hidden');
  $('tkText').textContent = ev.text;
  clearTimeout(takeTimer);
  takeTimer = setTimeout(() => t.classList.add('tk-hidden'), ev.kind === 'info' ? 2500 : 3400);

  const item = document.createElement('div');
  item.className = 'feedItem';
  item.textContent = `${ev.icon || ''} ${ev.text}`;
  $('feed').prepend(item);
  while ($('feed').children.length > 7) $('feed').lastChild.remove();
}

// ————————————————— Overlays —————————————————

function showDice(playerId, value, anchored) {
  const p = snap.players.find(x => x.id === playerId);
  $('diceOverlay').classList.remove('hidden');
  $('diceWho').textContent = (p ? p.name : '') + (anchored ? ' ⚓ (ancré !)' : '');
  const cube = $('diceCube');
  cube.classList.add('rolling');
  let ticks = 0;
  const spin = setInterval(() => {
    cube.textContent = 1 + Math.floor(Math.random() * 6);
    if (++ticks > 8) {
      clearInterval(spin);
      cube.classList.remove('rolling');
      cube.textContent = value;
      setTimeout(() => $('diceOverlay').classList.add('hidden'), 900);
    }
  }, 110);
}

function showDuel(a, b) {
  const pa = snap.players.find(x => x.id === a.playerId);
  const pb = snap.players.find(x => x.id === b.playerId);
  const side = (el, p) => { el.innerHTML = `${avatarImg(p)}<div class="dname">${esc(p.name)}</div><div class="ddie rolling">?</div>`; };
  side($('duelA'), pa); side($('duelB'), pb);
  $('duelOverlay').classList.remove('hidden');
  setTimeout(() => {
    const dieA = $('duelA').querySelector('.ddie'), dieB = $('duelB').querySelector('.ddie');
    dieA.classList.remove('rolling'); dieB.classList.remove('rolling');
    dieA.textContent = a.value; dieB.textContent = b.value;
  }, 1600);
  setTimeout(() => $('duelOverlay').classList.add('hidden'), 3600);
}

function showCard(card) {
  $('cardIcon').textContent = card.icon;
  $('cardTitle').textContent = card.title;
  $('cardText').textContent = card.text;
  $('cardFlip').classList.remove('flipped');
  $('cardOverlay').classList.remove('hidden');
  setTimeout(() => $('cardFlip').classList.add('flipped'), 500);
  setTimeout(() => $('cardOverlay').classList.add('hidden'), 4000);
}

function showMedusa() {
  $('medusaOverlay').classList.remove('hidden');
  speak('Méduse ! Baissez tous la tête.');
  $('medusaCount').textContent = '🙇';
  let n = 3;
  setTimeout(function tick() {
    if (n > 0) {
      $('medusaCount').textContent = n;
      speak(String(n));
      SFX.heart();
      n--;
      setTimeout(tick, 1300);
    } else {
      $('medusaCount').textContent = '👀 !';
      speak('Levez les yeux !');
      SFX.freeze();
      setTimeout(() => $('medusaOverlay').classList.add('hidden'), 2200);
    }
  }, 2600);
}

function showFreeze() {
  SFX.freeze();
  speak('Freeze !');
  $('freezeOverlay').classList.remove('hidden');
  setTimeout(() => $('freezeOverlay').classList.add('hidden'), 5000);
}



// ————————————————— Lobby & fin —————————————————

async function initLobbyInfo() {
  const info = await fetch('/info').then(r => r.json());
  $('qr').src = info.qr;
  $('joinUrl').textContent = info.url;
}

function renderLobby() {
  // table vue du dessus : chacun a tapé sa place sur son téléphone
  const S = snap.seats || 12;
  const W = 560, H = 340, cx = W / 2, cy = H / 2, rx = 210, ry = 122;
  let seats = '';
  for (let i = 0; i < S; i++) {
    const a = (i / S) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * rx;
    const y = cy + Math.sin(a) * ry;
    const p = snap.players.find(pl => pl.seat === i);
    if (p) {
      seats += `<clipPath id="lc${i}"><circle cx="${x}" cy="${y}" r="26"/></clipPath>
        <image href="${avatarSrc(p)}" x="${x - 26}" y="${y - 26}" width="52" height="52" clip-path="url(#lc${i})" preserveAspectRatio="xMidYMid slice"/>
        <circle cx="${x}" cy="${y}" r="28" fill="none" stroke="${p.color}" stroke-width="4"/>
        ${snap.players[0] && snap.players[0].id === p.id ? `<text x="${x}" y="${y - 34}" font-size="20" text-anchor="middle">👑</text>` : ''}
        <text x="${x}" y="${y + 46}" font-size="14" fill="#f7e8c3" text-anchor="middle" font-weight="600">${esc(p.name.slice(0, 10))}</text>`;
    } else {
      seats += `<circle cx="${x}" cy="${y}" r="24" fill="rgba(255,255,255,.07)" stroke="rgba(232,200,119,.45)" stroke-width="2" stroke-dasharray="4 4"/>`;
    }
  }
  $('lobbyTable').innerHTML = `
    <ellipse cx="${cx}" cy="${cy}" rx="${rx - 52}" ry="${ry - 40}" fill="#55371f" stroke="#e8c877" stroke-width="4"/>
    <ellipse cx="${cx}" cy="${cy - 5}" rx="${rx - 64}" ry="${ry - 50}" fill="#6a4527"/>
    <text x="${cx}" y="${cy + 8}" font-size="26" fill="#e8c877" text-anchor="middle" font-family="Bebas Neue, sans-serif" letter-spacing="3">UNI.VERRE</text>
    ${seats}`;
  const seated = snap.players.filter(p => p.seat !== null && p.seat !== undefined).length;
  const nb = snap.players.length
    ? `${seated}/${snap.players.length} joueur${snap.players.length > 1 ? 's' : ''} installé${seated > 1 ? 's' : ''} à table`
    : '';
  $('lobbySeated').innerHTML = nb + (snap.noShots ? '<br/><span style="color:#ff9d7a">🚫🥃 Mode sans shots : chaque shot vaudra 5 gorgées</span>' : '');
}



function renderOver() {
  if (!snap.ranking) return;
  const get = id => snap.players.find(p => p.id === id);
  const order = snap.ranking.order.map(get).filter(Boolean);
  const sizes = [150, 110, 90];
  const heights = [110, 78, 54];
  const podium = order.slice(0, 3).map((p, i) =>
    `<div class="podiumSlot" style="order:${i === 0 ? 2 : i === 1 ? 1 : 3}">
      <div style="font-size:${i === 0 ? 40 : 28}px">${['🥇', '🥈', '🥉'][i]}</div>
      <img src="${avatarSrc(p)}" style="width:${sizes[i]}px;height:${sizes[i]}px"/>
      <b>${esc(p.name)}</b>
      <div class="step" style="height:${heights[i]}px">${i + 1}</div>
    </div>`).join('');
  $('podium').innerHTML = podium;
  const loser = get(snap.ranking.uniVerreLoser);
  $('uniFinal').textContent = loser && snap.ranking.uniVerreAmount > 0
    ? `🏺 ${loser.name} termine dernier·e et boit l'UNI.VERRE : ${snap.ranking.uniVerreAmount} gorgées !`
    : '🏺 L\'UNI.VERRE était vide, miracle.';
  $('finalStats').innerHTML = snap.players.map(p =>
    `<div class="fstat"><img src="${avatarSrc(p)}"/><b>${esc(p.name)}</b>
     <span>🍺 ${p.gorgees} gorgées · 🥃 ${p.shots} shots${p.finis ? ` · 🍻 ${p.finis} verres finis` : ''}</span>
     <span style="opacity:.6">Soirée : ${p.totalGorgees} 🍺 / ${p.totalShots} 🥃</span></div>`
  ).join('');
}

// ————————————————— Ambiance : sons, voix, confettis —————————————————

let AC = null;
function ac() {
  if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
  if (AC.state === 'suspended') AC.resume();
  return AC;
}
function tone(freq, dur, { type = 'sine', gain = 0.16, when = 0, slide = 0 } = {}) {
  try {
    const ctx = ac();
    if (ctx.state !== 'running') return;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.value = freq;
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), ctx.currentTime + when + dur);
    g.gain.setValueAtTime(gain, ctx.currentTime + when);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + when + dur);
    o.connect(g); g.connect(ctx.destination);
    o.start(ctx.currentTime + when); o.stop(ctx.currentTime + when + dur + 0.05);
  } catch (e) { /* pas de son, pas de drame */ }
}
function noise(dur, { gain = 0.25, when = 0 } = {}) {
  try {
    const ctx = ac();
    if (ctx.state !== 'running') return;
    const buf = ctx.createBuffer(1, ctx.sampleRate * dur, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    const s = ctx.createBufferSource(); s.buffer = buf;
    const g = ctx.createGain(); g.gain.value = gain;
    s.connect(g); g.connect(ctx.destination);
    s.start(ctx.currentTime + when);
  } catch (e) { }
}
const SFX = {
  dice() { for (let i = 0; i < 7; i++) tone(280 + Math.random() * 620, 0.045, { type: 'square', gain: 0.055, when: i * 0.09 }); tone(660, 0.1, { when: 0.68, gain: 0.16 }); tone(990, 0.28, { when: 0.78, gain: 0.2 }); },
  step() { tone(500 + Math.random() * 160, 0.055, { type: 'triangle', gain: 0.11 }); },
  drink() { // glou-glou bien liquide
    [220, 175, 140].forEach((f, i) => { tone(f, 0.11, { gain: 0.22, when: i * 0.12, slide: -35 }); });
    noise(0.09, { gain: 0.05, when: 0.35 });
  },
  shot() { tone(880, 0.07, { type: 'square', gain: 0.16 }); tone(1320, 0.16, { when: 0.08, gain: 0.2 }); noise(0.08, { gain: 0.08, when: 0.05 }); },
  pour() { tone(300, 0.5, { type: 'sine', gain: 0.12, slide: 260 }); noise(0.4, { gain: 0.04 }); },
  status() { tone(660, 0.1, { gain: 0.12 }); tone(880, 0.12, { when: 0.1, gain: 0.12 }); },
  card() { noise(0.14, { gain: 0.1 }); [780, 1040, 1300].forEach((f, i) => tone(f, 0.1, { when: 0.08 + i * 0.07, gain: 0.09 })); },
  boom() { noise(0.7, { gain: 0.5 }); tone(70, 0.5, { type: 'sawtooth', gain: 0.3, slide: -40 }); },
  vote() { tone(740, 0.1, { gain: 0.13 }); tone(560, 0.14, { when: 0.11, gain: 0.13 }); },
  freeze() { tone(1400, 0.5, { type: 'sine', gain: 0.14, slide: -900 }); },
  win() { [523, 659, 784, 1047, 784, 1047, 1319].forEach((f, i) => tone(f, 0.24, { when: i * 0.13, gain: 0.17 })); },
  start() { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.18, { when: i * 0.11, gain: 0.14 })); },
  turn() { tone(440, 0.08, { gain: 0.07 }); },
  heart() { tone(75, 0.12, { type: 'sine', gain: 0.3 }); tone(70, 0.1, { when: 0.16, gain: 0.24 }); },
};
function speak(text, { interrupt = false } = {}) {
  try {
    if (!window.speechSynthesis) return;
    if (interrupt) speechSynthesis.cancel();
    const clean = String(text).replace(/[^\p{L}\p{N}\s'’«»:!?,.\-–]/gu, ' ').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = 'fr-FR'; u.rate = 1.05; u.pitch = 1.0; u.volume = 1;
    speechSynthesis.speak(u);
  } catch (e) { }
}
// Chrome bloque le son avant un geste sur la page : petit bouton une fois
function checkAudioGate() {
  try {
    const ctx = ac();
    $('soundBtn').classList.toggle('hidden', ctx.state === 'running');
  } catch (e) { }
}
document.addEventListener('click', () => { try { ac(); speechSynthesis && speechSynthesis.resume(); } catch (e) { } setTimeout(checkAudioGate, 200); });
setInterval(checkAudioGate, 3000);

// confettis (canvas plein écran)
function confetti(durationMs = 5000) {
  const cv = $('confetti');
  cv.classList.remove('hidden');
  const ctx2 = cv.getContext('2d');
  cv.width = innerWidth; cv.height = innerHeight;
  const parts = [];
  const colors = ['#e8c877', '#ff8a65', '#4fc3f7', '#aed581', '#f06292', '#fff3d6'];
  for (let i = 0; i < 160; i++) parts.push({
    x: Math.random() * cv.width, y: -20 - Math.random() * cv.height * 0.5,
    vy: 2 + Math.random() * 3.5, vx: -1 + Math.random() * 2,
    s: 6 + Math.random() * 8, r: Math.random() * Math.PI, vr: -0.1 + Math.random() * 0.2,
    c: colors[Math.floor(Math.random() * colors.length)],
  });
  const t0 = Date.now();
  (function frame() {
    ctx2.clearRect(0, 0, cv.width, cv.height);
    for (const p of parts) {
      p.x += p.vx; p.y += p.vy; p.r += p.vr;
      ctx2.save(); ctx2.translate(p.x, p.y); ctx2.rotate(p.r);
      ctx2.fillStyle = p.c; ctx2.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx2.restore();
    }
    if (Date.now() - t0 < durationMs) requestAnimationFrame(frame);
    else { ctx2.clearRect(0, 0, cv.width, cv.height); cv.classList.add('hidden'); }
  })();
}

// ————————————————— Socket —————————————————

socket.on('connect', () => socket.emit('register-screen'));

socket.on('game', (s) => {
  snap = s;
  const boardKey = s.seed + (s.noShots ? ':ns' : '');
  if (boardKey !== boardSeed) {
    boardSeed = boardKey;
    buildBoard(s.board);
    animating.clear();
  }
  $('lobby').style.display = s.phase === 'lobby' ? 'flex' : 'none';
  $('overScreen').classList.toggle('hidden', s.phase !== 'over');
  if (s.phase === 'lobby') renderLobby();
  if (s.phase === 'over' && !overShown) { overShown = true; renderOver(); confetti(6000); }
  if (s.phase !== 'over') overShown = false;
  if (s.phase === 'over') renderOver();
  if (s.phase === 'playing' && lastPhase !== 'playing') SFX.start();
  lastPhase = s.phase;
  if (s.turn !== lastTurn) { lastTurn = s.turn; if (s.phase === 'playing') SFX.turn(); }
  renderSide();
  renderPawns();
  renderTraps();
});
let overShown = false;
let lastTurn = null;
let lastPhase = null;

socket.on('event', (ev) => {
  showBanner(ev);
  if (ev.kind === 'drink') {
    (ev.text || '').includes('shot') ? SFX.shot() : SFX.drink();
    speak(ev.text, { interrupt: true }); // l'écran annonce qui boit
  }
  else if (ev.kind === 'uni') SFX.pour();
  else if (ev.kind === 'card') SFX.card();
  else if (ev.kind === 'win') { SFX.win(); speak(ev.text, { interrupt: true }); }
  else if (ev.kind === 'status' || ev.kind === 'action') SFX.status();
  // les cartes activées sont annoncées à voix haute
  if (ev.voice && ev.kind !== 'drink' && ev.kind !== 'win') speak(ev.text, { interrupt: true });
});
socket.on('dice', ({ playerId, value, anchored }) => { SFX.dice(); showDice(playerId, value, anchored); });
socket.on('move', ({ playerId, from, to }) => animateMove(playerId, from, to));
socket.on('card', ({ card }) => showCard(card));
socket.on('meduse', showMedusa);
socket.on('freeze', showFreeze);
socket.on('duel', ({ a, b }) => showDuel(a, b));
socket.on('trap-boom', () => {
  SFX.boom();
  document.body.classList.add('shake');
  setTimeout(() => document.body.classList.remove('shake'), 700);
  const flash = $('boomFlash');
  flash.classList.remove('hidden');
  setTimeout(() => flash.classList.add('hidden'), 600);
});
socket.on('card-draw', () => SFX.card());

initLobbyInfo();
