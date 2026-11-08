/**
 * Noyau de l'interface : onglets, rendu des écrans, feuilles modales, toasts.
 * Chaque écran exporte : render(app) -> HTML, actions {nom: fn(el, app, ev)},
 * et éventuellement mount(app, root) appelé après le rendu.
 */
import { save as saveState, userClub } from '../game/state.js';
import { money } from '../game/economy.js';
import { esc, accentInk } from './components.js';
import * as home from './screens/home.js';
import * as squad from './screens/squad.js';
import * as tactics from './screens/tactics.js';
import * as schedule from './screens/schedule.js';
import * as club from './screens/club.js';
import * as start from './screens/start.js';

const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  squad: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2c3 .3 5.5 2.6 5.5 5.8"/>',
  tactics: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 12h16"/><circle cx="12" cy="12" r="2.5"/><path d="M9 3v3h6V3M9 21v-3h6v3"/>',
  schedule: '<path d="M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 13v4M8 21h8M9 17h6"/>',
  club: '<path d="M3 21h18M5 21V10l7-5 7 5v11"/><path d="M9 21v-6h6v6"/>',
};
const TABS = [
  { id: 'home', label: 'Accueil', mod: home },
  { id: 'squad', label: 'Effectif', mod: squad },
  { id: 'tactics', label: 'Tactique', mod: tactics },
  { id: 'schedule', label: 'Calendrier', mod: schedule },
  { id: 'club', label: 'Club', mod: club },
];

export const app = {
  state: null,
  tab: 'home',
  ui: {}, // états d'interface (sous-onglets, filtres…)
  sheets: [],

  init() {
    this.$screen = document.getElementById('screen');
    this.$top = document.getElementById('topbar');
    this.$tabs = document.getElementById('tabbar');
    this.$overlay = document.getElementById('overlay-root');
    this.$tabs.innerHTML = `<div class="inner">${TABS.map((t) => `
      <button data-tab="${t.id}" aria-label="${t.label}">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${ICONS[t.id]}</svg>
        <span>${t.label}</span>
      </button>`).join('')}</div>`;
    this.$tabs.addEventListener('click', (e) => {
      const b = e.target.closest('[data-tab]');
      if (b) this.go(b.dataset.tab);
    });
    // Délégation des actions de l'écran courant.
    this.$screen.addEventListener('click', (e) => { if (e.target.tagName !== 'SELECT' && e.target.type !== 'file') this.dispatch(e, this.current()?.actions); });
    // Listes déroulantes et champs : événement "change".
    this.$screen.addEventListener('change', (e) => this.dispatch(e, this.current()?.actions));
    this.$top.addEventListener('click', (e) => this.dispatch(e, this.current()?.actions));
  },

  dispatch(e, actions) {
    const el = e.target.closest('[data-act]');
    if (!el || !actions) return;
    const fn = actions[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, this, e); }
  },

  current() {
    if (!this.state || !this.state.userClubId) return start;
    return TABS.find((t) => t.id === this.tab)?.mod;
  },

  go(tab) {
    if (this.tab === tab) { window.scrollTo({ top: 0, behavior: 'smooth' }); }
    this.tab = tab;
    this.render();
    window.scrollTo(0, 0);
  },

  /** Rendu complet de l'écran courant. */
  render() {
    const started = this.state && this.state.userClubId;
    this.$tabs.classList.toggle('hidden', !started);
    if (started) {
      const c = userClub(this.state);
      document.documentElement.style.setProperty('--accent', c.color);
      document.documentElement.style.setProperty('--accent-ink', accentInk(c.color));
      this.$top.innerHTML = `
        <span class="crest sm" style="background:${c.color};color:${c.color2}">${esc(c.short)}</span>
        <span class="club">${esc(c.name)}</span>
        <span class="budget">${money(c.budget)}</span>`;
      this.$top.classList.remove('hidden');
    } else {
      this.$top.classList.add('hidden');
    }
    for (const b of this.$tabs.querySelectorAll('button')) b.classList.toggle('on', b.dataset.tab === this.tab);
    const mod = this.current();
    // Démontage de l'écran précédent (écouteurs globaux, etc.).
    if (this._unmount) { this._unmount(); this._unmount = null; }
    this.$screen.innerHTML = mod.render(this);
    this.$screen.style.animation = 'none';
    void this.$screen.offsetHeight;
    this.$screen.style.animation = '';
    const un = mod.mount?.(this, this.$screen);
    if (typeof un === 'function') this._unmount = un;
  },

  save(immediate = false) { if (this.state) saveState(this.state, immediate); },

  toast(msg, ms = 2200) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => t.classList.remove('show'), ms);
  },

  /**
   * Ouvre une feuille modale.
   * opts : { html, actions, full, onClose, dismissable (défaut true), mount(el) }
   * Retourne un objet { el, close(), update(html) }.
   */
  sheet(opts) {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    wrap.innerHTML = `<div class="sheet-bg"></div><div class="sheet ${opts.full ? 'full' : ''}">${opts.full ? '' : '<div class="grab"></div>'}<div class="sheet-body"></div></div>`;
    const body = wrap.querySelector('.sheet-body');
    const handle = {
      el: wrap, body, actions: opts.actions || {},
      close: () => {
        if (!wrap.isConnected) return;
        wrap.remove();
        this.sheets = this.sheets.filter((s) => s !== handle);
        opts.onClose?.();
      },
      update: (html) => { body.innerHTML = html; opts.mount?.(body, handle); },
    };
    handle.update(typeof opts.html === 'function' ? opts.html() : opts.html);
    wrap.addEventListener('click', (e) => {
      if (e.target.classList.contains('sheet-bg') && opts.dismissable !== false) { handle.close(); return; }
      if (e.target.tagName === 'SELECT' || e.target.type === 'file' || e.target.type === 'range') return;
      const el = e.target.closest('[data-act]');
      if (!el) return;
      if (el.dataset.act === 'close') { handle.close(); return; }
      const fn = handle.actions[el.dataset.act];
      if (fn) { e.preventDefault(); fn(el, this, handle, e); }
    });
    wrap.addEventListener('change', (e) => {
      const el = e.target.closest('[data-act]');
      const fn = el && handle.actions[el.dataset.act];
      if (fn) fn(el, this, handle, e);
    });
    (opts.root || this.$overlay).appendChild(wrap);
    this.sheets.push(handle);
    return handle;
  },

  closeSheets() { for (const s of this.sheets.slice()) s.close(); },

  /** Confirmation simple : retourne une promesse booléenne. */
  confirm(title, text, okLabel = 'Confirmer', danger = false) {
    return new Promise((resolve) => {
      let done = false;
      const h = this.sheet({
        html: `<h2>${esc(title)}</h2><p class="muted">${text}</p>
          <div class="btns" style="margin-top:16px">
            <button class="btn" data-act="no">Annuler</button>
            <button class="btn ${danger ? 'danger' : 'primary'}" data-act="yes">${esc(okLabel)}</button>
          </div>`,
        actions: {
          yes: () => { done = true; h.close(); resolve(true); },
          no: () => { done = true; h.close(); resolve(false); },
        },
        onClose: () => { if (!done) resolve(false); },
      });
    });
  },
};
