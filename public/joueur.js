// Page joueur : inscription puis réponses au QCM depuis le téléphone.
const socket = io();
const app = document.getElementById('app');
const meEl = document.getElementById('me');
const banner = document.getElementById('banner');
const timebar = document.getElementById('timebar');

const store = {
  get() { try { return localStorage.getItem('bt_pid'); } catch (e) { return null; } },
  set(v) { try { v ? localStorage.setItem('bt_pid', v) : localStorage.removeItem('bt_pid'); } catch (e) { /* navigation privée */ } },
};

let pid = store.get();
let S = null;
let hello = { titre: 'Blind Test', lot: '' };
let view = '';
let lastKey = '';

// ---------------------------------------------------------------- Socket
socket.on('connect', () => {
  banner.classList.remove('show');
  if (pid) {
    socket.emit('join', { pid, resume: true }, (res) => {
      if (!res || !res.ok) { pid = null; store.set(null); S = null; renderJoin(); }
    });
  }
});
socket.on('disconnect', () => banner.classList.add('show'));

socket.on('hello', (h) => {
  hello = h;
  document.getElementById('logo').innerHTML = titleHtml(h.titre);
  document.title = h.titre;
  if (!pid && view !== 'join') renderJoin();
});

socket.on('player', (s) => {
  const phaseChanged = !S || S.stamp !== s.stamp;
  S = s;
  Clock.set(s.endsIn, s.durations[s.phase] || 1);
  renderMe();
  const key = `${s.stamp}|${s.answer ? s.answer.choice : ''}|${s.count}`;
  if (key === lastKey) return;
  lastKey = key;
  render(s);
  if (phaseChanged && s.phase === 'answer' && s.eligible && navigator.vibrate) navigator.vibrate(120);
});

socket.on('kicked', () => {
  pid = null; store.set(null); S = null; lastKey = '';
  renderMe();
  renderJoin('Tu as été retiré de la partie (ou connecté ailleurs).');
});

// ---------------------------------------------------------------- Inscription
function renderJoin(msg = '') {
  view = 'join';
  timebar.classList.remove('on');
  app.innerHTML = `<section class="screen join">
    <span class="tiny gradtext">Let's play together</span>
    <img class="sym" src="/assets/infinity.webp" alt="">
    <h2>PRÊT À <span class="gradtext">JOUER ?</span></h2>
    <p>Une seule mission : reconnaître le bon morceau avant les autres.</p>
    ${hello.lot ? `<p class="prize-line">✦ ${esc(hello.lot).toUpperCase()}</p>` : ''}
    <form id="f" autocomplete="on" novalidate>
      <input name="first" placeholder="Ton prénom" aria-label="Prénom" autocomplete="given-name" maxlength="30" required>
      <input name="last" placeholder="Ton nom" aria-label="Nom" autocomplete="family-name" maxlength="30" required>
      <button class="btn big" type="submit">Je participe &nbsp;→</button>
      <p class="err" id="err" role="alert">${esc(msg)}</p>
    </form>
    <p class="tip">La musique passe sur le grand écran. Toi, tu réponds ici, le plus vite possible !</p>
  </section>`;
  const f = document.getElementById('f');
  f.onsubmit = (e) => {
    e.preventDefault();
    const first = f.first.value.trim(), last = f.last.value.trim();
    const err = document.getElementById('err');
    if (!first || !last) { err.textContent = 'Indique ton prénom et ton nom.'; return; }
    const btn = f.querySelector('button');
    btn.disabled = true;
    socket.emit('join', { first, last }, (res) => {
      btn.disabled = false;
      if (!res || !res.ok) { err.textContent = (res && res.error) || 'Impossible de rejoindre, réessaie.'; return; }
      pid = res.pid; store.set(pid);
    });
  };
}

// ---------------------------------------------------------------- Jeu
function renderMe() {
  if (!S || !pid) { meEl.innerHTML = ''; return; }
  // le score n'apparaît qu'à la fin de la partie
  meEl.innerHTML = S.phase === 'final' ? `${esc(S.me.first)} · <b>${fmt(S.me.score)}</b> pts` : esc(S.me.name);
}

function render(s) {
  view = s.phase;
  timebar.classList.toggle('on', s.phase === 'answer' && s.eligible && !s.answer);
  const spectator = s.tiebreak && !s.eligible && ['ready', 'answer', 'reveal'].includes(s.phase);
  if (spectator) return screen(`
    <div class="confirm alt">♪</div>
    <span class="tiny gradtext">Départage en cours</span>
    <h2>SUSPENS<span class="gradtext">…</span></h2>
    <p>${s.tie ? esc(s.tie.names.join(', ')) : ''} jouent pour ${s.tie && s.tie.spots > 1 ? 'les dernières places' : 'la dernière place'}.</p>
    <p class="tip">Les résultats arrivent juste après.</p>`);

  switch (s.phase) {
    case 'lobby':
      return screen(`
        <div class="confirm">✓</div>
        <span class="tiny gradtext">Inscription confirmée</span>
        <h2>YOU'RE <span class="gradtext">IN!</span></h2>
        <p>Bienvenue <strong style="color:#fff">${esc(s.me.first)}</strong> !<br>La partie commence bientôt.</p>
        <div class="wait-dots"><i></i><i></i><i></i></div>
        <p><b style="color:#fff">${s.count}</b> joueur${s.count > 1 ? 's' : ''} inscrit${s.count > 1 ? 's' : ''}</p>
        <p class="tip">Garde cette page ouverte.<br>Les questions apparaîtront ici.</p>`);

    case 'ready':
      return screen(`
        <span class="tiny gradtext">${s.tiebreak ? 'Chanson de départage' : `Chanson ${pad2(s.roundNo)} / ${pad2(s.total)}`}</span>
        <div class="giant-sm" data-sec></div>
        <p>Prépare-toi, la musique va démarrer…</p>`);

    case 'answer': {
      if (s.answer) {
        const o = s.options[s.answer.choice] || { title: '', artist: '' };
        return screen(`
          <div class="confirm">✓</div>
          <span class="tiny gradtext">Réponse enregistrée</span>
          <h2>BIEN JOUÉ, <span class="gradtext">${esc(s.me.first).toUpperCase()}</span> !</h2>
          <div class="saved"><span class="tiny">Tu as choisi</span><span class="letter">${LETTERS[s.answer.choice]}</span><strong>${esc(o.title)}</strong><small>${esc(o.artist)}</small></div>
          <p>Reste connecté·e. Résultat à la fin de la partie.</p>`);
      }
      app.innerHTML = `<section class="screen q-screen">
        <div class="qhead"><span class="tiny">${s.tiebreak ? 'Départage' : `Question ${pad2(s.roundNo)} / ${pad2(s.total)}`}</span><span class="countbadge">⏱ &nbsp;<span data-sec data-pad></span> SEC.</span></div>
        <h2>ÉCOUTE. <span class="gradtext">DEVINE.</span><br>MARQUE DES POINTS.</h2>
        <div class="p-opts">
          ${s.options.map((o, i) => `<button data-choice="${i}"><span class="letter">${LETTERS[i]}</span><span><div class="t">${esc(o.title)}</div><div class="a">${esc(o.artist)}</div></span></button>`).join('')}
        </div>
        <p class="mob-note">Une seule réponse possible. La rapidité compte !</p>
      </section>`;
      return;
    }

    case 'reveal':
      // volontairement neutre : ni bonne / mauvaise réponse, ni score avant la fin
      return screen(`
        <div class="confirm ${s.answer ? '' : 'alt'}">${s.answer ? '✓' : '…'}</div>
        <span class="tiny gradtext">${s.answer ? 'Réponse enregistrée' : 'Pas de réponse'}</span>
        <h2>${s.answer ? 'C\'EST <span class="gradtext">NOTÉ !</span>' : 'TROP <span class="gradtext">TARD !</span>'}</h2>
        <p>${s.tiebreak ? 'Résultat du départage dans un instant.' : s.roundNo < s.total ? 'Prochaine chanson dans un instant…' : 'C\'était la dernière chanson !'}</p>
        <p class="tip">Scores et bonnes réponses dévoilés à la fin de la partie.</p>`);

    case 'tie':
      if (s.tie && s.tie.inGroup) return screen(`
        <div class="confirm alt">!</div>
        <span class="tiny gradtext">Égalité</span>
        <h2>LE <span class="gradtext">DÉPARTAGE</span></h2>
        <p>Tu joues pour ${s.tie.spots > 1 ? s.tie.spots + ' enceintes' : 'une enceinte'}.</p>
        <p>Face à : ${esc(s.tie.names.filter((n) => n !== s.me.name).join(', '))}</p>
        <p class="tip">Une seule chanson : la bonne réponse la plus rapide gagne. Regarde l'écran !</p>`);
      return screen(`
        <div class="confirm alt">♪</div>
        <span class="tiny gradtext">Égalité au sommet</span>
        <h2>SUSPENS<span class="gradtext">…</span></h2>
        <p>${s.tie ? esc(s.tie.names.join(', ')) : ''} vont se départager.</p>
        <p class="tip">Les résultats arrivent juste après.</p>`);

    case 'final': {
      const recap = (s.recap || []).length ? `<ol class="recap">${s.recap.map((h, i) => `<li class="${h.correct ? 'ok' : 'bad'}">
          <span class="mark">${h.correct ? '✓' : '✕'}</span>
          <div><b>${i + 1}. ${esc(h.title)}</b><small>${esc(h.artist)}${h.answered ? '' : ' · pas de réponse'}</small></div>
          <span class="p">${h.correct ? '+' + fmt(h.points) : ''}</span></li>`).join('')}</ol>` : '';
      const stats = `<div class="stats">
          <div class="panel"><b>${fmt(s.me.score)}</b><span>points</span></div>
          <div class="panel"><b>${s.me.good}</b><span>bonne${s.me.good > 1 ? 's' : ''} rép.</span></div>
          <div class="panel"><b>${s.count}</b><span>joueurs</span></div>
        </div>`;
      const rank = `<div class="rank">#${s.me.rank}</div><p class="tiny">Place au classement final</p>`;
      if (s.winner) return screen(`
        <span class="tiny gradtext">Le classement est tombé</span>
        <h2>BRAVO <span class="gradtext">${esc(s.me.first).toUpperCase()}</span> !</h2>
        ${rank}
        <p style="color:#ffe0a6;font-weight:800">✦ Tu gagnes une enceinte !</p>
        ${stats}
        <p class="tip">Va voir l'animateur pour récupérer ton lot.</p>
        ${recap}`);
      if (s.tie && s.tie.unresolved && s.tie.inGroup) return screen(`
        <span class="tiny gradtext">Égalité parfaite</span>
        <h2>L'ANIMATEUR <span class="gradtext">TRANCHE</span></h2>
        <p>Va le voir !</p>
        ${rank}${stats}${recap}`);
      return screen(`
        <span class="tiny gradtext">Le classement est tombé</span>
        <h2>QUELLE <span class="gradtext">ÉNERGIE !</span></h2>
        <p>Tu as joué jusqu'au bout. Bravo !</p>
        ${rank}
        ${stats}
        <p class="tip">Merci d'avoir joué ! Les chansons et ton résultat :</p>
        ${recap}`);
    }
  }
}

function screen(html) { app.innerHTML = `<section class="screen">${html}</section>`; }

// Réponse : un seul appui, affichage immédiat
app.addEventListener('click', (e) => {
  const b = e.target.closest('[data-choice]');
  if (!b || !S || S.phase !== 'answer' || S.answer || !S.eligible) return;
  const choice = Number(b.dataset.choice);
  S.answer = { choice };
  if (navigator.vibrate) navigator.vibrate(30);
  lastKey = '';
  render(S);
  socket.emit('answer', choice, (res) => {
    if (res && !res.ok && S && S.phase === 'answer') { S.answer = null; lastKey = ''; render(S); }
  });
});
