/**
 * Popoca Streaming - Torrent Engine
 * Gerenciador de streaming P2P de altíssimo desempenho via torrent-stream com:
 * 1. Validação estrita Bencode (.torrent) eliminando falhas de HTML/Cloudflare + fallback seguro para Magnet DHT
 * 2. Deduplicação concorrente de inicialização (evita múltiplos motores simultâneos no mesmo arquivo em disco)
 * 3. Foco cirúrgico de banda nas primeiras peças + moov atom (início de reprodução em 1.5s–3.5s)
 * 4. Seletor de Prioridade de Trackers + Re-try Automático/Manual de Peers sem loop infinito
 * 5. Suporte estrito RFC 7233 HTTP 206 Partial Content + Remux FFmpeg nativo em tempo real para MKV Dual Áudio
 */

import os from 'os';
import path from 'path';
import http from 'http';
import fs from 'fs';
import crypto from 'crypto';
import { createRequire } from 'module';
import torrentStream from 'torrent-stream';
import type { Request, Response } from 'express';
import { transcoder, type ProbedMediaInfo } from './transcoder.ts';
import { type TrackerPriorityMode, getTrackersForPriority, SUPER_TRACKERS } from './indexerService.ts';

const require = createRequire(import.meta.url);
const parseTorrentLib = require('parse-torrent');
const bncodeLib = require('bncode');

if (!process.env.UV_THREADPOOL_SIZE) {
  process.env.UV_THREADPOOL_SIZE = '32';
}

export interface StreamExtraOptions {
  seekSeconds?: number;
  preferPortugueseAudio?: boolean;
  audioTrackIndex?: number;
  season?: number;
  episode?: number;
  fileIdx?: number;
  preferredQuality?: string;
  fallbackMagnet?: string;
  fallbackQuality?: string;
  fallbackFileIdx?: number;
  isFallbackAttempt?: boolean;
  hasAlternatives?: boolean;
}

export interface ActiveTorrentStats {
  infoHash: string;
  name: string;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  numPeers: number;
  activePeers: number;
  length: number;
  downloaded: number;
  trackerPriority: TrackerPriorityMode;
  autoRetryCount: number;
  lastRetryTimestamp?: number;
  isLowSpeed: boolean;
  pieceMap?: number[];
  totalPieces?: number;
  pieceLength?: number;
}

interface EngineRuntimeMeta {
  createdAt: number;
  lastActivityTimestamp: number;
  trackerPriority: TrackerPriorityMode;
  autoRetryCount: number;
  lastRetryTimestamp?: number;
  lastSeekOffset: number;
  lastDownloadedBytes: number;
  lastSampleAt: number;
  smoothedSpeed: number;
  targetFile?: TorrentStream.TorrentFile;
}

const CACHE_BASE_DIR = process.env.CACHE_DIR || path.join(os.tmpdir(), 'popoca-cache');
const MAX_CACHE_BYTES = Number(process.env.MAX_CACHE_BYTES) || 384 * 1024 * 1024; // 384 MB (Blindagem 512MB RAM Render Free)
const CACHE_HIGH_WATERMARK = Math.floor(MAX_CACHE_BYTES * 0.8);
const CACHE_LOW_WATERMARK = Math.floor(MAX_CACHE_BYTES * 0.5);
const INACTIVE_EVICT_MS = 15 * 60 * 1000; // 15 minutos
const MAX_ACTIVE_ENGINES = Number(process.env.MAX_ACTIVE_TORRENTS) || 4;
const LOW_SPEED_THRESHOLD_BYTES_SEC = 140 * 1024;
const AUTO_RETRY_COOLDOWN_MS = 14000;
const HEALTH_CHECK_TIMEOUT_MS = 5000; // 5 segundos para Health Check de Qualidade (Fase 2)
const MAX_ENGINE_MEMORY_BYTES = 128 * 1024 * 1024; // 128 MB por engine (limite estrito para evitar OOM no Render)
const CONTAINER_HEAP_HIGH_WATERMARK = 280 * 1024 * 1024; // 280 MB no heap (blindagem do contêiner 512MB)
const MAX_CHUNK_CACHE_PER_ENGINE_BYTES = 32 * 1024 * 1024; // 32 MB max de cache de blocos em RAM por engine
const PREFETCH_WINDOW_SECONDS = 30; // Janela de pre-fetching inteligente de 30 segundos à frente

function getDirectorySize(dir: string): { size: number; newest: number } {
  let size = 0;
  let newest = 0;
  try {
    if (!fs.existsSync(dir)) return { size: 0, newest: 0 };
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          const sub = getDirectorySize(fullPath);
          size += sub.size;
          newest = Math.max(newest, sub.newest);
        } else {
          const st = fs.statSync(fullPath);
          const actualAllocated =
            typeof (st as any).blocks === 'number' && (st as any).blocks > 0
              ? Math.min(st.size, (st as any).blocks * 512)
              : st.size;
          size += actualAllocated;
          newest = Math.max(newest, st.mtimeMs);
        }
      } catch {}
    }
  } catch {}
  return { size, newest };
}

/**
 * Valida se o buffer baixado é realmente um arquivo .torrent Bencode legítimo (inicia com 'd' e contém '4:info')
 * e nunca uma página HTML de desafio/erro dos mirrors.
 */
export function isValidBencodedTorrent(buf: Buffer): boolean {
  if (!buf || buf.length < 250) return false;
  if (buf[0] !== 0x64) return false; // Todo dicionário Bencode começa com 'd' (0x64)
  const headStr = buf.subarray(0, 64).toString('utf8').toLowerCase();
  if (headStr.includes('<html') || headStr.includes('<!doctype') || headStr.includes('cloudflare')) {
    return false;
  }
  return buf.includes(Buffer.from('4:info'));
}

/**
 * Gera um mapa amostrado de peças (ex: 60 colunas) indicando o percentual baixado de cada setor
 */
export function generatePieceMap(
  bitfield: { get: (index: number) => boolean } | undefined | null,
  totalPieces: number,
  numBuckets: number = 60
): number[] {
  if (!bitfield || typeof bitfield.get !== 'function' || totalPieces <= 0) {
    return [];
  }
  const buckets = new Array(numBuckets).fill(0);
  const bucketSize = totalPieces / numBuckets;
  for (let b = 0; b < numBuckets; b++) {
    const startP = Math.floor(b * bucketSize);
    const endP = Math.min(totalPieces, Math.floor((b + 1) * bucketSize));
    let count = 0;
    const totalInBucket = Math.max(1, endP - startP);
    for (let p = startP; p < endP; p++) {
      if (bitfield.get(p)) {
        count++;
      }
    }
    buckets[b] = Math.round((count / totalInBucket) * 100);
  }
  return buckets;
}

/**
 * Analisa um arquivo .torrent binário e extrai infoHash e metadados com segurança
 */
export function parseTorrentBuffer(buf: Buffer): {
  valid: boolean;
  infoHash?: string;
  name?: string;
  magnetUri?: string;
  error?: string;
} {
  if (!isValidBencodedTorrent(buf)) {
    return { valid: false, error: 'Arquivo .torrent inválido ou corrompido.' };
  }
  try {
    const infoKey = Buffer.from('4:info');
    const infoKeyIdx = buf.indexOf(infoKey);
    if (infoKeyIdx === -1) {
      return { valid: false, error: 'Chave info não encontrada no arquivo .torrent.' };
    }

    const start = infoKeyIdx + infoKey.length;
    if (buf[start] !== 0x64) {
      return { valid: false, error: 'Dicionário info inválido.' };
    }

    let idx = start;
    function parseElement(): boolean {
      if (idx >= buf.length) return false;
      const b = buf[idx];
      if (b === 0x69) {
        idx++;
        while (idx < buf.length && buf[idx] !== 0x65) idx++;
        if (idx < buf.length) idx++;
        return true;
      }
      if (b >= 0x30 && b <= 0x39) {
        let len = 0;
        while (idx < buf.length && buf[idx] >= 0x30 && buf[idx] <= 0x39) {
          len = len * 10 + (buf[idx] - 0x30);
          idx++;
        }
        if (idx < buf.length && buf[idx] === 0x3a) {
          idx++;
          idx += len;
          return idx <= buf.length;
        }
        return false;
      }
      if (b === 0x6c) {
        idx++;
        while (idx < buf.length && buf[idx] !== 0x65) {
          if (!parseElement()) return false;
        }
        if (idx < buf.length) idx++;
        return true;
      }
      if (b === 0x64) {
        idx++;
        while (idx < buf.length && buf[idx] !== 0x65) {
          if (!parseElement()) return false;
          if (!parseElement()) return false;
        }
        if (idx < buf.length) idx++;
        return true;
      }
      return false;
    }

    const ok = parseElement();
    const end = idx;
    if (!ok || end <= start) {
      return { valid: false, error: 'Estrutura bencode do dicionário info inválida.' };
    }

    const infoBuf = buf.subarray(start, end);
    const infoHash = crypto.createHash('sha1').update(infoBuf).digest('hex').toLowerCase();

    let name = 'Vídeo Popoca';
    const nameKey = Buffer.from('4:name');
    const nameKeyIdx = infoBuf.indexOf(nameKey);
    if (nameKeyIdx !== -1) {
      let nIdx = nameKeyIdx + nameKey.length;
      let strLen = 0;
      while (nIdx < infoBuf.length && infoBuf[nIdx] >= 0x30 && infoBuf[nIdx] <= 0x39) {
        strLen = strLen * 10 + (infoBuf[nIdx] - 0x30);
        nIdx++;
      }
      if (nIdx < infoBuf.length && infoBuf[nIdx] === 0x3a && strLen > 0 && strLen < 500) {
        nIdx++;
        if (nIdx + strLen <= infoBuf.length) {
          name = infoBuf.subarray(nIdx, nIdx + strLen).toString('utf8');
        }
      }
    }

    const magnetUri = `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(name)}`;
    return {
      valid: true,
      infoHash,
      name,
      magnetUri
    };
  } catch (err: any) {
    return { valid: false, error: err?.message || 'Erro ao analisar arquivo .torrent' };
  }
}

/**
 * Remove dezenas de trackers mortos embutidos nos arquivos .torrent de mirrors (que saturam o DNS/threadpool),
 * preservando apenas o dicionário 'info' (metadados dos arquivos e hashes das peças) para injetarmos apenas os Super Trackers!
 */
function stripEmbeddedTrackersFromTorrentBuffer(buf: Buffer): Buffer | null {
  try {
    const parsed = parseTorrentLib(buf);
    if (parsed && parsed.infoBuffer) {
      const cleanInfo = bncodeLib.decode(parsed.infoBuffer);
      return bncodeLib.encode({
        info: cleanInfo,
        'announce-list': []
      });
    }
  } catch {}
  return null;
}

/**
 * Busca concorrente paralela do arquivo .torrent validado em múltiplos mirrors de cache
 */
async function fetchTorrentBuffer(hash: string): Promise<Buffer | null> {
  const cleanHash = hash.toUpperCase();
  const urls = [
    `https://itorrents.org/torrent/${cleanHash}.torrent`,
    `https://btcache.me/torrent/${cleanHash}`,
    `https://torrage.info/torrent.php?h=${cleanHash}`
  ];

  const fetchers = urls.map(async (url) => {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      signal: AbortSignal.timeout(1800)
    });
    if (res.ok) {
      const ab = await res.arrayBuffer();
      const buf = Buffer.from(ab);
      if (isValidBencodedTorrent(buf)) {
        const cleaned = stripEmbeddedTrackersFromTorrentBuffer(buf);
        if (cleaned) return cleaned;
      }
    }
    throw new Error('Mirror sem bencode válido: ' + url);
  });

  try {
    return await Promise.any(fetchers);
  } catch {
    return null;
  }
}

export interface ParsedByteRange {
  start: number;
  end: number;
}

/**
 * Analisador estrito de cabeçalho Range (RFC 7233) com suporte a:
 * - bytes=start-end (faixa fechada)
 * - bytes=start- (faixa aberta até o final do arquivo)
 * - bytes=-suffix (faixa de sufixo, ex: últimos 500KB para leitura de metadados moov/cues)
 * - Validação de limites e retorno de 'unsatisfiable' para 416 Range Not Satisfiable
 */
export function parseHttpRange(
  rangeHeader: string | undefined,
  fileSize: number
): ParsedByteRange | null | 'unsatisfiable' {
  if (!rangeHeader || typeof rangeHeader !== 'string') return null;
  const match = rangeHeader.trim().match(/^bytes=(.+)$/i);
  if (!match) return null;

  // Se múltiplas faixas vierem separadas por vírgula, processa a primeira faixa principal
  const firstRangeToken = match[1].split(',')[0].trim();
  const dashIndex = firstRangeToken.indexOf('-');
  if (dashIndex === -1) return 'unsatisfiable';

  const startStr = firstRangeToken.slice(0, dashIndex).trim();
  const endStr = firstRangeToken.slice(dashIndex + 1).trim();

  // Caso: bytes=-suffix (ex: bytes=-524288 para carregar o átomo moov do final)
  if (startStr === '') {
    if (endStr === '') return 'unsatisfiable';
    const suffixLength = parseInt(endStr, 10);
    if (isNaN(suffixLength) || suffixLength <= 0) return 'unsatisfiable';
    const start = Math.max(0, fileSize - suffixLength);
    const end = fileSize - 1;
    if (start >= fileSize || end < start) return 'unsatisfiable';
    return { start, end };
  }

  // Caso: bytes=start- ou bytes=start-end
  const start = parseInt(startStr, 10);
  if (isNaN(start) || start < 0 || start >= fileSize) return 'unsatisfiable';

  let end = fileSize - 1;
  if (endStr !== '') {
    const parsedEnd = parseInt(endStr, 10);
    if (isNaN(parsedEnd) || parsedEnd < start) return 'unsatisfiable';
    end = Math.min(parsedEnd, fileSize - 1);
  }

  return { start, end };
}

function extractHash(magnetOrHash: string): string {
  const match = magnetOrHash.match(/btih:([a-zA-Z0-9]+)/i) || magnetOrHash.match(/^([a-fA-F0-9]{40})$/);
  return (match ? match[1] : magnetOrHash).toLowerCase();
}

export interface CachedChunkEntry {
  pieceIndex: number;
  buffer: Buffer;
  size: number;
  accessedAt: number;
}

export class TorrentEngine {
  private enginesMap: Map<string, TorrentStream.TorrentEngine> = new Map();
  private pendingEnginesMap: Map<string, Promise<TorrentStream.TorrentEngine>> = new Map();
  private runtimeMetaMap: Map<string, EngineRuntimeMeta> = new Map();
  private cleanupTimers: Map<string, NodeJS.Timeout> = new Map();
  private activeStreamsCount: Map<string, number> = new Map();
  private activeReadStreamsMap: Map<string, Set<any>> = new Map();
  private mediaProbeCache: Map<string, ProbedMediaInfo | null> = new Map();
  private pendingProbeMap: Map<string, Promise<ProbedMediaInfo | null>> = new Map();
  private activeClientTranscodeMap: Map<string, () => void> = new Map();
  private activeClientStreamByIp: Map<string, { hash: string; abort: () => void }> = new Map();
  private wireOptimizerIntervals: Map<string, NodeJS.Timeout> = new Map();
  private defaultTrackerPriority: TrackerPriorityMode = 'pt-br-stability';
  private portCursor: number = Math.floor(Math.random() * 8000);
  private sharedDht: any = null;
  private localRawServer: http.Server | null = null;
  private localRawPort: number = 0;
  private engineChunkCaches: Map<string, Map<number, CachedChunkEntry>> = new Map();
  private engineChunkCacheBytes: Map<string, number> = new Map();
  private memoryWatchdogInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.initSharedDht();
    this.initLocalRawServer();
    this.startPeriodicSweeper();
    this.startMemoryWatchdog();
    this.pruneDiskCache();
  }

  public getChunkFromCache(hash: string, pieceIndex: number): Buffer | null {
    const cleanHash = hash.toLowerCase();
    const cache = this.engineChunkCaches.get(cleanHash);
    if (!cache) return null;
    const entry = cache.get(pieceIndex);
    if (!entry) return null;
    entry.accessedAt = Date.now();
    return entry.buffer;
  }

  public putChunkInCache(hash: string, pieceIndex: number, buffer: Buffer, startPiece?: number): void {
    if (!buffer || buffer.length === 0) return;
    const cleanHash = hash.toLowerCase();
    let cache = this.engineChunkCaches.get(cleanHash);
    if (!cache) {
      cache = new Map();
      this.engineChunkCaches.set(cleanHash, cache);
      this.engineChunkCacheBytes.set(cleanHash, 0);
    }

    const currentTotalBytes = this.engineChunkCacheBytes.get(cleanHash) || 0;
    const existingEntry = cache.get(pieceIndex);
    const existingSize = existingEntry ? existingEntry.size : 0;
    const delta = buffer.length - existingSize;

    let newTotal = currentTotalBytes + delta;
    if (newTotal > MAX_CHUNK_CACHE_PER_ENGINE_BYTES) {
      const entries = Array.from(cache.entries());
      entries.sort((a, b) => {
        if (typeof startPiece === 'number') {
          const distA = Math.abs(a[0] - startPiece);
          const distB = Math.abs(b[0] - startPiece);
          if (distA !== distB) return distB - distA;
        }
        return a[1].accessedAt - b[1].accessedAt;
      });

      for (const [pIndex, entry] of entries) {
        if (newTotal <= MAX_CHUNK_CACHE_PER_ENGINE_BYTES * 0.75) break;
        if (pIndex === pieceIndex) continue;
        cache.delete(pIndex);
        newTotal -= entry.size;
      }
    }

    cache.set(pieceIndex, {
      pieceIndex,
      buffer,
      size: buffer.length,
      accessedAt: Date.now()
    });
    this.engineChunkCacheBytes.set(cleanHash, Math.max(0, newTotal));
  }

  public estimateEngineMemory(hash: string): number {
    const cleanHash = hash.toLowerCase();
    let total = this.engineChunkCacheBytes.get(cleanHash) || 0;

    const readStreams = this.activeReadStreamsMap.get(cleanHash);
    if (readStreams) {
      for (const rs of readStreams) {
        const queueLen = (rs as any)?._readableState?.length || 0;
        total += queueLen;
      }
    }

    const engine = this.enginesMap.get(cleanHash);
    if (engine) {
      const anyEng = engine as any;
      const pieceLen = anyEng.torrent?.pieceLength || 1024 * 1024;
      const criticalPieces = Array.isArray(anyEng._critical)
        ? anyEng._critical.filter(Boolean).length
        : 0;
      total += criticalPieces * pieceLen;
    }

    return total;
  }

  public pruneEngineBuffers(hash: string, targetLimitBytes: number = 64 * 1024 * 1024): void {
    const cleanHash = hash.toLowerCase();
    const cache = this.engineChunkCaches.get(cleanHash);
    if (cache) {
      const meta = this.runtimeMetaMap.get(cleanHash);
      const seekPiece = meta?.lastSeekOffset ? Math.floor(meta.lastSeekOffset / (1024 * 1024)) : 0;
      let currentBytes = this.engineChunkCacheBytes.get(cleanHash) || 0;

      for (const [pIndex, entry] of Array.from(cache.entries())) {
        if (currentBytes <= targetLimitBytes) break;
        if (pIndex < seekPiece || pIndex > seekPiece + 35) {
          cache.delete(pIndex);
          currentBytes -= entry.size;
        }
      }

      if (currentBytes > targetLimitBytes) {
        const sorted = Array.from(cache.entries()).sort((a, b) => a[1].accessedAt - b[1].accessedAt);
        for (const [pIndex, entry] of sorted) {
          if (currentBytes <= targetLimitBytes) break;
          cache.delete(pIndex);
          currentBytes -= entry.size;
        }
      }
      this.engineChunkCacheBytes.set(cleanHash, Math.max(0, currentBytes));
    }

    const engine = this.enginesMap.get(cleanHash);
    if (engine) {
      try {
        const store = (engine as any).store;
        if (store && typeof store.close === 'function') {
          store.close(() => {});
        }
      } catch {}
    }
  }

  public evictInactiveEnginesExcept(activeHash: string): void {
    const cleanActive = activeHash.toLowerCase();
    for (const [hash] of Array.from(this.enginesMap.entries())) {
      if (hash === cleanActive) continue;
      const count = this.activeStreamsCount.get(hash) || 0;
      if (count <= 0) {
        console.log(`[TorrentEngine Lifecycle] Evitando motor inativo ao trocar de mídia/episódio: ${hash}`);
        this.destroyEngine(hash, false);
      }
    }
  }

  public startMemoryWatchdog(): void {
    if (this.memoryWatchdogInterval) return;
    this.memoryWatchdogInterval = setInterval(() => {
      try {
        for (const [hash] of Array.from(this.enginesMap.entries())) {
          const estimatedBytes = this.estimateEngineMemory(hash);
          if (estimatedBytes > MAX_ENGINE_MEMORY_BYTES) {
            console.warn(
              `[TorrentEngine Watchdog] Engine ${hash} excedeu limite seguro (${Math.round(estimatedBytes / 1024 / 1024)}MB > 128MB). Forçando liberação de buffers e descritores.`
            );
            this.pruneEngineBuffers(hash, 48 * 1024 * 1024);
            const activeCount = this.activeStreamsCount.get(hash) || 0;
            if (activeCount <= 0) {
              this.destroyEngine(hash, false);
            }
          }
        }

        const heapUsed = process.memoryUsage().heapUsed;
        if (heapUsed > CONTAINER_HEAP_HIGH_WATERMARK) {
          console.warn(
            `[TorrentEngine Watchdog] Heap total (${Math.round(heapUsed / 1024 / 1024)}MB) atingiu marca alta (${Math.round(CONTAINER_HEAP_HIGH_WATERMARK / 1024 / 1024)}MB). Despejando motores inativos e acionando GC.`
          );
          this.evictOldestInactiveEngine();
          for (const hash of this.enginesMap.keys()) {
            this.pruneEngineBuffers(hash, 24 * 1024 * 1024);
          }
          if (typeof (global as any).gc === 'function') {
            (global as any).gc();
          }
        }
      } catch {}
    }, 3000);
    this.memoryWatchdogInterval.unref();
  }

  private initSharedDht() {
    try {
      const DHT = require('bittorrent-dht/client');
      if (typeof DHT === 'function') {
        const dht = new DHT();
        if (typeof dht.setMaxListeners === 'function') {
          dht.setMaxListeners(100);
        }
        dht.on('error', () => {});
        dht.on('peer', (peer: any, infoHash: any) => {
          try {
            if (!peer || !peer.host || !peer.port || !infoHash) return;
            const h = Buffer.isBuffer(infoHash)
              ? infoHash.toString('hex').toLowerCase()
              : String(infoHash).toLowerCase();
            const eng = this.enginesMap.get(h);
            if (eng && typeof (eng as any).connect === 'function') {
              (eng as any).connect(`${peer.host}:${peer.port}`);
            }
          } catch {}
        });
        dht.listen(0);
        this.sharedDht = dht;
      }
    } catch {}
  }

  /**
   * Servidor HTTP 206 interno (loopback 127.0.0.1) que permite ao FFmpeg fazer seek instantâneo (-ss)
   * em arquivos .mkv usando o índice Matroska Cues sem precisar ler desde o minuto 00:00!
   */
  private initLocalRawServer() {
    try {
      const srv = http.createServer((req, res) => {
        try {
          const urlPath = req.url || '';
          const match = urlPath.match(/^\/raw\/([a-f0-9]{40})/i);
          if (!match) {
            res.writeHead(404).end();
            return;
          }
          const hash = match[1].toLowerCase();
          const engine = this.enginesMap.get(hash);
          const file = engine ? (this.getActiveTargetFile(hash, engine) || this.findMainVideoFile(engine)) : null;
          if (!engine || !file) {
            res.writeHead(404).end();
            return;
          }

          const fileSize = file.length;
          const fileOffset = (file as any).offset || 0;
          const pieceLength = (engine as any).torrent?.pieceLength || 1024 * 1024;
          const fileFirstPiece = Math.floor(fileOffset / pieceLength);
          const endPiece = Math.floor((fileOffset + fileSize - 1) / pieceLength);
          const bitfield = (engine as any).bitfield;

          const parsed = parseHttpRange(req.headers.range, fileSize);

          if (parsed === 'unsatisfiable') {
            res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` }).end();
            return;
          }

          if (parsed === null) {
            try {
              if (!bitfield || typeof bitfield.get !== 'function' || !bitfield.get(fileFirstPiece)) {
                (engine as any).critical?.(fileFirstPiece, 2);
                (engine as any).select?.(fileFirstPiece, Math.min(endPiece, fileFirstPiece + 1), 120);
              }
            } catch {}
            res.writeHead(200, {
              'Content-Length': fileSize,
              'Accept-Ranges': 'bytes',
              'Content-Type': 'application/octet-stream'
            });
            const rs: any = file.createReadStream();
            rs._isIndexProbe = true;
            this.registerReadStream(hash, rs);
            rs.on('error', () => {
              this.unregisterReadStream(hash, rs);
              try { rs.destroy(); } catch {}
              if (!res.headersSent) res.writeHead(500).end();
            });
            rs.pipe(res);
            req.on('close', () => {
              this.unregisterReadStream(hash, rs);
              try {
                rs.destroy();
              } catch {}
            });
            return;
          }

          const { start, end } = parsed;
          const reqStartPiece = Math.floor((fileOffset + start) / pieceLength);
          const isHeaderOrTailProbe =
            reqStartPiece <= fileFirstPiece + 1 || reqStartPiece >= Math.max(fileFirstPiece + 2, endPiece - 2);

          if (isHeaderOrTailProbe) {
            // Probe de EBML Header (peça 0) ou índice Matroska Cues no final do arquivo (últimas 2 peças):
            // Prioriza imediatamente essas peças com prioridade máxima (120) SEM sobrescrever lastSeekOffset!
            try {
              const probeEndPiece = Math.min(endPiece, reqStartPiece + 1);
              if (!bitfield || typeof bitfield.get !== 'function' || !bitfield.get(reqStartPiece)) {
                (engine as any).critical?.(reqStartPiece, probeEndPiece - reqStartPiece + 1);
                (engine as any).select?.(reqStartPiece, probeEndPiece, 120);
              }
            } catch {}
          } else {
            // Offset exato do cluster de vídeo pós-leitura do Cues pelo FFmpeg: foca 100% da janela aqui!
            this.optimizePiecePriorities(engine, start, file);
          }

          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Content-Type': 'application/octet-stream'
          });
          const rs: any = file.createReadStream({ start, end });
          rs._isIndexProbe = isHeaderOrTailProbe;
          rs._isPlaybackStream = !isHeaderOrTailProbe;
          this.registerReadStream(hash, rs);
          rs.on('error', () => {
            this.unregisterReadStream(hash, rs);
            try { rs.destroy(); } catch {}
            if (!res.headersSent) res.writeHead(500).end();
          });
          rs.pipe(res);
          req.on('close', () => {
            this.unregisterReadStream(hash, rs);
            try {
              rs.destroy();
            } catch {}
          });
        } catch {
          if (!res.headersSent) res.writeHead(500).end();
        }
      });

      srv.listen(0, '127.0.0.1', () => {
        const addr = srv.address();
        if (addr && typeof addr === 'object') {
          this.localRawPort = addr.port;
        }
      });
      this.localRawServer = srv;
    } catch {}
  }

  private registerReadStream(hash: string, rs: any) {
    if (!this.activeReadStreamsMap.has(hash)) {
      this.activeReadStreamsMap.set(hash, new Set());
    }
    this.activeReadStreamsMap.get(hash)!.add(rs);
    if (rs && typeof rs.once === 'function') {
      const autoRemove = () => this.unregisterReadStream(hash, rs);
      rs.once('end', autoRemove);
      rs.once('close', autoRemove);
      rs.once('error', autoRemove);
    }
    const engine = this.enginesMap.get(hash);
    if (engine && typeof (engine.swarm as any)?.resume === 'function') {
      try {
        (engine.swarm as any).resume();
      } catch {}
    }
  }

  private unregisterReadStream(hash: string, rs: any) {
    const set = this.activeReadStreamsMap.get(hash);
    if (set) {
      set.delete(rs);
      if (set.size === 0) {
        this.activeReadStreamsMap.delete(hash);
      }
    }
  }

  getTrackerPriority(): TrackerPriorityMode {
    return this.defaultTrackerPriority;
  }

  setTrackerPriority(mode: TrackerPriorityMode, magnetUri?: string) {
    this.defaultTrackerPriority = mode;
    if (magnetUri) {
      const hash = extractHash(magnetUri);
      const meta = this.runtimeMetaMap.get(hash);
      if (meta) meta.trackerPriority = mode;
      this.forceRetryPeers(magnetUri, mode).catch(() => {});
    }
  }

  /**
   * Obtém ou inicializa uma única instância compartilhada do motor torrent por infoHash
   */
  async getOrAddEngine(
    magnetUri: string,
    trackerPriority?: TrackerPriorityMode,
    targetOpts?: { fileIdx?: number; season?: number; episode?: number }
  ): Promise<TorrentStream.TorrentEngine> {
    const hash = extractHash(magnetUri);
    const activePriority = trackerPriority || this.defaultTrackerPriority;

    // Evita acumulação de motores inativos ao trocar de episódio ou filme
    this.evictInactiveEnginesExcept(hash);

    if (this.cleanupTimers.has(hash)) {
      clearTimeout(this.cleanupTimers.get(hash)!);
      this.cleanupTimers.delete(hash);
    }

    // 0. Limite de motores ativos simultâneos no servidor com despejo inteligente LRU de inativos
    if (!this.enginesMap.has(hash) && !this.pendingEnginesMap.has(hash) && this.enginesMap.size >= MAX_ACTIVE_ENGINES) {
      const freed = this.evictOldestInactiveEngine();
      if (!freed) {
        throw new Error('SERVER_CAPACITY_REACHED');
      }
    }

    // 1. Motor já pronto em memória
    const existing = this.enginesMap.get(hash);
    if (existing && existing.files && existing.files.length > 0) {
      this.activeStreamsCount.set(hash, (this.activeStreamsCount.get(hash) || 0) + 1);
      this.touchActivity(hash);
      if (trackerPriority) {
        const meta = this.runtimeMetaMap.get(hash);
        if (meta && meta.trackerPriority !== trackerPriority) {
          meta.trackerPriority = trackerPriority;
          this.retryPeersInternal(hash, existing, trackerPriority, false);
        }
      }
      return existing;
    }

    // 2. Motor já em processo de inicialização concorrente (ex: preload + range request simultâneos)
    if (this.pendingEnginesMap.has(hash)) {
      const sharedEngine = await this.pendingEnginesMap.get(hash)!;
      this.activeStreamsCount.set(hash, (this.activeStreamsCount.get(hash) || 0) + 1);
      this.touchActivity(hash);
      return sharedEngine;
    }

    const initPromise = (async () => {
      let torrentInput: Buffer | string = magnetUri;
      try {
        const cachedBuf = await fetchTorrentBuffer(hash);
        if (cachedBuf) {
          torrentInput = cachedBuf;
          console.log(`[P2P Cache] Metadados .torrent obtidos via cache para ${hash.slice(0, 8)}... (${cachedBuf.length} bytes)`);
        }
      } catch {}

      const selectedTrackers = Array.from(
        new Set([...SUPER_TRACKERS, ...getTrackersForPriority(activePriority)])
      ).filter((tr) => /^(udp|https?):\/\//i.test(tr));
      const engineOpts = {
        tmp: CACHE_BASE_DIR,
        path: path.join(CACHE_BASE_DIR, hash),
        trackers: selectedTrackers,
        dht: true,
        tracker: true,
        connections: activePriority === 'ultra-speed' ? 120 : 85,
        uploads: 4,
        verify: false
      };

      return await new Promise<TorrentStream.TorrentEngine>((resolve, reject) => {
        let engine: TorrentStream.TorrentEngine;
        try {
          engine = torrentStream(torrentInput, engineOpts);
        } catch (parseErr) {
          // Fallback imediato para Magnet URI caso o buffer .torrent tenha qualquer anomalia
          console.warn(`[TorrentEngine] Fallback para Magnet URI em ${hash}:`, (parseErr as any)?.message);
          engine = torrentStream(magnetUri, engineOpts);
        }

        // Porta efêmera explícita (>0) síncrona no mesmo tick para não reiniciar trackers no meio do handshake!
        try {
          const explicitPort = 49152 + ((this.portCursor++) % 14000);
          if (typeof (engine as any).listen === 'function') {
            (engine as any).listen(explicitPort);
          }
          if (this.sharedDht && typeof this.sharedDht.lookup === 'function') {
            this.sharedDht.lookup(hash);
          }
        } catch {}

        this.enginesMap.set(hash, engine);
        this.activeStreamsCount.set(hash, 1);
        this.runtimeMetaMap.set(hash, {
          createdAt: Date.now(),
          lastActivityTimestamp: Date.now(),
          trackerPriority: activePriority,
          autoRetryCount: 0,
          lastSeekOffset: 0,
          lastDownloadedBytes: 0,
          lastSampleAt: Date.now(),
          smoothedSpeed: 0
        });

        let resolved = false;

        const timeout = setTimeout(() => {
          if (!resolved && (!engine.files || engine.files.length === 0)) {
            console.warn(`[P2P Timeout] Metadados não responderam em 25s para ${hash.slice(0, 8)}... (Nenhuma semente conectável nos trackers selecionados)`);
            try {
              engine.destroy(() => {});
            } catch {}
            this.enginesMap.delete(hash);
            this.runtimeMetaMap.delete(hash);
            this.stopWireOptimizer(hash);
            reject(new Error('P2P_PEER_TIMEOUT: Nenhuma semente respondeu a tempo.'));
          }
        }, 25000);

        engine.on('ready', () => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timeout);
          this.enginesMap.set(hash, engine);

          // Seleciona imediatamente o arquivo exato do episódio (ou filme) antes de priorizar as peças!
          const initialTarget = this.findTargetVideoFile(
            engine,
            targetOpts?.fileIdx,
            targetOpts?.season,
            targetOpts?.episode
          );
          if (initialTarget) {
            this.optimizePiecePriorities(engine, 0, initialTarget);
          }
          this.startWireOptimizer(hash, engine);

          engine.on('download', (pieceIndex: number) => {
            try {
              const meta = this.runtimeMetaMap.get(hash);
              const pieceLength = (engine as any).torrent?.pieceLength || 1024 * 1024;
              const target = this.getActiveTargetFile(hash, engine) || this.findMainVideoFile(engine);
              const fileOffset = (target as any)?.offset || 0;
              const currentSeekPiece = meta?.lastSeekOffset !== undefined
                ? Math.floor((fileOffset + meta.lastSeekOffset) / pieceLength)
                : 0;

              const maxWindowPieces = Math.max(15, Math.ceil((PREFETCH_WINDOW_SECONDS * 600 * 1024) / pieceLength));
              if (pieceIndex >= currentSeekPiece && pieceIndex <= currentSeekPiece + maxWindowPieces) {
                const store = (engine as any).store;
                if (store && typeof store.get === 'function') {
                  store.get(pieceIndex, (err: any, buf: Buffer) => {
                    if (!err && buf) {
                      this.putChunkInCache(hash, pieceIndex, buf, currentSeekPiece);
                    }
                  });
                }
              }
            } catch {}
          });

          resolve(engine);
        });

        engine.on('error', (err: any) => {
          clearTimeout(timeout);
          console.warn('[TorrentEngine] Erro no motor P2P:', err?.message || err);
          this.destroyEngine(hash, false);
          if (!resolved) {
            resolved = true;
            reject(err);
          }
        });
      });
    })();

    this.pendingEnginesMap.set(hash, initPromise);
    try {
      return await initPromise;
    } finally {
      this.pendingEnginesMap.delete(hash);
    }
  }

  getActiveTargetFile(
    hash: string,
    engine?: TorrentStream.TorrentEngine
  ): TorrentStream.TorrentFile | null {
    const eng = engine || this.enginesMap.get(hash);
    if (!eng || !eng.files || eng.files.length === 0) return null;
    const meta = this.runtimeMetaMap.get(hash);
    if (meta?.targetFile && eng.files.includes(meta.targetFile)) {
      return meta.targetFile;
    }
    return this.findTargetVideoFile(eng);
  }

  private matchEpisodeInFileList(
    candidateFiles: TorrentStream.TorrentFile[],
    season?: number,
    episode?: number
  ): TorrentStream.TorrentFile | null {
    if (typeof episode !== 'number' || episode <= 0 || candidateFiles.length === 0) {
      return null;
    }

    const epNum = episode;
    const epPadded = epNum.toString().padStart(2, '0');
    const epPadded3 = epNum.toString().padStart(3, '0');
    const sNum = typeof season === 'number' && season > 0 ? season : undefined;

    // Ordena os arquivos naturalmente pelo caminho/nome para que S01E01 venha SEMPRE antes de S01E02
    // mesmo que o dicionário do .torrent tenha os arquivos fora de ordem (ex: BluDV / Comando packs)
    const sortedCandidates = [...candidateFiles].sort((a, b) => {
      const pathA = String((a as any).path || a.name || '');
      const pathB = String((b as any).path || b.name || '');
      return pathA.localeCompare(pathB, undefined, { numeric: true, sensitivity: 'base' });
    });

    // Se a temporada foi especificada e existem pastas/nomes com outras temporadas, prioriza os da temporada certa
    let seasonFiltered = sortedCandidates;
    if (sNum) {
      const seasonRegex = new RegExp(
        `(?:[sS]0*${sNum}(?![0-9])|[sS]eason\\s*0*${sNum}(?![0-9])|[tT]emporada\\s*0*${sNum}(?![0-9])|\\b${sNum}x\\d+)`,
        'i'
      );
      const matchingSeason = sortedCandidates.filter((f) =>
        seasonRegex.test(String((f as any).path || f.name || ''))
      );
      if (matchingSeason.length > 0) {
        seasonFiltered = matchingSeason;
      }
    }

    // Usa (?!\d) em vez de \b porque no JS '_' é considerado caractere de palavra (\w),
    // o que fazia S01E01\b falhar em 'Stranger_Things_S01E01_1080p.mkv'!
    const strictPatterns: RegExp[] = [];
    if (sNum) {
      strictPatterns.push(new RegExp(`[sS]0*${sNum}[._\\s-]*[eE]p?0*${epNum}(?:v\\d+)?(?!\\d)`, 'i'));
      strictPatterns.push(new RegExp(`(?:^|[^0-9])${sNum}x0*${epNum}(?:v\\d+)?(?!\\d)`, 'i'));
      strictPatterns.push(new RegExp(`[sS]eason\\s*0*${sNum}.*?[eE]p?(?:isode)?\\.?\\s*0*${epNum}(?:v\\d+)?(?!\\d)`, 'i'));
      strictPatterns.push(new RegExp(`[tT]emporada\\s*0*${sNum}.*?[eE]p?(?:is[oó]dio)?\\.?\\s*0*${epNum}(?:v\\d+)?(?!\\d)`, 'i'));
    }
    strictPatterns.push(new RegExp(`[sS]\\d+[._\\s-]*[eE]p?0*${epNum}(?:v\\d+)?(?!\\d)`, 'i'));
    strictPatterns.push(new RegExp(`(?:^|[\\s._\\-\\[\\(])[eE]p?(?:isode|isodio|isódio)?\\.?[\\s._-]*0*${epNum}(?:v\\d+)?(?!\\d)`, 'i'));
    strictPatterns.push(new RegExp(`(?:^|[\\s._\\-\\[\\(])cap(?:itulo|ítulo)?\\.?[\\s._-]*0*${epNum}(?:v\\d+)?(?!\\d)`, 'i'));

    const stripTechNoise = (raw: string) =>
      raw
        .replace(/\b(2160p|1080p|720p|480p|360p|4k|uhd|fhd|hd)\b/gi, ' ')
        .replace(/[._\s-](2160p|1080p|720p|480p|h264|x264|h265|x265|hevc|av1|10bit|8bit|hdr10|hdr|ddp5[._]?1|dd5[._]?1|aac2[._]?0|aac|ac3|eac3|5[._]1|7[._]1|2[._]0|dual|dublado|legendado)/gi, ' ')
        .replace(/\b(19|20)\d{2}\b/g, ' ');

    for (const pat of strictPatterns) {
      const found = seasonFiltered.find((f) => {
        const fullName = String((f as any).path || f.name || '');
        return pat.test(stripTechNoise(fullName));
      });
      if (found) return found;
    }

    // Padrões numéricos para Animes (ex: "[SubGroup] Solo Leveling - 01 [1080p].mkv" ou "One Piece - 001.mp4")
    const loosePatterns: RegExp[] = [
      new RegExp(`[-_\\s\\[]0*${epNum}(?:v\\d+)?(?=[\\s_.\\]\\(]|$)`, 'i'),
      new RegExp(`(?:^|[^0-9a-zA-Z])${epPadded3}(?!\\d)`),
      new RegExp(`(?:^|[^0-9a-zA-Z])${epPadded}(?!\\d)`)
    ];

    for (const pat of loosePatterns) {
      const found = seasonFiltered.find((f) => {
        // Remove códigos de temporada (ex: S01, 1ª Temporada) para que 'S01' não bata com episódio '01' em S01E02!
        const withoutSeasonAndTech = stripTechNoise(f.name)
          .replace(/[sS]0*\d+[._\s-]*[eE]0*\d+/g, ' ')
          .replace(/[sS]0*\d+/g, ' ')
          .replace(/\d+[ªa]?\s*temporada/gi, ' ')
          .replace(/season\s*0*\d+/gi, ' ');
        return pat.test(withoutSeasonAndTech);
      });
      if (found) return found;
    }

    // Se o pack está ordenado e tem múltiplos episódios e o índice (epNum - 1) existe na temporada filtrada
    if (seasonFiltered.length >= epNum && seasonFiltered.length > 1) {
      return seasonFiltered[epNum - 1];
    }

    return null;
  }

  findTargetVideoFile(
    engine: TorrentStream.TorrentEngine,
    fileIdx?: number,
    season?: number,
    episode?: number
  ): TorrentStream.TorrentFile | null {
    if (!engine.files || engine.files.length === 0) return null;

    const hash = (engine as any).infoHash?.toLowerCase?.();
    const meta = hash ? this.runtimeMetaMap.get(hash) : undefined;

    const videoExts = ['.mp4', '.mkv', '.webm', '.m4v', '.mov', '.avi', '.ts'];
    const allVideoFiles = engine.files.filter((f) =>
      videoExts.some((ext) => f.name.toLowerCase().endsWith(ext))
    );
    const nonSampleVideoFiles = allVideoFiles.filter(
      (f) => !/\bsample\b/i.test(f.name) || f.length > 25 * 1024 * 1024
    );
    const videoFiles = nonSampleVideoFiles.length > 0 ? nonSampleVideoFiles : allVideoFiles;
    const candidateFiles = videoFiles.length > 0 ? videoFiles : engine.files;

    const selectOnlyTarget = (target: TorrentStream.TorrentFile) => {
      for (const f of engine.files) {
        if (f !== target) {
          try {
            (f as any).deselect?.();
          } catch {}
        }
      }
      if (meta) {
        if (meta.targetFile && meta.targetFile !== target) {
          meta.lastSeekOffset = 0;
        }
        meta.targetFile = target;
      }
      return target;
    };

    // 1. Se for série ou anime com episódio especificado, garante correspondência exata do episódio!
    if (typeof episode === 'number' && episode > 0) {
      const matchedByEpisode = this.matchEpisodeInFileList(candidateFiles, season, episode);

      if (typeof fileIdx === 'number' && fileIdx >= 0 && fileIdx < engine.files.length) {
        const indexedFile = engine.files[fileIdx];
        const isIndexedVideo = videoFiles.length === 0 || videoFiles.includes(indexedFile);

        if (isIndexedVideo) {
          if (!matchedByEpisode || matchedByEpisode === indexedFile) {
            return selectOnlyTarget(indexedFile);
          }
          // Se fileIdx aponta para um arquivo cujo nome indica claramente OUTRO episódio (ex: E02 quando pedimos E01),
          // confia no match exato do episódio em vez do fileIdx defasado!
          return selectOnlyTarget(matchedByEpisode);
        }
      }

      if (matchedByEpisode) {
        return selectOnlyTarget(matchedByEpisode);
      }
    }

    // 2. Se fileIdx explícito e válido de vídeo for fornecido (sem episódio específico ou fallback)
    if (typeof fileIdx === 'number' && fileIdx >= 0 && fileIdx < engine.files.length) {
      const target = engine.files[fileIdx];
      if (videoFiles.length === 0 || videoFiles.includes(target)) {
        return selectOnlyTarget(target);
      }
    }

    // 3. Fallback padrão para filmes: maior arquivo de vídeo (ou primeiro em ordem natural se tamanhos similares)
    const main = candidateFiles.reduce((prev, curr) => (curr.length > prev.length ? curr : prev));
    return selectOnlyTarget(main);
  }

  findMainVideoFile(engine: TorrentStream.TorrentEngine): TorrentStream.TorrentFile | null {
    const hash = (engine as any).infoHash?.toLowerCase?.();
    if (hash) {
      const meta = this.runtimeMetaMap.get(hash);
      if (meta?.targetFile && engine.files.includes(meta.targetFile)) {
        return meta.targetFile;
      }
    }
    return this.findTargetVideoFile(engine);
  }

  private retryPeersInternal(
    hash: string,
    engine: TorrentStream.TorrentEngine,
    priorityMode?: TrackerPriorityMode,
    isAuto = true
  ): { retried: boolean; numPeers: number; autoRetryCount: number; trackerPriority: TrackerPriorityMode } {
    const meta: EngineRuntimeMeta = this.runtimeMetaMap.get(hash) || {
      createdAt: Date.now(),
      lastActivityTimestamp: Date.now(),
      trackerPriority: priorityMode || this.defaultTrackerPriority,
      autoRetryCount: 0,
      lastSeekOffset: 0,
      lastDownloadedBytes: 0,
      lastSampleAt: Date.now(),
      smoothedSpeed: 0
    };

    if (priorityMode) {
      meta.trackerPriority = priorityMode;
    }

    meta.autoRetryCount += 1;
    meta.lastRetryTimestamp = Date.now();
    this.runtimeMetaMap.set(hash, meta);

    let connectedAfter = 0;

    try {
      const anyEngine = engine as any;
      const swarm = engine.swarm as any;

      if (swarm && Array.isArray(swarm.wires)) {
        for (const wire of [...swarm.wires]) {
          if (!wire) continue;
          const wireSpeed = typeof wire.downloadSpeed === 'function' ? wire.downloadSpeed() : 0;
          if (wire.destroyed || (wire.peerChoking && wireSpeed === 0 && swarm.wires.length > 14)) {
            try {
              wire.destroy?.();
            } catch {}
          } else {
            wire.amInterested = true;
            try {
              wire.unchoke?.();
            } catch {}
          }
        }
        connectedAfter = swarm.wires.filter((w: any) => w && !w.destroyed).length;
      }

      const trackers = getTrackersForPriority(meta.trackerPriority);
      if (Array.isArray(anyEngine.trackers)) {
        for (const tr of trackers) {
          if (!anyEngine.trackers.includes(tr)) {
            anyEngine.trackers.push(tr);
          }
        }
      }

      if (this.sharedDht && typeof this.sharedDht.lookup === 'function') {
        try {
          this.sharedDht.lookup(hash);
        } catch {}
      }
      if (swarm && typeof swarm.resume === 'function') {
        swarm.resume();
      }

      this.advanceSlidingPieceWindow(hash, engine);

      console.log(
        `[TorrentEngine] ${isAuto ? 'Auto Re-try' : 'Re-try Manual'} em ${hash} [perfil=${meta.trackerPriority}, #${meta.autoRetryCount}, peers=${connectedAfter}]`
      );
    } catch (err: any) {
      console.warn('[TorrentEngine] Aviso durante re-try:', err.message);
    }

    return {
      retried: true,
      numPeers: connectedAfter,
      autoRetryCount: meta.autoRetryCount,
      trackerPriority: meta.trackerPriority
    };
  }

  async forceRetryPeers(
    magnetUri: string,
    trackerPriority?: TrackerPriorityMode
  ): Promise<{
    success: boolean;
    retried: boolean;
    stats: ActiveTorrentStats | null;
  }> {
    const hash = extractHash(magnetUri);
    let engine = this.enginesMap.get(hash);

    if (!engine) {
      try {
        engine = await this.getOrAddEngine(magnetUri, trackerPriority);
      } catch {
        return { success: false, retried: false, stats: null };
      }
    }

    this.retryPeersInternal(hash, engine, trackerPriority, false);
    return {
      success: true,
      retried: true,
      stats: this.getStats(magnetUri)
    };
  }

  /**
   * Limpa seleções customizadas antigas e força o cancelamento imediato de requisições de rede
   * para peças anteriores a startPiece, garantindo que o vídeo comece do ponto de seek sem baixar desde o início!
   */
  private applyCleanPriorityWindow(
    engine: TorrentStream.TorrentEngine,
    startPiece: number,
    endPiece: number,
    includeEndPieceForIndex: boolean = false
  ) {
    try {
      const anyEngine = engine as any;
      const bitfield = anyEngine.bitfield;

      // 1. Limpa da lista de seleções do torrent-stream qualquer intervalo que comece ou termine antes de startPiece
      if (Array.isArray(anyEngine.selection)) {
        for (let i = anyEngine.selection.length - 1; i >= 0; i--) {
          const sel = anyEngine.selection[i];
          if (!sel) continue;
          if (sel.to < startPiece || sel.priority >= 10 || sel.priority === 0 || !sel.priority) {
            anyEngine.selection.splice(i, 1);
          } else if (sel.from < startPiece) {
            sel.from = startPiece;
            sel.offset = 0;
          }
        }
      }

      // 2. Limpa o mapa interno de peças críticas (_critical) antes de startPiece para não reter peças antigas
      if (Array.isArray(anyEngine._critical)) {
        for (let p = 0; p < startPiece; p++) {
          anyEngine._critical[p] = false;
        }
      }

      // 3. Cancela requisições inflight nos wires P2P para peças anteriores a startPiece (BitTorrent CANCEL message)
      const swarm = anyEngine.swarm;
      const wires = Array.isArray(swarm?.wires) ? swarm.wires : [];
      if (startPiece > 0 && wires.length > 0) {
        for (const wire of wires) {
          if (!wire || wire.destroyed || !Array.isArray(wire.requests)) continue;
          for (let r = wire.requests.length - 1; r >= 0; r--) {
            const req = wire.requests[r];
            if (req && typeof req.piece === 'number' && req.piece < startPiece) {
              try {
                if (typeof wire.cancel === 'function') {
                  wire.cancel(req.piece, req.offset, req.length);
                }
              } catch {}
              wire.requests.splice(r, 1);
            }
          }
        }
      }

      // 4. Limpa reservas de peças anteriores a startPiece
      if (Array.isArray(anyEngine._reservations)) {
        for (let p = 0; p < Math.min(startPiece, anyEngine._reservations.length); p++) {
          anyEngine._reservations[p] = [];
        }
      }

      const endTailStart = Math.max(startPiece + 3, endPiece - 2);
      const needsEndIndex =
        includeEndPieceForIndex &&
        endPiece > startPiece + 3 &&
        (!bitfield ||
          typeof bitfield.get !== 'function' ||
          !bitfield.get(endPiece) ||
          !bitfield.get(endTailStart));

      // 5. Marca os primeiros blocos a partir de startPiece com prioridade crítica
      if (typeof anyEngine.critical === 'function') {
        const critWidth = Math.max(2, Math.min(4, endPiece - startPiece + 1));
        anyEngine.critical(startPiece, critWidth);

        if (needsEndIndex) {
          anyEngine.critical(endTailStart, endPiece - endTailStart + 1);
        }
      }

      // 6. Configura janelas decrescentes de prioridade EXCLUSIVAMENTE a partir de startPiece para frente
      if (typeof anyEngine.select === 'function') {
        if (needsEndIndex) {
          anyEngine.select(endTailStart, endPiece, 120);
        }
        anyEngine.select(startPiece, Math.min(endPiece, startPiece + 2), 180);
        anyEngine.select(startPiece, Math.min(endPiece, startPiece + 18), 100);
        anyEngine.select(startPiece, Math.min(endPiece, startPiece + 35), 40);
        anyEngine.select(startPiece, endPiece, 10);
      }

      if (typeof anyEngine.flood === 'function') {
        anyEngine.flood();
      }
    } catch {}
  }

  /**
   * Avança automaticamente a janela de prioridade acompanhando o stream mais recente (stream._piece)
   * e preserva a posição de seek do usuário para jamais regredir a zero!
   */
  private advanceSlidingPieceWindow(hash: string, engine: TorrentStream.TorrentEngine) {
    const mainFile = this.getActiveTargetFile(hash, engine) || this.findMainVideoFile(engine);
    if (!mainFile) return;

    const fileOffset = (mainFile as any).offset || 0;
    const pieceLength = (engine as any).torrent?.pieceLength || 1024 * 1024;
    const fileFirstPiece = Math.floor(fileOffset / pieceLength);
    const endPiece = Math.floor((fileOffset + mainFile.length - 1) / pieceLength);
    const bitfield = (engine as any).bitfield;
    const openingAlreadyCached = Boolean(
      bitfield && typeof bitfield.get === 'function' && bitfield.get(fileFirstPiece)
    );

    const meta = this.runtimeMetaMap.get(hash);
    const metaSeekPiece = meta?.lastSeekOffset
      ? Math.floor((fileOffset + meta.lastSeekOffset) / pieceLength)
      : 0;

    const activeStreams = this.activeReadStreamsMap.get(hash);
    if (activeStreams && activeStreams.size > 0) {
      const alivePlayback = Array.from(activeStreams).filter(
        (rs) =>
          rs &&
          !rs._destroyed &&
          !rs.readableEnded &&
          !rs._isIndexProbe &&
          typeof rs._piece === 'number' &&
          (typeof rs._missing !== 'number' || rs._missing > 0)
      );
      if (alivePlayback.length > 0) {
        // Encontra a peça mais avançada entre os streams ativos
        let maxStreamPiece = -1;
        for (const s of alivePlayback) {
          if (s._piece > maxStreamPiece) maxStreamPiece = s._piece;
        }
        const targetPiece = Math.max(metaSeekPiece, Math.min(endPiece, maxStreamPiece >= 0 ? maxStreamPiece : metaSeekPiece));
        this.applyCleanPriorityWindow(engine, targetPiece, endPiece, openingAlreadyCached);
        return;
      }
    }

    const startPiece = Math.max(metaSeekPiece, Math.floor((fileOffset + (meta?.lastSeekOffset || 0)) / pieceLength));
    this.applyCleanPriorityWindow(engine, startPiece, endPiece, openingAlreadyCached || startPiece > 0);
  }

  /**
   * Concentra toda a largura de banda P2P exatamente nos primeiros blocos a partir de seekByteOffset.
   * No início frio (seekByteOffset === 0), dedica 100% da banda apenas às primeiras peças antes de puxar o índice final!
   */
  private optimizePiecePriorities(
    engine: TorrentStream.TorrentEngine,
    seekByteOffset: number = 0,
    targetFile?: TorrentStream.TorrentFile
  ) {
    const hash = (engine as any).infoHash?.toLowerCase?.();
    const mainFile =
      targetFile ||
      (hash ? this.getActiveTargetFile(hash, engine) : null) ||
      this.findMainVideoFile(engine);
    if (!mainFile) return;

    if (hash && this.runtimeMetaMap.has(hash)) {
      this.runtimeMetaMap.get(hash)!.lastSeekOffset = seekByteOffset;
      this.runtimeMetaMap.get(hash)!.targetFile = mainFile;
    }

    for (const file of engine.files) {
      if (file !== mainFile) {
        try {
          file.deselect();
        } catch {}
      }
    }

    const fileOffset = (mainFile as any).offset || 0;
    const pieceLength = (engine as any).torrent?.pieceLength || 1024 * 1024;
    const fileFirstPiece = Math.floor(fileOffset / pieceLength);
    const startPiece = Math.floor((fileOffset + seekByteOffset) / pieceLength);
    const endPiece = Math.floor((fileOffset + mainFile.length - 1) / pieceLength);
    const bitfield = (engine as any).bitfield;
    const firstPieceReady = Boolean(
      bitfield && typeof bitfield.get === 'function' && bitfield.get(fileFirstPiece)
    );

    this.applyCleanPriorityWindow(engine, startPiece, endPiece, firstPieceReady);
  }

  private startWireOptimizer(hash: string, engine: TorrentStream.TorrentEngine) {
    this.stopWireOptimizer(hash);

    const interval = setInterval(() => {
      try {
        const swarm = engine.swarm as any;
        const meta = this.runtimeMetaMap.get(hash);
        const now = Date.now();

        if (swarm && meta) {
          const downloadedNow = Number(swarm.downloaded) || 0;
          const dtSec = Math.max(0.5, (now - meta.lastSampleAt) / 1000);
          const deltaSpeed = Math.max(0, (downloadedNow - meta.lastDownloadedBytes) / dtSec);
          const swarmFnSpeed =
            typeof swarm.downloadSpeed === 'function' ? Number(swarm.downloadSpeed()) || 0 : 0;
          const instantSpeed = Math.max(swarmFnSpeed, deltaSpeed);

          meta.smoothedSpeed =
            meta.smoothedSpeed > 0 ? meta.smoothedSpeed * 0.45 + instantSpeed * 0.55 : instantSpeed;
          meta.lastDownloadedBytes = downloadedNow;
          meta.lastSampleAt = now;
        }

        // Mantém a janela de peças sempre colada no stream._piece real a cada 1.8s!
        this.advanceSlidingPieceWindow(hash, engine);

        const wires = Array.isArray(swarm?.wires) ? swarm.wires : [];
        const activeWires = wires.filter((w: any) => w && !w.destroyed);

        if (activeWires.length > 0) {
          activeWires.sort((a: any, b: any) => {
            const speedA = typeof a.downloadSpeed === 'function' ? a.downloadSpeed() : 0;
            const speedB = typeof b.downloadSpeed === 'function' ? b.downloadSpeed() : 0;
            return speedB - speedA;
          });

          const topPeersCount = Math.min(40, activeWires.length);
          for (let i = 0; i < topPeersCount; i++) {
            const wire = activeWires[i];
            wire.amInterested = true;
            if (typeof wire.unchoke === 'function') {
              wire.unchoke();
            }
          }
        }

        if (
          meta &&
          (this.activeStreamsCount.get(hash) || 0) > 0 &&
          meta.autoRetryCount < 8
        ) {
          const mainFile = this.findMainVideoFile(engine);
          const totalLen = mainFile ? mainFile.length : 1;
          const progress = ((Number(swarm?.downloaded) || 0) / totalLen) * 100;
          const aliveMs = now - meta.createdAt;
          const sinceLastRetryMs = meta.lastRetryTimestamp ? now - meta.lastRetryTimestamp : Infinity;

          const isLowTransfer =
            progress < 98 &&
            aliveMs >= 8000 &&
            (meta.smoothedSpeed < LOW_SPEED_THRESHOLD_BYTES_SEC || activeWires.length < 2);

          if (isLowTransfer && sinceLastRetryMs >= AUTO_RETRY_COOLDOWN_MS) {
            this.retryPeersInternal(hash, engine, meta.trackerPriority, true);
          }
        }
      } catch {}
    }, 1800);

    this.wireOptimizerIntervals.set(hash, interval);
  }

  private stopWireOptimizer(hash: string) {
    if (this.wireOptimizerIntervals.has(hash)) {
      clearInterval(this.wireOptimizerIntervals.get(hash)!);
      this.wireOptimizerIntervals.delete(hash);
    }
  }

  prefetchNextPieces(
    magnetUri: string,
    currentTimeSeconds: number,
    durationSeconds: number,
    detectedSpeedBytesPerSec: number = 1024 * 1024 * 2
  ): { success: boolean; prefetchedPieces: number[]; prefetchedCount: number; targetWindow: number } {
    try {
      const hash = extractHash(magnetUri);
      const engine = this.enginesMap.get(hash);
      if (!engine) {
        return { success: false, prefetchedPieces: [], prefetchedCount: 0, targetWindow: 0 };
      }

      const mainFile = this.findMainVideoFile(engine);
      if (!mainFile) {
        return { success: false, prefetchedPieces: [], prefetchedCount: 0, targetWindow: 0 };
      }

      const fileOffset = (mainFile as any).offset || 0;
      const pieceLength = (engine as any).torrent?.pieceLength || 1024 * 1024;
      const endPiece = Math.floor((fileOffset + mainFile.length - 1) / pieceLength);

      // Usa o cursor REAL do stream de reprodução ativo (stream._piece) sempre que disponível para nunca pular peças VBR!
      let currentPiece = -1;
      let hasActivePlaybackStream = false;
      const activeStreams = this.activeReadStreamsMap.get(hash);
      if (activeStreams && activeStreams.size > 0) {
        const alivePlayback = Array.from(activeStreams).filter(
          (rs) =>
            rs &&
            !rs._destroyed &&
            !rs.readableEnded &&
            !rs._isIndexProbe &&
            typeof rs._piece === 'number' &&
            (typeof rs._missing !== 'number' || rs._missing > 0)
        );
        if (alivePlayback.length > 0) {
          hasActivePlaybackStream = true;
          currentPiece = alivePlayback[alivePlayback.length - 1]._piece;
        }
      }
      if (currentPiece < 0) {
        const dur = Math.max(1, durationSeconds);
        const currentByteOffset = Math.floor((Math.max(0, currentTimeSeconds) / dur) * mainFile.length);
        currentPiece = Math.floor((fileOffset + currentByteOffset) / pieceLength);
      }

      const pieceLenMB = pieceLength > 0 ? pieceLength : 1024 * 1024;
      const targetPrefetchBytes = PREFETCH_WINDOW_SECONDS * Math.max(400 * 1024, detectedSpeedBytesPerSec);
      const prefetchCount = Math.max(8, Math.min(25, Math.ceil(targetPrefetchBytes / pieceLenMB)));
      const startPrefetch = Math.min(endPiece, currentPiece);
      const endPrefetch = Math.min(endPiece, startPrefetch + prefetchCount - 1);

      const prefetchedPieces: number[] = [];
      for (let p = startPrefetch; p <= endPrefetch; p++) {
        prefetchedPieces.push(p);
      }

      const fileFirstPiece = Math.floor(fileOffset / pieceLength);
      const bitfield = (engine as any).bitfield;
      const firstPieceReady = Boolean(
        bitfield && typeof bitfield.get === 'function' && bitfield.get(fileFirstPiece)
      );
      if (this.runtimeMetaMap.has(hash) && currentTimeSeconds > 1 && !hasActivePlaybackStream) {
        const dur = Math.max(1, durationSeconds);
        this.runtimeMetaMap.get(hash)!.lastSeekOffset = Math.floor(
          (Math.max(0, currentTimeSeconds) / dur) * mainFile.length
        );
      }

      this.applyCleanPriorityWindow(engine, startPrefetch, endPiece, firstPieceReady || currentTimeSeconds > 1);

      return {
        success: true,
        prefetchedPieces,
        prefetchedCount: prefetchedPieces.length,
        targetWindow: prefetchCount
      };
    } catch {
      return { success: false, prefetchedPieces: [], prefetchedCount: 0, targetWindow: 0 };
    }
  }

  async preload(
    magnetUri: string,
    trackerPriority?: TrackerPriorityMode,
    targetOpts?: { fileIdx?: number; season?: number; episode?: number }
  ): Promise<boolean> {
    const hash = extractHash(magnetUri);
    try {
      const engine = await this.getOrAddEngine(magnetUri, trackerPriority, targetOpts);
      if (targetOpts && (typeof targetOpts.episode === 'number' || typeof targetOpts.fileIdx === 'number')) {
        const target = this.findTargetVideoFile(engine, targetOpts.fileIdx, targetOpts.season, targetOpts.episode);
        if (target) {
          this.optimizePiecePriorities(engine, 0, target);
        }
      }
      // Agenda limpeza caso o usuário feche o modal sem dar play
      this.scheduleCleanup(hash, 75000);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Lê os primeiros 128KB do arquivo validando que o enxame realmente está entregando bytes reais
   * (impede travamento infinito em torrents "fantasmas" com metadados .torrent em cache mas 0 peers reais!)
   */
  private getOrProbeMediaInfo(
    hash: string,
    engine: TorrentStream.TorrentEngine,
    file: TorrentStream.TorrentFile,
    timeoutMs: number = 14000
  ): Promise<{ info: ProbedMediaInfo | null; gotBytes: boolean }> {
    const bitfield = (engine as any).bitfield;
    const fileOffset = (file as any).offset || 0;
    const pieceLength = (engine as any).torrent?.pieceLength || 1024 * 1024;
    const firstPiece = Math.floor(fileOffset / pieceLength);
    const hasPieceZero = Boolean(
      bitfield && typeof bitfield.get === 'function' && bitfield.get(firstPiece)
    );
    const probeKey = `${hash}:${(file as any).path || file.name}`;

    if (this.mediaProbeCache.has(probeKey) && hasPieceZero) {
      return Promise.resolve({ info: this.mediaProbeCache.get(probeKey) || null, gotBytes: true });
    }

    return new Promise<{ info: ProbedMediaInfo | null; gotBytes: boolean }>((resolve) => {
      const readLen = Math.min(file.length - 1, 131071);
      if (readLen < 4096) {
        resolve({ info: null, gotBytes: true });
        return;
      }

      try {
        if (typeof (engine.swarm as any)?.resume === 'function') {
          (engine.swarm as any).resume();
        }
        (engine as any).critical?.(firstPiece, 2);
        const wires = (engine as any).swarm?.wires;
        if (Array.isArray(wires)) {
          for (const w of wires) {
            if (w) {
              w.amInterested = true;
              try { w.unchoke?.(); } catch {}
            }
          }
        }
      } catch {}

      let done = false;
      const chunks: Buffer[] = [];
      let total = 0;
      let rs: any = null;

      const finish = async (buf: Buffer | null) => {
        if (done) return;
        done = true;
        if (rs) {
          this.unregisterReadStream(hash, rs);
          try {
            rs.destroy();
          } catch {}
        }
        if (!buf || buf.length === 0) {
          resolve({ info: null, gotBytes: false });
          return;
        }
        if (buf.length < 4096) {
          resolve({ info: null, gotBytes: true });
          return;
        }
        if (this.mediaProbeCache.has(probeKey)) {
          resolve({ info: this.mediaProbeCache.get(probeKey) || null, gotBytes: true });
          return;
        }
        const info = await transcoder.probeBufferStreams(buf);
        if (info) {
          this.mediaProbeCache.set(probeKey, info);
        }
        resolve({ info, gotBytes: true });
      };

      const timeout = setTimeout(() => {
        finish(total > 0 ? Buffer.concat(chunks) : null);
      }, timeoutMs);

      try {
        rs = file.createReadStream({ start: 0, end: readLen });
        this.registerReadStream(hash, rs);
        rs.on('data', (chunk: Buffer) => {
          chunks.push(chunk);
          total += chunk.length;
          if (total >= readLen + 1) {
            clearTimeout(timeout);
            finish(Buffer.concat(chunks));
          }
        });
        rs.on('end', () => {
          clearTimeout(timeout);
          finish(total > 0 ? Buffer.concat(chunks) : null);
        });
        rs.on('error', () => {
          clearTimeout(timeout);
          finish(null);
        });
      } catch {
        clearTimeout(timeout);
        finish(null);
      }
    });
  }

  /**
   * Corrida paralela inteligente entre sementes da MESMA qualidade e MESMO idioma no início frio:
   * A primeira semente que entregar bytes reais de vídeo vence imediatamente, descartando torrents fantasmas sem peers!
   */
  async raceLiveCandidates(
    magnets: string[],
    trackerPriority?: TrackerPriorityMode,
    timeoutMs: number = 10500
  ): Promise<string> {
    const valid = magnets.filter(Boolean);
    if (valid.length <= 1) return valid[0] || '';

    // Se a primeira semente já estiver aquecida e com peças baixadas, usa imediatamente sem corrida
    const primaryHash = extractHash(valid[0]);
    const existingPrimary = this.enginesMap.get(primaryHash);
    if (existingPrimary && ((existingPrimary.swarm as any)?.downloaded || 0) > 32768) {
      return valid[0];
    }

    const pool = valid.slice(0, 2);
    let winnerHash = '';

    const racers = pool.map(async (mag, idx) => {
      const h = extractHash(mag);
      if (idx > 0) {
        await new Promise((r) => setTimeout(r, idx * 250));
        if (winnerHash) throw new Error('RACE_ALREADY_WON');
      }

      const eng = await this.getOrAddEngine(mag, trackerPriority);
      if (winnerHash && winnerHash !== h) {
        this.scheduleCleanup(h, 800);
        throw new Error('RACE_ALREADY_WON');
      }

      const f = this.findMainVideoFile(eng);
      if (!f) {
        this.scheduleCleanup(h, 800);
        throw new Error('NO_VIDEO_FILE');
      }

      this.optimizePiecePriorities(eng, 0);
      const { gotBytes } = await this.getOrProbeMediaInfo(h, eng, f, timeoutMs);
      if (!gotBytes) {
        this.scheduleCleanup(h, 800);
        throw new Error('DEAD_SWARM');
      }

      if (!winnerHash) {
        winnerHash = h;
      } else if (winnerHash !== h) {
        this.scheduleCleanup(h, 800);
        throw new Error('RACE_ALREADY_WON');
      }

      // Decrementa a contagem temporária da corrida mantendo o motor vivo por 60s para o handleStreamRequest em seguida
      this.scheduleCleanup(h, 60000);
      return mag;
    });

    try {
      const winnerMagnet = await Promise.any(racers);
      console.log(`[TorrentEngine] Semente ativa vencedora confirmada com bytes reais: ${extractHash(winnerMagnet)}`);
      return winnerMagnet;
    } catch {
      return valid[0];
    }
  }

  /**
   * FASE 4: Fecha automaticamente qualquer stream anterior do mesmo usuario/IP ao trocar de faixa ou abrir novo video
   */
  private registerClientActiveStream(clientIp: string, hash: string, abortFn: () => void) {
    const prev = this.activeClientStreamByIp.get(clientIp);
    if (prev && prev.hash !== hash) {
      try {
        prev.abort();
      } catch {}
    }
    this.activeClientStreamByIp.set(clientIp, { hash, abort: abortFn });
  }

  /**
   * Streaming HTTP 206 Partial Content (MP4/WebM) ou Remuxing FFmpeg nativo em tempo real (MKV Dual Audio PT-BR)
   * com Health Check de 5 segundos (Fase 2) para downgrade automatico de qualidade (ex: 1080p -> 720p)
   * e blindagem de memoria (Fase 4) em req.on('close'), req.on('end') e res.on('error').
   */
  async handleStreamRequest(
    req: Request,
    res: Response,
    magnetUri: string,
    forceTranscode: boolean = false,
    audioOnly: boolean = false,
    trackerPriority?: TrackerPriorityMode,
    extra: StreamExtraOptions = {}
  ): Promise<void> {
    const hash = extractHash(magnetUri);
    const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || 'local')
      .split(',')[0]
      .trim();
    this.touchActivity(hash);

    let engine: TorrentStream.TorrentEngine;
    try {
      engine = await this.getOrAddEngine(magnetUri, trackerPriority, {
        fileIdx: extra.fileIdx,
        season: extra.season,
        episode: extra.episode
      });
    } catch (err) {
      if (extra.fallbackMagnet && !extra.isFallbackAttempt) {
        this.destroyEngine(hash, true);
        const fbQual = extra.fallbackQuality || '720p';
        res.setHeader('X-Popoca-Quality-Fallback', fbQual);
        res.setHeader(
          'X-Popoca-Fallback-Message',
          `Conexão ajustada para ${fbQual} para reprodução imediata`
        );
        return this.handleStreamRequest(req, res, extra.fallbackMagnet, forceTranscode, audioOnly, trackerPriority, {
          ...extra,
          fileIdx: extra.fallbackFileIdx,
          fallbackMagnet: undefined,
          isFallbackAttempt: true
        });
      }
      throw err;
    }

    const file = this.findTargetVideoFile(engine, extra.fileIdx, extra.season, extra.episode);

    if (!file) {
      this.scheduleCleanup(hash, 5000);
      throw new Error('VIDEO_FILE_NOT_FOUND: Arquivo de vídeo não encontrado no torrent.');
    }

    const isWebNative = transcoder.isWebNative(file.name);
    const seekSec = extra.seekSeconds && extra.seekSeconds > 0 ? extra.seekSeconds : 0;
    const hasCustomAudioTrack = typeof extra.audioTrackIndex === 'number' && extra.audioTrackIndex >= 0;
    const needsTranscode = forceTranscode || audioOnly || !isWebNative || hasCustomAudioTrack;

    res.setHeader(
      'Access-Control-Expose-Headers',
      'X-Popoca-Stream-Mode, X-Popoca-Active-Hash, X-Popoca-Real-Lang, X-Popoca-Quality-Fallback, X-Popoca-Fallback-Message, Content-Range, Accept-Ranges'
    );

    const hasFallback = Boolean(extra.fallbackMagnet && !extra.isFallbackAttempt && seekSec === 0);
    const canFailoverQuickly = Boolean((hasFallback || extra.hasAlternatives) && seekSec === 0);
    const activeWiresCount = Array.isArray((engine.swarm as any)?.wires)
      ? (engine.swarm as any).wires.filter((w: any) => w && !w.destroyed).length
      : 0;
    const healthTimeoutMs =
      canFailoverQuickly && activeWiresCount === 0 && ((engine.swarm as any)?.downloaded || 0) === 0
        ? HEALTH_CHECK_TIMEOUT_MS
        : canFailoverQuickly
        ? 6500
        : 14000;

    if (needsTranscode) {
      const rangeHeader = req.headers.range;
      if (rangeHeader && rangeHeader.startsWith('bytes=')) {
        const rangeStart = parseInt(rangeHeader.replace(/bytes=/, '').split('-')[0], 10);
        if (!isNaN(rangeStart) && rangeStart > 0) {
          this.scheduleCleanup(hash, 30000);
          res.status(416).end();
          return;
        }
      }

      const clientKey = `${clientIp}:${hash}`;
      const prevCancel = this.activeClientTranscodeMap.get(clientKey);
      if (prevCancel) {
        this.activeClientTranscodeMap.delete(clientKey);
        try {
          prevCancel();
        } catch {}
      }

      const fileOffset = (file as any).offset || 0;
      const pieceLength = (engine as any).torrent?.pieceLength || 1024 * 1024;
      const fileFirstPiece = Math.floor(fileOffset / pieceLength);
      const endPiece = Math.floor((fileOffset + file.length - 1) / pieceLength);
      const bitfield = (engine as any).bitfield;
      const endIndexCached = Boolean(
        bitfield && typeof bitfield.get === 'function' && bitfield.get(endPiece)
      );

      const useHttpLoopbackSeek = seekSec > 1.5 && this.localRawPort > 0;

      if (useHttpLoopbackSeek) {
        const meta = this.runtimeMetaMap.get(hash);
        const estOffset =
          meta?.lastSeekOffset && meta.lastSeekOffset > 0
            ? meta.lastSeekOffset
            : Math.min(file.length - 1, Math.floor((seekSec / 6600) * file.length));
        const estStartPiece = Math.floor((fileOffset + estOffset) / pieceLength);
        this.applyCleanPriorityWindow(engine, estStartPiece, endPiece, true);
        if (!endIndexCached) {
          try {
            (engine as any).critical?.(Math.max(fileFirstPiece, endPiece - 1), 2);
          } catch {}
        }
      } else {
        this.optimizePiecePriorities(engine, 0, file);
      }

      // FASE 2: Health Check de 5 segundos na qualidade escolhida (apenas em cold start seekSec === 0)
      const { info: probedInfo, gotBytes } = await this.getOrProbeMediaInfo(
        hash,
        engine,
        file,
        healthTimeoutMs
      );
      if (req.destroyed || res.writableEnded) {
        this.scheduleCleanup(hash, 15000);
        return;
      }

      if (!gotBytes) {
        if (hasFallback && extra.fallbackMagnet) {
          const fbQual = extra.fallbackQuality || '720p';
          console.log(
            `[Health Check 5s] Qualidade ${extra.preferredQuality || '1080p'} sem velocidade suficiente em 5s. Fazendo downgrade automatico para ${fbQual}.`
          );
          this.scheduleCleanup(hash, 5000);
          res.setHeader('X-Popoca-Quality-Fallback', fbQual);
          res.setHeader(
            'X-Popoca-Fallback-Message',
            `Conexão ajustada para ${fbQual} para reprodução imediata`
          );
          return this.handleStreamRequest(
            req,
            res,
            extra.fallbackMagnet,
            forceTranscode,
            audioOnly,
            trackerPriority,
            {
              ...extra,
              fileIdx: extra.fallbackFileIdx,
              fallbackMagnet: undefined,
              isFallbackAttempt: true
            }
          );
        }
        this.scheduleCleanup(hash, 5000);
        throw new Error('P2P_SWARM_NO_BYTES: Nenhum peer entregou blocos a tempo.');
      }

      res.status(200);
      res.setHeader('X-Popoca-Stream-Mode', 'transcode');
      res.setHeader('X-Popoca-Active-Hash', hash);
      if (probedInfo?.hasPortugueseAudioTrack === false && extra.preferPortugueseAudio) {
        res.setHeader('X-Popoca-Real-Lang', 'en');
      } else if (probedInfo?.hasPortugueseAudioTrack) {
        res.setHeader('X-Popoca-Real-Lang', 'pt-br');
      }
      res.setHeader('Content-Type', audioOnly ? 'audio/aac' : 'video/mp4');
      res.setHeader('Transfer-Encoding', 'chunked');
      res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
      if (typeof (res as any).flushHeaders === 'function') {
        (res as any).flushHeaders();
      }

      let directReadStream: any = null;
      let inputSource: any;

      if (useHttpLoopbackSeek) {
        inputSource = `http://127.0.0.1:${this.localRawPort}/raw/${hash}`;
      } else {
        directReadStream = file.createReadStream();
        this.registerReadStream(hash, directReadStream);
        inputSource = directReadStream;
      }

      let cleanedUp = false;
      const triggerOnceCleanup = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        if (this.activeClientTranscodeMap.get(clientKey) === abortCurrentTranscode) {
          this.activeClientTranscodeMap.delete(clientKey);
        }
        if (directReadStream) {
          this.unregisterReadStream(hash, directReadStream);
          try {
            directReadStream.destroy();
          } catch {}
        }
        this.scheduleCleanup(hash, 25000);
      };

      const transcodeJob = transcoder.transcodeStream(inputSource, res, {
        seekSeconds: seekSec > 1.5 ? seekSec : undefined,
        audioOnly,
        preferPortugueseAudio: extra.preferPortugueseAudio !== false,
        audioTrackIndex: extra.audioTrackIndex,
        probedInfo,
        sourceFileName: `${magnetUri} ${file.name}`,
        priority: 1,
        onCancel: triggerOnceCleanup
      });

      const abortCurrentTranscode = () => {
        try {
          if (directReadStream) directReadStream.destroy();
          transcodeJob.cancel();
        } catch {}
        triggerOnceCleanup();
      };
      this.activeClientTranscodeMap.set(clientKey, abortCurrentTranscode);
      this.registerClientActiveStream(clientIp, hash, abortCurrentTranscode);

      req.on('close', abortCurrentTranscode);
      req.on('end', abortCurrentTranscode);
      res.on('error', abortCurrentTranscode);

      return;
    }

    const fileSize = file.length;
    const parsedRange = parseHttpRange(req.headers.range, fileSize);

    if (parsedRange === 'unsatisfiable') {
      this.scheduleCleanup(hash, 30000);
      res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
      return;
    }

    if (parsedRange === null) {
      this.optimizePiecePriorities(engine, 0, file);

      res.setHeader('X-Popoca-Stream-Mode', 'native');
      res.setHeader('X-Popoca-Active-Hash', hash);
      res.setHeader('Content-Type', 'video/mp4');
      res.setHeader('Content-Length', fileSize);
      res.setHeader('Accept-Ranges', 'bytes');
      const readStream = file.createReadStream();
      this.registerReadStream(hash, readStream);

      let closed = false;
      const cleanupFullStream = () => {
        if (closed) return;
        closed = true;
        this.unregisterReadStream(hash, readStream);
        try {
          readStream.destroy();
        } catch {}
        this.scheduleCleanup(hash, 25000);
      };

      readStream.on('error', () => {
        cleanupFullStream();
        if (!res.headersSent) res.status(500).end();
      });
      readStream.pipe(res);

      req.on('close', cleanupFullStream);
      req.on('end', cleanupFullStream);
      res.on('error', cleanupFullStream);
      return;
    }

    const { start, end } = parsedRange;

    // Prioriza imediatamente as peças a partir de 'start' do arquivo ANTES do probe para que episódios MP4 em Season Packs (offset > 0) baixem na hora!
    this.optimizePiecePriorities(engine, start, file);

    if (start === 0) {
      const { gotBytes } = await this.getOrProbeMediaInfo(hash, engine, file, healthTimeoutMs);
      if (req.destroyed || res.writableEnded) {
        this.scheduleCleanup(hash, 15000);
        return;
      }
      if (!gotBytes) {
        if (hasFallback && extra.fallbackMagnet) {
          const fbQual = extra.fallbackQuality || '720p';
          console.log(
            `[Health Check 5s] Qualidade ${extra.preferredQuality || '1080p'} sem velocidade suficiente em 5s. Fazendo downgrade automatico para ${fbQual}.`
          );
          this.scheduleCleanup(hash, 5000);
          res.setHeader('X-Popoca-Quality-Fallback', fbQual);
          res.setHeader(
            'X-Popoca-Fallback-Message',
            `Conexão ajustada para ${fbQual} para reprodução imediata`
          );
          return this.handleStreamRequest(
            req,
            res,
            extra.fallbackMagnet,
            forceTranscode,
            audioOnly,
            trackerPriority,
            {
              ...extra,
              fileIdx: extra.fallbackFileIdx,
              fallbackMagnet: undefined,
              isFallbackAttempt: true
            }
          );
        }
        this.scheduleCleanup(hash, 5000);
        throw new Error('P2P_SWARM_NO_BYTES: Nenhum peer entregou blocos MP4 a tempo.');
      }
    }

    const chunkSize = end - start + 1;
    const pieceLength = (engine as any).torrent?.pieceLength || 1024 * 1024;
    const fileOffset = (file as any).offset || 0;
    const absStart = fileOffset + start;
    const absEnd = fileOffset + end;
    const startPiece = Math.floor(absStart / pieceLength);
    const endPieceReq = Math.floor(absEnd / pieceLength);

    // Se todas as peças do range solicitado estiverem em memória no cache inteligente, serve imediatamente
    let allCached = true;
    for (let p = startPiece; p <= endPieceReq; p++) {
      if (!this.getChunkFromCache(hash, p)) {
        allCached = false;
        break;
      }
    }

    if (allCached) {
      const pieceBuffers: Buffer[] = [];
      for (let p = startPiece; p <= endPieceReq; p++) {
        const b = this.getChunkFromCache(hash, p);
        if (b) pieceBuffers.push(b);
      }
      const combined = Buffer.concat(pieceBuffers);
      const pieceStartByte = startPiece * pieceLength;
      const sliceStart = absStart - pieceStartByte;
      const sliceLen = chunkSize;
      if (sliceStart >= 0 && sliceStart + sliceLen <= combined.length) {
        const slice = combined.subarray(sliceStart, sliceStart + sliceLen);
        res.writeHead(206, {
          'X-Popoca-Stream-Mode': 'native-cache',
          'X-Popoca-Active-Hash': hash,
          'Content-Range': `bytes ${start}-${end}/${fileSize}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': slice.length,
          'Content-Type': 'video/mp4',
          'Cache-Control': 'no-cache'
        });
        res.end(slice);
        this.scheduleCleanup(hash, 25000);
        return;
      }
    }

    res.writeHead(206, {
      'X-Popoca-Stream-Mode': 'native',
      'X-Popoca-Active-Hash': hash,
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunkSize,
      'Content-Type': 'video/mp4',
      'Cache-Control': 'no-cache'
    });

    const chunkStream = file.createReadStream({ start, end });
    this.registerReadStream(hash, chunkStream);

    let chunkClosed = false;
    const cleanupChunkStream = () => {
      if (chunkClosed) return;
      chunkClosed = true;
      this.unregisterReadStream(hash, chunkStream);
      try {
        chunkStream.destroy();
      } catch {}
      this.scheduleCleanup(hash, 25000);
    };

    chunkStream.on('error', () => {
      cleanupChunkStream();
      if (!res.headersSent) res.status(500).end();
    });
    chunkStream.pipe(res);

    req.on('close', cleanupChunkStream);
    req.on('end', cleanupChunkStream);
    res.on('error', cleanupChunkStream);
  }

  /**
   * FASE 3: Muxing Hibrido em Tempo Real (Video 4K/1080p EN + Audio 720p PT-BR)
   * Inicia duas instancias leves do torrent-stream com Super Trackers ativados e passa os streams
   * de leitura para o fluent-ffmpeg (-map 0:v:0 -map 1:a:0 -c:v copy -c:a aac -b:a 192k -ac 2)
   * entregando Fragmented MP4 via .pipe(res).
   */
  async handleHybridStreamRequest(
    req: Request,
    res: Response,
    videoMagnet: string,
    audioMagnet: string,
    options: {
      seekSeconds?: number;
      audioDelayMs?: number;
      trackerPriority?: TrackerPriorityMode;
      season?: number;
      episode?: number;
    } = {}
  ): Promise<void> {
    const videoHash = extractHash(videoMagnet);
    const audioHash = extractHash(audioMagnet);
    const clientIp = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || req.ip || 'local')
      .split(',')[0]
      .trim();

    const [videoEngine, audioEngine] = await Promise.all([
      this.getOrAddEngine(videoMagnet, options.trackerPriority),
      this.getOrAddEngine(audioMagnet, options.trackerPriority)
    ]);

    const videoFile = this.findTargetVideoFile(videoEngine, undefined, options.season, options.episode);
    const audioFile = this.findTargetVideoFile(audioEngine, undefined, options.season, options.episode);

    if (!videoFile || !audioFile) {
      this.scheduleCleanup(videoHash, 5000);
      this.scheduleCleanup(audioHash, 5000);
      throw new Error('HYBRID_FILES_NOT_FOUND: Arquivos de vídeo ou áudio não encontrados nos torrents.');
    }

    this.optimizePiecePriorities(videoEngine, 0, videoFile);
    this.optimizePiecePriorities(audioEngine, 0, audioFile);

    const [vProbe, aProbe] = await Promise.all([
      this.getOrProbeMediaInfo(videoHash, videoEngine, videoFile, 12000),
      this.getOrProbeMediaInfo(audioHash, audioEngine, audioFile, 12000)
    ]);

    if (req.destroyed || res.writableEnded) {
      this.scheduleCleanup(videoHash, 10000);
      this.scheduleCleanup(audioHash, 10000);
      return;
    }

    if (!vProbe.gotBytes || !aProbe.gotBytes) {
      this.scheduleCleanup(videoHash, 2000);
      this.scheduleCleanup(audioHash, 2000);
      throw new Error('HYBRID_SWARM_NO_BYTES: Enxame híbrido sem peers suficientes no momento.');
    }

    res.status(200);
    res.setHeader(
      'Access-Control-Expose-Headers',
      'X-Popoca-Stream-Mode, X-Popoca-Active-Hash, X-Popoca-Audio-Hash'
    );
    res.setHeader('X-Popoca-Stream-Mode', 'hybrid-mux');
    res.setHeader('X-Popoca-Active-Hash', videoHash);
    res.setHeader('X-Popoca-Audio-Hash', audioHash);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    if (typeof (res as any).flushHeaders === 'function') {
      (res as any).flushHeaders();
    }

    const seekSec = options.seekSeconds && options.seekSeconds > 0 ? options.seekSeconds : 0;
    const useLoopback = seekSec > 1.5 && this.localRawPort > 0;

    let videoReadStream: any = null;
    let audioReadStream: any = null;
    let videoInput: any;
    let audioInput: any;

    if (useLoopback) {
      videoInput = `http://127.0.0.1:${this.localRawPort}/raw/${videoHash}`;
      audioInput = `http://127.0.0.1:${this.localRawPort}/raw/${audioHash}`;
    } else {
      videoReadStream = videoFile.createReadStream();
      audioReadStream = audioFile.createReadStream();
      this.registerReadStream(videoHash, videoReadStream);
      this.registerReadStream(audioHash, audioReadStream);
      videoInput = videoReadStream;
      audioInput = audioReadStream;
    }

    let cleaned = false;
    const cleanupHybrid = () => {
      if (cleaned) return;
      cleaned = true;
      if (videoReadStream) {
        this.unregisterReadStream(videoHash, videoReadStream);
        try {
          videoReadStream.destroy();
        } catch {}
      }
      if (audioReadStream) {
        this.unregisterReadStream(audioHash, audioReadStream);
        try {
          audioReadStream.destroy();
        } catch {}
      }
      this.scheduleCleanup(videoHash, 10000);
      this.scheduleCleanup(audioHash, 10000);
    };

    const hybridJob = transcoder.transcodeHybridStream(videoInput, audioInput, res, {
      seekSeconds: seekSec > 1.5 ? seekSec : undefined,
      audioDelayMs: options.audioDelayMs,
      onCancel: cleanupHybrid
    });

    const abortHybrid = () => {
      try {
        hybridJob.cancel();
      } catch {}
      cleanupHybrid();
    };

    this.registerClientActiveStream(clientIp, `${videoHash}+${audioHash}`, abortHybrid);

    req.on('close', abortHybrid);
    req.on('end', abortHybrid);
    res.on('error', abortHybrid);
  }

  getStats(magnetUri: string): ActiveTorrentStats | null {
    try {
      const hash = extractHash(magnetUri);
      const engine = this.enginesMap.get(hash);
      if (!engine) return null;
      this.touchActivity(hash);

      const mainFile = this.findMainVideoFile(engine);
      const swarmAny = engine.swarm as any;
      const meta = this.runtimeMetaMap.get(hash);

      const downloaded = Number(swarmAny?.downloaded) || 0;
      const totalLength = mainFile ? mainFile.length : 1;
      const progress = Math.min(100, Number(((downloaded / totalLength) * 100).toFixed(1)));

      const wires = Array.isArray(swarmAny?.wires)
        ? swarmAny.wires.filter((w: any) => w && !w.destroyed)
        : [];
      const numPeers = wires.length;
      const activePeers = wires.filter((w: any) => {
        const spd = typeof w.downloadSpeed === 'function' ? w.downloadSpeed() : 0;
        return !w.peerChoking || spd > 0;
      }).length;

      const swarmDl =
        typeof swarmAny?.downloadSpeed === 'function' ? Number(swarmAny.downloadSpeed()) || 0 : 0;
      const swarmUl =
        typeof swarmAny?.uploadSpeed === 'function' ? Number(swarmAny.uploadSpeed()) || 0 : 0;
      const downloadSpeed = Math.round(Math.max(swarmDl, meta?.smoothedSpeed || 0));
      const uploadSpeed = Math.round(swarmUl);

      const bitfield = (engine as any).bitfield;
      const totalPieces = (engine as any).torrent?.pieces ? (engine as any).torrent.pieces.length : 0;
      const pieceLength = (engine as any).torrent?.pieceLength || 0;
      const pieceMap = generatePieceMap(bitfield, totalPieces, 60);

      return {
        infoHash: hash,
        name: mainFile?.name || 'Vídeo Popoca',
        progress,
        downloadSpeed,
        uploadSpeed,
        numPeers,
        activePeers,
        length: totalLength,
        downloaded,
        trackerPriority: meta?.trackerPriority || this.defaultTrackerPriority,
        autoRetryCount: meta?.autoRetryCount || 0,
        lastRetryTimestamp: meta?.lastRetryTimestamp,
        isLowSpeed: progress < 98 && downloadSpeed < LOW_SPEED_THRESHOLD_BYTES_SEC,
        pieceMap,
        totalPieces,
        pieceLength
      };
    } catch {
      return null;
    }
  }

  public getActiveEnginesCount(): number {
    return this.enginesMap.size;
  }

  public touchActivity(hash: string): void {
    const meta = this.runtimeMetaMap.get(hash.toLowerCase());
    if (meta) {
      meta.lastActivityTimestamp = Date.now();
    }
  }

  /**
   * Despeja (evict) da memória o motor inativo menos recentemente utilizado (LRU).
   * Retorna true se um motor inativo foi liberado, permitindo o reuso do slot no pool.
   */
  public evictOldestInactiveEngine(): boolean {
    let oldestHash: string | null = null;
    let oldestActivity = Infinity;

    for (const [hash] of this.enginesMap.entries()) {
      const activeCount = this.activeStreamsCount.get(hash) || 0;
      if (activeCount <= 0) {
        const meta = this.runtimeMetaMap.get(hash);
        const lastActivity = meta ? meta.lastActivityTimestamp : 0;
        if (lastActivity < oldestActivity) {
          oldestActivity = lastActivity;
          oldestHash = hash;
        }
      }
    }

    if (!oldestHash) {
      return false;
    }

    console.log(`[TorrentEngine Pool] Despejando motor inativo mais antigo (LRU): ${oldestHash}`);
    this.destroyEngine(oldestHash);
    return true;
  }

  /**
   * Destrói completamente uma instância do motor torrent, limpando streams, descritores de arquivo e memória.
   */
  public destroyEngine(hash: string, removeDiskCache: boolean = false): void {
    const cleanHash = hash.toLowerCase();
    if (this.cleanupTimers.has(cleanHash)) {
      clearTimeout(this.cleanupTimers.get(cleanHash)!);
      this.cleanupTimers.delete(cleanHash);
    }
    this.stopWireOptimizer(cleanHash);

    // 1. Destrói todos os streams de leitura ativos do motor imediatamente
    const activeStreams = this.activeReadStreamsMap.get(cleanHash);
    if (activeStreams) {
      for (const rs of activeStreams) {
        try {
          rs.destroy();
        } catch {}
      }
      this.activeReadStreamsMap.delete(cleanHash);
    }

    // 2. Aborta transcodes ativos do FFmpeg vinculados a este hash
    for (const [clientKey, abortFn] of Array.from(this.activeClientTranscodeMap.entries())) {
      if (clientKey.endsWith(`:${cleanHash}`)) {
        try {
          abortFn();
        } catch {}
        this.activeClientTranscodeMap.delete(clientKey);
      }
    }

    // 3. Aborta streams de IP do cliente vinculados a este hash
    for (const [ip, item] of Array.from(this.activeClientStreamByIp.entries())) {
      if (item.hash.includes(cleanHash)) {
        try {
          item.abort();
        } catch {}
        this.activeClientStreamByIp.delete(ip);
      }
    }

    // 4. Fecha descritores de arquivo (random-access-file) e destrói o motor torrent-stream
    const engine = this.enginesMap.get(cleanHash);
    if (engine) {
      try {
        const store = (engine as any).store;
        if (store && typeof store.close === 'function') {
          store.close(() => {});
        }
      } catch {}
      try {
        engine.destroy(() => {});
      } catch {}
    }

    this.enginesMap.delete(cleanHash);
    this.pendingEnginesMap.delete(cleanHash);
    this.runtimeMetaMap.delete(cleanHash);
    this.activeStreamsCount.delete(cleanHash);
    this.mediaProbeCache.delete(cleanHash);
    this.pendingProbeMap.delete(cleanHash);
    this.engineChunkCaches.delete(cleanHash);
    this.engineChunkCacheBytes.delete(cleanHash);

    if (removeDiskCache) {
      const torrentDir = path.join(CACHE_BASE_DIR, cleanHash);
      try {
        if (fs.existsSync(torrentDir)) {
          fs.rmSync(torrentDir, { recursive: true, force: true });
        }
      } catch {}
    }
  }

  /**
   * Limpa automaticamente o diretório de cache em disco:
   * 1. Remove torrents inativos com mais de 30 minutos (se não estiverem com reprodução ativa)
   * 2. Quando o uso total excede 80% do limite máximo (1.6GB), remove as pastas mais antigas até atingir 50% (1.0GB)
   */
  public pruneDiskCache(): { freedBytes: number; currentBytes: number } {
    try {
      if (!fs.existsSync(CACHE_BASE_DIR)) {
        fs.mkdirSync(CACHE_BASE_DIR, { recursive: true });
        return { freedBytes: 0, currentBytes: 0 };
      }

      const now = Date.now();
      const entries = fs.readdirSync(CACHE_BASE_DIR, { withFileTypes: true });
      const folderList: Array<{ hash: string; dirPath: string; size: number; newest: number; isLocked: boolean }> = [];

      let totalBytes = 0;

      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const dirPath = path.join(CACHE_BASE_DIR, entry.name);
        const hash = entry.name.toLowerCase();
        const activeCount = this.activeStreamsCount.get(hash) || 0;
        const isLocked = activeCount > 0;
        const info = getDirectorySize(dirPath);

        totalBytes += info.size;
        folderList.push({
          hash,
          dirPath,
          size: info.size,
          newest: info.newest,
          isLocked
        });
      }

      let freedBytes = 0;

      // 1. Despeja pastas inativas há mais de 30 minutos (não travadas por streams ativos)
      for (const folder of folderList) {
        if (folder.isLocked) continue;
        const idleMs = now - folder.newest;
        if (idleMs > INACTIVE_EVICT_MS) {
          try {
            fs.rmSync(folder.dirPath, { recursive: true, force: true });
            freedBytes += folder.size;
            totalBytes -= folder.size;
            console.log(
              `[TorrentEngine Cache] Despejo de torrent expirado (>30min): ${folder.hash} (${Math.round(folder.size / 1048576)} MB)`
            );
          } catch {}
        }
      }

      // 2. Se ultrapassar o limite de alerta (80% de 2GB = 1.6GB), remove os mais antigos até atingir 50% (1.0GB)
      if (totalBytes > CACHE_HIGH_WATERMARK) {
        const candidates = folderList
          .filter((f) => !f.isLocked && fs.existsSync(f.dirPath))
          .sort((a, b) => a.newest - b.newest);

        for (const folder of candidates) {
          if (totalBytes <= CACHE_LOW_WATERMARK) break;
          try {
            fs.rmSync(folder.dirPath, { recursive: true, force: true });
            freedBytes += folder.size;
            totalBytes -= folder.size;
            console.log(
              `[TorrentEngine Cache] Poda por limite de disco (80% atingido): ${folder.hash} (${Math.round(folder.size / 1048576)} MB)`
            );
          } catch {}
        }
      }

      return { freedBytes, currentBytes: totalBytes };
    } catch (err) {
      console.warn('[TorrentEngine Cache] Erro ao podar cache em disco:', err);
      return { freedBytes: 0, currentBytes: 0 };
    }
  }

  private startPeriodicSweeper(): void {
    const sweep = () => {
      try {
        const now = Date.now();
        // Desaloca engines inativos há mais de 30 minutos da memória
        for (const [hash] of Array.from(this.enginesMap.entries())) {
          const active = this.activeStreamsCount.get(hash) || 0;
          if (active <= 0) {
            const meta = this.runtimeMetaMap.get(hash);
            const lastActivity = meta ? meta.lastActivityTimestamp : 0;
            if (now - lastActivity > INACTIVE_EVICT_MS) {
              console.log(`[TorrentEngine Pool] Desalocando engine inativo (>30min): ${hash}`);
              this.destroyEngine(hash);
            }
          }
        }
        // Poda o cache de disco
        this.pruneDiskCache();
      } catch (err) {
        console.warn('[TorrentEngine] Erro no ciclo de limpeza periódica:', err);
      }
    };

    setInterval(sweep, 5 * 60 * 1000).unref();
  }

  scheduleCleanup(hash: string, delayMs: number = 60000) {
    const current = (this.activeStreamsCount.get(hash) || 1) - 1;
    this.activeStreamsCount.set(hash, Math.max(0, current));
    this.touchActivity(hash);

    if (this.cleanupTimers.has(hash)) {
      clearTimeout(this.cleanupTimers.get(hash)!);
    }

    const timer = setTimeout(() => {
      const active = this.activeStreamsCount.get(hash) || 0;
      if (active <= 0) {
        // Se o pool de motores estiver acima do limite ou inativo, destrói
        if (this.enginesMap.size > MAX_ACTIVE_ENGINES) {
          console.log(`[TorrentEngine Pool] Liberando engine acima do limite de pool: ${hash}`);
          this.destroyEngine(hash);
        }
      }
    }, delayMs);

    this.cleanupTimers.set(hash, timer);
  }
}

export const torrentEngine = new TorrentEngine();
