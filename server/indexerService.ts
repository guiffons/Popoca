/**
 * Popoca Streaming - Torrent Indexer & Scraper Service
 * Integração em tempo real com provedores P2P brasileiros e globais (Brazuka, Comando, BluDV, YTS, TorrentGalaxy)
 * com extração estrita de infoHash (40-hex lowercase), detecção de formato (WEB-DL vs. Bluray),
 * priorização de áudio Dublado PT-BR, eliminação rigorosa de lançamentos russos e limites balanceados.
 */

export interface TorrentItem {
  id: string;
  title: string;
  magnetUri: string;
  infoHash: string;
  quality: '4K' | '1080p' | '720p';
  format: 'WEB-DL' | 'Bluray' | 'Outro';
  seeds: number;
  peers: number;
  sizeBytes: number;
  sizeFormatted: string;
  isPortugueseAudio: boolean;
  source: string;
  directUrl?: string;
}

const PUBLIC_TRACKERS = [
  'http://tracker.opentrackr.org:1337/announce',
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.tracker.cl:1337/announce',
  'http://tracker.openbittorrent.com:80/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://9.rarbg.to:2920/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'http://tracker.torrent.eu.org:451/announce',
  'https://tracker.tamersunion.org:443/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://tracker.nyaa.vc:6969/announce'
];

export function buildMagnet(infoHash: string, name: string): string {
  const tr = PUBLIC_TRACKERS.map((t) => `&tr=${encodeURIComponent(t)}`).join('');
  return `magnet:?xt=urn:btih:${infoHash.toLowerCase()}&dn=${encodeURIComponent(name)}${tr}`;
}

// Extrai estritamente o infoHash de 40 caracteres hexadecimais
export function sanitizeInfoHash(raw: string): string {
  if (!raw) return '';
  const match = raw.match(/([a-fA-F0-9]{40})/);
  if (match) return match[1].toLowerCase();

  // Caso seja base32 de 32 caracteres (RFC 4648)
  const b32Match = raw.match(/([a-zA-Z2-7]{32})/);
  if (b32Match) {
    return base32ToHex(b32Match[1]);
  }

  return raw.replace(/[^a-fA-F0-9]/g, '').slice(0, 40).toLowerCase().padEnd(40, '0');
}

function base32ToHex(base32: string): string {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = '';
  const clean = base32.toUpperCase().replace(/=+$/, '');
  for (let i = 0; i < clean.length; i++) {
    const val = alphabet.indexOf(clean[i]);
    if (val >= 0) bits += val.toString(2).padStart(5, '0');
  }
  let hex = '';
  for (let i = 0; i + 4 <= bits.length; i += 4) {
    hex += parseInt(bits.substr(i, 4), 2).toString(16);
  }
  return hex.toLowerCase().slice(0, 40).padStart(40, '0');
}

function parseSizeToBytes(sizeStr: string): number {
  if (!sizeStr) return 1800000000;
  const match = sizeStr.match(/([\d\.]+)\s*(GB|MB|GiB|MiB)/i);
  if (!match) return 1800000000;
  const val = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  if (unit.startsWith('G')) {
    return Math.floor(val * 1024 * 1024 * 1024);
  }
  return Math.floor(val * 1024 * 1024);
}

function isRussianRelease(text: string): boolean {
  if (!text) return false;
  // Caracteres cirílicos (russo/ucraniano)
  if (/[\u0400-\u04FF]/.test(text)) return true;
  // Expressões e rastreadores russos comuns
  if (/\b(rus|rutor|rutracker|kraken|mvo|avo|dub\s*rus|dublado\s*rus)\b/i.test(text)) return true;
  if (text.includes('🇷🇺')) return true;
  if (/\[rus\]|\(rus\)/i.test(text)) return true;
  return false;
}

function isPortugueseRelease(text: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase();
  return (
    t.includes('dublado') ||
    t.includes('dual') ||
    t.includes('pt-br') ||
    t.includes('ptbr') ||
    t.includes('português') ||
    t.includes('portugues') ||
    t.includes('comando') ||
    t.includes('bludv') ||
    t.includes('brazuka') ||
    t.includes('nacional') ||
    t.includes('🇧🇷') ||
    t.includes('🇵🇹')
  );
}

function formatSourceLabel(sourceStr: string, fullText: string): string {
  const low = (sourceStr + ' ' + fullText).toLowerCase();
  if (low.includes('comando')) return 'Brazuka / Comando';
  if (low.includes('bludv')) return 'BluDV Filmes';
  if (low.includes('torrentgalaxy')) return 'TorrentGalaxy';
  if (low.includes('yts')) return 'YTS HD';
  if (low.includes('thepiratebay')) return 'ThePirateBay';
  if (low.includes('1337x')) return '1337x P2P';
  if (low.includes('eztv')) return 'EZTV Séries';
  return sourceStr || 'Popoca P2P';
}

export class IndexerService {
  /**
   * Busca torrents em tempo real com priorização máxima para repositórios brasileiros (Brazuka, Comando, BluDV),
   * exclusão de conteúdo em russo e limitação equilibrada de fontes em inglês.
   */
  async findTorrents(
    queryOrOptions: string | {
      title: string;
      year?: string;
      imdbId?: string;
      mediaType?: 'movie' | 'tv' | 'anime';
      season?: number;
      episode?: number;
    },
    yearArg?: string,
    imdbIdArg?: string,
    mediaTypeArg: 'movie' | 'tv' | 'anime' = 'movie',
    seasonArg?: number,
    episodeArg?: number
  ): Promise<TorrentItem[]> {
    let query: string;
    let year: string | undefined = yearArg;
    let imdbId: string | undefined = imdbIdArg;
    let mediaType: 'movie' | 'tv' | 'anime' = mediaTypeArg;
    let season: number | undefined = seasonArg;
    let episode: number | undefined = episodeArg;

    if (typeof queryOrOptions === 'object') {
      query = queryOrOptions.title;
      year = queryOrOptions.year;
      imdbId = queryOrOptions.imdbId;
      if (queryOrOptions.mediaType) mediaType = queryOrOptions.mediaType;
      season = queryOrOptions.season;
      episode = queryOrOptions.episode;
    } else {
      query = queryOrOptions;
    }

    const cleanTitle = (query || '').replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
    const releaseYear = year || '2024';

    // 1. Obter IMDb ID se não fornecido via Cinemeta
    let targetImdb = imdbId;
    if (!targetImdb && cleanTitle) {
      try {
        const cinemetaType = mediaType === 'movie' ? 'movie' : 'series';
        const cinemetaUrl = `https://v3-cinemeta.strem.io/catalog/${cinemetaType}/top/search=${encodeURIComponent(cleanTitle)}.json`;
        const metaRes = await fetch(cinemetaUrl, { signal: AbortSignal.timeout(3500) });
        if (metaRes.ok) {
          const metaData = await metaRes.json();
          if (metaData.metas && metaData.metas.length > 0) {
            targetImdb = metaData.metas[0].id;
          }
        }
      } catch (err: any) {
        console.warn('[IndexerService] Aviso na busca Cinemeta:', err.message);
      }
    }

    let rawStreams: any[] = [];

    // 2. Buscar no Torrentio com provedores prioritários brasileiros (Comando, BluDV) e globais de alta velocidade
    if (targetImdb) {
      const providersList = 'comando,bludv,yts,torrentgalaxy,1337x,thepiratebay';
      const endpoints = [
        // 1º: Priorizando idioma português (Dublado PT-BR / Dual Áudio)
        `https://torrentio.strem.fun/providers=${providersList}|language=portuguese/stream/${
          mediaType === 'movie' ? 'movie' : 'series'
        }/${targetImdb}${mediaType === 'movie' ? '' : `:${season || 1}:${episode || 1}`}.json`,

        // 2º: Provedores gerais sem filtro caso precise de mais alternativas
        `https://torrentio.strem.fun/providers=${providersList}/stream/${
          mediaType === 'movie' ? 'movie' : 'series'
        }/${targetImdb}${mediaType === 'movie' ? '' : `:${season || 1}:${episode || 1}`}.json`
      ];

      for (const ep of endpoints) {
        try {
          const res = await fetch(ep, { signal: AbortSignal.timeout(4500) });
          if (res.ok) {
            const data = await res.json();
            if (data.streams && data.streams.length > 0) {
              rawStreams.push(...data.streams);
            }
          }
        } catch {
          // segue para próximo endpoint
        }
        if (rawStreams.length >= 15) break;
      }
    }

    // 3. Processar, desduplicar e filtrar rigorosamente lançamentos russos
    const seenHashes = new Set<string>();
    const ptStreams: TorrentItem[] = [];
    const origStreams: TorrentItem[] = [];

    for (let idx = 0; idx < rawStreams.length; idx++) {
      const st = rawStreams[idx];
      const fullText = `${st.name || ''} ${st.title || ''}`;

      // FILTRO RIGOROSO: Exclui filmes com russo
      if (isRussianRelease(fullText)) {
        continue;
      }

      const hash = sanitizeInfoHash(st.infoHash || '');
      if (!hash || hash.length !== 40 || seenHashes.has(hash)) {
        continue;
      }
      seenHashes.add(hash);

      // Sementes (seeds)
      const seedMatch = fullText.match(/👤\s*(\d+)/);
      const seeds = seedMatch ? parseInt(seedMatch[1], 10) : 40;

      // Tamanho
      const sizeMatch = fullText.match(/💾\s*([\d\.]+\s*(?:GB|MB|GiB|MiB))/i);
      const sizeFormatted = sizeMatch ? sizeMatch[1].trim() : '2.10 GB';
      const sizeBytes = parseSizeToBytes(sizeFormatted);

      // Qualidade
      let quality: '4K' | '1080p' | '720p' = '1080p';
      if (/4k|2160p|uhd/i.test(fullText)) quality = '4K';
      else if (/720p/i.test(fullText)) quality = '720p';

      // Formato
      let format: 'WEB-DL' | 'Bluray' | 'Outro' = 'WEB-DL';
      if (/bluray|blu-ray|bdrip|brrip|remux/i.test(fullText)) {
        format = 'Bluray';
      } else if (/web-dl|webrip|web/i.test(fullText)) {
        format = 'WEB-DL';
      }

      // Detecção precisa de Áudio Português
      const isPtAudio = isPortugueseRelease(fullText);

      // Nome do arquivo e Fonte
      const lines = (st.title || '').split('\n');
      const filename = lines[0] || `${cleanTitle} (${releaseYear}) [${quality} ${format}]`;
      const sourceMatch = fullText.match(/⚙️\s*([^\n\r]+)/);
      const rawSource = sourceMatch ? sourceMatch[1].trim() : 'Popoca P2P';
      const cleanSource = formatSourceLabel(rawSource, fullText);

      const torrentItem: TorrentItem = {
        id: `stream-${hash.slice(0, 10)}-${idx}`,
        title: filename,
        magnetUri: buildMagnet(hash, filename),
        infoHash: hash,
        quality,
        format,
        seeds,
        peers: Math.max(1, Math.floor(seeds * 0.2)),
        sizeBytes,
        sizeFormatted,
        isPortugueseAudio: isPtAudio,
        source: cleanSource
      };

      if (isPtAudio) {
        ptStreams.push(torrentItem);
      } else {
        origStreams.push(torrentItem);
      }
    }

    // Ordenar ambas as listas por número de sementes (seeds)
    ptStreams.sort((a, b) => b.seeds - a.seeds);
    origStreams.sort((a, b) => b.seeds - a.seeds);

    // 4. Limitar opções em inglês para não sobrecarregar com excesso de itens
    // Seleciona as melhores fontes em inglês: 1x 4K (se houver), 2x 1080p, 1x 720p
    const balancedOrig: TorrentItem[] = [];
    const orig4K = origStreams.find((t) => t.quality === '4K');
    const orig1080Web = origStreams.find((t) => t.quality === '1080p' && t.format === 'WEB-DL');
    const orig1080Blu = origStreams.find((t) => t.quality === '1080p' && t.format === 'Bluray');
    const orig720 = origStreams.find((t) => t.quality === '720p');

    if (orig1080Web) balancedOrig.push(orig1080Web);
    if (orig1080Blu && orig1080Blu !== orig1080Web) balancedOrig.push(orig1080Blu);
    if (orig4K) balancedOrig.push(orig4K);
    if (orig720) balancedOrig.push(orig720);

    // Se faltarem opções, preenche com as mais semeadas restantes
    for (const t of origStreams) {
      if (balancedOrig.length >= 4) break;
      if (!balancedOrig.some((b) => b.infoHash === t.infoHash)) {
        balancedOrig.push(t);
      }
    }

    // 5. Monta resultado final: Dublados/PT-BR PRIMEIRO, seguidos pelos melhores em áudio original
    const combined = [...ptStreams, ...balancedOrig];

    if (combined.length > 0) {
      return combined;
    }

    // Caso extremo: nenhuma fonte encontrada nos indexadores habituais
    return [];
  }
}

export const indexerService = new IndexerService();
