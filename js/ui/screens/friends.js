/**
 * Amis (multijoueur asynchrone, sans serveur) : code d'équipe, défi en amical,
 * ligue entre amis déterministe (mêmes codes = mêmes résultats chez chacun).
 */
import { snapshotTeam, encodeTeam, decodeTeam, friendCfg, computeFriendsLeague, encodeLeague, decodeLeague } from '../../game/friends.js';
import { teamCfg } from '../../game/season.js';
import { userClub } from '../../game/state.js';
import { esc } from '../components.js';
import { shareText } from '../files.js';
import { openMatch } from './match.js';

let league = null; // résultat calculé (cache d'affichage)

export function render(app) {
  const f = app.state.friends || (app.state.friends = { teams: [] });
  const myCode = app.ui.myCode;
  return `<div class="card"><h3>Mon code d'équipe</h3>
      <p class="muted" style="font-size:13px;margin-top:0">Votre onze, votre banc et votre tactique, figés dans un code à envoyer à vos amis (SMS, messagerie…).</p>
      ${myCode ? `<textarea readonly id="mycode">${esc(myCode)}</textarea>
        <div class="btns" style="margin-top:8px"><button class="btn primary" data-act="shareCode">Partager / copier</button><button class="btn" data-act="genCode">Régénérer</button></div>`
      : '<button class="btn primary block" data-act="genCode">Générer mon code</button>'}
    </div>
    <div class="card"><h3>Défier un ami</h3>
      <textarea id="friendcode" placeholder="Collez ici le code d'équipe d'un ami (CDP1-…)"></textarea>
      <div class="btns" style="margin-top:8px"><button class="btn primary" data-act="challenge">⚔ Jouer l'amical en direct</button><button class="btn" data-act="addTeam">+ Ajouter à la ligue</button></div>
      <p class="muted" style="font-size:12px;margin-bottom:0">Un amical ne compte pas pour la saison (pas de fatigue ni de blessure conservées).</p>
    </div>
    <div class="card"><h3>Ligue entre amis (${f.teams.length} équipe${f.teams.length > 1 ? 's' : ''})</h3>
      ${f.teams.map((t, i) => `<div class="row" style="padding:6px 0;border-bottom:1px solid var(--line)"><span class="crest sm" style="background:${t.color};color:${t.color2}">${esc(t.short)}</span>
        <span class="grow">${esc(t.name)}${t.mine ? ' <small>(vous)</small>' : ''}</span><button class="btn sm ghost" data-act="rmTeam" data-v="${i}">✕</button></div>`).join('') || '<p class="muted" style="margin:0">Ajoutez votre équipe et celles de vos amis.</p>'}
      <div class="btns" style="margin-top:10px">
        <button class="btn" data-act="addMine">+ Mon équipe</button>
        <button class="btn primary" data-act="runLeague" ${f.teams.length < 2 ? 'disabled' : ''}>Calculer la ligue</button></div>
      <div class="btns" style="margin-top:8px">
        <button class="btn sm" data-act="shareLeague" ${f.teams.length < 2 ? 'disabled' : ''}>Partager la ligue</button>
        <button class="btn sm" data-act="importLeague">Importer un code de ligue</button></div>
      <p class="muted" style="font-size:12px;margin-bottom:0">Chaque ami qui possède les mêmes codes obtient exactement les mêmes résultats : pas besoin de serveur.</p>
    </div>
    ${league && league.table.length >= 2 ? leagueHtml(league) : ''}`;
}

function leagueHtml(L) {
  return `<div class="card" style="padding:6px 8px"><div class="label" style="margin-top:4px">Classement · graine ${L.seed.toString(36)}</div><table class="tbl">
    <thead><tr><th class="l">#</th><th class="l">Équipe</th><th>J</th><th>V-N-D</th><th>Diff</th><th>Pts</th></tr></thead><tbody>
    ${L.table.map((r, i) => `<tr><td class="l">${i + 1}</td><td class="l"><span class="clubcell"><span class="crest sm" style="background:${r.color};color:${r.color2}">${esc(r.short)}</span>${esc(r.name)}</span></td>
      <td>${r.p}</td><td>${r.w}-${r.d}-${r.l}</td><td>${r.gf - r.ga > 0 ? '+' : ''}${r.gf - r.ga}</td><td><b>${r.pts}</b></td></tr>`).join('')}
    </tbody></table>
    <div class="label">Résultats</div>
    ${L.rounds.map((rd, k) => `<small class="muted">Journée ${k + 1}</small>${rd.map((g) => `<div class="row" style="font-size:13px;padding:2px 0"><span class="grow" style="text-align:right">${esc(L.teams[g.h].short)}</span><b class="num" style="min-width:44px;text-align:center">${g.s[0]}-${g.s[1]}</b><span class="grow">${esc(L.teams[g.a].short)}</span></div>`).join('')}`).join('')}
  </div>`;
}

async function readCode(app) {
  const v = document.getElementById('friendcode')?.value;
  try { return await decodeTeam(v); } catch (e) { app.toast(e.message, 3000); return null; }
}

export const actions = {
  async genCode(el, app) { app.ui.myCode = await encodeTeam(snapshotTeam(app.state)); app.render(); },
  async shareCode(el, app) {
    const r = await shareText(app.ui.myCode, `Mon équipe Coach de Poche : ${userClub(app.state).name}`);
    app.toast(r ? `Code ${r} !` : 'Sélectionnez le texte pour le copier.');
  },
  async challenge(el, app) {
    const t = await readCode(app);
    if (!t) return;
    const s = app.state;
    const uc = userClub(s);
    const cfg = { seed: (Date.now() >>> 0), varEnabled: s.settings.var, home: teamCfg(s, uc, null, true, true), away: friendCfg(t, 900000), profile: {} };
    openMatch(app, {
      cfg, label: `Amical · défi de ${t.name}`, userSide: 0,
      onFinish: async (sum) => {
        const txt = `Coach de Poche — amical : ${uc.name} ${sum.score[0]}-${sum.score[1]} ${t.name}${sum.motm ? ` · homme du match : ${sum.motm.name}` : ''}`;
        app.render();
        if (await app.confirm('Partager le résultat ?', esc(txt), 'Partager')) { const r = await shareText(txt, 'Résultat'); app.toast(r ? `Résultat ${r}` : 'Partage indisponible'); }
      },
    });
  },
  async addTeam(el, app) {
    const t = await readCode(app);
    if (!t) return;
    const f = app.state.friends;
    if (f.teams.some((x) => x.code === t.code)) { app.toast('Équipe déjà dans la ligue.'); return; }
    f.teams.push(t); league = null; app.save(); app.render(); app.toast(`${t.name} ajouté à la ligue.`);
  },
  async addMine(el, app) {
    const snap = snapshotTeam(app.state);
    const t = await decodeTeam(await encodeTeam(snap));
    t.mine = true;
    const f = app.state.friends;
    f.teams = f.teams.filter((x) => !x.mine);
    f.teams.push(t); league = null; app.save(); app.render();
  },
  rmTeam(el, app) { app.state.friends.teams.splice(+el.dataset.v, 1); league = null; app.save(); app.render(); },
  runLeague(el, app) { league = computeFriendsLeague(app.state.friends.teams); app.render(); },
  async shareLeague(el, app) {
    const code = await encodeLeague(app.state.friends.teams.map((t) => t.code));
    const r = await shareText(code, 'Ligue Coach de Poche');
    app.toast(r ? `Code de ligue ${r} !` : 'Partage indisponible');
  },
  async importLeague(el, app) {
    const v = document.getElementById('friendcode')?.value;
    try {
      const codes = await decodeLeague(v);
      const teams = await Promise.all(codes.map(decodeTeam));
      const f = app.state.friends;
      for (const t of teams) if (!f.teams.some((x) => x.code === t.code)) f.teams.push(t);
      league = null; app.save(); app.render(); app.toast(`${teams.length} équipe(s) importée(s).`);
    } catch (e) { app.toast(e.message || 'Code de ligue invalide.', 3000); }
  },
};
