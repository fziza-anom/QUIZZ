'use strict';
// Blind test multijoueur : écran animateur (/ecran) + téléphones des joueurs (/).
const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec } = require('child_process');
const { Server } = require('socket.io');
const QRCode = require('qrcode');
const { pickDistractors } = require('./qcm');

const ROOT = __dirname;
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8').replace(/^﻿/, ''));

const config = Object.assign(
  { titre: 'Blind Test', lot: '', manches: 10, gagnants: 2, secondesReponse: 10, port: 3000 },
  readJson('config.json')
);
const PORT = Number(process.env.PORT) || config.port;
const WINNERS = config.gagnants;
// la chanson joue pendant que le QCM est affiché : une seule phase de réponse
const T = { ready: 3000, answer: config.secondesReponse * 1000 };
const MAX_PTS = 1000; // réponse instantanée
const MIN_PTS = 500;  // bonne réponse à la dernière seconde

// ---------------------------------------------------------------- Réseau
function lanAddresses() {
  const out = [];
  for (const [name, list] of Object.entries(os.networkInterfaces())) {
    for (const a of list || []) if (a.family === 'IPv4' && !a.internal) out.push({ name, address: a.address });
  }
  const score = (a) =>
    (/vEthernet|VirtualBox|VMware|WSL|Hyper-V|Loopback|Bluetooth|Tailscale|ZeroTier|VPN/i.test(a.name) ? -10 : 0) +
    (/^192\.168\./.test(a.address) ? 3 : /^10\./.test(a.address) ? 2 : /^172\./.test(a.address) ? 1 : 0) +
    (/wi-?fi|wlan|sans fil|ethernet/i.test(a.name) ? 2 : 0);
  return out.sort((x, y) => score(y) - score(x));
}
let selectedIp = process.env.HOST_IP || (lanAddresses()[0] || { address: 'localhost' }).address;
// Lien public (tunnel) : le QR code pointe dessus à la place de l'adresse Wi-Fi
const PUBLIC_URL = String(process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const playerUrl = () => (PUBLIC_URL ? PUBLIC_URL + '/' : `http://${selectedIp}:${PORT}/`);
const isLocal = (addr) => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(addr);
// Écran animateur : depuis ce PC, ou à distance avec la clé secrète (?cle=...).
// Via un tunnel, tout semble venir de ce PC : on repère les en-têtes du proxy.
const HOST_KEY = process.env.HOST_KEY || require('crypto').randomBytes(4).toString('hex');
const proxied = (h = {}) => !!(h['cf-connecting-ip'] || h['cf-ray'] || h['x-forwarded-for']);
const isHost = (addr, headers, key) => (isLocal(addr) && !proxied(headers)) || key === HOST_KEY;

// ---------------------------------------------------------------- Chansons
const MUSIC_DIR = path.join(ROOT, 'musiques');
const songs = readJson('songs.json').map((s, i) => ({
  id: i,
  artist: String(s.artiste || '').trim(),
  title: String(s.titre || '').trim(),
  file: s.fichier || null,       // MP3 local dans /musiques (prioritaire sur Deezer)
  deezerId: s.deezerId || null,  // force un titre Deezer précis
  qcmTitle: s.titreQcm || null,   // titre affiché dans le QCM s'il diffère de celui cherché sur Deezer
  choices: (s.choix || []).map((c) => ({ artist: String(c.artiste || '').trim(), title: String(c.titre || '').trim() })),
  style: s.style || null,        // style musical, sert à choisir des mauvaises réponses qui ressemblent
  enabled: s.actif !== false,
  status: 'pending', source: null, cover: null, found: null, audio: null, mime: 'audio/mpeg', error: null,
}));

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const mainArtist = (a) => a.split(/\s+(?:ft\.?|feat\.?|featuring)\s+/i)[0];
const MIME = { '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac', '.ogg': 'audio/ogg', '.wav': 'audio/wav' };

async function getJson(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) throw new Error('Deezer HTTP ' + r.status);
  return r.json();
}

// 4 = même artiste, 2 = proche (orthographe : « Lmnawar » / « Lamnawar »), 0 = autre artiste
function artistMatch(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 4;
  const ca = a.replace(/ /g, ''), cb = b.replace(/ /g, '');
  if (ca === cb) return 4;
  if (ca.length >= 4 && cb.length >= 4 && (ca.includes(cb) || cb.includes(ca))) return 2;
  return similarity(ca, cb) >= 0.8 ? 2 : 0;
}
function similarity(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  }
  return 1 - d[a.length][b.length] / Math.max(a.length, b.length, 1);
}

async function findOnDeezer(song) {
  if (song.deezerId) {
    const t = await getJson('https://api.deezer.com/track/' + song.deezerId);
    if (t.error || !t.preview) throw new Error('deezerId sans extrait');
    return t;
  }
  // plusieurs artistes possibles (« Rachid Taha, Khaled & Faudel ») : chacun peut correspondre
  const first = mainArtist(song.artist).split(',')[0].trim();
  const artists = [song.artist, ...song.artist.split(/,|&|\s+(?:ft\.?|feat\.?|featuring|x)\s+/i)].map(norm).filter(Boolean);
  const title = norm(song.title);
  const plainTitle = song.title.replace(/\(.*?\)/g, '').trim();
  const queries = [
    `artist:"${first}" track:"${song.title}"`,
    `${first} ${plainTitle}`,
    plainTitle, // orthographe de l'artiste différente sur Deezer
  ];
  let fallback = null;
  for (const q of queries) {
    const j = await getJson('https://api.deezer.com/search?limit=25&q=' + encodeURIComponent(q));
    const scored = (j.data || [])
      .map((t) => ({ t, am: Math.max(...artists.map((a) => artistMatch(a, norm(t.artist.name)))) }))
      // l'artiste doit correspondre : on écarte reprises, karaokés et berceuses
      .filter(({ t, am }) => t.preview && am > 0)
      .map(({ t, am }) => {
        const tt = norm(t.title);
        let s = am;
        if (tt === title) s += 3;
        else if (tt.startsWith(title) || tt.includes(title)) s += 1;
        // titre trop différent (ex. « Boom Boom » pour « Dirou Niyya ») : refusé,
        // sauf titre écrit en arabe sur Deezer, impossible à comparer
        else if (tt && similarity(tt.replace(/ /g, ''), title.replace(/ /g, '')) < 0.6) return null;
        if (/live|remix|karaoke|instrumental|cover|acoustic|acoustique/i.test(t.title) && !/live|remix/i.test(song.title)) s -= 2;
        return { t, s };
      })
      .filter(Boolean)
      .sort((a, b) => b.s - a.s || (b.t.rank || 0) - (a.t.rank || 0));
    if (scored.length && scored[0].s >= 5) return scored[0].t;
    if (!fallback && scored.length && scored[0].s >= 2) fallback = scored[0].t;
  }
  if (fallback) return fallback;
  throw new Error('introuvable sur Deezer');
}

async function loadSong(song) {
  song.status = 'loading'; song.error = null; pushHost();
  try {
    if (song.file) {
      const p = path.join(MUSIC_DIR, path.basename(song.file));
      song.audio = fs.readFileSync(p);
      song.mime = MIME[path.extname(p).toLowerCase()] || 'audio/mpeg';
      song.source = 'fichier';
      song.found = { artist: song.artist, title: song.title };
    } else {
      const t = await findOnDeezer(song);
      const r = await fetch(t.preview, { signal: AbortSignal.timeout(20000) });
      if (!r.ok) throw new Error('extrait indisponible');
      song.audio = Buffer.from(await r.arrayBuffer());
      song.mime = 'audio/mpeg';
      song.source = 'deezer';
      song.cover = t.album ? t.album.cover_big || t.album.cover_medium || null : null;
      song.found = { artist: t.artist.name, title: t.title, id: t.id };
    }
    song.status = 'ok';
  } catch (e) {
    song.status = 'error'; song.audio = null;
    song.error = e.code === 'ENOENT' ? 'fichier introuvable dans /musiques' : e.message;
  }
  pushHost();
}

let loading = false;
async function loadAll(force = false) {
  if (loading) return;
  loading = true;
  const queue = songs.filter((s) => force || s.status !== 'ok');
  const worker = async () => { while (queue.length) await loadSong(queue.shift()); };
  await Promise.all([worker(), worker(), worker()]);
  loading = false;
  const ok = songs.filter((s) => s.status === 'ok').length;
  console.log(`\n  Extraits prêts : ${ok}/${songs.length}`);
  for (const s of songs.filter((x) => x.status === 'error')) console.log(`   x ${s.artist} - ${s.title} : ${s.error}`);
  pushHost();
}

// ---------------------------------------------------------------- Partie
const players = new Map(); // id -> joueur
let joinSeq = 0;
let game = freshGame();

function freshGame() {
  return { phase: 'lobby', roundNo: 0, total: 0, playlist: [], reserve: [], round: null, endsAt: 0, timer: null, nextFn: null, tie: null, tieRounds: 0, history: [], stamp: Date.now() };
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const nameOf = (id) => { const p = players.get(id); return p ? `${p.first} ${p.last}` : '?'; };
// Classement : plus de points d'abord. À égalité de points, on compare le temps cumulé
// des BONNES réponses uniquement (p.time, en ms) : le plus faible total l'emporte.
// Une mauvaise réponse ou une absence de réponse vaut 0 point et son temps n'est pas compté.
const cmp = (a, b) => b.score - a.score || a.time - b.time;

function ranked() {
  const list = [...players.values()].sort((a, b) => cmp(a, b) || a.seq - b.seq);
  return list.map((p) => ({ p, rank: 1 + list.filter((q) => cmp(q, p) < 0).length }));
}

// Égalité à la frontière du top N ? -> groupe à départager + nombre de places restantes
function findTie() {
  const list = ranked();
  if (list.length <= WINNERS) return null;
  const a = list[WINNERS - 1], b = list[WINNERS];
  if (cmp(a.p, b.p) !== 0) return null;
  const group = list.filter((x) => cmp(x.p, a.p) === 0).map((x) => x.p.id);
  return { group, spots: WINNERS - (a.rank - 1) };
}

function setPhase(phase, ms = 0, next = null) {
  clearTimeout(game.timer);
  game.timer = null;
  game.nextFn = next;
  game.phase = phase;
  game.stamp++;
  game.endsAt = ms ? Date.now() + ms : 0;
  if (phase === 'answer') game.round.answerStart = Date.now();
  if (next) game.timer = setTimeout(next, ms);
  broadcast();
}

function skipPhase() {
  if (!game.nextFn) return;
  const f = game.nextFn;
  game.nextFn = null;
  clearTimeout(game.timer);
  f();
}

function buildOptions(song) {
  const correct = { id: song.id, title: song.qcmTitle || song.title, artist: song.artist };
  // Mauvaises réponses imposées dans songs.json ("choix"), sinon tirées parmi des chansons proches
  const wrong = song.choices.length >= 3
    ? shuffle(song.choices).slice(0, 3).map((c, i) => ({ id: -1 - i, title: c.title, artist: c.artist }))
    : pickDistractors(song, songs).map((s) => ({ id: s.id, title: s.title, artist: s.artist }));
  return shuffle([correct, ...wrong]);
}

function startGame() {
  if (game.phase !== 'lobby' || !players.size) return;
  const usable = shuffle(songs.filter((s) => s.enabled && s.status === 'ok'));
  if (!usable.length) return;
  const n = Math.min(config.manches, usable.length);
  game.playlist = usable.slice(0, n);
  game.reserve = usable.slice(n);
  game.total = n;
  game.roundNo = 0;
  game.tieRounds = 0;
  game.tie = null;
  game.history = [];
  for (const p of players.values()) { p.score = 0; p.time = 0; p.good = 0; p.log = []; }
  console.log(`\n  Partie lancée : ${players.size} joueurs, ${n} chansons`);
  startRound(game.playlist[0]);
}

function startRound(song, eligible = null) {
  if (eligible) game.tieRounds++; else game.roundNo++;
  const options = buildOptions(song);
  game.round = {
    song, options, correct: options.findIndex((o) => o.id === song.id),
    answers: new Map(), eligible: eligible ? new Set(eligible) : null, tiebreak: !!eligible, answerStart: 0,
  };
  setPhase('ready', T.ready, () => setPhase('answer', T.answer, endAnswer));
}

function endAnswer() {
  if (game.phase !== 'answer') return;
  const r = game.round;
  for (const [pid, a] of r.answers) {
    const p = players.get(pid);
    if (!p) continue;
    p.score += a.points;
    if (a.correct) { p.good++; p.time += a.ms; }
    p.log[game.roundNo - 1] = a;
  }
  if (!r.tiebreak) {
    const good = [...r.answers.values()].filter((a) => a.correct).length;
    game.history.push({ title: r.song.title, artist: r.song.artist, cover: r.song.cover, good, answered: r.answers.size, players: players.size });
  }
  setPhase('reveal'); // écran neutre : aucun résultat avant la fin
}

function next() {
  if (game.phase !== 'reveal') return;
  if (game.roundNo < game.total) return startRound(game.playlist[game.roundNo]);
  // plus de chanson de départage : le temps cumulé des bonnes réponses tranche (voir cmp).
  // Il ne reste d'égalité que si points ET temps sont identiques à la milliseconde.
  const tie = findTie();
  game.tie = tie ? { ...tie, unresolved: true } : null;
  setPhase('final');
  const top = ranked().slice(0, WINNERS).map((x) => `${x.p.first} ${x.p.last} (${x.p.score})`);
  console.log(`  Gagnants : ${top.join(', ')}${game.tie ? '  [égalité non résolue]' : ''}`);
}

function resetGame(clearPlayers = false) {
  clearTimeout(game.timer);
  game = freshGame();
  if (clearPlayers) {
    for (const p of players.values()) if (p.socketId) io.to(p.socketId).emit('kicked');
    players.clear();
  }
  for (const p of players.values()) { p.score = 0; p.time = 0; p.good = 0; p.log = []; }
  broadcast();
}

// ---------------------------------------------------------------- États envoyés
function remaining() { return game.endsAt ? Math.max(0, game.endsAt - Date.now()) : 0; }

function hostState() {
  const r = game.round, ph = game.phase;
  let round = null;
  if (r) {
    // pas de bonne réponse ni de score pendant la partie : tout est révélé à la fin
    round = {
      songId: r.song.id,
      tiebreak: r.tiebreak,
      eligible: r.eligible ? [...r.eligible] : null,
      options: ph === 'answer' ? r.options : null,
      answered: r.answers.size,
      expected: r.eligible ? r.eligible.size : players.size,
    };
  }
  return {
    phase: ph, stamp: game.stamp, endsIn: remaining(), durations: T,
    roundNo: game.roundNo, total: game.total, reserveLeft: game.reserve.length,
    config: { titre: config.titre, lot: config.lot, manches: config.manches, gagnants: WINNERS },
    url: playerUrl(), selectedIp, ips: lanAddresses(),
    players: ranked().map(({ p, rank }) => ({
      id: p.id, name: `${p.first} ${p.last}`, score: p.score, time: p.time, good: p.good, rank, connected: p.connected,
    })),
    round,
    history: ph === 'final' ? game.history : null,
    tie: game.tie ? { group: game.tie.group, names: game.tie.group.map(nameOf), spots: game.tie.spots, unresolved: !!game.tie.unresolved } : null,
    songs: songs.map((s) => ({ id: s.id, artist: s.artist, title: s.title, status: s.status, source: s.source, error: s.error, enabled: s.enabled, found: s.found, cover: s.cover })),
    loading,
  };
}

function playerState(p) {
  const r = game.round, ph = game.phase;
  const me = ranked().find((x) => x.p === p);
  const eligible = !r || !r.eligible || r.eligible.has(p.id);
  const a = r ? r.answers.get(p.id) : null;
  const final = ph === 'final';
  const st = {
    phase: ph, stamp: game.stamp, endsIn: remaining(), durations: T,
    roundNo: game.roundNo, total: game.total, tiebreak: r ? r.tiebreak : false,
    me: { first: p.first, name: `${p.first} ${p.last}` },
    count: players.size, eligible, winners: WINNERS,
  };
  if (r && ph === 'answer') st.options = r.options.map((o) => ({ title: o.title, artist: o.artist }));
  if (a) st.answer = { choice: a.choice }; // jamais « bonne / mauvaise » avant la fin
  if (game.tie) st.tie = { names: game.tie.group.map(nameOf), spots: game.tie.spots, inGroup: game.tie.group.includes(p.id), unresolved: !!game.tie.unresolved };
  if (final) {
    Object.assign(st.me, { score: p.score, good: p.good, rank: me ? me.rank : 0 });
    st.winner = !!me && me.rank <= WINNERS && !(game.tie && game.tie.unresolved && game.tie.group.includes(p.id));
    st.recap = game.history.map((h, i) => ({ title: h.title, artist: h.artist, correct: !!(p.log[i] && p.log[i].correct), answered: !!p.log[i], points: p.log[i] ? p.log[i].points : 0 }));
  }
  return st;
}

let io;
function broadcast() {
  io.to('host').emit('host', hostState());
  for (const p of players.values()) if (p.socketId) io.to(p.socketId).emit('player', playerState(p));
}
let hostTimer = null;
function pushHost() {
  if (!io || hostTimer) return;
  hostTimer = setTimeout(() => { hostTimer = null; io.to('host').emit('host', hostState()); }, 150);
}
function pushLobby() {
  // en salle d'attente : met à jour l'écran et le compteur de joueurs des téléphones
  if (game.phase === 'lobby') broadcast(); else pushHost();
}

// ---------------------------------------------------------------- Serveur web
const app = express();
const server = http.createServer(app);
io = new Server(server);

app.use(express.static(path.join(ROOT, 'public')));
app.get('/ecran', (req, res) => res.sendFile(path.join(ROOT, 'public', 'ecran.html')));
app.get('/qr.svg', async (req, res) => {
  const svg = await QRCode.toString(playerUrl(), { type: 'svg', margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0c0b09', light: '#f3ead4' } });
  res.type('image/svg+xml').set('Cache-Control', 'no-store').send(svg);
});
app.get('/audio/:id', (req, res) => {
  if (!isHost(req.socket.remoteAddress, req.headers, req.query.cle)) return res.sendStatus(403); // réservé à l'écran animateur
  const s = songs[Number(req.params.id)];
  if (!s || !s.audio) return res.sendStatus(404);
  res.set({ 'Content-Type': s.mime, 'Content-Length': s.audio.length, 'Cache-Control': 'no-store' });
  res.end(s.audio);
});

const clean = (v) => String(v || '').replace(/\s+/g, ' ').trim().slice(0, 30);

io.on('connection', (socket) => {
  const hs = socket.handshake;
  const local = isHost(hs.address, hs.headers, hs.auth && hs.auth.key);
  socket.emit('hello', { phase: game.phase, titre: config.titre, lot: config.lot });

  // ---- Animateur (uniquement depuis le PC qui fait tourner le jeu)
  socket.on('host:hello', () => {
    if (!local) return socket.emit('host:denied');
    socket.data.host = true;
    socket.join('host');
    socket.emit('host', hostState());
  });
  const host = (fn) => (...args) => { if (socket.data.host) fn(...args); };
  socket.on('host:start', host(startGame));
  // le stamp évite qu'un double clic saute une chanson
  socket.on('host:next', host((stamp) => { if (stamp === game.stamp) next(); }));
  socket.on('host:skip', host(skipPhase));
  socket.on('host:reset', host(() => resetGame(false)));
  socket.on('host:clearPlayers', host(() => resetGame(true)));
  socket.on('host:reload', host(() => loadAll(true)));
  socket.on('host:setRounds', host((n) => { n = Number(n); if (n >= 1 && n <= 50 && game.phase === 'lobby') { config.manches = n; pushHost(); } }));
  socket.on('host:setIp', host((ip) => { if (lanAddresses().some((a) => a.address === ip)) { selectedIp = ip; pushHost(); } }));
  socket.on('host:toggleSong', host((id) => { const s = songs[Number(id)]; if (s && game.phase === 'lobby') { s.enabled = !s.enabled; pushHost(); } }));
  socket.on('host:kick', host((id) => {
    const p = players.get(id);
    if (!p) return;
    if (p.socketId) io.to(p.socketId).emit('kicked');
    players.delete(id);
    if (game.round && game.round.eligible) game.round.eligible.delete(id);
    broadcast();
  }));

  // ---- Joueurs
  socket.on('join', (d, ack) => {
    ack = typeof ack === 'function' ? ack : () => {};
    d = d || {};
    const attach = (p) => {
      if (p.socketId && p.socketId !== socket.id) io.to(p.socketId).emit('kicked');
      p.socketId = socket.id; p.connected = true; socket.data.pid = p.id;
      ack({ ok: true, pid: p.id });
      pushLobby();
      socket.emit('player', playerState(p));
    };
    if (typeof d.pid === 'string' && players.has(d.pid)) return attach(players.get(d.pid));
    if (d.resume) return ack({ ok: false });
    const first = clean(d.first), last = clean(d.last);
    if (!first || !last) return ack({ ok: false, error: 'Indique ton prénom et ton nom.' });
    const same = [...players.values()].find((p) => norm(p.first + ' ' + p.last) === norm(first + ' ' + last));
    if (same) {
      if (!same.connected) return attach(same); // a changé de navigateur / perdu sa session
      return ack({ ok: false, error: 'Ce nom est déjà inscrit.' });
    }
    if (game.phase !== 'lobby') return ack({ ok: false, error: 'La partie a déjà commencé. Rendez-vous à la prochaine !' });
    if (players.size >= 300) return ack({ ok: false, error: 'La partie est complète.' });
    const p = { id: Math.random().toString(36).slice(2, 10) + Date.now().toString(36), first, last, score: 0, time: 0, good: 0, log: [], seq: ++joinSeq, connected: true, socketId: null };
    players.set(p.id, p);
    console.log(`  + ${first} ${last}  (${players.size} joueurs)`);
    attach(p);
  });

  socket.on('answer', (choice, ack) => {
    ack = typeof ack === 'function' ? ack : () => {};
    const p = players.get(socket.data.pid);
    const r = game.round;
    if (!p || !r || game.phase !== 'answer') return ack({ ok: false });
    if (r.eligible && !r.eligible.has(p.id)) return ack({ ok: false });
    if (r.answers.has(p.id) || ![0, 1, 2, 3].includes(choice)) return ack({ ok: false });
    const ms = Math.min(Date.now() - r.answerStart, T.answer);
    const correct = choice === r.correct;
    const points = correct ? Math.round(MAX_PTS - ((MAX_PTS - MIN_PTS) * ms) / T.answer) : 0;
    r.answers.set(p.id, { choice, ms, correct, points });
    ack({ ok: true });
    socket.emit('player', playerState(p));
    pushHost(); // la manche dure toujours ses 10 s complètes, même si tout le monde a répondu
  });

  socket.on('disconnect', () => {
    const p = players.get(socket.data.pid);
    if (p && p.socketId === socket.id) { p.connected = false; p.socketId = null; pushHost(); }
  });
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') console.error(`\n  Le port ${PORT} est déjà utilisé : le jeu tourne peut-être déjà dans une autre fenêtre.\n`);
  else console.error(e);
  process.exit(1);
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('\n  ==============================================');
  console.log(`   ${config.titre.toUpperCase()}`);
  console.log('  ==============================================');
  console.log(`   Écran animateur : http://localhost:${PORT}/ecran`);
  console.log(`   Joueurs (QR)    : ${playerUrl()}`);
  if (PUBLIC_URL) console.log(`   Écran à distance: ${PUBLIC_URL}/ecran?cle=${HOST_KEY}   (ne pas partager)`);
  console.log('   Laisse cette fenêtre ouverte pendant tout le jeu.');
  console.log('  ==============================================\n');
  console.log('  Chargement des extraits Deezer...');
  loadAll();
  // ouvre l'écran animateur dans le navigateur (Windows et Mac)
  if (!process.env.NO_OPEN) {
    if (process.platform === 'win32') exec(`start "" "http://localhost:${PORT}/ecran"`);
    else if (process.platform === 'darwin') exec(`open "http://localhost:${PORT}/ecran"`);
  }
});
