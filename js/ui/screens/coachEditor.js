/**
 * Création / personnalisation du coach, en 4 étapes : identité, apparence, style, compétences.
 * mode 'create' : 50 points à répartir (ou un profil tout prêt). mode 'edit' : apparence libre,
 * compétences seulement augmentables avec les points gagnés (saisons, trophées).
 *
 * Les champs de texte ne redessinent PAS la fenêtre pendant la saisie (sinon le clavier du
 * téléphone se ferme et le bouton « Commencer » disparaît sous le doigt) : l'aperçu est mis à
 * jour directement.
 */
import { COACH_SKILLS, SKILL_KEYS, START_POINTS, SKILL_MIN, SKILL_MAX, PHILOSOPHIES, LOOK, COACH_NATIONS, BACKGROUNDS, LICENCES, PERSONALITIES, randomLook, skillsTotal, ensureCoachProfile, coachName } from '../../game/coach.js';
import { FORMATION_NAMES, FORMATION_GROUPS } from '../../data/constants.js';
import { esc } from '../components.js';
import { avatarSvg } from '../avatar.js';
import { randomName } from '../../data/names.js';
import { createRng } from '../../core/rng.js';

const STEPS = [['id', 'Identité'], ['career', 'Parcours'], ['look', 'Apparence'], ['style', 'Style de jeu'], ['skills', 'Compétences']];
/** Profils de compétences tout prêts (50 points). */
const PRESETS = {
  balanced: { label: '⚖ Équilibré', skills: { tactics: 10, motivation: 10, discipline: 10, youth: 10, fitness: 10 } },
  tactician: { label: '🧠 Tacticien', skills: { tactics: 18, motivation: 10, discipline: 8, youth: 6, fitness: 8 } },
  motivator: { label: '🔥 Meneur d\'hommes', skills: { tactics: 8, motivation: 18, discipline: 8, youth: 6, fitness: 10 } },
  youth: { label: '🌱 Formateur', skills: { tactics: 8, motivation: 10, discipline: 6, youth: 18, fitness: 8 } },
  physical: { label: '💪 Préparateur', skills: { tactics: 9, motivation: 9, discipline: 8, youth: 6, fitness: 18 } },
};
const NAT_ORIGIN = { France: 'FRA', Belgique: 'BEL', Suisse: 'SUI', Espagne: 'ESP', Portugal: 'POR', Italie: 'ITA', Allemagne: 'GER', Angleterre: 'ENG', Écosse: 'SCO', Brésil: 'BRA', Argentine: 'ESP', Croatie: 'CRO', Serbie: 'SRB', Japon: 'JPN', 'Pays-Bas': 'NED', Danemark: 'DEN', Suède: 'SWE' };

export function openCoachEditor(app, { mode = 'edit', onDone } = {}) {
  const coach = ensureCoachProfile(app.state.coach);
  const d = JSON.parse(JSON.stringify(coach)); // brouillon
  const base = { ...coach.skills };
  let step = 0;
  const startPts = () => START_POINTS + (BACKGROUNDS[d.background]?.points || 0) + (LICENCES[d.licence]?.points || 0);
  const remaining = () => (mode === 'create' ? startPts() - skillsTotal(d.skills) : coach.points - (skillsTotal(d.skills) - skillsTotal(base)));
  const fixPts = () => {
    while (mode === 'create' && remaining() < 0) {
      const k = SKILL_KEYS.filter((x) => d.skills[x] > SKILL_MIN).sort((a, b) => d.skills[b] - d.skills[a])[0];
      if (!k) break;
      d.skills[k]--;
    }
  };
  const sw = (act, list, cur) => `<div class="swatches">${list.map((c) => `<button class="sw ${c === cur ? 'on' : ''}" data-act="${act}" data-v="${c}" style="background:${c}" aria-label="${c}"></button>`).join('')}</div>`;
  const chips = (act, obj, cur) => `<div class="chips wrap">${Object.entries(obj).map(([k, v]) => `<button class="chip ${k === cur ? 'on' : ''}" data-act="${act}" data-v="${k}">${esc(typeof v === 'string' ? v : v.label)}</button>`).join('')}</div>`;
  const nameText = () => esc(coachName(d)) || '<span class="muted">Votre nom</span>';
  const sub = () => `${esc(d.nationality)} · ${d.age} ans · ${esc(PHILOSOPHIES[d.philosophy].label)} · ${esc(d.formation)}`;

  const stepBody = () => {
    const k = STEPS[step][0];
    if (k === 'id') return `
      <label class="field big"><span>Prénom</span><input type="text" id="c-fn" maxlength="20" value="${esc(d.firstName)}" placeholder="Ex. : Léo" autocomplete="off" autocapitalize="words" enterkeyhint="next"></label>
      <label class="field big"><span>Nom</span><input type="text" id="c-ln" maxlength="24" value="${esc(d.lastName)}" placeholder="Ex. : Martin" autocomplete="off" autocapitalize="words" enterkeyhint="done"></label>
      <button class="btn sm" data-act="rname">🎲 Nom au hasard</button>
      <div class="ce-grid">
        <label class="field"><span>Nationalité</span><select data-act="nat">${COACH_NATIONS.map((n) => `<option ${n === d.nationality ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
        <label class="field"><span>Âge : <b id="c-age">${d.age} ans</b></span><input type="range" min="28" max="72" value="${d.age}" id="c-agein"></label>
      </div>`;
    if (k === 'career') return `
      ${mode === 'create' ? '' : '<p class="muted" style="margin-top:0">Votre parcours est écrit : il ne se modifie plus en cours de carrière.</p>'}
      <div class="label" style="margin-top:0">Parcours</div>
      <div class="opt-cards">${Object.entries(BACKGROUNDS).map(([kk, b]) => `<button class="opt-card ${d.background === kk ? 'on' : ''}" data-act="bg" data-v="${kk}" ${mode === 'create' ? '' : 'disabled'}>
        <b>${esc(b.label)}</b><small>${esc(b.desc)}</small><span>Réputation ${b.rep >= 0 ? '+' : ''}${b.rep} · vestiaire ${b.dressing >= 0 ? '+' : ''}${b.dressing} · ${b.points >= 0 ? '+' : ''}${b.points} pts</span></button>`).join('')}</div>
      <div class="label">Diplôme</div>${chips('lic', Object.fromEntries(Object.entries(LICENCES).map(([kk, l]) => [kk, `${l.label} (${l.rep >= 0 ? '+' : ''}${l.rep} rép., +${l.points} pts)`])), d.licence)}
      <div class="label">Caractère</div>
      <div class="opt-cards">${Object.entries(PERSONALITIES).map(([kk, pp]) => `<button class="opt-card ${d.personality === kk ? 'on' : ''}" data-act="pers" data-v="${kk}"><b>${esc(pp.label)}</b><small>${esc(pp.desc)}</small></button>`).join('')}</div>`;
    if (k === 'look') return `
      <div class="ce-grid">
        <div><div class="label" style="margin-top:0">Teint</div>${sw('skin', LOOK.skins, d.look.skin)}</div>
        <div><div class="label" style="margin-top:0">Fond</div>${sw('bgc', LOOK.bgs, d.look.bg || LOOK.bgs[0])}</div>
      </div>
      <div class="label">Visage</div>${chips('faceS', LOOK.faces, d.look.face || 'oval')}
      <div class="ce-grid"><div><div class="label">Yeux</div>${sw('eyes', LOOK.eyes, d.look.eyes || LOOK.eyes[0])}</div><div><div class="label">Expression</div>${chips('mouth', LOOK.mouths, d.look.mouth || 'neutral')}</div></div>
      <div class="label">Sourcils</div>${chips('brows', LOOK.brows, d.look.brows || 'normal')}
      <div class="label">Coiffure</div>${chips('hairStyle', LOOK.hairStyles, d.look.hairStyle)}
      <div class="label">Couleur des cheveux et de la barbe</div>${sw('hairColor', LOOK.hairColors, d.look.hairColor)}
      <div class="label">Barbe</div>${chips('beard', LOOK.beards, d.look.beard)}
      <div class="label">Lunettes</div>${chips('glassesS', LOOK.glasses, d.look.glasses === true ? 'square' : d.look.glasses || 'none')}
      <div class="label">Accessoire</div>${chips('accS', LOOK.accessories, d.look.acc || 'none')}
      <div class="label">Tenue</div>${chips('outfit', LOOK.outfits, d.look.outfit)}
      <div class="label">Couleur de la tenue</div>${sw('outfitColor', LOOK.outfitColors, d.look.outfitColor)}
      <div class="btns" style="margin-top:12px"><button class="btn sm" data-act="random">🎲 Apparence au hasard</button></div>`;
    if (k === 'style') return `
      <div class="label" style="margin-top:0">Philosophie de jeu</div>${chips('philo', PHILOSOPHIES, d.philosophy)}
      <p class="muted" style="font-size:12px;margin:6px 2px">Appliquée à la tactique de votre club (modifiable ensuite).</p>
      <div class="label">Formation préférée</div>${FORMATION_GROUPS.map(([g, fs]) => `<small class="muted">${g}</small>${chips('form', Object.fromEntries(fs.map((f) => [f, f])), d.formation)}`).join('')}`;
    return `
      ${mode === 'create' ? `<div class="label" style="margin-top:0">Profil tout prêt</div><div class="chips wrap">${Object.entries(PRESETS).map(([pk, p]) => `<button class="chip" data-act="preset" data-v="${pk}">${p.label}</button>`).join('')}</div>` : ''}
      <div class="row between" style="margin:12px 2px 4px"><small class="muted">${mode === 'create' ? 'Ou répartissez vous-même (4 à 20 par compétence).' : 'Points gagnés au fil des saisons et des trophées.'}</small>
        <span class="pts ${remaining() ? 'left' : ''}">${remaining()} point${remaining() > 1 ? 's' : ''}</span></div>
      ${SKILL_KEYS.map((k) => `<div class="skillrow">
        <span class="sk-ic">${COACH_SKILLS[k].icon}</span>
        <div class="grow"><b>${COACH_SKILLS[k].label}</b><br><small class="muted">${COACH_SKILLS[k].desc}</small>
          <div class="sk-bar"><i style="width:${d.skills[k] / SKILL_MAX * 100}%"></i></div></div>
        <button class="btn sm round" data-act="dec" data-v="${k}" ${d.skills[k] <= (mode === 'create' ? SKILL_MIN : base[k]) ? 'disabled' : ''} aria-label="moins">−</button>
        <b class="skillv">${d.skills[k]}</b>
        <button class="btn sm round" data-act="inc" data-v="${k}" ${d.skills[k] >= SKILL_MAX || remaining() <= 0 ? 'disabled' : ''} aria-label="plus">+</button>
      </div>`).join('')}`;
  };

  const html = () => `<div class="coach-ed">
    <aside class="ce-side">
      <div id="cprev" class="ce-avatar">${avatarSvg(d.look, 132)}</div>
      <small class="muted">${mode === 'create' ? 'Votre coach' : 'Mon coach'}</small>
      <h2 id="cname">${nameText()}</h2>
      <small id="csub">${sub()}</small>
    </aside>
    <section class="ce-main">
      <div class="stepper">${STEPS.map(([, l], i) => `<button class="${i === step ? 'on' : i < step ? 'done' : ''}" data-act="step" data-v="${i}"><b>${i < step && mode === 'create' ? '✓' : i + 1}</b><span>${l}</span></button>`).join('')}</div>
      <div class="ce-body">${stepBody()}</div>
      <div class="ce-foot">
        ${step > 0 ? '<button class="btn" data-act="prev">◂ Précédent</button>' : mode === 'edit' ? '<button class="btn" data-act="close">Annuler</button>' : '<span></span>'}
        ${step < STEPS.length - 1 ? '<button class="btn primary" data-act="next">Suivant ▸</button>'
          : `<button class="btn primary" data-act="ok">${mode === 'create' ? 'Commencer la carrière ▸' : 'Enregistrer'}</button>`}
      </div>
    </section></div>`;

  // Mise à jour de l'aperçu sans redessiner (le clavier reste ouvert).
  const preview = () => {
    const el = h.body;
    const n = el.querySelector('#cname'); if (n) n.innerHTML = nameText();
    const s = el.querySelector('#csub'); if (s) s.innerHTML = sub();
    const a = el.querySelector('#c-age'); if (a) a.textContent = `${d.age} ans`;
  };
  const readInputs = () => {
    const el = h.body;
    const fn = el.querySelector('#c-fn'), ln = el.querySelector('#c-ln');
    if (fn) d.firstName = fn.value.trim().slice(0, 20);
    if (ln) d.lastName = ln.value.trim().slice(0, 24);
  };
  const refresh = () => { readInputs(); h.update(html()); };
  const go = (i) => { readInputs(); step = Math.max(0, Math.min(STEPS.length - 1, i)); h.update(html()); h.body.scrollTop = 0; };

  const h = app.sheet({
    full: true, dismissable: mode !== 'create', html,
    mount: (body) => {
      const fn = body.querySelector('#c-fn'), ln = body.querySelector('#c-ln'), age = body.querySelector('#c-agein');
      fn?.addEventListener('input', () => { d.firstName = fn.value.trim().slice(0, 20); preview(); });
      ln?.addEventListener('input', () => { d.lastName = ln.value.trim().slice(0, 24); preview(); });
      fn?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ln?.focus(); } });
      ln?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ln.blur(); } });
      age?.addEventListener('input', () => { d.age = +age.value; preview(); });
    },
    actions: {
      step: (el) => go(+el.dataset.v),
      next: () => {
        readInputs();
        if (step === 0 && !d.firstName && !d.lastName) { app.toast('Donnez un nom à votre coach.'); h.body.querySelector('#c-fn')?.focus(); return; }
        go(step + 1);
      },
      prev: () => go(step - 1),
      rname: () => {
        const r = randomName(createRng((Date.now() ^ (Math.random() * 1e9)) >>> 0), NAT_ORIGIN[d.nationality] || 'FRA');
        d.firstName = r.first; d.lastName = r.last; refresh();
      },
      nat: (el) => { d.nationality = el.value; readInputs(); preview(); },
      skin: (el) => { d.look.skin = el.dataset.v; refresh(); },
      hairStyle: (el) => { d.look.hairStyle = el.dataset.v; refresh(); },
      hairColor: (el) => { d.look.hairColor = el.dataset.v; refresh(); },
      beard: (el) => { d.look.beard = el.dataset.v; refresh(); },
      outfit: (el) => { d.look.outfit = el.dataset.v; refresh(); },
      outfitColor: (el) => { d.look.outfitColor = el.dataset.v; refresh(); },
      glassesS: (el) => { d.look.glasses = el.dataset.v; refresh(); },
      accS: (el) => { d.look.acc = el.dataset.v; refresh(); },
      faceS: (el) => { d.look.face = el.dataset.v; refresh(); },
      eyes: (el) => { d.look.eyes = el.dataset.v; refresh(); },
      brows: (el) => { d.look.brows = el.dataset.v; refresh(); },
      mouth: (el) => { d.look.mouth = el.dataset.v; refresh(); },
      bgc: (el) => { d.look.bg = el.dataset.v; refresh(); },
      bg: (el) => { if (mode !== 'create') return; d.background = el.dataset.v; fixPts(); refresh(); },
      lic: (el) => { if (mode !== 'create') return; d.licence = el.dataset.v; fixPts(); refresh(); },
      pers: (el) => { d.personality = el.dataset.v; refresh(); },
      random: () => { d.look = randomLook(); refresh(); },
      philo: (el) => { d.philosophy = el.dataset.v; refresh(); },
      form: (el) => { d.formation = el.dataset.v; refresh(); },
      preset: (el) => { d.skills = { ...PRESETS[el.dataset.v].skills }; refresh(); },
      inc: (el) => { const k = el.dataset.v; if (remaining() > 0 && d.skills[k] < SKILL_MAX) d.skills[k]++; refresh(); },
      dec: (el) => { const k = el.dataset.v; if (d.skills[k] > (mode === 'create' ? SKILL_MIN : base[k])) d.skills[k]--; refresh(); },
      ok: () => {
        readInputs();
        if (!d.firstName && !d.lastName) { app.toast('Donnez un nom à votre coach.'); go(0); return; }
        if (mode === 'create' && remaining() > 0) {
          // Points restants : répartis automatiquement sur les compétences les plus basses.
          while (remaining() > 0) {
            const k = SKILL_KEYS.filter((x) => d.skills[x] < SKILL_MAX).sort((a, b) => d.skills[a] - d.skills[b])[0];
            if (!k) break;
            d.skills[k]++;
          }
        }
        const spent = skillsTotal(d.skills) - skillsTotal(base);
        if (mode === 'create') {
          // Parcours et diplôme : réputation de départ et respect du vestiaire.
          coach.rep = Math.max(5, Math.min(90, (coach.rep ?? 40) + (BACKGROUNDS[d.background]?.rep || 0) + (LICENCES[d.licence]?.rep || 0)));
          coach.dressing = Math.max(20, Math.min(95, (coach.dressing ?? 60) + (BACKGROUNDS[d.background]?.dressing || 0)));
        }
        Object.assign(coach, { firstName: d.firstName, lastName: d.lastName, nationality: d.nationality, age: d.age, look: d.look,
          philosophy: d.philosophy, formation: d.formation, skills: d.skills, created: true, background: d.background, licence: d.licence, personality: d.personality });
        if (mode === 'edit') coach.points = Math.max(0, coach.points - spent);
        app.save(true);
        h.close();
        onDone?.();
        app.render();
        app.toast(`Bienvenue, coach ${coachName(coach)} !`);
      },
    },
  });
  return h;
}
