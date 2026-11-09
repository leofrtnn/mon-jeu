/**
 * DATES : calendrier réel de la saison (mi-août → fin mai), mercato d'été et d'hiver,
 * dernier jour du mercato.
 */
const DAY = 86400000;
const iso = (t) => new Date(t).toISOString().slice(0, 10);
const t0 = (s) => Date.parse(s + 'T12:00:00Z');

/** Attribue une date à chaque journée : championnat le samedi, coupes en semaine, trêve hivernale. */
export function assignDates(calendar, season) {
  let cur = t0(`${season}-08-14`);
  while (new Date(cur).getUTCDay() !== 6) cur += DAY; // premier samedi
  let lastLeague = cur;
  for (const e of calendar) {
    if (e.type === 'league') {
      e.date = iso(cur); lastLeague = cur; cur += 7 * DAY;
      if (e.round === 18) cur += 7 * DAY; // trêve hivernale
    } else if (e.type === 'intl') {
      e.date = iso(cur); cur += 7 * DAY;
    } else {
      e.date = iso(lastLeague + 3 * DAY); // mardi/mercredi
    }
  }
}

export const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const WD = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
export function fmtDate(s, withDay = true) {
  if (!s) return '';
  const d = new Date(t0(s));
  return `${withDay ? WD[d.getUTCDay()] + ' ' : ''}${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

/** Date longue pour l'en-tête : « Sam. 17 août 2026 ». */
export function longDate(s) {
  if (!s) return '';
  const d = new Date(t0(s));
  const wd = WD[d.getUTCDay()];
  return `${wd[0].toUpperCase()}${wd.slice(1)} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Fenêtres de transfert de la saison. */
export function windows(season) {
  return [
    { name: 'été', from: `${season}-06-15`, to: `${season}-09-01` },
    { name: 'hiver', from: `${season + 1}-01-02`, to: `${season + 1}-02-01` },
  ];
}

/** Date de la journée courante (assigne les dates si une ancienne sauvegarde n'en a pas). */
export function currentDate(state) {
  if (state.calendar?.length && !state.calendar[0].date) assignDates(state.calendar, state.season);
  if (state.preseason?.active) return `${state.season}-07-20`;
  return state.calendar?.[state.day]?.date || `${state.season + 1}-05-30`;
}

/** État du mercato : ouvert ?, dernier jour ?, date de fermeture. */
export function windowInfo(state) {
  const d = currentDate(state);
  for (const w of windows(state.season)) {
    if (d >= w.from && d <= w.to) {
      const days = state.calendar.map((e) => e.date).filter((x) => x >= d && x <= w.to);
      const deadline = !state.preseason?.active && days.length === 1;
      return { open: true, name: w.name, closes: w.to, deadline, label: deadline ? '⏰ Dernier jour du mercato !' : `Mercato d'${w.name} ouvert jusqu'au ${fmtDate(w.to, false)}` };
    }
  }
  const next = windows(state.season).find((w) => w.from > d);
  return { open: false, label: next ? `Mercato fermé · réouverture le ${fmtDate(next.from, false)}` : 'Mercato fermé' };
}
