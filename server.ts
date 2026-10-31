/**
 * Popoca Streaming - Servidor de Mídia Full-Stack
 * Backend Node.js Express de altíssimo desempenho para streaming de torrents,
 * integração TMDB pt-BR e servidor de desenvolvimento Vite integrado.
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import path from 'path';
import http from 'http';
import https from 'https';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { tmdbService } from './server/tmdbService.ts';
import { indexerService } from './server/indexerService.ts';
import { torrentEngine } from './server/torrentEngine.ts';
import { subtitleService } from './server/subtitleService.ts';
import { syncService } from './server/syncService.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function bootstrap() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;

  app.use(cors());
  app.use(express.json());

  // 1. Catálogo com prioridade pt-BR (Em Alta, Filmes, Séries, Animes)
  app.get('/api/catalog', async (req: Request, res: Response) => {
    try {
      const category = (req.query.category as string) || 'trending';
      const page = parseInt(req.query.page as string, 10) || 1;
      const items = await tmdbService.getCatalog(category, page);
      res.json({ success: true, category, items });
    } catch (err: any) {
      console.error('[API /catalog] Erro:', err);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. Busca dinâmica
  app.get('/api/search', async (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string) || '';
      const results = await tmdbService.search(q);
      res.json({ success: true, count: results.length, results });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2.1 Sugestões de busca preditiva instantânea
  app.get('/api/search/suggestions', async (req: Request, res: Response) => {
    try {
      const q = (req.query.q as string) || '';
      const suggestions = await tmdbService.getSuggestions(q);
      res.json({ success: true, suggestions });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. Detalhes completos do título
  app.get('/api/details/:id', async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const type = (req.query.type as 'movie' | 'tv' | 'anime') || 'movie';
      const details = await tmdbService.getDetails(id, type);
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
      const episodes = await tmdbService.getSeasonEpisodes(id, seasonNumber);
      res.json({ success: true, seriesId: id, seasonNumber, episodes });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. Provedores e indexador de torrents (YTS, Popcorn API, Torrentio)
  app.get('/api/torrents', async (req: Request, res: Response) => {
    try {
      const title = (req.query.title as string) || '';
      const year = req.query.year as string | undefined;
      const imdbId = req.query.imdbId as string | undefined;
      const mediaType = (req.query.mediaType as 'movie' | 'tv' | 'anime') || 'movie';
      const season = req.query.season ? parseInt(req.query.season as string, 10) : undefined;
      const episode = req.query.episode ? parseInt(req.query.episode as string, 10) : undefined;

      if (!title) {
        res.status(400).json({ success: false, error: 'Parâmetro title é obrigatório' });
        return;
      }
      const torrents = await indexerService.findTorrents(title, year, imdbId, mediaType, season, episode);
      res.json({ success: true, count: torrents.length, torrents });
    } catch (err: any) {
      console.error('[API /torrents] Erro no scraper:', err);
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
      const transcode = req.query.transcode === 'true';
      const audioOnly = req.query.audioOnly === 'true';

      // 1. Localiza metadados do TMDB
      const media = await tmdbService.getDetails(tmdbId, mediaType);
      if (!media) {
        res.status(404).send('Título TMDB não encontrado.');
        return;
      }

      const year = media.release_date ? media.release_date.slice(0, 4) : undefined;

      // 2. Consulta agregadores (Torrentio, YTS, Cinemeta) e escolhe o melhor torrent (maior seeds em 1080p/720p)
      const torrents = await indexerService.findTorrents({
        title: media.title,
        year,
        imdbId: media.imdb_id,
        mediaType: media.media_type,
        season,
        episode
      });

      const bestTorrent = torrents.find(t => t.magnetUri && t.seeds > 0) || torrents[0];

      if (bestTorrent && bestTorrent.magnetUri) {
        console.log(`[TMDB Stream] Mapeando ID ${tmdbId} (${media.title}) para torrent ${bestTorrent.quality} (${bestTorrent.seeds} seeds, ${bestTorrent.sizeFormatted})`);
        try {
          await torrentEngine.handleStreamRequest(req, res, bestTorrent.magnetUri, transcode, audioOnly);
          return;
        } catch (torrentErr) {
          console.warn(`[TMDB Stream] Falha no torrent P2P, chaveando para stream direto resiliente:`, torrentErr);
        }
      }

      // 3. Fallback somente se houver URL direta válida (não placeholder)
      const directUrl = (episode && media.seasons ? media.seasons.flatMap(s => s.episodes).find(e => e.episodeNumber === episode)?.streamUrl : undefined) || media.stream_url;
      if (directUrl && !directUrl.includes('oceans.mp4') && !directUrl.includes('flower.mp4') && !directUrl.includes('sintel')) {
        proxyVideoRange(req, res, directUrl);
        return;
      }

      res.status(503).json({
        success: false,
        error: 'TORRENT_STREAM_UNAVAILABLE',
        message: 'A fonte P2P selecionada não possui sementes ativas no momento. Por favor selecione outra opção na lista de torrents (ex: 1080p WEB-DL Dublado PT-BR).'
      });
    } catch (err: any) {
      console.error('[API /stream/:tmdbId] Erro fatal:', err);
      if (!res.headersSent) {
        res.status(500).json({ success: false, error: err.message });
      }
    }
  });

  // 5.1 Streaming HTTP 206 direto por Magnet Link
  app.get('/api/stream', async (req: Request, res: Response) => {
    const magnet = req.query.magnet as string;
    const transcode = req.query.transcode === 'true';
    const audioOnly = req.query.audioOnly === 'true';

    if (!magnet) {
      res.status(400).send('Magnet URI ausente.');
      return;
    }

    try {
      await torrentEngine.handleStreamRequest(req, res, magnet, transcode, audioOnly);
    } catch (err: any) {
      console.warn(`[Stream API] Falha no engine torrent P2P: ${err.message}`);
      if (!res.headersSent) {
        res.status(503).json({
          success: false,
          error: 'TORRENT_STREAM_UNAVAILABLE',
          message: 'Não foi possível estabelecer conexão com o enxame deste torrent. Tente outra fonte com mais seeds ou formato alternativo.'
        });
      }
    }
  });

  // 6. Estatísticas em tempo real do stream (velocidade, sementes, buffer)
  app.get('/api/torrent/stats', (req: Request, res: Response) => {
    const magnet = req.query.magnet as string;
    if (!magnet) {
      res.status(400).json({ error: 'Magnet URI ausente' });
      return;
    }

    const stats = torrentEngine.getStats(magnet);
    res.json({ success: true, stats });
  });

  // 7. Legendas WebVTT (.vtt) sincronizadas
  app.get('/api/subtitles', (req: Request, res: Response) => {
    const title = (req.query.title as string) || 'Filme Popoca';
    const lang = (req.query.lang as string) || 'pt-BR';
    const vtt = subtitleService.getTrack(title, lang);

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
        try { upstreamReq.destroy(); } catch {}
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

  // Servidor Frontend Vite em Dev ou Estático em Prod
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Popoca] Servidor de streaming ativo na porta ${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('[Popoca] Erro crítico na inicialização:', err);
  process.exit(1);
});
