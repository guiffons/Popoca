/**
 * Popoca Streaming - Banco de Dados Nativo SQLite (Backend)
 * Gerenciamento seguro e de alto desempenho de Contas de Usuário, Sessões Bearer,
 * Perfis, Histórico de Reprodução, Avaliações Letterboxd, Watchlist, Listas e Códigos de Pareamento.
 */

import { DatabaseSync, type StatementSync } from 'node:sqlite';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

const DATA_DIR = process.env.DATA_DIR || process.cwd();
try { if (!fs.existsSync(DATA_DIR)) { fs.mkdirSync(DATA_DIR, { recursive: true }); } } catch {}
const DB_PATH = path.resolve(DATA_DIR, 'popoca.db');
const EXAMPLE_JSON_PATH = path.resolve(process.cwd(), 'popoca-sync-data.example.json');

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

export type SafeDbUser = Omit<DbUser, 'password_hash'>;

export interface DbSession {
  token: string;
  user_id: string;
  created_at: number;
  expires_at: number;
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

export function toSafeUser(user: DbUser): SafeDbUser {
  return {
    id: user.id,
    email: user.email,
    username: user.username,
    handle: user.handle,
    avatar_url: user.avatar_url,
    banner_url: user.banner_url,
    bio: user.bio,
    created_at: user.created_at,
    updated_at: user.updated_at
  };
}

function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  try {
    if (!stored || stored === 'NEEDS_RESET') return false;
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
  private stmtGetUserById!: StatementSync;
  private stmtGetUserByEmail!: StatementSync;
  private stmtGetSession!: StatementSync;
  private stmtDeleteSession!: StatementSync;
  private stmtInsertSession!: StatementSync;
  private stmtCleanExpiredSessions!: StatementSync;
  private stmtGetUserData!: StatementSync;
  private stmtSaveUserData!: StatementSync;
  private stmtGetPairCode!: StatementSync;
  private stmtInsertPairCode!: StatementSync;
  private stmtDeletePairCode!: StatementSync;
  private stmtCleanExpiredPairCodes!: StatementSync;
  private stmtUpdateProfile!: StatementSync;

  constructor() {
    this.db = new DatabaseSync(DB_PATH);
    this.initSchema();
    this.initStatements();
    this.migrateLegacyExample();
    this.startCleanupInterval();
  }

  private initSchema() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;
      PRAGMA cache_size = -64000;
      PRAGMA temp_store = MEMORY;
      PRAGMA busy_timeout = 5000;

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

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
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
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
      CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
      CREATE INDEX IF NOT EXISTS idx_pair_codes_expires ON pair_codes(expires_at);
      CREATE INDEX IF NOT EXISTS idx_user_data_updated ON user_data(updated_at);
    `);
  }

  private initStatements() {
    this.stmtGetUserById = this.db.prepare('SELECT * FROM users WHERE id = ?');
    this.stmtGetUserByEmail = this.db.prepare('SELECT * FROM users WHERE email = ?');
    this.stmtGetSession = this.db.prepare('SELECT * FROM sessions WHERE token = ?');
    this.stmtDeleteSession = this.db.prepare('DELETE FROM sessions WHERE token = ?');
    this.stmtInsertSession = this.db.prepare(
      'INSERT INTO sessions (token, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)'
    );
    this.stmtCleanExpiredSessions = this.db.prepare('DELETE FROM sessions WHERE expires_at < ?');
    this.stmtGetUserData = this.db.prepare('SELECT * FROM user_data WHERE user_id = ?');
    this.stmtSaveUserData = this.db.prepare(`
      INSERT OR REPLACE INTO user_data (user_id, watch_history, ratings, watched, watchlist, liked, custom_lists, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.stmtGetPairCode = this.db.prepare('SELECT * FROM pair_codes WHERE code = ?');
    this.stmtInsertPairCode = this.db.prepare(
      'INSERT OR REPLACE INTO pair_codes (code, user_id, expires_at) VALUES (?, ?, ?)'
    );
    this.stmtDeletePairCode = this.db.prepare('DELETE FROM pair_codes WHERE code = ?');
    this.stmtCleanExpiredPairCodes = this.db.prepare('DELETE FROM pair_codes WHERE expires_at < ?');
    this.stmtUpdateProfile = this.db.prepare(`
      UPDATE users
      SET username = ?, handle = ?, bio = ?, avatar_url = ?, banner_url = ?, updated_at = ?
      WHERE id = ?
    `);
  }

  private startCleanupInterval() {
    const cleanup = () => {
      try {
        const now = Date.now();
        this.stmtCleanExpiredSessions.run(now);
        this.stmtCleanExpiredPairCodes.run(now);
      } catch (err) {
        console.warn('[Database] Erro na limpeza periódica de sessões:', err);
      }
    };
    // Executa a cada 15 minutos sem segurar o processo Node.js
    setInterval(cleanup, 15 * 60 * 1000).unref();
  }

  private migrateLegacyExample() {
    try {
      if (!fs.existsSync(EXAMPLE_JSON_PATH)) return;
      const countStmt = this.db.prepare('SELECT COUNT(*) as cnt FROM users');
      const row = countStmt.get() as { cnt: number };
      if (row && row.cnt > 0) return;

      const raw = fs.readFileSync(EXAMPLE_JSON_PATH, 'utf-8');
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;

      for (const item of parsed) {
        if (!item || !item.email) continue;
        const email = String(item.email).trim().toLowerCase();
        const profile = item.profile || {};
        const id = crypto.randomUUID();
        const now = Date.now();

        try {
          const stmt = this.db.prepare(`
            INSERT INTO users (id, email, password_hash, username, handle, avatar_url, banner_url, bio, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `);
          stmt.run(
            id,
            email,
            'NEEDS_RESET',
            profile.username || 'Cinéfilo Popoca',
            profile.handle || '@cinefilo',
            profile.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
            profile.bannerUrl || 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1600&auto=format&fit=crop&q=80',
            profile.bio || 'Amante de cinema e streaming no Popoca.',
            now,
            now
          );

          this.saveDataInternal(id, {
            watch_history: item.watchHistory || [],
            ratings: item.ratings || {},
            watched: item.watched || [],
            watchlist: item.watchlist || [],
            liked: item.liked || [],
            custom_lists: item.customLists || []
          });
        } catch {
          // Ignora duplicatas na semente inicial
        }
      }
    } catch (err) {
      console.warn('[Database] Aviso ao inicializar dados de exemplo:', err);
    }
  }

  // ===== SESSÕES E AUTORIZAÇÃO =====

  public createSession(userId: string): { token: string; expiresAt: number } {
    const token = crypto.randomBytes(32).toString('hex');
    const now = Date.now();
    const expiresAt = now + 30 * 24 * 60 * 60 * 1000; // 30 dias

    this.stmtInsertSession.run(token, userId, now, expiresAt);

    return { token, expiresAt };
  }

  public validateSession(token: string): DbUser | null {
    if (!token || typeof token !== 'string') return null;
    const session = this.stmtGetSession.get(token.trim()) as DbSession | undefined;
    if (!session) return null;

    if (Date.now() > session.expires_at) {
      this.deleteSession(token);
      return null;
    }

    return this.getUserById(session.user_id);
  }

  public deleteSession(token: string): void {
    if (!token) return;
    this.stmtDeleteSession.run(token.trim());
  }

  // ===== CONTAS E AUTENTICAÇÃO =====

  public registerUser(params: {
    email: string;
    password: string;
    username?: string;
    handle?: string;
    avatarUrl?: string;
    bannerUrl?: string;
    bio?: string;
  }): { success: boolean; user?: SafeDbUser; token?: string; error?: string } {
    const email = (params.email || '').trim().toLowerCase();
    if (!email || !email.includes('@') || email.length > 254) {
      return { success: false, error: 'E-mail inválido.' };
    }

    const password = typeof params.password === 'string' ? params.password : '';
    if (password.length < 6) {
      return { success: false, error: 'A senha deve conter no mínimo 6 caracteres.' };
    }
    if (password.length > 128) {
      return { success: false, error: 'A senha é muito longa (máximo 128 caracteres).' };
    }

    const existing = this.getUserByEmail(email);
    if (existing) {
      return { success: false, error: 'Uma conta com este e-mail já existe.' };
    }

    const id = crypto.randomUUID();
    const now = Date.now();
    const hash = hashPassword(password);
    const cleanUsername = (params.username || email.split('@')[0] || 'Cinéfilo').trim().slice(0, 50);
    const cleanHandle = (params.handle || `@${cleanUsername.toLowerCase().replace(/\s+/g, '_')}`).trim().slice(0, 30);

    try {
      const stmt = this.db.prepare(`
        INSERT INTO users (id, email, password_hash, username, handle, avatar_url, banner_url, bio, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      stmt.run(
        id,
        email,
        hash,
        cleanUsername,
        cleanHandle,
        params.avatarUrl || 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
        params.bannerUrl || 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1600&auto=format&fit=crop&q=80',
        params.bio || 'Cinéfilo e maratonista no Popoca Streaming.',
        now,
        now
      );

      const initDataStmt = this.db.prepare(`
        INSERT OR IGNORE INTO user_data (user_id, watch_history, ratings, watched, watchlist, liked, custom_lists, updated_at)
        VALUES (?, '[]', '{}', '[]', '[]', '[]', '[]', ?)
      `);
      initDataStmt.run(id, now);

      const user = this.getUserById(id)!;
      const session = this.createSession(id);
      return { success: true, user: toSafeUser(user), token: session.token };
    } catch (err: any) {
      return { success: false, error: 'Falha ao registrar conta. Tente novamente.' };
    }
  }

  public createGuestUser(): { success: boolean; user: SafeDbUser; token: string } {
    const id = crypto.randomUUID();
    const shortId = id.replace(/-/g, '').slice(0, 8);
    const email = `convidado_${shortId}@popoca.guest`;
    const randomSecret = crypto.randomBytes(32).toString('hex');
    const hash = hashPassword(randomSecret);
    const now = Date.now();

    const stmt = this.db.prepare(`
      INSERT INTO users (id, email, password_hash, username, handle, avatar_url, banner_url, bio, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      id,
      email,
      hash,
      `Convidado ${shortId}`,
      `@convidado_${shortId}`,
      'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
      'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1600&auto=format&fit=crop&q=80',
      'Sessão temporária de convidado no Popoca.',
      now,
      now
    );

    const initDataStmt = this.db.prepare(`
      INSERT OR IGNORE INTO user_data (user_id, watch_history, ratings, watched, watchlist, liked, custom_lists, updated_at)
      VALUES (?, '[]', '{}', '[]', '[]', '[]', '[]', ?)
    `);
    initDataStmt.run(id, now);

    const user = this.getUserById(id)!;
    const session = this.createSession(id);
    return { success: true, user: toSafeUser(user), token: session.token };
  }

  public loginUser(email: string, password: string): { success: boolean; user?: SafeDbUser; token?: string; error?: string } {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      return { success: false, error: 'E-mail inválido.' };
    }
    if (!password || typeof password !== 'string') {
      return { success: false, error: 'Senha obrigatória.' };
    }

    const user = this.getUserByEmail(cleanEmail);
    if (!user) {
      return { success: false, error: 'E-mail ou senha incorretos.' };
    }

    if (user.password_hash === 'NEEDS_RESET') {
      return {
        success: false,
        error: 'Esta conta requer redefinição de senha para proteção dos seus dados.'
      };
    }

    const match = verifyPassword(password, user.password_hash);
    if (!match) {
      return { success: false, error: 'E-mail ou senha incorretos.' };
    }

    const session = this.createSession(user.id);
    return { success: true, user: toSafeUser(user), token: session.token };
  }

  public getUserById(id: string): DbUser | null {
    if (!id || typeof id !== 'string') return null;
    const row = this.stmtGetUserById.get(id.trim()) as DbUser | undefined;
    return row || null;
  }

  public getUserByEmail(email: string): DbUser | null {
    if (!email || typeof email !== 'string') return null;
    const clean = email.trim().toLowerCase();
    const row = this.stmtGetUserByEmail.get(clean) as DbUser | undefined;
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
  ): SafeDbUser | null {
    const existing = this.getUserById(userId);
    if (!existing) return null;

    const username = updates.username !== undefined ? updates.username.trim().slice(0, 50) : existing.username;
    const handle = updates.handle !== undefined ? updates.handle.trim().slice(0, 30) : existing.handle;
    const bio = updates.bio !== undefined ? updates.bio.trim().slice(0, 240) : existing.bio;
    const avatarUrl = updates.avatarUrl !== undefined ? updates.avatarUrl.trim().slice(0, 1000) : existing.avatar_url;
    const bannerUrl = updates.bannerUrl !== undefined ? updates.bannerUrl.trim().slice(0, 1000) : existing.banner_url;
    const now = Date.now();

    this.stmtUpdateProfile.run(username, handle, bio, avatarUrl, bannerUrl, now, existing.id);

    const refreshed = this.getUserById(existing.id);
    return refreshed ? toSafeUser(refreshed) : null;
  }

  // ===== DADOS DO USUÁRIO & SINCRONIZAÇÃO =====

  public getUserData(userId: string): DbUserData | null {
    const user = this.getUserById(userId);
    if (!user) return null;

    const row = this.stmtGetUserData.get(user.id) as any;
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
    this.stmtSaveUserData.run(
      userId,
      JSON.stringify(data.watch_history || []),
      JSON.stringify(data.ratings || {}),
      JSON.stringify(data.watched || []),
      JSON.stringify(data.watchlist || []),
      JSON.stringify(data.liked || []),
      JSON.stringify(data.custom_lists || []),
      now
    );
  }

  public syncUserData(userId: string, clientData: any): any {
    const user = this.getUserById(userId);
    if (!user) {
      throw new Error('Usuário não encontrado');
    }

    if (clientData?.profile) {
      this.updateUserProfile(user.id, {
        username: clientData.profile.username,
        handle: clientData.profile.handle,
        bio: clientData.profile.bio,
        avatarUrl: clientData.profile.avatarUrl,
        bannerUrl: clientData.profile.bannerUrl
      });
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

    // 1. Histórico
    const historyMap = new Map<number, any>();
    (existingData.watch_history || []).forEach((h) => {
      if (h && typeof h.id === 'number') historyMap.set(h.id, h);
    });
    (clientData?.watchHistory || []).forEach((h: any) => {
      if (h && typeof h.id === 'number') {
        const cur = historyMap.get(h.id);
        if (!cur || (h.lastWatched || 0) >= (cur.lastWatched || 0)) {
          historyMap.set(h.id, h);
        }
      }
    });
    const mergedHistory = Array.from(historyMap.values())
      .sort((a, b) => (b.lastWatched || 0) - (a.lastWatched || 0))
      .slice(0, 50);

    // 2. Assistidos
    const watchedMap = new Map<number, any>();
    (existingData.watched || []).forEach((m) => {
      if (m?.id) watchedMap.set(m.id, m);
    });
    (clientData?.watched || []).forEach((m: any) => {
      if (m?.id) watchedMap.set(m.id, m);
    });
    const mergedWatched = Array.from(watchedMap.values()).slice(0, 500);

    // 3. Avaliações
    const ratingsObj: Record<string | number, any> = { ...existingData.ratings };
    if (clientData?.ratings && typeof clientData.ratings === 'object') {
      Object.entries(clientData.ratings).forEach(([id, r]: [string, any]) => {
        if (!ratingsObj[id] || (r.watchedDate || 0) >= (ratingsObj[id]?.watchedDate || 0)) {
          ratingsObj[id] = r;
        }
      });
    }

    // 4. Curtidos
    const likedMap = new Map<number, any>();
    (existingData.liked || []).forEach((m) => {
      if (m?.id) likedMap.set(m.id, m);
    });
    (clientData?.liked || []).forEach((m: any) => {
      if (m?.id) likedMap.set(m.id, m);
    });
    const mergedLiked = Array.from(likedMap.values()).slice(0, 500);

    // 5. Watchlist
    const watchlistMap = new Map<number, any>();
    (existingData.watchlist || []).forEach((m) => {
      if (m?.id) watchlistMap.set(m.id, m);
    });
    (clientData?.watchlist || []).forEach((m: any) => {
      if (m?.id) watchlistMap.set(m.id, m);
    });
    const mergedWatchlist = Array.from(watchlistMap.values()).slice(0, 500);

    // 6. Listas Customizadas
    const listMap = new Map<string, any>();
    (existingData.custom_lists || []).forEach((l) => {
      if (l?.id) listMap.set(l.id, l);
    });
    (clientData?.customLists || []).forEach((l: any) => {
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
    const mergedLists = Array.from(listMap.values()).slice(0, 50);

    this.saveDataInternal(user.id, {
      watch_history: mergedHistory,
      ratings: ratingsObj,
      watched: mergedWatched,
      watchlist: mergedWatchlist,
      liked: mergedLiked,
      custom_lists: mergedLists
    });

    const refreshedUser = this.getUserById(user.id) || user;

    return {
      userId: refreshedUser.id,
      email: refreshedUser.email,
      lastUpdated: Date.now(),
      watchHistory: mergedHistory,
      ratings: ratingsObj,
      watched: mergedWatched,
      watchlist: mergedWatchlist,
      liked: mergedLiked,
      customLists: mergedLists,
      profile: {
        username: refreshedUser.username,
        handle: refreshedUser.handle,
        bio: refreshedUser.bio,
        avatarUrl: refreshedUser.avatar_url,
        bannerUrl: refreshedUser.banner_url,
        joinedAt: refreshedUser.created_at
      }
    };
  }

  // ===== PAREAMENTO POR CÓDIGO (CROSS-DEVICE) =====

  public generatePairCode(userId: string): string {
    const user = this.getUserById(userId);
    if (!user) throw new Error('Usuário inválido para pareamento');

    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const formatted = `${code.slice(0, 3)}-${code.slice(3)}`;
    const expiresAt = Date.now() + 15 * 60 * 1000;

    this.stmtInsertPairCode.run(formatted, user.id, expiresAt);
    return formatted;
  }

  public redeemPairCode(code: string): { user: SafeDbUser; token: string; data: any } | null {
    const clean = code.trim().replace(/\s+/g, '');
    const formatted = clean.length === 6 ? `${clean.slice(0, 3)}-${clean.slice(3)}` : clean;

    const row = this.stmtGetPairCode.get(formatted) as any;
    if (!row) return null;

    if (Date.now() > row.expires_at) {
      this.stmtDeletePairCode.run(formatted);
      return null;
    }

    const user = this.getUserById(row.user_id);
    if (!user) return null;

    // Consome o código (uso único)
    this.stmtDeletePairCode.run(formatted);

    const session = this.createSession(user.id);
    const data = this.getUserData(user.id);

    return {
      user: toSafeUser(user),
      token: session.token,
      data: {
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
      }
    };
  }
}

export const db = new PopocaDatabase();
