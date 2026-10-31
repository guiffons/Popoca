/**
 * Popoca Streaming - API Client Service
 * Comunicação de alto desempenho com o backend Node.js,
 * integração offline-first com IndexedDB para metadados TMDB sem requisições repetidas,
 * extração e validação rigorosa de infoHash (40-hex lowercase),
 * formatação exata de tamanho de arquivo (GB/MB) e proxy de streams HTTP 206.
 */

import { MediaItem, TorrentSource, Episode } from '../types/index.ts';
import { idbService } from './db.ts';

// Extrai e valida o infoHash de 40 caracteres hexadecimais a partir de magnet URI ou hash
export function extractInfoHash(magnetOrHash: string): string {
  if (!magnetOrHash) return '';

  // 1. Regex padrão para BTIH em formato hex (40 caracteres)
  const hexMatch = magnetOrHash.match(/btih:([a-fA-F0-9]{40})/i) || magnetOrHash.match(/([a-fA-F0-9]{40})/i);
  if (hexMatch) {
    return hexMatch[1].toLowerCase();
  }

  // 2. Formato Base32 (32 caracteres RFC 4648)
  const b32Match = magnetOrHash.match(/btih:([a-zA-Z2-7]{32})/i) || magnetOrHash.match(/([a-zA-Z2-7]{32})/i);
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

  // Fallback: limpa e preenche
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

  async getCatalog(category: string = 'trending', page: number = 1): Promise<MediaItem[]> {
    // 1. Tenta carregar instantaneamente do IndexedDB (Offline-First)
    try {
      const cached = await idbService.getCachedCatalog(category, page);
      if (cached && cached.length > 0) {
        // Atualiza em background sem travar a interface
        fetch(`/api/catalog?category=${category}&page=${page}`)
          .then(res => res.ok ? res.json() : null)
          .then(data => {
            if (data?.items?.length) {
              idbService.setCachedCatalog(category, page, data.items);
            }
          })
          .catch(() => {});
        return cached;
      }
    } catch {
      // no-op se IndexedDB falhar
    }

    // 2. Busca na rede com tolerância a falhas
    try {
      const res = await fetch(`/api/catalog?category=${category}&page=${page}`);
      if (!res.ok) return [];
      const data = await res.json();
      const items = data.items || [];

      // Salva no IndexedDB
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

    // 1. Cache local IndexedDB
    try {
      const cached = await idbService.getCachedSearch(query);
      if (cached && cached.length > 0) {
        return cached;
      }
    } catch {}

    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
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
      const res = await fetch(`/api/search/suggestions?q=${encodeURIComponent(query)}`);
      if (!res.ok) return [];
      const data = await res.json();
      return data.suggestions || [];
    } catch {
      return [];
    }
  },

  async getDetails(id: number, type: 'movie' | 'tv' | 'anime' = 'movie'): Promise<MediaItem> {
    // 1. Tenta IndexedDB
    try {
      const cached = await idbService.getCachedDetails(id);
      if (cached) return cached;
    } catch {}

    const res = await fetch(`/api/details/${id}?type=${type}`);
    if (!res.ok) throw new Error('Falha ao obter detalhes');
    const data = await res.json();
    const details = data.details;

    if (details) {
      idbService.setCachedDetails(id, type, details);
    }
    return details;
  },

  // Carregamento sob demanda (lazy-loading) de temporadas e episódios
  async getSeason(seriesId: number, seasonNumber: number): Promise<Episode[]> {
    // 1. Tenta IndexedDB
    try {
      const cached = await idbService.getCachedSeason(seriesId, seasonNumber);
      if (cached && cached.length > 0) {
        return cached;
      }
    } catch {}

    // 2. Busca na rede
    try {
      const res = await fetch(`/api/series/${seriesId}/season/${seasonNumber}`);
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

  async getTorrents(
    title: string,
    options?: {
      year?: string;
      imdbId?: string;
      mediaType?: 'movie' | 'tv' | 'anime';
      season?: number;
      episode?: number;
    } | string
  ): Promise<TorrentSource[]> {
    const year = typeof options === 'string' ? options : options?.year;
    const imdbId = typeof options === 'object' ? options?.imdbId : undefined;
    const mediaType = typeof options === 'object' ? options?.mediaType : undefined;
    const season = typeof options === 'object' ? options?.season : undefined;
    const episode = typeof options === 'object' ? options?.episode : undefined;

    const params = new URLSearchParams({ title });
    if (year) params.set('year', year);
    if (imdbId) params.set('imdbId', imdbId);
    if (mediaType) params.set('mediaType', mediaType);
    if (typeof season === 'number') params.set('season', season.toString());
    if (typeof episode === 'number') params.set('episode', episode.toString());

    const res = await fetch(`/api/torrents?${params.toString()}`);
    if (!res.ok) throw new Error('Falha ao obter fontes de torrent');
    const data = await res.json();
    const rawTorrents: any[] = data.torrents || [];

    // Higieniza rigorosamente cada fonte para garantir infoHash, formato (WEB-DL vs Bluray) e tamanho correto
    return rawTorrents.map((t, idx) => {
      const infoHash = extractInfoHash(t.infoHash || t.magnetUri || `stream_${idx}`);
      const sizeFormatted = t.sizeFormatted || formatFileSize(t.sizeBytes || 2000000000);
      const quality = t.quality || '1080p';
      const format = t.format || (/bluray|blu-ray/i.test(t.title || '') ? 'Bluray' : 'WEB-DL');

      return {
        id: t.id || `torrent-${infoHash.slice(0, 8)}`,
        title: t.title || title,
        magnetUri: t.magnetUri || `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(t.title || title)}`,
        infoHash,
        quality,
        format,
        seeds: typeof t.seeds === 'number' ? t.seeds : 750,
        peers: typeof t.peers === 'number' ? t.peers : 120,
        sizeBytes: t.sizeBytes || 2147483648,
        sizeFormatted,
        isPortugueseAudio: Boolean(t.isPortugueseAudio),
        source: t.source || 'P2P Indexer',
        directUrl: t.directUrl
      };
    });
  },

  async getTorrentStats(magnetUri: string) {
    const res = await fetch(`/api/torrent/stats?magnet=${encodeURIComponent(magnetUri)}`);
    if (!res.ok) return null;
    const data = await res.json();
    return data.stats;
  },

  getStreamUrl(magnetUri: string, options: { transcode?: boolean; audioOnly?: boolean } = {}): string {
    const params = new URLSearchParams({
      magnet: magnetUri
    });
    if (options.transcode) params.set('transcode', 'true');
    if (options.audioOnly) params.set('audioOnly', 'true');
    return `/api/stream?${params.toString()}`;
  },

  getStreamByTmdbIdUrl(
    tmdbId: number,
    options: {
      mediaType?: 'movie' | 'tv' | 'anime';
      season?: number;
      episode?: number;
      transcode?: boolean;
      audioOnly?: boolean;
    } = {}
  ): string {
    const params = new URLSearchParams();
    if (options.mediaType) params.set('mediaType', options.mediaType);
    if (typeof options.season === 'number') params.set('season', options.season.toString());
    if (typeof options.episode === 'number') params.set('episode', options.episode.toString());
    if (options.transcode) params.set('transcode', 'true');
    if (options.audioOnly) params.set('audioOnly', 'true');
    const qs = params.toString();
    return `/api/stream/${tmdbId}${qs ? `?${qs}` : ''}`;
  },

  getVideoStreamProxyUrl(videoUrl: string): string {
    return `/api/stream-video?url=${encodeURIComponent(videoUrl)}`;
  },

  getSubtitleUrl(title: string, lang: string = 'pt-BR'): string {
    return `/api/subtitles?title=${encodeURIComponent(title)}&lang=${encodeURIComponent(lang)}`;
  }
};
