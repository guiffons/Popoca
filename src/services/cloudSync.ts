/**
 * Popoca Streaming - Cloud Sync Client Engine
 * Sincroniza em tempo real histórico de reprodução ("Continuar Assistindo"),
 * filmes assistidos, avaliações, resenhas, curtidos, listas e perfil entre múltiplos aparelhos
 * (PC, celular, tablet, TV) através da conta do usuário e pareamento por código.
 */

import { UserAccount, SyncData, WatchHistoryItem, MediaItem, MovieRating, CustomList, UserProfile } from '../types/index.ts';
import { storageService } from './storage.ts';
import { letterboxdService } from './letterboxd.ts';

const ACCOUNT_KEY = 'popoca_user_account_v1';
const LAST_SYNC_KEY = 'popoca_last_synced_at_v1';
const DEFAULT_EMAIL = 'guilhermefonseca732@gmail.com';

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

    // Sincronização inicial automática em segundo plano
    if (typeof window !== 'undefined') {
      setTimeout(() => {
        this.syncNow().catch((e) => console.warn('[CloudSync] Sync inicial aviso:', e));
      }, 1500);

      // Sincroniza ao focar a aba caso outro dispositivo tenha alterado algo
      window.addEventListener('focus', () => {
        const now = Date.now();
        if (!this.lastSyncedAt || now - this.lastSyncedAt > 45000) {
          this.syncNow().catch(() => {});
        }
      });

      // Dispara auto-sincronização automática sempre que algo for salvo localmente
      window.addEventListener('popoca_storage_changed', () => {
        this.triggerAutoSync();
      });
    }
  }

  private loadAccount(): UserAccount {
    try {
      const raw = localStorage.getItem(ACCOUNT_KEY);
      if (raw) return JSON.parse(raw);
    } catch {
      // fallback
    }

    const defaultAccount: UserAccount = {
      userId: DEFAULT_EMAIL.toLowerCase().replace(/[^a-z0-9]/g, '_'),
      email: DEFAULT_EMAIL,
      isAuthenticated: true,
      isCloudSyncEnabled: true,
      lastSyncedAt: undefined
    };
    try {
      localStorage.setItem(ACCOUNT_KEY, JSON.stringify(defaultAccount));
    } catch {}
    return defaultAccount;
  }

  public getAccount(): UserAccount {
    return this.account;
  }

  public updateAccount(email: string): UserAccount {
    const cleanEmail = email.trim().toLowerCase();
    const userId = cleanEmail.replace(/[^a-z0-9]/g, '_');
    this.account = {
      userId,
      email: cleanEmail,
      isAuthenticated: true,
      isCloudSyncEnabled: true,
      lastSyncedAt: Date.now()
    };
    localStorage.setItem(ACCOUNT_KEY, JSON.stringify(this.account));
    this.notifyListeners();
    this.syncNow();
    return this.account;
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

  /**
   * Coleta o estado completo das bibliotecas locais
   */
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

  /**
   * Aplica estado retornado pela nuvem no localStorage local
   */
  public applyMergedState(data: Partial<SyncData>) {
    if (!data) return;

    // 1. Histórico de Reprodução
    if (Array.isArray(data.watchHistory)) {
      localStorage.setItem('popoca_watch_history_v1', JSON.stringify(data.watchHistory));
    }

    // 2. Avaliações
    if (data.ratings && typeof data.ratings === 'object') {
      localStorage.setItem('popoca_letterboxd_ratings_v2', JSON.stringify(data.ratings));
    }

    // 3. Filmes Vistos
    if (Array.isArray(data.watched)) {
      localStorage.setItem('popoca_letterboxd_watched_v2', JSON.stringify(data.watched));
    }

    // 4. Watchlist
    if (Array.isArray(data.watchlist)) {
      localStorage.setItem('popoca_letterboxd_watchlist_v2', JSON.stringify(data.watchlist));
    }

    // 5. Curtidos
    if (Array.isArray(data.liked)) {
      localStorage.setItem('popoca_letterboxd_liked_v2', JSON.stringify(data.liked));
    }

    // 6. Listas Personalizadas
    if (Array.isArray(data.customLists)) {
      localStorage.setItem('popoca_letterboxd_lists_v2', JSON.stringify(data.customLists));
      localStorage.setItem('popoca_custom_lists_v1', JSON.stringify(data.customLists));
    }

    // 7. Perfil
    if (data.profile) {
      localStorage.setItem('popoca_letterboxd_profile_v2', JSON.stringify(data.profile));
      localStorage.setItem('popoca_user_profile_v1', JSON.stringify(data.profile));
    }

    // Dispara evento customizado para os componentes re-renderizarem
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('popoca_storage_synced'));
    }
  }

  /**
   * Agenda sincronização silenciosa em 2 segundos (debounce)
   */
  public triggerAutoSync() {
    if (!this.account.isCloudSyncEnabled) return;
    if (this.syncTimer) clearTimeout(this.syncTimer);

    this.syncTimer = setTimeout(() => {
      this.syncNow().catch((err) => console.warn('[CloudSync] Falha na auto-sincronização:', err));
    }, 2000);
  }

  /**
   * Executa sincronização bidirecional imediata com o servidor
   */
  public async syncNow(): Promise<boolean> {
    if (this.isSyncing) return true;
    this.isSyncing = true;
    this.notifyListeners();

    try {
      const localState = this.getLocalState();
      const res = await fetch(`/api/sync/${encodeURIComponent(this.account.userId)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: this.account.email,
          clientData: localState
        })
      });

      if (!res.ok) {
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

  /**
   * Gera código de pareamento para conectar outro dispositivo (ex: TV, Celular, Tablet)
   */
  public async generatePairCode(): Promise<string> {
    const res = await fetch('/api/sync/pair-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: this.account.userId })
    });
    const json = await res.json();
    if (json.success && json.code) {
      return json.code;
    }
    throw new Error(json.error || 'Não foi possível gerar código de pareamento');
  }

  /**
   * Conecta este aparelho a outro dispositivo através de um código de 6 dígitos
   */
  public async linkDeviceWithPairCode(code: string): Promise<boolean> {
    const res = await fetch('/api/sync/pair-code/redeem', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code: code.trim() })
    });
    const json = await res.json();
    if (json.success && json.data) {
      // Atualiza a conta neste dispositivo
      this.account = {
        userId: json.data.userId,
        email: json.data.email,
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
