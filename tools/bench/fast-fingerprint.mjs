// Empreinte du MOTEUR RAPIDE (match.js) : elle ne doit jamais changer pendant la refonte du direct.
import { cfgFor, simulateMatch, hash } from './common.mjs';
const N = +(process.argv[2] || 40), parts = [];
for (let i = 1; i <= N; i++) {
  const r = simulateMatch(await cfgFor(i));
  const m = r.match || r;
  parts.push(`${m.score}|${m.teams.map((t) => Object.values(t.stats).map((v) => +(+v).toFixed(3)).join(',')).join(';')}|${(m.log || []).length}`);
}
console.log(JSON.stringify({ engine: 'rapide', matches: N, fingerprint: hash(parts.join('\n')) }));
