// Choix des mauvaises réponses du QCM : on pioche des chansons « qui ressemblent »
// (même style, sinon style voisin) pour que la bonne réponse ne soit pas évidente.
// Les styles sont déclarés dans songs.json (champ "style"), les voisinages ci-dessous.
const NEIGHBORS = {
  'chaabi-maroc': ['pop-maroc', 'rai'],
  'pop-maroc': ['chaabi-maroc', 'rai', 'orient', 'rap-maroc'],
  'rap-maroc': ['pop-maroc', 'variete-fr'],
  'rai': ['pop-maroc', 'chaabi-maroc', 'orient'],
  'orient': ['pop-maroc', 'rai'],
  'pop-inter': ['variete-fr'],
  'variete-fr': ['pop-inter', 'rap-maroc'],
};

const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

function affinity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 3;
  return (NEIGHBORS[a] || []).includes(b) || (NEIGHBORS[b] || []).includes(a) ? 2 : 0;
}

// song / candidates : objets { id, title, artist, style }
function pickDistractors(song, candidates, n = 3) {
  const pool = candidates
    .filter((s) => s.id !== song.id && norm(s.title) !== norm(song.title))
    .map((s) => ({ s, score: affinity(song.style, s.style) + Math.random() * 1.5 }))
    .sort((x, y) => y.score - x.score);
  const picks = [];
  // 1) chansons du même style ou d'un style voisin, un seul titre par artiste
  for (const { s, score } of pool) {
    if (picks.length === n) break;
    if (score < 2) continue;
    if (norm(s.artist) === norm(song.artist) || picks.some((p) => norm(p.artist) === norm(s.artist))) continue;
    picks.push(s);
  }
  // 2) complément (styles non renseignés ou playlist trop petite)
  for (const { s } of pool) {
    if (picks.length === n) break;
    if (!picks.includes(s)) picks.push(s);
  }
  return picks;
}

module.exports = { pickDistractors, NEIGHBORS };
