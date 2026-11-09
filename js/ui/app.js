/**
 * Noyau de l'interface : onglets, rendu des écrans, feuilles modales, toasts.
 * Chaque écran exporte : render(app) -> HTML, actions {nom: fn(el, app, ev)},
 * et éventuellement mount(app, root) appelé après le rendu.
 */
import { save as saveState, userClub } from '../game/state.js';
import { money } from '../game/economy.js';
import { esc, clubAccent, refreshStarRef, crest } from './components.js';
import { DIVISIONS } from '../data/world.js';
import { scrollTop } from './viewport.js';
import { today } from '../game/season.js';
import { currentDate, longDate } from '../game/dates.js';
import { avatarSvg } from './avatar.js';
import { ensureCoachProfile } from '../game/coach.js';
import { ensureManagers, onUserArrives } from '../game/managers.js';
import { ensureStaff } from '../game/career.js';
import { ensureBoard } from '../game/board.js';
import { ensureLife } from '../game/life.js';
import { loadRealData, enrichRealSave } from '../data/realWorld.js';
import { prefetchLogos } from './images.js';
import { openCoachEditor } from './screens/coachEditor.js';
import * as home from './screens/home.js';
import * as squad from './screens/squad.js';
import * as tactics from './screens/tactics.js';
import * as schedule from './screens/schedule.js';
import * as club from './screens/club.js';
import * as start from './screens/start.js';
import * as auth from './screens/auth.js';

const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
  squad: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2c3 .3 5.5 2.6 5.5 5.8"/>',
  tactics: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M4 12h16"/><circle cx="12" cy="12" r="2.5"/><path d="M9 3v3h6V3M9 21v-3h6v3"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M7.5 14h2M11 14h2M14.5 14h2M7.5 17h2M11 17h2"/>',
  schedule: '<path d="M7 4h10v4a5 5 0 0 1-10 0z"/><path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3M12 13v4M8 21h8M9 17h6"/>',
  scout: '<circle cx="10.5" cy="10.5" r="6"/><path d="m15 15 5.5 5.5"/>',
  club: '<path d="M12 3 4.5 6v5.5c0 4.5 3.2 8.2 7.5 9.5 4.3-1.3 7.5-5 7.5-9.5V6z"/><path d="M9 12.5l2 2 4-4.5"/>',
  staff: '<circle cx="12" cy="7.5" r="3.5"/><path d="M5 21v-1.5A5.5 5.5 0 0 1 10.5 14h3a5.5 5.5 0 0 1 5.5 5.5V21"/><path d="m12 14 1.2 3.5L12 21l-1.2-3.5z"/>',
  money: '<circle cx="12" cy="12" r="8.5"/><path d="M14.8 9.2c-.5-1-1.6-1.5-2.8-1.5-1.6 0-2.8.8-2.8 2.1 0 3 5.6 1.6 5.6 4.5 0 1.3-1.2 2.1-2.8 2.1-1.3 0-2.4-.6-2.9-1.6M12 6v1.7M12 16.4V18"/>',
  mail: '<rect x="3" y="5.5" width="18" height="13" rx="2"/><path d="m3.5 7 8.5 6.5L20.5 7"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z"/>',
  cal: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
};
const TABS = [
  { id: 'home', label: 'Accueil', mod: home },
  { id: 'squad', label: 'Effectif', mod: squad },
  { id: 'tactics', label: 'Tactique', mod: tactics },
  { id: 'schedule', label: 'Compétitions', mod: schedule },
  { id: 'club', label: 'Club', mod: club },
];
/**
 * Menu latéral (façon jeu de gestion) : chaque entrée ouvre un onglet, éventuellement
 * directement sur l'un de ses sous-onglets. « main » : visible aussi dans la barre du bas (portrait).
 */
const NAV = [
  { key: 'home', tab: 'home', label: 'Accueil', icon: 'home', main: true },
  { key: 'squad', tab: 'squad', label: 'Effectif', icon: 'squad', main: true },
  { key: 'tactics', tab: 'tactics', label: 'Tactiques', icon: 'tactics', main: true },
  { key: 'fixtures', tab: 'schedule', sub: ['schedTab', 'fixtures'], label: 'Calendrier', icon: 'calendar' },
  { key: 'table', tab: 'schedule', sub: ['schedTab', 'table'], label: 'Compétitions', icon: 'schedule', main: true },
  { key: 'market', tab: 'club', sub: ['clubTab', 'market'], label: 'Recrutement', icon: 'scout' },
  { key: 'board', tab: 'club', sub: ['clubTab', 'board'], label: 'Club', icon: 'club', main: true },
  { key: 'staff', tab: 'club', sub: ['clubTab', 'staff'], label: 'Staff', icon: 'staff' },
  { key: 'fin', tab: 'club', sub: ['clubTab', 'fin'], label: 'Finances', icon: 'money' },
  { key: 'mail', label: 'Messages', icon: 'mail' },
  { key: 'settings', tab: 'club', sub: ['clubTab', 'settings'], label: 'Paramètres', icon: 'gear', bottom: true },
];
const svg = (k, w = 1.8) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round">${ICONS[k]}</svg>`;
const BRAND = '<svg class="brand-ball" viewBox="0 0 100 100"><path d="M50 4 88 18v34c0 22-16 38-38 44C28 90 12 74 12 52V18z" fill="none" stroke="currentColor" stroke-width="6"/><circle cx="50" cy="48" r="22" fill="currentColor"/><path d="M50 34l9 7-3.5 11h-11L41 41z" fill="#0b0e1c"/></svg>';

export const app = {
  state: null,
  tab: 'home',
  ui: {}, // états d'interface (sous-onglets, filtres…)
  sheets: [],

  init() {
    // Invitation à passer en paysage (on peut la refuser une fois pour toutes).
    // Le jeu se joue uniquement à l'horizontale (l'ancien choix « continuer en portrait » est oublié).
    try { localStorage.removeItem('cdp-portrait'); } catch { /* ignore */ }
    this.$screen = document.getElementById('screen');
    this.$top = document.getElementById('topbar');
    this.$tabs = document.getElementById('tabbar');
    this.$overlay = document.getElementById('overlay-root');
    const item = (n) => `<button data-nav="${n.key}" class="${n.main ? 'main' : 'more'}" aria-label="${n.label}">${svg(n.icon)}<span>${n.label}</span>${n.key === 'mail' ? '<em class="nav-badge" id="mailbadge"></em>' : ''}</button>`;
    this.$tabs.innerHTML = `<div class="brand">${BRAND}<b>Coach<br>de Poche</b></div>
      <div class="inner">${NAV.filter((n) => !n.bottom).map(item).join('')}</div>
      <div class="nav-foot">${NAV.filter((n) => n.bottom).map(item).join('')}</div>`;
    this.$tabs.addEventListener('click', (e) => {
      const b = e.target.closest('[data-nav]');
      if (!b) return;
      const n = NAV.find((x) => x.key === b.dataset.nav);
      if (n.key === 'mail') { if (this.state?.userClubId) home.actions.allmsgs(b, this); return; }
      if (n.sub) this.ui[n.sub[0]] = n.sub[1];
      this.go(n.tab);
    });
    // Clavier (mode PC) : Espace/Entrée = bouton principal, 1-9 = menu, Échap = fermer.
    document.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
      if (e.key === 'Escape' && this.sheets.length) { const s = this.sheets[this.sheets.length - 1]; if (s) s.close(); return; }
      if (!this.state?.userClubId || this.sheets.length || document.querySelector('.match-screen')) return;
      if (e.key === ' ' || e.key === 'Enter') { const a = home.primaryAction(this); if (a) { e.preventDefault(); a.run(); } return; }
      const n = /^[1-9]$/.test(e.key) ? this.$tabs.querySelectorAll('[data-nav]')[+e.key - 1] : null;
      if (n) { e.preventDefault(); n.click(); }
    });
    // Délégation des actions de l'écran courant.
    // Un toucher dans un champ (liste, texte, fichier) ne déclenche pas d'action : il doit
    // juste donner le focus (sinon le clavier du téléphone se ferme aussitôt).
    const isField = (t) => t.tagName === 'SELECT' || t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['button', 'submit', 'checkbox', 'radio'].includes(t.type));
    this.isField = isField;
    this.$screen.addEventListener('click', (e) => { if (!isField(e.target)) this.dispatch(e, this.current()?.actions); });
    // Listes déroulantes et champs : événement "change".
    this.$screen.addEventListener('change', (e) => this.dispatch(e, this.current()?.actions));
    this.$top.addEventListener('click', (e) => {
      if (e.target.closest('#topcoach')) { openCoachEditor(this, { mode: 'edit' }); return; }
      if (e.target.closest('[data-act="topgo"]')) { home.primaryAction(this)?.run(); return; }
      if (e.target.closest('[data-act="topclub"]')) { this.ui.schedTab = 'table'; this.go('schedule'); return; }
      this.dispatch(e, this.current()?.actions);
    });
  },

  dispatch(e, actions) {
    const el = e.target.closest('[data-act]');
    if (!el || !actions) return;
    const fn = actions[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, this, e); }
  },

  /** Entrée du menu correspondant à l'écran affiché. */
  navKey() {
    if (this.tab === 'schedule') return (this.ui.schedTab || 'table') === 'fixtures' ? 'fixtures' : 'table';
    if (this.tab === 'club') {
      const k = this.ui.clubTab || 'fin';
      return ['market', 'staff', 'fin', 'settings'].includes(k) ? k : 'board';
    }
    return this.tab;
  },

  current() {
    if (!this.user) return auth;
    if (!this.state || !this.state.userClubId) return start;
    return TABS.find((t) => t.id === this.tab)?.mod;
  },

  go(tab) {
    if (this.tab === tab) scrollTop(true);
    this.tab = tab;
    this.render();
    scrollTop();
  },

  /** Rendu complet de l'écran courant. */
  render() {
    const started = this.user && this.state && this.state.userClubId;
    this.$tabs.classList.toggle('hidden', !started);
    document.body.classList.toggle('no-nav', !started);
    if (started) {
      if (this.state.coach) ensureCoachProfile(this.state.coach);
      if (!this.state.managers) { ensureManagers(this.state); onUserArrives(this.state, userClub(this.state)); }
      ensureStaff(this.state);
      ensureBoard(this.state);
      ensureLife(this.state);
      refreshStarRef(this.state);
      // Parties « monde réel » créées avant l'ajout des logos/photos : on les complète une fois.
      if (this.state.world === 'real' && this.state.mediaV !== 2 && !this._enriching) {
        this._enriching = true;
        const st = this.state;
        loadRealData().then((d) => { if (enrichRealSave(st, d) && st === this.state) { this.save(); this.render(); } }).catch(() => {}).finally(() => { this._enriching = false; });
      }
      // Logos gardés sur l'appareil : téléchargés une fois, puis toujours affichés (même hors ligne).
      if (this.state.world === 'real' && !this._logosQueued) {
        let done = false;
        try { done = localStorage.getItem('cdp-logos-v2') === '1'; } catch { /* ignore */ }
        if (!done) {
          this._logosQueued = true;
          prefetchLogos(this.state.clubs).then((n) => { if (n > 40) try { localStorage.setItem('cdp-logos-v2', '1'); } catch { /* ignore */ } });
        }
      }
      const c = userClub(this.state);
      document.documentElement.style.setProperty('--club', clubAccent(c));
      const t = today(this.state);
      const dt = currentDate(this.state);
      const cont = home.primaryAction(this);
      this.$top.innerHTML = `
        <button class="top-club" data-act="topclub" aria-label="Classement">${crest(c)}
          <span class="club"><b>${esc(c.name)}</b><small>${esc(DIVISIONS[c.div]?.name || '')} <i class="chev">▾</i></small></span></button>
        <span class="grow"></span>
        ${this.state.online ? `<span class="tag online-tag">🌐 ${esc(this.online?.game?.code || 'En ligne')}</span>` : ''}
        <span class="top-date">${svg('cal')}<span><b>${esc(longDate(dt))}</b><small>${esc(this.state.preseason?.active ? 'Préparation' : t ? t.label : 'Fin de saison')}</small></span></span>
        <span class="budget">${money(c.budget)}</span>
        <button class="topcoach" id="topcoach" aria-label="Mon coach">${avatarSvg(this.state.coach?.look, 40)}</button>
        ${cont ? `<button class="btn primary top-go" data-act="topgo"><svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l12.5-7.5z"/></svg><span>${esc(cont.label)}</span><i>→</i></button>` : ''}`;
      this.$top.classList.remove('hidden');
      const unread = (this.state.messages || []).filter((m) => !m.read).length;
      const mb = document.getElementById('mailbadge');
      if (mb) { mb.textContent = unread > 99 ? '99+' : String(unread); mb.classList.toggle('hidden', !unread); }
    } else {
      this.$top.classList.add('hidden');
    }
    const active = this.navKey();
    for (const b of this.$tabs.querySelectorAll('[data-nav]')) b.classList.toggle('on', b.dataset.nav === active);
    const mod = this.current();
    // Démontage de l'écran précédent (écouteurs globaux, etc.).
    if (this._unmount) { this._unmount(); this._unmount = null; }
    // Animation d'entrée seulement quand on change d'écran : un simple clic (filtre, onglet,
    // tri…) met à jour la page sur place, sans clignoter ni remonter.
    const key = `${started ? 1 : 0}|${this.tab}|${active}`;
    const changed = key !== this._screenKey;
    this._screenKey = key;
    this.$screen.innerHTML = mod.render(this);
    if (changed) {
      this.$screen.classList.remove('enter');
      void this.$screen.offsetWidth;
      this.$screen.classList.add('enter');
    }
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
      if (this.isField(e.target)) return;
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
