// Outils partagés par l'écran animateur et la page joueur.
window.esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
window.fmt = (n) => Number(n || 0).toLocaleString('fr-FR');
window.LETTERS = ['A', 'B', 'C', 'D'];
window.ordinal = (n) => (n === 1 ? '1<sup>er</sup>' : n + '<sup>e</sup>');
window.pad2 = (n) => String(n).padStart(2, '0');
window.initials = (name) => String(name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase() || '?';
// Titre en deux temps : premier mot en blanc, le reste en dégradé (BLIND TEST)
window.titleHtml = (t) => {
  const w = String(t || 'Blind Test').trim().split(/\s+/);
  const first = esc(w.shift() || '').toUpperCase();
  return w.length ? `${first} <span class="gradtext">${esc(w.join(' ')).toUpperCase()}</span>` : first;
};

// Compte à rebours : le serveur envoie le temps restant, on anime localement.
window.Clock = {
  end: 0, total: 1,
  set(endsIn, total) { this.end = performance.now() + (endsIn || 0); this.total = total || 1; },
  left() { return Math.max(0, this.end - performance.now()); },
};
const RING_C = 2 * Math.PI * 54;
(function tick() {
  const left = Clock.left();
  const k = Math.min(1, left / Clock.total);
  document.querySelectorAll('[data-sec]').forEach((el) => {
    const sec = Math.ceil(left / 1000);
    const v = el.hasAttribute('data-pad') ? pad2(sec) : String(sec);
    if (el.textContent !== v) el.textContent = v;
  });
  document.querySelectorAll('[data-bar]').forEach((el) => { el.style.transform = `scaleX(${k})`; });
  document.querySelectorAll('[data-ring]').forEach((el) => { el.style.strokeDashoffset = String(RING_C * (1 - k)); });
  requestAnimationFrame(tick);
})();

window.ring = (size) =>
  `<div class="ring" style="width:${size};height:${size};font-size:calc(${size} * .36)">
     <svg viewBox="0 0 120 120" aria-hidden="true">
       <defs><linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7a65ff"/><stop offset=".4" stop-color="#f540a9"/><stop offset=".75" stop-color="#ff7d43"/><stop offset="1" stop-color="#ffe16a"/></linearGradient></defs>
       <circle cx="60" cy="60" r="54" class="ring-bg"/><circle cx="60" cy="60" r="54" class="ring-fg" data-ring style="stroke-dasharray:${RING_C}"/>
     </svg>
     <span data-sec data-pad></span><small>SECONDES</small>
   </div>`;

window.vu = (n = 24) => {
  let h = '';
  for (let i = 0; i < n; i++) h += `<i style="animation-delay:-${(Math.random() * 1.2).toFixed(2)}s;animation-duration:${(0.45 + Math.random() * 0.6).toFixed(2)}s"></i>`;
  return `<div class="vu" aria-hidden="true">${h}</div>`;
};

window.optionHtml = (o, i, extra = '') =>
  `<div class="opt ${extra}"><span class="letter">${LETTERS[i]}</span><div class="opt-txt"><div class="t">${esc(o.title)}</div><div class="a">${esc(o.artist)}</div></div></div>`;

window.brandLogos = () =>
  `<div class="brandlogos"><img src="/assets/rapp.webp" alt="RAPP"><img class="tribal" src="/assets/tribal.webp" alt="Tribal Worldwide Morocco"></div>`;
