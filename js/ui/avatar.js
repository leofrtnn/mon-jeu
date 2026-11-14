/**
 * Avatar du coach en SVG (style illustré plat), généré à partir de son apparence.
 */
const shade = (hex, k) => {
  const v = parseInt(hex.slice(1), 16);
  const f = (x) => Math.max(0, Math.min(255, Math.round(x * k)));
  return '#' + [f((v >> 16) & 255), f((v >> 8) & 255), f(v & 255)].map((x) => x.toString(16).padStart(2, '0')).join('');
};

let AVID = 0;
export function avatarSvg(look, size = 96, bg = '#1f352b') {
  const L = look || {};
  const skin = L.skin || '#d9a066', hair = L.hairColor || '#3d2a1a', cloth = L.outfitColor || '#1c2333';
  const dark = shade(skin, 0.82), hairDark = shade(hair, 0.75), clothDark = shade(cloth, 0.75);
  let hairBack = '', hairFront = '';
  switch (L.hairStyle) {
    case 'bald': hairFront = `<path d="M30 38 Q32 30 36 28" stroke="${shade(skin, 0.9)}" stroke-width="2" fill="none" opacity=".5"/>`; break;
    case 'receding': hairFront = `<path d="M27 44 Q26 30 34 26 Q31 34 32 42 Z M73 44 Q74 30 66 26 Q69 34 68 42 Z" fill="${hair}"/>`; break;
    case 'curly': hairFront = `<g fill="${hair}">${[[30, 30], [38, 23], [48, 20], [58, 21], [67, 26], [72, 35], [27, 39], [44, 26], [55, 26]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="8"/>`).join('')}</g>`; break;
    case 'long': hairBack = `<path d="M24 40 Q22 70 30 78 L70 78 Q78 70 76 40 Q74 18 50 17 Q26 18 24 40Z" fill="${hairDark}"/>`;
      hairFront = `<path d="M26 44 Q26 20 50 19 Q74 20 74 44 Q66 30 50 29 Q36 29 26 44Z" fill="${hair}"/>`; break;
    case 'slick': hairFront = `<path d="M26 42 Q25 20 50 18 Q76 19 75 40 Q70 27 52 26 Q36 26 26 42Z" fill="${hair}"/><path d="M36 24 Q52 20 68 28" stroke="${hairDark}" stroke-width="1.5" fill="none"/>`; break;
    case 'buzz': hairFront = `<path d="M28 40 Q28 22 50 21 Q72 22 72 40 Q66 28 50 27 Q34 28 28 40Z" fill="${hair}" opacity=".75"/>`; break;
    case 'sidepart': hairFront = `<path d="M26 44 Q24 20 50 18 Q76 20 74 42 Q72 30 58 27 L40 24 Q30 30 26 44Z" fill="${hair}"/><path d="M40 24 Q38 30 36 34" stroke="${hairDark}" stroke-width="1.6" fill="none"/>`; break;
    case 'quiff': hairFront = `<path d="M26 42 Q25 24 44 20 Q46 10 60 12 Q76 16 74 42 Q70 30 60 29 Q48 26 38 30 Q30 33 26 42Z" fill="${hair}"/>`; break;
    case 'afro': hairBack = `<circle cx="50" cy="34" r="27" fill="${hair}"/>`; hairFront = `<path d="M28 42 Q30 30 40 28 Q50 26 60 28 Q70 30 72 42 Q70 22 50 20 Q30 22 28 42Z" fill="${hair}"/>`; break;
    case 'bun': hairFront = `<circle cx="50" cy="13" r="8" fill="${hair}"/><path d="M26 42 Q25 20 50 19 Q75 20 74 42 Q70 28 50 27 Q30 28 26 42Z" fill="${hair}"/>`; break;
    case 'dreads': hairBack = `<g stroke="${hair}" stroke-width="5" stroke-linecap="round">${[24, 30, 36, 64, 70, 76].map((x) => `<path d="M${x} 32 L${x + (x < 50 ? -3 : 3)} 72"/>`).join('')}</g>`;
      hairFront = `<path d="M26 42 Q25 20 50 18 Q75 20 74 42 Q70 28 50 27 Q30 28 26 42Z" fill="${hair}"/>`; break;
    case 'mohawk': hairFront = `<path d="M44 34 Q44 12 50 10 Q56 12 56 34 Q50 30 44 34Z" fill="${hair}"/><path d="M28 40 Q30 28 40 26 M72 40 Q70 28 60 26" stroke="${hair}" stroke-width="2" opacity=".4" fill="none"/>`; break;
    default: hairFront = `<path d="M26 42 Q25 21 50 19 Q75 21 74 42 Q71 31 62 29 Q50 25 38 30 Q30 33 26 42Z" fill="${hair}"/>`;
  }
  let beard = '';
  switch (L.beard) {
    case 'stubble': beard = `<path d="M33 56 Q36 74 50 76 Q64 74 67 56 Q60 66 50 66 Q40 66 33 56Z" fill="${hair}" opacity=".35"/>`; break;
    case 'full': beard = `<path d="M30 50 Q31 78 50 80 Q69 78 70 50 Q64 64 50 64 Q36 64 30 50Z" fill="${hair}"/><path d="M42 63 Q50 60 58 63 Q50 67 42 63Z" fill="${hairDark}"/>`; break;
    case 'moustache': beard = `<path d="M40 61 Q45 57 50 60 Q55 57 60 61 Q55 63 50 62 Q45 63 40 61Z" fill="${hair}"/>`; break;
    case 'long': beard = `<path d="M29 50 Q30 90 50 92 Q70 90 71 50 Q64 64 50 64 Q36 64 29 50Z" fill="${hair}"/><path d="M42 63 Q50 60 58 63 Q50 67 42 63Z" fill="${hairDark}"/>`; break;
    case 'chinstrap': beard = `<path d="M29 48 Q30 76 50 78 Q70 76 71 48 L68 50 Q66 72 50 73 Q34 72 32 50Z" fill="${hair}"/>`; break;
    case 'mutton': beard = `<path d="M28 46 Q28 66 38 68 L40 62 Q33 58 33 46Z M72 46 Q72 66 62 68 L60 62 Q67 58 67 46Z" fill="${hair}"/><path d="M40 61 Q45 57 50 60 Q55 57 60 61 Q55 63 50 62 Q45 63 40 61Z" fill="${hair}"/>`; break;
    case 'goatee': beard = `<path d="M43 66 Q50 64 57 66 Q56 76 50 77 Q44 76 43 66Z" fill="${hair}"/><path d="M41 61 Q50 57 59 61 Q50 63 41 61Z" fill="${hair}"/>`; break;
    default: break;
  }
  let outfit;
  if (L.outfit === 'tracksuit') {
    outfit = `<path d="M14 100 Q16 82 34 78 L50 84 L66 78 Q84 82 86 100Z" fill="${cloth}"/><path d="M50 84 L50 100" stroke="#fff" stroke-width="1.6" opacity=".8"/>
      <path d="M34 78 L44 90 M66 78 L56 90" stroke="${clothDark}" stroke-width="3"/><path d="M18 92 L30 88 M82 92 L70 88" stroke="#fff" stroke-width="2" opacity=".7"/>`;
  } else if (L.outfit === 'coat') {
    outfit = `<path d="M12 100 Q14 80 34 76 L50 90 L66 76 Q86 80 88 100Z" fill="${cloth}"/><path d="M34 76 L42 100 M66 76 L58 100" stroke="${clothDark}" stroke-width="3"/>
      <path d="M40 78 Q50 86 60 78 L56 84 Q50 88 44 84Z" fill="#7d1f2a"/>`;
  } else if (L.outfit === 'polo') {
    outfit = `<path d="M14 100 Q16 82 34 78 L50 84 L66 78 Q84 82 86 100Z" fill="${cloth}"/><path d="M40 79 L50 86 L60 79 L56 77 L50 82 L44 77Z" fill="${clothDark}"/><circle cx="62" cy="91" r="3" fill="#f4c430"/>`;
  } else if (L.outfit === 'puffer') {
    outfit = `<path d="M10 100 Q12 80 34 75 L50 82 L66 75 Q88 80 90 100Z" fill="${cloth}"/><path d="M16 90 Q50 84 84 90 M13 97 Q50 91 87 97" stroke="${clothDark}" stroke-width="2" fill="none"/><path d="M50 82 L50 100" stroke="${clothDark}" stroke-width="2"/><path d="M38 74 Q50 82 62 74 L62 80 Q50 86 38 80Z" fill="${clothDark}"/>`;
  } else if (L.outfit === 'jacket') {
    outfit = `<path d="M14 100 Q16 82 34 78 L50 88 L66 78 Q84 82 86 100Z" fill="${cloth}"/><path d="M44 80 L50 88 L56 80Z" fill="#2b2b2b"/><path d="M50 88 L50 100" stroke="#bbb" stroke-width="1.2"/><path d="M34 78 L40 86 M66 78 L60 86" stroke="${clothDark}" stroke-width="3"/>`;
  } else if (L.outfit === 'rollneck') {
    outfit = `<path d="M14 100 Q16 82 34 78 L50 80 L66 78 Q84 82 86 100Z" fill="${cloth}"/><rect x="40" y="70" width="20" height="10" rx="4" fill="${clothDark}"/>`;
  } else {
    outfit = `<path d="M14 100 Q16 82 34 78 L50 92 L66 78 Q84 82 86 100Z" fill="${cloth}"/><path d="M42 80 L50 92 L58 80 L50 84Z" fill="#f4f4f4"/>
      <path d="M48 84 L52 84 L53 98 L50 100 L47 98Z" fill="#9b1c2b"/><path d="M34 78 L46 98 M66 78 L54 98" stroke="${clothDark}" stroke-width="2.5"/>`;
  }
  const gl = L.glasses === true ? 'square' : L.glasses || 'none';
  const glasses = gl === 'round' ? `<g fill="none" stroke="#1a1a1a" stroke-width="1.8"><circle cx="40" cy="48" r="6"/><circle cx="60" cy="48" r="6"/><path d="M46 48 L54 48"/></g>`
    : gl === 'sun' ? `<g><rect x="33" y="43" width="14" height="10" rx="4" fill="#111"/><rect x="53" y="43" width="14" height="10" rx="4" fill="#111"/><path d="M47 47 L53 47" stroke="#111" stroke-width="2"/></g>`
    : gl === 'square' ? `<g fill="none" stroke="#1a1a1a" stroke-width="1.8"><rect x="34" y="44" width="12" height="9" rx="3"/><rect x="54" y="44" width="12" height="9" rx="3"/><path d="M46 48 L54 48"/></g>` : '';
  // Visage, yeux, sourcils, bouche, accessoires.
  const faceP = { round: 'M27 46 Q27 22 50 22 Q73 22 73 46 Q73 72 50 74 Q27 72 27 46Z', square: 'M28 44 Q28 22 50 22 Q72 22 72 44 L71 62 Q66 74 50 74 Q34 74 29 62Z',
    long: 'M29 44 Q29 20 50 20 Q71 20 71 44 Q71 76 50 78 Q29 76 29 44Z' }[L.face] || 'M28 44 Q28 22 50 22 Q72 22 72 44 Q72 72 50 74 Q28 72 28 44Z';
  const eye = L.eyes || '#1d1d1d';
  const browW = { thick: 3.4, thin: 1.4 }[L.brows] || 2.2;
  const mouth = L.mouth === 'smile' ? '<path d="M42 63 Q50 70 58 63" stroke="#7a3b2e" stroke-width="2" fill="none" stroke-linecap="round"/>'
    : L.mouth === 'stern' ? '<path d="M43 66 L57 66" stroke="#7a3b2e" stroke-width="2" stroke-linecap="round"/>' : '<path d="M43 64 Q50 68 57 64" stroke="#7a3b2e" stroke-width="2" fill="none" stroke-linecap="round"/>';
  const acc = L.acc === 'cap' ? `<path d="M25 36 Q26 16 50 15 Q74 16 75 36 Z" fill="${cloth}"/><path d="M25 36 Q50 30 84 38 Q60 42 25 38Z" fill="${clothDark}"/>`
    : L.acc === 'beanie' ? `<path d="M26 38 Q25 14 50 13 Q75 14 74 38Z" fill="${cloth}"/><rect x="25" y="32" width="50" height="7" rx="3" fill="${clothDark}"/>`
    : L.acc === 'headset' ? `<path d="M26 46 Q26 18 50 18 Q74 18 74 46" stroke="#222" stroke-width="2.5" fill="none"/><rect x="22" y="42" width="7" height="11" rx="3" fill="#222"/><path d="M27 52 Q32 62 42 62" stroke="#222" stroke-width="1.6" fill="none"/>`
    : '';
  const scarf = L.acc === 'scarf' ? `<path d="M34 74 Q50 82 66 74 L66 80 Q50 88 34 80Z" fill="#c1121f"/><path d="M58 80 L62 98 L54 98 L54 82Z" fill="#c1121f"/><path d="M34 77 Q50 85 66 77" stroke="#fff" stroke-width="1.5" fill="none" opacity=".8"/>` : '';
  // Rendu « peinture numérique » : volumes de la peau, yeux détaillés, nez, lèvres, reflets.
  const u = 'av' + (++AVID);
  const sk1 = shade(skin, 1.1), sk2 = shade(skin, 0.74), lip = shade(skin, 0.68), lipL = shade(skin, 0.86), blush = shade(skin, 0.92);
  const iris = eye === '#1d1d1d' ? '#3b2416' : eye;
  const eyeG = (cx) => `<path d="M${cx - 5.2} 48.4 Q${cx} 44.2 ${cx + 5.2} 48.4 Q${cx} 51.6 ${cx - 5.2} 48.4Z" fill="#f7f3ee"/>
      <circle cx="${cx + 0.3}" cy="48.2" r="2.45" fill="${iris}"/><circle cx="${cx + 0.3}" cy="48.2" r="2.45" fill="url(#${u}i)"/><circle cx="${cx + 0.3}" cy="48.2" r="1.05" fill="#0b0b0b"/>
      <circle cx="${cx + 1.1}" cy="47.3" r=".6" fill="#fff"/>
      <path d="M${cx - 5.6} 48.3 Q${cx} 43.6 ${cx + 5.6} 48.3" stroke="${shade(skin, 0.45)}" stroke-width="1.15" fill="none" stroke-linecap="round"/>
      <path d="M${cx - 4.6} 49.9 Q${cx} 51.9 ${cx + 4.6} 49.9" stroke="${sk2}" stroke-width=".6" fill="none" opacity=".7"/>`;
  const brow = (cx, flip) => { const t = browW; const a = flip ? -1 : 1;
    return `<path d="M${cx - 6 * a} ${42.6} Q${cx - 1 * a} ${39.2 - t * 0.4} ${cx + 5.5 * a} ${41.6} L${cx + 5.2 * a} ${41.6 + t * 0.55} Q${cx - 1 * a} ${40.8} ${cx - 5.8 * a} ${43.4 + t * 0.2}Z" fill="${hairDark}"/>`; };
  const lips = L.mouth === 'smile'
    ? `<path d="M42 62.6 Q50 61.2 58 62.6 Q50 69.5 42 62.6Z" fill="${lip}"/><path d="M43.5 63.2 Q50 66.6 56.5 63.2" stroke="#fff" stroke-width=".9" fill="none" opacity=".75"/>`
    : L.mouth === 'stern' ? `<path d="M42.5 64.2 Q50 62.6 57.5 64.2 Q50 65.6 42.5 64.2Z" fill="${lip}"/><path d="M43.5 64.6 Q50 67.4 56.5 64.6 Q50 66 43.5 64.6Z" fill="${lipL}"/>`
    : `<path d="M42.5 63.6 Q46 62.2 50 63 Q54 62.2 57.5 63.6 Q50 64.8 42.5 63.6Z" fill="${lip}"/><path d="M43.2 63.9 Q50 68.4 56.8 63.9 Q50 65.4 43.2 63.9Z" fill="${lipL}"/><path d="M46 66.2 Q50 67.2 54 66.2" stroke="#fff" stroke-width=".6" fill="none" opacity=".45"/>`;
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="Avatar du coach" style="border-radius:50%;background:${L.bg || bg};flex:none">
    <defs>
      <radialGradient id="${u}s" cx="44%" cy="38%" r="68%"><stop offset="0" stop-color="${sk1}"/><stop offset=".62" stop-color="${skin}"/><stop offset="1" stop-color="${sk2}"/></radialGradient>
      <radialGradient id="${u}i" cx="40%" cy="35%" r="70%"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset=".6" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".45"/></radialGradient>
      <linearGradient id="${u}h" x1="0" y1="0" x2=".3" y2="1"><stop offset="0" stop-color="${shade(hair, 1.35)}"/><stop offset=".45" stop-color="${hair}"/><stop offset="1" stop-color="${hairDark}"/></linearGradient>
      <radialGradient id="${u}b" cx="50%" cy="35%" r="75%"><stop offset="0" stop-color="#fff" stop-opacity=".10"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></radialGradient>
      <linearGradient id="${u}c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".12"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient>
    </defs>
    <rect width="100" height="100" fill="url(#${u}b)"/>
    ${hairBack.replace(/fill="[^"]*"/, `fill="url(#${u}h)"`)}
    <path d="M42.5 62 L57.5 62 L58.5 80 Q50 84 41.5 80Z" fill="${sk2}"/>
    <path d="M42.5 66 Q50 72 57.5 66 L57.5 70 Q50 75 42.5 70Z" fill="#000" opacity=".18"/>
    ${outfit}<path d="M10 100 Q14 80 34 76 L50 84 L66 76 Q86 80 90 100Z" fill="url(#${u}c)"/>${scarf}
    <ellipse cx="27" cy="50" rx="4.2" ry="6.4" fill="${skin}"/><ellipse cx="73" cy="50" rx="4.2" ry="6.4" fill="${skin}"/>
    <path d="M26.2 47 Q28 50 26.8 54 M73.8 47 Q72 50 73.2 54" stroke="${sk2}" stroke-width="1.1" fill="none"/>
    <path d="${faceP}" fill="url(#${u}s)"/>
    <ellipse cx="38" cy="57" rx="5.5" ry="3.2" fill="${blush}" opacity=".35"/><ellipse cx="62" cy="57" rx="5.5" ry="3.2" fill="${blush}" opacity=".35"/>
    <path d="M31 60 Q36 72 50 74 Q64 72 69 60 Q66 70 50 72 Q34 70 31 60Z" fill="${sk2}" opacity=".35"/>
    ${beard}
    ${brow(40, false)}${brow(60, true)}
    ${eyeG(40)}${eyeG(60)}
    <path d="M48.6 47 Q47.4 54 46.6 57.2 Q48.4 59.4 50.8 58.8" stroke="${sk2}" stroke-width="1.1" fill="none" opacity=".85"/>
    <path d="M47 58.2 Q48.2 59.8 50 59.4 Q51.8 59.8 53 58.2" stroke="${shade(skin, 0.55)}" stroke-width="1" fill="none"/>
    <ellipse cx="50.6" cy="55.8" rx="1.6" ry="1" fill="#fff" opacity=".25"/>
    ${lips}
    ${glasses}
    ${L.acc === 'cap' || L.acc === 'beanie' ? acc : hairFront.replace(new RegExp(`fill="${hair}"`, 'g'), `fill="url(#${u}h)"`) + (L.hairStyle !== 'bald' && L.hairStyle !== 'buzz' ? `<path d="M34 27 Q46 22 62 25" stroke="#fff" stroke-width="1.2" fill="none" opacity=".18"/>` : '') + acc}
  </svg>`;
}

/* ------------------------------------------------------------------ */
/* Portraits générés (jeunes du centre, staff) : plus réalistes        */
/* ------------------------------------------------------------------ */
let PID = 0;
const H = (str) => { let h = 2166136261; for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const AFRICA = /Sénégal|Côte d'Ivoire|Cameroun|Mali|Nigeria|Ghana|Congo|Guinée|Gabon|Burkina|Angola|Zambie|Bénin|Togo|Kenya|Afrique du Sud|Cap-Vert|Jamaïque|Haïti|Gambie|Sierra/;
const NORTHAF = /Maroc|Algérie|Tunisie|Égypte|Arabie|Qatar|Émirats|Irak|Iran|Jordanie|Turquie|Israël/;
const ASIA = /Japon|Corée|Chine|Viêt|Thaïlande|Ouzbékistan|Indonésie/;
const LATAM = /Brésil|Colombie|Équateur|Pérou|Venezuela|Paraguay|Mexique|Chili|Bolivie|Costa|Panama|Honduras/;

/** Apparence déterministe d'une personne (même identifiant = même visage), selon nationalité et âge. */
export function personLook(id, nat = '', age = 30) {
  const h = H(id), r = (k) => ((h >>> (k * 3)) % 1000) / 1000;
  const pick = (a, k) => a[Math.floor(r(k) * a.length) % a.length];
  let skins = ['#f3d4bd', '#eac0a0', '#e1ad86', '#d39b74'];
  if (AFRICA.test(nat)) skins = ['#8d5524', '#6f4320', '#5c3a21', '#4a2e1a'];
  else if (NORTHAF.test(nat)) skins = ['#d9a066', '#c68642', '#b98153'];
  else if (ASIA.test(nat)) skins = ['#f1d3b0', '#e8c49d', '#dcb38c'];
  else if (LATAM.test(nat)) skins = ['#e0ac7e', '#c68642', '#a96e3b', '#d9a066', '#8d5524'];
  const dark = AFRICA.test(nat);
  const hairColors = dark ? ['#0e0a08', '#1b1410'] : ASIA.test(nat) ? ['#0e0a08', '#1b1410', '#2b1d14'] : ['#1b1410', '#3d2a1a', '#6b4423', '#a8743c', '#d9b26b', '#8b5a2b'];
  const young = age <= 21;
  const hairStyles = dark ? ['buzz', 'short', 'afro', 'dreads', 'curly'] : young ? ['short', 'quiff', 'sidepart', 'buzz', 'curly', 'slick'] : age > 50 ? ['receding', 'short', 'bald', 'sidepart', 'slick'] : ['short', 'sidepart', 'buzz', 'receding', 'slick', 'curly'];
  return {
    skin: pick(skins, 1), hairStyle: pick(hairStyles, 2), hairColor: age > 55 && r(3) < 0.6 ? pick(['#8a8a8a', '#d6d6d6'], 4) : pick(hairColors, 4),
    beard: young ? (r(5) < 0.15 ? 'stubble' : 'none') : pick(['none', 'none', 'stubble', 'full', 'goatee', 'chinstrap'], 5),
    eyes: pick(dark || ASIA.test(nat) ? ['#2a1a10', '#1d1d1d'] : ['#2a1a10', '#4a2c18', '#2f6b3a', '#2b5d8a', '#6d7f8c'], 6),
    face: pick(['oval', 'round', 'square', 'long'], 7), brows: pick(['normal', 'thick', 'thin'], 8), mouth: pick(['neutral', 'smile', 'neutral'], 9),
    glasses: !young && age > 40 && r(10) < 0.25 ? 'square' : 'none', age,
  };
}

/** Portrait réaliste (dégradés de peau, ombres, nez, lèvres) en tenue de club ou de survêtement. */
export function portraitSvg(look, size = 40, shirt = '#203a6b') {
  const L = look || {};
  // Même rendu détaillé que l'avatar du coach (relief, yeux, nez, lèvres), en tenue de club ;
  // les plus âgés ont quelques rides.
  const wr = L.age > 45 ? `<path d="M36 39.5 Q40 38.4 44 39.4 M56 39.4 Q60 38.4 64 39.5 M35 51 Q34 53 35.5 55 M65 51 Q66 53 64.5 55" stroke="${shade(L.skin || '#e1ad86', 0.72)}" stroke-width=".6" fill="none" opacity=".7"/>` : '';
  const out = L.outfit || (L.age <= 21 ? 'tracksuit' : 'polo');
  return avatarSvg({ ...L, outfit: out, outfitColor: shirt, acc: 'none', bg: L.bg || '#2a3140' }, size).replace('</svg>', `${wr}</svg>`);
}
