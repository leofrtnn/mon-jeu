import { imgTag } from './images.js';
/**
 * TROPHÉES : illustrations vectorielles originales (formes génériques, aucun logo officiel copié).
 *  ears  : grande coupe à larges anses (Coupe d'Europe des clubs champions)
 *  vase  : coupe-vase élancée (Coupe UEFA)
 *  lib   : coupe haute surmontée d'un joueur stylisé (Copa Libertadores)
 *  cup   : coupe classique à deux anses (coupes nationales, autres continentales)
 *  plate : plateau rond (championnat d'Allemagne)
 *  league: trophée de championnat (couronne + coupe)
 *  shield: bouclier (supercoupes)
 */
const GOLD = ['#fff3c4', '#f4c430', '#b8860b'];
const SILVER = ['#ffffff', '#cfd6e6', '#7d879c'];

function grad(id, [a, b, c]) {
  return `<defs><linearGradient id="${id}" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stop-color="${a}"/><stop offset=".45" stop-color="${b}"/><stop offset="1" stop-color="${c}"/></linearGradient></defs>`;
}

let n = 0;
export function trophySvg(kind = 'cup', size = 64, metal = 'gold') {
  const id = `tg${++n}`;
  const g = grad(id, metal === 'silver' ? SILVER : GOLD);
  const f = `fill="url(#${id})"`;
  const base = `<rect x="22" y="84" width="36" height="8" rx="2" fill="#3b2a12"/><rect x="26" y="78" width="28" height="7" rx="2" ${f}/>`;
  let body;
  switch (kind) {
    case 'ears':
      body = `<path d="M24 14h32c0 22-6 34-16 38-10-4-16-16-16-38z" ${f}/>
        <path d="M24 18C6 16 4 46 30 46" fill="none" stroke="url(#${id})" stroke-width="5"/><path d="M56 18c18-2 20 28-6 28" fill="none" stroke="url(#${id})" stroke-width="5"/>
        <rect x="36" y="52" width="8" height="14" ${f}/><path d="M28 66h24l2 12H26z" ${f}/>`;
      break;
    case 'vase':
      body = `<path d="M30 8h20l-2 10c8 6 8 22 0 30l-4 6h-8l-4-6c-8-8-8-24 0-30z" ${f}/>
        <path d="M30 22c-8 0-8 14 0 16M50 22c8 0 8 14 0 16" fill="none" stroke="url(#${id})" stroke-width="3"/>
        <rect x="36" y="54" width="8" height="12" ${f}/><path d="M29 66h22l3 12H26z" ${f}/>`;
      break;
    case 'lib':
      body = `<circle cx="40" cy="8" r="4" ${f}/><path d="M37 12h6l2 12h-10z" ${f}/>
        <path d="M27 24h26c0 14-5 22-13 26-8-4-13-12-13-26z" ${f}/><rect x="37" y="50" width="6" height="10" ${f}/>
        <path d="M30 60h20l4 18H26z" ${f}/>`;
      break;
    case 'plate':
      body = `<ellipse cx="40" cy="46" rx="32" ry="30" ${f}/><ellipse cx="40" cy="46" rx="22" ry="20" fill="none" stroke="rgba(0,0,0,.18)" stroke-width="2"/>
        <ellipse cx="40" cy="46" rx="12" ry="11" fill="rgba(0,0,0,.08)"/>`;
      return `<svg class="trophy" viewBox="0 0 80 96" width="${size}" height="${size * 1.2}">${g}${body}</svg>`;
    case 'league':
      body = `<path d="M28 6l4 6 8-8 8 8 4-6 2 12H26z" ${f}/><path d="M24 20h32c0 18-6 28-16 32-10-4-16-14-16-32z" ${f}/>
        <path d="M24 24c-10 0-10 16 2 18M56 24c10 0 10 16-2 18" fill="none" stroke="url(#${id})" stroke-width="4"/>
        <rect x="36" y="52" width="8" height="14" ${f}/><path d="M28 66h24l2 12H26z" ${f}/>`;
      break;
    case 'shield':
      body = `<path d="M40 6l28 10v22c0 20-12 34-28 40C24 72 12 58 12 38V16z" ${f}/><path d="M40 16l18 7v15c0 13-8 23-18 27-10-4-18-14-18-27V23z" fill="rgba(0,0,0,.12)"/>
        <path d="M40 28l4 8 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1z" fill="rgba(255,255,255,.55)"/>`;
      return `<svg class="trophy" viewBox="0 0 80 96" width="${size}" height="${size * 1.2}">${g}${body}</svg>`;
    default:
      body = `<path d="M26 12h28c0 22-5 32-14 36-9-4-14-14-14-36z" ${f}/>
        <path d="M26 16c-12 0-12 20 4 22M54 16c12 0 12 20-4 22" fill="none" stroke="url(#${id})" stroke-width="4"/>
        <rect x="36" y="48" width="8" height="18" ${f}/><path d="M28 66h24l2 12H26z" ${f}/>`;
  }
  return `<svg class="trophy" viewBox="0 0 80 96" width="${size}" height="${size * 1.2}">${g}${body}${base}</svg>`;
}

/** Type de trophée d'un championnat (plateau pour l'Allemagne). */
export const leagueTrophy = (country) => (country === 'GER' ? 'plate' : 'league');

/**
 * Photos réelles des trophées (Wikimedia Commons / Wikipédia), affichées comme les logos des clubs :
 * l'image est chargée depuis Wikimedia (rien n'est copié dans le dépôt) ; tant qu'elle n'est pas
 * chargée (ou si elle est indisponible), le dessin vectoriel reste visible.
 */
const TROPHY_PHOTOS = {
  ucl: 'Trofeo UEFA Champions League.jpg',
  uel: 'PSV tegen Bastia, Uefacup Willy van de Kuylen met de beker, Bestanddeelnr 929-7082.jpg',
  acl: 'AFC Champions League trophy.jpg',
  caf: '1 c1 trophe Kwame Nkrumah.jpg',
  'cup:ENG': 'The FA Cup Trophy.jpg',
  'cup:GER': '2018-09-17 Eintracht Frankfurt Golf Open DFB Pokal-8909.jpg',
  'cup:SCO': 'Scottish cup.jpg',
  'cup:POR': 'Taça de Portugal Trophy.svg',
  'league:ENG': 'Trophy of FA Premier League in Singapore, 2023.jpg',
  'league:GER': 'Trophy of Fußball-Bundesliga in Singapore, 2023.jpg',
  'league:FRA': 'Ligue 1 Trophy 2024.png',
  'league:TUR': '2014–15 Süper Lig Cup.jpg',
  'super:ENG': 'FA Community Shield.JPG',
  'super:FRA': 'Trophée des champions.jpeg',
  'super:GER': 'Replik des DFL Supercup, FC Bayern Erlebniswelt.jpg',
};
export const trophyPhoto = (key) => TROPHY_PHOTOS[key] || null;

/** Trophée : photo réelle si disponible, dessin sinon (et en attendant le chargement). */
export function trophyArt(key, kind, size = 64) {
  const file = TROPHY_PHOTOS[key];
  const svg = trophySvg(kind, size);
  if (!file) return svg;
  return `<span class="tro-art" style="--ts:${size}px">${svg}${imgTag(file, size * 2, 'photo')}</span>`;
}
