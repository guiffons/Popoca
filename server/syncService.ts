/**
 * Popoca Streaming - Cloud Sync Service (Backend)
 * Sincronização em nuvem e entre dispositivos de histórico de reprodução,
 * filmes assistidos, avaliações Letterboxd, watchlist, listas personalizadas e perfil.
 */

import fs from 'fs';
import path from 'path';

export interface UserSyncData {
  userId: string;
  email: string;
  lastUpdated: number;
  watchHistory: any[];
  ratings: Record<string | number, any>;
  watched: any[];
  watchlist: any[];
  liked: any[];
  customLists: any[];
  profile: any;
}

const STORAGE_FILE = path.resolve(process.cwd(), 'popoca-sync-data.json');

// Memória persistida em arquivo JSON local
class CloudSyncService {
  private users: Map<string, UserSyncData> = new Map();
  private pairCodes: Map<string, { userId: string; expiresAt: number }> = new Map();

  constructor() {
    this.loadFromDisk();
  }

  private loadFromDisk() {
    try {
      if (fs.existsSync(STORAGE_FILE)) {
        const raw = fs.readFileSync(STORAGE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          parsed.forEach((item: UserSyncData) => {
            if (item && item.userId) {
              this.users.set(item.userId, item);
            }
          });
          console.log(`[SyncService] Carregados dados de ${this.users.size} contas do disco.`);
        }
      }
    } catch (e) {
      console.warn('[SyncService] Aviso ao ler armazenamento de sincronização:', e);
    }
  }

  private saveToDisk() {
    try {
      const array = Array.from(this.users.values());
      fs.writeFileSync(STORAGE_FILE, JSON.stringify(array, null, 2), 'utf-8');
    } catch (e) {
      console.warn('[SyncService] Aviso ao persistir dados de sincronização:', e);
    }
  }

  public normalizeId(id: string): string {
    return (id || '').trim().toLowerCase();
  }

  public getUser(userIdOrEmail: string): UserSyncData | null {
    const key = this.normalizeId(userIdOrEmail);
    // Busca por userId direto
    if (this.users.has(key)) {
      return this.users.get(key)!;
    }
    // Busca por email
    for (const user of this.users.values()) {
      if (this.normalizeId(user.email) === key) {
        return user;
      }
    }
    return null;
  }

  public syncUserData(userId: string, email: string, clientData: Partial<UserSyncData>): UserSyncData {
    const key = this.normalizeId(userId || email || 'default_user');
    const existing = this.getUser(key) || {
      userId: key,
      email: email || `${key}@popoca.app`,
      lastUpdated: 0,
      watchHistory: [],
      ratings: {},
      watched: [],
      watchlist: [],
      liked: [],
      customLists: [],
      profile: {
        username: 'Cinéfilo Popoca',
        handle: '@cinfilo',
        avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80',
        bio: 'Amante de cinema, animes e maratonas em streaming ultra-leve.',
        joinedAt: Date.now()
      }
    };

    // 1. Merge Inteligente de Histórico de Reprodução (último assistido vence)
    const historyMap = new Map<number, any>();
    (existing.watchHistory || []).forEach(h => {
      if (h && h.id) historyMap.set(h.id, h);
    });
    (clientData.watchHistory || []).forEach(h => {
      if (h && h.id) {
        const current = historyMap.get(h.id);
        if (!current || (h.lastWatched || 0) >= (current.lastWatched || 0)) {
          historyMap.set(h.id, h);
        }
      }
    });
    const mergedHistory = Array.from(historyMap.values())
      .sort((a, b) => (b.lastWatched || 0) - (a.lastWatched || 0))
      .slice(0, 50);

    // 2. Merge de Filmes Vistos (União por ID)
    const watchedMap = new Map<number, any>();
    (existing.watched || []).forEach(m => { if (m && m.id) watchedMap.set(m.id, m); });
    (clientData.watched || []).forEach(m => { if (m && m.id) watchedMap.set(m.id, m); });
    const mergedWatched = Array.from(watchedMap.values());

    // 3. Merge de Avaliações Letterboxd
    const ratingsObj: Record<string | number, any> = { ...existing.ratings };
    if (clientData.ratings) {
      Object.entries(clientData.ratings).forEach(([id, r]: [string, any]) => {
        if (!ratingsObj[id] || (r.watchedDate || 0) >= (ratingsObj[id]?.watchedDate || 0)) {
          ratingsObj[id] = r;
        }
      });
    }

    // 4. Merge de Curtidos
    const likedMap = new Map<number, any>();
    (existing.liked || []).forEach(m => { if (m && m.id) likedMap.set(m.id, m); });
    (clientData.liked || []).forEach(m => { if (m && m.id) likedMap.set(m.id, m); });
    const mergedLiked = Array.from(likedMap.values());

    // 5. Merge de Watchlist
    const watchlistMap = new Map<number, any>();
    (existing.watchlist || []).forEach(m => { if (m && m.id) watchlistMap.set(m.id, m); });
    (clientData.watchlist || []).forEach(m => { if (m && m.id) watchlistMap.set(m.id, m); });
    const mergedWatchlist = Array.from(watchlistMap.values());

    // 6. Merge de Listas Personalizadas
    const listMap = new Map<string, any>();
    (existing.customLists || []).forEach(l => { if (l && l.id) listMap.set(l.id, l); });
    (clientData.customLists || []).forEach(l => {
      if (l && l.id) {
        const curList = listMap.get(l.id);
        if (!curList) {
          listMap.set(l.id, l);
        } else {
          // Merge de itens na lista
          const itemMap = new Map<number, any>();
          (curList.items || []).forEach((it: any) => { if (it?.id) itemMap.set(it.id, it); });
          (l.items || []).forEach((it: any) => { if (it?.id) itemMap.set(it.id, it); });
          listMap.set(l.id, {
            ...curList,
            ...l,
            items: Array.from(itemMap.values())
          });
        }
      }
    });
    const mergedCustomLists = Array.from(listMap.values());

    // 7. Merge de Perfil
    const mergedProfile = {
      ...existing.profile,
      ...(clientData.profile || {})
    };

    const updatedUser: UserSyncData = {
      userId: key,
      email: email || existing.email || `${key}@popoca.app`,
      lastUpdated: Date.now(),
      watchHistory: mergedHistory,
      ratings: ratingsObj,
      watched: mergedWatched,
      watchlist: mergedWatchlist,
      liked: mergedLiked,
      customLists: mergedCustomLists,
      profile: mergedProfile
    };

    this.users.set(key, updatedUser);
    this.saveToDisk();

    return updatedUser;
  }

  // Criação de Código de Pareamento de 6 dígitos entre dispositivos
  public generatePairCode(userId: string): string {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const formatted = `${code.slice(0, 3)}-${code.slice(3)}`;
    this.pairCodes.set(formatted, {
      userId: this.normalizeId(userId),
      expiresAt: Date.now() + 15 * 60 * 1000 // 15 minutos de validade
    });
    return formatted;
  }

  // Resgate do Código de Pareamento no segundo dispositivo
  public redeemPairCode(code: string): UserSyncData | null {
    const clean = code.trim().replace(/\s+/g, '');
    const formatted = clean.length === 6 ? `${clean.slice(0, 3)}-${clean.slice(3)}` : clean;

    const entry = this.pairCodes.get(formatted);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.pairCodes.delete(formatted);
      return null;
    }

    const user = this.getUser(entry.userId);
    return user;
  }
}

export const syncService = new CloudSyncService();
