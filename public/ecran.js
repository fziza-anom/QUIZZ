// Écran animateur : affiche le jeu sur la TV et joue la musique.
// clé secrète pour ouvrir l'écran animateur à distance (lien ...?cle=XXXX)
const HOST_KEY = new URLSearchParams(location.search).get('cle') || '';
const audioUrl = (id) => '/audio/' + id + (HOST_KEY ? '?cle=' + encodeURIComponent(HOST_KEY) : '');
const socket = io({ auth: { key: HOST_KEY } });
const stage = document.getElementById('stage');
const $ = (sel) => document.querySelector(sel);

let S = null;
let lastStamp = null;
let lastAudioKey = '';
let unlocked = false;
let testing = null;
let testTimer = null;

// ---------------------------------------------------------------- Audio
const audio = new Audio();
audio.preload = 'auto';
const blobs = {}; // id -> URL locale (extraits préchargés pour un démarrage instantané)
let fadeTimer = null;

function preloadAudio(songs) {
  for (const s of songs) {
    if (s.status !== 'ok') { if (blobs[s.id] && blobs[s.id] !== 'loading') URL.revokeObjectURL(blobs[s.id]); delete blobs[s.id]; continue; }
    if (blobs[s.id]) continue;
    blobs[s.id] = 'loading';
    fetch(audioUrl(s.id))
      .then((r) => { if (!r.ok) throw new Error(); return r.blob(); })
      .then((b) => { blobs[s.id] = URL.createObjectURL(b); })
      .catch(() => { delete blobs[s.id]; });
  }
}

function play(id, offset = 0, vol = 1) {
  const src = blobs[id] && blobs[id] !== 'loading' ? blobs[id] : audioUrl(id);
  clearInterval(fadeTimer);
  if (audio.dataset.src !== src) { audio.src = src; audio.dataset.src = src; }
  const go = () => {
    try { audio.currentTime = offset; } catch (e) { /* ignore */ }
    audio.volume = vol;
    audio.play().catch(() => showUnlock());
  };
  if (audio.readyState >= 1) go(); else audio.addEventListener('loadedmetadata', go, { once: true });
}

function fadeOut(ms = 500) {
  clearInterval(fadeTimer);
  if (audio.paused) return;
  const v0 = audio.volume, t0 = performance.now();
  fadeTimer = setInterval(() => {
    const k = Math.min(1, (performance.now() - t0) / ms);
    audio.volume = v0 * (1 - k);
    if (k >= 1) { clearInterval(fadeTimer); audio.pause(); }
  }, 30);
}

function syncAudio(s) {
  if (!unlocked) return;
  const key = s.phase + '/' + s.stamp;
  if (key === lastAudioKey) return;
  lastAudioKey = key;
  const r = s.round;
  if (s.phase === 'answer' && r) {
    // la chanson joue pendant que les joueurs répondent
    stopTest();
    const elapsed = (s.durations.answer - s.endsIn) / 1000;
    play(r.songId, elapsed > 0.4 ? elapsed : 0, 1);
  } else if (!testing) {
    fadeOut(300);
  }
}

function stopTest() {
  clearTimeout(testTimer);
  testing = null;
  document.querySelectorAll('.song .play').forEach((b) => (b.textContent = '▶'));
}

function showUnlock() {
  if ($('#unlock')) return;
  const o = document.createElement('div');
  o.id = 'unlock';
  o.className = 'overlay';
  o.innerHTML = '<button class="btn big">Réactiver le son</button>';
  o.querySelector('button').onclick = () => { o.remove(); lastAudioKey = ''; if (S) syncAudio(S); };
  document.body.appendChild(o);
}

$('#btnUnlock').onclick = () => {
  unlocked = true;
  $('#unlock').remove();
  lastAudioKey = '';
  if (S) syncAudio(S);
};

// ---------------------------------------------------------------- Socket
const setConn = (on) => $('#conn').classList.toggle('off', !on);
socket.on('connect', () => { setConn(true); socket.emit('host:hello'); });
socket.on('disconnect', () => setConn(false));
socket.on('host:denied', () => {
  $('#unlock')?.remove();
  stage.innerHTML = `<div class="center-msg"><h1 class="script" style="font-size:56px">Écran animateur</h1>
    <p class="sub">Cet écran ne s'ouvre que sur le PC qui fait tourner le jeu :<br><b>http://localhost:${esc(location.port)}/ecran</b></p></div>`;
});

socket.on('host', (s) => {
  S = s;
  Clock.set(s.endsIn, s.durations[s.phase] || 1);
  preloadAudio(s.songs);
  renderHeader(s);
  if (s.stamp !== lastStamp) { lastStamp = s.stamp; render(s); } else update(s);
  syncAudio(s);
});

// ---------------------------------------------------------------- Rendu
function renderHeader(s) {
  $('#logo').textContent = String(s.config.titre || 'Blind Test').toUpperCase();
  $('#prize').textContent = s.config.lot ? '✦  ' + s.config.lot : '';
  $('#prize').style.display = s.config.lot ? '' : 'none';
  const tb = s.round && s.round.tiebreak;
  let label = '';
  if (s.phase === 'tie') label = 'Égalité';
  else if (s.phase === 'reveal') label = tb ? 'Départage' : `Chanson ${s.roundNo} / ${s.total}`;
  else if (s.phase === 'final') label = 'Résultats';
  $('#roundLabel').textContent = label;
  $('#btnSkip').style.display = ['ready', 'answer'].includes(s.phase) ? '' : 'none';
}

function render(s) {
  const fn = { lobby: renderLobby, ready: renderReady, answer: renderAnswer, reveal: renderReveal, tie: renderTie, final: renderFinal }[s.phase];
  if (fn) fn(s);
}

function update(s) {
  if (s.phase === 'lobby') updateLobby(s);
  if (s.phase === 'answer' && $('#ans')) {
    $('#ans').textContent = s.round.answered; $('#exp').textContent = s.round.expected;
    $('#prog').style.width = (s.round.expected ? Math.round(100 * s.round.answered / s.round.expected) : 0) + '%';
  }
}

// ----- Accueil
let lastQrUrl = '';
function renderLobby(s) {
  lastQrUrl = '';
  stage.innerHTML = `
  <section class="lobby">
    <div class="lobby-left">
      <div class="hero">
        <div class="eyebrow gradtext">Welcome to the game</div>
        <h2>LE SON NOUS<br><span class="gradtext">RASSEMBLE.</span></h2>
        <p><span id="heroN">10</span> chansons. Des milliers de souvenirs. Une seule mission : reconnaître le bon morceau avant les autres.</p>
        <img class="hero-infinity" src="/assets/infinity.webp" alt="">
      </div>
      <div class="panel qr-card">
        <div class="eyebrow gradtext">1 · Scanne</div>
        <img class="qr" id="qr" alt="QR code pour rejoindre la partie">
        <div>
          <h3>À toi de jouer.</h3>
          <p>Ouvre l'appareil photo, scanne le code et entre ton prénom et ton nom.</p>
          <div class="url" id="url"></div>
          <label class="ip">Réseau : <select id="ipSel"></select></label>
        </div>
      </div>
    </div>
    <div class="lobby-right">
      <div class="panel players-card">
        <div class="row">
          <div><div class="eyebrow gradtext">2 · Connecte-toi</div><h2>Participants en salle</h2></div>
          <span class="hint">Clique sur un nom pour le retirer</span>
        </div>
        <div class="people-count"><span id="pcount">0</span> <small id="plabel">joueurs</small></div>
        <div id="plist" class="chips"></div>
      </div>
      <div class="launch">
        <label>Nombre de chansons <select id="roundsSel"></select></label>
        <span id="startWarn" class="warn"></span>
        <button id="btnStart" class="btn big">Lancer la partie ↗</button>
      </div>
      <details class="panel songs-card" id="songsBox">
        <summary>Playlist <span id="scount" class="badge"></span></summary>
        <div class="songs-actions"><span class="hint">▶ pour écouter, case à décocher pour exclure un titre</span><button id="btnReload" class="btn ghost">Recharger les extraits</button></div>
        <div id="slist"></div>
      </details>
    </div>
  </section>`;

  $('#btnStart').onclick = () => socket.emit('host:start');
  $('#btnReload').onclick = () => socket.emit('host:reload');
  $('#ipSel').onchange = (e) => socket.emit('host:setIp', e.target.value);
  $('#roundsSel').onchange = (e) => socket.emit('host:setRounds', Number(e.target.value));
  $('#plist').onclick = (e) => {
    const c = e.target.closest('[data-kick]');
    if (c && confirm(`Retirer ${c.textContent.trim().replace(/^\S+/, '').trim() || c.textContent.trim()} de la partie ?`)) socket.emit('host:kick', c.dataset.kick);
  };
  $('#slist').onclick = (e) => {
    const t = e.target.closest('[data-test]');
    if (t) {
      const id = Number(t.dataset.test);
      if (testing === id) { stopTest(); fadeOut(200); return; }
      stopTest();
      testing = id;
      t.textContent = '■';
      unlocked = true;
      play(id, 0, 1);
      testTimer = setTimeout(() => { stopTest(); fadeOut(400); }, S.durations.answer);
    }
  };
  $('#slist').onchange = (e) => { const c = e.target.closest('[data-toggle]'); if (c) socket.emit('host:toggleSong', Number(c.dataset.toggle)); };
  updateLobby(s);
}

function updateLobby(s) {
  if (s.url !== lastQrUrl) { lastQrUrl = s.url; $('#qr').src = '/qr.svg?u=' + encodeURIComponent(s.url); $('#url').textContent = s.url.replace(/\/$/, ''); }

  const ipSel = $('#ipSel');
  if (document.activeElement !== ipSel) {
    ipSel.innerHTML = s.ips.map((a) => `<option value="${esc(a.address)}" ${a.address === s.selectedIp ? 'selected' : ''}>${esc(a.address)} · ${esc(a.name)}</option>`).join('') || '<option>Aucun réseau détecté</option>';
  }

  const ok = s.songs.filter((x) => x.status === 'ok' && x.enabled).length;
  const rs = $('#roundsSel');
  if (document.activeElement !== rs) {
    const opts = [...new Set([5, 10, 15, 20, s.config.manches])].sort((a, b) => a - b);
    rs.innerHTML = opts.map((n) => `<option value="${n}" ${n === s.config.manches ? 'selected' : ''}>${n}</option>`).join('');
  }

  $('#pcount').textContent = s.players.length;
  $('#plabel').textContent = s.players.length > 1 ? 'joueurs' : 'joueur';
  $('#heroN').textContent = s.config.manches;
  $('#plist').innerHTML = s.players.length
    ? s.players.map((p) => `<span class="chip ${p.connected ? '' : 'off'}" data-kick="${esc(p.id)}"><i>${esc(initials(p.name))}</i>${esc(p.name)}</span>`).join('')
    : '<div class="empty">En attente des premiers joueurs…</div>';

  const reserve = ok - Math.min(s.config.manches, ok);
  let warn = '';
  if (s.loading) warn = 'Chargement des extraits…';
  else if (ok < s.config.manches) warn = `Seulement ${ok} extraits disponibles`;
  else if (reserve < 1) warn = 'Aucune chanson de réserve pour un départage';
  $('#startWarn').textContent = warn;
  $('#btnStart').disabled = !s.players.length || !ok;

  $('#scount').textContent = `${ok} / ${s.songs.length}`;
  if (!$('#songsBox').open && s.songs.some((x) => x.status === 'error')) $('#songsBox').open = true;
  $('#slist').innerHTML = s.songs.map((so) => {
    const info = so.status === 'ok'
      ? (so.source === 'fichier' ? 'Fichier MP3 local' : `Deezer : ${esc(so.found.artist)} · ${esc(so.found.title)}`)
      : so.status === 'error' ? 'Erreur : ' + esc(so.error) : 'Chargement…';
    return `<div class="song ${so.status} ${so.enabled ? '' : 'off'}">
      ${so.cover ? `<img class="cv" src="${esc(so.cover)}" alt="">` : '<div class="cv"></div>'}
      <div><b>${esc(so.artist)} · ${esc(so.title)}</b><small>${info}</small></div>
      <button class="play" data-test="${so.id}" ${so.status === 'ok' ? '' : 'disabled'} title="Écouter 10 s">${testing === so.id ? '■' : '▶'}</button>
      <input type="checkbox" data-toggle="${so.id}" ${so.enabled ? 'checked' : ''} title="Inclure dans le tirage">
    </div>`;
  }).join('');
}

// ----- Préparation
function renderReady(s) {
  const tb = s.round.tiebreak;
  stage.innerHTML = `<section class="center-stage">
    <div class="kicker">${tb ? 'Chanson de départage' : `Chanson ${pad2(s.roundNo)} / ${pad2(s.total)}`}</div>
    <div class="giant" data-sec></div>
    <div class="sub">${tb ? 'Seuls ' + esc(tieNames(s)) + ' peuvent répondre' : 'Préparez-vous…'}</div>
  </section>`;
}

// ----- Réponse (la musique joue en même temps)
function renderAnswer(s) {
  const r = s.round;
  stage.innerHTML = `<section class="answer-stage">
    <div class="q-head">
      <div>
        <div class="topmeta gradtext">${r.tiebreak ? 'CHANSON DE DÉPARTAGE' : `CHANSON ${pad2(s.roundNo)} / ${pad2(s.total)}`}</div>
        <h2 class="q-title">QUEL EST CE <span class="gradtext">MORCEAU ?</span></h2>
      </div>
      ${ring('min(15vh, 130px)')}
    </div>
    ${vu(22)}
    <div class="options">${r.options.map((o, i) => optionHtml(o, i)).join('')}</div>
    <div class="q-foot">
      <div class="respondents"><b><span id="ans">${r.answered}</span> / <span id="exp">${r.expected}</span></b><small>RÉPONSES REÇUES</small>
        <div class="progress"><i id="prog" style="width:${r.expected ? Math.round(100 * r.answered / r.expected) : 0}%"></i></div></div>
    </div>
  </section>`;
}

// ----- Fin de manche : écran neutre, aucun résultat avant la fin
function renderReveal(s) {
  const r = s.round;
  const last = r.tiebreak || s.roundNo >= s.total;
  stage.innerHTML = `<section class="center-stage">
    <div class="kicker">Temps écoulé !</div>
    <div class="giant giant-sm">${r.answered}<span class="muted"> / ${r.expected}</span></div>
    <div class="sub">joueur${r.answered > 1 ? 's ont' : ' a'} répondu.<br>Réponses et scores dévoilés à la fin de la partie.</div>
    <button id="btnNext" class="btn big">${last ? 'Voir les résultats' : 'Chanson suivante'} &nbsp;→</button>
  </section>`;
  $('#btnNext').onclick = () => socket.emit('host:next', S.stamp);
}

function board(list, n) {
  if (!list.length) return '<p class="muted">Aucun joueur</p>';
  return `<ol class="board">${list.slice(0, n).map((p, i) => `
    <li style="animation-delay:${i * 40}ms">
      <span class="rk">${p.rank}</span>
      <span class="nm">${esc(p.name)}</span>
      <span class="delta">${p.good} ✓</span>
      <span class="sc">${fmt(p.score)}</span>
    </li>`).join('')}</ol>`;
}

const tieNames = (s) => (s.tie ? s.tie.names : s.players.filter((p) => s.round.eligible?.includes(p.id)).map((p) => p.name)).join(', ');

// ----- Égalité
function renderTie(s) {
  const t = s.tie;
  stage.innerHTML = `<section class="center-stage">
    <div class="kicker">Égalité !</div>
    <h1 class="script big-names ${t.names.length > 3 ? 'many' : ''}">${t.names.map(esc).join(t.names.length > 3 ? ' · ' : '<br>')}</h1>
    <p class="sub">${t.spots > 1 ? t.spots + ' enceintes' : 'Une enceinte'} en jeu. Une chanson de départage : seuls ces joueurs répondent, ${t.spots > 1 ? `les ${t.spots} bonnes réponses les plus rapides l'emportent` : 'la bonne réponse la plus rapide l\'emporte'}.</p>
    <button id="btnNext" class="btn big">Lancer le départage ↗</button>
  </section>`;
  $('#btnNext').onclick = () => socket.emit('host:next', S.stamp);
}

// ----- Final : podium, classement complet et réponses de chaque chanson
function renderFinal(s) {
  const W = s.config.gagnants;
  const podN = Math.min(s.players.length, Math.max(3, W));
  const top = s.players.slice(0, podN);
  // 2e - 1er - 3e quand il y a 3 marches
  const order = top.length === 3 ? [top[1], top[0], top[2]] : top;
  const rest = s.players.slice(podN);
  const unresolved = s.tie && s.tie.unresolved;
  const hist = s.history || [];
  const medal = (i) => ['🏆', '🥈', '🥉'][i] || '';
  stage.innerHTML = `<section class="final">
    <div class="final-head">
      <div class="eyebrow gradtext">Game over · The final ranking</div>
      <h2>TOGETHER <span class="gradtext">WE WIN.</span></h2>
    </div>
    <div class="podium">
      ${order.map((p) => { const i = top.indexOf(p); return `<div class="step s${i + 1}">
        <div class="medal">${medal(i) || i + 1}</div>
        <div class="wn">${esc(p.name)}</div>
        <div class="ws-rank">${i === 0 ? 'CHAMPION·NE' : i + 1 + 'e place'}</div>
        <b class="ws">${fmt(p.score)}<small>points · ${p.good} bonne${p.good > 1 ? 's' : ''} réponse${p.good > 1 ? 's' : ''}</small></b>
        ${i < W ? '<div class="prize-tag">✦ GAGNE UNE ENCEINTE</div>' : ''}
      </div>`; }).join('')}
    </div>
    ${unresolved ? `<p class="warn">Égalité persistante entre ${s.tie.names.map(esc).join(', ')} et plus de chanson de réserve : à toi de trancher !</p>` : ''}
    <div class="final-grid ${rest.length ? '' : 'solo'}">
      ${rest.length ? `<div class="panel rest"><h3>Classement</h3>${board(rest, 100)}</div>` : ''}
      <div class="panel rest"><h3>Les réponses</h3>
        <ol class="recap">${hist.map((h, i) => `<li>
          ${h.cover ? `<img src="${esc(h.cover)}" alt="">` : '<span class="ph"></span>'}
          <div><b>${i + 1}. ${esc(h.title)}</b><small>${esc(h.artist)}</small></div>
          <span class="found">${h.good} / ${h.players} ont trouvé</span>
        </li>`).join('')}</ol>
      </div>
    </div>
    <div class="final-foot"><button id="btnNew" class="btn ghost">Rejouer ↻</button></div>
  </section>`;
  $('#btnNew').onclick = () => { if (confirm('Revenir à l\'accueil pour une nouvelle partie ? (les joueurs restent inscrits)')) socket.emit('host:reset'); };
  confetti();
}

function confetti() {
  const box = document.createElement('div');
  box.className = 'confetti';
  const colors = ['#7a65ff', '#f540a9', '#ff7d43', '#ffe16a'];
  for (let i = 0; i < 120; i++) {
    const c = document.createElement('i');
    c.style.left = Math.random() * 100 + 'vw';
    c.style.background = colors[i % colors.length];
    c.style.animationDuration = 2.5 + Math.random() * 3 + 's';
    c.style.animationDelay = Math.random() * 1.5 + 's';
    c.style.opacity = 0.6 + Math.random() * 0.4;
    box.appendChild(c);
  }
  document.body.appendChild(box);
  setTimeout(() => box.remove(), 8000);
}

// ---------------------------------------------------------------- Commandes
$('#btnSkip').onclick = () => socket.emit('host:skip');
$('#btnReset').onclick = () => {
  if (!confirm('Revenir à l\'accueil ? La partie en cours sera arrêtée (les joueurs restent inscrits).')) return;
  if (confirm('Veux-tu AUSSI retirer tous les joueurs inscrits ?')) socket.emit('host:clearPlayers');
  else socket.emit('host:reset');
};
// Espace / Entrée / → : lancer ou passer à la suite
document.addEventListener('keydown', (e) => {
  if (!S || ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  if (![' ', 'Enter', 'ArrowRight'].includes(e.key)) return;
  if ($('#unlock')) return;
  e.preventDefault();
  if (S.phase === 'lobby' && !$('#btnStart').disabled) socket.emit('host:start');
  else if (S.phase === 'reveal' || S.phase === 'tie') socket.emit('host:next', S.stamp);
});
