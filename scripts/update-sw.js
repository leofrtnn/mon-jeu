/**
 * Régénère la liste des fichiers mis en cache par le service worker.
 * Usage : node scripts/update-sw.js  (à lancer après avoir ajouté/supprimé un fichier)
 */
import { readdirSync, statSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const walk = (d) => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? walk(join(d, f)) : [join(d, f)]));
const files = ['index.html', 'manifest.webmanifest', 'data/real-world.json', ...['css', 'js', 'icons'].flatMap(walk)].sort();
const sw = readFileSync('sw.js', 'utf8');
const list = ["  './',", ...files.map((f) => `  './${f}',`)].join('\n');
const out = sw.replace(/const ASSETS = \[[\s\S]*?\];/, `const ASSETS = [\n${list}\n];`)
  .replace(/const VERSION = 'cdp-v(\d+)';/, (_, n) => `const VERSION = 'cdp-v${+n + 1}';`);
writeFileSync('sw.js', out);
const v = out.match(/const VERSION = 'cdp-v(\d+)';/)[1];
writeFileSync('js/version.js', `/** Numéro de version affiché (mis à jour par scripts/update-sw.js). */\nexport const APP_VERSION = ${v};\n`);
writeFileSync('version.json', JSON.stringify({ v: +v }) + '\n');
console.log(`${files.length} fichiers dans le cache du service worker.`);
