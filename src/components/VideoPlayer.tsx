/**
 * Popoca Streaming - Advanced Custom Video Player
 * - Camada de Cache Temporário via IndexedDB (chunks de 2MB na sessão atual) para avanço/retrocesso instantâneo
 * - Preservação absoluta do tempo de reprodução (nunca reinicia do 00:00 ao pausar/despausar, buscar ou reconectar em MKV/MP4)
 * - Seletor de 3 Qualidades Fixas (720p Leve · 1080p Padrão · 4K Ultra) sem oscilação automática de seeds
 * - Separação estrita de idioma com prioridade Português (Dublado PT-BR / Dual Áudio vs Original)
 * - Renderizador WebVTT customizado ancorado na base da tela (desativado por padrão)
 */

import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  Play,
  Pause,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  PictureInPicture,
  Headphones,
  Subtitles,
  X,
  Users,
  SkipForward,
  Layers,
  Zap,
  Check,
  RefreshCw,
  Wifi,
  ShieldCheck,
  Activity,
  ChevronDown,
  Maximize2,
  Loader2,
  SlidersHorizontal,
  Cast,
  Tv,
  Copy,
  Smartphone,
  ExternalLink
} from 'lucide-react';
import {
  MediaItem,
  TorrentSource,
  Episode,
  TrackerPriorityMode,
  TorrentLiveStats,
  StreamCacheSnapshot
} from '../types/index.ts';
import { api, SubtitleTrackInfo, FixedVideoQuality } from '../services/api.ts';
import { storageService } from '../services/storage.ts';
import { videoChunkCache } from '../services/videoChunkCache.ts';

type SubtitleSize = 'sm' | 'md' | 'lg';
const SUBTITLE_SIZE_KEY = 'popoca_subtitle_size';

interface ParsedVttCue {
  start: number;
  end: number;
  text: string;
}

function parseVttTimestamp(raw: string): number {
  const clean = raw.trim().replace(',', '.');
  const parts = clean.split(':');
  if (parts.length === 3) {
    return (
      parseInt(parts[0], 10) * 3600 +
      parseInt(parts[1], 10) * 60 +
      parseFloat(parts[2])
    );
  }
  if (parts.length === 2) {
    return parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
  }
  return 0;
}

function parseWebVttCues(vttText: string): ParsedVttCue[] {
  if (!vttText) return [];
  const normalized = vttText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const blocks = normalized.split(/\n{2,}/);
  const cues: ParsedVttCue[] = [];

  for (const block of blocks) {
    const lines = block
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (lines.length === 0) continue;
    if (lines[0].startsWith('WEBVTT') || lines[0].startsWith('NOTE') || lines[0].startsWith('STYLE')) {
      continue;
    }

    const timeLineIdx = lines.findIndex((l) => l.includes('-->'));
    if (timeLineIdx < 0) continue;

    const timeParts = lines[timeLineIdx].split('-->');
    if (timeParts.length < 2) continue;

    const start = parseVttTimestamp(timeParts[0]);
    const endToken = timeParts[1].trim().split(/\s+/)[0] || '';
    const end = parseVttTimestamp(endToken);
    if (!(end > start)) continue;

    const rawBody = lines.slice(timeLineIdx + 1).join('\n');
    const cleanedText = rawBody
      .replace(/\{\\[^}]*\}/g, '')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&amp;/gi, '&')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .trim();

    if (cleanedText) {
      cues.push({ start, end, text: cleanedText });
    }
  }

  return cues;
}

interface VideoPlayerProps {
  media: MediaItem;
  torrent: TorrentSource;
  availableTorrents?: TorrentSource[];
  episode?: Episode;
  initialTime?: number;
  forceTranscode?: boolean;
  initialOpenCastModal?: boolean;
  isMini?: boolean;
  onClose: () => void;
  onMinimize?: () => void;
  onExpand?: () => void;
  onNextEpisode?: () => void;
}

const FIXED_QUALITY_OPTIONS: Array<{
  id: FixedVideoQuality;
  label: string;
  badge: string;
  desc: string;
}> = [
    {
      id: '720p',
      label: '720p HD',
      badge: 'Leve',
      desc: 'Ideal para conexões mais lentas, carrega rápido e economiza dados'
    },
    {
      id: '1080p',
      label: '1080p Full HD',
      badge: 'Padrão',
      desc: 'Qualidade padrão equilibrada entre nitidez alta e estabilidade'
    },
    {
      id: '4K',
      label: '4K Ultra HD',
      badge: 'Ultra',
      desc: 'Máxima definição otimizada para conexões de alta velocidade'
    }
  ];

const TRACKER_PRIORITY_OPTIONS: Array<{
  id: TrackerPriorityMode;
  label: string;
  desc: string;
}> = [
    {
      id: 'pt-br-stability',
      label: 'PT-BR & Estabilidade',
      desc: 'Favorece trackers com melhor disponibilidade em português e conexão firme'
    },
    {
      id: 'ultra-speed',
      label: 'Ultra Velocidade',
      desc: 'Prioriza trackers UDP/HTTP de rajada máxima (até 250 conexões)'
    },
    {
      id: 'global-balanced',
      label: 'Global Balanceado',
      desc: 'Combina trackers nacionais, globais e especializados em séries/animes'
    }
  ];

function formatTransferSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 KB/s';
  const mb = bytesPerSec / (1024 * 1024);
  if (mb >= 1) return `${mb.toFixed(2)} MB/s`;
  const kb = Math.max(1, Math.round(bytesPerSec / 1024));
  return `${kb} KB/s`;
}

function formatCachedBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(1)} MB`;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  media,
  torrent,
  availableTorrents = [],
  episode,
  initialTime = 0,
  forceTranscode = false,
  initialOpenCastModal = false,
  isMini = false,
  onClose,
  onMinimize,
  onExpand,
  onNextEpisode
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastPrefetchCallRef = useRef<number>(0);
  const stage1PeerRetryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const seekDebounceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastAutoSwitchAtRef = useRef<number>(0);

  // Refs críticas de preservação do tempo exato (impede voltar ao 00:00!)
  const initialStartOffset = initialTime >= 15 ? initialTime : 0;
  const streamStartOffsetRef = useRef<number>(initialStartOffset);
  const lastKnownTimeRef = useRef<number>(initialStartOffset);
  const pendingResumeTimeRef = useRef<number>(0);
  const isTranscodedRef = useRef<boolean>(forceTranscode || initialStartOffset > 0);
  const userPausedRef = useRef<boolean>(false);

  // Qualidade travada na escolha do usuário entre as 3 opções (720p, 1080p padrão, 4K)
  const [preferredQuality, setPreferredQuality] = useState<FixedVideoQuality>(
    torrent.quality || api.getPreferredQuality()
  );
  const [torrentsPool, setTorrentsPool] = useState<TorrentSource[]>(
    availableTorrents.length > 0 ? availableTorrents : [torrent]
  );
  const [currentTorrent, setCurrentTorrent] = useState<TorrentSource>(torrent);
  const [audioTrackOverride, setAudioTrackOverride] = useState<number | undefined>(undefined);
  const [failedTorrentIds, setFailedTorrentIds] = useState<Set<string>>(new Set());
  const [failoverToast, setFailoverToast] = useState<string | null>(null);

  // Controles de Rede P2P & Prioridade de Tracker
  const [trackerPriority, setTrackerPriority] = useState<TrackerPriorityMode>(() =>
    api.getSavedTrackerPriority()
  );
  const [liveStats, setLiveStats] = useState<TorrentLiveStats | null>(null);
  const [isRetryingNetwork, setIsRetryingNetwork] = useState<boolean>(false);

  // Duração autoritativa de referência
  const authoritativeDuration = useMemo(() => {
    if (episode?.durationMinutes && episode.durationMinutes > 0) {
      return episode.durationMinutes * 60;
    }
    if (media.runtime && media.runtime > 0) {
      return media.runtime * 60;
    }
    if (media.media_type === 'tv' || media.media_type === 'anime') {
      return 24 * 60;
    }
    return 115 * 60;
  }, [media, episode]);

  // Chave do stream atual no cache temporário IndexedDB da sessão
  const streamKey = useMemo(
    () =>
      videoChunkCache.buildStreamKey(
        currentTorrent.magnetUri || currentTorrent.directUrl || '',
        media.id,
        episode?.seasonNumber,
        episode?.episodeNumber
      ),
    [currentTorrent.magnetUri, currentTorrent.directUrl, media.id, episode?.seasonNumber, episode?.episodeNumber]
  );

  // Estados de Reprodução
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(initialTime > 0 ? initialTime : 0);
  const [duration, setDuration] = useState<number>(authoritativeDuration);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isBuffering, setIsBuffering] = useState(true);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [retryAttempts, setRetryAttempts] = useState(0);

  // Snapshot em tempo real da API do Cache IndexedDB (segmentos verdes pré-carregados vs cinza pendentes)
  const [idbSnapshot, setIdbSnapshot] = useState<StreamCacheSnapshot>({
    streamKey,
    segments: [],
    cachedBytes: 0,
    cachedChunksCount: 0,
    totalBytes: currentTorrent.sizeBytes || 0,
    cachedPercent: 0
  });

  // Modo Apenas Áudio
  const [isAudioOnly, setIsAudioOnly] = useState(false);

  // Legendas reais (OpenSubtitles) — desativadas por padrão e ancoradas na base da tela!
  const [subtitleTracks, setSubtitleTracks] = useState<SubtitleTrackInfo[]>([]);
  const [subtitlesLoading, setSubtitlesLoading] = useState(false);
  const [selectedSubtitleId, setSelectedSubtitleId] = useState<string>('off');
  const [parsedSubtitleCues, setParsedSubtitleCues] = useState<ParsedVttCue[]>([]);
  const [subtitleSize, setSubtitleSize] = useState<SubtitleSize>(() => {
    try {
      const saved = localStorage.getItem(SUBTITLE_SIZE_KEY);
      if (saved === 'sm' || saved === 'md' || saved === 'lg') return saved;
    } catch { }
    return 'sm';
  });
  const loadedSubtitleKeyRef = useRef<string>('');

  // Menus flutuantes e Modal de Transmissão p/ TV (Web Video Caster / Chromecast / Smart TV)
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showSubMenu, setShowSubMenu] = useState(false);
  const [showQualityMenu, setShowQualityMenu] = useState(false);
  const [showAudioMenu, setShowAudioMenu] = useState(false);
  const [showSourcesMenu, setShowSourcesMenu] = useState(false);
  const [showNetworkPanel, setShowNetworkPanel] = useState(false);
  const [showCastModal, setShowCastModal] = useState(Boolean(initialOpenCastModal));
  const [lanInfo, setLanInfo] = useState<{ lanIp: string; port: number; lanOrigin: string } | null>(null);
  const [copiedCastField, setCopiedCastField] = useState<'tv' | 'stream' | null>(null);

  const closeAllMenus = useCallback(() => {
    setShowSpeedMenu(false);
    setShowSubMenu(false);
    setShowQualityMenu(false);
    setShowAudioMenu(false);
    setShowSourcesMenu(false);
    setShowNetworkPanel(false);
  }, []);

  /**
   * Constrói URL de streaming garantindo que altMagnets sejam ESTRITAMENTE
   * da MESMA qualidade E do MESMO idioma (nunca mistura Inglês com Português!)
   */
  const getStreamUrlForTorrent = useCallback(
    (
      targetTorrent: TorrentSource,
      priorityMode: TrackerPriorityMode,
      opts: {
        isRetry?: boolean;
        seekSeconds?: number;
        audioTrackIndex?: number;
      } = {}
    ): string => {
      const targetStreamKey = videoChunkCache.buildStreamKey(
        targetTorrent.magnetUri || targetTorrent.directUrl || '',
        media.id,
        episode?.seasonNumber,
        episode?.episodeNumber
      );

      // ESTRITAMENTE mesmo idioma + mesma qualidade (impede Sonic 3 PT-BR cair em YTS Inglês!)
      const sameQualityAndLangAlts = (torrentsPool || [])
        .filter(
          (t) =>
            t.id !== targetTorrent.id &&
            t.quality === targetTorrent.quality &&
            t.isPortugueseAudio === targetTorrent.isPortugueseAudio &&
            t.magnetUri?.startsWith('magnet:?')
        )
        .sort((a, b) => (b.stabilityScore || b.seeds) - (a.stabilityScore || a.seeds))
        .map((t) => t.magnetUri);

      if (targetTorrent.magnetUri && targetTorrent.magnetUri.startsWith('magnet:?')) {
        return (
          api.getStreamUrl(targetTorrent.magnetUri, {
            transcode: forceTranscode,
            audioOnly: false,
            altMagnets: sameQualityAndLangAlts.slice(0, 4),
            trackerPriority: priorityMode,
            streamKey: targetStreamKey,
            seekSeconds: opts.seekSeconds,
            preferPortugueseAudio: targetTorrent.isPortugueseAudio,
            audioTrackIndex: opts.audioTrackIndex
          }) + (opts.isRetry ? `&_retry=${Date.now()}` : '')
        );
      }

      if (media.id) {
        return (
          api.getStreamByTmdbIdUrl(media.id, {
            mediaType: media.media_type,
            season: episode?.seasonNumber,
            episode: episode?.episodeNumber,
            quality: targetTorrent.quality,
            trackerPriority: priorityMode,
            streamKey: targetStreamKey,
            transcode: forceTranscode,
            audioOnly: false,
            seekSeconds: opts.seekSeconds,
            preferPortugueseAudio: targetTorrent.isPortugueseAudio,
            audioTrackIndex: opts.audioTrackIndex
          }) + (opts.isRetry ? `&_retry=${Date.now()}` : '')
        );
      }

      if (episode?.streamUrl) return api.getVideoStreamProxyUrl(episode.streamUrl);
      if (targetTorrent.directUrl) return api.getVideoStreamProxyUrl(targetTorrent.directUrl);
      if (media.stream_url) return api.getVideoStreamProxyUrl(media.stream_url);
      return '/api/stream';
    },
    [torrentsPool, forceTranscode, media, episode]
  );

  const [activeVideoSrc, setActiveVideoSrc] = useState<string>(() =>
    getStreamUrlForTorrent(currentTorrent, trackerPriority, {
      seekSeconds: initialStartOffset > 0 ? initialStartOffset : undefined
    })
  );

  const displayTitle = episode
    ? `${media.title} · S${episode.seasonNumber}E${episode.episodeNumber}: ${episode.title}`
    : media.title;

  /**
   * Reconecta ou reposiciona o stream EXATAMENTE no tempo `targetTimeSec` sem jamais zerar o filme!
   */
  const reconnectStreamAtTime = useCallback(
    (
      targetTimeSec: number,
      autoPlayAfter = true,
      overrideTorrent?: TorrentSource,
      overrideAudioTrack: number | undefined = audioTrackOverride
    ) => {
      const targetTor = overrideTorrent || currentTorrent;
      const curDur = duration > 0 ? duration : authoritativeDuration;
      const safeTime = Math.max(0, Math.min(curDur > 10 ? curDur - 2 : targetTimeSec, targetTimeSec));

      lastKnownTimeRef.current = safeTime;
      setCurrentTime(safeTime);

      const v = videoRef.current;
      const isProvenNativeSeekable = Boolean(
        v && Number.isFinite(v.duration) && v.duration > 30 && !isTranscodedRef.current
      );
      const torChanged = Boolean(overrideTorrent && overrideTorrent.id !== currentTorrent.id);
      const shouldPassServerSeek =
        safeTime > 1.5 &&
        (!isProvenNativeSeekable || torChanged || typeof overrideAudioTrack === 'number');

      if (shouldPassServerSeek && targetTor.magnetUri) {
        api.prefetchNextChunks(targetTor.magnetUri, safeTime, curDur).catch(() => { });
      }

      if (shouldPassServerSeek) {
        streamStartOffsetRef.current = safeTime;
        pendingResumeTimeRef.current = 0;
      } else {
        streamStartOffsetRef.current = 0;
        pendingResumeTimeRef.current = safeTime > 1 ? safeTime : 0;
      }

      const nextUrl = getStreamUrlForTorrent(targetTor, trackerPriority, {
        isRetry: true,
        seekSeconds: shouldPassServerSeek ? safeTime : undefined,
        audioTrackIndex: overrideAudioTrack
      });

      if (autoPlayAfter) {
        userPausedRef.current = false;
      }
      setActiveVideoSrc(nextUrl);
      setIsBuffering(true);
      setPlaybackError(null);
    },
    [
      audioTrackOverride,
      currentTorrent,
      duration,
      authoritativeDuration,
      getStreamUrlForTorrent,
      trackerPriority
    ]
  );

  // Carrega a lista de legendas reais ao abrir o menu
  useEffect(() => {
    if (!showSubMenu) return;
    const fileName = liveStats?.name || '';
    const key = `${media.imdb_id || ''}|${episode?.seasonNumber || 0}|${episode?.episodeNumber || 0}|${fileName}`;
    if (loadedSubtitleKeyRef.current === key) return;
    loadedSubtitleKeyRef.current = key;

    let active = true;
    setSubtitlesLoading(true);
    api
      .getSubtitleTracks({
        imdbId: media.imdb_id,
        mediaType: media.media_type,
        season: episode?.seasonNumber,
        episode: episode?.episodeNumber,
        fileName: fileName || undefined
      })
      .then((tracks) => {
        if (active) setSubtitleTracks(tracks);
      })
      .finally(() => {
        if (active) setSubtitlesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [showSubMenu, liveStats?.name, media.imdb_id, media.media_type, episode?.seasonNumber, episode?.episodeNumber]);

  // Baixa e processa os cues WebVTT da legenda escolhida para renderização fixa na parte inferior da tela
  useEffect(() => {
    if (selectedSubtitleId === 'off') {
      setParsedSubtitleCues([]);
      return;
    }

    let cancelled = false;
    const vttUrl = api.getSubtitleVttUrl(selectedSubtitleId);
    fetch(vttUrl)
      .then((res) => (res.ok ? res.text() : ''))
      .then((vttText) => {
        if (!cancelled) {
          setParsedSubtitleCues(parseWebVttCues(vttText));
        }
      })
      .catch(() => {
        if (!cancelled) setParsedSubtitleCues([]);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSubtitleId]);

  const activeSubtitleText = useMemo(() => {
    if (selectedSubtitleId === 'off' || parsedSubtitleCues.length === 0) return '';
    const active = parsedSubtitleCues.filter(
      (c) => currentTime >= c.start && currentTime <= c.end
    );
    if (active.length === 0) return '';
    return active.map((c) => c.text).join('\n');
  }, [selectedSubtitleId, parsedSubtitleCues, currentTime]);

  const changeSubtitleSize = (size: SubtitleSize) => {
    setSubtitleSize(size);
    try {
      localStorage.setItem(SUBTITLE_SIZE_KEY, size);
    } catch { }
  };

  const handleMinimize = () => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => { });
      setIsFullscreen(false);
    }
    closeAllMenus();
    onMinimize?.();
  };

  const showToastNotification = useCallback((msg: string, durationMs = 3200) => {
    setFailoverToast(msg);
    setTimeout(() => {
      setFailoverToast((prev) => (prev === msg ? null : prev));
    }, durationMs);
  }, []);

  // Sincroniza ranges nativos do elemento <video> com o manifesto do IndexedDB (compensando streamStartOffset!)
  const refreshIdbBufferState = useCallback(async () => {
    const video = videoRef.current;
    const curDuration = duration > 0 ? duration : authoritativeDuration;
    const estTotalBytes = liveStats?.length || currentTorrent.sizeBytes || 1600000000;
    const offsetSec = isTranscodedRef.current ? streamStartOffsetRef.current : 0;

    if (video && curDuration > 0 && video.buffered.length > 0) {
      const nativeRanges: Array<{ startSec: number; endSec: number }> = [];
      for (let i = 0; i < video.buffered.length; i++) {
        try {
          const s = offsetSec + video.buffered.start(i);
          const e = offsetSec + video.buffered.end(i);
          if (e > s) nativeRanges.push({ startSec: s, endSec: Math.min(curDuration, e) });
        } catch { }
      }
      if (nativeRanges.length > 0) {
        await videoChunkCache.syncNativeBufferedRanges(
          streamKey,
          nativeRanges,
          curDuration,
          estTotalBytes
        );
      }
    }

    const snap = await videoChunkCache.getStreamCacheSnapshot(streamKey, estTotalBytes);
    setIdbSnapshot(snap);
  }, [duration, authoritativeDuration, liveStats?.length, currentTorrent.sizeBytes, streamKey]);

  useEffect(() => {
    refreshIdbBufferState();
    const unsubscribe = videoChunkCache.subscribe(streamKey, () => {
      refreshIdbBufferState();
    });
    const timer = setInterval(refreshIdbBufferState, 1200);
    return () => {
      unsubscribe();
      clearInterval(timer);
    };
  }, [streamKey, refreshIdbBufferState]);

  const isTimeCachedInIndexedDB = useCallback(
    (targetTimeSec: number): boolean => {
      const curDuration = duration > 0 ? duration : authoritativeDuration;
      if (curDuration <= 0 || idbSnapshot.segments.length === 0) return false;
      const targetPct = (targetTimeSec / curDuration) * 100;
      return idbSnapshot.segments.some(
        (seg) => targetPct >= seg.startPercent - 0.3 && targetPct <= seg.endPercent + 0.3
      );
    },
    [duration, authoritativeDuration, idbSnapshot.segments]
  );

  // Poll em tempo real de estatísticas P2P
  useEffect(() => {
    if (!currentTorrent.magnetUri || !currentTorrent.magnetUri.startsWith('magnet:?')) return;

    let active = true;
    const pollStats = async () => {
      const stats = await api.getTorrentStats(currentTorrent.magnetUri);
      if (active && stats) {
        setLiveStats(stats);
      }
    };

    pollStats();
    const interval = setInterval(pollStats, 2000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [currentTorrent.magnetUri]);

  /**
   * Failover estrito (apenas manual ou se a conexão inicial falhar totalmente antes do vídeo começar):
   * NUNCA troca de idioma (PT-BR continua PT-BR!) e NUNCA muda a qualidade escolhida!
   */
  const switchToNextStableSameQualitySeed = useCallback(
    (isManualForce = false): boolean => {
      const now = Date.now();
      if (!isManualForce && now - lastAutoSwitchAtRef.current < 20000) {
        return false;
      }

      let candidates = torrentsPool.filter(
        (t) =>
          t.id !== currentTorrent.id &&
          t.quality === preferredQuality &&
          t.isPortugueseAudio === currentTorrent.isPortugueseAudio &&
          !failedTorrentIds.has(t.id)
      );

      if (isManualForce && candidates.length === 0) {
        candidates = torrentsPool.filter(
          (t) =>
            t.id !== currentTorrent.id &&
            t.quality === preferredQuality &&
            t.isPortugueseAudio === currentTorrent.isPortugueseAudio
        );
        if (candidates.length > 0) {
          setFailedTorrentIds(new Set());
        }
      }

      if (candidates.length === 0) {
        return false;
      }

      const sorted = [...candidates].sort((a, b) => {
        const scoreA = a.stabilityScore ?? a.seeds;
        const scoreB = b.stabilityScore ?? b.seeds;
        return scoreB - scoreA || b.seeds - a.seeds;
      });

      const nextStable = sorted[0];
      lastAutoSwitchAtRef.current = now;

      if (!isManualForce) {
        setFailedTorrentIds((prev) => new Set(prev).add(currentTorrent.id));
      }

      setCurrentTorrent(nextStable);
      setRetryAttempts(0);
      reconnectStreamAtTime(lastKnownTimeRef.current, true, nextStable, audioTrackOverride);

      showToastNotification(
        `Alternando para outra semente ${preferredQuality} ${nextStable.isPortugueseAudio ? 'PT-BR' : 'Original'
        } (${nextStable.seeds} seeds)...`,
        3200
      );

      return true;
    },
    [
      torrentsPool,
      currentTorrent,
      preferredQuality,
      failedTorrentIds,
      reconnectStreamAtTime,
      audioTrackOverride,
      showToastNotification
    ]
  );

  // Troca entre as 3 Qualidades Fixas (720p, 1080p, 4K) preservando idioma e o segundo exato do filme!
  const handleSelectFixedQuality = (newQuality: FixedVideoQuality) => {
    setShowQualityMenu(false);
    setPreferredQuality(newQuality);
    api.setPreferredQuality(newQuality);

    if (currentTorrent.quality === newQuality) return;

    const sameLangAndQuality = torrentsPool
      .filter(
        (t) =>
          t.quality === newQuality &&
          t.isPortugueseAudio === currentTorrent.isPortugueseAudio
      )
      .sort((a, b) => (b.stabilityScore ?? b.seeds) - (a.stabilityScore ?? a.seeds));

    if (sameLangAndQuality.length === 0) {
      showToastNotification(
        `Nenhuma semente ${newQuality} disponível em ${currentTorrent.isPortugueseAudio ? 'Português' : 'Áudio Original'
        } para este título.`,
        3200
      );
      return;
    }

    const bestTarget = sameLangAndQuality[0];
    setCurrentTorrent(bestTarget);
    setRetryAttempts(0);
    reconnectStreamAtTime(lastKnownTimeRef.current, !userPausedRef.current, bestTarget, audioTrackOverride);
    showToastNotification(
      `Qualidade alterada para ${newQuality} (${bestTarget.isPortugueseAudio ? 'PT-BR' : 'Original'}) mantendo o ponto atual!`,
      2800
    );
  };

  // Troca de Idioma (Dublado PT-BR vs Original) ou Faixa de Áudio interna (Dual Áudio) mantendo a posição exata!
  const handleSwitchLanguageMode = (wantPortuguese: boolean, customAudioTrack?: number) => {
    setShowAudioMenu(false);

    if (wantPortuguese === currentTorrent.isPortugueseAudio && customAudioTrack !== audioTrackOverride) {
      setAudioTrackOverride(customAudioTrack);
      reconnectStreamAtTime(lastKnownTimeRef.current, !userPausedRef.current, currentTorrent, customAudioTrack);
      showToastNotification(
        customAudioTrack === undefined
          ? 'Áudio automático PT-BR ativado mantendo o ponto atual!'
          : `Alternado para Faixa de Áudio ${customAudioTrack + 1} (Dual Áudio) no mesmo instante!`,
        2800
      );
      return;
    }

    const bestForLang = api.pickBestTorrentSource(torrentsPool, {
      preferredQuality,
      preferPortuguese: wantPortuguese
    });

    if (!bestForLang || bestForLang.isPortugueseAudio !== wantPortuguese) {
      showToastNotification(
        wantPortuguese
          ? 'Nenhuma fonte Dublada PT-BR encontrada para este título no momento.'
          : 'Nenhuma fonte em Áudio Original separada encontrada.',
        3000
      );
      return;
    }

    setAudioTrackOverride(customAudioTrack);
    setCurrentTorrent(bestForLang);
    setPreferredQuality(bestForLang.quality);
    setRetryAttempts(0);
    reconnectStreamAtTime(lastKnownTimeRef.current, !userPausedRef.current, bestForLang, customAudioTrack);
    showToastNotification(
      `Idioma alterado para ${wantPortuguese ? 'Dublado PT-BR' : 'Original / Inglês'} (${bestForLang.quality}) no mesmo ponto!`,
      3000
    );
  };

  // Re-try Manual de Peers
  const handleManualNetworkRetry = async (alsoSwitchSeed = false) => {
    setIsRetryingNetwork(true);
    setPlaybackError(null);

    try {
      if (alsoSwitchSeed) {
        const switched = switchToNextStableSameQualitySeed(true);
        if (switched) {
          setIsRetryingNetwork(false);
          return;
        }
      }

      if (currentTorrent.magnetUri) {
        const res = await api.retryTorrentPeers(currentTorrent.magnetUri, trackerPriority);
        if (res.stats) {
          setLiveStats(res.stats);
        }
      }

      const year = media.release_date ? media.release_date.slice(0, 4) : undefined;
      api
        .getTorrents(media.title, {
          originalTitle: media.original_title,
          year,
          imdbId: media.imdb_id,
          mediaType: media.media_type,
          season: episode?.seasonNumber,
          episode: episode?.episodeNumber,
          trackerPriority
        })
        .then((freshList) => {
          if (freshList && freshList.length > 0) {
            setTorrentsPool(freshList);
          }
        })
        .catch(() => { });

      showToastNotification(
        `Re-try P2P concluído: rastreando novos peers mantendo sua posição em ${formatTime(lastKnownTimeRef.current)}!`,
        2800
      );

      if (
        videoRef.current &&
        (videoRef.current.error || videoRef.current.ended || videoRef.current.readyState === 0)
      ) {
        reconnectStreamAtTime(lastKnownTimeRef.current, true);
      }
    } finally {
      setTimeout(() => setIsRetryingNetwork(false), 600);
    }
  };

  const handleChangeTrackerPriority = async (mode: TrackerPriorityMode) => {
    setTrackerPriority(mode);
    setIsRetryingNetwork(true);
    await api.setTrackerPriority(mode, currentTorrent.magnetUri);

    if (currentTorrent.magnetUri) {
      const res = await api.retryTorrentPeers(currentTorrent.magnetUri, mode);
      if (res.stats) setLiveStats(res.stats);
    }

    const label = TRACKER_PRIORITY_OPTIONS.find((o) => o.id === mode)?.label || mode;
    showToastNotification(`Prioridade de Tracker alterada para: ${label}`, 2800);
    setIsRetryingNetwork(false);
  };

  const handleSelectAlternativeTorrent = (newTorrent: TorrentSource) => {
    closeAllMenus();
    if (newTorrent.id === currentTorrent.id) return;

    setPreferredQuality(newTorrent.quality);
    api.setPreferredQuality(newTorrent.quality);
    setAudioTrackOverride(undefined);
    setCurrentTorrent(newTorrent);
    setRetryAttempts(0);

    reconnectStreamAtTime(lastKnownTimeRef.current, !userPausedRef.current, newTorrent, undefined);

    showToastNotification(
      `Conectando à fonte ${newTorrent.quality} ${newTorrent.isPortugueseAudio ? 'PT-BR' : 'Original'
      } (${newTorrent.seeds} seeds)...`,
      2600
    );
  };

  // Prefetch Inteligente: avança a janela de peças no motor P2P + salva chunks MP4 no IndexedDB
  useEffect(() => {
    const runPrefetch = async () => {
      const now = Date.now();
      if (now - lastPrefetchCallRef.current < 3200) return;
      lastPrefetchCallRef.current = now;

      const curDuration = duration > 0 ? duration : authoritativeDuration;
      const detectedSpeed = liveStats?.downloadSpeed || 2 * 1024 * 1024;

      if (currentTorrent.magnetUri && currentTorrent.magnetUri.startsWith('magnet:?')) {
        api
          .prefetchNextChunks(currentTorrent.magnetUri, lastKnownTimeRef.current, curDuration, detectedSpeed)
          .catch(() => { });
      }

      const isNativeContainer = /\.(mp4|m4v|webm)$/i.test(liveStats?.name || '');
      if (
        !isTranscodedRef.current &&
        !forceTranscode &&
        !isAudioOnly &&
        !isBuffering &&
        isNativeContainer
      ) {
        videoChunkCache
          .prefetchChunksToIndexedDB(
            activeVideoSrc,
            streamKey,
            lastKnownTimeRef.current,
            curDuration,
            liveStats?.length || currentTorrent.sizeBytes || 1500000000,
            2
          )
          .catch(() => { });
      }
    };

    const interval = setInterval(runPrefetch, 3500);
    return () => clearInterval(interval);
  }, [
    currentTorrent.magnetUri,
    currentTorrent.sizeBytes,
    duration,
    authoritativeDuration,
    liveStats?.downloadSpeed,
    liveStats?.length,
    liveStats?.name,
    forceTranscode,
    isAudioOnly,
    isBuffering,
    activeVideoSrc,
    streamKey
  ]);

  /**
   * Recuperação Silenciosa de Buffer (SEM trocar de seed sozinho no meio do filme!):
   * Mantém a mesma qualidade e o mesmo torrent fixos, apenas reforçando a descoberta de peers via DHT/Trackers.
   */
  useEffect(() => {
    if (isBuffering && !playbackError && currentTorrent.magnetUri) {
      stage1PeerRetryTimerRef.current = setInterval(() => {
        api.retryTorrentPeers(currentTorrent.magnetUri, trackerPriority).then((res) => {
          if (res.stats) setLiveStats(res.stats);
        });
      }, 8500);
    } else if (stage1PeerRetryTimerRef.current) {
      clearInterval(stage1PeerRetryTimerRef.current);
      stage1PeerRetryTimerRef.current = null;
    }

    return () => {
      if (stage1PeerRetryTimerRef.current) {
        clearInterval(stage1PeerRetryTimerRef.current);
        stage1PeerRetryTimerRef.current = null;
      }
    };
  }, [isBuffering, playbackError, currentTorrent.magnetUri, trackerPriority]);

  // Salvar progresso exato (lastKnownTimeRef) no LocalStorage a cada 3s
  useEffect(() => {
    const saveProgress = () => {
      const savedSec = lastKnownTimeRef.current;
      if (savedSec > 2 && (duration > 0 || authoritativeDuration > 0)) {
        storageService.saveWatchProgress({
          id: media.id,
          title: media.title,
          poster_path: media.poster_path,
          backdrop_path: media.backdrop_path,
          currentTime: savedSec,
          duration: duration > 0 ? duration : authoritativeDuration,
          mediaType: media.media_type,
          magnetUri: currentTorrent.magnetUri,
          episodeNumber: episode?.episodeNumber,
          seasonNumber: episode?.seasonNumber,
          episodeTitle: episode?.title
        });
      }
    };

    const saveInterval = setInterval(saveProgress, 3000);
    return () => {
      clearInterval(saveInterval);
      saveProgress();
    };
  }, [media, duration, authoritativeDuration, currentTorrent.magnetUri, episode]);

  // Pré-aquece os blocos do ponto salvo ao retomar um filme de onde parou ("Continuar Assistindo")
  useEffect(() => {
    if (initialStartOffset >= 15 && currentTorrent.magnetUri?.startsWith('magnet:?')) {
      api
        .prefetchNextChunks(currentTorrent.magnetUri, initialStartOffset, authoritativeDuration)
        .catch(() => { });
    }
  }, [initialStartOffset, currentTorrent.magnetUri, authoritativeDuration]);

  // Carrega o IP Wi-Fi local (LAN) sempre que o modal de Transmitir para TV for aberto
  useEffect(() => {
    if (!showCastModal) return;
    let active = true;
    api.getNetworkInfo().then((info) => {
      if (active) setLanInfo(info);
    });
    return () => {
      active = false;
    };
  }, [showCastModal]);

  const handleNativeBrowserCast = async () => {
    const v = videoRef.current as any;
    if (!v) return;
    try {
      if (v.remote && typeof v.remote.prompt === 'function') {
        await v.remote.prompt();
        return;
      }
      if (typeof v.webkitShowPlaybackTargetPicker === 'function') {
        v.webkitShowPlaybackTargetPicker();
        return;
      }
      showToastNotification(
        'Use o Web Video Caster (QR Code ao lado) ou o atalho Win + K no Windows para espelhar na TV!',
        3800
      );
    } catch {
      showToastNotification(
        'Nenhum Chromecast/AirPlay detectado diretamente pelo navegador. Use o Web Video Caster ou o Link Smart TV abaixo!',
        3800
      );
    }
  };

  const handleCopyCastText = (text: string, field: 'tv' | 'stream') => {
    navigator.clipboard?.writeText(text).catch(() => { });
    setCopiedCastField(field);
    setTimeout(() => {
      setCopiedCastField((prev) => (prev === field ? null : prev));
    }, 2200);
  };

  // Autoplay ao montar ou recarregar URL de seek/qualidade (respeitando se o usuário pausou manualmente)
  useEffect(() => {
    const playTimer = setTimeout(() => {
      if (videoRef.current && !userPausedRef.current) {
        videoRef.current.playbackRate = playbackSpeed;
        videoRef.current.play().catch(() => {
          setIsPlaying(false);
        });
      }
    }, 120);

    return () => clearTimeout(playTimer);
  }, [activeVideoSrc, playbackSpeed]);

  const anyMenuOpen =
    showCastModal ||
    showNetworkPanel ||
    showSourcesMenu ||
    showSpeedMenu ||
    showSubMenu ||
    showQualityMenu ||
    showAudioMenu;

  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying && !anyMenuOpen) {
        setShowControls(false);
      }
    }, 3500);
  };

  /**
   * Play / Pause blindado: NUNCA reinicia do 00:00 após travamento ou corte de stream!
   */
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;

    if (isPlaying) {
      userPausedRef.current = true;
      v.pause();
      return;
    }

    userPausedRef.current = false;
    const effDur = duration > 0 ? duration : authoritativeDuration;
    const savedPos = lastKnownTimeRef.current;
    const isPrematurelyEnded = v.ended && savedPos > 2 && savedPos < effDur - 35;

    if (isPrematurelyEnded || v.error || (v.readyState === 0 && savedPos > 2)) {
      reconnectStreamAtTime(savedPos, true);
      return;
    }

    // Se em MP4 nativo o navegador resetou currentTime para 0 por algum motivo, restaura antes do play
    if (!isTranscodedRef.current && savedPos > 3 && v.currentTime < 0.5) {
      v.currentTime = savedPos;
    }

    v.play().catch(() => {
      if (savedPos > 2) {
        reconnectStreamAtTime(savedPos, true);
      }
    });
  };

  /**
   * Busca unificada (MP4 nativo via HTTP 206/IndexedDB OU MKV transcodificado via FFmpeg Instant Seek!)
   */
  const seekToEffectiveTime = useCallback(
    (rawTarget: number, debounceMs = 0) => {
      const v = videoRef.current;
      const curDur = duration > 0 ? duration : authoritativeDuration;
      const target = Math.max(0, Math.min(curDur, rawTarget));

      lastKnownTimeRef.current = target;
      setCurrentTime(target);

      if (seekDebounceTimerRef.current) {
        clearTimeout(seekDebounceTimerRef.current);
        seekDebounceTimerRef.current = null;
      }

      // 1. Contêiner nativo MP4/WebM comprovadamente seekable: seek direto no elemento <video>
      const isProvenNativeMp4 = Boolean(
        !isTranscodedRef.current &&
        v &&
        Number.isFinite(v.duration) &&
        v.duration > 30 &&
        !v.ended &&
        !v.error
      );
      if (isProvenNativeMp4 && v) {
        if (!isTimeCachedInIndexedDB(target)) {
          setIsBuffering(true);
        }
        v.currentTime = target;
        return;
      }

      // 2. Stream MKV transcodificado: se o alvo já estiver dentro do buffer local carregado, seek imediato sem rede!
      if (isTranscodedRef.current && v && !v.ended && !v.error) {
        const localTime = target - streamStartOffsetRef.current;
        if (localTime >= 0) {
          for (let i = 0; i < v.buffered.length; i++) {
            try {
              if (
                localTime >= v.buffered.start(i) &&
                localTime <= Math.max(0, v.buffered.end(i) - 0.4)
              ) {
                v.currentTime = localTime;
                return;
              }
            } catch { }
          }
        }
      }

      // 3. Caso contrário em MKV: antecipa imediatamente a janela de peças P2P e reposiciona o FFmpeg via Cues!
      setIsBuffering(true);
      if (currentTorrent.magnetUri?.startsWith('magnet:?')) {
        api.prefetchNextChunks(currentTorrent.magnetUri, target, curDur).catch(() => { });
      }
      if (debounceMs > 0) {
        seekDebounceTimerRef.current = setTimeout(() => {
          reconnectStreamAtTime(target, !userPausedRef.current);
        }, debounceMs);
      } else {
        reconnectStreamAtTime(target, !userPausedRef.current);
      }
    },
    [duration, authoritativeDuration, isTimeCachedInIndexedDB, reconnectStreamAtTime, currentTorrent.magnetUri]
  );

  const skipSeconds = (seconds: number) => {
    seekToEffectiveTime(lastKnownTimeRef.current + seconds, 0);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    const v = videoRef.current;
    const needsDebouncedServerSeek =
      isTranscodedRef.current || !(v && Number.isFinite(v.duration) && v.duration > 30);
    seekToEffectiveTime(time, needsDebouncedServerSeek ? 180 : 0);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newVol = parseFloat(e.target.value);
    setVolume(newVol);
    setIsMuted(newVol === 0);
    if (videoRef.current) {
      videoRef.current.volume = newVol;
      videoRef.current.muted = newVol === 0;
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    videoRef.current.muted = nextMuted;
    if (!nextMuted && volume === 0) {
      setVolume(0.5);
      videoRef.current.volume = 0.5;
    }
  };

  const togglePictureInPicture = async () => {
    if (!videoRef.current) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await videoRef.current.requestPictureInPicture();
      }
    } catch (err) {
      console.warn('PiP falhou:', err);
    }
  };

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current
        .requestFullscreen()
        .then(() => setIsFullscreen(true))
        .catch(console.warn);
    } else {
      document
        .exitFullscreen()
        .then(() => setIsFullscreen(false))
        .catch(console.warn);
    }
  };

  const changeSpeed = (speed: number) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) videoRef.current.playbackRate = speed;
    setShowSpeedMenu(false);
  };

  const formatTime = (secs: number) => {
    if (isNaN(secs) || secs < 0) return '00:00';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.floor(secs % 60);
    if (h > 0) {
      return `${h}:${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}`;
    }
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const [hudFeedback, setHudFeedback] = useState<{ text: string; icon?: string; key: number } | null>(null);
  const hudTimerRef = useRef<NodeJS.Timeout | null>(null);
  const lastTapTimeRef = useRef<{ time: number; x: number }>({ time: 0, x: 0 });

  const triggerHud = useCallback((text: string, icon?: string) => {
    if (hudTimerRef.current) clearTimeout(hudTimerRef.current);
    setHudFeedback({ text, icon, key: Date.now() });
    hudTimerRef.current = setTimeout(() => {
      setHudFeedback(null);
    }, 850);
  }, []);

  // Atalhos de Teclado Globais Estilo Streaming Web Profissional (YouTube/Netflix)
  useEffect(() => {
    if (isMini) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          activeEl.tagName === 'SELECT' ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return;
      }

      switch (e.code) {
        case 'Space':
        case 'KeyK':
          e.preventDefault();
          togglePlay();
          triggerHud(isPlaying ? 'Pausado' : 'Reproduzindo', isPlaying ? 'pause' : 'play');
          break;
        case 'ArrowRight':
        case 'KeyL':
          e.preventDefault();
          skipSeconds(10);
          triggerHud('+10s', 'forward');
          break;
        case 'ArrowLeft':
        case 'KeyJ':
          e.preventDefault();
          skipSeconds(-10);
          triggerHud('-10s', 'replay');
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolume((prev) => {
            const next = Math.min(1, Math.round((prev + 0.1) * 10) / 10);
            if (videoRef.current) {
              videoRef.current.volume = next;
              videoRef.current.muted = false;
            }
            setIsMuted(false);
            triggerHud(`Volume ${Math.round(next * 100)}%`, 'volume');
            return next;
          });
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume((prev) => {
            const next = Math.max(0, Math.round((prev - 0.1) * 10) / 10);
            if (videoRef.current) {
              videoRef.current.volume = next;
              videoRef.current.muted = next === 0;
            }
            setIsMuted(next === 0);
            triggerHud(next === 0 ? 'Mudo' : `Volume ${Math.round(next * 100)}%`, next === 0 ? 'mute' : 'volume');
            return next;
          });
          break;
        case 'KeyM':
          e.preventDefault();
          toggleMute();
          triggerHud(!isMuted ? 'Mudo' : 'Com som', !isMuted ? 'mute' : 'volume');
          break;
        case 'KeyF':
          e.preventDefault();
          toggleFullscreen();
          triggerHud(isFullscreen ? 'Janela Normal' : 'Tela Cheia', 'fullscreen');
          break;
        case 'KeyC':
          e.preventDefault();
          setSelectedSubtitleId((prev) => {
            const next = prev === 'off' ? (subtitleTracks[0]?.id || 'off') : 'off';
            triggerHud(next === 'off' ? 'Legendas Desativadas' : 'Legendas Ativadas', 'subtitles');
            return next;
          });
          break;
        default:
          if (e.key >= '0' && e.key <= '9') {
            e.preventDefault();
            const pct = parseInt(e.key, 10) * 10;
            const target = ((duration > 0 ? duration : authoritativeDuration) * pct) / 100;
            seekToEffectiveTime(target, 0);
            triggerHud(`${pct}% (${formatTime(target)})`, 'seek');
          }
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    isMini,
    isPlaying,
    isMuted,
    isFullscreen,
    duration,
    authoritativeDuration,
    subtitleTracks,
    togglePlay,
    skipSeconds,
    seekToEffectiveTime,
    toggleMute,
    toggleFullscreen,
    triggerHud
  ]);

  // Gestos de Toque Mobile (Double Tap para pular 10s e Single Tap para controles)
  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (isMini || anyMenuOpen) return;
    const now = Date.now();
    const touch = e.changedTouches[0];
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    const touchX = touch.clientX - rect.left;
    const width = rect.width;

    const dt = now - lastTapTimeRef.current.time;
    const dx = Math.abs(touchX - lastTapTimeRef.current.x);

    if (dt < 320 && dx < 60) {
      if (touchX < width * 0.38) {
        skipSeconds(-10);
        triggerHud('-10s', 'replay');
      } else if (touchX > width * 0.62) {
        skipSeconds(10);
        triggerHud('+10s', 'forward');
      } else {
        togglePlay();
        triggerHud(isPlaying ? 'Pausado' : 'Reproduzindo', isPlaying ? 'pause' : 'play');
      }
      lastTapTimeRef.current = { time: 0, x: 0 };
    } else {
      lastTapTimeRef.current = { time: now, x: touchX };
      handleMouseMove();
    }
  };

  const totalEffectiveDuration = duration > 0 ? duration : authoritativeDuration;
  const progressPercent =
    totalEffectiveDuration > 0
      ? Math.min(100, Math.max(0, (currentTime / totalEffectiveDuration) * 100))
      : 0;

  const connectedPeersCount = liveStats ? liveStats.numPeers : currentTorrent.peers || 0;
  const activePeersCount = liveStats
    ? liveStats.activePeers
    : Math.max(1, Math.floor(connectedPeersCount * 0.5));
  const currentTransferSpeed = liveStats?.downloadSpeed || 0;
  const sameQualityCount = torrentsPool.filter(
    (t) =>
      t.quality === preferredQuality &&
      t.isPortugueseAudio === currentTorrent.isPortugueseAudio
  ).length;
  const ptAvailableCount = torrentsPool.filter((t) => t.isPortugueseAudio).length;
  const origAvailableCount = torrentsPool.filter((t) => !t.isPortugueseAudio).length;

  const subtitleFontClass =
    subtitleSize === 'sm'
      ? 'text-[13px] sm:text-[15px]'
      : subtitleSize === 'md'
        ? 'text-[15px] sm:text-[18px]'
        : 'text-[18px] sm:text-[22px]';

  return (
    <div
      ref={containerRef}
      onMouseMove={isMini ? undefined : handleMouseMove}
      onTouchStart={isMini ? undefined : handleTouchStart}
      className={
        isMini
          ? 'dark fixed z-[70] right-3 bottom-[96px] md:right-6 md:bottom-6 w-[min(320px,calc(100vw-24px))] sm:w-[380px] lg:w-[420px] rounded-2xl overflow-hidden bg-black text-white select-none shadow-[0_24px_60px_rgba(0,0,0,0.55)] ring-1 ring-white/15 group/mini animate-in fade-in slide-in-from-bottom-4 duration-300'
          : 'dark fixed inset-0 z-50 bg-black text-white flex items-center justify-center select-none overflow-hidden'
      }
    >
      {/* Indicador Tátil HUD de Atalhos de Teclado e Gestos Touch */}
      {hudFeedback && !isMini && (
        <div
          key={hudFeedback.key}
          className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center animate-in fade-in zoom-in-95 duration-150"
        >
          <div className="glass-dropdown px-5 py-3 rounded-2xl border border-white/20 shadow-2xl flex items-center gap-3 text-white backdrop-blur-2xl">
            {hudFeedback.icon === 'forward' && <RotateCw className="w-5 h-5 text-emerald-400" />}
            {hudFeedback.icon === 'replay' && <RotateCcw className="w-5 h-5 text-emerald-400" />}
            {hudFeedback.icon === 'volume' && <Volume2 className="w-5 h-5 text-white" />}
            {hudFeedback.icon === 'mute' && <VolumeX className="w-5 h-5 text-rose-400" />}
            {hudFeedback.icon === 'fullscreen' && <Maximize className="w-5 h-5 text-white" />}
            {hudFeedback.icon === 'subtitles' && <Subtitles className="w-5 h-5 text-emerald-400" />}
            {hudFeedback.icon === 'play' && <Play className="w-5 h-5 fill-current text-white" />}
            {hudFeedback.icon === 'pause' && <Pause className="w-5 h-5 fill-current text-white" />}
            <span className="text-sm font-extrabold tracking-wide">{hudFeedback.text}</span>
          </div>
        </div>
      )}

      {/* Toast de Rede / Qualidade / Idioma */}
      {failoverToast && !isMini && (
        <div className="absolute top-20 z-50 glass-dropdown px-4 py-2.5 rounded-2xl border border-emerald-500/30 shadow-2xl flex items-center gap-2.5 animate-in slide-in-from-top duration-300 text-xs font-semibold text-white max-w-lg text-center">
          <Zap className="w-4 h-4 text-emerald-400 shrink-0 animate-pulse" />
          <span>{failoverToast}</span>
        </div>
      )}

      {/* Vídeo HTML5 Principal */}
      <video
        ref={videoRef}
        src={activeVideoSrc}
        playsInline
        autoPlay
        className={`w-full object-contain ${isMini ? 'aspect-video bg-black' : 'h-full'} ${isAudioOnly && !isMini ? 'hidden' : 'block'
          }`}
        onPlay={() => {
          setIsPlaying(true);
          if (videoRef.current && videoRef.current.readyState >= 3) {
            setIsBuffering(false);
          }
        }}
        onCanPlay={() => {
          setIsBuffering(false);
          refreshIdbBufferState();
        }}
        onLoadedData={() => {
          if (videoRef.current && videoRef.current.readyState >= 2) {
            setIsBuffering(false);
          }
          refreshIdbBufferState();
        }}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onSeeking={() => {
          if (videoRef.current && !isTranscodedRef.current && !isTimeCachedInIndexedDB(videoRef.current.currentTime)) {
            setIsBuffering(true);
          }
        }}
        onSeeked={() => {
          setIsBuffering(false);
          refreshIdbBufferState();
        }}
        onProgress={() => {
          refreshIdbBufferState();
        }}
        onTimeUpdate={() => {
          if (!videoRef.current) return;
          if (videoRef.current.readyState >= 2 && !videoRef.current.seeking) {
            setIsBuffering(false);
          }
          const rawT = videoRef.current.currentTime;
          const effT = isTranscodedRef.current ? streamStartOffsetRef.current + rawT : rawT;
          // Evita sobrescrever a posição conhecida com 0 durante transições de reconexão
          if (effT > 0.25 || lastKnownTimeRef.current < 2) {
            lastKnownTimeRef.current = effT;
            setCurrentTime(effT);
          }
        }}
        onLoadedMetadata={() => {
          const v = videoRef.current;
          if (v && v.readyState >= 3) {
            setIsBuffering(false);
          }
          if (v) {
            const rawDur = v.duration;
            const isNativeSeekable =
              Number.isFinite(rawDur) &&
              rawDur > 30 &&
              !forceTranscode &&
              typeof audioTrackOverride !== 'number';

            if (isNativeSeekable) {
              isTranscodedRef.current = false;
              setDuration(rawDur);
              const resumeTarget =
                streamStartOffsetRef.current > 0
                  ? streamStartOffsetRef.current
                  : pendingResumeTimeRef.current;
              streamStartOffsetRef.current = 0;
              pendingResumeTimeRef.current = 0;
              if (resumeTarget > 1) {
                v.currentTime = resumeTarget;
              }
            } else {
              isTranscodedRef.current = true;
              setDuration(authoritativeDuration);
            }
          }
          refreshIdbBufferState();
        }}
        onDurationChange={() => {
          if (videoRef.current) {
            const rawDur = videoRef.current.duration;
            if (rawDur && isFinite(rawDur) && rawDur > 120 && !isTranscodedRef.current) {
              setDuration(rawDur);
            }
          }
          refreshIdbBufferState();
        }}
        onEnded={() => {
          const effDur = duration > 0 ? duration : authoritativeDuration;
          const savedPos = lastKnownTimeRef.current;
          // Proteção crucial: se um stream chunked HTTP 200 fechar antes do fim real do filme (ex: 38s),
          // NÃO deixa o player entrar em estado ended (que reiniciaria do 00:00 no play!), reconecta no ponto exato!
          if (effDur > 120 && savedPos > 2 && savedPos < effDur - 40) {
            if (currentTorrent.magnetUri) {
              api.retryTorrentPeers(currentTorrent.magnetUri, trackerPriority).catch(() => { });
            }
            if (!userPausedRef.current) {
              reconnectStreamAtTime(savedPos, true);
            } else {
              setIsPlaying(false);
            }
            return;
          }
          setIsPlaying(false);
        }}
        onError={() => {
          setIsBuffering(false);
          const savedPos = lastKnownTimeRef.current;

          // 1. Mantém a MESMA fonte/qualidade/idioma e reconecta exatamente onde parou!
          if (retryAttempts < 2) {
            setRetryAttempts((prev) => prev + 1);
            setIsBuffering(true);
            if (currentTorrent.magnetUri) {
              api.retryTorrentPeers(currentTorrent.magnetUri, trackerPriority).catch(() => { });
            }
            setTimeout(() => {
              reconnectStreamAtTime(savedPos, !userPausedRef.current);
            }, 1300);
            return;
          }

          // 2. Só troca de seed automaticamente se falhou logo na abertura (< 5s) e APENAS no mesmo idioma + mesma qualidade!
          if (savedPos < 5) {
            const switchedSameQuality = switchToNextStableSameQualitySeed(false);
            if (switchedSameQuality) return;
          }

          setPlaybackError(
            `Conexão P2P oscilou em ${formatTime(savedPos)} (${preferredQuality} · ${currentTorrent.isPortugueseAudio ? 'PT-BR' : 'Original'
            }). Clique em "Continuar daqui" para retomar exatamente de onde parou.`
          );
        }}
      />

      {/* OVERLAY DE LEGENDAS FIXO NA PARTE INFERIOR DA TELA (Nunca flutua no centro!) */}
      {activeSubtitleText && (
        <div
          className={`pointer-events-none absolute inset-x-3 sm:inset-x-8 z-30 flex justify-center transition-all duration-300 ${isMini
              ? 'bottom-11'
              : showControls
                ? 'bottom-28 sm:bottom-32'
                : 'bottom-4 sm:bottom-6'
            }`}
        >
          <div
            className={`max-w-[90%] sm:max-w-[78%] text-center font-medium text-white bg-black/75 backdrop-blur-[2px] px-3 py-1 sm:px-4 sm:py-1.5 rounded-lg leading-snug whitespace-pre-line shadow-[0_2px_10px_rgba(0,0,0,0.85)] ${isMini ? 'text-[10px] px-2 py-0.5' : subtitleFontClass
              }`}
            style={{ textShadow: '0 1px 3px rgba(0,0,0,0.95)' }}
          >
            {activeSubtitleText}
          </div>
        </div>
      )}

      {/* Mini Player flutuante (estilo YouTube) */}
      {isMini && (
        <>
          <div className="absolute inset-x-0 top-0 aspect-video">
            {isBuffering && !playbackError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/35 pointer-events-none">
                <Loader2 className="w-7 h-7 text-white/90 animate-spin" />
              </div>
            )}
            {playbackError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/75 px-4 text-center">
                <span className="text-xs font-semibold text-white/90">Pausado em {formatTime(currentTime)}</span>
                <button
                  type="button"
                  onClick={() => reconnectStreamAtTime(lastKnownTimeRef.current, true)}
                  className="px-3 py-1.5 rounded-full bg-white text-black text-[11px] font-bold"
                >
                  Continuar daqui
                </button>
              </div>
            )}

            <div
              onClick={onExpand}
              className="absolute inset-0 cursor-pointer bg-gradient-to-b from-black/55 via-transparent to-black/45 opacity-0 group-hover/mini:opacity-100 transition-opacity duration-200 flex items-center justify-center"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlay();
                }}
                className="w-12 h-12 rounded-full bg-white/20 hover:bg-white/30 backdrop-blur-md border border-white/25 flex items-center justify-center transition-transform active:scale-90"
                aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
              >
                {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onExpand?.();
                }}
                className="absolute top-2 left-2 p-1.5 rounded-full bg-black/45 hover:bg-black/70 backdrop-blur-md transition-colors"
                aria-label="Expandir player"
                title="Expandir"
              >
                <Maximize2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                className="absolute top-2 right-2 p-1.5 rounded-full bg-black/45 hover:bg-black/70 backdrop-blur-md transition-colors"
                aria-label="Fechar player"
                title="Fechar"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="absolute bottom-0 inset-x-0 h-[3px] bg-white/20 pointer-events-none">
              <div className="h-full bg-white transition-[width] duration-200" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>

          <div className="flex items-center gap-2 pl-3 pr-1.5 py-2 bg-[#0D1016]">
            <button type="button" onClick={onExpand} className="min-w-0 flex-1 text-left">
              <p className="text-[13px] font-semibold text-white truncate">{media.title}</p>
              <p className="text-[11px] text-white/55 truncate">
                {episode
                  ? `T${episode.seasonNumber} · E${episode.episodeNumber} · ${episode.title}`
                  : `${currentTorrent.quality} · ${currentTorrent.isPortugueseAudio ? 'PT-BR' : 'Orig'} · ${formatTime(currentTime)}`}
              </p>
            </button>
            <button
              type="button"
              onClick={togglePlay}
              className="p-2 rounded-full hover:bg-white/10 transition-colors"
              aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
            >
              {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-full hover:bg-white/10 transition-colors"
              aria-label="Fechar player"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </>
      )}

      {!isMini && (
        <>
          {/* Visualizador do Modo Apenas Áudio */}
          {isAudioOnly && (
            <div className="absolute inset-0 flex flex-col items-center justify-center p-6 text-center bg-gradient-to-b from-[#14161c] via-[#0A0D11] to-black">
              <div className="relative w-44 h-44 sm:w-60 sm:h-60 rounded-3xl overflow-hidden shadow-2xl border border-white/10 mb-6">
                {media.poster_path ? (
                  <img
                    src={media.poster_path}
                    alt={displayTitle}
                    className="w-full h-full object-cover filter brightness-90"
                  />
                ) : (
                  <div className="w-full h-full bg-neutral-900 flex items-center justify-center text-white/40">
                    <Headphones className="w-16 h-16" />
                  </div>
                )}
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <Headphones className="w-12 h-12 text-white animate-pulse" />
                </div>
              </div>

              <h2 className="text-lg sm:text-xl font-bold text-white max-w-md">{displayTitle}</h2>
              <p className="text-xs text-white/50 mt-1">
                Modo Somente Áudio Ativo · Economizando dados e bateria
              </p>

              <div className="flex items-center gap-1.5 mt-6 h-8">
                {[40, 70, 100, 60, 90, 45, 80, 100, 50, 75, 95, 30].map((h, i) => (
                  <div
                    key={i}
                    className={`w-1 bg-white rounded-full transition-all duration-300 ${isPlaying ? 'animate-pulse' : 'opacity-30'
                      }`}
                    style={{ height: isPlaying ? `${h}%` : '20%' }}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Indicador de Buffering */}
          {isBuffering && !playbackError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-[2px] pointer-events-none z-30">
              <div className="w-10 h-10 rounded-full border-2 border-white/20 border-t-white animate-spin mb-3" />
              <span className="text-sm font-semibold text-white/95">
                {currentTime > 3 ? `Carregando em ${formatTime(currentTime)}…` : 'Carregando…'}
              </span>
              <span className="text-[11px] text-white/55 mt-1">
                {connectedPeersCount > 0
                  ? `${connectedPeersCount} conexões · ${formatTransferSpeed(currentTransferSpeed)}`
                  : 'Conectando aos peers mais rápidos'}
              </span>
            </div>
          )}

          {/* Diálogo de Recuperação sem Perder o Ponto do Filme */}
          {playbackError && (
            <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-in fade-in">
              <div className="max-w-md w-full glass-panel p-6 rounded-2xl border border-white/10 text-center space-y-4 shadow-2xl">
                <div className="w-12 h-12 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
                  <Wifi className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-white">
                    Pausado em {formatTime(lastKnownTimeRef.current)} ({preferredQuality})
                  </h3>
                  <p className="text-xs text-white/70 mt-1 leading-relaxed">{playbackError}</p>
                </div>

                {torrentsPool.length > 1 && (
                  <div className="text-left space-y-1.5 max-h-40 overflow-y-auto pr-1">
                    <span className="text-[11px] font-semibold text-white/50 uppercase tracking-wider">
                      Outras fontes disponíveis (mantendo {formatTime(lastKnownTimeRef.current)}):
                    </span>
                    {[...torrentsPool]
                      .filter((t) => t.id !== currentTorrent.id)
                      .sort(
                        (a, b) =>
                          (a.isPortugueseAudio === currentTorrent.isPortugueseAudio ? 0 : 1) -
                          (b.isPortugueseAudio === currentTorrent.isPortugueseAudio ? 0 : 1) ||
                          (a.quality === preferredQuality ? -1 : 1) -
                          (b.quality === preferredQuality ? -1 : 1)
                      )
                      .map((alt) => (
                        <button
                          key={alt.id}
                          onClick={() => handleSelectAlternativeTorrent(alt)}
                          className="w-full p-2 rounded-xl glass-subtle hover:bg-white/10 text-white text-xs flex items-center justify-between border border-white/5 transition-colors"
                        >
                          <div className="flex items-center gap-2 truncate">
                            <span className="font-bold">{alt.quality}</span>
                            {alt.isPortugueseAudio ? (
                              <span className="text-[10px] text-emerald-400 font-bold">Dublado PT-BR</span>
                            ) : (
                              <span className="text-[10px] text-white/50">Original</span>
                            )}
                            <span className="text-[10px] text-white/40 truncate">{alt.source}</span>
                          </div>
                          <span className="text-[10px] text-emerald-400 font-mono shrink-0">
                            {alt.seeds} seeds
                          </span>
                        </button>
                      ))}
                  </div>
                )}

                <div className="flex flex-col sm:flex-row gap-2 pt-2">
                  <button
                    onClick={() => {
                      setRetryAttempts(0);
                      handleManualNetworkRetry(false);
                    }}
                    className="flex-1 py-2.5 px-4 bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs rounded-xl shadow-md transition-colors flex items-center justify-center gap-1.5"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isRetryingNetwork ? 'animate-spin' : ''}`} />
                    <span>Continuar daqui ({formatTime(lastKnownTimeRef.current)})</span>
                  </button>
                  <button
                    onClick={onClose}
                    className="flex-1 py-2.5 px-4 glass-subtle hover:bg-white/10 text-white font-semibold text-xs rounded-xl border border-white/10 transition-colors"
                  >
                    Voltar aos Detalhes
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Painel Superior de Controles */}
          <div
            className={`absolute top-0 left-0 right-0 p-4 sm:p-6 bg-gradient-to-b from-black/85 to-transparent flex items-center justify-between z-40 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
          >
            <div className="flex items-center gap-3 min-w-0 flex-1 mr-4">
              {onMinimize ? (
                <button
                  onClick={handleMinimize}
                  className="p-2 rounded-xl glass-panel hover:bg-white/10 text-white transition-colors shrink-0"
                  aria-label="Minimizar player"
                  title="Minimizar e continuar navegando"
                >
                  <ChevronDown className="w-5 h-5" />
                </button>
              ) : (
                <button
                  onClick={onClose}
                  className="p-2 rounded-xl glass-panel hover:bg-white/10 text-white transition-colors shrink-0"
                  aria-label="Voltar"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
              <div className="min-w-0">
                <h3 className="text-xs sm:text-sm md:text-base font-bold text-white truncate">
                  {displayTitle}
                </h3>
                <div className="flex items-center gap-2 text-[11px] text-white/60 flex-wrap">
                  <span className="font-bold text-white">{currentTorrent.quality} Fixo</span>
                  <span aria-hidden="true">·</span>
                  <span
                    className={`font-semibold ${currentTorrent.isPortugueseAudio ? 'text-emerald-400' : 'text-sky-300'
                      }`}
                  >
                    {currentTorrent.isPortugueseAudio ? 'Dublado PT-BR' : 'Áudio Original'}
                  </span>
                  <span aria-hidden="true" className="hidden sm:inline">·</span>
                  <span className="hidden sm:inline text-white/50 truncate">{currentTorrent.source}</span>
                </div>
              </div>
            </div>

            {/* Controles Superiores Direitos: Painel de Rede + Fontes */}
            <div className="flex items-center gap-2 sm:gap-2.5 shrink-0">
              <div className="relative">
                <button
                  onClick={() => {
                    const next = !showNetworkPanel;
                    closeAllMenus();
                    setShowNetworkPanel(next);
                  }}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border text-xs font-mono transition-all ${showNetworkPanel
                      ? 'bg-emerald-500 text-black font-bold border-emerald-400 shadow-lg'
                      : 'glass-subtle hover:bg-white/15 border-white/15 text-white'
                    }`}
                  title="Abrir Painel de Controle de Rede P2P em tempo real"
                >
                  <span className="relative flex h-2 w-2">
                    <span
                      className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${showNetworkPanel
                          ? 'bg-black'
                          : liveStats?.isLowSpeed
                            ? 'bg-amber-400'
                            : 'bg-emerald-400'
                        }`}
                    />
                    <span
                      className={`relative inline-flex rounded-full h-2 w-2 ${showNetworkPanel
                          ? 'bg-black'
                          : liveStats?.isLowSpeed
                            ? 'bg-amber-400'
                            : 'bg-emerald-500'
                        }`}
                    />
                  </span>
                  <Users className="w-3.5 h-3.5" />
                  <span className="font-bold">{connectedPeersCount} peers</span>
                  <span className="hidden md:inline opacity-75">
                    · {formatTransferSpeed(currentTransferSpeed)}
                  </span>
                </button>

                {showNetworkPanel && (
                  <div className="absolute right-0 top-11 w-80 sm:w-96 glass-dropdown rounded-2xl p-4 border border-white/15 shadow-2xl z-50 space-y-3.5 text-left animate-in fade-in">
                    <div className="flex items-center justify-between border-b border-white/10 pb-2.5">
                      <div className="flex items-center gap-2">
                        <Activity className="w-4 h-4 text-emerald-400" />
                        <span className="text-xs font-extrabold text-white uppercase tracking-wider">
                          Painel de Rede P2P
                        </span>
                      </div>
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/25 flex items-center gap-1">
                        <ShieldCheck className="w-3 h-3" />
                        {preferredQuality} Travado
                      </span>
                    </div>

                    <div className="grid grid-cols-3 gap-2">
                      <div className="p-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08]">
                        <div className="text-[10px] text-white/50">Peers Conectados</div>
                        <div className="text-sm font-extrabold font-mono text-emerald-400 mt-0.5">
                          {connectedPeersCount}
                          <span className="text-[10px] text-white/50 font-normal ml-1">
                            ({activePeersCount})
                          </span>
                        </div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08]">
                        <div className="text-[10px] text-white/50">Velocidade</div>
                        <div className="text-sm font-extrabold font-mono text-white mt-0.5">
                          {formatTransferSpeed(currentTransferSpeed)}
                        </div>
                      </div>
                      <div className="p-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08]">
                        <div className="text-[10px] text-white/50">Cache Sessão</div>
                        <div className="text-sm font-extrabold font-mono text-emerald-300 mt-0.5">
                          {formatCachedBytes(idbSnapshot.cachedBytes)}
                        </div>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <div className="text-[11px] font-bold text-white/70 flex items-center justify-between">
                        <span>Prioridade de Trackers</span>
                        {liveStats && liveStats.autoRetryCount > 0 && (
                          <span className="text-[10px] font-mono text-amber-300">
                            Re-tries: {liveStats.autoRetryCount}
                          </span>
                        )}
                      </div>
                      <div className="space-y-1">
                        {TRACKER_PRIORITY_OPTIONS.map((opt) => {
                          const active = trackerPriority === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => handleChangeTrackerPriority(opt.id)}
                              className={`w-full text-left px-2.5 py-2 rounded-xl border text-xs transition-all flex items-center justify-between gap-2 ${active
                                  ? 'bg-white text-black font-bold border-white shadow-sm'
                                  : 'bg-white/[0.03] text-white/80 border-white/[0.06] hover:bg-white/10'
                                }`}
                            >
                              <div className="min-w-0">
                                <div className="truncate">{opt.label}</div>
                                <div
                                  className={`text-[10px] truncate ${active ? 'text-black/70 font-normal' : 'text-white/45'
                                    }`}
                                >
                                  {opt.desc}
                                </div>
                              </div>
                              {active && <Check className="w-3.5 h-3.5 shrink-0 stroke-[3]" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex flex-col sm:flex-row gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => handleManualNetworkRetry(false)}
                        disabled={isRetryingNetwork}
                        className="flex-1 py-2 px-3 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-60"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${isRetryingNetwork ? 'animate-spin' : ''}`} />
                        <span>Forçar Re-try Peers</span>
                      </button>

                      {sameQualityCount > 1 && (
                        <button
                          type="button"
                          onClick={() => handleManualNetworkRetry(true)}
                          disabled={isRetryingNetwork}
                          className="flex-1 py-2 px-3 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs border border-white/15 flex items-center justify-center gap-1.5 transition-all active:scale-95 disabled:opacity-60"
                        >
                          <Zap className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Outra Seed {preferredQuality}</span>
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Lista Completa de Fontes Separadas por Idioma */}
              {torrentsPool.length > 1 && (
                <div className="relative">
                  <button
                    onClick={() => {
                      const next = !showSourcesMenu;
                      closeAllMenus();
                      setShowSourcesMenu(next);
                    }}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl glass-subtle hover:bg-white/15 border border-white/10 text-xs font-medium text-white transition-colors"
                    title="Trocar semente manualmente"
                  >
                    <Layers className="w-3.5 h-3.5 text-white/70" />
                    <span className="hidden sm:inline">Seeds</span>
                    <span className="text-[10px] px-1 rounded bg-white/10 text-white/70">
                      {torrentsPool.length}
                    </span>
                  </button>

                  {showSourcesMenu && (
                    <div className="absolute right-0 top-11 w-76 sm:w-80 glass-dropdown rounded-2xl p-2 border border-white/15 shadow-2xl z-50 animate-in fade-in">
                      <div className="text-[11px] font-semibold text-white/55 px-2 py-1 flex items-center justify-between">
                        <span>Sementes Disponíveis</span>
                        <span className="text-emerald-400 font-mono text-[10px]">
                          Mantém {formatTime(currentTime)}
                        </span>
                      </div>
                      <div className="space-y-1 mt-1 max-h-60 overflow-y-auto pr-0.5">
                        {[...torrentsPool]
                          .sort(
                            (a, b) =>
                              (b.isPortugueseAudio ? 1 : 0) - (a.isPortugueseAudio ? 1 : 0) ||
                              (b.stabilityScore ?? b.seeds) - (a.stabilityScore ?? a.seeds)
                          )
                          .map((t) => {
                            const isCur = t.id === currentTorrent.id;
                            return (
                              <button
                                key={t.id}
                                onClick={() => handleSelectAlternativeTorrent(t)}
                                className={`w-full text-left p-2 rounded-xl text-xs transition-colors flex items-center justify-between gap-2 ${isCur
                                    ? 'bg-white text-black font-bold shadow-md'
                                    : 'text-white/80 hover:bg-white/10'
                                  }`}
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-1.5 flex-wrap">
                                    <span className="font-bold">{t.quality}</span>
                                    {t.isPortugueseAudio ? (
                                      <span
                                        className={`text-[9px] px-1.5 py-0.2 rounded font-bold ${isCur
                                            ? 'bg-emerald-600 text-white'
                                            : 'bg-emerald-500/20 text-emerald-400'
                                          }`}
                                      >
                                        Dublado PT-BR
                                      </span>
                                    ) : (
                                      <span
                                        className={`text-[9px] px-1.5 py-0.2 rounded font-medium ${isCur ? 'bg-black/15 text-black' : 'bg-white/10 text-white/60'
                                          }`}
                                      >
                                        Original / Inglês
                                      </span>
                                    )}
                                  </div>
                                  <div className="text-[10px] opacity-60 font-mono truncate mt-0.5">
                                    {t.source} · {t.sizeFormatted}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1 font-mono text-[11px] shrink-0">
                                  {isCur ? <Check className="w-3.5 h-3.5 stroke-[3]" /> : `${t.seeds}s`}
                                </div>
                              </button>
                            );
                          })}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Botão Transmitir para TV / Web Video Caster / Chromecast */}
              <button
                type="button"
                onClick={() => {
                  closeAllMenus();
                  setShowCastModal(true);
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl glass-subtle hover:bg-white/15 border border-white/15 text-xs font-bold text-white transition-colors cursor-pointer"
                title="Transmitir vídeo para Smart TV, Web Video Caster ou Chromecast"
              >
                <Cast className="w-3.5 h-3.5 text-emerald-400" />
                <span className="hidden sm:inline">Transmitir</span>
              </button>

              {onMinimize && (
                <button
                  onClick={onClose}
                  className="p-2 rounded-xl glass-panel hover:bg-white/10 text-white transition-colors"
                  aria-label="Fechar player"
                  title="Fechar"
                >
                  <X className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              )}
            </div>
          </div>

          {/* Painel Inferior de Controles + Barra de Buffer Visual via Cache IndexedDB */}
          <div
            className={`absolute bottom-0 left-0 right-0 p-4 sm:p-6 bg-gradient-to-t from-black/95 via-black/70 to-transparent flex flex-col gap-2.5 z-40 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
          >
            {/* BARRA DE PROGRESSO VISUAL DE BUFFER */}
            <div className="space-y-1">
              <div className="relative w-full group/scrubber cursor-pointer py-2.5 flex items-center">
                <div
                  className="absolute left-0 right-0 h-2 bg-zinc-600/80 rounded-full overflow-hidden pointer-events-none border border-white/10"
                  title="Cinza: segmentos pendentes · Verde: segmentos em cache"
                >
                  {idbSnapshot.segments.map((seg, index) => (
                    <div
                      key={`${seg.startByte}-${index}`}
                      className="absolute top-0 bottom-0 bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.55)] transition-all duration-200"
                      style={{
                        left: `${seg.startPercent}%`,
                        width: `${Math.max(0.4, seg.endPercent - seg.startPercent)}%`
                      }}
                    />
                  ))}
                </div>

                <div
                  className="absolute left-0 h-2 bg-white/35 rounded-l-full pointer-events-none z-10 transition-all duration-75"
                  style={{ width: `${progressPercent}%` }}
                />

                <div
                  className="absolute w-3.5 h-3.5 rounded-full bg-white ring-2 ring-emerald-400 shadow-lg pointer-events-none z-20 -translate-x-1/2 transition-transform group-hover/scrubber:scale-125"
                  style={{ left: `${progressPercent}%` }}
                />

                <input
                  type="range"
                  min={0}
                  max={totalEffectiveDuration > 0 ? totalEffectiveDuration : 100}
                  step={0.5}
                  value={currentTime}
                  onChange={handleSeek}
                  className="w-full h-4 opacity-0 cursor-pointer accent-emerald-400 relative z-30"
                  aria-label="Barra de progresso e buffer do vídeo"
                />
              </div>

              <div className="flex items-center justify-between text-[10px] font-mono text-white/60 px-0.5">
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                    Buffer carregado: {idbSnapshot.cachedPercent}% ({formatCachedBytes(idbSnapshot.cachedBytes)})
                  </span>
                  <span className="hidden sm:flex items-center gap-1.5 text-zinc-400">
                    <span className="w-2 h-2 rounded-full bg-zinc-500 inline-block" />
                    Pendente: {Math.max(0, 100 - idbSnapshot.cachedPercent)}%
                  </span>
                </div>
                <span className="hidden md:inline text-white/45">
                  Qualidade fixa {preferredQuality} · {currentTorrent.isPortugueseAudio ? 'Áudio PT-BR' : 'Áudio Original'}
                </span>
              </div>
            </div>

            {/* Linha de Botões e Informações de Reprodução */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div className="flex items-center gap-2 sm:gap-3.5 flex-wrap">
                <button
                  onClick={togglePlay}
                  className="p-2 sm:p-2.5 rounded-full bg-white hover:bg-slate-200 text-black transition-all transform active:scale-90"
                  aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
                >
                  {isPlaying ? (
                    <Pause className="w-5 h-5 fill-current" />
                  ) : (
                    <Play className="w-5 h-5 fill-current ml-0.5" />
                  )}
                </button>

                <button
                  onClick={() => skipSeconds(-10)}
                  className="p-2 text-white/70 hover:text-white transition-colors"
                  title="Voltar 10s"
                  aria-label="Voltar 10 segundos"
                >
                  <RotateCcw className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>

                <button
                  onClick={() => skipSeconds(10)}
                  className="p-2 text-white/70 hover:text-white transition-colors"
                  title="Avançar 10s"
                  aria-label="Avançar 10 segundos"
                >
                  <RotateCw className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>

                {onNextEpisode && (
                  <button
                    onClick={onNextEpisode}
                    className="p-2 text-white/70 hover:text-white transition-colors"
                    title="Próximo Episódio"
                    aria-label="Próximo Episódio"
                  >
                    <SkipForward className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>
                )}

                {/* Controle de Volume */}
                <div className="flex items-center gap-2 group/vol">
                  <button
                    onClick={toggleMute}
                    className="p-2 text-white/70 hover:text-white transition-colors"
                    aria-label={isMuted ? 'Ativar som' : 'Silenciar'}
                  >
                    {isMuted || volume === 0 ? (
                      <VolumeX className="w-4 h-4 sm:w-5 sm:h-5" />
                    ) : (
                      <Volume2 className="w-4 h-4 sm:w-5 sm:h-5" />
                    )}
                  </button>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={isMuted ? 0 : volume}
                    onChange={handleVolumeChange}
                    className="hidden sm:block w-16 md:w-20 h-1 bg-white/30 rounded-lg appearance-none cursor-pointer accent-white"
                  />
                </div>

                {/* Timestamp */}
                <div className="text-[11px] sm:text-xs font-mono text-white/85">
                  <span>{formatTime(currentTime)}</span>
                  <span className="text-white/35"> / </span>
                  <span>{formatTime(totalEffectiveDuration)}</span>
                </div>
              </div>

              {/* Lado Direito: Idioma/Áudio, 3 Qualidades Fixas, Legendas, Velocidade, PiP, Fullscreen */}
              <div className="flex items-center gap-1.5 sm:gap-2">
                {/* SELETOR DE IDIOMA / FAIXA DE ÁUDIO (PT-BR vs Original + Dual Áudio) */}
                <div className="relative">
                  <button
                    onClick={() => {
                      const next = !showAudioMenu;
                      closeAllMenus();
                      setShowAudioMenu(next);
                    }}
                    className={`px-2.5 py-1.5 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 border ${currentTorrent.isPortugueseAudio
                        ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/25'
                        : 'glass-subtle text-white/85 border-white/15 hover:bg-white/10'
                      }`}
                    title="Selecionar Idioma do Áudio (Português / Original)"
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>{currentTorrent.isPortugueseAudio ? 'PT-BR' : 'Inglês'}</span>
                  </button>

                  {showAudioMenu && (
                    <div className="absolute right-0 bottom-12 w-64 glass-dropdown rounded-2xl p-2 border border-white/15 shadow-2xl z-50 space-y-1">
                      <div className="text-[11px] font-semibold text-white/50 px-2 py-1">
                        Áudio & Dublagem
                      </div>

                      <button
                        type="button"
                        onClick={() => handleSwitchLanguageMode(true, undefined)}
                        disabled={ptAvailableCount === 0 && !currentTorrent.isPortugueseAudio}
                        className={`w-full text-left px-2.5 py-2 rounded-xl text-xs transition-colors flex items-center justify-between disabled:opacity-40 ${currentTorrent.isPortugueseAudio && audioTrackOverride === undefined
                            ? 'bg-emerald-500 text-black font-bold'
                            : 'text-white/85 hover:bg-white/10'
                          }`}
                      >
                        <span>Dublado PT-BR (Padrão)</span>
                        {currentTorrent.isPortugueseAudio && audioTrackOverride === undefined && (
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                        )}
                      </button>

                      {currentTorrent.isPortugueseAudio && (
                        <div className="pt-1 border-t border-white/10 space-y-1">
                          <div className="text-[10px] text-white/45 px-2 pt-0.5">
                            Ajuste fino Dual Áudio (MKV):
                          </div>
                          <button
                            type="button"
                            onClick={() => handleSwitchLanguageMode(true, 0)}
                            className={`w-full text-left px-2.5 py-1.5 rounded-xl text-xs transition-colors flex items-center justify-between ${audioTrackOverride === 0
                                ? 'bg-white text-black font-bold'
                                : 'text-white/75 hover:bg-white/10'
                              }`}
                          >
                            <span>Forçar Faixa 1 do arquivo</span>
                            {audioTrackOverride === 0 && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSwitchLanguageMode(true, 1)}
                            className={`w-full text-left px-2.5 py-1.5 rounded-xl text-xs transition-colors flex items-center justify-between ${audioTrackOverride === 1
                                ? 'bg-white text-black font-bold'
                                : 'text-white/75 hover:bg-white/10'
                              }`}
                          >
                            <span>Forçar Faixa 2 do arquivo</span>
                            {audioTrackOverride === 1 && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                          </button>
                        </div>
                      )}

                      <div className="pt-1 border-t border-white/10">
                        <button
                          type="button"
                          onClick={() => handleSwitchLanguageMode(false, undefined)}
                          disabled={origAvailableCount === 0 && currentTorrent.isPortugueseAudio}
                          className={`w-full text-left px-2.5 py-2 rounded-xl text-xs transition-colors flex items-center justify-between disabled:opacity-40 ${!currentTorrent.isPortugueseAudio
                              ? 'bg-white text-black font-bold'
                              : 'text-white/80 hover:bg-white/10'
                            }`}
                        >
                          <span>Original / Inglês (Legendado)</span>
                          {!currentTorrent.isPortugueseAudio && (
                            <Check className="w-3.5 h-3.5 stroke-[3]" />
                          )}
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* SELETOR DE 3 QUALIDADES FIXAS (720p · 1080p Padrão · 4K) */}
                <div className="relative">
                  <button
                    onClick={() => {
                      const next = !showQualityMenu;
                      closeAllMenus();
                      setShowQualityMenu(next);
                    }}
                    className="px-2.5 py-1.5 rounded-xl glass-subtle hover:bg-white/15 border border-white/15 text-xs font-bold text-white transition-colors flex items-center gap-1.5"
                    title="Escolher Qualidade Fixa (720p / 1080p / 4K)"
                  >
                    <SlidersHorizontal className="w-3.5 h-3.5 text-white/75" />
                    <span>{preferredQuality}</span>
                  </button>

                  {showQualityMenu && (
                    <div className="absolute right-0 bottom-12 w-68 glass-dropdown rounded-2xl p-2 border border-white/15 shadow-2xl z-50 space-y-1">
                      <div className="text-[11px] font-semibold text-white/50 px-2 py-1 flex items-center justify-between">
                        <span>Qualidade Fixa</span>
                        <span className="text-[10px] text-emerald-400 font-mono">Sem trocar seed</span>
                      </div>
                      {FIXED_QUALITY_OPTIONS.map((qOpt) => {
                        const active = preferredQuality === qOpt.id;
                        const countInLang = torrentsPool.filter(
                          (t) =>
                            t.quality === qOpt.id &&
                            t.isPortugueseAudio === currentTorrent.isPortugueseAudio
                        ).length;
                        return (
                          <button
                            key={qOpt.id}
                            type="button"
                            onClick={() => handleSelectFixedQuality(qOpt.id)}
                            disabled={countInLang === 0 && !active}
                            className={`w-full text-left px-2.5 py-2 rounded-xl text-xs transition-colors flex items-center justify-between gap-2 disabled:opacity-40 ${active
                                ? 'bg-white text-black font-bold shadow-sm'
                                : 'text-white/85 hover:bg-white/10'
                              }`}
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <span>{qOpt.label}</span>
                                <span
                                  className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${active
                                      ? 'bg-black/15 text-black'
                                      : 'bg-white/10 text-white/70'
                                    }`}
                                >
                                  {qOpt.badge}
                                </span>
                              </div>
                              <div
                                className={`text-[10px] leading-snug mt-0.5 ${active ? 'text-black/70 font-normal' : 'text-white/45'
                                  }`}
                              >
                                {qOpt.desc}
                              </div>
                            </div>
                            {active ? (
                              <Check className="w-3.5 h-3.5 shrink-0 stroke-[3]" />
                            ) : (
                              <span className="text-[10px] font-mono opacity-60 shrink-0">
                                {countInLang > 0 ? `${countInLang}` : '—'}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Toggle Modo Apenas Áudio */}
                <button
                  onClick={() => setIsAudioOnly(!isAudioOnly)}
                  className={`hidden sm:flex p-2 rounded-xl transition-colors items-center gap-1.5 text-xs font-medium ${isAudioOnly
                      ? 'bg-white text-black font-bold shadow-md'
                      : 'glass-subtle text-white/70 hover:text-white'
                    }`}
                  title="Modo Apenas Áudio"
                >
                  <Headphones className="w-4 h-4" />
                </button>

                {/* Transmitir para TV / Web Video Caster */}
                <button
                  type="button"
                  onClick={() => {
                    closeAllMenus();
                    setShowCastModal(true);
                  }}
                  className={`p-2 transition-colors cursor-pointer ${showCastModal ? 'text-emerald-400' : 'text-white/70 hover:text-white'
                    }`}
                  title="Transmitir para TV / Web Video Caster"
                  aria-label="Transmitir para TV"
                >
                  <Cast className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>

                {/* Picture-in-Picture Nativo */}
                <button
                  onClick={togglePictureInPicture}
                  className="p-2 text-white/70 hover:text-white transition-colors"
                  title="Picture-in-Picture"
                  aria-label="Picture-in-Picture"
                >
                  <PictureInPicture className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>

                {/* Seletor de Legendas (Desativadas por padrão, ancoradas na parte inferior) */}
                <div className="relative">
                  <button
                    onClick={() => {
                      const next = !showSubMenu;
                      closeAllMenus();
                      setShowSubMenu(next);
                    }}
                    className={`p-2 transition-colors ${selectedSubtitleId !== 'off'
                        ? 'text-emerald-400 font-bold'
                        : 'text-white/70 hover:text-white'
                      }`}
                    title="Legendas (Desativadas por padrão)"
                    aria-label="Menu de legendas"
                  >
                    <Subtitles className="w-4 h-4 sm:w-5 sm:h-5" />
                  </button>

                  {showSubMenu && (
                    <div className="absolute right-0 bottom-12 w-64 glass-dropdown rounded-xl p-1.5 border border-white/10 shadow-2xl z-50">
                      <div className="text-[11px] font-semibold text-white/50 px-2 py-1">Legendas</div>
                      <div className="max-h-56 overflow-y-auto space-y-0.5">
                        <button
                          onClick={() => {
                            setSelectedSubtitleId('off');
                            setShowSubMenu(false);
                          }}
                          className={`w-full text-left px-2 py-1.5 text-xs rounded-lg transition-colors ${selectedSubtitleId === 'off'
                              ? 'bg-white text-black font-bold'
                              : 'text-white/80 hover:bg-white/10'
                            }`}
                        >
                          Desativadas (Padrão)
                        </button>

                        {subtitlesLoading && (
                          <div className="flex items-center gap-2 px-2 py-2 text-xs text-white/55">
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            Buscando legendas…
                          </div>
                        )}

                        {!subtitlesLoading && subtitleTracks.length === 0 && (
                          <div className="px-2 py-2 text-xs text-white/45">Nenhuma legenda encontrada</div>
                        )}

                        {subtitleTracks.map((track) => (
                          <button
                            key={track.id}
                            onClick={() => {
                              setSelectedSubtitleId(track.id);
                              setShowSubMenu(false);
                            }}
                            title={track.release}
                            className={`w-full text-left px-2 py-1.5 text-xs rounded-lg transition-colors ${selectedSubtitleId === track.id
                                ? 'bg-white text-black font-bold'
                                : 'text-white/80 hover:bg-white/10'
                              }`}
                          >
                            {track.label}
                          </button>
                        ))}
                      </div>

                      <div className="mt-1.5 pt-1.5 border-t border-white/10 px-1">
                        <div className="text-[11px] font-semibold text-white/50 px-1 pb-1">Tamanho</div>
                        <div className="grid grid-cols-3 gap-1">
                          {(
                            [
                              ['sm', 'Pequena'],
                              ['md', 'Média'],
                              ['lg', 'Grande']
                            ] as Array<[SubtitleSize, string]>
                          ).map(([size, label]) => (
                            <button
                              key={size}
                              onClick={() => changeSubtitleSize(size)}
                              className={`py-1 rounded-lg text-[11px] transition-colors ${subtitleSize === size
                                  ? 'bg-white text-black font-bold'
                                  : 'bg-white/[0.06] text-white/75 hover:bg-white/10'
                                }`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Seletor de Velocidade */}
                <div className="relative">
                  <button
                    onClick={() => {
                      const next = !showSpeedMenu;
                      closeAllMenus();
                      setShowSpeedMenu(next);
                    }}
                    className="p-1.5 sm:p-2 text-white/70 hover:text-white transition-colors text-xs font-mono"
                    title="Velocidade de Reprodução"
                  >
                    {playbackSpeed}x
                  </button>

                  {showSpeedMenu && (
                    <div className="absolute right-0 bottom-12 w-28 glass-dropdown rounded-xl p-1.5 border border-white/10 shadow-2xl z-50">
                      {[0.75, 1, 1.25, 1.5, 2].map((spd) => (
                        <button
                          key={spd}
                          onClick={() => changeSpeed(spd)}
                          className={`w-full text-left px-2.5 py-1 text-xs rounded-lg font-mono transition-colors ${playbackSpeed === spd
                              ? 'bg-white text-black font-bold'
                              : 'text-white/80 hover:bg-white/10'
                            }`}
                        >
                          {spd}x
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Tela Cheia */}
                <button
                  onClick={toggleFullscreen}
                  className="p-2 text-white/70 hover:text-white transition-colors"
                  title="Tela Cheia"
                  aria-label="Alternar tela cheia"
                >
                  {isFullscreen ? (
                    <Minimize className="w-4 h-4 sm:w-5 sm:h-5" />
                  ) : (
                    <Maximize className="w-4 h-4 sm:w-5 sm:h-5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* MODAL COMPLETO DE TRANSMISSÃO PARA TV & OUTROS DISPOSITIVOS */}
          {showCastModal && (() => {
            const castSeekSec = Math.floor(lastKnownTimeRef.current);
            const relStreamPath = getStreamUrlForTorrent(currentTorrent, trackerPriority, {
              seekSeconds: castSeekSec > 10 ? castSeekSec : undefined,
              audioTrackIndex: audioTrackOverride
            });
            const origin =
              lanInfo?.lanOrigin ||
              (typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
            const absStreamUrl = `${origin}${relStreamPath}`;
            const absTvUrl = `${origin}/tv?src=${encodeURIComponent(relStreamPath)}&title=${encodeURIComponent(
              displayTitle
            )}&quality=${encodeURIComponent(preferredQuality)}&lang=${encodeURIComponent(
              currentTorrent.isPortugueseAudio ? 'Dublado PT-BR' : 'Original'
            )}${castSeekSec > 10 ? `&time=${castSeekSec}` : ''}`;

            const wvcCallbackHref = `wvc-x-callback://open?url=${encodeURIComponent(
              absStreamUrl
            )}&title=${encodeURIComponent(displayTitle)}`;
            const strippedStream = absStreamUrl.replace(/^https?:\/\//i, '');
            const scheme = absStreamUrl.startsWith('https') ? 'https' : 'http';
            const wvcAndroidIntentHref = `intent://${strippedStream}#Intent;package=com.instantbits.cast.webvideo;scheme=${scheme};S.title=${encodeURIComponent(
              displayTitle
            )};end`;
            const vlcHref = `vlc://${absStreamUrl}`;
            const qrImageSrc = `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&data=${encodeURIComponent(
              absTvUrl
            )}`;

            return (
              <div
                onClick={() => setShowCastModal(false)}
                className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xl animate-in fade-in duration-200"
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-2xl max-h-[90vh] overflow-y-auto glass-dropdown rounded-3xl p-5 sm:p-7 border border-white/15 shadow-2xl space-y-5 text-white"
                >
                  <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
                    <div>
                      <div className="flex items-center gap-2 text-emerald-400 text-xs font-extrabold uppercase tracking-wider">
                        <Cast className="w-4 h-4" />
                        <span>Compartilhar Tela & Stream na Rede Wi-Fi</span>
                      </div>
                      <h3 className="text-lg sm:text-xl font-extrabold mt-1">
                        Transmitir para TV ou Outro Dispositivo
                      </h3>
                      <p className="text-xs text-white/60 mt-0.5">
                        {displayTitle} · {preferredQuality} ·{' '}
                        {currentTorrent.isPortugueseAudio ? 'Dublado PT-BR' : 'Áudio Original'} · Ponto atual:{' '}
                        <span className="font-mono text-emerald-300">{formatTime(castSeekSec)}</span>
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowCastModal(false)}
                      className="p-2 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Opção 1: Web Video Caster + QR Code */}
                  <div className="p-4 rounded-2xl bg-white/[0.04] border border-emerald-500/25 flex flex-col sm:flex-row items-center gap-4">
                    <div className="w-36 h-36 rounded-2xl bg-white p-2 shrink-0 flex items-center justify-center shadow-lg">
                      <img
                        src={qrImageSrc}
                        alt="QR Code Web Video Caster e Smart TV"
                        className="w-full h-full object-contain"
                      />
                    </div>

                    <div className="flex-1 space-y-2.5 text-center sm:text-left">
                      <div className="flex items-center justify-center sm:justify-start gap-2">
                        <Smartphone className="w-4 h-4 text-emerald-400" />
                        <h4 className="text-sm font-extrabold">
                          1. Web Video Caster (Samsung, LG, Roku, Chromecast, DLNA)
                        </h4>
                      </div>
                      <p className="text-xs text-white/70 leading-relaxed">
                        No PC: aponte a câmera do celular para o <strong>QR Code</strong> e toque em{' '}
                        <strong>Transmitir no Web Video Caster</strong>. No celular: toque direto abaixo:
                      </p>
                      <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap pt-1">
                        <a
                          href={wvcCallbackHref}
                          className="px-3.5 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-extrabold text-xs inline-flex items-center gap-1.5 transition-colors"
                        >
                          <ExternalLink className="w-3.5 h-3.5" />
                          <span>Abrir Web Video Caster</span>
                        </a>
                        <a
                          href={wvcAndroidIntentHref}
                          className="px-3 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-xs inline-flex items-center gap-1.5 border border-white/15 transition-colors"
                        >
                          <span>Intent Android</span>
                        </a>
                      </div>
                    </div>
                  </div>

                  {/* Opção 2 & 3 em Grid */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {/* Chromecast / AirPlay / Miracast */}
                    <div className="p-4 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-col justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Tv className="w-4 h-4 text-sky-400" />
                          <h4 className="text-xs sm:text-sm font-extrabold">
                            2. Chromecast / AirPlay / Tela Sem Fio
                          </h4>
                        </div>
                        <p className="text-[11px] text-white/65 leading-relaxed">
                          Transmite diretamente pelo seletor nativo do navegador (Chrome/Edge/Safari) ou via espelhamento do Windows (<kbd className="px-1.5 py-0.5 rounded bg-white/15 font-mono text-[10px]">Win + K</kbd>).
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleNativeBrowserCast}
                        className="w-full py-2.5 px-3 rounded-xl bg-white text-black font-extrabold text-xs flex items-center justify-center gap-1.5 hover:bg-neutral-200 transition-colors cursor-pointer"
                      >
                        <Cast className="w-3.5 h-3.5" />
                        <span>Procurar TV no Navegador</span>
                      </button>
                    </div>

                    {/* Navegador da Smart TV / VLC */}
                    <div className="p-4 rounded-2xl bg-white/[0.04] border border-white/10 flex flex-col justify-between gap-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Wifi className="w-4 h-4 text-amber-400" />
                          <h4 className="text-xs sm:text-sm font-extrabold">
                            3. Navegador da Smart TV ou VLC
                          </h4>
                        </div>
                        <p className="text-[11px] text-white/65 leading-relaxed">
                          Mesma rede Wi-Fi ({lanInfo?.lanIp || 'LAN'}): abra o link na TV ou cole o stream direto no VLC / Kodi / WVC.
                        </p>
                      </div>

                      <div className="flex flex-col gap-1.5">
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleCopyCastText(absTvUrl, 'tv')}
                            className="flex-1 py-2 px-2.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-bold flex items-center justify-center gap-1.5 border border-white/10 cursor-pointer"
                          >
                            {copiedCastField === 'tv' ? (
                              <>
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                                <span className="text-emerald-300">Link TV Copiado!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-3.5 h-3.5" />
                                <span>Copiar Link TV</span>
                              </>
                            )}
                          </button>

                          <a
                            href={vlcHref}
                            className="py-2 px-3 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 text-amber-300 border border-amber-500/30 text-xs font-extrabold inline-flex items-center justify-center"
                          >
                            VLC
                          </a>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleCopyCastText(absStreamUrl, 'stream')}
                          className="w-full py-1.5 px-2.5 rounded-xl bg-white/[0.05] hover:bg-white/10 text-[11px] font-mono text-white/75 flex items-center justify-center gap-1.5 cursor-pointer"
                        >
                          {copiedCastField === 'stream' ? (
                            <span className="text-emerald-300 font-sans font-bold">URL Direta Copiada!</span>
                          ) : (
                            <>
                              <Copy className="w-3 h-3 shrink-0" />
                              <span className="truncate">Copiar URL Direta do Stream</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            );
          })()}
        </>
      )}
    </div>
  );
};
