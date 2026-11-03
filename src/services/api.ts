/**
 * Popoca Streaming - API Client Service
 * Comunicação de alto desempenho com o backend Node.js,
 * integração offline-first com IndexedDB para metadados TMDB sem requisições repetidas,
 * suporte ao Seletor de Prioridade de Tracker, Re-try de Peers em tempo real e proxy HTTP 206.
 */

import {
  MediaItem,
  TorrentSource,
  Episode,
  TrackerPriorityMode,
  TorrentLiveStats
} from '../types/index.ts';
import { idbService } from './db.ts';

const TRACKER_PRIORITY_STORAGE_KEY = 'popoca_tracker_priority';
const PREFERRED_QUALITY_STORAGE_KEY = 'popoca_preferred_quality';

export const API_BASE = (import.meta.env?.VITE_API_URL || '').replace(/\/+$/, '');

export function apiUrl(path: string): string {
  if (!API_BASE) return path;
  const clean = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE}${clean}`;
}

export type FixedVideoQuality = '720p' | '1080p' | '4K';

export interface SubtitleTrackInfo {
  id: string;
  lang: string;
  label: string;
  release?: string;
}

// Extrai e valida o infoHash de 40 caracteres hexadecimais a partir de magnet URI ou hash
export function extractInfoHash(magnetOrHash: string): string {
  if (!magnetOrHash) return '';

  const hexMatch =
    magnetOrHash.match(/btih:([a-fA-F0-9]{40})/i) || magnetOrHash.match(/([a-fA-F0-9]{40})/i);
  if (hexMatch) {
    return hexMatch[1].toLowerCase();
  }

  const b32Match =
    magnetOrHash.match(/btih:([a-zA-Z2-7]{32})/i) || magnetOrHash.match(/([a-zA-Z2-7]{32})/i);
  if (b32Match) {
    const b32 = b32Match[1].toUpperCase();
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    let bits = '';
    for (let i = 0; i < b32.length; i++) {
      const val = alphabet.indexOf(b32[i]);
      if (val >= 0) bits += val.toString(2).padStart(5, '0');
    }
    let hex = '';
    for (let i = 0; i + 4 <= bits.length; i += 4) {
      hex += parseInt(bits.substr(i, 4), 2).toString(16);
    }
    return hex.toLowerCase().slice(0, 40).padEnd(40, '0');
  }

  return magnetOrHash.replace(/[^a-fA-F0-9]/g, '').slice(0, 40).toLowerCase().padEnd(40, '0');
}

// Formata tamanho em bytes ou texto para apresentação precisa ("1.85 GB", "950 MB")
export function formatFileSize(sizeInput: number | string): string {
  if (typeof sizeInput === 'string' && /GB|MB|GiB|MiB/i.test(sizeInput)) {
    return sizeInput.trim();
  }

  const bytes = typeof sizeInput === 'number' ? sizeInput : parseFloat(sizeInput) || 0;
  if (bytes <= 0) return '1.5 GB';

  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) {
    return `${gb.toFixed(2)} GB`;
  }
  const mb = Math.round(bytes / (1024 * 1024));
  return `${mb} MB`;
}

export const api = {
  extractInfoHash,
  formatFileSize,

  getPreferredQuality(): FixedVideoQuality {
    try {
      const saved = localStorage.getItem(PREFERRED_QUALITY_STORAGE_KEY);
      if (saved === '720p' || saved === '1080p' || saved === '4K') {
        return saved;
      }
    } catch {}
    return '1080p';
  },

  setPreferredQuality(quality: FixedVideoQuality): void {
    try {
      localStorage.setItem(PREFERRED_QUALITY_STORAGE_KEY, quality);
    } catch {}
  },

  /**
   * Seleciona a melhor fonte P2P respeitando estritamente:
   * 1. Prioridade absoluta de áudio em Português (PT-BR Dublado/Dual) por padrão
   * 2. Qualidade fixa escolhida pelo usuário (Padrão: 1080p, ou 720p / 4K)
   * 3. Separação rígida entre PT-BR e Original (só usa Original se não houver nenhuma fonte PT-BR ativa)
   */
  pickBestTorrentSource(
    sources: TorrentSource[],
    options: {
      preferredQuality?: FixedVideoQuality | 'all';
      preferPortuguese?: boolean;
    } = {}
  ): TorrentSource | undefined {
    if (!sources || sources.length === 0) return undefined;

    const targetQuality =
      options.preferredQuality && options.preferredQuality !== 'all'
        ? options.preferredQuality
        : api.getPreferredQuality();
    const preferPt = options.preferPortuguese !== false;

    const sortByStability = (list: TorrentSource[]) =>
      [...list].sort(
        (a, b) => (b.stabilityScore ?? b.seeds) - (a.stabilityScore ?? a.seeds) || b.seeds - a.seeds
      );

    const pickFromLanguagePool = (pool: TorrentSource[]): TorrentSource | undefined => {
      if (pool.length === 0) return undefined;
      const exactQualityHealthy = sortByStability(
        pool.filter((s) => s.quality === targetQuality && s.seeds >= 2)
      );
      if (exactQualityHealthy.length > 0) return exactQualityHealthy[0];

      // Se a qualidade pedida não tiver >= 2 seeds nesse idioma, tenta 1080p -> 720p -> 4K dentro do MESMO idioma!
      for (const fallbackQ of ['1080p', '720p', '4K'] as const) {
        const qMatches = sortByStability(
          pool.filter((s) => s.quality === fallbackQ && s.seeds >= 2)
        );
        if (qMatches.length > 0) return qMatches[0];
      }

      const anySeed = sortByStability(pool.filter((s) => s.seeds >= 1));
      return anySeed[0] || sortByStability(pool)[0];
    };

    const ptPool = sources.filter((s) => s.isPortugueseAudio);
    const origPool = sources.filter((s) => !s.isPortugueseAudio);

    if (preferPt) {
      return pickFromLanguagePool(ptPool) || pickFromLanguagePool(origPool);
    }
    return pickFromLanguagePool(origPool) || pickFromLanguagePool(ptPool);
  },

  getSavedTrackerPriority(): TrackerPriorityMode {
    try {
      const saved = localStorage.getItem(TRACKER_PRIORITY_STORAGE_KEY);
      if (saved === 'pt-br-stability' || saved === 'ultra-speed' || saved === 'global-balanced') {
        return saved;
      }
    } catch {}
    return 'pt-br-stability';
  },

  async setTrackerPriority(
    mode: TrackerPriorityMode,
    magnetUri?: string
  ): Promise<TrackerPriorityMode> {
    try {
      localStorage.setItem(TRACKER_PRIORITY_STORAGE_KEY, mode);
    } catch {}
    try {
      await fetch(apiUrl('/api/torrent/tracker-priority'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ trackerPriority: mode, magnet: magnetUri })
      });
    } catch {}
    return mode;
  },

  async retryTorrentPeers(
    magnetUri: string,
    trackerPriority?: TrackerPriorityMode
  ): Promise<{ success: boolean; stats: TorrentLiveStats | null }> {
    if (!magnetUri) return { success: false, stats: null };
    try {
      const res = await fetch(apiUrl('/api/torrent/retry'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          magnet: magnetUri,
          trackerPriority: trackerPriority || api.getSavedTrackerPriority()
        })
      });
      if (!res.ok) return { success: false, stats: null };
      const data = await res.json();
      return {
        success: Boolean(data.success),
        stats: data.stats || null
      };
    } catch {
      return { success: false, stats: null };
    }
  },

  async getCatalog(category: string = 'trending', page: number = 1): Promise<MediaItem[]> {
    try {
      const cached = await idbService.getCachedCatalog(category, page);
      if (cached && cached.length > 0) {
        fetch(apiUrl(`/api/catalog?category=${category}&page=${page}`))
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (data?.items?.length) {
              idbService.setCachedCatalog(category, page, data.items);
            }
          })
          .catch(() => {});
        return cached;
      }
    } catch {}

    try {
      const res = await fetch(apiUrl(`/api/catalog?category=${category}&page=${page}`));
      if (!res.ok) return [];
      const data = await res.json();
      const items = data.items || [];

      if (items.length > 0) {
        idbService.setCachedCatalog(category, page, items);
      }
      return items;
    } catch (err) {
      console.warn(`[API] Erro ao carregar catálogo ${category}:`, err);
      return [];
    }
  },

  async search(query: string): Promise<MediaItem[]> {
    if (!query.trim()) return [];

    try {
      const cached = await idbService.getCachedSearch(query);
      if (cached && cached.length > 0) {
        return cached;
      }
    } catch {}

    try {
      const res = await fetch(apiUrl(`/api/search?q=${encodeURIComponent(query)}`));
      if (!res.ok) return [];
      const data = await res.json();
      const results = data.results || [];

      if (results.length > 0) {
        idbService.setCachedSearch(query, results);
      }
      return results;
    } catch {
      return [];
    }
  },

  async getSuggestions(query: string): Promise<any[]> {
    if (!query.trim()) return [];
    try {
      const res = await fetch(apiUrl(`/api/search/suggestions?q=${encodeURIComponent(query)}`));
      if (!res.ok) return [];
      const data = await res.json();
      return data.suggestions || [];
    } catch {
      return [];
    }
  },

  async getDetails(id: number, type: 'movie' | 'tv' | 'anime' = 'movie'): Promise<MediaItem> {
    try {
      const cached = await idbService.getCachedDetails(id);
      if (cached && ((type !== 'tv' && type !== 'anime') || (cached.seasons && cached.seasons.length > 0))) {
        return cached;
      }
    } catch {}

    const res = await fetch(apiUrl(`/api/details/${id}?type=${type}`));
    if (!res.ok) throw new Error('Falha ao obter detalhes');
    const data = await res.json();
    const details = data.details;

    if (details) {
      idbService.setCachedDetails(id, type, details);
    }
    return details;
  },

  async getSeason(seriesId: number, seasonNumber: number): Promise<Episode[]> {
    try {
      const cached = await idbService.getCachedSeason(seriesId, seasonNumber);
      if (cached && cached.length > 0) {
        return cached;
      }
    } catch {}

    try {
      const res = await fetch(apiUrl(`/api/series/${seriesId}/season/${seasonNumber}`));
      if (!res.ok) throw new Error('Falha ao carregar temporada');
      const data = await res.json();
      const episodes: Episode[] = data.episodes || [];

      if (episodes.length > 0) {
        idbService.setCachedSeason(seriesId, seasonNumber, episodes);
      }
      return episodes;
    } catch (err) {
      console.warn(`[API] Erro ao carregar episódios da temporada ${seasonNumber}:`, err);
      return [];
    }
  },

  torrentsClientCache: new Map<string, { at: number; data: TorrentSource[] }>(),
  torrentsInflight: new Map<string, Promise<TorrentSource[]>>(),

  async getTorrents(
    title: string,
    options?:
      | {
          originalTitle?: string;
          year?: string;
          imdbId?: string;
          mediaType?: 'movie' | 'tv' | 'anime';
          season?: number;
          episode?: number;
          trackerPriority?: TrackerPriorityMode;
        }
      | string
  ): Promise<TorrentSource[]> {
    const year = typeof options === 'string' ? options : options?.year;
    const originalTitle = typeof options === 'object' ? options?.originalTitle : undefined;
    const imdbId = typeof options === 'object' ? options?.imdbId : undefined;
    const mediaType = typeof options === 'object' ? options?.mediaType : undefined;
    const season = typeof options === 'object' ? options?.season : undefined;
    const episode = typeof options === 'object' ? options?.episode : undefined;
    const trackerPriority =
      (typeof options === 'object' ? options?.trackerPriority : undefined) ||
      api.getSavedTrackerPriority();

    const cacheKey = `${imdbId || ''}|${title}|${year || ''}|${mediaType || ''}|${season ?? ''}|${episode ?? ''}|${trackerPriority}`;
    const cached = this.torrentsClientCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 15 * 60 * 1000) {
      return cached.data;
    }
    const inflight = this.torrentsInflight.get(cacheKey);
    if (inflight) return inflight;

    const fetchPromise = (async () => {
      try {
        const params = new URLSearchParams({ title, trackerPriority });
        if (originalTitle) params.set('originalTitle', originalTitle);
        if (year) params.set('year', year);
        if (imdbId) params.set('imdbId', imdbId);
        if (mediaType) params.set('mediaType', mediaType);
        if (typeof season === 'number') params.set('season', season.toString());
        if (typeof episode === 'number') params.set('episode', episode.toString());

        const res = await fetch(apiUrl(`/api/torrents?${params.toString()}`));
        if (!res.ok) throw new Error('Falha ao obter fontes de torrent');
        const data = await res.json();
        const rawTorrents: any[] = data.torrents || [];

        const parsed = rawTorrents.map((t, idx) => {
          const infoHash = extractInfoHash(t.infoHash || t.magnetUri || `stream_${idx}`);
          const sizeFormatted = t.sizeFormatted || formatFileSize(t.sizeBytes || 2000000000);
          const quality = t.quality || '1080p';
          const format = t.format || (/bluray|blu-ray/i.test(t.title || '') ? 'Bluray' : 'WEB-DL');

          return {
            id: t.id || `torrent-${infoHash.slice(0, 8)}`,
            title: t.title || title,
            magnetUri:
              t.magnetUri ||
              `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(t.title || title)}`,
            infoHash,
            quality,
            format,
            seeds: typeof t.seeds === 'number' ? t.seeds : 50,
            peers: typeof t.peers === 'number' ? t.peers : 12,
            sizeBytes: t.sizeBytes || 1800000000,
            sizeFormatted,
            isPortugueseAudio: Boolean(t.isPortugueseAudio),
            source: t.source || 'P2P Indexer',
            stabilityScore: typeof t.stabilityScore === 'number' ? t.stabilityScore : t.seeds || 50,
            trackerPriority: t.trackerPriority || trackerPriority,
            directUrl: t.directUrl,
            fileIdx: typeof t.fileIdx === 'number' ? t.fileIdx : undefined
          };
        });

        if (parsed.length > 0) {
          if (this.torrentsClientCache.size >= 300) {
            const first = this.torrentsClientCache.keys().next().value;
            if (first !== undefined) this.torrentsClientCache.delete(first);
          }
          this.torrentsClientCache.set(cacheKey, { at: Date.now(), data: parsed });
        }
        return parsed;
      } finally {
        this.torrentsInflight.delete(cacheKey);
      }
    })();

    this.torrentsInflight.set(cacheKey, fetchPromise);
    return fetchPromise;
  },

  async getTorrentStats(magnetUriOrHash: string): Promise<TorrentLiveStats | null> {
    if (!magnetUriOrHash) return null;
    try {
      const isPureHash = /^[a-fA-F0-9]{40}$/.test(magnetUriOrHash.trim());
      const endpoint = isPureHash
        ? `/api/torrent/stats/${magnetUriOrHash.trim()}`
        : `/api/torrent/stats?magnet=${encodeURIComponent(magnetUriOrHash)}`;
      const res = await fetch(apiUrl(endpoint));
      if (!res.ok) return null;
      const data = await res.json();
      return data.stats || null;
    } catch {
      return null;
    }
  },

  async uploadTorrentFile(
    base64Data: string,
    fileName?: string
  ): Promise<{ success: boolean; infoHash?: string; name?: string; magnetUri?: string; error?: string }> {
    try {
      const res = await fetch(apiUrl('/api/torrent/upload'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ torrentData: base64Data, fileName })
      });
      const data = await res.json();
      return data;
    } catch (err: any) {
      return { success: false, error: err?.message || 'Erro de rede ao enviar torrent.' };
    }
  },

  getStreamUrl(
    magnetUri: string,
    options: {
      transcode?: boolean;
      audioOnly?: boolean;
      altMagnets?: string[];
      trackerPriority?: TrackerPriorityMode;
      streamKey?: string;
      seekSeconds?: number;
      preferPortugueseAudio?: boolean;
      audioTrackIndex?: number;
      season?: number;
      episode?: number;
      fileIdx?: number;
    } = {}
  ): string {
    const params = new URLSearchParams({
      magnet: magnetUri,
      trackerPriority: options.trackerPriority || api.getSavedTrackerPriority()
    });
    if (options.streamKey) params.set('_sk', options.streamKey);
    if (options.transcode) params.set('transcode', 'true');
    if (options.audioOnly) params.set('audioOnly', 'true');
    if (typeof options.season === 'number') params.set('season', String(options.season));
    if (typeof options.episode === 'number') params.set('episode', String(options.episode));
    if (typeof options.fileIdx === 'number') params.set('fileIdx', String(options.fileIdx));
    params.set('preferPt', options.preferPortugueseAudio === false ? 'false' : 'true');
    if (typeof options.seekSeconds === 'number' && options.seekSeconds > 1) {
      params.set('seek', options.seekSeconds.toFixed(1));
    }
    if (typeof options.audioTrackIndex === 'number' && options.audioTrackIndex >= 0) {
      params.set('audioTrack', String(options.audioTrackIndex));
    }
    if (options.altMagnets && options.altMagnets.length > 0) {
      params.set('altMagnets', JSON.stringify(options.altMagnets.slice(0, 3)));
    }
    return apiUrl(`/api/stream?${params.toString()}`);
  },

  getStreamByTmdbIdUrl(
    tmdbId: number,
    options: {
      mediaType?: 'movie' | 'tv' | 'anime';
      season?: number;
      episode?: number;
      quality?: string;
      trackerPriority?: TrackerPriorityMode;
      streamKey?: string;
      transcode?: boolean;
      audioOnly?: boolean;
      seekSeconds?: number;
      preferPortugueseAudio?: boolean;
      audioTrackIndex?: number;
    } = {}
  ): string {
    const params = new URLSearchParams();
    if (options.mediaType) params.set('mediaType', options.mediaType);
    if (typeof options.season === 'number') params.set('season', options.season.toString());
    if (typeof options.episode === 'number') params.set('episode', options.episode.toString());
    if (options.quality) params.set('quality', options.quality);
    params.set('trackerPriority', options.trackerPriority || api.getSavedTrackerPriority());
    if (options.streamKey) params.set('_sk', options.streamKey);
    if (options.transcode) params.set('transcode', 'true');
    if (options.audioOnly) params.set('audioOnly', 'true');
    params.set('preferPt', options.preferPortugueseAudio === false ? 'false' : 'true');
    if (typeof options.seekSeconds === 'number' && options.seekSeconds > 1) {
      params.set('seek', options.seekSeconds.toFixed(1));
    }
    if (typeof options.audioTrackIndex === 'number' && options.audioTrackIndex >= 0) {
      params.set('audioTrack', String(options.audioTrackIndex));
    }
    const qs = params.toString();
    return apiUrl(`/api/stream/${tmdbId}${qs ? `?${qs}` : ''}`);
  },

  getVideoStreamProxyUrl(videoUrl: string): string {
    return apiUrl(`/api/stream-video?url=${encodeURIComponent(videoUrl)}`);
  },

  async getSubtitleTracks(options: {
    imdbId?: string;
    mediaType: 'movie' | 'tv' | 'anime';
    season?: number;
    episode?: number;
    fileName?: string;
  }): Promise<SubtitleTrackInfo[]> {
    if (!options.imdbId) return [];
    try {
      const params = new URLSearchParams({ imdbId: options.imdbId, mediaType: options.mediaType });
      if (typeof options.season === 'number') params.set('season', String(options.season));
      if (typeof options.episode === 'number') params.set('episode', String(options.episode));
      if (options.fileName) params.set('fileName', options.fileName);
      const res = await fetch(apiUrl(`/api/subtitles/list?${params.toString()}`));
      if (!res.ok) return [];
      const data = await res.json();
      return Array.isArray(data?.tracks) ? data.tracks : [];
    } catch {
      return [];
    }
  },

  getSubtitleVttUrl(trackId: string): string {
    return apiUrl(`/api/subtitles/vtt?id=${encodeURIComponent(trackId)}`);
  },

  preloadTorrent(magnetUri: string, trackerPriority?: TrackerPriorityMode): void {
    if (!magnetUri) return;
    const mode = trackerPriority || api.getSavedTrackerPriority();
    fetch(
      apiUrl(`/api/torrent/preload?magnet=${encodeURIComponent(magnetUri)}&trackerPriority=${encodeURIComponent(mode)}`)
    ).catch(() => {});
  },

  async prefetchNextChunks(
    magnetUri: string,
    currentTime: number,
    duration: number,
    speed?: number
  ): Promise<any> {
    if (!magnetUri) return null;
    try {
      const params = new URLSearchParams({
        magnet: magnetUri,
        currentTime: currentTime.toString(),
        duration: duration.toString()
      });
      if (typeof speed === 'number') params.set('speed', speed.toString());
      const res = await fetch(apiUrl(`/api/torrent/prefetch?${params.toString()}`));
      if (!res.ok) return null;
      return await res.json();
    } catch {
      return null;
    }
  },

  async getNetworkInfo(): Promise<{ lanIp: string; port: number; lanOrigin: string }> {
    try {
      const res = await fetch(apiUrl('/api/network-info'));
      if (res.ok) {
        const data = await res.json();
        if (data?.lanOrigin) {
          return {
            lanIp: data.lanIp || '127.0.0.1',
            port: data.port || 3000,
            lanOrigin: data.lanOrigin
          };
        }
      }
    } catch {}
    const fallbackOrigin =
      typeof window !== 'undefined' && window.location?.origin
        ? window.location.origin
        : 'http://localhost:3000';
    return {
      lanIp: '127.0.0.1',
      port: 3000,
      lanOrigin: fallbackOrigin
    };
  }
};
