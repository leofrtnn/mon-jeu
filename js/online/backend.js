/**
 * SERVEUR : comptes, sauvegardes en ligne, parties multijoueurs.
 *
 * Deux implémentations de la même interface :
 * - SupabaseBackend : le vrai serveur (config.js renseigné) ;
 * - LocalBackend    : repli sur l'appareil (ou en mémoire pour les tests). Les comptes
 *                     existent, mais une partie « en ligne » ne quitte pas l'appareil.
 *
 * Interface (toutes les méthodes sont asynchrones) :
 *   user() · signUp(email, password, username) · signIn(email, password) · signOut()
 *   putSave(slot, meta, data) · getSave(slot) · listSaves()
 *   createGame(name, maxPlayers) · joinGame(code) · myGames() · getGame(id) · players(id)
 *   chooseClub(id, clubId) · startGame(id, blob) · setReady(id, version, slice) · cancelReady(id)
 *   publishState(id, version, blob) · loadState(id) · subscribe(id, cb) → unsubscribe()
 *   leaveGame(id)
 */
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

export const ONLINE_CONFIGURED = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

const randCode = () => Array.from({ length: 6 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
const uuid = () => (globalThis.crypto?.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
const now = () => new Date().toISOString();

/* ====================== Repli local / en mémoire ====================== */

/** Stockage clé/valeur : localStorage ou Map (tests). */
function kv(storage) {
  if (storage instanceof Map) return { get: (k) => storage.get(k) ?? null, set: (k, v) => storage.set(k, v), del: (k) => storage.delete(k) };
  return { get: (k) => storage.getItem(k), set: (k, v) => storage.setItem(k, v), del: (k) => storage.removeItem(k) };
}

async function hash(s) {
  if (globalThis.crypto?.subtle) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
    return Array.from(new Uint8Array(b)).map((x) => x.toString(16).padStart(2, '0')).join('');
  }
  let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return String(h);
}

export class LocalBackend {
  /** db : stockage partagé ; session : stockage de la session (différent par « appareil » en test). */
  constructor(db = globalThis.localStorage, session = db, bus = null) {
    this.db = kv(db); this.ses = kv(session);
    this.bus = bus || LocalBackend.bus || (LocalBackend.bus = new Map()); // id de partie -> Set(callbacks)
    this.kind = 'local';
  }
  _get(k, d) { try { return JSON.parse(this.db.get(`cdp-db-${k}`)) ?? d; } catch { return d; } }
  _set(k, v) { this.db.set(`cdp-db-${k}`, JSON.stringify(v)); }
  _emit(id) { for (const cb of this.bus.get(id) || []) setTimeout(() => cb(), 0); }

  async user() { try { return JSON.parse(this.ses.get('cdp-session')); } catch { return null; } }
  async signUp(email, password, username) {
    email = String(email || '').trim().toLowerCase(); username = String(username || '').trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Adresse e-mail invalide.');
    if (String(password || '').length < 6) throw new Error('Mot de passe : 6 caractères minimum.');
    if (username.length < 3) throw new Error('Pseudo : 3 caractères minimum.');
    const users = this._get('users', {});
    if (users[email]) throw new Error('Un compte existe déjà avec cette adresse.');
    if (Object.values(users).some((u) => u.username.toLowerCase() === username.toLowerCase())) throw new Error('Ce pseudo est déjà pris.');
    const u = { id: uuid(), email, username, pass: await hash(password + email) };
    users[email] = u; this._set('users', users);
    const me = { id: u.id, email, username };
    this.ses.set('cdp-session', JSON.stringify(me));
    return me;
  }
  async signIn(email, password) {
    email = String(email || '').trim().toLowerCase();
    const u = this._get('users', {})[email];
    if (!u || u.pass !== await hash(password + email)) throw new Error('E-mail ou mot de passe incorrect.');
    const me = { id: u.id, email, username: u.username };
    this.ses.set('cdp-session', JSON.stringify(me));
    return me;
  }
  async signOut() { this.ses.del('cdp-session'); }

  async putSave(slot, meta, data) { const me = await this.user(); this._set(`save-${me.id}-${slot}`, { slot, meta, data, updated_at: now() }); }
  async getSave(slot) { const me = await this.user(); return this._get(`save-${me.id}-${slot}`, null); }
  async listSaves() { const me = await this.user(); return [1, 2, 3].map((n) => this._get(`save-${me.id}-${n}`, null)).filter(Boolean).map(({ slot, meta, updated_at }) => ({ slot, meta, updated_at })); }

  async createGame(name, maxPlayers) {
    const me = await this.user();
    const games = this._get('games', {});
    let code; do code = randCode(); while (Object.values(games).some((g) => g.code === code));
    const g = { id: uuid(), code, name: String(name || 'Partie').slice(0, 40), host: me.id, max_players: Math.max(2, Math.min(8, maxPlayers | 0)), status: 'lobby', version: 0, created_at: now() };
    games[g.id] = g; this._set('games', games);
    this._set(`players-${g.id}`, [{ game_id: g.id, user_id: me.id, username: me.username, club_id: null, ready: false, version: 0, slice: null }]);
    return g;
  }
  async joinGame(code) {
    const me = await this.user();
    const g = Object.values(this._get('games', {})).find((x) => x.code === String(code || '').trim().toUpperCase());
    if (!g) throw new Error('Aucune partie avec ce code.');
    const ps = this._get(`players-${g.id}`, []);
    if (ps.some((p) => p.user_id === me.id)) return g;
    if (g.status !== 'lobby') throw new Error('Cette partie a déjà commencé.');
    if (ps.length >= g.max_players) throw new Error('Cette partie est complète.');
    ps.push({ game_id: g.id, user_id: me.id, username: me.username, club_id: null, ready: false, version: 0, slice: null });
    this._set(`players-${g.id}`, ps); this._emit(g.id);
    return g;
  }
  async myGames() {
    const me = await this.user();
    return Object.values(this._get('games', {})).filter((g) => this._get(`players-${g.id}`, []).some((p) => p.user_id === me.id));
  }
  async getGame(id) { return this._get('games', {})[id] || null; }
  async players(id) { return this._get(`players-${id}`, []); }
  async chooseClub(id, clubId) {
    const me = await this.user();
    const ps = this._get(`players-${id}`, []);
    if (clubId != null && ps.some((p) => p.club_id === clubId && p.user_id !== me.id)) throw new Error('Club déjà choisi par un autre manager.');
    ps.find((p) => p.user_id === me.id).club_id = clubId;
    this._set(`players-${id}`, ps); this._emit(id);
  }
  async startGame(id, blob) {
    await this.publishState(id, 1, blob);
    const games = this._get('games', {}); games[id].status = 'running'; this._set('games', games); this._emit(id);
  }
  async setReady(id, version, slice) {
    const me = await this.user();
    const ps = this._get(`players-${id}`, []);
    Object.assign(ps.find((p) => p.user_id === me.id), { ready: true, version, slice });
    this._set(`players-${id}`, ps); this._emit(id);
  }
  async cancelReady(id) {
    const me = await this.user();
    const ps = this._get(`players-${id}`, []);
    Object.assign(ps.find((p) => p.user_id === me.id), { ready: false, slice: null });
    this._set(`players-${id}`, ps); this._emit(id);
  }
  async publishState(id, version, blob) {
    this._set(`state-${id}`, { version, data: blob });
    const games = this._get('games', {}); games[id].version = version; this._set('games', games);
    const ps = this._get(`players-${id}`, []).map((p) => ({ ...p, ready: false, slice: null }));
    this._set(`players-${id}`, ps); this._emit(id);
  }
  async loadState(id) { return this._get(`state-${id}`, null); }
  subscribe(id, cb) {
    if (!this.bus.has(id)) this.bus.set(id, new Set());
    this.bus.get(id).add(cb);
    return () => this.bus.get(id)?.delete(cb);
  }
  async leaveGame(id) {
    const me = await this.user();
    this._set(`players-${id}`, this._get(`players-${id}`, []).filter((p) => p.user_id !== me.id)); this._emit(id);
  }
}

/* ====================== Supabase ====================== */

function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (globalThis.supabase?.createClient) return resolve();
    const s = document.createElement('script');
    s.src = src; s.onload = () => resolve(); s.onerror = () => reject(new Error('Bibliothèque Supabase introuvable.'));
    document.head.appendChild(s);
  });
}

const frErr = (e) => {
  const m = String(e?.message || e || '');
  if (/Invalid login credentials/i.test(m)) return 'E-mail ou mot de passe incorrect.';
  if (/already registered|already exists/i.test(m)) return 'Un compte existe déjà avec cette adresse.';
  if (/Password should be/i.test(m)) return 'Mot de passe : 6 caractères minimum.';
  if (/Email not confirmed/i.test(m)) return 'Confirmez votre adresse e-mail (lien reçu par mail), puis reconnectez-vous.';
  if (/duplicate key.*username|Database error saving new user/i.test(m)) return 'Ce pseudo est déjà pris.';
  if (/Failed to fetch|NetworkError/i.test(m)) return 'Pas de connexion au serveur.';
  return m || 'Erreur du serveur.';
};
const check = ({ data, error }) => { if (error) throw new Error(frErr(error)); return data; };

export class SupabaseBackend {
  constructor(client) { this.sb = client; this.kind = 'supabase'; this._me = null; }

  static async create() {
    await loadScript(new URL('../vendor/supabase/supabase.js', import.meta.url).href);
    return new SupabaseBackend(globalThis.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, { auth: { persistSession: true, autoRefreshToken: true } }));
  }

  async user() {
    const { data } = await this.sb.auth.getSession();
    const u = data?.session?.user;
    if (!u) return (this._me = null);
    if (this._me?.id === u.id) return this._me;
    const prof = await this.sb.from('profiles').select('username').eq('id', u.id).maybeSingle();
    return (this._me = { id: u.id, email: u.email, username: prof.data?.username || u.user_metadata?.username || u.email.split('@')[0] });
  }
  async signUp(email, password, username) {
    username = String(username || '').trim();
    if (username.length < 3) throw new Error('Pseudo : 3 caractères minimum.');
    const taken = await this.sb.from('profiles').select('id').ilike('username', username).maybeSingle();
    if (taken.data) throw new Error('Ce pseudo est déjà pris.');
    const d = check(await this.sb.auth.signUp({ email: String(email).trim(), password, options: { data: { username } } }));
    if (!d.session) throw new Error('Compte créé : confirmez votre adresse e-mail (lien reçu par mail), puis connectez-vous.');
    this._me = null;
    return this.user();
  }
  async signIn(email, password) { check(await this.sb.auth.signInWithPassword({ email: String(email).trim(), password })); this._me = null; return this.user(); }
  async signOut() { await this.sb.auth.signOut(); this._me = null; }

  async putSave(slot, meta, data) {
    const me = await this.user();
    check(await this.sb.from('saves').upsert({ user_id: me.id, slot, meta, data, updated_at: now() }));
  }
  async getSave(slot) { const me = await this.user(); return check(await this.sb.from('saves').select('*').eq('user_id', me.id).eq('slot', slot).maybeSingle()); }
  async listSaves() { const me = await this.user(); return check(await this.sb.from('saves').select('slot, meta, updated_at').eq('user_id', me.id)); }

  async createGame(name, maxPlayers) {
    const me = await this.user();
    for (let k = 0; k < 5; k++) {
      const { data, error } = await this.sb.from('games').insert({ code: randCode(), name: String(name || 'Partie').slice(0, 40), host: me.id, max_players: Math.max(2, Math.min(8, maxPlayers | 0)) }).select().single();
      if (error && /duplicate/i.test(error.message)) continue;
      if (error) throw new Error(frErr(error));
      check(await this.sb.from('game_players').insert({ game_id: data.id, user_id: me.id, username: me.username }));
      return data;
    }
    throw new Error('Impossible de créer la partie, réessayez.');
  }
  async joinGame(code) {
    const me = await this.user();
    const g = check(await this.sb.from('games').select('*').eq('code', String(code || '').trim().toUpperCase()).maybeSingle());
    if (!g) throw new Error('Aucune partie avec ce code.');
    const ps = await this.players(g.id);
    if (ps.some((p) => p.user_id === me.id)) return g;
    if (g.status !== 'lobby') throw new Error('Cette partie a déjà commencé.');
    if (ps.length >= g.max_players) throw new Error('Cette partie est complète.');
    check(await this.sb.from('game_players').insert({ game_id: g.id, user_id: me.id, username: me.username }));
    return g;
  }
  async myGames() {
    const me = await this.user();
    const rows = check(await this.sb.from('game_players').select('game_id, games(*)').eq('user_id', me.id));
    return rows.map((r) => r.games).filter(Boolean);
  }
  async getGame(id) { return check(await this.sb.from('games').select('*').eq('id', id).maybeSingle()); }
  async players(id) { return check(await this.sb.from('game_players').select('*').eq('game_id', id).order('joined_at')); }
  async chooseClub(id, clubId) {
    const me = await this.user();
    const { error } = await this.sb.from('game_players').update({ club_id: clubId }).eq('game_id', id).eq('user_id', me.id);
    if (error) throw new Error(/duplicate|unique/i.test(error.message) ? 'Club déjà choisi par un autre manager.' : frErr(error));
  }
  async startGame(id, blob) {
    await this.publishState(id, 1, blob);
    check(await this.sb.from('games').update({ status: 'running' }).eq('id', id));
  }
  async setReady(id, version, slice) {
    const me = await this.user();
    check(await this.sb.from('game_players').update({ ready: true, version, slice }).eq('game_id', id).eq('user_id', me.id));
  }
  async cancelReady(id) {
    const me = await this.user();
    check(await this.sb.from('game_players').update({ ready: false, slice: null }).eq('game_id', id).eq('user_id', me.id));
  }
  async publishState(id, version, blob) {
    // L'état complet (plusieurs Mo) va dans le stockage de fichiers, pas dans une ligne de table.
    const file = new Blob([blob], { type: 'text/plain' });
    check(await this.sb.storage.from('games').upload(`${id}/state.txt`, file, { upsert: true, contentType: 'text/plain', cacheControl: '0' }));
    check(await this.sb.from('games').update({ version }).eq('id', id));
    check(await this.sb.from('game_players').update({ ready: false, slice: null }).eq('game_id', id));
  }
  async loadState(id) {
    const g = await this.getGame(id);
    const { data, error } = await this.sb.storage.from('games').download(`${id}/state.txt`);
    if (error) throw new Error(frErr(error));
    return { version: g.version, data: await data.text() };
  }
  subscribe(id, cb) {
    const ch = this.sb.channel(`game-${id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'game_players', filter: `game_id=eq.${id}` }, () => cb())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'games', filter: `id=eq.${id}` }, () => cb())
      .subscribe();
    const poll = setInterval(cb, 15000); // filet de sécurité si le temps réel décroche
    return () => { clearInterval(poll); this.sb.removeChannel(ch); };
  }
  async leaveGame(id) { const me = await this.user(); check(await this.sb.from('game_players').delete().eq('game_id', id).eq('user_id', me.id)); }
}

let instance = null;
/** Serveur actif (Supabase si configuré, sinon repli local). */
export async function getBackend() {
  if (instance) return instance;
  const forceLocal = typeof location !== 'undefined' && /[?&]backend=local\b/.test(location.search); // tests automatiques
  if (ONLINE_CONFIGURED && !forceLocal) {
    try { instance = await SupabaseBackend.create(); return instance; } catch (e) { console.warn('Supabase indisponible', e); }
  }
  instance = new LocalBackend();
  return instance;
}
export function setBackendForTests(b) { instance = b; }
