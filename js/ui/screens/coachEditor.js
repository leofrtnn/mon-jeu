/**
 * Création / personnalisation du coach : identité, apparence, philosophie, compétences.
 * mode 'create' : 50 points à répartir librement. mode 'edit' : apparence libre,
 * compétences seulement augmentables avec les points gagnés (saisons, trophées).
 */
import { COACH_SKILLS, SKILL_KEYS, START_POINTS, SKILL_MIN, SKILL_MAX, PHILOSOPHIES, LOOK, COACH_NATIONS, randomLook, skillsTotal, ensureCoachProfile, coachName } from '../../game/coach.js';
import { FORMATION_NAMES } from '../../data/constants.js';
import { esc } from '../components.js';
import { avatarSvg } from '../avatar.js';

export function openCoachEditor(app, { mode = 'edit', onDone } = {}) {
  const coach = ensureCoachProfile(app.state.coach);
  const d = JSON.parse(JSON.stringify(coach)); // brouillon
  const base = { ...coach.skills };
  let tab = 'id';
  const remaining = () => (mode === 'create' ? START_POINTS - skillsTotal(d.skills) : coach.points - (skillsTotal(d.skills) - skillsTotal(base)));
  const sw = (act, list, cur) => `<div class="swatches">${list.map((c) => `<button class="sw ${c === cur ? 'on' : ''}" data-act="${act}" data-v="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>`;
  const chips = (act, obj, cur) => `<div class="chips" style="flex-wrap:wrap">${Object.entries(obj).map(([k, v]) => `<button class="chip ${k === cur ? 'on' : ''}" data-act="${act}" data-v="${k}">${esc(typeof v === 'string' ? v : v.label)}</button>`).join('')}</div>`;
  const html = () => `
    <div class="coach-head">
      <div id="cprev">${avatarSvg(d.look, 108)}</div>
      <div class="grow"><small class="muted">${mode === 'create' ? 'Créez votre coach' : 'Mon coach'}</small>
        <h2 style="font-size:28px">${esc(coachName(d)) || 'Sans nom'}</h2>
        <small>${esc(d.nationality)} · ${d.age} ans · ${esc(PHILOSOPHIES[d.philosophy].label)} · ${esc(d.formation)}</small></div>
    </div>
    <div class="chips" style="margin:10px 0">${[['id', 'Identité'], ['look', 'Apparence'], ['style', 'Style'], ['skills', `Compétences${remaining() > 0 ? ` (${remaining()})` : ''}`]].map(([k, l]) => `<button class="chip ${tab === k ? 'on' : ''}" data-act="tab" data-v="${k}">${l}</button>`).join('')}</div>
    ${tab === 'id' ? `<div class="card" style="margin-top:0">
        <div class="formrow"><span>Prénom</span><input type="text" id="c-fn" maxlength="20" value="${esc(d.firstName)}" data-act="fn"></div>
        <div class="formrow"><span>Nom</span><input type="text" id="c-ln" maxlength="24" value="${esc(d.lastName)}" data-act="ln"></div>
        <div class="formrow"><span>Nationalité</span><select data-act="nat">${COACH_NATIONS.map((n) => `<option ${n === d.nationality ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></div>
        <div class="formrow"><span>Âge : <b>${d.age}</b></span><input type="range" min="28" max="72" value="${d.age}" data-act="age"></div>
      </div>` : ''}
    ${tab === 'look' ? `<div class="card" style="margin-top:0">
        <div class="label" style="margin-top:0">Teint</div>${sw('skin', LOOK.skins, d.look.skin)}
        <div class="label">Coiffure</div>${chips('hairStyle', LOOK.hairStyles, d.look.hairStyle)}
        <div class="label">Couleur des cheveux</div>${sw('hairColor', LOOK.hairColors, d.look.hairColor)}
        <div class="label">Barbe</div>${chips('beard', LOOK.beards, d.look.beard)}
        <div class="label">Tenue</div>${chips('outfit', LOOK.outfits, d.look.outfit)}
        <div class="label">Couleur de la tenue</div>${sw('outfitColor', LOOK.outfitColors, d.look.outfitColor)}
        <div class="btns" style="margin-top:12px"><button class="btn sm" data-act="glasses">${d.look.glasses ? '👓 Retirer les lunettes' : '👓 Lunettes'}</button><button class="btn sm" data-act="random">🎲 Aléatoire</button></div>
      </div>` : ''}
    ${tab === 'style' ? `<div class="card" style="margin-top:0">
        <div class="label" style="margin-top:0">Philosophie de jeu</div>${chips('philo', PHILOSOPHIES, d.philosophy)}
        <small class="muted">Appliquée à votre tactique quand vous prenez un club.</small>
        <div class="label">Formation préférée</div>${chips('form', Object.fromEntries(FORMATION_NAMES.map((f) => [f, f])), d.formation)}
      </div>` : ''}
    ${tab === 'skills' ? `<div class="card" style="margin-top:0">
        <div class="row between"><small class="muted">${mode === 'create' ? 'Répartissez vos points (1 à 20 par compétence).' : 'Dépensez les points gagnés au fil des saisons et des trophées.'}</small>
          <b class="big" style="font-size:24px;color:${remaining() > 0 ? 'var(--accent)' : 'var(--muted)'}">${remaining()}</b></div>
        ${SKILL_KEYS.map((k) => `<div class="skillrow">
          <div class="grow"><b>${COACH_SKILLS[k].icon} ${COACH_SKILLS[k].label}</b><br><small class="muted">${COACH_SKILLS[k].desc}</small></div>
          <button class="btn sm" data-act="dec" data-v="${k}" ${d.skills[k] <= (mode === 'create' ? SKILL_MIN : base[k]) ? 'disabled' : ''}>−</button>
          <b class="skillv">${d.skills[k]}</b>
          <button class="btn sm" data-act="inc" data-v="${k}" ${d.skills[k] >= SKILL_MAX || remaining() <= 0 ? 'disabled' : ''}>+</button>
        </div>`).join('')}
      </div>` : ''}
    <div class="btns" style="margin-top:12px">${mode === 'edit' ? '<button class="btn" data-act="close">Annuler</button>' : ''}
      <button class="btn primary lg" data-act="ok">${mode === 'create' ? 'Commencer la carrière ▸' : 'Enregistrer'}</button></div>`;
  const refresh = () => h.update(html());
  const h = app.sheet({
    full: true, dismissable: mode !== 'create', html,
    actions: {
      tab: (el) => { tab = el.dataset.v; refresh(); },
      fn: (el) => { d.firstName = el.value.trim().slice(0, 20); refresh(); },
      ln: (el) => { d.lastName = el.value.trim().slice(0, 24); refresh(); },
      nat: (el) => { d.nationality = el.value; refresh(); },
      age: (el) => { d.age = +el.value; refresh(); },
      skin: (el) => { d.look.skin = el.dataset.v; refresh(); },
      hairStyle: (el) => { d.look.hairStyle = el.dataset.v; refresh(); },
      hairColor: (el) => { d.look.hairColor = el.dataset.v; refresh(); },
      beard: (el) => { d.look.beard = el.dataset.v; refresh(); },
      outfit: (el) => { d.look.outfit = el.dataset.v; refresh(); },
      outfitColor: (el) => { d.look.outfitColor = el.dataset.v; refresh(); },
      glasses: () => { d.look.glasses = !d.look.glasses; refresh(); },
      random: () => { d.look = randomLook(); refresh(); },
      philo: (el) => { d.philosophy = el.dataset.v; refresh(); },
      form: (el) => { d.formation = el.dataset.v; refresh(); },
      inc: (el) => { const k = el.dataset.v; if (remaining() > 0 && d.skills[k] < SKILL_MAX) d.skills[k]++; refresh(); },
      dec: (el) => { const k = el.dataset.v; if (d.skills[k] > (mode === 'create' ? SKILL_MIN : base[k])) d.skills[k]--; refresh(); },
      ok: () => {
        if (!d.firstName && !d.lastName) { app.toast('Donnez un nom à votre coach.'); tab = 'id'; refresh(); return; }
        if (mode === 'create' && remaining() > 0) { app.toast(`Il reste ${remaining()} point(s) à répartir.`); tab = 'skills'; refresh(); return; }
        const spent = skillsTotal(d.skills) - skillsTotal(base);
        Object.assign(coach, { firstName: d.firstName, lastName: d.lastName, nationality: d.nationality, age: d.age, look: d.look,
          philosophy: d.philosophy, formation: d.formation, skills: d.skills, created: true });
        if (mode === 'edit') coach.points = Math.max(0, coach.points - spent);
        app.save(true);
        h.close();
        onDone?.();
        app.render();
      },
    },
  });
  return h;
}
