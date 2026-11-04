/**
 * Popoca Streaming - Torrent Indexer & Scraper Service
 * Integração em tempo real com provedores P2P brasileiros e globais (Brazuka, Comando, BluDV, YTS, TorrentGalaxy)
 * com Seletor de Prioridade de Tracker, cálculo inteligente de Score de Estabilidade + Velocidade Real (seeds/GB),
 * priorização de áudio Dublado PT-BR com sementes saudáveis e eliminação rigorosa de lançamentos russos.
 */

export type TrackerPriorityMode = 'pt-br-stability' | 'ultra-speed' | 'global-balanced';

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
  stabilityScore: number;
  trackerPriority: TrackerPriorityMode;
  directUrl?: string;
  fileIdx?: number;
}

export const SUPER_TRACKERS: string[] = [
  'udp://tracker.opentrackr.org:1337/announce',
  'udp://open.demonii.com:1337/announce',
  'udp://open.stealth.si:80/announce',
  'udp://exodus.desync.com:6969/announce',
  'udp://tracker.torrent.eu.org:451/announce',
  'udp://explodie.org:6969/announce',
  'udp://tracker.openbittorrent.com:6969/announce',
  'udp://p4p.arenabg.com:1337/announce',
  'udp://tracker.dler.org:6969/announce',
  'udp://opentracker.i2p.rocks:6969/announce',
  'udp://tracker.internetwarriors.net:1337/announce',
  'udp://tracker.leechers-paradise.org:6969/announce',
  'udp://coppersurfer.tk:6969/announce',
  'udp://tracker.tiny-vps.com:6969/announce',
  'http://tracker.openbittorrent.com:80/announce'
];

export const TRACKER_PROFILES: Record<TrackerPriorityMode, string[]> = {
  'pt-br-stability': [
    ...SUPER_TRACKERS,
    'http://tracker.opentrackr.org:1337/announce',
    'udp://open.tracker.cl:1337/announce',
    'http://tracker.torrent.eu.org:451/announce',
    'http://tracker.dler.org:6969/announce',
    'udp://tracker.moeking.me:6969/announce',
    'https://tracker.tamersunion.org:443/announce',
    'udp://tracker.bittor.pw:1337/announce',
    'udp://tracker1.bt.moack.co.kr:2710/announce',
    'udp://tracker.therarbg.com:6969/announce',
    'http://tracker.bt4g.com:2095/announce',
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.webtorrent.dev',
    'wss://tracker.files.fm:7073/announce'
  ],
  'ultra-speed': [
    ...SUPER_TRACKERS,
    'http://tracker.opentrackr.org:1337/announce',
    'udp://open.tracker.cl:1337/announce',
    'http://p4p.arenabg.com:1337/announce',
    'http://tracker.bt4g.com:2095/announce',
    'https://tracker.tamersunion.org:443/announce',
    'udp://tracker.moeking.me:6969/announce',
    'udp://tracker.nyaa.vc:6969/announce',
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz'
  ],
  'global-balanced': [
    ...SUPER_TRACKERS,
    'http://tracker.opentrackr.org:1337/announce',
    'udp://open.tracker.cl:1337/announce',
    'udp://tracker.nyaa.vc:6969/announce',
    'http://tracker.torrent.eu.org:451/announce',
    'https://tracker.tamersunion.org:443/announce',
    'udp://tracker.moeking.me:6969/announce',
    'http://p4p.arenabg.com:1337/announce',
    'wss://tracker.openwebtorrent.com'
  ]
};

export function getTrackersForPriority(mode: TrackerPriorityMode = 'pt-br-stability'): string[] {
  const profile = TRACKER_PROFILES[mode] || TRACKER_PROFILES['pt-br-stability'];
  return Array.from(new Set([...SUPER_TRACKERS, ...profile]));
}

export function buildMagnet(
  infoHash: string,
  name: string,
  trackerPriority: TrackerPriorityMode = 'pt-br-stability'
): string {
  const trackers = getTrackersForPriority(trackerPriority);
  const tr = trackers.map((t) => `&tr=${encodeURIComponent(t)}`).join('');
  return `magnet:?xt=urn:btih:${infoHash.toLowerCase()}&dn=${encodeURIComponent(name)}${tr}`;
}

export function sanitizeInfoHash(raw: string): string {
  if (!raw) return '';
  const match = raw.match(/([a-fA-F0-9]{40})/);
  if (match) return match[1].toLowerCase();

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
  if (/[\u0400-\u04FF]/.test(text)) return true;
  if (/\b(rus|rutor|rutracker|kraken|mvo|avo|dub\s*rus|dublado\s*rus)\b/i.test(text)) return true;
  if (text.includes('\u{1F1F7}\u{1F1FA}')) return true;
  if (/\[rus\]|\(rus\)/i.test(text)) return true;
  return false;
}

function isPortugueseRelease(text: string, cleanSource?: string): boolean {
  if (!text) return false;
  const t = text.toLowerCase();

  // YTS, EZTV e Nyaa sao estritamente audio original (Ingles ou Japones).
  // Torrentio exibe bandeiras PT/BR para eles exclusivamente por causa de legendas embutidas!
  if (
    cleanSource === 'YTS HD' ||
    cleanSource === 'EZTV Séries' ||
    cleanSource === 'Nyaa Anime' ||
    /\b(yts|yify|eztv|nyaa|nyaasi)\b/i.test(t)
  ) {
    return false;
  }

  // Se o release for expressamente apenas legendado (ex: "legendas", "subpack") e nao contiver dublado/dual
  if (/\b(legendado|legendas|subpack|multisubs?)\b/i.test(t) && !/\b(dublado|dub\b|dual\b)\b/i.test(t)) {
    return false;
  }

  // Trackers especializados brasileiros publicam releases dublados/dual com audio PT-BR garantido
  const isBrazilianTracker =
    cleanSource === 'Brazuka / Comando' ||
    cleanSource === 'BluDV Filmes' ||
    t.includes('comando') ||
    t.includes('bludv') ||
    t.includes('micoleaodublado') ||
    t.includes('brazuka');

  // Termos explicitos de AUDIO em portugues no release
  const hasExplicitAudioPt =
    t.includes('dublado') ||
    t.includes('audio dublado') ||
    t.includes('áudio dublado') ||
    t.includes('dual áudio') ||
    t.includes('dual audio') ||
    t.includes('pt-br') ||
    t.includes('pt.br') ||
    t.includes('ptbr') ||
    t.includes('nacional') ||
    /\b(dub|dual)\b/i.test(t);

  // Se tiver indicacao de outro idioma no dual (ex: Dual Audio Italiano e Ingles), rejeita
  const hasForeignDual =
    /\b(ita|italian|italiano|spa|spanish|espanol|latino|french|vf2|vff|german|deutsch|hindi|tamil|telugu|polish|pol)\b/i.test(
      t
    );
  if (
    hasForeignDual &&
    !t.includes('pt-br') &&
    !t.includes('ptbr') &&
    !t.includes('dublado') &&
    !t.includes('portug') &&
    !isBrazilianTracker
  ) {
    return false;
  }

  if (isBrazilianTracker && (hasExplicitAudioPt || t.includes('\u{1F1E7}\u{1F1F7}') || t.includes('\u{1F1F5}\u{1F1F9}'))) {
    return true;
  }

  // Para fontes globais (TorrentGalaxy, 1337x, TPB), exige menção inequívoca de dublagem PT-BR
  if (
    t.includes('dublado') ||
    t.includes('pt-br') ||
    t.includes('pt.br') ||
    t.includes('ptbr') ||
    t.includes('nacional') ||
    t.includes('português') ||
    t.includes('portugues')
  ) {
    return true;
  }

  return false;
}

function formatSourceLabel(sourceStr: string, fullText: string): string {
  const low = (sourceStr + ' ' + fullText).toLowerCase();
  if (low.includes('comando') || low.includes('brazuka')) return 'Brazuka / Comando';
  if (low.includes('bludv')) return 'BluDV Filmes';
  if (low.includes('torrentgalaxy')) return 'TorrentGalaxy';
  if (low.includes('yts')) return 'YTS HD';
  if (low.includes('thepiratebay')) return 'ThePirateBay';
  if (low.includes('1337x')) return '1337x P2P';
  if (low.includes('eztv')) return 'EZTV Séries';
  if (low.includes('nyaa')) return 'Nyaa Anime';
  return sourceStr || 'Popoca P2P';
}

/**
 * Calcula Score de Estabilidade + Velocidade de Partida:
 * - Impede que torrents mortos (< 5 seeds) fiquem no topo e travem a reprodução
 * - Premia fortemente torrents Dublados PT-BR quando possuem seeds ativas (>= 10 seeds)
 * - Premia contêineres nativos MP4 / H.264 / WEB-DL leves com alta densidade seeds/GB (abrem em 1–3s!)
 */
function computeStabilityScore(params: {
  seeds: number;
  sizeBytes: number;
  quality: '4K' | '1080p' | '720p';
  isPtAudio: boolean;
  format: 'WEB-DL' | 'Bluray' | 'Outro';
  cleanSource: string;
  fullText: string;
  trackerPriority: TrackerPriorityMode;
}): number {
  const { seeds, sizeBytes, quality, isPtAudio, format, cleanSource, fullText, trackerPriority } = params;
  const sizeGB = Math.max(0.35, sizeBytes / (1024 * 1024 * 1024));
  let score = 0;

  // Penaliza enxames sem seeds ativas, mas preserva torrents raros de poucas sementes (1-4 seeds)
  if (seeds <= 0) {
    score -= 800;
  } else if (seeds === 1) {
    score -= 260;
  } else if (seeds < 4) {
    score -= 100;
  }

  // Densidade de seeds por GB (principal fator de velocidade real de abertura P2P!)
  const seedsPerGb = seeds / sizeGB;
  score += Math.min(620, seeds * 0.9 + seedsPerGb * 5.2);

  // Prioriza 1080p como padrão principal, seguido de 720p leve e 4K apenas quando escolhido
  if (quality === '1080p') score += 200;
  else if (quality === '720p') score += 120;
  else if (quality === '4K') score -= 260;

  // Prioridade forte para filmes em Português (Dublado / Dual Áudio PT-BR) quando têm seeds ativas
  if (isPtAudio && trackerPriority !== 'ultra-speed') {
    if (seeds >= 15) {
      score += trackerPriority === 'pt-br-stability' ? 720 : 420;
    } else if (seeds >= 6) {
      score += trackerPriority === 'pt-br-stability' ? 540 : 300;
    } else if (seeds >= 2) {
      score += trackerPriority === 'pt-br-stability' ? 260 : 120;
    }
  } else if (isPtAudio && trackerPriority === 'ultra-speed' && seeds >= 12) {
    score += 260;
  }

  // Repositórios conhecidos por velocidade e integridade
  if (cleanSource === 'YTS HD' || cleanSource === 'TorrentGalaxy' || cleanSource === 'EZTV Séries') {
    score += 150;
  } else if ((cleanSource === 'Brazuka / Comando' || cleanSource === 'BluDV Filmes') && seeds >= 8) {
    score += trackerPriority === 'pt-br-stability' ? 130 : 75;
  } else if (cleanSource === '1337x P2P' || cleanSource === 'Nyaa Anime') {
    score += 95;
  }

  // Contêineres MP4 / H.264 / WEB-DL compactos tocam instantaneamente
  if (format === 'WEB-DL') score += 85;
  if (/\.mp4\b/i.test(fullText) || cleanSource === 'YTS HD') score += 180;
  if (/\b(x264|h\.?264|avc)\b/i.test(fullText)) score += 150;
  if (sizeGB >= 0.55 && sizeGB <= 3.5) score += 120;

  // Penaliza fortemente codecs sem suporte nativo universal (HEVC/x265/10bit/AV1) e arquivos pesados
  if (/(hevc|x265|h\.?265|10\s*-?bits?|av1)/i.test(fullText)) score -= 650;
  if (sizeGB > 4.2) score -= 220;
  if (/\bremux\b/i.test(fullText) || sizeGB > 6.0) score -= 420;

  return Math.round(score);
}

export class IndexerService {
  private defaultPriority: TrackerPriorityMode = 'pt-br-stability';

  getTrackerPriority(): TrackerPriorityMode {
    return this.defaultPriority;
  }

  setTrackerPriority(mode: TrackerPriorityMode) {
    if (TRACKER_PROFILES[mode]) {
      this.defaultPriority = mode;
    }
  }

  async findTorrents(
    queryOrOptions:
      | string
      | {
        title: string;
        originalTitle?: string;
        year?: string;
        imdbId?: string;
        mediaType?: 'movie' | 'tv' | 'anime';
        season?: number;
        episode?: number;
        trackerPriority?: TrackerPriorityMode;
      },
    yearArg?: string,
    imdbIdArg?: string,
    mediaTypeArg: 'movie' | 'tv' | 'anime' = 'movie',
    seasonArg?: number,
    episodeArg?: number,
    trackerPriorityArg?: TrackerPriorityMode
  ): Promise<TorrentItem[]> {
    let query: string;
    let originalTitle: string | undefined;
    let year: string | undefined = yearArg;
    let imdbId: string | undefined = imdbIdArg;
    let mediaType: 'movie' | 'tv' | 'anime' = mediaTypeArg;
    let season: number | undefined = seasonArg;
    let episode: number | undefined = episodeArg;
    let trackerPriority: TrackerPriorityMode = trackerPriorityArg || this.defaultPriority;

    if (typeof queryOrOptions === 'object') {
      query = queryOrOptions.title;
      originalTitle = queryOrOptions.originalTitle;
      year = queryOrOptions.year;
      imdbId = queryOrOptions.imdbId;
      if (queryOrOptions.mediaType) mediaType = queryOrOptions.mediaType;
      season = queryOrOptions.season;
      episode = queryOrOptions.episode;
      if (queryOrOptions.trackerPriority) trackerPriority = queryOrOptions.trackerPriority;
    } else {
      query = queryOrOptions;
    }

    const searchTitleForFallback = (originalTitle || query || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-zA-Z0-9\s]/g, ' ')
      .trim();
    const releaseYear = year || '2026';

    let targetImdb = imdbId;
    if (!targetImdb && (query || searchTitleForFallback)) {
      try {
        const cleanQ = (searchTitleForFallback || query).trim().toLowerCase();
        const firstChar = cleanQ.replace(/[^a-z0-9]/gi, '').charAt(0) || 'x';
        const qEncoded = encodeURIComponent(cleanQ);
        const imdbSugRes = await fetch(`https://v3.sg.media-imdb.com/suggestion/${firstChar}/${qEncoded}.json`, {
          headers: { 'Accept-Language': 'pt-BR,pt;q=0.9' },
          signal: AbortSignal.timeout(3000)
        });
        if (imdbSugRes.ok) {
          const sugData = await imdbSugRes.json();
          const list = Array.isArray(sugData.d) ? sugData.d : [];
          const wantSeries = mediaType === 'tv' || mediaType === 'anime';
          const preferredMatch = list.find(
            (d: any) =>
              typeof d.id === 'string' &&
              d.id.startsWith('tt') &&
              (wantSeries
                ? d.qid === 'tvSeries' || d.qid === 'tvMiniSeries'
                : d.qid === 'movie' || d.qid === 'feature')
          );
          const firstValid =
            preferredMatch ||
            list.find((d: any) => typeof d.id === 'string' && d.id.startsWith('tt'));
          if (firstValid) {
            targetImdb = firstValid.id;
          }
        }
      } catch { }

      if (!targetImdb && searchTitleForFallback) {
        try {
          const cinemetaType = mediaType === 'movie' ? 'movie' : 'series';
          const cinemetaUrl = `https://v3-cinemeta.strem.io/catalog/${cinemetaType}/top/search=${encodeURIComponent(searchTitleForFallback)}.json`;
          const metaRes = await fetch(cinemetaUrl, { signal: AbortSignal.timeout(3200) });
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
    }

    const rawStreams: any[] = [];

    if (targetImdb) {
      const providersList =
        trackerPriority === 'ultra-speed'
          ? 'yts,torrentgalaxy,comando,bludv,micoleaodublado,1337x,eztv,nyaasi,thepiratebay'
          : 'comando,bludv,micoleaodublado,yts,torrentgalaxy,1337x,eztv,nyaasi,thepiratebay';

      const streamPath = `${mediaType === 'movie' ? 'movie' : 'series'}/${targetImdb}${mediaType === 'movie' ? '' : `:${season || 1}:${episode || 1}`
        }.json`;

      const endpoints = [
        `https://torrentio.strem.fun/providers=${providersList}|language=portuguese/stream/${streamPath}`,
        `https://torrentio.strem.fun/providers=${providersList}/stream/${streamPath}`
      ];

      const settled = await Promise.allSettled(
        endpoints.map((ep) =>
          fetch(ep, { signal: AbortSignal.timeout(4800) }).then((r) => (r.ok ? r.json() : null))
        )
      );

      for (const res of settled) {
        if (res.status === 'fulfilled' && res.value?.streams?.length) {
          rawStreams.push(...res.value.streams);
        }
      }
    }

    const seenHashes = new Set<string>();
    const parsedItems: TorrentItem[] = [];

    for (let idx = 0; idx < rawStreams.length; idx++) {
      const st = rawStreams[idx];
      const fullText = `${st.name || ''} ${st.title || ''}`;

      if (isRussianRelease(fullText)) {
        continue;
      }

      // Ignora gravações de câmera de baixa qualidade se houver releases digitais
      if (/\b(hdcam|camrip|telesync|hdts)\b/i.test(fullText) && rawStreams.length > 6) {
        continue;
      }

      const hash = sanitizeInfoHash(st.infoHash || '');
      if (!hash || hash.length !== 40 || seenHashes.has(hash)) {
        continue;
      }
      seenHashes.add(hash);

      const seedMatch = fullText.match(/\u{1F464}\s*(\d+)/u);
      const seeds = seedMatch ? parseInt(seedMatch[1], 10) : 0;

      const sizeMatch = fullText.match(/\u{1F4BE}\s*([\d\.]+\s*(?:GB|MB|GiB|MiB))/iu);
      const sizeFormatted = sizeMatch ? sizeMatch[1].trim() : '1.65 GB';
      const sizeBytes = parseSizeToBytes(sizeFormatted);

      let quality: '4K' | '1080p' | '720p' = '1080p';
      if (/4k|2160p|uhd/i.test(fullText)) quality = '4K';
      else if (/720p/i.test(fullText)) quality = '720p';

      let format: 'WEB-DL' | 'Bluray' | 'Outro' = 'WEB-DL';
      if (/bluray|blu-ray|bdrip|brrip|remux/i.test(fullText)) {
        format = 'Bluray';
      } else if (/web-dl|webrip|web/i.test(fullText)) {
        format = 'WEB-DL';
      }

      const lines = (st.title || '').split('\n');
      const filename = lines[0] || `${query || searchTitleForFallback} (${releaseYear}) [${quality} ${format}]`;
      const sourceMatch = fullText.match(/\u{2699}\uFE0F?\s*([^\n\r]+)/u);
      const rawSource = sourceMatch ? sourceMatch[1].trim() : 'Popoca P2P';
      const cleanSource = formatSourceLabel(rawSource, fullText);

      const isPtAudio = isPortugueseRelease(fullText, cleanSource);

      const stabilityScore = computeStabilityScore({
        seeds,
        sizeBytes,
        quality,
        isPtAudio,
        format,
        cleanSource,
        fullText,
        trackerPriority
      });

      parsedItems.push({
        id: `stream-${hash.slice(0, 10)}-${idx}`,
        title: filename,
        magnetUri: buildMagnet(hash, filename, trackerPriority),
        infoHash: hash,
        quality,
        format,
        seeds,
        peers: Math.max(1, Math.floor(seeds * 0.28)),
        sizeBytes,
        sizeFormatted,
        isPortugueseAudio: isPtAudio,
        source: cleanSource,
        stabilityScore,
        trackerPriority,
        fileIdx: typeof st.fileIdx === 'number' ? st.fileIdx : undefined
      });
    }

    // Remove fontes com 0 seeds se existirem opções ativas
    const hasHealthy = parsedItems.some((i) => i.seeds >= 3);
    const activeItems = hasHealthy ? parsedItems.filter((i) => i.seeds >= 1) : parsedItems;

    const sortWithPtPriority = (a: TorrentItem, b: TorrentItem) => {
      if (trackerPriority === 'pt-br-stability') {
        const isPtViable = (item: TorrentItem) => {
          if (!item.isPortugueseAudio) return 0;
          const minViableSeeds = item.sizeBytes > 4.5 * 1024 * 1024 * 1024 ? 8 : 5;
          return item.seeds >= minViableSeeds ? 1 : 0;
        };
        const aPtHealthy = isPtViable(a);
        const bPtHealthy = isPtViable(b);
        if (aPtHealthy !== bPtHealthy) return bPtHealthy - aPtHealthy;
      }
      return b.stabilityScore - a.stabilityScore || b.seeds - a.seeds;
    };

    activeItems.sort(sortWithPtPriority);

    // Mantém diversidade por qualidade (1080p, 720p, 4K) e idioma para failover rápido na mesma resolução
    const selected: TorrentItem[] = [];
    const selectedHashes = new Set<string>();

    const addCandidate = (item: TorrentItem) => {
      if (!selectedHashes.has(item.infoHash)) {
        selectedHashes.add(item.infoHash);
        selected.push(item);
      }
    };

    // Top 12 globais já ordenados com prioridade PT-BR
    activeItems.slice(0, 12).forEach(addCandidate);

    // Garante até 3 opções PT-BR e 3 opções Originais por qualidade (1080p, 720p, 4K)
    for (const q of ['1080p', '720p', '4K'] as const) {
      activeItems
        .filter((t) => t.quality === q && t.isPortugueseAudio)
        .slice(0, 3)
        .forEach(addCandidate);
      activeItems
        .filter((t) => t.quality === q && !t.isPortugueseAudio)
        .slice(0, 3)
        .forEach(addCandidate);
    }

    return selected.sort(sortWithPtPriority);
  }
}

export function normalizeQuality(raw?: string): '4K' | '1080p' | '720p' {
  if (!raw) return '1080p';
  const low = raw.trim().toLowerCase();
  if (low === '4k' || low === '2160p' || low === 'uhd') return '4K';
  if (low === '720p' || low === 'hd') return '720p';
  return '1080p';
}

const QUALITY_RANK: Record<'4K' | '1080p' | '720p', number> = {
  '4K': 3,
  '1080p': 2,
  '720p': 1
};

/**
 * FASE 2: Respeito Estrito a Qualidade Escolhida (Quality Cap) + Fallback Inteligente
 * - Inicia exatamente na resolucao escolhida pelo usuario (ordenando pelo torrent com mais seeders dentro daquela qualidade).
 * - NUNCA sobe para uma qualidade maior que a solicitada.
 * - Prepara candidatos da qualidade imediatamente inferior (ex: 1080p -> 720p) para o Health Check de 5 segundos.
 */
export function selectQualityCappedCandidates(
  torrents: TorrentItem[],
  preferredQuality?: string,
  preferPortugueseAudio: boolean = true
): {
  requestedQuality: '4K' | '1080p' | '720p';
  primaryCandidates: TorrentItem[];
  fallbackCandidates: TorrentItem[];
  fallbackQuality: '1080p' | '720p' | null;
  hybridCandidate?: { videoTorrent: TorrentItem; audioTorrent: TorrentItem } | null;
} {
  const requestedQuality = normalizeQuality(preferredQuality);
  const maxRank = QUALITY_RANK[requestedQuality];

  const valid = torrents.filter((t) => Boolean(t.magnetUri));
  // Quality Cap estrito: nunca permite qualidade superior a escolhida pelo usuario
  const capped = valid.filter((t) => QUALITY_RANK[t.quality] <= maxRank);
  const pool = capped.length > 0 ? capped : valid;

  const sortByLangAndSeedsDesc = (a: TorrentItem, b: TorrentItem) => {
    const aLangMatch = preferPortugueseAudio ? (a.isPortugueseAudio ? 1 : 0) : (!a.isPortugueseAudio ? 1 : 0);
    const bLangMatch = preferPortugueseAudio ? (b.isPortugueseAudio ? 1 : 0) : (!b.isPortugueseAudio ? 1 : 0);
    if (aLangMatch !== bLangMatch) return bLangMatch - aLangMatch;
    return b.seeds - a.seeds || b.stabilityScore - a.stabilityScore;
  };

  const sortBySeedsDesc = (a: TorrentItem, b: TorrentItem) =>
    b.seeds - a.seeds || b.stabilityScore - a.stabilityScore;

  const exactQuality = pool
    .filter((t) => t.quality === requestedQuality)
    .sort(sortByLangAndSeedsDesc);

  const lowerOrder: Array<'1080p' | '720p'> =
    requestedQuality === '4K' ? ['1080p', '720p'] : requestedQuality === '1080p' ? ['720p'] : [];

  let fallbackQuality: '1080p' | '720p' | null = null;
  let fallbackCandidates: TorrentItem[] = [];

  for (const lq of lowerOrder) {
    const matches = pool.filter((t) => t.quality === lq).sort(sortByLangAndSeedsDesc);
    if (matches.length > 0) {
      fallbackQuality = lq;
      fallbackCandidates = matches;
      break;
    }
  }

  // Se nao houver nenhum candidato na resolucao exata pedida, inicia direto na resolucao inferior disponivel
  const primaryCandidates = exactQuality.length > 0 ? exactQuality : fallbackCandidates;

  // FASE 3: Detecta oportunidade de Muxing Hibrido (Video 4K/1080p EN + Audio 720p PT-BR)
  // quando o usuario quer PT-BR em 1080p/4K mas so existe PT-BR em 720p
  let hybridCandidate: { videoTorrent: TorrentItem; audioTorrent: TorrentItem } | null = null;
  if (preferPortugueseAudio && requestedQuality !== '720p') {
    const ptExact = capped.filter((t) => t.isPortugueseAudio && t.quality === requestedQuality);
    const pt720 = capped
      .filter((t) => t.isPortugueseAudio && t.quality === '720p' && t.seeds >= 1)
      .sort(sortBySeedsDesc);
    const enHigh = capped
      .filter((t) => !t.isPortugueseAudio && t.quality === requestedQuality && t.seeds >= 2)
      .sort((a, b) => {
        const aWebDl = a.format === 'WEB-DL' ? 1 : 0;
        const bWebDl = b.format === 'WEB-DL' ? 1 : 0;
        if (aWebDl !== bWebDl) return bWebDl - aWebDl;
        return b.seeds - a.seeds;
      });

    if (ptExact.length === 0 && pt720.length > 0 && enHigh.length > 0) {
      const preferredAudio =
        pt720.find((a) => a.format === enHigh[0].format) || pt720[0];
      hybridCandidate = {
        videoTorrent: enHigh[0],
        audioTorrent: preferredAudio
      };
    }
  }

  return {
    requestedQuality,
    primaryCandidates,
    fallbackCandidates: exactQuality.length > 0 ? fallbackCandidates : [],
    fallbackQuality: exactQuality.length > 0 ? fallbackQuality : null,
    hybridCandidate
  };
}

export const indexerService = new IndexerService();
