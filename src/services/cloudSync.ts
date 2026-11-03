/**
 * Popoca Streaming - Cloud Sync Client Engine
 * Sincroniza em tempo real histórico de reprodução ("Continuar Assistindo"),
 * filmes assistidos, avaliações, resenhas, curtidos, listas e perfil entre múltiplos aparelhos
 * através de sessões seguras com Bearer Token e pareamento por código.
 */

import { UserAccount, SyncData } from '../types/index.ts';
import { storageService } from './storage.ts';
import { letterboxdService } from './letterboxd.ts';
import { apiUrl } from './api.ts';

const ACCOUNT_KEY = 'popoca_user_account_v1';
const LAST_SYNC_KEY = 'popoca_last_synced_at_v1';

type SyncListener = (status: {
  isSyncing: boolean;
  lastSyncedAt: number | null;
  account: UserAccount;
  error?: string | null;
}) => void;

class CloudSyncClient {
  private syncTimer: any = null;
  private isSyncing = false;
  private lastSyncedAt: number | null = null;
  private listeners: Set<SyncListener> = new Set();
  private account: UserAccount;

  constructor() {
    this.account = this.loadAccount();
    const storedLastSync = localStorage.getItem(LAST_SYNC_KEY);
    if (storedLastSync) {
      this.lastSyncedAt = parseInt(storedLastSync, 10);
    }

    if (typeof window !== 'undefined') {
      // Garante sessão válida (cria convidado anônimo no backend se necessário)
      this.ensureSession().then(() => {
        setTimeout(() => {
          this.syncNow().catch((e) => console.warn('[CloudSync] Sync inicial aviso:', e));
        }, 1500);
      });

      window.addEventListener('focus', () => {
        const now = Date.now();
        if (!this.lastSyncedAt || now - this.lastSyncedAt > 45000) {
          this.syncNow().catch(() => {});
        }
      });

      window.addEventListener('popoca_storage_changed', () => {
        this.triggerAutoSync();
      });
    }
  }

  private loadAccount(): UserAccount {
    try {
      const raw = localStorage.getItem(ACCOUNT_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.userId) return parsed;
      }
    } catch {}

    const guestId = 'guest_' + (typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
      : Math.random().toString(36).slice(2, 10));

    const defaultAccount: UserAccount = {
      userId: guestId,
      email: `${guestId}@popoca.guest`,
      isAuthenticated: false,
      isCloudSyncEnabled: true,
      lastSyncedAt: undefined
    };

    try {
      localStorage.setItem(ACCOUNT_KEY, JSON.stringify(defaultAccount));
    } catch {}

    return defaultAccount;
  }

  public async ensureSession(): Promise<string | undefined> {
    if (this.account.token) return this.account.token;

    try {
      const res = await fetch(apiUrl('/api/auth/guest'), { method: 'POST' });
      if (res.ok) {
        const json = await res.json();
        if (json.success && json.token && json.user) {
          this.account = {
            userId: json.user.id,
            email: json.user.email,
            token: json.token,
            isAuthenticated: false,
            isCloudSyncEnabled: true,
            lastSyncedAt: this.lastSyncedAt || undefined
          };
          localStorage.setItem(ACCOUNT_KEY, JSON.stringify(this.account));
          this.notifyListeners();
          return json.token;
        }
      }
    } catch (e) {
      console.warn('[CloudSync] Erro ao obter sessão convidada:', e);
    }
    return undefined;
  }

  public getAccount(): UserAccount {
    return this.account;
  }

  public async login(email: string, password: string): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch(apiUrl('/api/auth/login'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), password })
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return { success: false, error: json.error || 'Erro ao realizar login.' };
      }

      this.account = {
        userId: json.user.id,
        email: json.user.email,
        token: json.token,
        isAuthenticated: true,
        isCloudSyncEnabled: true,
        lastSyncedAt: Date.now()
      };
      localStorage.setItem(ACCOUNT_KEY, JSON.stringify(this.account));
      this.notifyListeners();
      await this.syncNow();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha na conexão com o servidor.' };
    }
  }

  public async register(params: {
    email: string;
    password: string;
    username?: string;
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const res = await fetch(apiUrl('/api/auth/register'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params)
      });
      const json = await res.json();
      if (!res.ok || !json.success) {
        return { success: false, error: json.error || 'Erro ao registrar conta.' };
      }

      this.account = {
        userId: json.user.id,
        email: json.user.email,
        token: json.token,
        isAuthenticated: true,
        isCloudSyncEnabled: true,
        lastSyncedAt: Date.now()
      };
      localStorage.setItem(ACCOUNT_KEY, JSON.stringify(this.account));
      this.notifyListeners();
      await this.syncNow();
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err?.message || 'Falha na conexão com o servidor.' };
    }
  }

  public async logout(): Promise<void> {
    if (this.account.token) {
      try {
        await fetch(apiUrl('/api/auth/logout'), {
          method: 'POST',
          headers: { Authorization: `Bearer ${this.account.token}` }
        });
      } catch {}
    }
    localStorage.removeItem(ACCOUNT_KEY);
    this.account = this.loadAccount();
    await this.ensureSession();
    this.notifyListeners();
  }

  public subscribe(listener: SyncListener): () => void {
    this.listeners.add(listener);
    listener({
      isSyncing: this.isSyncing,
      lastSyncedAt: this.lastSyncedAt,
      account: this.account
    });
    return () => this.listeners.delete(listener);
  }

  private notifyListeners(error: string | null = null) {
    this.listeners.forEach((fn) =>
      fn({
        isSyncing: this.isSyncing,
        lastSyncedAt: this.lastSyncedAt,
        account: this.account,
        error
      })
    );
  }

  public getLocalState(): SyncData {
    return {
      watchHistory: storageService.getWatchHistory(),
      ratings: letterboxdService.getRatings(),
      watched: letterboxdService.getWatched(),
      watchlist: letterboxdService.getWatchlist(),
      liked: letterboxdService.getLiked(),
      customLists: letterboxdService.getCustomLists(),
      profile: letterboxdService.getProfile()
    };
  }

  public applyMergedState(data: Partial<SyncData>) {
    if (!data) return;

    if (Array.isArray(data.watchHistory)) {
      localStorage.setItem('popoca_watch_history_v1', JSON.stringify(data.watchHistory));
    }
    if (data.ratings && typeof data.ratings === 'object') {
      localStorage.setItem('popoca_letterboxd_ratings_v2', JSON.stringify(data.ratings));
    }
    if (Array.isArray(data.watched)) {
      localStorage.setItem('popoca_letterboxd_watched_v2', JSON.stringify(data.watched));
    }
    if (Array.isArray(data.watchlist)) {
      localStorage.setItem('popoca_letterboxd_watchlist_v2', JSON.stringify(data.watchlist));
    }
    if (Array.isArray(data.liked)) {
      localStorage.setItem('popoca_letterboxd_liked_v2', JSON.stringify(data.liked));
    }
    if (Array.isArray(data.customLists)) {
      localStorage.setItem('popoca_letterboxd_lists_v2', JSON.stringify(data.customLists));
      localStorage.setItem('popoca_custom_lists_v1', JSON.stringify(data.customLists));
    }
    if (data.profile) {
      localStorage.setItem('popoca_letterboxd_profile_v2', JSON.stringify(data.profile));
      localStorage.setItem('popoca_user_profile_v1', JSON.stringify(data.profile));
    }

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('popoca_storage_synced'));
    }
  }

  public triggerAutoSync() {
    if (!this.account.isCloudSyncEnabled) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);

    this.syncTimer = setTimeout(() => {
      this.syncNow().catch((err) => console.warn('[CloudSync] Falha na auto-sincronização:', err));
    }, 2000);
  }

  public async syncNow(): Promise<boolean> {
    if (this.isSyncing) return true;
    this.isSyncing = true;
    this.notifyListeners();

    try {
      const token = await this.ensureSession();
      if (!token) {
        throw new Error('Sessão indisponível.');
      }

      const localState = this.getLocalState();
      const res = await fetch(apiUrl('/api/sync'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({
          clientData: localState
        })
      });

      if (!res.ok) {
        if (res.status === 401) {
          // Token expirado: recria sessão
          this.account.token = undefined;
          await this.ensureSession();
        }
        throw new Error(`Servidor respondeu com status ${res.status}`);
      }

      const json = await res.json();
      if (json.success && json.data) {
        this.applyMergedState(json.data);
        this.lastSyncedAt = Date.now();
        localStorage.setItem(LAST_SYNC_KEY, this.lastSyncedAt.toString());
        this.account.lastSyncedAt = this.lastSyncedAt;
        localStorage.setItem(ACCOUNT_KEY, JSON.stringify(this.account));
        this.isSyncing = false;
        this.notifyListeners();
        return true;
      } else {
        throw new Error(json.error || 'Erro na resposta do sync');
      }
    } catch (err: any) {
      console.warn('[CloudSync] Erro na sincronização:', err.message);
      this.isSyncing = false;
      this.notifyListeners(err.message);
      return false;
    }
  }

  public async generatePairCode(): Promise<string> {
    const token = await this.ensureSession();
    if (!token) throw new Error('Autenticação necessária para gerar código');

    const res = await fetch(apiUrl('/api/sync/pair-code'), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`
      }
    });
    const json = await res.json();
    if (json.success && json.code) {
      return json.code;
    }
    throw new Error(json.error || 'Não foi possível gerar código de pareamento');
  }

  public async linkDeviceWithPairCode(code: string): Promise<boolean> {
    const res = await fetch(apiUrl('/api/sync/pair-code/redeem'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.trim() })
    });
    const json = await res.json();
    if (json.success && json.token && json.data) {
      this.account = {
        userId: json.data.userId,
        email: json.data.email,
        token: json.token,
        isAuthenticated: true,
        isCloudSyncEnabled: true,
        lastSyncedAt: Date.now()
      };
      localStorage.setItem(ACCOUNT_KEY, JSON.stringify(this.account));
      this.applyMergedState(json.data);
      this.lastSyncedAt = Date.now();
      localStorage.setItem(LAST_SYNC_KEY, this.lastSyncedAt.toString());
      this.notifyListeners();
      return true;
    }
    throw new Error(json.error || 'Código inválido ou expirado');
  }
}

export const cloudSync = new CloudSyncClient();
