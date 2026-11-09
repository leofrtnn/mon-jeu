/**
 * Avatar du coach en SVG (style illustré plat), généré à partir de son apparence.
 */
const shade = (hex, k) => {
  const v = parseInt(hex.slice(1), 16);
  const f = (x) => Math.max(0, Math.min(255, Math.round(x * k)));
  return '#' + [f((v >> 16) & 255), f((v >> 8) & 255), f(v & 255)].map((x) => x.toString(16).padStart(2, '0')).join('');
};

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
    default: hairFront = `<path d="M26 42 Q25 21 50 19 Q75 21 74 42 Q71 31 62 29 Q50 25 38 30 Q30 33 26 42Z" fill="${hair}"/>`;
  }
  let beard = '';
  switch (L.beard) {
    case 'stubble': beard = `<path d="M33 56 Q36 74 50 76 Q64 74 67 56 Q60 66 50 66 Q40 66 33 56Z" fill="${hair}" opacity=".35"/>`; break;
    case 'full': beard = `<path d="M30 50 Q31 78 50 80 Q69 78 70 50 Q64 64 50 64 Q36 64 30 50Z" fill="${hair}"/><path d="M42 63 Q50 60 58 63 Q50 67 42 63Z" fill="${hairDark}"/>`; break;
    case 'moustache': beard = `<path d="M40 61 Q45 57 50 60 Q55 57 60 61 Q55 63 50 62 Q45 63 40 61Z" fill="${hair}"/>`; break;
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
  } else {
    outfit = `<path d="M14 100 Q16 82 34 78 L50 92 L66 78 Q84 82 86 100Z" fill="${cloth}"/><path d="M42 80 L50 92 L58 80 L50 84Z" fill="#f4f4f4"/>
      <path d="M48 84 L52 84 L53 98 L50 100 L47 98Z" fill="#9b1c2b"/><path d="M34 78 L46 98 M66 78 L54 98" stroke="${clothDark}" stroke-width="2.5"/>`;
  }
  const glasses = L.glasses ? `<g fill="none" stroke="#1a1a1a" stroke-width="1.8"><rect x="34" y="44" width="12" height="9" rx="3"/><rect x="54" y="44" width="12" height="9" rx="3"/><path d="M46 48 L54 48"/></g>` : '';
  return `<svg viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="Avatar du coach" style="border-radius:50%;background:${bg};flex:none">
    ${hairBack}
    <rect x="43" y="64" width="14" height="16" rx="5" fill="${dark}"/>
    ${outfit}
    <ellipse cx="27" cy="50" rx="4" ry="6" fill="${dark}"/><ellipse cx="73" cy="50" rx="4" ry="6" fill="${dark}"/>
    <path d="M28 44 Q28 22 50 22 Q72 22 72 44 Q72 72 50 74 Q28 72 28 44Z" fill="${skin}"/>
    ${beard}
    <path d="M36 42 Q40 39 45 41 M55 41 Q60 39 64 42" stroke="${hairDark}" stroke-width="2.2" fill="none" stroke-linecap="round"/>
    <circle cx="40" cy="48" r="2.3" fill="#1d1d1d"/><circle cx="60" cy="48" r="2.3" fill="#1d1d1d"/>
    <path d="M50 50 Q48 57 51 58" stroke="${dark}" stroke-width="1.6" fill="none"/>
    <path d="M43 64 Q50 68 57 64" stroke="#7a3b2e" stroke-width="2" fill="none" stroke-linecap="round"/>
    ${glasses}
    ${hairFront}
  </svg>`;
}
