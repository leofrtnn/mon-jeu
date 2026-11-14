/**
 * STADES : 20 modèles d'enceintes, un par club de Premier League (inspirés de leur architecture :
 * nombre d'étages, virage géant, toit, couleur des sièges, briques, angles fermés ou ouverts,
 * pylônes d'éclairage, emplacement du parcage visiteur). Les autres clubs reçoivent le modèle
 * dont la capacité est la plus proche de la leur (un parmi les plus proches, stable par club).
 *
 * main / ends : étages de la tribune principale et des virages : [rangs, montée par rang (m)].
 * roof : 'cant' (porte-à-faux), 'glass' (toit translucide), 'tall' (toit haut), 'low' (vieux toit
 * bas sur poteaux), 'none'. corners : 'closed' (angles remplis) ou 'open'. lights : 'roof' ou
 * 'towers' (pylônes). away : 'corner' (coin du virage), 'upper' (haut du virage), 'side'
 * (bout de la tribune latérale). seat : couleur des sièges (null = couleur du club).
 */
export const STADIUMS = [
  { key: 'Arsenal', name: 'Bol moderne à angles fermés', cap: 60704, main: [[13, 0.42], [12, 0.58]], ends: [[13, 0.42], [12, 0.58]], roof: 'glass', corners: 'closed', lights: 'roof', away: 'corner', seat: null, conc: '#a3a8b0', facade: '#d4d8de', steel: '#e9ecef' },
  { key: 'Aston Villa', name: 'Briques victoriennes et grand virage', cap: 43205, main: [[12, 0.4], [10, 0.55]], ends: [[18, 0.46]], roof: 'cant', corners: 'open', lights: 'towers', away: 'side', seat: '#6a1e35', conc: '#8b8f96', facade: '#7b3b2a', steel: '#2b3038' },
  { key: 'Bournemouth', name: 'Petite enceinte compacte', cap: 12357, main: [[11, 0.38]], ends: [[9, 0.36]], roof: 'low', corners: 'open', lights: 'towers', away: 'corner', seat: '#b3121b', conc: '#8d9198', facade: '#5a6069', steel: '#22262d' },
  { key: 'Brentford', name: 'Stade neuf serré', cap: 17250, main: [[12, 0.42]], ends: [[12, 0.42]], roof: 'cant', corners: 'closed', lights: 'roof', away: 'corner', seat: null, conc: '#9da2aa', facade: '#c8ccd2', steel: '#30353d' },
  { key: 'Brighton', name: 'Arches blanches', cap: 32176, main: [[14, 0.42], [10, 0.56]], ends: [[14, 0.42]], roof: 'glass', corners: 'closed', lights: 'roof', away: 'corner', seat: '#1d5bb8', conc: '#a8adb4', facade: '#eef1f4', steel: '#f4f6f8' },
  { key: 'Chelsea', name: 'Enceinte urbaine resserrée', cap: 40044, main: [[12, 0.42], [11, 0.56]], ends: [[12, 0.42], [8, 0.56]], roof: 'cant', corners: 'closed', lights: 'roof', away: 'side', seat: '#1a3a8a', conc: '#8f949b', facade: '#6f747c', steel: '#22262d' },
  { key: 'Coventry', name: 'Bol à un étage', cap: 32609, main: [[16, 0.43]], ends: [[16, 0.43]], roof: 'cant', corners: 'closed', lights: 'roof', away: 'corner', seat: '#6ab0e6', conc: '#a0a5ac', facade: '#d5d9de', steel: '#30353d' },
  { key: 'Crystal Palace', name: 'Vieux stade à poteaux', cap: 25194, main: [[12, 0.38], [6, 0.5]], ends: [[13, 0.38]], roof: 'low', corners: 'open', lights: 'towers', away: 'corner', seat: null, conc: '#83878e', facade: '#4b5059', steel: '#1d2026' },
  { key: 'Everton', name: 'Cathédrale de briques sur les docks', cap: 52769, main: [[14, 0.42], [11, 0.6]], ends: [[24, 0.55]], roof: 'tall', corners: 'closed', lights: 'roof', away: 'upper', seat: '#1b3f94', conc: '#8c8178', facade: '#7b3b2a', steel: '#2a2420' },
  { key: 'Fulham', name: 'Tribunes en briques au bord de l\'eau', cap: 28107, main: [[11, 0.4], [9, 0.55]], ends: [[11, 0.4]], roof: 'low', corners: 'open', lights: 'towers', away: 'side', seat: '#f2f2f2', conc: '#8a8e95', facade: '#8a4b35', steel: '#1f2228' },
  { key: 'Hull', name: 'Bol fermé', cap: 24983, main: [[13, 0.42], [6, 0.55]], ends: [[13, 0.42]], roof: 'glass', corners: 'closed', lights: 'roof', away: 'corner', seat: '#f3a01b', conc: '#9ea3aa', facade: '#c9cdd3', steel: '#2b3038' },
  { key: 'Ipswich', name: 'Stade traditionnel à deux étages', cap: 30056, main: [[12, 0.4], [9, 0.55]], ends: [[13, 0.42]], roof: 'cant', corners: 'open', lights: 'towers', away: 'upper', seat: '#1f4fa0', conc: '#8b9099', facade: '#4a505b', steel: '#2b3038' },
  { key: 'Leeds', name: 'Virage populaire et tribune Est géante', cap: 37633, main: [[13, 0.4], [10, 0.56]], ends: [[16, 0.45]], roof: 'cant', corners: 'closed', lights: 'roof', away: 'corner', seat: '#f2f2f2', conc: '#8e939a', facade: '#1d3a7a', steel: '#1d3a7a' },
  { key: 'Liverpool', name: 'Virage mythique à un seul étage', cap: 61276, main: [[14, 0.42], [12, 0.6], [6, 0.66]], ends: [[24, 0.5]], roof: 'tall', corners: 'closed', lights: 'roof', away: 'corner', seat: '#b4141e', conc: '#8f949b', facade: '#5b1015', steel: '#2b3038' },
  { key: 'Manchester City', name: 'Bol à trois étages et mâts', cap: 61038, main: [[13, 0.42], [12, 0.58], [8, 0.64]], ends: [[13, 0.42], [12, 0.58]], roof: 'cant', corners: 'closed', lights: 'roof', away: 'upper', seat: '#6cabdd', conc: '#9aa0a8', facade: '#c9ced6', steel: '#3d4450' },
  { key: 'Manchester United', name: 'Théâtre des rêves', cap: 74158, main: [[14, 0.42], [13, 0.6]], ends: [[14, 0.42], [13, 0.6]], roof: 'tall', corners: 'closed', lights: 'roof', away: 'corner', seat: '#c8102e', conc: '#8b8f96', facade: '#7a1515', steel: '#22262d' },
  { key: 'Newcastle', name: 'Tribunes géantes asymétriques', cap: 52729, main: [[12, 0.42], [15, 0.68]], ends: [[12, 0.42], [6, 0.58]], roof: 'glass', corners: 'closed', lights: 'roof', away: 'upper', seat: '#202020', conc: '#9a9fa6', facade: '#d0d4da', steel: '#e3e6ea' },
  { key: 'Nottingham Forest', name: 'Stade au bord du fleuve', cap: 31212, main: [[13, 0.42], [8, 0.55]], ends: [[14, 0.42]], roof: 'low', corners: 'open', lights: 'towers', away: 'side', seat: '#dd0000', conc: '#878b92', facade: '#4b5059', steel: '#22262d' },
  { key: 'Sunderland', name: 'Bol à deux étages', cap: 48095, main: [[14, 0.42], [11, 0.58]], ends: [[14, 0.42], [11, 0.58]], roof: 'cant', corners: 'closed', lights: 'roof', away: 'upper', seat: '#d6001c', conc: '#9a9fa6', facade: '#b5bac1', steel: '#2b3038' },
  { key: 'Tottenham', name: 'Arène moderne et mur unique', cap: 62850, main: [[13, 0.42], [12, 0.6]], ends: [[26, 0.52]], roof: 'glass', corners: 'closed', lights: 'roof', away: 'corner', seat: '#0e1a3d', conc: '#a1a6ad', facade: '#d8dde3', steel: '#c4cad1' },
];

const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };

/** Modèle de stade d'un club (Premier League : le sien ; ailleurs : capacité équivalente). */
export function stadiumFor(club) {
  if (!club) return STADIUMS[0];
  const own = STADIUMS.find((m) => club.country === 'ENG' && club.name?.includes(m.key));
  if (own) return own;
  const cap = club.stadium || 20000 + (club.rep || 50) * 400;
  const near = STADIUMS.slice().sort((a, b) => Math.abs(Math.log(a.cap / cap)) - Math.abs(Math.log(b.cap / cap))).slice(0, 3);
  return near[hash(club.id ?? club.name) % near.length];
}
