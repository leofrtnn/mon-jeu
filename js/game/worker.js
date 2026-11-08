/**
 * Web Worker : simule une ou plusieurs journées hors du fil principal
 * (l'interface reste fluide pendant le calcul des ~45 matchs d'une journée).
 */
import { completeDay, today } from './season.js';
import { setNextId, getNextId } from '../data/generator.js';

self.onmessage = (e) => {
  const { id, state, n, stopAtUserMatch } = e.data;
  try {
    setNextId(state.nextId);
    const reports = [];
    for (let i = 0; i < n && !state.seasonOver; i++) {
      const t = today(state);
      if (stopAtUserMatch && i > 0 && t.userFixture) break;
      reports.push(completeDay(state, null));
    }
    state.nextId = getNextId();
    self.postMessage({ id, state, reports });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.stack || err) });
  }
};
