/**
 * Popoca Streaming - Temporary Session Video Chunk Cache (IndexedDB)
 * Armazena em IndexedDB os chunks de vídeo (blocos alinhados de 2MB) baixados durante a sessão atual:
 * 1. Permite avanço e retrocesso (seek) instantâneos (< 2ms via Service Worker + IDB) sem redownload do stream P2P
 * 2. Pré-carrega proativamente chunks adjacentes à agulha de reprodução direto para o IndexedDB
 * 3. Expõe API reativa de segmentos em cache (verde) vs pendentes de download (cinza) para a barra de progresso do VideoPlayer
 * 4. Limpa automaticamente chunks de sessões anteriores para manter o armazenamento leve e temporário
 */

import { CachedBufferSegment, StreamCacheSnapshot } from '../types/index.ts';

export const VIDEO_CHUNK_DB_NAME = 'popoca_video_chunks_session_db';
export const VIDEO_CHUNK_DB_VERSION = 1;
export const VIDEO_CHUNK_SIZE = 2 * 1024 * 1024; // 2 MB por chunk alinhado
const MAX_SESSION_CHUNKS = 180; // ~360 MB teto seguro por sessão
const SESSION_STORAGE_KEY = 'popoca_active_video_session_id';
const BROADCAST_CHANNEL_NAME = 'popoca_idb_chunks';

export interface CachedVideoChunkRecord {
  key: string;
  streamKey: string;
  chunkIndex: number;
  startByte: number;
  endByte: number;
  totalBytes: number;
  sizeBytes: number;
  contentType: string;
  data: ArrayBuffer;
  sessionId: string;
  updatedAt: number;
}

interface ManifestChunkMeta {
  startByte: number;
  endByte: number;
  sizeBytes: number;
}

interface StreamManifestRecord {
  streamKey: string;
  totalBytes: number;
  chunkSize: number;
  cachedMeta: Record<number, ManifestChunkMeta>;
  sessionId: string;
  updatedAt: number;
}

class VideoChunkCacheService {
  private dbPromise: Promise<IDBDatabase | null> | null = null;
  private sessionId: string = 'default-session';
  private listeners: Map<string, Set<() => void>> = new Map();
  private broadcastChannel: BroadcastChannel | null = null;
  private inFlightPrefetches: Set<string> = new Set();

  constructor() {
    if (typeof window !== 'undefined') {
      try {
        let existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
        if (!existing) {
          existing = `sess_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
          window.sessionStorage.setItem(SESSION_STORAGE_KEY, existing);
        }
        this.sessionId = existing;
      } catch {
        this.sessionId = `sess_${Date.now()}`;
      }

      if ('BroadcastChannel' in window) {
        try {
          this.broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL_NAME);
          this.broadcastChannel.onmessage = (event) => {
            const sk = event.data?.streamKey;
            if (sk) {
              this.notifyListeners(sk);
            }
          };
        } catch {
          this.broadcastChannel = null;
        }
      }
    }
  }

  getSessionId(): string {
    return this.sessionId;
  }

  private isSupported(): boolean {
    return typeof window !== 'undefined' && 'indexedDB' in window;
  }

  async getDB(): Promise<IDBDatabase | null> {
    if (!this.isSupported()) return null;
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve) => {
      try {
        const req = window.indexedDB.open(VIDEO_CHUNK_DB_NAME, VIDEO_CHUNK_DB_VERSION);

        req.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;
          if (!db.objectStoreNames.contains('chunks')) {
            const chunkStore = db.createObjectStore('chunks', { keyPath: 'key' });
            chunkStore.createIndex('by_stream', 'streamKey', { unique: false });
          }
          if (!db.objectStoreNames.contains('manifests')) {
            db.createObjectStore('manifests', { keyPath: 'streamKey' });
          }
        };

        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });

    return this.dbPromise;
  }

  /**
   * Inicializa a sessão atual limpando resíduos temporários de abas/sessões passadas
   */
  async initSession(): Promise<void> {
    const db = await this.getDB();
    if (!db) return;

    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(['chunks', 'manifests'], 'readwrite');
        const chunkStore = tx.objectStore('chunks');
        const manifestStore = tx.objectStore('manifests');

        const cursorReq = chunkStore.openCursor();
        cursorReq.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (cursor) {
            const val = cursor.value as CachedVideoChunkRecord;
            if (val.sessionId && val.sessionId !== this.sessionId) {
              cursor.delete();
            }
            cursor.continue();
          }
        };

        const manCursorReq = manifestStore.openCursor();
        manCursorReq.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (cursor) {
            const val = cursor.value as StreamManifestRecord;
            if (val.sessionId && val.sessionId !== this.sessionId) {
              cursor.delete();
            }
            cursor.continue();
          }
        };

        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {
      // silencioso
    }
  }

  /**
   * Gera identificador determinístico do stream para indexação dos chunks na sessão
   */
  buildStreamKey(
    magnetOrUrl: string,
    mediaId?: number,
    season?: number,
    episode?: number
  ): string {
    const hashMatch = (magnetOrUrl || '').match(/btih:([a-fA-F0-9]{40})/i) || (magnetOrUrl || '').match(/([a-fA-F0-9]{40})/i);
    if (hashMatch) {
      const epSuffix = typeof season === 'number' && typeof episode === 'number' ? `_s${season}e${episode}` : '';
      return `btih_${hashMatch[1].toLowerCase()}${epSuffix}`;
    }
    if (mediaId) {
      const epSuffix = typeof season === 'number' && typeof episode === 'number' ? `_s${season}e${episode}` : '';
      return `tmdb_${mediaId}${epSuffix}`;
    }
    return `url_${btoa(unescape(encodeURIComponent(magnetOrUrl || 'stream'))).replace(/[^a-zA-Z0-9]/g, '').slice(0, 32)}`;
  }

  subscribe(streamKey: string, listener: () => void): () => void {
    if (!this.listeners.has(streamKey)) {
      this.listeners.set(streamKey, new Set());
    }
    this.listeners.get(streamKey)!.add(listener);

    return () => {
      const set = this.listeners.get(streamKey);
      if (set) {
        set.delete(listener);
        if (set.size === 0) this.listeners.delete(streamKey);
      }
    };
  }

  private notifyListeners(streamKey: string) {
    const set = this.listeners.get(streamKey);
    if (set) {
      set.forEach((cb) => {
        try {
          cb();
        } catch {}
      });
    }
  }

  /**
   * Salva um chunk binário baixado no IndexedDB e atualiza o manifesto de segmentos
   */
  async saveChunk(
    streamKey: string,
    chunkIndex: number,
    startByte: number,
    endByte: number,
    totalBytes: number,
    data: ArrayBuffer,
    contentType = 'video/mp4'
  ): Promise<void> {
    const db = await this.getDB();
    if (!db || !data || data.byteLength === 0) return;

    try {
      await this.enforceQuotaIfNeeded(db, chunkIndex);

      await new Promise<void>((resolve) => {
        const tx = db.transaction(['chunks', 'manifests'], 'readwrite');
        const chunkStore = tx.objectStore('chunks');
        const manifestStore = tx.objectStore('manifests');

        const key = `${streamKey}_${chunkIndex}`;
        const chunkRecord: CachedVideoChunkRecord = {
          key,
          streamKey,
          chunkIndex,
          startByte,
          endByte,
          totalBytes,
          sizeBytes: data.byteLength,
          contentType,
          data,
          sessionId: this.sessionId,
          updatedAt: Date.now()
        };
        chunkStore.put(chunkRecord);

        const getMan = manifestStore.get(streamKey);
        getMan.onsuccess = () => {
          const existing = getMan.result as StreamManifestRecord | undefined;
          const cachedMeta = existing?.cachedMeta ? { ...existing.cachedMeta } : {};
          cachedMeta[chunkIndex] = {
            startByte,
            endByte,
            sizeBytes: data.byteLength
          };
          const updatedManifest: StreamManifestRecord = {
            streamKey,
            totalBytes: Math.max(totalBytes, existing?.totalBytes || 0),
            chunkSize: VIDEO_CHUNK_SIZE,
            cachedMeta,
            sessionId: this.sessionId,
            updatedAt: Date.now()
          };
          manifestStore.put(updatedManifest);
        };

        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });

      this.notifyListeners(streamKey);
      this.broadcastChannel?.postMessage({ streamKey, chunkIndex });
    } catch {
      // ignora QuotaExceededError para nunca interromper reprodução
    }
  }

  /**
   * Registra no manifesto intervalos já carregados pelo buffer nativo quando o SW ainda está assumindo controle
   */
  async syncNativeBufferedRanges(
    streamKey: string,
    ranges: Array<{ startSec: number; endSec: number }>,
    durationSec: number,
    estimatedTotalBytes: number
  ): Promise<void> {
    if (!ranges.length || durationSec <= 0 || estimatedTotalBytes <= 0) return;
    const db = await this.getDB();
    if (!db) return;

    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction('manifests', 'readwrite');
        const store = tx.objectStore('manifests');
        const req = store.get(streamKey);

        req.onsuccess = () => {
          const existing = req.result as StreamManifestRecord | undefined;
          const total = existing?.totalBytes && existing.totalBytes > 0 ? existing.totalBytes : estimatedTotalBytes;
          const cachedMeta: Record<number, ManifestChunkMeta> = existing?.cachedMeta ? { ...existing.cachedMeta } : {};

          for (const r of ranges) {
            const sByte = Math.max(0, Math.floor((r.startSec / durationSec) * total));
            const eByte = Math.min(total - 1, Math.floor((r.endSec / durationSec) * total));
            if (eByte <= sByte) continue;

            const firstChunk = Math.floor(sByte / VIDEO_CHUNK_SIZE);
            const lastChunk = Math.floor(eByte / VIDEO_CHUNK_SIZE);
            for (let idx = firstChunk; idx <= lastChunk; idx++) {
              if (!cachedMeta[idx]) {
                const cs = idx * VIDEO_CHUNK_SIZE;
                const ce = Math.min(total - 1, cs + VIDEO_CHUNK_SIZE - 1);
                cachedMeta[idx] = {
                  startByte: Math.max(cs, sByte),
                  endByte: Math.min(ce, eByte),
                  sizeBytes: Math.max(0, Math.min(ce, eByte) - Math.max(cs, sByte) + 1)
                };
              }
            }
          }

          store.put({
            streamKey,
            totalBytes: total,
            chunkSize: VIDEO_CHUNK_SIZE,
            cachedMeta,
            sessionId: this.sessionId,
            updatedAt: Date.now()
          } satisfies StreamManifestRecord);
        };

        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    } catch {}
  }

  private async enforceQuotaIfNeeded(db: IDBDatabase, protectedChunkIndex: number): Promise<void> {
    return new Promise((resolve) => {
      try {
        const tx = db.transaction('chunks', 'readwrite');
        const store = tx.objectStore('chunks');
        const countReq = store.count();

        countReq.onsuccess = () => {
          if (countReq.result < MAX_SESSION_CHUNKS) {
            resolve();
            return;
          }

          // Evicta os 12 chunks mais antigos que não sejam o cabeçalho (chunk 0) nem vizinhos imediatos
          const items: Array<{ key: string; chunkIndex: number; updatedAt: number }> = [];
          const cursorReq = store.openCursor();
          cursorReq.onsuccess = (e) => {
            const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
            if (cursor) {
              const v = cursor.value as CachedVideoChunkRecord;
              if (v.chunkIndex !== 0 && Math.abs(v.chunkIndex - protectedChunkIndex) > 6) {
                items.push({ key: v.key, chunkIndex: v.chunkIndex, updatedAt: v.updatedAt });
              }
              cursor.continue();
            } else {
              items.sort((a, b) => a.updatedAt - b.updatedAt);
              items.slice(0, 12).forEach((victim) => store.delete(victim.key));
            }
          };
        };

        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
  }

  async hasChunk(streamKey: string, chunkIndex: number): Promise<boolean> {
    const db = await this.getDB();
    if (!db) return false;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction('chunks', 'readonly');
        const req = tx.objectStore('chunks').count(`${streamKey}_${chunkIndex}`);
        req.onsuccess = () => resolve(req.result > 0);
        req.onerror = () => resolve(false);
      } catch {
        resolve(false);
      }
    });
  }

  /**
   * Pré-carrega proativamente o chunk atual e os próximos `aheadCount` chunks direto no IndexedDB
   * para garantir seek instantâneo e buffer verde contínuo sem engasgos
   */
  async prefetchChunksToIndexedDB(
    streamUrl: string,
    streamKey: string,
    currentTimeSec: number,
    durationSec: number,
    fallbackTotalBytes: number,
    aheadCount = 2
  ): Promise<{ newlyCached: number; totalBytes: number }> {
    if (!streamUrl || streamUrl.includes('transcode=true') || streamUrl.includes('audioOnly=true')) {
      return { newlyCached: 0, totalBytes: fallbackTotalBytes };
    }

    const snap = await this.getStreamCacheSnapshot(streamKey, fallbackTotalBytes);
    const knownTotal = snap.totalBytes > 0 ? snap.totalBytes : fallbackTotalBytes;
    if (!knownTotal || knownTotal <= 0 || durationSec <= 0) {
      return { newlyCached: 0, totalBytes: knownTotal || 0 };
    }

    const approxBytePos = Math.max(0, Math.min(knownTotal - 1, Math.floor((currentTimeSec / durationSec) * knownTotal)));
    const baseChunkIdx = Math.floor(approxBytePos / VIDEO_CHUNK_SIZE);
    const maxChunkIdx = Math.floor((knownTotal - 1) / VIDEO_CHUNK_SIZE);

    let newlyCached = 0;
    let discoveredTotal = knownTotal;

    for (let offset = 1; offset <= aheadCount; offset++) {
      const targetIdx = baseChunkIdx + offset;
      if (targetIdx > maxChunkIdx) break;

      const lockKey = `${streamKey}_${targetIdx}`;
      if (this.inFlightPrefetches.has(lockKey)) continue;

      const alreadyInIdb = await this.hasChunk(streamKey, targetIdx);
      if (alreadyInIdb) continue;

      this.inFlightPrefetches.add(lockKey);
      try {
        const chunkStart = targetIdx * VIDEO_CHUNK_SIZE;
        const chunkEnd = Math.min(discoveredTotal - 1, chunkStart + VIDEO_CHUNK_SIZE - 1);
        if (chunkEnd <= chunkStart) continue;

        const res = await fetch(streamUrl, {
          headers: {
            Range: `bytes=${chunkStart}-${chunkEnd}`,
            'X-Popoca-Bypass-SW': '1'
          },
          signal: AbortSignal.timeout(9000)
        });

        if (res.status === 206) {
          const contentRange = res.headers.get('Content-Range') || '';
          const crMatch = contentRange.match(/bytes\s+(\d+)-(\d+)\/(\d+)/i);
          if (crMatch) {
            const actualStart = parseInt(crMatch[1], 10);
            const actualEnd = parseInt(crMatch[2], 10);
            discoveredTotal = parseInt(crMatch[3], 10) || discoveredTotal;
            const ab = await res.arrayBuffer();
            if (ab.byteLength > 0) {
              await this.saveChunk(
                streamKey,
                targetIdx,
                actualStart,
                actualEnd,
                discoveredTotal,
                ab,
                res.headers.get('Content-Type') || 'video/mp4'
              );
              newlyCached++;
            }
          }
        }
      } catch {
        // silencioso se ocupado
      } finally {
        this.inFlightPrefetches.delete(lockKey);
      }
    }

    return { newlyCached, totalBytes: discoveredTotal };
  }

  /**
   * Consulta a API do cache IndexedDB e retorna os segmentos contínuos já pré-carregados (para renderização em verde)
   * versus o restante pendente (em cinza) na barra de progresso do VideoPlayer
   */
  async getStreamCacheSnapshot(
    streamKey: string,
    fallbackTotalBytes = 0
  ): Promise<StreamCacheSnapshot> {
    const empty: StreamCacheSnapshot = {
      streamKey,
      segments: [],
      cachedBytes: 0,
      cachedChunksCount: 0,
      totalBytes: fallbackTotalBytes,
      cachedPercent: 0
    };

    const db = await this.getDB();
    if (!db || !streamKey) return empty;

    return new Promise((resolve) => {
      try {
        const tx = db.transaction('manifests', 'readonly');
        const req = tx.objectStore('manifests').get(streamKey);

        req.onsuccess = () => {
          const manifest = req.result as StreamManifestRecord | undefined;
          if (!manifest || !manifest.cachedMeta) {
            resolve(empty);
            return;
          }

          const totalBytes = manifest.totalBytes > 0 ? manifest.totalBytes : fallbackTotalBytes;
          if (totalBytes <= 0) {
            resolve(empty);
            return;
          }

          const entries = Object.values(manifest.cachedMeta)
            .filter((m) => m && m.endByte >= m.startByte)
            .sort((a, b) => a.startByte - b.startByte);

          if (entries.length === 0) {
            resolve({ ...empty, totalBytes });
            return;
          }

          // Mescla chunks adjacentes em segmentos visuais contínuos
          const merged: Array<{ startByte: number; endByte: number }> = [];
          let cachedBytes = 0;

          for (const entry of entries) {
            cachedBytes += entry.sizeBytes || (entry.endByte - entry.startByte + 1);
            const last = merged[merged.length - 1];
            if (last && entry.startByte <= last.endByte + 4096) {
              last.endByte = Math.max(last.endByte, entry.endByte);
            } else {
              merged.push({ startByte: entry.startByte, endByte: entry.endByte });
            }
          }

          const segments: CachedBufferSegment[] = merged.map((seg) => ({
            startByte: seg.startByte,
            endByte: seg.endByte,
            startPercent: Math.max(0, Math.min(100, (seg.startByte / totalBytes) * 100)),
            endPercent: Math.max(0, Math.min(100, ((seg.endByte + 1) / totalBytes) * 100))
          }));

          const cachedPercent = Math.min(100, Math.round((cachedBytes / totalBytes) * 100));

          resolve({
            streamKey,
            segments,
            cachedBytes,
            cachedChunksCount: entries.length,
            totalBytes,
            cachedPercent
          });
        };

        req.onerror = () => resolve(empty);
      } catch {
        resolve(empty);
      }
    });
  }

  async clearStreamCache(streamKey: string): Promise<void> {
    const db = await this.getDB();
    if (!db) return;

    await new Promise<void>((resolve) => {
      try {
        const tx = db.transaction(['chunks', 'manifests'], 'readwrite');
        const chunkStore = tx.objectStore('chunks');
        const idx = chunkStore.index('by_stream');
        const cursorReq = idx.openCursor(IDBKeyRange.only(streamKey));

        cursorReq.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (cursor) {
            cursor.delete();
            cursor.continue();
          }
        };

        tx.objectStore('manifests').delete(streamKey);
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      } catch {
        resolve();
      }
    });
    this.notifyListeners(streamKey);
  }
}

export const videoChunkCache = new VideoChunkCacheService();

