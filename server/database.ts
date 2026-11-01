/**
 * Popoca Streaming - Banco de Dados Nativo SQLite (Backend)
 * Gerenciamento seguro e de alto desempenho de Contas de Usuário, Perfis com Foto e Banner,
 * Histórico de Reprodução, Avaliações Letterboxd, Watchlist, Listas e Códigos de Pareamento.
 */

import { DatabaseSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const DB_PATH = path.resolve(process.cwd(), 'popoca.db');
const LEGACY_JSON_PATH = path.resolve(process.cwd(), 'popoca-sync-data.json');

export interface DbUser {
  id: string;
  email: string;
  password_hash: string;
  username: string;
  handle: string;
  avatar_url: string;
  banner_url: string;
  bio: string;
  created_at: number;
  updated_at: number;
}

export interface DbUserData {
  user_id: string;
  watch_history: any[];
  ratings: Record<string | number, any>;
  watched: any[];
  watchlist: any[];
  liked: any[];
  custom_lists: any[];
  updated_at: number;
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  try {
    const parts = stored.split(':');
    if (parts.length !== 2) return false;
    const [salt, originalHash] = parts;
    const derived = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(originalHash, 'hex'), Buffer.from(derived, 'hex'));
  } catch {
    return false;
  }
}

class PopocaDatabase {
  private db: DatabaseSync;

  constructor() {
    this.db = new DatabaseSync(DB_PATH);
    this.initSchema();
    this.migrateLegacyJson();
  }

  private initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        username TEXT NOT NULL,
        handle TEXT,
        avatar_url TEXT,
        banner_url TEXT,
        bio TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS user_data (
        user_id TEXT PRIMARY KEY,
        watch_history TEXT NOT NULL DEFAULT '[]',
        ratings TEXT NOT NULL DEFAULT '{}',
        watched TEXT NOT NULL DEFAULT '[]',
        watchlist TEXT NOT NULL DEFAULT '[]',
        liked TEXT NOT NULL DEFAULT '[]',
        custom_lists TEXT NOT NULL DEFAULT '[]',
        updated_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS pair_codes (
        code TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
      CREATE INDEX IF NOT EXISTS idx_pair_codes_expires ON pair_codes(expires_at);
    `);
  }

  private migrateLegacyJson() {
    try {
      if (!fs.existsSync(LEGACY_JSON_PATH)) return;
      const countStmt = this.db.prepare('SELECT COUNT(*) as cnt FROM users');
      const row = countStmt.get() as { cnt: number };
      if (row && row.cnt > 0) return; // Já migrado

      const raw = fs.readFileSync(LEGACY_JSON_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;

      console.log(`[Database] Migrando ${parsed.length} contas legadas do JSON para SQLite...`);
      for (const item of parsed) {
        if (!item || !item.userId) continue;
        const userId = (item.userId || '').trim().toLowerCase();
        const email = (item.email || `${userId}@popoca.app`).trim().toLowerCase();
        const profile = item.profile || {};

        this.createUserInternal({
          id: userId,
          email,
          password: 'popoca_default_pwd',
          username: profile.username || 'Cinéfilo Popoca',
          handle: profile.handle || '@cinefilo',
          avatarUrl:
            profile.avatarUrl ||
            'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
          bannerUrl:
            profile.bannerUrl ||
            'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1600&auto=format&fit=crop&q=80',
          bio: profile.bio || 'Amante de cinema, animes e streaming veloz no Popoca.'
        });

        this.saveDataInternal(userId, {
          watch_history: item.watchHistory || [],
          ratings: item.ratings || {},
          watched: item.watched || [],
          watchlist: item.watchlist || [],
          liked: item.liked || [],
          custom_lists: item.customLists || []
        });
      }
      console.log('[Database] Migração para SQLite concluída com sucesso.');
    } catch (err) {
      console.warn('[Database] Aviso ao migrar JSON legado:', err);
    }
  }

  public registerUser(params: {
    email: string;
    password?: string;
    username?: string;
    handle?: string;
    avatarUrl?: string;
    bannerUrl?: string;
    bio?: string;
  }): { success: boolean; user?: DbUser; error?: string } {
    const email = (params.email || '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return { success: false, error: 'E-mail inválido.' };
    }

    const existing = this.getUserByEmail(email);
    if (existing) {
      return { success: false, error: 'Uma conta com este e-mail já existe.' };
    }

    const id = email.replace(/[^a-z0-9]/g, '_');
    const user = this.createUserInternal({
      id,
      email,
      password: params.password || 'popoca_123456',
      username: params.username || email.split('@')[0],
      handle: params.handle || `@${email.split('@')[0]}`,
      avatarUrl:
        params.avatarUrl ||
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
      bannerUrl:
        params.bannerUrl ||
        'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1600&auto=format&fit=crop&q=80',
      bio: params.bio || 'Cinéfilo e maratonista no Popoca Streaming.'
    });

    return { success: true, user };
  }

  public loginUser(email: string, password?: string): { success: boolean; user?: DbUser; error?: string } {
    const cleanEmail = (email || '').trim().toLowerCase();
    let user = this.getUserByEmail(cleanEmail);

    if (!user) {
      // Auto-registro amigável para primeiro acesso
      const reg = this.registerUser({ email: cleanEmail, password: password || 'popoca_123456' });
      if (!reg.success) return { success: false, error: reg.error };
      user = reg.user!;
    } else if (password && user.password_hash !== 'popoca_default_pwd') {
      const match = verifyPassword(password, user.password_hash);
      if (!match) {
        return { success: false, error: 'Senha incorreta.' };
      }
    }

    return { success: true, user };
  }

  private createUserInternal(params: {
    id: string;
    email: string;
    password: string;
    username: string;
    handle: string;
    avatarUrl: string;
    bannerUrl: string;
    bio: string;
  }): DbUser {
    const now = Date.now();
    const hash = hashPassword(params.password);
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO users (id, email, password_hash, username, handle, avatar_url, banner_url, bio, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      params.id,
      params.email,
      hash,
      params.username,
      params.handle,
      params.avatarUrl,
      params.bannerUrl,
      params.bio,
      now,
      now
    );

    const initDataStmt = this.db.prepare(`
      INSERT OR IGNORE INTO user_data (user_id, watch_history, ratings, watched, watchlist, liked, custom_lists, updated_at)
      VALUES (?, '[]', '{}', '[]', '[]', '[]', '[]', ?)
    `);
    initDataStmt.run(params.id, now);

    return this.getUserById(params.id)!;
  }

  public getUserById(id: string): DbUser | null {
    const clean = (id || '').trim().toLowerCase();
    const stmt = this.db.prepare('SELECT * FROM users WHERE id = ?');
    const row = stmt.get(clean) as any;
    return row || null;
  }

  public getUserByEmail(email: string): DbUser | null {
    const clean = (email || '').trim().toLowerCase();
    const stmt = this.db.prepare('SELECT * FROM users WHERE email = ?');
    const row = stmt.get(clean) as any;
    return row || null;
  }

  public updateUserProfile(
    userId: string,
    updates: {
      username?: string;
      handle?: string;
      bio?: string;
      avatarUrl?: string;
      bannerUrl?: string;
    }
  ): DbUser | null {
    const existing = this.getUserById(userId);
    if (!existing) return null;

    const username = updates.username !== undefined ? updates.username.trim() : existing.username;
    const handle = updates.handle !== undefined ? updates.handle.trim() : existing.handle;
    const bio = updates.bio !== undefined ? updates.bio.trim() : existing.bio;
    const avatarUrl = updates.avatarUrl !== undefined ? updates.avatarUrl.trim() : existing.avatar_url;
    const bannerUrl = updates.bannerUrl !== undefined ? updates.bannerUrl.trim() : existing.banner_url;
    const now = Date.now();

    const stmt = this.db.prepare(`
      UPDATE users
      SET username = ?, handle = ?, bio = ?, avatar_url = ?, banner_url = ?, updated_at = ?
      WHERE id = ?
    `);
    stmt.run(username, handle, bio, avatarUrl, bannerUrl, now, existing.id);

    return this.getUserById(existing.id);
  }

  public getUserData(userId: string): DbUserData | null {
    const user = this.getUserById(userId);
    if (!user) return null;

    const stmt = this.db.prepare('SELECT * FROM user_data WHERE user_id = ?');
    const row = stmt.get(user.id) as any;
    if (!row) {
      return {
        user_id: user.id,
        watch_history: [],
        ratings: {},
        watched: [],
        watchlist: [],
        liked: [],
        custom_lists: [],
        updated_at: user.updated_at
      };
    }

    try {
      return {
        user_id: user.id,
        watch_history: JSON.parse(row.watch_history || '[]'),
        ratings: JSON.parse(row.ratings || '{}'),
        watched: JSON.parse(row.watched || '[]'),
        watchlist: JSON.parse(row.watchlist || '[]'),
        liked: JSON.parse(row.liked || '[]'),
        custom_lists: JSON.parse(row.custom_lists || '[]'),
        updated_at: row.updated_at
      };
    } catch {
      return null;
    }
  }

  private saveDataInternal(
    userId: string,
    data: {
      watch_history: any[];
      ratings: Record<string | number, any>;
      watched: any[];
      watchlist: any[];
      liked: any[];
      custom_lists: any[];
    }
  ) {
    const now = Date.now();
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO user_data (user_id, watch_history, ratings, watched, watchlist, liked, custom_lists, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      userId,
      JSON.stringify(data.watch_history),
      JSON.stringify(data.ratings),
      JSON.stringify(data.watched),
      JSON.stringify(data.watchlist),
      JSON.stringify(data.liked),
      JSON.stringify(data.custom_lists),
      now
    );
  }

  public syncUserData(userId: string, email: string, clientData: any): any {
    const cleanId = (userId || email || 'default_user').trim().toLowerCase();
    let user = this.getUserById(cleanId) || this.getUserByEmail(email);

    if (!user) {
      const reg = this.registerUser({
        email: email || `${cleanId}@popoca.app`,
        username: clientData.profile?.username,
        avatarUrl: clientData.profile?.avatarUrl,
        bannerUrl: clientData.profile?.bannerUrl
      });
      user = reg.user!;
    }

    // Se o cliente enviou atualizações de perfil (avatar, banner, etc), persiste no banco
    if (clientData.profile) {
      this.updateUserProfile(user.id, {
        username: clientData.profile.username,
        handle: clientData.profile.handle,
        bio: clientData.profile.bio,
        avatarUrl: clientData.profile.avatarUrl,
        bannerUrl: clientData.profile.bannerUrl
      });
      user = this.getUserById(user.id)!;
    }

    const existingData = this.getUserData(user.id) || {
      user_id: user.id,
      watch_history: [],
      ratings: {},
      watched: [],
      watchlist: [],
      liked: [],
      custom_lists: [],
      updated_at: 0
    };

    // 1. Merge inteligente de histórico
    const historyMap = new Map<number, any>();
    (existingData.watch_history || []).forEach((h) => {
      if (h && h.id) historyMap.set(h.id, h);
    });
    (clientData.watchHistory || []).forEach((h: any) => {
      if (h && h.id) {
        const cur = historyMap.get(h.id);
        if (!cur || (h.lastWatched || 0) >= (cur.lastWatched || 0)) {
          historyMap.set(h.id, h);
        }
      }
    });
    const mergedHistory = Array.from(historyMap.values())
      .sort((a, b) => (b.lastWatched || 0) - (a.lastWatched || 0))
      .slice(0, 50);

    // 2. Merge de filmes assistidos
    const watchedMap = new Map<number, any>();
    (existingData.watched || []).forEach((m) => {
      if (m?.id) watchedMap.set(m.id, m);
    });
    (clientData.watched || []).forEach((m: any) => {
      if (m?.id) watchedMap.set(m.id, m);
    });
    const mergedWatched = Array.from(watchedMap.values());

    // 3. Merge de avaliações Letterboxd
    const ratingsObj: Record<string | number, any> = { ...existingData.ratings };
    if (clientData.ratings) {
      Object.entries(clientData.ratings).forEach(([id, r]: [string, any]) => {
        if (!ratingsObj[id] || (r.watchedDate || 0) >= (ratingsObj[id]?.watchedDate || 0)) {
          ratingsObj[id] = r;
        }
      });
    }

    // 4. Merge de curtidos
    const likedMap = new Map<number, any>();
    (existingData.liked || []).forEach((m) => {
      if (m?.id) likedMap.set(m.id, m);
    });
    (clientData.liked || []).forEach((m: any) => {
      if (m?.id) likedMap.set(m.id, m);
    });
    const mergedLiked = Array.from(likedMap.values());

    // 5. Merge de watchlist
    const watchlistMap = new Map<number, any>();
    (existingData.watchlist || []).forEach((m) => {
      if (m?.id) watchlistMap.set(m.id, m);
    });
    (clientData.watchlist || []).forEach((m: any) => {
      if (m?.id) watchlistMap.set(m.id, m);
    });
    const mergedWatchlist = Array.from(watchlistMap.values());

    // 6. Merge de listas customizadas
    const listMap = new Map<string, any>();
    (existingData.custom_lists || []).forEach((l) => {
      if (l?.id) listMap.set(l.id, l);
    });
    (clientData.customLists || []).forEach((l: any) => {
      if (l?.id) {
        const curList = listMap.get(l.id);
        if (!curList) {
          listMap.set(l.id, l);
        } else {
          const itemMap = new Map<number, any>();
          (curList.items || []).forEach((it: any) => {
            if (it?.id) itemMap.set(it.id, it);
          });
          (l.items || []).forEach((it: any) => {
            if (it?.id) itemMap.set(it.id, it);
          });
          listMap.set(l.id, { ...curList, ...l, items: Array.from(itemMap.values()) });
        }
      }
    });
    const mergedLists = Array.from(listMap.values());

    this.saveDataInternal(user.id, {
      watch_history: mergedHistory,
      ratings: ratingsObj,
      watched: mergedWatched,
      watchlist: mergedWatchlist,
      liked: mergedLiked,
      custom_lists: mergedLists
    });

    return {
      userId: user.id,
      email: user.email,
      lastUpdated: Date.now(),
      watchHistory: mergedHistory,
      ratings: ratingsObj,
      watched: mergedWatched,
      watchlist: mergedWatchlist,
      liked: mergedLiked,
      customLists: mergedLists,
      profile: {
        username: user.username,
        handle: user.handle,
        bio: user.bio,
        avatarUrl: user.avatar_url,
        bannerUrl: user.banner_url,
        joinedAt: user.created_at
      }
    };
  }

  public generatePairCode(userId: string): string {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const formatted = `${code.slice(0, 3)}-${code.slice(3)}`;
    const expiresAt = Date.now() + 15 * 60 * 1000;

    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO pair_codes (code, user_id, expires_at)
      VALUES (?, ?, ?)
    `);
    stmt.run(formatted, userId.trim().toLowerCase(), expiresAt);
    return formatted;
  }

  public redeemPairCode(code: string): any | null {
    const clean = code.trim().replace(/\s+/g, '');
    const formatted = clean.length === 6 ? `${clean.slice(0, 3)}-${clean.slice(3)}` : clean;

    const stmt = this.db.prepare('SELECT * FROM pair_codes WHERE code = ?');
    const row = stmt.get(formatted) as any;
    if (!row) return null;

    if (Date.now() > row.expires_at) {
      this.db.prepare('DELETE FROM pair_codes WHERE code = ?').run(formatted);
      return null;
    }

    const user = this.getUserById(row.user_id);
    if (!user) return null;

    const data = this.getUserData(user.id);
    return {
      userId: user.id,
      email: user.email,
      lastUpdated: user.updated_at,
      watchHistory: data?.watch_history || [],
      ratings: data?.ratings || {},
      watched: data?.watched || [],
      watchlist: data?.watchlist || [],
      liked: data?.liked || [],
      customLists: data?.custom_lists || [],
      profile: {
        username: user.username,
        handle: user.handle,
        bio: user.bio,
        avatarUrl: user.avatar_url,
        bannerUrl: user.banner_url,
        joinedAt: user.created_at
      }
    };
  }
}

export const db = new PopocaDatabase();

