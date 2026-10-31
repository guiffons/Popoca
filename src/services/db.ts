/**
 * Popoca Streaming - IndexedDB Persistence Service
 * Camada offline-first de alta performance para armazenamento local de metadados do TMDB,
 * catálogos paginados, detalhes de mídias e cache de buscas, evitando requisições repetidas
 * e proporcionando carregamento instantâneo da UI mesmo offline.
 */

import { MediaItem, Episode } from '../types/index.ts';

const DB_NAME = 'popoca_tmdb_db';
const DB_VERSION = 2;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000; // 24 Horas de validade de cache

class PopocaIndexedDB {
  private dbPromise: Promise<IDBDatabase | null> | null = null;

  private isSupported(): boolean {
    return typeof window !== 'undefined' && 'indexedDB' in window;
  }

  private async getDB(): Promise<IDBDatabase | null> {
    if (!this.isSupported()) return null;
    if (this.dbPromise) return this.dbPromise;

    this.dbPromise = new Promise((resolve) => {
      try {
        const request = window.indexedDB.open(DB_NAME, DB_VERSION);

        request.onupgradeneeded = (event) => {
          const db = (event.target as IDBOpenDBRequest).result;

          // 1. Armazena listas de catálogos (ex: "trending_1", "movies_2", "anime_1")
          if (!db.objectStoreNames.contains('catalogs')) {
            db.createObjectStore('catalogs', { keyPath: 'key' });
          }

          // 2. Armazena detalhes individuais de filmes, séries e animes com temporadas/episódios
          if (!db.objectStoreNames.contains('media_details')) {
            db.createObjectStore('media_details', { keyPath: 'id' });
          }

          // 3. Armazena resultados de busca global
          if (!db.objectStoreNames.contains('search_cache')) {
            db.createObjectStore('search_cache', { keyPath: 'query' });
          }

          // 4. Armazena temporadas e episódios carregados sob demanda (lazy-loading)
          if (!db.objectStoreNames.contains('series_seasons')) {
            db.createObjectStore('series_seasons', { keyPath: 'key' });
          }
        };

        request.onsuccess = () => {
          resolve(request.result);
        };

        request.onerror = (e) => {
          console.warn('[IndexedDB] Erro ao abrir banco de dados local:', e);
          resolve(null);
        };
      } catch (err) {
        console.warn('[IndexedDB] Inicialização indisponível:', err);
        resolve(null);
      }
    });

    return this.dbPromise;
  }

  // --- CATÁLOGOS PAGINADOS ---
  async getCachedCatalog(category: string, page: number = 1): Promise<MediaItem[] | null> {
    try {
      const db = await this.getDB();
      if (!db) return null;

      const key = `${category.toLowerCase()}_${page}`;
      return new Promise((resolve) => {
        const tx = db.transaction('catalogs', 'readonly');
        const store = tx.objectStore('catalogs');
        const req = store.get(key);

        req.onsuccess = () => {
          const record = req.result;
          if (!record) return resolve(null);

          const isExpired = Date.now() - record.timestamp > DEFAULT_TTL_MS;
          if (isExpired) {
            resolve(null);
          } else {
            resolve(record.items || null);
          }
        };

        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  async setCachedCatalog(category: string, page: number = 1, items: MediaItem[]): Promise<void> {
    try {
      const db = await this.getDB();
      if (!db || !items || items.length === 0) return;

      const key = `${category.toLowerCase()}_${page}`;
      const record = {
        key,
        category,
        page,
        items,
        timestamp: Date.now()
      };

      const tx = db.transaction('catalogs', 'readwrite');
      tx.objectStore('catalogs').put(record);
    } catch (e) {
      console.warn('[IndexedDB] Falha ao salvar catálogo em cache:', e);
    }
  }

  // --- DETALHES DE MÍDIA (TEMPORADAS & EPISÓDIOS) ---
  async getCachedDetails(id: number): Promise<MediaItem | null> {
    try {
      const db = await this.getDB();
      if (!db) return null;

      return new Promise((resolve) => {
        const tx = db.transaction('media_details', 'readonly');
        const store = tx.objectStore('media_details');
        const req = store.get(id);

        req.onsuccess = () => {
          const record = req.result;
          if (!record) return resolve(null);

          const isExpired = Date.now() - record.timestamp > DEFAULT_TTL_MS;
          if (isExpired) {
            resolve(null);
          } else {
            resolve(record.details || null);
          }
        };

        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  async setCachedDetails(id: number, type: string, details: MediaItem): Promise<void> {
    try {
      const db = await this.getDB();
      if (!db || !details) return;

      const record = {
        id,
        type,
        details,
        timestamp: Date.now()
      };

      const tx = db.transaction('media_details', 'readwrite');
      tx.objectStore('media_details').put(record);
    } catch (e) {
      console.warn('[IndexedDB] Falha ao salvar detalhes em cache:', e);
    }
  }

  // --- RESULTADOS DE BUSCA ---
  async getCachedSearch(query: string): Promise<MediaItem[] | null> {
    try {
      const db = await this.getDB();
      if (!db) return null;

      const normalized = query.trim().toLowerCase();
      return new Promise((resolve) => {
        const tx = db.transaction('search_cache', 'readonly');
        const store = tx.objectStore('search_cache');
        const req = store.get(normalized);

        req.onsuccess = () => {
          const record = req.result;
          if (!record) return resolve(null);

          const isExpired = Date.now() - record.timestamp > 2 * 60 * 60 * 1000; // 2h de TTL para buscas
          if (isExpired) {
            resolve(null);
          } else {
            resolve(record.results || null);
          }
        };

        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  async setCachedSearch(query: string, results: MediaItem[]): Promise<void> {
    try {
      const db = await this.getDB();
      if (!db || !results || results.length === 0) return;

      const normalized = query.trim().toLowerCase();
      const record = {
        query: normalized,
        results,
        timestamp: Date.now()
      };

      const tx = db.transaction('search_cache', 'readwrite');
      tx.objectStore('search_cache').put(record);
    } catch (e) {
      console.warn('[IndexedDB] Falha ao salvar busca em cache:', e);
    }
  }

  // --- TEMPORADAS E EPISÓDIOS SOB DEMANDA (LAZY-LOADING) ---
  async getCachedSeason(seriesId: number, seasonNumber: number): Promise<Episode[] | null> {
    try {
      const db = await this.getDB();
      if (!db) return null;

      const key = `${seriesId}_s${seasonNumber}`;
      return new Promise((resolve) => {
        const tx = db.transaction('series_seasons', 'readonly');
        const store = tx.objectStore('series_seasons');
        const req = store.get(key);

        req.onsuccess = () => {
          const record = req.result;
          if (!record) return resolve(null);

          const isExpired = Date.now() - record.timestamp > DEFAULT_TTL_MS;
          if (isExpired) {
            resolve(null);
          } else {
            resolve(record.episodes || null);
          }
        };

        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  async setCachedSeason(seriesId: number, seasonNumber: number, episodes: Episode[]): Promise<void> {
    try {
      const db = await this.getDB();
      if (!db || !episodes || episodes.length === 0) return;

      const key = `${seriesId}_s${seasonNumber}`;
      const record = {
        key,
        seriesId,
        seasonNumber,
        episodes,
        timestamp: Date.now()
      };

      const tx = db.transaction('series_seasons', 'readwrite');
      tx.objectStore('series_seasons').put(record);
    } catch (e) {
      console.warn('[IndexedDB] Falha ao salvar temporada em cache:', e);
    }
  }
}

export const idbService = new PopocaIndexedDB();
