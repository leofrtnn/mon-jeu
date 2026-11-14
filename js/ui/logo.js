/**
 * LOGO DU JEU : un écusson (dégradé violet nuit), un demi-terrain stylisé, un ballon classique
 * avec une trajectoire dorée, une étoile ; et le nom en lettres condensées.
 */
let N = 0;
export function logoMark(size = 96) {
  const id = `lg${++N}`;
  return `<svg class="logo-mark" viewBox="0 0 120 140" width="${size}" height="${Math.round(size * 140 / 120)}" role="img" aria-label="Coach de Poche">
  <defs>
    <linearGradient id="${id}a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#8b5cf6"/><stop offset=".55" stop-color="#5b21b6"/><stop offset="1" stop-color="#1e1b4b"/></linearGradient>
    <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fde68a"/><stop offset="1" stop-color="#f59e0b"/></linearGradient>
    <radialGradient id="${id}c" cx=".38" cy=".32" r=".75"><stop offset="0" stop-color="#ffffff"/><stop offset=".7" stop-color="#e7ecf5"/><stop offset="1" stop-color="#aab4c8"/></radialGradient>
    <clipPath id="${id}k"><path d="M60 6 110 22v44c0 34-21 58-50 70C31 124 10 100 10 66V22z"/></clipPath>
  </defs>
  <path d="M60 6 110 22v44c0 34-21 58-50 70C31 124 10 100 10 66V22z" fill="url(#${id}a)"/>
  <g clip-path="url(#${id}k)" opacity=".28" stroke="#fff" stroke-width="2" fill="none">
    <path d="M10 96h100"/><circle cx="60" cy="96" r="22"/><path d="M38 136v-18h44v18"/>
  </g>
  <path d="M60 6 110 22v44c0 34-21 58-50 70C31 124 10 100 10 66V22z" fill="none" stroke="url(#${id}b)" stroke-width="4"/>
  <path d="M60 14 102 27" stroke="rgba(255,255,255,.35)" stroke-width="2" stroke-linecap="round"/>
  <path d="M22 84C34 40 74 30 100 44" fill="none" stroke="url(#${id}b)" stroke-width="5" stroke-linecap="round" stroke-dasharray="1 9" opacity=".9"/>
  <g transform="translate(60 66)">
    <circle r="24" fill="url(#${id}c)" stroke="#0f172a" stroke-width="2"/>
    <path d="M0-9 8.6-2.8 5.3 7.3H-5.3L-8.6-2.8Z" fill="#0f172a"/>
    <path d="M0-9V-22M8.6-2.8 20.6-7.6M5.3 7.3 12.7 19M-5.3 7.3-12.7 19M-8.6-2.8-20.6-7.6" stroke="#0f172a" stroke-width="2.4"/>
    <path d="M-17-17-12-22 0-24M17-17 12-22M22 6 18 14M-22 6-18 14M-6 23 6 23" stroke="#0f172a" stroke-width="2.4" fill="none" stroke-linecap="round"/>
  </g>
  <path d="M60 104l3.5 7.2 7.9 1.1-5.7 5.6 1.4 7.9-7.1-3.8-7.1 3.8 1.4-7.9-5.7-5.6 7.9-1.1z" fill="url(#${id}b)"/>
</svg>`;
}

export function logoFull(size = 96, sub = true) {
  return `<div class="logo-full">${logoMark(size)}<div class="logo-word"><b>COACH</b><em>DE POCHE</em>${sub ? '<small>Football Manager de poche</small>' : ''}</div></div>`;
}
