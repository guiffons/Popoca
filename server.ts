/**
 * Popoca Streaming - Servidor de Mídia Full-Stack
 * Backend Node.js Express de altíssimo desempenho para streaming de torrents,
 * segurança web endurecida (Helmet, Rate Limiter, CORS restrito, Sessões Bearer, SSRF Protection),
 * seletor de prioridade de trackers PT-BR e servidor de desenvolvimento Vite integrado.
 */

import express, { type Request, type Response, type NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import compression from 'compression';
import fs from 'fs';
import os from 'os';
import path from 'path';
import http from 'http';
import https from 'https';
import dns from 'dns';
import stream from 'stream';
import { fileURLToPath } from 'url';
import { tmdbService } from './server/tmdbService.ts';
import {
  indexerService,
  selectQualityCappedCandidates,
  normalizeQuality,
  type TrackerPriorityMode
} from './server/indexerService.ts';
import { torrentEngine, parseTorrentBuffer } from './server/torrentEngine.ts';
import { subtitleService } from './server/subtitleService.ts';
import { syncService } from './server/syncService.ts';
import { db, toSafeUser, type DbUser } from './server/database.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Tratamento de exceções com registro estruturado
process.on('uncaughtException', (err) => {
  console.error('[Popoca CRITICAL] Erro não tratado no processo:', {
    message: err?.message,
    stack: err?.stack,
    time: new Date().toISOString()
  });
});

process.on('unhandledRejection', (reason: any) => {
  console.error('[Popoca WARN] Promessa rejeitada não tratada:', {
    reason: reason?.message || reason,
    time: new Date().toISOString()
  });
});

// ===== Limpeza automática de cache gerenciada de forma segura pelo TorrentEngine =====
torrentEngine.pruneDiskCache();

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
  } catch {}
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

// ===== VALIDAÇÃO DE ENTRADA SEGURA =====

function parseSafeInt(val: unknown, fallback: number, min?: number, max?: number): number {
  const n = typeof val === 'number' ? Math.floor(val) : parseInt(String(val), 10);
  if (isNaN(n) || !Number.isFinite(n)) return fallback;
  if (min !== undefined && n < min) return min;
  if (max !== undefined && n > max) return max;
  return n;
}

function parseSafeFloat(val: unknown, fallback: number, min?: number, max?: number): number {
  const n = typeof val === 'number' ? val : parseFloat(String(val));
  if (isNaN(n) || !Number.isFinite(n)) return fallback;
  if (min !== undefined && n < min) return min;
  if (max !== undefined && n > max) return max;
  return n;
}

const STRICT_MAGNET_REGEX = /^magnet:\?(?:[^&\s]*&)*xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})(?:[&#]|$)/i;
const MAX_MAGNET_LENGTH = 4096;

export function validateMagnet(magnet: unknown): { valid: boolean; error?: string } {
  if (typeof magnet !== 'string' || !magnet.trim()) {
    return { valid: false, error: 'Magnet URI ausente.' };
  }
  const clean = magnet.trim();
  if (clean.length > MAX_MAGNET_LENGTH) {
    return { valid: false, error: `Magnet URI excede o limite de segurança (${MAX_MAGNET_LENGTH} caracteres).` };
  }
  if (!clean.startsWith('magnet:?')) {
    return { valid: false, error: 'Formato inválido de link Magnet (deve iniciar com magnet:?).' };
  }
  if (!STRICT_MAGNET_REGEX.test(clean)) {
    return { valid: false, error: 'Magnet URI não contém um infoHash BTIH válido (xt=urn:btih:).' };
  }
  return { valid: true };
}

// Resposta de erro segura para produção
function sendSafeError(res: Response, status: number, userMessage: string, internalError?: any) {
  if (res.headersSent) return;
  if (internalError) {
    console.error(`[Popoca HTTP ${status}]`, internalError?.message || internalError);
  }
  const error = process.env.NODE_ENV === 'production' ? userMessage : (internalError?.message || userMessage);
  res.status(status).json({ success: false, error });
}

// ===== PROTEÇÃO CONTRA SSRF (ALLOWLIST DE HOSTS + BLOQUEIO DE IPS PRIVADOS) =====

const ALLOWED_IMAGE_HOSTS = new Set([
  'image.tmdb.org',
  'images.metahub.space',
  'images.unsplash.com',
  'avatars.githubusercontent.com',
  'm.media-amazon.com',
  'img.youtube.com'
]);

function isPrivateIp(ip: string): boolean {
  if (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('127.') ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip) ||
    ip.startsWith('fc00:') ||
    ip.startsWith('fe80:') ||
    ip === '0.0.0.0'
  ) {
    return true;
  }
  return false;
}

async function validateSafeHttpsUrl(
  rawUrl: string,
  allowedHosts?: Set<string>
): Promise<{ valid: boolean; url?: URL; error?: string }> {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== 'https:') {
      return { valid: false, error: 'Apenas conexões HTTPS são permitidas.' };
    }
    if (allowedHosts && !allowedHosts.has(parsed.hostname.toLowerCase())) {
      return { valid: false, error: `Host não autorizado no proxy: ${parsed.hostname}` };
    }

    const lookup = await dns.promises.lookup(parsed.hostname);
    if (isPrivateIp(lookup.address)) {
      return { valid: false, error: 'Destino inválido (endereço IP privado ou reservado).' };
    }
    return { valid: true, url: parsed };
  } catch (err: any) {
    return { valid: false, error: 'URL inválida ou inalcançável.' };
  }
}

// ===== RATE LIMITER EM MEMÓRIA POR IP =====

interface RateBucket {
  count: number;
  resetAt: number;
}

function createRateLimiter(windowMs: number, maxRequests: number, message: string) {
  const ipMap = new Map<string, RateBucket>();
  setInterval(() => {
    const now = Date.now();
    for (const [ip, b] of ipMap.entries()) {
      if (now > b.resetAt) ipMap.delete(ip);
    }
  }, 5 * 60 * 1000).unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const rawIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1');
    const ip = rawIp.split(',')[0].trim();
    const now = Date.now();
    let bucket = ipMap.get(ip);
    if (!bucket || now > bucket.resetAt) {
      bucket = { count: 1, resetAt: now + windowMs };
      ipMap.set(ip, bucket);
      return next();
    }
    bucket.count++;
    if (bucket.count > maxRequests) {
      res.setHeader('Retry-After', Math.ceil((bucket.resetAt - now) / 1000));
      return res.status(429).json({
        success: false,
        error: 'RATE_LIMIT_EXCEEDED',
        message
      });
    }
    next();
  };
}

const authLimiter = createRateLimiter(60 * 1000, 30, 'Muitas tentativas de autenticação. Aguarde um minuto.');
const rawStreamLimiter = createRateLimiter(60 * 1000, 600, 'Muitas requisições de reprodução simultâneas.');
const streamLimiter = (req: Request, res: Response, next: NextFunction) => {
  const range = req.headers.range;
  if (typeof range === 'string' && range.startsWith('bytes=') && !range.startsWith('bytes=0-')) {
    return next();
  }
  return rawStreamLimiter(req, res, next);
};

// ===== AUTORIZAÇÃO E SESSÕES =====

export interface AuthenticatedRequest extends Request {
  user?: DbUser;
}

function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      success: false,
      error: 'UNAUTHORIZED',
      message: 'Autenticação necessária. Envie o cabeçalho Authorization: Bearer <token>.'
    });
  }

  const token = authHeader.slice(7).trim();
  const user = db.validateSession(token);
  if (!user) {
    return res.status(401).json({
      success: false,
      error: 'INVALID_TOKEN',
      message: 'Sessão inválida ou expirada. Faça login novamente.'
    });
  }

  req.user = user;
  next();
}

/**
 * Cache em memória com TTL + deduplicação de requisições em andamento.
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

  // 1. Helmet para cabeçalhos HTTP defensivos
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' }
    })
  );

  // 2. CORS com validacao explicita do dominio da Vercel (popocas.vercel.app) e ambientes locais
  const allowedOriginsEnv = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map((s) => s.trim().toLowerCase())
    : [];

  app.use(
    cors({
      origin: (origin, callback) => {
        if (!origin) return callback(null, true);
        const lower = origin.toLowerCase();
        if (
          lower === 'https://popocas.vercel.app' ||
          lower.endsWith('.vercel.app') ||
          lower.startsWith('http://localhost:') ||
          lower.startsWith('http://127.0.0.1:') ||
          lower.startsWith('http://192.168.') ||
          lower.startsWith('http://10.') ||
          lower.startsWith('https://ais-') ||
          allowedOriginsEnv.includes(lower)
        ) {
          return callback(null, true);
        }
        return callback(null, false);
      },
      credentials: true,
      exposedHeaders: [
        'X-Popoca-Stream-Mode',
        'X-Popoca-Active-Hash',
        'X-Popoca-Audio-Hash',
        'X-Popoca-Real-Lang',
        'X-Popoca-Quality-Fallback',
        'X-Popoca-Fallback-Message',
        'Content-Range',
        'Accept-Ranges'
      ]
    })
  );

  // 3. Compressão de respostas HTTP com bypass para vídeo/áudio streaming e SSE
  app.use(
    compression({
      filter: (req: Request, res: Response) => {
        const contentType = res.getHeader('Content-Type');
        if (
          typeof contentType === 'string' &&
          (contentType.startsWith('video/') || contentType.startsWith('audio/'))
        ) {
          return false;
        }
        if (
          req.url.startsWith('/api/torrent/stream') ||
          req.url.startsWith('/api/stream') ||
          req.url.startsWith('/api/proxy-image')
        ) {
          return false;
        }
        if (req.headers['x-no-compression'] || req.headers.accept === 'text/event-stream') {
          return false;
        }
        return compression.filter(req, res);
      },
      threshold: 1024
    })
  );

  app.use(express.json({ limit: '2mb' }));

  // Log enxuto para diagnóstico de rede local
  app.use((req, _res, next) => {
    if (
      req.url.startsWith('/api/') &&
      !/^\/api\/(torrent\/stats|stream\/stats|stats|network)/.test(req.url)
    ) {
      const remoteIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip;
      console.log(`[Rede Popoca] ${req.method} ${req.url.slice(0, 140)} de ${remoteIp}`);
    }
    next();
  });

  // ===== AUTENTICAÇÃO E CONTAS (SEGURO COM SESSÕES BEARER) =====

  app.post('/api/auth/register', authLimiter, (req: Request, res: Response) => {
    try {
      const { email, password, username, handle, avatarUrl, bannerUrl, bio } = req.body || {};
      const result = db.registerUser({ email, password, username, handle, avatarUrl, bannerUrl, bio });
      if (!result.success) {
        res.status(400).json(result);
        return;
      }
      res.json({ success: true, user: result.user, token: result.token });
    } catch (err: any) {
      sendSafeError(res, 500, 'Erro ao criar conta.', err);
    }
  });

  app.post('/api/auth/login', authLimiter, (req: Request, res: Response) => {
    try {
      const { email, password } = req.body || {};
      const result = db.loginUser(email, password);
      if (!result.success) {
        res.status(401).json(result);
        return;
      }
      res.json({ success: true, user: result.user, token: result.token });
    } catch (err: any) {
      sendSafeError(res, 500, 'Erro ao realizar login.', err);
    }
  });

  // Criação de sessão de convidado anônima isolada
  app.post('/api/auth/guest', authLimiter, (_req: Request, res: Response) => {
    try {
      const guest = db.createGuestUser();
      res.json(guest);
    } catch (err: any) {
      sendSafeError(res, 500, 'Erro ao criar sessão de convidado.', err);
    }
  });

  // Dados do usuário autenticado atual
  app.get('/api/auth/me', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    res.json({ success: true, user: toSafeUser(req.user!) });
  });

  // Encerramento de sessão
  app.post('/api/auth/logout', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      db.deleteSession(authHeader.slice(7).trim());
    }
    res.json({ success: true, message: 'Sessão encerrada com sucesso.' });
  });

  // Atualização de perfil protegida (impede IDOR)
  app.put('/api/auth/profile', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const { username, handle, bio, avatarUrl, bannerUrl } = req.body || {};
      const updated = db.updateUserProfile(req.user!.id, { username, handle, bio, avatarUrl, bannerUrl });
      if (!updated) {
        res.status(404).json({ success: false, error: 'Usuário não encontrado' });
        return;
      }
      res.json({ success: true, user: updated });
    } catch (err: any) {
      sendSafeError(res, 500, 'Erro ao atualizar perfil.', err);
    }
  });

  // ===== SINCRONIZAÇÃO EM NUVEM E PAREAMENTO (PROTEGIDO CONTRA IDOR) =====

  app.get('/api/sync', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const userSync = syncService.getUser(req.user!.id);
      res.json({ success: true, exists: true, data: userSync });
    } catch (err: any) {
      sendSafeError(res, 500, 'Erro ao recuperar dados da nuvem.', err);
    }
  });

  app.post('/api/sync', requireAuth, (req: AuthenticatedRequest, res: Response) => {
    try {
      const { clientData } = req.body || {};
      const merged = syncService.syncUserData(req.user!.id, clientData || {});
      res.json({ success: true, data: merged });
    } catch (err: any) {
      sendSafeError(res, 500, 'Erro ao sincronizar dados.', err);
    }
  });

  // Geração de código de pareamento (vinculado ao token da sessão)
  app.post('/api/sync/pair-code', requireAuth, authLimiter, (req: AuthenticatedRequest, res: Response) => {
    try {
      const code = syncService.generatePairCode(req.user!.id);
      res.json({ success: true, code, expiresInMinutes: 15 });
    } catch (err: any) {
      sendSafeError(res, 500, 'Erro ao gerar código de pareamento.', err);
    }
  });

  // Resgate de código de pareamento (emite token de sessão)
  app.post('/api/sync/pair-code/redeem', authLimiter, (req: Request, res: Response) => {
    try {
      const { code } = req.body || {};
      if (!code || typeof code !== 'string') {
        res.status(400).json({ success: false, error: 'Código de pareamento obrigatório' });
        return;
      }
      const redeemed = syncService.redeemPairCode(code);
      if (!redeemed) {
        res.status(404).json({ success: false, error: 'Código de pareamento inválido ou expirado.' });
        return;
      }
      res.json({ success: true, token: redeemed.token, user: redeemed.user, data: redeemed.data });
    } catch (err: any) {
      sendSafeError(res, 500, 'Erro ao vincular dispositivo.', err);
    }
  });

  // ===== CATÁLOGO E BUSCA TMDB =====

  app.get('/api/catalog', async (req: Request, res: Response) => {
    try {
      const category = (req.query.category as string) || 'trending';
      const page = parseSafeInt(req.query.page, 1, 1, 100);
      const items = await cachedFetch(
        `catalog|${category}|${page}`,
        30 * MIN,
        () => tmdbService.getCatalog(category, page),
        (v) => Array.isArray(v) && v.length > 0
      );
      res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=1800');
      res.json({ success: true, category, items });
    } catch (err: any) {
      sendSafeError(res, 500, 'Erro ao carregar catálogo.', err);
    }
  });

  app.get('/api/search', async (req: Request, res: Response) => {
    try {
      const q = String(req.query.q || '').slice(0, 100);
      const results = await cachedFetch(
        `search|${q.trim().toLowerCase()}`,
        10 * MIN,
        () => tmdbService.search(q),
        (v) => Array.isArray(v) && v.length > 0
      );
      res.json({ success: true, count: results.length, results });
    } catch (err: any) {
      sendSafeError(res, 500, 'Erro ao buscar títulos.', err);
    }
  });

  app.get('/api/search/suggestions', async (req: Request, res: Response) => {
    try {
      const q = String(req.query.q || '').slice(0, 100);
      const suggestions = await tmdbService.getSuggestions(q);
      res.json({ success: true, suggestions });
    } catch (err: any) {
      sendSafeError(res, 500, 'Erro ao buscar sugestões.', err);
    }
  });

  app.get('/api/details/:id', async (req: Request, res: Response) => {
    try {
      const id = parseSafeInt(req.params.id, 0, 1);
      if (!id) {
        res.status(400).json({ success: false, error: 'ID inválido.' });
        return;
      }
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
      sendSafeError(res, 500, 'Erro ao carregar detalhes.', err);
    }
  });

  app.get('/api/series/:id/season/:seasonNumber', async (req: Request, res: Response) => {
    try {
      const id = parseSafeInt(req.params.id, 0, 1);
      const seasonNumber = parseSafeInt(req.params.seasonNumber, 1, 1, 100);
      if (!id) {
        res.status(400).json({ success: false, error: 'ID da série inválido.' });
        return;
      }
      const episodes = await cachedFetch(
        `season|${id}|${seasonNumber}`,
        6 * 60 * MIN,
        () => tmdbService.getSeasonEpisodes(id, seasonNumber),
        (v) => Array.isArray(v) && v.length > 0
      );
      res.json({ success: true, seriesId: id, seasonNumber, episodes });
    } catch (err: any) {
      sendSafeError(res, 500, 'Erro ao buscar episódios.', err);
    }
  });

  // ===== INDEXAÇÃO E METADADOS DE TORRENTS =====

  app.get('/api/torrents', async (req: Request, res: Response) => {
    try {
      const title = String(req.query.title || '').slice(0, 140);
      const originalTitle = req.query.originalTitle ? String(req.query.originalTitle).slice(0, 140) : undefined;
      const year = req.query.year ? String(req.query.year).slice(0, 4) : undefined;
      let imdbId = req.query.imdbId ? String(req.query.imdbId).slice(0, 20) : undefined;
      const tmdbId = req.query.tmdbId ? parseSafeInt(req.query.tmdbId, 0, 1) : 0;
      const mediaType = (req.query.mediaType as 'movie' | 'tv' | 'anime') || 'movie';
      const season = req.query.season ? parseSafeInt(req.query.season, 1, 1, 100) : undefined;
      const episode = req.query.episode ? parseSafeInt(req.query.episode, 1, 1, 1000) : undefined;
      const trackerPriority = parsePriorityMode(req.query.trackerPriority);

      if (!imdbId && tmdbId > 0) {
        try {
          const details = await tmdbService.getDetails(tmdbId, mediaType);
          if (details?.imdb_id) {
            imdbId = details.imdb_id;
          }
        } catch {}
      }

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
      sendSafeError(res, 500, 'Erro ao indexar torrents.', err);
    }
  });

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
    if (magnet) {
      const magCheck = validateMagnet(magnet);
      if (!magCheck.valid) {
        res.status(400).json({ success: false, error: magCheck.error });
        return;
      }
    }
    indexerService.setTrackerPriority(mode);
    torrentEngine.setTrackerPriority(mode, magnet);
    res.json({ success: true, trackerPriority: mode });
  });

  app.post('/api/torrent/retry', async (req: Request, res: Response) => {
    try {
      const magnet = req.body?.magnet as string;
      const trackerPriority = parsePriorityMode(req.body?.trackerPriority);
      const magCheck = validateMagnet(magnet);
      if (!magCheck.valid) {
        res.status(400).json({ success: false, error: magCheck.error });
        return;
      }
      const result = await torrentEngine.forceRetryPeers(magnet, trackerPriority);
      res.json(result);
    } catch (err: any) {
      sendSafeError(res, 500, 'Erro ao reconectar aos peers.', err);
    }
  });

  app.post('/api/torrent/destroy', (req: Request, res: Response) => {
    try {
      const magnet = req.body?.magnet as string | undefined;
      const infoHash = req.body?.infoHash as string | undefined;

      let hash: string | null = null;
      if (magnet) {
        const magCheck = validateMagnet(magnet);
        if (magCheck.valid) {
          const match = magnet.match(/btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i);
          if (match) hash = match[1].toLowerCase();
        }
      } else if (infoHash && typeof infoHash === 'string') {
        const trimmed = infoHash.trim();
        if (/^[a-fA-F0-9]{40}$/.test(trimmed) || /^[a-zA-Z2-7]{32}$/.test(trimmed)) {
          hash = trimmed.toLowerCase();
        }
      }

      if (hash) {
        torrentEngine.destroyEngine(hash, false);
        res.json({ success: true, destroyedHash: hash });
      } else {
        res.status(400).json({ success: false, error: 'Magnet URI ou infoHash válido é obrigatório.' });
      }
    } catch (err: any) {
      sendSafeError(res, 500, 'Erro ao destruir motor torrent.', err);
    }
  });

  // ===== STREAMING DE VÍDEO HTTP 206 (COM CONTROLE DE CAPACIDADE E RATE LIMIT) =====

  // ===== FASE 3: ROTA DE MUXING HIBRIDO EM TEMPO REAL (VIDEO 4K/1080P EN + AUDIO 720P PT-BR) =====

  app.get('/api/stream/hybrid', streamLimiter, async (req: Request, res: Response) => {
    try {
      const videoMagnet = req.query.videoMagnet as string;
      const audioMagnet = req.query.audioMagnet as string;

      const vCheck = validateMagnet(videoMagnet);
      if (!vCheck.valid) {
        res.status(400).json({ success: false, error: `videoMagnet inválido: ${vCheck.error}` });
        return;
      }
      const aCheck = validateMagnet(audioMagnet);
      if (!aCheck.valid) {
        res.status(400).json({ success: false, error: `audioMagnet inválido: ${aCheck.error}` });
        return;
      }

      const seekSeconds = req.query.seek ? parseSafeFloat(req.query.seek, 0, 0, 86400) : undefined;
      const audioDelayMs = req.query.audioDelayMs
        ? parseSafeFloat(req.query.audioDelayMs, 0, -2000, 2000)
        : undefined;
      const trackerPriority = parsePriorityMode(req.query.trackerPriority);
      const season = req.query.season ? parseSafeInt(req.query.season, 1, 1, 100) : undefined;
      const episode = req.query.episode ? parseSafeInt(req.query.episode, 1, 1, 1000) : undefined;

      await torrentEngine.handleHybridStreamRequest(req, res, videoMagnet, audioMagnet, {
        seekSeconds,
        audioDelayMs,
        trackerPriority,
        season,
        episode
      });
    } catch (err: any) {
      if (!res.headersSent) {
        sendSafeError(res, 503, 'Não foi possível iniciar o Muxing Híbrido em tempo real.', err);
      }
    }
  });

  // ===== STREAMING DE VIDEO HTTP 206 (COM QUALITY CAP E HEALTH CHECK DE 5S) =====

  app.get('/api/stream/:tmdbId', streamLimiter, async (req: Request, res: Response) => {
    try {
      const tmdbId = parseSafeInt(req.params.tmdbId, 0, 1);
      if (!tmdbId) {
        res.status(400).json({ success: false, error: 'ID TMDB inválido.' });
        return;
      }

      const mediaType = (req.query.mediaType as 'movie' | 'tv' | 'anime') || 'movie';
      const season = req.query.season ? parseSafeInt(req.query.season, 1, 1, 100) : undefined;
      const episode = req.query.episode ? parseSafeInt(req.query.episode, 1, 1, 1000) : undefined;
      const preferredQuality = req.query.quality as string | undefined;
      const trackerPriority = parsePriorityMode(req.query.trackerPriority);
      const transcode = req.query.transcode === 'true';
      const audioOnly = req.query.audioOnly === 'true';
      const seekSeconds = req.query.seek ? parseSafeFloat(req.query.seek, 0, 0, 86400) : undefined;
      const preferPortugueseAudio = req.query.preferPt !== 'false';
      const audioTrackIndex =
        req.query.audioTrack !== undefined
          ? parseSafeInt(req.query.audioTrack, 0, 0, 20)
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

      const {
        requestedQuality,
        primaryCandidates,
        fallbackCandidates,
        fallbackQuality
      } = selectQualityCappedCandidates(torrents, preferredQuality, preferPortugueseAudio);

      const topCandidates = primaryCandidates.slice(0, 3);
      const bestFallback = fallbackCandidates[0];

      for (let idx = 0; idx < topCandidates.length; idx++) {
        const candidate = topCandidates[idx];
        const isLastPrimary = idx === topCandidates.length - 1;
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
              fileIdx: candidate.fileIdx,
              preferredQuality: requestedQuality,
              fallbackMagnet: isLastPrimary ? bestFallback?.magnetUri : undefined,
              fallbackQuality: isLastPrimary ? fallbackQuality || undefined : undefined,
              fallbackFileIdx: isLastPrimary ? bestFallback?.fileIdx : undefined,
              hasAlternatives: !isLastPrimary || Boolean(bestFallback)
            }
          );
          return;
        } catch (err: any) {
          if (err?.message === 'SERVER_CAPACITY_REACHED') {
            res.status(429).json({
              success: false,
              error: 'SERVER_CAPACITY_REACHED',
              message: 'Limite de reproduções simultâneas atingido no servidor. Tente novamente em instantes.'
            });
            return;
          }
          if (res.headersSent) return;
        }
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
      sendSafeError(res, 500, 'Erro ao processar stream TMDB.', err);
    }
  });

  app.get('/api/stream', streamLimiter, async (req: Request, res: Response) => {
    const magnet = req.query.magnet as string;
    const magCheck = validateMagnet(magnet);
    if (!magCheck.valid) {
      res.status(400).json({ success: false, error: magCheck.error });
      return;
    }

    const altMagnetsRaw = req.query.altMagnets as string | undefined;
    const fallbackMagnetRaw = req.query.fallbackMagnet as string | undefined;
    const fallbackQuality = req.query.fallbackQuality ? normalizeQuality(String(req.query.fallbackQuality)) : undefined;
    const preferredQuality = req.query.quality ? normalizeQuality(String(req.query.quality)) : undefined;
    const trackerPriority = parsePriorityMode(req.query.trackerPriority);
    const transcode = req.query.transcode === 'true';
    const audioOnly = req.query.audioOnly === 'true';
    const seekSeconds = req.query.seek ? parseSafeFloat(req.query.seek, 0, 0, 86400) : undefined;
    const preferPortugueseAudio = req.query.preferPt !== 'false';
    const audioTrackIndex =
      req.query.audioTrack !== undefined
        ? parseSafeInt(req.query.audioTrack, 0, 0, 20)
        : undefined;
    const season = req.query.season ? parseSafeInt(req.query.season, 1, 1, 100) : undefined;
    const episode = req.query.episode ? parseSafeInt(req.query.episode, 1, 1, 1000) : undefined;
    const fileIdx = req.query.fileIdx ? parseSafeInt(req.query.fileIdx, 0, 0, 500) : undefined;

    const validFallbackMagnet =
      fallbackMagnetRaw && validateMagnet(fallbackMagnetRaw).valid ? fallbackMagnetRaw : undefined;

    const magnetsToTry = [magnet];
    if (altMagnetsRaw) {
      try {
        const alts = JSON.parse(altMagnetsRaw);
        if (Array.isArray(alts)) {
          alts.forEach((m) => {
            if (typeof m === 'string' && validateMagnet(m).valid && !magnetsToTry.includes(m)) {
              magnetsToTry.push(m);
            }
          });
        }
      } catch {}
    }

    for (let i = 0; i < magnetsToTry.length; i++) {
      const currentMagnet = magnetsToTry[i];
      const isLastSameQuality = i === magnetsToTry.length - 1;
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
            fileIdx: i === 0 ? fileIdx : undefined,
            preferredQuality,
            fallbackMagnet: isLastSameQuality ? validFallbackMagnet : undefined,
            fallbackQuality: isLastSameQuality ? fallbackQuality || '720p' : undefined,
            hasAlternatives: !isLastSameQuality || Boolean(validFallbackMagnet)
          }
        );
        return;
      } catch (err: any) {
        if (err?.message === 'SERVER_CAPACITY_REACHED') {
          res.status(429).json({
            success: false,
            error: 'SERVER_CAPACITY_REACHED',
            message: 'Limite de reproduções simultâneas atingido no servidor. Tente novamente em instantes.'
          });
          return;
        }
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

  app.get('/api/torrent/stats', (req: Request, res: Response) => {
    const magnet = req.query.magnet as string;
    const magCheck = validateMagnet(magnet);
    if (!magCheck.valid) {
      res.status(400).json({ error: magCheck.error });
      return;
    }
    const stats = torrentEngine.getStats(magnet);
    res.json({ success: true, stats });
  });

  app.get('/api/torrent/stats/:hash', (req: Request, res: Response) => {
    const hash = req.params.hash as string;
    if (!hash || !/^[a-fA-F0-9]{40}$/.test(hash)) {
      res.status(400).json({ error: 'Hash hexadecimal de 40 caracteres inválido.' });
      return;
    }
    const stats = torrentEngine.getStats(hash);
    res.json({ success: true, stats });
  });

  app.post('/api/torrent/upload', express.json({ limit: '10mb' }), (req: Request, res: Response) => {
    try {
      const { torrentData, fileName } = req.body || {};
      if (!torrentData || typeof torrentData !== 'string') {
        res.status(400).json({ success: false, error: 'Dados do arquivo .torrent ausentes.' });
        return;
      }
      const buf = Buffer.from(torrentData, 'base64');
      const parsed = parseTorrentBuffer(buf);
      if (!parsed.valid || !parsed.magnetUri) {
        res.status(400).json({ success: false, error: parsed.error || 'Arquivo .torrent inválido.' });
        return;
      }
      res.json({
        success: true,
        infoHash: parsed.infoHash,
        name: parsed.name || fileName || 'Vídeo Torrent',
        magnetUri: parsed.magnetUri
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err?.message || 'Erro ao processar arquivo .torrent.' });
    }
  });

  app.get('/api/torrent/preload', async (req: Request, res: Response) => {
    const magnet = req.query.magnet as string;
    const magCheck = validateMagnet(magnet);
    if (!magCheck.valid) {
      res.status(400).json({ error: magCheck.error });
      return;
    }
    const trackerPriority = parsePriorityMode(req.query.trackerPriority);
    const season = req.query.season ? parseSafeInt(req.query.season, 1, 1, 100) : undefined;
    const episode = req.query.episode ? parseSafeInt(req.query.episode, 1, 1, 1000) : undefined;
    const fileIdx = req.query.fileIdx !== undefined ? parseSafeInt(req.query.fileIdx, 0, 0, 500) : undefined;
    torrentEngine.preload(magnet, trackerPriority, { season, episode, fileIdx }).catch(() => {});
    res.json({ success: true, status: 'preloading_initiated' });
  });

  app.get('/api/torrent/prefetch', (req: Request, res: Response) => {
    const magnet = req.query.magnet as string;
    const magCheck = validateMagnet(magnet);
    if (!magCheck.valid) {
      res.status(400).json({ error: magCheck.error });
      return;
    }
    const currentTime = parseSafeFloat(req.query.currentTime, 0, 0, 86400);
    const duration = parseSafeFloat(req.query.duration, 7200, 1, 86400);
    const speed = parseSafeFloat(req.query.speed, 1024 * 1024 * 2, 100, 100 * 1024 * 1024);

    const result = torrentEngine.prefetchNextPieces(magnet, currentTime, duration, speed);
    res.json(result);
  });

  // ===== LEGENDAS =====

  app.get('/api/subtitles/list', async (req: Request, res: Response) => {
    try {
      const imdbId = String(req.query.imdbId || '').slice(0, 20);
      const mediaType = (req.query.mediaType as string) || 'movie';
      const season = req.query.season ? parseSafeInt(req.query.season, 1, 1, 100) : undefined;
      const episode = req.query.episode ? parseSafeInt(req.query.episode, 1, 1, 1000) : undefined;
      const fileName = req.query.fileName ? String(req.query.fileName).slice(0, 255) : undefined;

      const tracks = await subtitleService.listTracks({
        imdbId,
        type: mediaType === 'movie' ? 'movie' : 'series',
        season,
        episode,
        fileName
      });
      res.json({ success: true, tracks });
    } catch (err: any) {
      res.status(500).json({ success: false, error: 'Erro ao listar legendas', tracks: [] });
    }
  });

  app.get('/api/subtitles/vtt', async (req: Request, res: Response) => {
    const id = String(req.query.id || '').slice(0, 120);
    const vtt = await subtitleService.getVtt(id);
    if (!vtt) {
      res.status(404).send('Legenda indisponível');
      return;
    }
    res.setHeader('Content-Type', 'text/vtt; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(vtt);
  });

  // ===== PROXY SEGURO DE IMAGENS (COM STREAMING, ALLOWLIST E ANTI-SSRF) =====

  app.get('/api/proxy-image', async (req: Request, res: Response) => {
    const urlStr = req.query.url as string;
    if (!urlStr) {
      res.status(400).send('URL ausente');
      return;
    }

    const check = await validateSafeHttpsUrl(urlStr, ALLOWED_IMAGE_HOSTS);
    if (!check.valid || !check.url) {
      res.status(403).json({ success: false, error: check.error || 'Acesso negado' });
      return;
    }

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10000);
      const upstream = await fetch(check.url.toString(), { signal: controller.signal });
      clearTimeout(timeout);

      if (!upstream.ok) {
        res.status(upstream.status).end();
        return;
      }

      const contentType = upstream.headers.get('content-type') || 'image/jpeg';
      if (!contentType.startsWith('image/')) {
        res.status(415).json({ success: false, error: 'O recurso não é uma imagem válida.' });
        return;
      }

      const contentLength = upstream.headers.get('content-length');
      if (contentLength && parseInt(contentLength, 10) > 10 * 1024 * 1024) {
        res.status(413).json({ success: false, error: 'Imagem excede o limite máximo permitido.' });
        return;
      }

      res.setHeader('Content-Type', contentType);
      res.setHeader('Cache-Control', 'public, max-age=604800, stale-while-revalidate=86400');

      if (upstream.body) {
        const nodeStream = stream.Readable.fromWeb(upstream.body as any);
        nodeStream.pipe(res);
      } else {
        res.status(502).end();
      }
    } catch {
      res.status(502).end();
    }
  });

  // ===== PROXY SEGURO DE VÍDEO HTTP 206 (HTTPS ONLY, NON-PRIVATE) =====

  async function proxyVideoRange(req: Request, res: Response, videoUrl: string) {
    const check = await validateSafeHttpsUrl(videoUrl);
    if (!check.valid || !check.url) {
      res.status(400).json({ success: false, error: check.error || 'URL de vídeo inválida.' });
      return;
    }

    try {
      const headers: Record<string, string> = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
      };
      if (req.headers.range) {
        headers['Range'] = req.headers.range;
      }

      const upstreamReq = https.get(check.url.toString(), { headers }, (upstreamRes) => {
        res.status(upstreamRes.statusCode || 200);
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
        } catch {}
      });

      upstreamReq.on('error', () => {
        if (!res.headersSent) res.status(502).end();
      });
    } catch {
      if (!res.headersSent) res.status(400).end();
    }
  }

  app.get('/api/stream-video', (req: Request, res: Response) => {
    const videoUrl = req.query.url as string;
    if (!videoUrl) {
      res.status(400).json({ success: false, error: 'Parâmetro url é obrigatório' });
      return;
    }
    proxyVideoRange(req, res, videoUrl);
  });

  // ===== INFORMAÇÕES DE REDE E RECEPTOR SMART TV =====

  app.get('/api/network-info', (_req: Request, res: Response) => {
    const lanIp = getLocalLanIp();
    res.json({
      success: true,
      lanIp,
      port: PORT,
      lanOrigin: `http://${lanIp}:${PORT}`
    });
  });

  app.get('/tv', (req: Request, res: Response) => {
    const rawSrc = typeof req.query.src === 'string' ? req.query.src : '';
    const safeSrc = rawSrc.startsWith('/api/') ? rawSrc : '/api/stream';
    const rawTitle = typeof req.query.title === 'string' ? req.query.title : 'Popoca Streaming';
    const rawQuality = typeof req.query.quality === 'string' ? req.query.quality : '1080p';
    const rawLang = typeof req.query.lang === 'string' ? req.query.lang : 'PT-BR';
    const startTime = parseSafeInt(req.query.time, 0, 0, 86400);

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

  // Healthcheck super leve para Render keep-alive e Docker (Fase 2 & Fase 4)
  app.get('/api/health', (_req: Request, res: Response) => {
    const sqliteOk = db.ping();
    const mem = process.memoryUsage();
    const freeMem = os.freemem();
    const totalMem = os.totalmem();
    res.status(200).json({
      status: sqliteOk ? 'healthy' : 'degraded',
      sqlite: sqliteOk ? 'connected' : 'disconnected',
      uptime: Math.round(process.uptime()),
      timestamp: new Date().toISOString(),
      activeEngines: torrentEngine.getActiveEnginesCount?.() ?? 0,
      memory: mem.rss,
      memoryDetails: {
        rssMb: Math.round(mem.rss / 1048576),
        heapUsedMb: Math.round(mem.heapUsed / 1048576),
        freeSystemMb: Math.round(freeMem / 1048576),
        totalSystemMb: Math.round(totalMem / 1048576),
        renderLimitMb: 512
      }
    });
  });

  // Servidor Frontend Vite em Dev ou Estático em Prod
  if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        allowedHosts: true
      },
      appType: 'spa'
    });
    app.use(vite.middlewares);
    app.use('*', async (req, res, next) => {
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
    console.log(`[Popoca] Servidor Seguro (Vite + P2P) ativo em: http://localhost:${PORT}`);
    console.log(`[Popoca] Rede Wi-Fi Local (Smart TV / Web Video Caster): http://${lanIp}:${PORT}`);
  });
}

bootstrap().catch((err) => {
  console.error('[Popoca] Erro crítico na inicialização:', err);
  process.exit(1);
});
