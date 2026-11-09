/**
 * Connexion / création de compte (obligatoire pour jouer).
 */
import { esc } from '../components.js';
import { setAccount } from '../../game/state.js';

export function render(app) {
  const ui = app.ui.auth || (app.ui.auth = { mode: 'login' });
  const local = app.backend?.kind !== 'supabase';
  const signup = ui.mode === 'signup';
  return `<div class="start-layout"><div class="hero">
      <svg class="logo-ball" viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="#e6edf3"/><path d="M50 22l15 11-6 18H41l-6-18z" fill="#0d1117"/><path d="M50 4v18M65 33l26-6M59 51l14 22M41 51 27 73M35 33 9 27" stroke="#0d1117" stroke-width="4"/></svg>
      <h1>Coach<br><em>de Poche</em></h1>
      <p>Un compte est nécessaire pour jouer : vos carrières vous suivent, et vous pouvez affronter vos amis en ligne.</p>
    </div><div>
    <div class="card auth-card">
      <div class="seg"><button data-act="amode" data-v="login" class="${signup ? '' : 'on'}">Se connecter</button><button data-act="amode" data-v="signup" class="${signup ? 'on' : ''}">Créer un compte</button></div>
      <form id="authform" autocomplete="on" onsubmit="return false">
        ${signup ? '<label class="field"><span>Pseudo</span><input name="username" autocomplete="nickname" minlength="3" maxlength="20" required placeholder="Ex. : CoachLeo"></label>' : ''}
        <label class="field"><span>E-mail</span><input name="email" type="email" autocomplete="email" required placeholder="vous@exemple.fr"></label>
        <label class="field"><span>Mot de passe</span><input name="password" type="password" autocomplete="${signup ? 'new-password' : 'current-password'}" minlength="6" required placeholder="6 caractères minimum"></label>
        <p class="auth-err" id="autherr">${esc(ui.err || '')}</p>
        <button class="btn primary lg block" data-act="asubmit">${signup ? 'Créer mon compte' : 'Se connecter'}</button>
      </form>
      ${local ? '<p class="muted" style="font-size:12px;margin:10px 0 0">Serveur en ligne non configuré : le compte est enregistré sur cet appareil uniquement, et la carrière en ligne est indisponible.</p>' : ''}
    </div></div></div>`;
}

export const actions = {
  amode(el, app) { app.ui.auth = { mode: el.dataset.v }; app.render(); },
  async asubmit(el, app) {
    const f = document.getElementById('authform');
    const v = Object.fromEntries(new FormData(f).entries());
    const err = document.getElementById('autherr');
    el.disabled = true; err.textContent = '';
    try {
      const me = app.ui.auth.mode === 'signup'
        ? await app.backend.signUp(v.email, v.password, v.username)
        : await app.backend.signIn(v.email, v.password);
      app.user = me;
      setAccount(me.id);
      app.ui.auth = { mode: 'login' };
      app.state = null;
      app.ui.start = { step: 'menu', div: 1 };
      app.render();
      app.toast(`Bienvenue, ${me.username} !`);
    } catch (e) {
      err.textContent = e.message || String(e);
      el.disabled = false;
    }
  },
};
