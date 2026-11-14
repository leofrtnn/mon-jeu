/**
 * MÉTÉO ET HEURE DU MATCH
 * ------------------------------------------------------------------
 * Conditions stables pour un match donné (même graine, même date → même météo), selon le
 * climat du pays et la saison ; heure du coup d'envoi selon le pays et la compétition.
 * Effets réels dans le moteur (wx) :
 *  - pluie : ballon qui fuse et glisse (le ballon roule plus loin, rebonds rasants), passes
 *    et prises de balle des gardiens moins sûres ;
 *  - forte pluie : idem en plus marqué, joueurs un peu moins rapides (appuis) ;
 *  - neige : ballon freiné, appuis difficiles, fatigue accrue ;
 *  - vent : ballons aériens et frappes de loin moins précis ;
 *  - chaleur : fatigue nettement plus forte ; froid : légère hausse des blessures.
 *  - nocturne / journée : rendu (projecteurs ou soleil), sans effet sur le jeu.
 */
import { createRng, hashSeed } from '../core/rng.js';

export const WEATHER_KINDS = {
  sun: { icon: '☀️', label: 'Ensoleillé' },
  clear: { icon: '🌤️', label: 'Ciel dégagé' },
  cloud: { icon: '☁️', label: 'Nuageux' },
  rain: { icon: '🌧️', label: 'Pluie' },
  storm: { icon: '⛈️', label: 'Forte pluie' },
  snow: { icon: '🌨️', label: 'Neige' },
  wind: { icon: '💨', label: 'Grand vent' },
  fog: { icon: '🌫️', label: 'Brouillard' },
};

/** Climat par pays : [température été, hiver, probabilité de pluie, neige possible]. */
const CLIMATE = {
  ENG: [20, 5, 0.42, 0.05], SCO: [17, 3, 0.5, 0.1], ESP: [29, 11, 0.15, 0], ITA: [27, 9, 0.22, 0.02], GER: [22, 2, 0.35, 0.12],
  FRA: [24, 6, 0.32, 0.04], POR: [26, 12, 0.22, 0], NED: [20, 4, 0.42, 0.06], BEL: [21, 4, 0.42, 0.06], TUR: [28, 7, 0.2, 0.06],
  NOR: [17, -4, 0.38, 0.35], SWE: [19, -3, 0.35, 0.3], DEN: [19, 1, 0.38, 0.15], POL: [22, -1, 0.32, 0.2], CZE: [22, 0, 0.3, 0.2],
  AUT: [23, 0, 0.33, 0.22], SUI: [22, 1, 0.35, 0.2], CRO: [26, 6, 0.25, 0.05], SRB: [26, 2, 0.25, 0.12], GRE: [30, 11, 0.15, 0],
  RUS: [21, -8, 0.3, 0.45], UKR: [23, -3, 0.3, 0.3], ROU: [25, -1, 0.28, 0.2], HUN: [25, 0, 0.27, 0.15], CYP: [32, 15, 0.1, 0],
  ISR: [30, 15, 0.12, 0], BRA: [28, 22, 0.35, 0], ARG: [24, 12, 0.25, 0], KSA: [38, 22, 0.04, 0], UAE: [38, 23, 0.03, 0],
  QAT: [38, 22, 0.03, 0], MEX: [24, 18, 0.3, 0], USA: [27, 4, 0.28, 0.08], JPN: [28, 6, 0.32, 0.04], KOR: [27, -1, 0.32, 0.12],
  CHN: [28, 2, 0.3, 0.08], AUS: [15, 25, 0.25, 0], MAR: [28, 15, 0.15, 0], EGY: [34, 19, 0.03, 0], RSA: [16, 26, 0.25, 0],
  PER: [21, 18, 0.1, 0], SVK: [23, -1, 0.3, 0.2], BUL: [26, 1, 0.25, 0.15], ALG: [31, 12, 0.12, 0], TUN: [31, 12, 0.12, 0], PAR: [30, 17, 0.25, 0], CHI: [16, 22, 0.15, 0], COL: [23, 23, 0.38, 0], URU: [14, 24, 0.25, 0], ECU: [20, 20, 0.35, 0],
};
/** Hémisphère sud : saisons inversées. */
const SOUTH = new Set(['BRA', 'ARG', 'AUS', 'RSA', 'PER', 'CHI', 'URU', 'ECU', 'PAR']);

/** Heures de coup d'envoi habituelles (week-end / semaine) par pays. */
const HOURS = {
  ENG: [[12.5, 15, 17.5], [19.75, 20]], ESP: [[14, 16.25, 18.5, 21], [19, 21.5]], ITA: [[15, 18, 20.75], [18.5, 20.75]],
  GER: [[15.5, 18.5], [18.5, 20.75]], FRA: [[13, 15, 17, 21.07], [19, 21]], POR: [[18, 20.5], [19, 21.25]],
  KSA: [[19, 21], [20, 21.5]], UAE: [[19, 21], [20]], QAT: [[19, 21], [20]], EGY: [[17, 20], [19]], BRA: [[16, 18.5, 21.5], [19, 21.5]],
  ARG: [[15, 17.5, 20], [19, 21]], USA: [[16.5, 19.5], [19.5]], MEX: [[17, 19, 21], [19, 21]], JPN: [[14, 19], [19]],
};

/** Conditions du jour pour un match (stables). comp : league | cup | conti | super | intl | friendly. */
export function matchConditions({ seed = 1, country = 'FRA', date = null, comp = 'league', midweek = false, h = 0, a = 0 }) {
  const rng = createRng(hashSeed(`meteo-${seed}-${h}-${a}-${date}`));
  const month = date ? +String(date).slice(5, 7) - 1 : 8;
  const cl = CLIMATE[country] || [22, 6, 0.3, 0.05];
  let warm = [0, 0.1, 0.25, 0.5, 0.75, 0.95, 1, 1, 0.85, 0.6, 0.3, 0.1][month];
  if (SOUTH.has(country)) warm = 1 - warm;
  const temp = Math.round(cl[1] + (cl[0] - cl[1]) * warm + rng.range(-4, 4));
  const wet = cl[2] * (warm > 0.8 ? 0.7 : 1.15);
  let kind;
  const r = rng.next();
  if (temp <= 1 && rng.chance(cl[3] * 1.4)) kind = 'snow';
  else if (r < wet * 0.25) kind = 'storm';
  else if (r < wet) kind = 'rain';
  else if (r < wet + 0.07) kind = 'wind';
  else if (r < wet + 0.1 && temp < 10) kind = 'fog';
  else if (r < wet + 0.35) kind = 'cloud';
  else kind = temp >= 22 ? 'sun' : 'clear';
  const wind = Math.round(kind === 'wind' ? rng.range(35, 60) : kind === 'storm' ? rng.range(25, 45) : rng.range(3, 22));
  // Heure : coupes d'Europe en soirée, sélections et supercoupes à 20 h 45, sinon selon le pays.
  let hour;
  if (comp === 'conti') hour = rng.pick([18.75, 21]);
  else if (comp === 'intl' || comp === 'super') hour = 20.75;
  else if (comp === 'friendly') hour = rng.pick([11, 16, 18, 19.5]);
  else { const hs = HOURS[country] || [[15, 17, 20], [19, 20.5]]; hour = rng.pick(midweek || comp === 'cup' ? hs[1] : hs[0]); }
  return { kind, temp, wind, hour, ...WEATHER_KINDS[kind], night: hour >= 19.5 || (hour >= 17.5 && (month >= 9 || month <= 2) !== SOUTH.has(country)) };
}

/** Effets sur le jeu (multiplicateurs ; 1 = neutre). */
export function weatherMods(w) {
  if (!w) return { roll: 1, skid: 1, passRisk: 1, speed: 1, fatigue: 1, grip: 1, aim: 1, air: 1, injury: 1 };
  const k = w.kind;
  const m = {
    roll: k === 'rain' ? 0.75 : k === 'storm' ? 0.62 : k === 'snow' ? 1.9 : 1,            // décélération du ballon au sol
    skid: k === 'rain' ? 1.08 : k === 'storm' ? 1.12 : k === 'snow' ? 0.75 : 1,           // rebonds rasants sur pelouse mouillée
    passRisk: k === 'rain' ? 1.12 : k === 'storm' ? 1.28 : k === 'snow' ? 1.3 : k === 'wind' ? 1.08 : 1,
    speed: k === 'storm' ? 0.97 : k === 'snow' ? 0.93 : 1,
    fatigue: (w.temp >= 30 ? 1.35 : w.temp >= 26 ? 1.15 : 1) * (k === 'snow' ? 1.1 : 1),
    grip: k === 'rain' ? 0.82 : k === 'storm' ? 0.68 : k === 'snow' ? 0.8 : 1,           // prises de balle des gardiens
    aim: k === 'wind' ? 0.9 : k === 'storm' ? 0.93 : k === 'fog' ? 0.96 : 1,              // précision des frappes
    air: k === 'wind' ? 1.3 : k === 'storm' ? 1.15 : 1,                                   // erreurs sur les ballons aériens
    injury: w.temp <= 2 ? 1.2 : 1,
  };
  return m;
}

/** Texte court des effets (avant-match). */
export function weatherEffectText(w) {
  if (!w) return '';
  const t = [];
  if (w.kind === 'rain') t.push('pelouse grasse : le ballon fuse, les gardiens relâchent plus');
  if (w.kind === 'storm') t.push('déluge : ballon imprévisible, appuis glissants');
  if (w.kind === 'snow') t.push('neige : ballon freiné, appuis difficiles');
  if (w.kind === 'wind') t.push('vent : centres et frappes de loin moins précis');
  if (w.kind === 'fog') t.push('brouillard : visibilité réduite');
  if (w.temp >= 26) t.push('chaleur : les organismes vont souffrir');
  if (w.temp <= 2) t.push('froid : risque de blessure accru');
  return t.join(' · ') || 'conditions idéales';
}
export const hourLabel = (h) => `${Math.floor(h)} h ${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;
