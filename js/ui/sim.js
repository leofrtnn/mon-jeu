/**
 * Simulation de journées : dans un Web Worker si possible, sinon sur le fil principal.
 */
import { completeDay, today } from '../game/season.js';
import { setNextId } from '../data/generator.js';

let worker = null; // null = pas encore créé, false = indisponible
let seq = 0;
const pending = new Map();

function getWorker() {
  if (worker !== null) return worker;
  try {
    worker = new Worker(new URL('../game/worker.js', import.meta.url), { type: 'module' });
    worker.onmessage = (e) => { const p = pending.get(e.data.id); if (p) { pending.delete(e.data.id); p.resolve(e.data); } };
    worker.onerror = (e) => { for (const p of pending.values()) p.reject(e); pending.clear(); worker = false; };
  } catch { worker = false; }
  return worker;
}

/** Simule n journées (ou jusqu'au prochain match de l'utilisateur). Met à jour app.state. */
export async function simulateDays(app, n = 1, stopAtUserMatch = false) {
  const w = getWorker();
  if (w) {
    try {
      const res = await new Promise((resolve, reject) => {
        const id = ++seq;
        pending.set(id, { resolve, reject });
        w.postMessage({ id, state: app.state, n, stopAtUserMatch });
      });
      if (!res.error) {
        if (typeof window !== 'undefined') window.__simMode = 'worker';
        setNextId(res.state.nextId);
        app.state = res.state;
        return res.reports;
      }
      console.warn('Worker :', res.error);
    } catch (e) { console.warn('Worker indisponible, simulation locale', e); worker = false; }
  }
  // Repli : simulation sur le fil principal.
  if (typeof window !== 'undefined') window.__simMode = 'main';
  const reports = [];
  for (let i = 0; i < n && !app.state.seasonOver; i++) {
    if (stopAtUserMatch && i > 0 && today(app.state).userFixture) break;
    reports.push(completeDay(app.state, null));
    await new Promise((r) => setTimeout(r, 0));
  }
  return reports;
}

/** Petit voile "Simulation…" pendant les calculs. */
export function busy(on, text = 'Simulation…') {
  let el = document.getElementById('busy');
  if (!el) {
    el = document.createElement('div'); el.id = 'busy';
    el.innerHTML = '<div class="spinner"></div><span></span>';
    document.body.appendChild(el);
  }
  el.querySelector('span').textContent = text;
  el.classList.toggle('show', on);
}
