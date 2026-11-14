/**
 * JOURNAL : les actualités du monde du foot mises en page comme un quotidien sportif.
 * Chaque brève devient un article (titre, chapeau, corps, citation d'un consultant) illustré
 * par la vraie photo du joueur (Wikimedia) quand elle existe, sinon par une illustration
 * dessinée (stade de nuit aux couleurs du club, écusson, trophée…).
 */
import { esc, crest } from './components.js';
import { imgTag } from './images.js';
import { createRng, hashSeed } from '../core/rng.js';

const KIND = {
  transfer: { tag: 'MERCATO', color: '#22c55e' }, loan: { tag: 'PRÊT', color: '#38bdf8' }, manager: { tag: 'BANC DE TOUCHE', color: '#f59e0b' },
  crisis: { tag: 'FINANCES', color: '#ef4444' }, owner: { tag: 'PROPRIÉTAIRES', color: '#a855f7' }, clash: { tag: 'POLÉMIQUE', color: '#f43f5e' },
  retire: { tag: 'RETRAITE', color: '#eab308' }, match: { tag: 'MATCH', color: '#60a5fa' },
};
const REDAC = ['Julien Mercier', 'Sophie Laurent', 'Karim Benali', 'Marc Duval', 'Inès Moreau', 'Thomas Girard', 'Léa Fontaine', 'Hugo Martel'];
const QUOTES = {
  transfer: ['C\'est un coup intelligent : le profil correspond exactement à ce qui manquait.', 'Le prix peut faire tousser, mais à ce niveau la qualité se paie.', 'Il va falloir l\'intégrer vite : un vestiaire, ça ne se construit pas en une semaine.'],
  manager: ['Dans le football, le temps est la seule chose qu\'on ne vous donne jamais.', 'Les résultats n\'étaient pas là, mais le problème est plus profond que l\'entraîneur.', 'Un nouveau discours peut provoquer un électrochoc, au moins à court terme.'],
  retire: ['C\'était un joueur que tout le monde respectait, sur le terrain comme en dehors.', 'Il laisse une trace : demandez à ceux qui l\'ont affronté.', 'Sa reconversion ne m\'étonne pas : il a toujours eu une tête de technicien.'],
  crisis: ['On paie des années de gestion au-dessus des moyens du club.', 'Les supporters méritent mieux que cette incertitude.'],
  owner: ['Un nouveau propriétaire, c\'est toujours des promesses : on jugera sur les actes.', 'Les ambitions affichées sont énormes ; le plus dur commence.'],
  clash: ['Le derby commence toujours dans les journaux.', 'Ces petites phrases mettent de l\'huile sur le feu.'],
  loan: ['Un prêt intelligent : il aura du temps de jeu.'], match: ['Une performance qui comptera dans la course au titre.'],
};
const HEAD = {
  transfer: (t) => t.replace(/ · .*$/, '').replace(/\.$/, ''),
  manager: (t) => t.replace(/\.$/, ''),
  retire: (t) => t.split(':')[0].replace(/\.$/, ''),
};

/** Illustration dessinée : stade de nuit, projecteurs, foule, aux couleurs du club. */
function sceneSvg(color = '#1d4ed8', color2 = '#ffffff', seed = 1) {
  const rng = createRng(seed);
  const crowd = Array.from({ length: 140 }, (_, i) => { const x = (i % 35) * 9 + rng.range(0, 4), y = 46 + Math.floor(i / 35) * 7 + rng.range(-1, 1); return `<circle cx="${x}" cy="${y}" r="2.6" fill="${rng.chance(0.55) ? color : rng.chance(0.5) ? color2 : '#334155'}" opacity=".85"/>`; }).join('');
  return `<svg viewBox="0 0 320 160" preserveAspectRatio="xMidYMid slice" class="np-scene">
    <defs><linearGradient id="sk${seed}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#020617"/><stop offset="1" stop-color="#1e293b"/></linearGradient>
    <radialGradient id="lt${seed}" cx=".5" cy=".5" r=".5"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fef3c7" stop-opacity="0"/></radialGradient>
    <linearGradient id="pt${seed}" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#166534"/><stop offset="1" stop-color="#14532d"/></linearGradient></defs>
    <rect width="320" height="160" fill="url(#sk${seed})"/>
    <circle cx="40" cy="18" r="26" fill="url(#lt${seed})"/><circle cx="280" cy="18" r="26" fill="url(#lt${seed})"/>
    <path d="M38 18v40M282 18v40" stroke="#475569" stroke-width="2"/>
    <rect x="0" y="40" width="320" height="34" fill="#0f172a"/>${crowd}
    <path d="M0 74h320v86H0z" fill="url(#pt${seed})"/>
    ${[0, 1, 2, 3, 4, 5].map((i) => `<path d="M${-40 + i * 80} 160 L${40 + i * 48} 74" stroke="#15803d" stroke-width="22" opacity=".35"/>`).join('')}
    <path d="M30 160 L110 80 H210 L290 160" fill="none" stroke="#e2e8f0" stroke-width="1.5" opacity=".7"/>
    <ellipse cx="160" cy="112" rx="38" ry="12" fill="none" stroke="#e2e8f0" stroke-width="1.5" opacity=".7"/>
    <rect x="0" y="70" width="320" height="5" fill="${color}" opacity=".9"/>
  </svg>`;
}

function article(s, x, i, big) {
  const k = KIND[x.type] || { tag: 'ACTUALITÉ', color: '#94a3b8' };
  const p = x.pid ? s.players[x.pid] : null;
  const photo = x.photo || p?.photo || null;
  const club = x.clubId != null ? s.clubs.find((c) => c.id === x.clubId) : p?.clubId ? s.clubs.find((c) => c.id === p.clubId) : null;
  const rng = createRng(hashSeed(`art-${x.season}-${x.day}-${i}-${x.text.length}`));
  const journalists = (s.journalists || []).map((j) => `${j.name}, ancien joueur`);
  const by = rng.pick(REDAC);
  const consult = journalists.length && rng.chance(0.7) ? rng.pick(journalists) : rng.pick(['notre consultant', 'un ancien entraîneur de Ligue 1', 'un recruteur européen']);
  const quote = rng.pick(QUOTES[x.type] || ['Une information qui va faire parler toute la semaine.']);
  const head = (HEAD[x.type] || ((t) => t.replace(/\.$/, '')))(x.text);
  const img = photo ? `<div class="np-img photo">${sceneSvg(club?.color, club?.color2, i + 3)}${imgTag(photo, big ? 640 : 320, 'photo')}</div>`
    : `<div class="np-img">${sceneSvg(club?.color, club?.color2, i + 3)}${club ? `<div class="np-crest">${crest(club, 'lg')}</div>` : ''}</div>`;
  const body = `${esc(x.text)} ${p ? `À ${p.age} ans, ${esc(p.name)} ${p.pos === 'GB' ? 'garde les buts' : 'évolue au poste de ' + esc(p.pos)}${p.nat ? ` et porte les couleurs de la sélection ${esc(p.nat)}` : ''}.` : ''}`;
  return `<article class="np-art ${big ? 'big' : ''}">${img}<div class="np-txt">
    <span class="np-tag" style="--tc:${k.color}">${k.tag}</span>
    <h3>${esc(head)}</h3>
    <p class="np-body">${body}</p>
    <blockquote>« ${esc(quote)} » <cite>— ${esc(consult)}</cite></blockquote>
    <small class="np-by">Par ${esc(by)} · ${x.season}-${String(x.season + 1).slice(2)}, journée ${x.day + 1}</small></div></article>`;
}

export function newspaperHtml(s, filter = 'all') {
  const items = (s.news || []).filter((x) => filter === 'all' || x.type === filter || (filter === 'transfer' && x.type === 'loan')).slice(0, 30);
  const tabs = [['all', 'À la une'], ['transfer', 'Mercato'], ['manager', 'Bancs'], ['retire', 'Retraites'], ['crisis', 'Finances']];
  if (!items.length) return `<div class="np"><div class="np-mast"><b>L'ÉCHO DU BALLON</b><small>Le quotidien du football mondial</small></div>
    <div class="chips">${tabs.map(([k, l]) => `<button class="chip ${filter === k ? 'on' : ''}" data-act="npf" data-v="${k}">${l}</button>`).join('')}</div><p class="muted">Pas encore d'actualité dans cette rubrique.</p></div>`;
  return `<div class="np"><div class="np-mast"><b>L'ÉCHO DU BALLON</b><small>Le quotidien du football mondial · saison ${s.season}-${String(s.season + 1).slice(2)}</small></div>
    <div class="chips">${tabs.map(([k, l]) => `<button class="chip ${filter === k ? 'on' : ''}" data-act="npf" data-v="${k}">${l}</button>`).join('')}</div>
    ${article(s, items[0], 0, true)}
    <div class="np-grid">${items.slice(1).map((x, i) => article(s, x, i + 1, false)).join('')}</div></div>`;
}
