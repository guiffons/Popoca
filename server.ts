/**
 * Popoca Streaming - Servidor de Mídia Full-Stack
 * Backend Node.js Express de altíssimo desempenho para streaming de torrents,
 * seletor de prioridade de trackers PT-BR, re-try automático/manual de peers,
 * integração TMDB/IMDb pt-BR e servidor de desenvolvimento Vite integrado.
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import https from 'https';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { tmdbService } from './server/tmdbService.ts';
import { indexerService, TrackerPriorityMode } from './server/indexerService.ts';
import { torrentEngine } from './server/torrentEngine.ts';
import { subtitleService } from './server/subtitleService.ts';
import { syncService } from './server/syncService.ts';
import { db } from './server/database.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
process.on('uncaughtException', (err) => {
  console.error('[Popoca] Erro ignorado para não derrubar o servidor:', err?.message || err);
});
process.on('unhandledRejection', (reason) => {
  console.error('[Popoca] Promessa rejeitada ignorada:', reason);
});
// ===== Limpeza automática do cache de torrents =====
// O /tmp do Render grátis tem limite de 2GB. Este trecho apaga o que está parado.
const CACHE_DIR = path.join(os.tmpdir(), 'popoca-cache');
const CACHE_LIMIT_BYTES = 1.2 * 1024 * 1024 * 1024; // acima disso começa a apagar
const CACHE_TARGET_BYTES = 0.6 * 1024 * 1024 * 1024; // apaga até chegar perto disso
const IDLE_DELETE_MS = 10 * 60 * 1000; // pasta parada há 10 min é apagada
const IDLE_SAFE_MS = 2 * 60 * 1000; // pasta mexida há menos de 2 min nunca é apagada

function folderInfo(dir: string): { size: number; newest: number } {
  let size = 0;
  let newest = 0;
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, entry.name);
      try {
        if (entry.isDirectory()) {
          walk(p);
        } else {
          const st = fs.statSync(p);
          size += st.blocks * 512; // uso real em disco
          newest = Math.max(newest, st.mtimeMs);
        }
      } catch {}
    }
  };
  try {
    walk(dir);
  } catch {}
  return { size, newest };
}

function cleanTorrentCache() {
  try {
    if (!fs.existsSync(CACHE_DIR)) return;
    const now = Date.now();
    const folders = fs
      .readdirSync(CACHE_DIR, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => {
        const p = path.join(CACHE_DIR, e.name);
        return { p, ...folderInfo(p) };
      })
      .sort((a, b) => a.newest - b.newest); // mais antigas primeiro

    let total = folders.reduce((s, f) => s + f.size, 0);

    for (const f of folders) {
      const idle = now - f.newest;
      const tooOld = idle > IDLE_DELETE_MS;
      const overLimit = total > CACHE_LIMIT_BYTES && total > CACHE_TARGET_BYTES && idle > IDLE_SAFE_MS;
      if (tooOld || overLimit) {
        try {
          fs.rmSync(f.p, { recursive: true, force: true });
          total -= f.size;
          console.log(`[Popoca] Cache limpo: ${path.basename(f.p)} (${Math.round(f.size / 1048576)} MB)`);
        } catch {}
      }
    }
  } catch {}
}

cleanTorrentCache();
setInterval(cleanTorrentCache, 3 * 60 * 1000);
// ===== Fim da limpeza =====


function getLocalLanIp(): string {
  try {
    const nets = os.networkInterfaces();
    const candidates: Array<{ address: string; priority: number }> = [];

    for (const [name, entries] of Object.entries(nets)) {
      if (!entries) continue;
      if (/(wsl|vethernet|virtualbox|vmware|docker|hyper-v|loopback|tailscale|zerotier|hamachi)/i.test(name)) {
        continue;
      }
      for (const net of entries) {
        if (String(net.family) !== 'IPv4' || net.internal || !net.address) continue;
        if (net.address.startsWith('169.254.')) continue;

        let priority = 3;
        if (net.address.startsWith('192.168.')) priority = 1;
        else if (net.address.startsWith('10.')) priority = 2;
        else if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(net.address)) priority = 2;

        if (/(wi-?fi|wlan|wireless|ethernet|eth)/i.test(name)) {
          priority -= 0.5;
        }
        candidates.push({ address: net.address, priority });
      }
    }

    candidates.sort((a, b) => a.priority - b.priority);
    if (candidates.length > 0) {
      return candidates[0].address;
    }
  } catch { }
  return '127.0.0.1';
}

function escapeHtmlAttr(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function parsePriorityMode(val: unknown): TrackerPriorityMode | undefined {
  if (val === 'pt-br-stability' || val === 'ultra-speed' || val === 'global-balanced') {
    return val;
  }
  return undefined;
}

/**
 * Cache em memória com TTL + deduplicação de requisições em andamento.
 * Se 5 telas pedem o mesmo catálogo/torrent ao mesmo tempo, só 1 chamada externa é feita,
 * e as próximas aberturas do mesmo título respondem instantaneamente.
 */
const responseCache = new Map<string, { at: number; ttl: number; value: unknown }>();
const inflightRequests = new Map<string, Promise<unknown>>();
const RESPONSE_CACHE_MAX = 800;

async function cachedFetch<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  shouldCache: (value: T) => boolean = () => true
): Promise<T> {
  const hit = responseCache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) {
    return hit.value as T;
  }
  const pending = inflightRequests.get(key);
  if (pending) return pending as Promise<T>;

  const p = (async () => {
    try {
      const value = await loader();
      if (shouldCache(value)) {
        if (responseCache.size >= RESPONSE_CACHE_MAX) {
          const oldestKey = responseCache.keys().next().value;
          if (oldestKey !== undefined) responseCache.delete(oldestKey);
        }
        responseCache.set(key, { at: Date.now(), ttl: ttlMs, value });
      }
      return value;
    } catch (err) {
      // Em caso de falha da fonte externa, serve a última resposta conhecida (mesmo expirada)
      if (hit) return hit.value as T;
      throw err;
    } finally {
      inflightRequests.delete(key);
    }
  })();
  inflightRequests.set(key, p);
  return p;
}

const MIN = 60 * 1000;

async function bootstrap() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(cors());
  app.use(express.json());

  // Log de conexões para diagnóstico de rede local (Wi-Fi / Mobile / Smart TV)
  app.use((req, _res, next) => {
    // Log enxuto: ignora assets do Vite e polling de status (reduz I/O de console que deixava tudo lento)
    if (
      req.url.startsWith('/api/') &&
      !/^\/api\/(torrent\/stats|stream\/stats|stats|network)/.test(req.url)
    ) {
      const remoteIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
      console.log(`[Rede Popoca] ${req.method} ${req.url.slice(0, 140)} de ${remoteIp}`);
    }
    next();
  });

  // 1. Catálogo com prioridade pt-BR (Em Alta, Filmes, Séries, Animes)
  app.get('/api/catalog', async (req: Request, res: Response) => {
    try {
      const category = (req.query.category as string) || 'trending';
      const page = parseInt(req.query.page as string, 10) || 1;
      const items = await cachedFetch(
        `catalog|${category}|${page}`,
        30 * MIN,
        () => tmdbService.getCatalog(category, page),
        (v) => Array.isArray(v) && v.length > 0
      );
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=1800');
      res.json({ success: true, category, items });
    } catch (err: any) {
      console.error('[API /catalog] Erro:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. Busca dinâmica com foco em nomes em Português (pt-BR)
  app.get('/api/search', async (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string) || '';
      const results = await cachedFetch(
        `search|${q.trim().toLowerCase()}`,
        10 * MIN,
        () => tmdbService.search(q),
        (v) => Array.isArray(v) && v.length > 0
      );
      res.json({ success: true, count: results.length, results });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2.1 Sugestões de busca preditiva instantânea em Português
  app.get('/api/search/suggestions', async (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string) || '';
      const suggestions = await tmdbService.getSuggestions(q);
      res.json({ success: true, suggestions });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. Detalhes completos do título (com quantidade exata de temporadas e episódios)
  app.get('/api/details/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const type = (req.query.type as 'movie' | 'tv' | 'anime') || 'movie';
      const details = await cachedFetch(
        `details|${type}|${id}`,
        6 * 60 * MIN,
        () => tmdbService.getDetails(id, type),
        (v) => Boolean(v)
      );
      if (!details) {
        res.status(404).json({ success: false, error: 'Título não encontrado' });
        return;
      }
      res.json({ success: true, details });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3.1 Carregamento sob demanda (lazy-loading) de episódios por temporada
  app.get('/api/series/:id/season/:seasonNumber', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const seasonNumber = parseInt(req.params.seasonNumber, 10) || 1;
      const episodes = await cachedFetch(
        `season|${id}|${seasonNumber}`,
        6 * 60 * MIN,
        () => tmdbService.getSeasonEpisodes(id, seasonNumber),
        (v) => Array.isArray(v) && v.length > 0
      );
      res.json({ success: true, seriesId: id, seasonNumber, episodes });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. Provedores e indexador de torrents com Seletor de Prioridade de Tracker
  app.get('/api/torrents', async (req: Request, res: Response) => {
    try {
      const title = (req.query.title as string) || '';
      const originalTitle = (req.query.originalTitle as string) || undefined;
      const year = req.query.year as string | undefined;
      const imdbId = req.query.imdbId as string | undefined;
      const mediaType = (req.query.mediaType as 'movie' | 'tv' | 'anime') || 'movie';
      const season = req.query.season ? parseInt(req.query.season as string, 10) : undefined;
      const episode = req.query.episode ? parseInt(req.query.episode as string, 10) : undefined;
      const trackerPriority = parsePriorityMode(req.query.trackerPriority);

      if (!title && !imdbId) {
        res.status(400).json({ success: false, error: 'Parâmetro title ou imdbId é obrigatório' });
        return;
      }
      const torrents = await cachedFetch(
        `torrents|${imdbId || ''}|${title}|${year || ''}|${mediaType}|${season ?? ''}|${episode ?? ''}|${trackerPriority || ''}`,
        20 * MIN,
        () =>
          indexerService.findTorrents({
            title,
            originalTitle,
            year,
            imdbId,
            mediaType,
            season,
            episode,
            trackerPriority
          }),
        (v) => Array.isArray(v) && v.length > 0
      );
      res.json({
        success: true,
        count: torrents.length,
        trackerPriority: trackerPriority || indexerService.getTrackerPriority(),
        torrents
      });
    } catch (err: any) {
      console.error('[API /torrents] Erro no scraper:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4.1 Seletor Global de Prioridade de Tracker
  app.get('/api/torrent/tracker-priority', (_req: Request, res: Response) => {
    res.json({
      success: true,
      trackerPriority: torrentEngine.getTrackerPriority()
    });
  });

  app.post('/api/torrent/tracker-priority', (req: Request, res: Response) => {
    const mode = parsePriorityMode(req.body?.trackerPriority);
    const magnet = req.body?.magnet as string | undefined;
    if (!mode) {
      res.status(400).json({ success: false, error: 'Modo de prioridade de tracker inválido' });
      return;
    }
    indexerService.setTrackerPriority(mode);
    torrentEngine.setTrackerPriority(mode, magnet);
    res.json({ success: true, trackerPriority: mode });
  });

  // 4.2 Re-try Manual ou sob demanda de rastreamento de novos peers
  app.post('/api/torrent/retry', async (req: Request, res: Response) => {
    try {
      const magnet = req.body?.magnet as string;
      const trackerPriority = parsePriorityMode(req.body?.trackerPriority);
      if (!magnet) {
        res.status(400).json({ success: false, error: 'Magnet URI obrigatório para re-try' });
        return;
      }
      const result = await torrentEngine.forceRetryPeers(magnet, trackerPriority);
      res.json(result);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5. Mapeamento Automático de Torrents via TMDB ID (GET /api/stream/:tmdbId)
  app.get('/api/stream/:tmdbId', async (req: Request, res: Response) => {
    try {
      const tmdbId = parseInt(req.params.tmdbId, 10);
      const mediaType = (req.query.mediaType as 'movie' | 'tv' | 'anime') || 'movie';
      const season = req.query.season ? parseInt(req.query.season as string, 10) : undefined;
      const episode = req.query.episode ? parseInt(req.query.episode as string, 10) : undefined;
      const preferredQuality = req.query.quality as string | undefined;
      const trackerPriority = parsePriorityMode(req.query.trackerPriority);
      const transcode = req.query.transcode === 'true';
      const audioOnly = req.query.audioOnly === 'true';
      const seekSeconds = req.query.seek ? parseFloat(req.query.seek as string) : undefined;
      const preferPortugueseAudio = req.query.preferPt !== 'false';
      const audioTrackIndex =
        req.query.audioTrack !== undefined
          ? parseInt(req.query.audioTrack as string, 10)
          : undefined;

      const media = await tmdbService.getDetails(tmdbId, mediaType);
      if (!media) {
        res.status(404).send('Título TMDB não encontrado.');
        return;
      }

      const year = media.release_date ? media.release_date.slice(0, 4) : undefined;

      const torrents = await indexerService.findTorrents({
        title: media.title,
        originalTitle: media.original_title,
        year,
        imdbId: media.imdb_id,
        mediaType: media.media_type,
        season,
        episode,
        trackerPriority
      });

      // Prioriza estritamente o idioma solicitado (Português PT-BR por padrão) + qualidade escolhida
      const validTorrents = torrents.filter((t) => Boolean(t.magnetUri));
      const langFiltered = preferPortugueseAudio
        ? validTorrents.filter((t) => t.isPortugueseAudio)
        : validTorrents.filter((t) => !t.isPortugueseAudio);
      const languagePool = langFiltered.length > 0 ? langFiltered : validTorrents;

      const sameQualityCandidates = preferredQuality
        ? languagePool.filter((t) => t.quality === preferredQuality)
        : [];
      let topCandidates = (
        sameQualityCandidates.length > 0 ? sameQualityCandidates : languagePool
      ).slice(0, 4);

      if (!seekSeconds && topCandidates.length > 1) {
        const fastMagnet = await torrentEngine.raceLiveCandidates(
          topCandidates.map((c) => c.magnetUri),
          trackerPriority
        );
        const winnerObj = topCandidates.find((c) => c.magnetUri === fastMagnet);
        if (winnerObj) {
          topCandidates = [winnerObj, ...topCandidates.filter((c) => c !== winnerObj)];
        }
      }

      for (const candidate of topCandidates) {
        console.log(
          `[TMDB Stream] Tentando streaming para ID ${tmdbId} via torrent ${candidate.quality} [${candidate.isPortugueseAudio ? 'PT-BR' : 'Original'
          }] (${candidate.seeds} seeds, score=${candidate.stabilityScore}): ${candidate.title}`
        );
        try {
          await torrentEngine.handleStreamRequest(
            req,
            res,
            candidate.magnetUri,
            transcode,
            audioOnly,
            trackerPriority,
            {
              seekSeconds,
              preferPortugueseAudio,
              audioTrackIndex,
              season,
              episode,
              fileIdx: candidate.fileIdx
            }
          );
          return;
        } catch {
          console.warn(`[TMDB Stream] Instabilidade na fonte ${candidate.quality}, tentando próxima semente do mesmo idioma...`);
          if (res.headersSent) return;
        }
      }

      const directUrl =
        (episode && media.seasons
          ? media.seasons.flatMap((s) => s.episodes).find((e) => e.episodeNumber === episode)?.streamUrl
          : undefined) || media.stream_url;
      if (
        directUrl &&
        !directUrl.startsWith('/api/stream') &&
        !directUrl.includes('oceans.mp4') &&
        !directUrl.includes('flower.mp4') &&
        !directUrl.includes('sintel')
      ) {
        proxyVideoRange(req, res, directUrl);
        return;
      }

      if (!res.headersSent) {
        res.status(503).json({
          success: false,
          error: 'TORRENT_STREAM_UNAVAILABLE',
          message:
            'A fonte P2P selecionada não possui sementes ativas no momento. Use o botão Re-try no Painel de Rede ou selecione outra opção.'
        });
      }
    } catch (err: any) {
      console.error('[API /stream/:tmdbId] Erro fatal:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  });

  // 5.1 Streaming HTTP 206 direto por Magnet Link com fallback restrito à mesma qualidade e idioma
  app.get('/api/stream', async (req: Request, res: Response) => {
    const magnet = req.query.magnet as string;
    const altMagnetsRaw = req.query.altMagnets as string | undefined;
    const trackerPriority = parsePriorityMode(req.query.trackerPriority);
    const transcode = req.query.transcode === 'true';
    const audioOnly = req.query.audioOnly === 'true';
    const seekSeconds = req.query.seek ? parseFloat(req.query.seek as string) : undefined;
    const preferPortugueseAudio = req.query.preferPt !== 'false';
    const audioTrackIndex =
      req.query.audioTrack !== undefined
        ? parseInt(req.query.audioTrack as string, 10)
        : undefined;
    const season = req.query.season ? parseInt(req.query.season as string, 10) : undefined;
    const episode = req.query.episode ? parseInt(req.query.episode as string, 10) : undefined;
    const fileIdx = req.query.fileIdx ? parseInt(req.query.fileIdx as string, 10) : undefined;

    if (!magnet) {
      res.status(400).send('Magnet URI ausente.');
      return;
    }

    const magnetsToTry = [magnet];
    if (altMagnetsRaw) {
      try {
        const alts = JSON.parse(altMagnetsRaw);
        if (Array.isArray(alts)) {
          alts.forEach((m) => {
            if (typeof m === 'string' && m && !magnetsToTry.includes(m)) magnetsToTry.push(m);
          });
        }
      } catch { }
    }

    let orderedMagnets = magnetsToTry;
    if (!seekSeconds && magnetsToTry.length > 1) {
      const winnerMagnet = await torrentEngine.raceLiveCandidates(
        magnetsToTry.slice(0, 4),
        trackerPriority
      );
      if (winnerMagnet) {
        orderedMagnets = [winnerMagnet, ...magnetsToTry.filter((m) => m !== winnerMagnet)];
      }
    }

    for (const currentMagnet of orderedMagnets) {
      try {
        await torrentEngine.handleStreamRequest(
          req,
          res,
          currentMagnet,
          transcode,
          audioOnly,
          trackerPriority,
          {
            seekSeconds,
            preferPortugueseAudio,
            audioTrackIndex,
            season,
            episode,
            fileIdx
          }
        );
        return;
      } catch (err: any) {
        console.warn(`[Stream API] Falha na fonte P2P, tentando próxima alternativa da mesma qualidade/idioma: ${err.message}`);
        if (res.headersSent) return;
      }
    }

    if (!res.headersSent) {
      res.status(503).json({
        success: false,
        error: 'TORRENT_STREAM_UNAVAILABLE',
        message:
          'Não foi possível estabelecer conexão com o enxame deste torrent no momento. Forçe um Re-try de peers ou selecione outra fonte.'
      });
    }
  });

  // 6. Estatísticas reais em tempo real do stream (velocidade real, peers conectados, retries)
  app.get('/api/torrent/stats', (req: Request, res: Response) => {
    const magnet = req.query.magnet as string;
    if (!magnet) {
      res.status(400).json({ error: 'Magnet URI ausente' });
      return;
    }

    const stats = torrentEngine.getStats(magnet);
    res.json({ success: true, stats });
  });

  // 6.1 Pré-aquecimento silencioso de chunks de torrent em segundo plano
  app.get('/api/torrent/preload', async (req: Request, res: Response) => {
    const magnet = req.query.magnet as string;
    const trackerPriority = parsePriorityMode(req.query.trackerPriority);
    if (!magnet) {
      res.status(400).json({ error: 'Magnet URI ausente' });
      return;
    }
    torrentEngine.preload(magnet, trackerPriority).catch(() => { });
    res.json({ success: true, status: 'preloading_initiated' });
  });

  // 6.2 Sistema de Prefetch Inteligente (antecipa próximos 3-5 chunks do torrent)
  app.get('/api/torrent/prefetch', (req: Request, res: Response) => {
    const magnet = req.query.magnet as string;
    const currentTime = parseFloat(req.query.currentTime as string) || 0;
    const duration = parseFloat(req.query.duration as string) || 7200;
    const speed = parseFloat(req.query.speed as string) || 1024 * 1024 * 2;

    if (!magnet) {
      res.status(400).json({ error: 'Magnet URI ausente' });
      return;
    }

    const result = torrentEngine.prefetchNextPieces(magnet, currentTime, duration, speed);
    res.json(result);
  });

  // 7. Legendas reais (OpenSubtitles) — lista de faixas disponíveis para o título/episódio
  app.get('/api/subtitles/list', async (req: Request, res: Response) => {
    try {
      const imdbId = (req.query.imdbId as string) || '';
      const mediaType = (req.query.mediaType as string) || 'movie';
      const season = req.query.season ? parseInt(req.query.season as string, 10) : undefined;
      const episode = req.query.episode ? parseInt(req.query.episode as string, 10) : undefined;
      const fileName = (req.query.fileName as string) || undefined;

      const tracks = await subtitleService.listTracks({
        imdbId,
        type: mediaType === 'movie' ? 'movie' : 'series',
        season,
        episode,
        fileName
      });
      res.json({ success: true, tracks });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message, tracks: [] });
    }
  });

  // 7.1 Arquivo WebVTT de uma faixa previamente listada
  app.get('/api/subtitles/vtt', async (req: Request, res: Response) => {
    const id = (req.query.id as string) || '';
    const vtt = await subtitleService.getVtt(id);
    if (!vtt) {
      res.status(404).send('Legenda indisponível');
      return;
    }
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(vtt);
  });

  // 8. Proxy resiliente de imagens de capas
  app.get('/api/proxy-image', async (req: Request, res: Response) => {
    const url = req.query.url as string;
    if (!url) {
      res.status(400).send('URL ausente');
      return;
    }
    try {
      const upstream = await fetch(url);
      if (!upstream.ok) {
        res.status(upstream.status).end();
        return;
      }
      const contentType = upstream.headers.get('content-type') || 'image/jpeg';
      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=604800');
      const arrayBuffer = await upstream.arrayBuffer();
      res.send(Buffer.from(arrayBuffer));
    } catch {
      res.status(502).end();
    }
  });

  // 8.1 Geração de Código de Pareamento entre Dispositivos
  app.post('/api/sync/pair-code', (req: Request, res: Response) => {
    try {
      const { userId } = req.body;
      if (!userId) {
        res.status(400).json({ success: false, error: 'userId obrigatório' });
        return;
      }
      const code = syncService.generatePairCode(userId);
      res.json({ success: true, code, expiresInMinutes: 15 });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 8.2 Resgate de Código de Pareamento para vincular outro dispositivo
  app.post('/api/sync/pair-code/redeem', (req: Request, res: Response) => {
    try {
      const { code } = req.body;
      if (!code) {
        res.status(400).json({ success: false, error: 'Código de pareamento obrigatório' });
        return;
      }
      const user = syncService.redeemPairCode(code);
      if (!user) {
        res.status(404).json({ success: false, error: 'Código de pareamento inválido ou expirado.' });
        return;
      }
      res.json({ success: true, data: user });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 8.3 Sincronização em Nuvem Cross-Device (Histórico, Avaliações, Watchlist, Listas)
  app.get('/api/sync/:userId', (req: Request, res: Response) => {
    try {
      const userId = req.params.userId;
      const user = syncService.getUser(userId);
      if (!user) {
        res.json({ success: true, exists: false, data: null });
        return;
      }
      res.json({ success: true, exists: true, data: user });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/sync/:userId', (req: Request, res: Response) => {
    try {
      const userId = req.params.userId;
      const { email, clientData } = req.body;
      const merged = syncService.syncUserData(userId, email, clientData || {});
      res.json({ success: true, data: merged });
    } catch (err: any) {
      console.error('[API /sync/:userId] Erro:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 8.4 Autenticação e Gestão de Contas no SQLite
  app.post('/api/auth/register', (req: Request, res: Response) => {
    try {
      const { email, password, username, handle, avatarUrl, bannerUrl, bio } = req.body;
      const result = db.registerUser({ email, password, username, handle, avatarUrl, bannerUrl, bio });
      if (!result.success) {
        res.status(400).json(result);
        return;
      }
      res.json({ success: true, user: result.user });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.post('/api/auth/login', (req: Request, res: Response) => {
    try {
      const { email, password } = req.body;
      const result = db.loginUser(email, password);
      if (!result.success) {
        res.status(401).json(result);
        return;
      }
      res.json({ success: true, user: result.user });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  app.put('/api/auth/profile', (req: Request, res: Response) => {
    try {
      const { userId, username, handle, bio, avatarUrl, bannerUrl } = req.body;
      if (!userId) {
        res.status(400).json({ success: false, error: 'userId obrigatório' });
        return;
      }
      const updated = db.updateUserProfile(userId, { username, handle, bio, avatarUrl, bannerUrl });
      if (!updated) {
        res.status(404).json({ success: false, error: 'Usuário não encontrado' });
        return;
      }
      res.json({ success: true, user: updated });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Helper para Proxy HTTP 206 Partial Content com Range Requests
  function proxyVideoRange(req: Request, res: Response, videoUrl: string) {
    try {
      const parsed = new URL(videoUrl);
      const mod = parsed.protocol === 'https:' ? https : http;
      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      };
      if (req.headers.range) {
        headers['Range'] = req.headers.range;
      }
      const upstreamReq = mod.get(videoUrl, { headers }, (upstreamRes) => {
        res.status(upstreamRes.statusCode || 200);
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Accept-Ranges', 'bytes');
        if (upstreamRes.headers['content-range']) {
          res.setHeader('Content-Range', upstreamRes.headers['content-range']);
        }
        if (upstreamRes.headers['content-length']) {
          res.setHeader('Content-Length', upstreamRes.headers['content-length']);
        }
        res.setHeader('Content-Type', upstreamRes.headers['content-type'] || 'video/mp4');
        upstreamRes.pipe(res);
      });
      req.on('close', () => {
        try {
          upstreamReq.destroy();
        } catch { }
      });
      upstreamReq.on('error', () => {
        if (!res.headersSent) res.status(502).end();
      });
    } catch {
      if (!res.headersSent) res.status(400).end();
    }
  }

  // 9. Stream de vídeo sob demanda com suporte a HTTP 206 Partial Content (sem CORS)
  app.get('/api/stream-video', (req: Request, res: Response) => {
    const videoUrl = (req.query.url as string) || 'https://vjs.zencdn.net/v/oceans.mp4';
    proxyVideoRange(req, res, videoUrl);
  });

  // 10. Informações da Rede Local Wi-Fi (para Transmissão Smart TV / Web Video Caster / Celular)
  app.get('/api/network-info', (_req: Request, res: Response) => {
    const lanIp = getLocalLanIp();
    res.json({
      success: true,
      lanIp,
      port: PORT,
      lanOrigin: `http://${lanIp}:${PORT}`
    });
  });

  // 10.1 Receptor Smart TV & Ponte Web Video Caster / VLC (/tv)
  app.get('/tv', (req: Request, res: Response) => {
    const rawSrc = typeof req.query.src === 'string' ? req.query.src : '';
    const safeSrc = rawSrc.startsWith('/api/') ? rawSrc : '/api/stream';
    const rawTitle = typeof req.query.title === 'string' ? req.query.title : 'Popoca Streaming';
    const rawQuality = typeof req.query.quality === 'string' ? req.query.quality : '1080p';
    const rawLang = typeof req.query.lang === 'string' ? req.query.lang : 'PT-BR';
    const startTime = req.query.time ? Math.max(0, Math.floor(Number(req.query.time) || 0)) : 0;

    const escapedTitle = escapeHtmlAttr(rawTitle);
    const escapedQuality = escapeHtmlAttr(rawQuality);
    const escapedLang = escapeHtmlAttr(rawLang);
    const escapedSrcJson = JSON.stringify(safeSrc);
    const escapedTitleJson = JSON.stringify(rawTitle);

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1" />
  <title>${escapedTitle} · Popoca TV</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      background: #05070b;
      color: #fff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .topbar {
      padding: 14px 20px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      flex-wrap: wrap;
      background: rgba(14, 18, 26, 0.92);
      border-bottom: 1px solid rgba(255,255,255,0.08);
    }
    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      min-width: 0;
    }
    .badge {
      font-size: 11px;
      font-weight: 700;
      padding: 4px 10px;
      border-radius: 999px;
      background: rgba(16, 185, 129, 0.18);
      color: #34d399;
      border: 1px solid rgba(16, 185, 129, 0.35);
      white-space: nowrap;
    }
    .title {
      font-size: 15px;
      font-weight: 700;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .actions {
      display: flex;
      align-items: center;
      gap: 8px;
      flex-wrap: wrap;
    }
    .btn {
      appearance: none;
      border: 1px solid rgba(255,255,255,0.16);
      background: rgba(255,255,255,0.08);
      color: #fff;
      font-size: 12px;
      font-weight: 700;
      padding: 9px 14px;
      border-radius: 999px;
      text-decoration: none;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: transform 0.15s ease, background 0.15s ease;
    }
    .btn:hover { background: rgba(255,255,255,0.16); }
    .btn:active { transform: scale(0.97); }
    .btn-wvc {
      background: #10b981;
      color: #04130d;
      border-color: #34d399;
    }
    .btn-wvc:hover { background: #34d399; }
    .stage {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #000;
      position: relative;
    }
    video {
      width: 100%;
      height: calc(100vh - 64px);
      max-height: calc(100vh - 64px);
      background: #000;
      outline: none;
    }
  </style>
</head>
<body>
  <header class="topbar">
    <div class="brand">
      <span class="badge">POPOCA TV · ${escapedQuality} · ${escapedLang}</span>
      <span class="title">${escapedTitle}</span>
    </div>
    <div class="actions">
      <a id="wvcCallbackBtn" class="btn btn-wvc" href="#">Transmitir no Web Video Caster</a>
      <a id="wvcAndroidBtn" class="btn" href="#" style="display:none">App Android WVC</a>
      <a id="vlcBtn" class="btn" href="#">Abrir no VLC</a>
      <button id="fsBtn" class="btn" type="button">Tela Cheia</button>
    </div>
  </header>
  <main class="stage">
    <video id="tvPlayer" controls autoplay playsinline preload="auto"></video>
  </main>
  <script>
    (function () {
      var relSrc = ${escapedSrcJson};
      var mediaTitle = ${escapedTitleJson};
      var initialSec = ${startTime};
      var absStreamUrl = window.location.origin + relSrc;
      var player = document.getElementById('tvPlayer');
      player.src = absStreamUrl;

      player.addEventListener('loadedmetadata', function () {
        if (initialSec > 2 && isFinite(player.duration) && player.duration > initialSec + 5 && relSrc.indexOf('seek=') === -1) {
          try { player.currentTime = initialSec; } catch (e) {}
        }
      }, { once: true });

      var wvcUrl = 'wvc-x-callback://open?url=' + encodeURIComponent(absStreamUrl) + '&title=' + encodeURIComponent(mediaTitle);
      document.getElementById('wvcCallbackBtn').setAttribute('href', wvcUrl);

      if (/android/i.test(navigator.userAgent || '')) {
        var stripped = absStreamUrl.replace(/^https?:\\/\\//i, '');
        var scheme = absStreamUrl.indexOf('https://') === 0 ? 'https' : 'http';
        var intentUrl = 'intent://' + stripped + '#Intent;package=com.instantbits.cast.webvideo;scheme=' + scheme + ';S.title=' + encodeURIComponent(mediaTitle) + ';end';
        var androidBtn = document.getElementById('wvcAndroidBtn');
        androidBtn.style.display = 'inline-flex';
        androidBtn.setAttribute('href', intentUrl);
      }

      document.getElementById('vlcBtn').setAttribute('href', 'vlc://' + absStreamUrl);
      document.getElementById('fsBtn').addEventListener('click', function () {
        if (player.requestFullscreen) player.requestFullscreen();
        else if (player.webkitEnterFullscreen) player.webkitEnterFullscreen();
      });
    })();
  </script>
</body>
</html>`);
  });

  // Servidor Frontend Vite em Dev (com HMR / Live Reload integrado) ou Estático em Prod
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    app.use('*', async (req, res, next) => {
      // Deixa endpoints de API ou arquivos passarem direto
      if (req.originalUrl.startsWith('/api') || req.originalUrl.startsWith('/@') || req.originalUrl.includes('.')) {
        return next();
      }
      try {
        const indexPath = path.resolve(__dirname, 'index.html');
        let template = fs.readFileSync(indexPath, 'utf-8');
        template = await vite.transformIndexHtml(req.originalUrl, template);
        res.status(200).set({ 'Content-Type': 'text/html' }).end(template);
      } catch (e) {
        next(e);
      }
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    const lanIp = getLocalLanIp();
    console.log(`[Popoca] Servidor Live Reload (Vite + P2P) ativo em: http://localhost:${PORT}`);
    console.log(`[Popoca] Rede Wi-Fi Local (Smart TV / Web Video Caster): http://${lanIp}:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('[Popoca] Erro crítico na inicialização:', err);
  process.exit(1);
});
