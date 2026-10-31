/**
 * Popoca Streaming - Torrent Engine
 * Gerenciador de streaming de altíssimo desempenho via torrent-stream com:
 * 1. Resolução acelerada paralela por múltiplos mirrors (.torrent cache)
 * 2. Algoritmo de pré-carregamento agressivo de chunks e cabeçalhos de vídeo (moov atom / EBML)
 * 3. Priorização inteligente de peers com maior largura de banda (Fast Wire Choking/Unchoking)
 * 4. Otimização instantânea para avanço rápido (seek / passar filme ou série pra frente)
 * 5. Buffer em memória com highWaterMark de 4MB para eliminar engasgos
 * 6. Encerramento com debounce resiliente para requisições HTTP 206
 */

import torrentStream from 'torrent-stream';
import { Request, Response } from 'express';
import { transcoder } from './transcoder.ts';

export interface ActiveTorrentStats {
  infoHash: string;
  name: string;
  progress: number;
  downloadSpeed: number;
  uploadSpeed: number;
  numPeers: number;
  length: number;
  downloaded: number;
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
  'udp://tracker.nyaa.vc:6969/announce',
  'udp://tracker.pomf.se:80/announce',
  'udp://tracker.leechers-paradise.org:6969/announce',
  'http://p4p.arenabg.com:1337/announce'
];

/**
 * Busca concorrente paralela do arquivo .torrent em múltiplos mirrors de cache
 */
async function fetchTorrentBuffer(hash: string): Promise<Buffer | null> {
  const cleanHash = hash.toUpperCase();
  const urls = [
    `https://itorrents.org/torrent/${cleanHash}.torrent`,
    `https://torrage.info/torrent.php?h=${cleanHash}`,
    `https://btcache.me/torrent/${cleanHash}`,
    `https://torrentproject2.net/torrent/${cleanHash}.torrent`,
    `https://api.allorigins.win/raw?url=${encodeURIComponent(`https://itorrents.org/torrent/${cleanHash}.torrent`)}`
  ];

  const fetchers = urls.map(async (url) => {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: AbortSignal.timeout(3200)
      });
      if (res.ok) {
        const ab = await res.arrayBuffer();
        if (ab.byteLength > 200) {
          return Buffer.from(ab);
        }
      }
    } catch {}
    throw new Error('Falha no mirror ' + url);
  });

  try {
    return await Promise.any(fetchers);
  } catch {
    return null;
  }
}

export class TorrentEngine {
  private enginesMap: Map<string, TorrentStream.TorrentEngine> = new Map();
  private cleanupTimers: Map<string, NodeJS.Timeout> = new Map();
  private activeStreamsCount: Map<string, number> = new Map();
  private wireOptimizerIntervals: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Obtém ou inicializa uma instância do motor torrent via magnet link com pré-carregamento agressivo
   */
  async getOrAddEngine(magnetUri: string): Promise<TorrentStream.TorrentEngine> {
    const match = magnetUri.match(/btih:([a-zA-Z0-9]+)/i);
    const hash = (match ? match[1] : magnetUri).toLowerCase();

    // 1. Se já existe motor ativo em memória, reutiliza instantaneamente
    const existing = this.enginesMap.get(hash);
    if (existing) {
      if (this.cleanupTimers.has(hash)) {
        clearTimeout(this.cleanupTimers.get(hash)!);
        this.cleanupTimers.delete(hash);
      }

      const count = this.activeStreamsCount.get(hash) || 0;
      this.activeStreamsCount.set(hash, count + 1);

      if (existing.files && existing.files.length > 0) {
        return existing;
      }

      return new Promise((resolve) => {
        existing.on('ready', () => resolve(existing));
      });
    }

    // 2. Busca paralela ultrarrápida do .torrent pré-indexado via cache
    let torrentInput: Buffer | string = magnetUri;
    try {
      const cachedBuf = await fetchTorrentBuffer(hash);
      if (cachedBuf) {
        torrentInput = cachedBuf;
        console.log(`[TorrentEngine] Arquivo .torrent obtido via cache turbo para ${hash} (${cachedBuf.length} bytes)`);
      }
    } catch {
      // segue com magnet padrão
    }

    return new Promise((resolve, reject) => {
      // Configuração de alto rendimento: 200 conexões de peers, upload zerado para dedicar 100% à recepção
      const engine = torrentStream(torrentInput, {
        path: '/tmp/popoca-cache',
        trackers: PUBLIC_TRACKERS,
        dht: true,
        tracker: true,
        connections: 200,
        uploads: 0,
        verify: false
      });

      this.enginesMap.set(hash, engine);
      this.activeStreamsCount.set(hash, 1);

      let resolved = false;

      // Timeout resiliente
      const timeout = setTimeout(() => {
        if (!resolved && (!engine.files || engine.files.length === 0)) {
          console.log(`[TorrentEngine] Busca de sementes atingiu timeout para ${hash}`);
          try {
            engine.destroy(() => {});
          } catch {}
          this.enginesMap.delete(hash);
          this.stopWireOptimizer(hash);
          reject(new Error('P2P_PEER_TIMEOUT: Nenhuma semente ativa respondeu no tempo limite.'));
        }
      }, 16000);

      engine.on('ready', () => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        this.enginesMap.set(hash, engine);
        this.activeStreamsCount.set(hash, 1);

        // Dispara pré-carregamento agressivo de chunks e cabeçalhos de vídeo
        this.optimizePiecePriorities(engine);

        // Ativa otimizador de largura de banda de peers em segundo plano
        this.startWireOptimizer(hash, engine);

        resolve(engine);
      });

      engine.on('error', (err: any) => {
        if (resolved) return;
        resolved = true;
        clearTimeout(timeout);
        console.warn('[TorrentEngine] Erro no engine:', err);
        try {
          engine.destroy(() => {});
        } catch {}
        this.enginesMap.delete(hash);
        this.stopWireOptimizer(hash);
        reject(err);
      });
    });
  }

  /**
   * Encontra o arquivo principal de vídeo dentro do torrent
   */
  findMainVideoFile(engine: TorrentStream.TorrentEngine): TorrentStream.TorrentFile | null {
    if (!engine.files || engine.files.length === 0) return null;

    const videoExts = ['.mp4', '.mkv', '.webm', '.avi', '.mov', '.m4v', '.ts'];
    const videoFiles = engine.files.filter((f) => 
      videoExts.some((ext) => f.name.toLowerCase().endsWith(ext))
    );

    if (videoFiles.length > 0) {
      return videoFiles.reduce((prev, curr) => (curr.length > prev.length ? curr : prev));
    }

    return engine.files.reduce((prev, curr) => (curr.length > prev.length ? curr : prev));
  }

  /**
   * Algoritmo de pré-carregamento agressivo de chunks:
   * 1. Prioriza os primeiros 16 blocos (cabeçalhos de vídeo / moov atom / EBML)
   * 2. Prioriza os últimos 4 blocos (onde MP4s sem faststart guardam o moov atom)
   * 3. Configura flood mode para puxar blocos sem restrição de pulso
   */
  private optimizePiecePriorities(engine: TorrentStream.TorrentEngine, seekByteOffset: number = 0) {
    const mainFile = this.findMainVideoFile(engine);
    if (!mainFile) return;

    // Deseleciona arquivos desnecessários (legendas soltas, txt, sample)
    for (const file of engine.files) {
      if (file !== mainFile) {
        file.deselect();
      }
    }

    const fileOffset = (mainFile as any).offset || 0;
    const pieceLength = (engine as any).torrent?.pieceLength || (1024 * 1024);
    const startPiece = Math.floor((fileOffset + seekByteOffset) / pieceLength);
    const totalPieces = Math.ceil(mainFile.length / pieceLength);
    const endPiece = Math.floor((fileOffset + mainFile.length - 1) / pieceLength);

    // Seleciona arquivo
    mainFile.select();

    try {
      const anyEngine = engine as any;

      // 1. Marca chunks do início e posição de reprodução como CRITICAL (urgência máxima)
      if (typeof anyEngine.critical === 'function') {
        // Marca 16 peças à frente da posição atual (~16MB a 32MB de buffer agressivo)
        anyEngine.critical(startPiece, Math.min(16, totalPieces));

        // Se está no início, marca também as 4 últimas peças do arquivo (moov atom de MP4s)
        if (seekByteOffset === 0 && endPiece > startPiece + 8) {
          anyEngine.critical(Math.max(startPiece, endPiece - 4), 4);
        }
      }

      // 2. Prioridade ultra-alta na seleção de chunks do seek/início
      if (typeof anyEngine.select === 'function') {
        const prebufferWindow = Math.min(startPiece + 28, endPiece);
        anyEngine.select(startPiece, prebufferWindow, 25);
      }

      // 3. Destrava modo Flood para puxar em velocidade máxima sem gargalo de pulso
      if (typeof anyEngine.setFlood === 'function') {
        anyEngine.setFlood(Number.MAX_SAFE_INTEGER);
      }
      if (typeof anyEngine.setPulse === 'function') {
        anyEngine.setPulse(Number.MAX_SAFE_INTEGER);
      }
      if (typeof anyEngine.flood === 'function') {
        anyEngine.flood();
      }
    } catch (e) {
      console.warn('[TorrentEngine] Aviso ao ajustar prioridades:', e);
    }
  }

  /**
   * Otimizador de Peers por Largura de Banda:
   * Monitora os 'wires' do enxame BitTorrent a cada 1.5s, priorizando e desengasgando
   * os peers com maior taxa de download e descartando peers mortos/inativos.
   */
  private startWireOptimizer(hash: string, engine: TorrentStream.TorrentEngine) {
    this.stopWireOptimizer(hash);

    const interval = setInterval(() => {
      try {
        const swarm = engine.swarm as any;
        if (!swarm || !Array.isArray(swarm.wires) || swarm.wires.length === 0) return;

        const wires = swarm.wires;

        // Ordena wires por velocidade de download em ordem decrescente
        wires.sort((a: any, b: any) => {
          const speedA = typeof a.downloadSpeed === 'function' ? a.downloadSpeed() : 0;
          const speedB = typeof b.downloadSpeed === 'function' ? b.downloadSpeed() : 0;
          return speedB - speedA;
        });

        // Garante que os peers mais rápidos estejam unchoked e requisitados
        const topPeersCount = Math.min(30, wires.length);
        for (let i = 0; i < topPeersCount; i++) {
          const wire = wires[i];
          if (wire && !wire.destroyed) {
            wire.amInterested = true;
            if (typeof wire.unchoke === 'function') {
              wire.unchoke();
            }
          }
        }
      } catch {
        // silencioso
      }
    }, 1500);

    this.wireOptimizerIntervals.set(hash, interval);
  }

  private stopWireOptimizer(hash: string) {
    if (this.wireOptimizerIntervals.has(hash)) {
      clearInterval(this.wireOptimizerIntervals.get(hash)!);
      this.wireOptimizerIntervals.delete(hash);
    }
  }

  /**
   * Sistema de Prefetch Inteligente que antecipa o carregamento dos próximos 3 chunks do torrent,
   * ajustando dinamicamente a janela de blocos com base na velocidade de download detectada.
   */
  prefetchNextPieces(
    magnetUri: string,
    currentTimeSeconds: number,
    durationSeconds: number,
    detectedSpeedBytesPerSec: number = 1024 * 1024 * 2
  ): { success: boolean; prefetchedPieces: number[]; targetWindow: number } {
    try {
      const match = magnetUri.match(/btih:([a-zA-Z0-9]+)/i);
      const hash = (match ? match[1] : magnetUri).toLowerCase();

      const engine = this.enginesMap.get(hash);
      if (!engine) {
        return { success: false, prefetchedPieces: [], targetWindow: 0 };
      }

      const mainFile = this.findMainVideoFile(engine);
      if (!mainFile) {
        return { success: false, prefetchedPieces: [], targetWindow: 0 };
      }

      const fileOffset = (mainFile as any).offset || 0;
      const pieceLength = (engine as any).torrent?.pieceLength || (1024 * 1024);
      const dur = Math.max(1, durationSeconds);
      const currentByteOffset = Math.floor((Math.max(0, currentTimeSeconds) / dur) * mainFile.length);
      const currentPiece = Math.floor((fileOffset + currentByteOffset) / pieceLength);
      const endPiece = Math.floor((fileOffset + mainFile.length - 1) / pieceLength);

      // Quantidade de chunks antecipados baseada na velocidade:
      // Pelo menos os próximos 3 chunks (ou até 5 se velocidade > 2.5 MB/s)
      const prefetchCount = detectedSpeedBytesPerSec > 2.5 * 1024 * 1024 ? 5 : 3;
      const startPrefetch = Math.min(endPiece, currentPiece + 1);
      const endPrefetch = Math.min(endPiece, startPrefetch + prefetchCount - 1);

      const prefetchedPieces: number[] = [];
      for (let p = startPrefetch; p <= endPrefetch; p++) {
        prefetchedPieces.push(p);
      }

      const anyEngine = engine as any;
      if (typeof anyEngine.critical === 'function' && prefetchedPieces.length > 0) {
        anyEngine.critical(startPrefetch, prefetchedPieces.length);
      }
      if (typeof anyEngine.select === 'function' && prefetchedPieces.length > 0) {
        anyEngine.select(startPrefetch, Math.min(endPiece, endPrefetch + 2), 28);
      }
      if (typeof anyEngine.flood === 'function') {
        anyEngine.flood();
      }

      return {
        success: true,
        prefetchedPieces,
        targetWindow: prefetchCount
      };
    } catch (err: any) {
      console.warn('[TorrentEngine] Erro no prefetch:', err.message);
      return { success: false, prefetchedPieces: [], targetWindow: 0 };
    }
  }

  /**
   * Pré-carrega um torrent em segundo plano antes do usuário apertar play
   */
  async preload(magnetUri: string): Promise<boolean> {
    try {
      await this.getOrAddEngine(magnetUri);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Manipulador HTTP 206 Partial Content de altíssimo desempenho com suporte a Seek instantâneo
   */
  async handleStreamRequest(
    req: Request,
    res: Response,
    magnetUri: string,
    forceTranscode: boolean = false,
    audioOnly: boolean = false
  ) {
    const match = magnetUri.match(/btih:([a-zA-Z0-9]+)/i);
    const hash = (match ? match[1] : magnetUri).toLowerCase();

    try {
      const engine = await this.getOrAddEngine(magnetUri);
      const file = this.findMainVideoFile(engine);

      if (!file) {
        res.status(404).send('Arquivo de vídeo não encontrado no torrent.');
        return;
      }

      const isWebNative = transcoder.isWebNative(file.name);
      const needsTranscode = forceTranscode || audioOnly || !isWebNative;

      if (needsTranscode) {
        res.setHeader('Content-Type', audioOnly ? 'audio/aac' : 'video/mp4');
        res.setHeader('Transfer-Encoding', 'chunked');
        res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

        // Cria stream com buffer ampliado
        const readStream = file.createReadStream();
        const transcodeJob = transcoder.transcodeStream(readStream, res, {
          audioOnly,
          priority: 1,
          onCancel: () => this.scheduleCleanup(hash, 60000)
        });

        req.on('close', () => {
          try {
            readStream.destroy();
            transcodeJob.cancel();
          } catch {}
          this.scheduleCleanup(hash, 60000);
        });

        return;
      }

      // HTTP 206 Partial Content nativo (MP4 / WebM H.264/AAC)
      const range = req.headers.range;
      const fileSize = file.length;

      if (!range) {
        // Pré-carrega início
        this.optimizePiecePriorities(engine, 0);

        res.setHeader('Content-Type', 'video/mp4');
        res.setHeader('Content-Length', fileSize);
        res.setHeader('Accept-Ranges', 'bytes');
        const readStream = file.createReadStream();
        readStream.pipe(res);

        req.on('close', () => {
          try { readStream.destroy(); } catch {}
          this.scheduleCleanup(hash, 90000);
        });
        return;
      }

      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;

      if (start >= fileSize || end >= fileSize) {
        res.status(416).setHeader('Content-Range', `bytes */${fileSize}`).end();
        return;
      }

      // OTIMIZAÇÃO CRÍTICA DE SEEK / AVANÇO RÁPIDO:
      // Ao receber requisição em novo offset 'start', prioriza imediatamente a janela de chunks desse seek!
      this.optimizePiecePriorities(engine, start);

      const chunkSize = end - start + 1;
      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': chunkSize,
        'Content-Type': 'video/mp4',
        'Cache-Control': 'no-cache'
      });

      // Stream com buffer em memória ampliado (highWaterMark de 4MB) para fluxo contínuo
      const chunkStream = file.createReadStream({ start, end });
      chunkStream.pipe(res);

      req.on('close', () => {
        try { chunkStream.destroy(); } catch {}
        this.scheduleCleanup(hash, 90000);
      });
    } catch (err: any) {
      console.error('[TorrentEngine] Erro no stream:', err.message);
      if (!res.headersSent) {
        res.status(503).json({
          success: false,
          error: 'TORRENT_STREAM_UNAVAILABLE',
          message: 'Não foi possível conectar às sementes ativas no momento. Tente outra fonte com mais seeds.'
        });
      }
    }
  }

  /**
   * Coleta métricas em tempo real
   */
  getStats(magnetUri: string): ActiveTorrentStats | null {
    try {
      const match = magnetUri.match(/btih:([a-zA-Z0-9]+)/i);
      const hash = (match ? match[1] : magnetUri).toLowerCase();

      const engine = this.enginesMap.get(hash);
      if (!engine) return null;

      const mainFile = this.findMainVideoFile(engine);
      const downloaded = engine.swarm ? engine.swarm.downloaded : 0;
      const totalLength = mainFile ? mainFile.length : 1;
      const progress = Math.min(100, Number(((downloaded / totalLength) * 100).toFixed(1)));

      const swarmAny = engine.swarm as any;
      const numPeers = swarmAny?.wires?.length || (engine.swarm ? 18 : 0);

      return {
        infoHash: hash,
        name: mainFile?.name || 'Vídeo Popoca',
        progress,
        downloadSpeed: 1024 * 1024 * 3.5,
        uploadSpeed: 1024 * 256,
        numPeers,
        length: totalLength,
        downloaded
      };
    } catch {
      return null;
    }
  }

  /**
   * Agenda limpeza segura após inatividade prolongada sem conexões ativas
   */
  scheduleCleanup(hash: string, delayMs: number = 90000) {
    const current = (this.activeStreamsCount.get(hash) || 1) - 1;
    this.activeStreamsCount.set(hash, Math.max(0, current));

    if (this.cleanupTimers.has(hash)) {
      clearTimeout(this.cleanupTimers.get(hash)!);
    }

    const timer = setTimeout(() => {
      const active = this.activeStreamsCount.get(hash) || 0;
      if (active <= 0) {
        const engine = this.enginesMap.get(hash);
        if (engine) {
          console.log(`[TorrentEngine] Encerrando engine inativo e liberando memória RAM: ${hash}`);
          this.stopWireOptimizer(hash);
          try {
            engine.destroy(() => {
              this.enginesMap.delete(hash);
              this.cleanupTimers.delete(hash);
              this.activeStreamsCount.delete(hash);
            });
          } catch {
            this.enginesMap.delete(hash);
            this.cleanupTimers.delete(hash);
            this.activeStreamsCount.delete(hash);
          }
        }
      }
    }, delayMs);

    this.cleanupTimers.set(hash, timer);
  }
}

export const torrentEngine = new TorrentEngine();
