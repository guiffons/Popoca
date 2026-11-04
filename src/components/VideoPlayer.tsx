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
  ArrowDown,
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
import { TorrentStatsBar } from './TorrentStatsBar.tsx';

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
  const isLikelyMkvTorrent = /\.(mkv|avi|ts|m2ts)\b/i.test(torrent.title || '');
  const isTranscodedRef = useRef<boolean>(forceTranscode || initialStartOffset > 0 || isLikelyMkvTorrent);
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
  const [showTechStats, setShowTechStats] = useState<boolean>(false);

  // FASE 3: Muxing Hibrido (Video 4K/1080p EN + Audio 720p PT-BR) e Sincronia de Audio (-2.0s a +2.0s)
  const [isHybridMode, setIsHybridMode] = useState<boolean>(false);
  const [audioSyncOffsetSec, setAudioSyncOffsetSec] = useState<number>(0);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const delayNodeRef = useRef<DelayNode | null>(null);
  const sourceNodeCreatedRef = useRef<boolean>(false);

  // Scrubber hover/touch preview time
  const [hoverTime, setHoverTime] = useState<number | null>(null);
  const [hoverPercent, setHoverPercent] = useState<number>(0);
  const scrubberRef = useRef<HTMLDivElement>(null);

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
  const [showMobileSettingsSheet, setShowMobileSettingsSheet] = useState(false);
  const [lanInfo, setLanInfo] = useState<{ lanIp: string; port: number; lanOrigin: string } | null>(null);
  const [copiedCastField, setCopiedCastField] = useState<'tv' | 'stream' | null>(null);

  // Mini Player redimensionável e arrastável estilo Netflix (alta fluidez sem lag)
  const [miniWidth, setMiniWidth] = useState<number>(() =>
    typeof window !== 'undefined' && window.innerWidth < 640 ? 190 : 340
  );
  const [miniPos, setMiniPos] = useState<{ x: number; y: number } | null>(null);
  const miniDragRef = useRef<{
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    hasMoved: boolean;
    lastX?: number;
    lastY?: number;
  } | null>(null);
  const miniResizeRef = useRef<{
    startX: number;
    origW: number;
    origLeft: number;
    origTop: number;
    currentW?: number;
    lastLeft?: number;
    lastTop?: number;
  } | null>(null);

  useEffect(() => {
    if (!isMini) return;

    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      // Redimensionamento estilo Netflix / Apple TV PiP (puxando a quina superior esquerda)
      if (miniResizeRef.current && containerRef.current) {
        if ('touches' in e && e.cancelable) e.preventDefault();
        const dx = clientX - miniResizeRef.current.startX;
        const maxW = Math.min(window.innerWidth - 16, 440);
        const targetW = Math.max(160, Math.min(maxW, miniResizeRef.current.origW - dx));
        const deltaW = targetW - miniResizeRef.current.origW;
        const newLeft = Math.max(8, miniResizeRef.current.origLeft - deltaW);
        const newTop = Math.max(56, miniResizeRef.current.origTop - Math.round((deltaW * 9) / 16));

        containerRef.current.style.width = `${targetW}px`;
        containerRef.current.style.left = `${newLeft}px`;
        containerRef.current.style.top = `${newTop}px`;
        containerRef.current.style.right = 'auto';
        containerRef.current.style.bottom = 'auto';
        miniResizeRef.current.currentW = targetW;
        miniResizeRef.current.lastLeft = newLeft;
        miniResizeRef.current.lastTop = newTop;
        return;
      }

      // Arrastar Mini Player fluido sem atraso com limites de tela estritos
      if (miniDragRef.current && containerRef.current) {
        if ('touches' in e && e.cancelable) e.preventDefault();
        const dx = clientX - miniDragRef.current.startX;
        const dy = clientY - miniDragRef.current.startY;
        if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
          miniDragRef.current.hasMoved = true;
        }
        const currentW = miniWidth;
        const currentH = Math.round((currentW * 9) / 16) + 38;
        const minX = 8;
        const maxX = Math.max(minX, window.innerWidth - currentW - 8);
        const minY = 56; // Sob a barra de navegação superior
        const maxY = Math.max(minY, window.innerHeight - currentH - 72); // Acima da barra inferior mobile

        const newX = Math.max(minX, Math.min(maxX, miniDragRef.current.origX + dx));
        const newY = Math.max(minY, Math.min(maxY, miniDragRef.current.origY + dy));

        containerRef.current.style.left = `${newX}px`;
        containerRef.current.style.top = `${newY}px`;
        containerRef.current.style.right = 'auto';
        containerRef.current.style.bottom = 'auto';
        miniDragRef.current.lastX = newX;
        miniDragRef.current.lastY = newY;
      }
    };

    const handlePointerUp = () => {
      if (
        miniDragRef.current?.hasMoved &&
        typeof miniDragRef.current.lastX === 'number' &&
        typeof miniDragRef.current.lastY === 'number'
      ) {
        setMiniPos({ x: miniDragRef.current.lastX, y: miniDragRef.current.lastY });
      }
      if (miniResizeRef.current?.currentW) {
        setMiniWidth(miniResizeRef.current.currentW);
        if (
          typeof miniResizeRef.current.lastLeft === 'number' &&
          typeof miniResizeRef.current.lastTop === 'number'
        ) {
          setMiniPos({ x: miniResizeRef.current.lastLeft, y: miniResizeRef.current.lastTop });
        }
      }
      miniDragRef.current = null;
      miniResizeRef.current = null;
    };

    window.addEventListener('mousemove', handlePointerMove, { passive: false });
    window.addEventListener('mouseup', handlePointerUp);
    window.addEventListener('touchmove', handlePointerMove, { passive: false });
    window.addEventListener('touchend', handlePointerUp);

    return () => {
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('mouseup', handlePointerUp);
      window.removeEventListener('touchmove', handlePointerMove);
      window.removeEventListener('touchend', handlePointerUp);
    };
  }, [isMini, miniWidth]);

  // Destrói imediatamente o motor torrent no backend ao desmontar o player ou trocar de torrent
  useEffect(() => {
    const activeMag = currentTorrent.magnetUri;
    return () => {
      if (activeMag) {
        api.destroyTorrent(activeMag).catch(() => {});
      }
    };
  }, [currentTorrent.magnetUri]);

  // Se o player receber um tempo inicial de retomada (ex: parar no meio do filme), dispara pré-carregamento imediato
  useEffect(() => {
    if (initialStartOffset > 0 && currentTorrent.magnetUri) {
      api.prefetchNextChunks(currentTorrent.magnetUri, initialStartOffset, authoritativeDuration).catch(() => {});
    }
  }, [initialStartOffset, currentTorrent.magnetUri, authoritativeDuration]);

  const closeAllMenus = useCallback(() => {
    setShowSpeedMenu(false);
    setShowSubMenu(false);
    setShowQualityMenu(false);
    setShowAudioMenu(false);
    setShowSourcesMenu(false);
    setShowNetworkPanel(false);
    setShowMobileSettingsSheet(false);
  }, []);

  // FASE 3: Par Hibrido disponivel (Video 1080p/4K EN + Audio 720p PT-BR)
  const hybridPair = useMemo(() => {
    const pool = torrentsPool || [];
    const pt720 = pool
      .filter((t) => t.isPortugueseAudio && t.quality === '720p' && t.magnetUri?.startsWith('magnet:?'))
      .sort((a, b) => b.seeds - a.seeds);
    const enHigh = pool
      .filter(
        (t) =>
          !t.isPortugueseAudio &&
          (t.quality === preferredQuality || t.quality === '1080p' || t.quality === '4K') &&
          t.quality !== '720p' &&
          t.magnetUri?.startsWith('magnet:?')
      )
      .sort((a, b) => b.seeds - a.seeds);

    if (pt720.length > 0 && enHigh.length > 0) {
      const sameFormatAudio = pt720.find((a) => a.format === enHigh[0].format) || pt720[0];
      return {
        videoTorrent: enHigh[0],
        audioTorrent: sameFormatAudio
      };
    }
    return null;
  }, [torrentsPool, preferredQuality]);

  // FASE 3: Web Audio API DelayNode para ajuste fino de Sincronia de Audio (-2.0s a +2.0s)
  const applyAudioSyncOffset = useCallback(
    (newOffsetSec: number) => {
      const clamped = Math.max(-2.0, Math.min(2.0, Math.round(newOffsetSec * 10) / 10));
      setAudioSyncOffsetSec(clamped);

      const v = videoRef.current;
      if (!v) return;

      try {
        if (!sourceNodeCreatedRef.current && clamped !== 0) {
          const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
          if (AudioCtx) {
            const ctx = new AudioCtx();
            const source = ctx.createMediaElementSource(v);
            const delay = ctx.createDelay(5.0);
            delay.delayTime.value = Math.max(0, clamped);
            source.connect(delay);
            delay.connect(ctx.destination);
            audioCtxRef.current = ctx;
            delayNodeRef.current = delay;
            sourceNodeCreatedRef.current = true;
          }
        } else if (delayNodeRef.current && audioCtxRef.current) {
          if (audioCtxRef.current.state === 'suspended') {
            audioCtxRef.current.resume().catch(() => {});
          }
          delayNodeRef.current.delayTime.setTargetAtTime(
            Math.max(0, clamped),
            audioCtxRef.current.currentTime,
            0.05
          );
        }
      } catch {
        // Fallback silencioso caso o navegador bloqueie MediaElementSource
      }
    },
    []
  );

  /**
   * Constroi URL de streaming respeitando estritamente o Quality Cap (Fase 2) e Fallback 720p (5s Health Check),
   * ou Muxing Hibrido (Fase 3) quando ativado.
   */
  const getStreamUrlForTorrent = useCallback(
    (
      targetTorrent: TorrentSource,
      priorityMode: TrackerPriorityMode,
      opts: {
        isRetry?: boolean;
        seekSeconds?: number;
        audioTrackIndex?: number;
        useHybrid?: boolean;
      } = {}
    ): string => {
      const useHybrid = opts.useHybrid ?? isHybridMode;
      if (useHybrid && hybridPair) {
        return (
          api.getHybridStreamUrl(hybridPair.videoTorrent.magnetUri, hybridPair.audioTorrent.magnetUri, {
            seekSeconds: opts.seekSeconds,
            audioDelayMs: audioSyncOffsetSec * 1000,
            trackerPriority: priorityMode,
            season: episode?.seasonNumber,
            episode: episode?.episodeNumber
          }) + (opts.isRetry ? `&_retry=${Date.now()}` : '')
        );
      }

      const targetStreamKey = videoChunkCache.buildStreamKey(
        targetTorrent.magnetUri || targetTorrent.directUrl || '',
        media.id,
        episode?.seasonNumber,
        episode?.episodeNumber
      );

      const pool = torrentsPool || [];
      const sameLangSameQual = pool
        .filter(
          (t) =>
            t.id !== targetTorrent.id &&
            t.quality === targetTorrent.quality &&
            t.isPortugueseAudio === targetTorrent.isPortugueseAudio &&
            t.magnetUri?.startsWith('magnet:?')
        )
        .sort((a, b) => b.seeds - a.seeds);

      const crossLangHealthySameQual = pool
        .filter(
          (t) =>
            t.id !== targetTorrent.id &&
            t.quality === targetTorrent.quality &&
            t.isPortugueseAudio !== targetTorrent.isPortugueseAudio &&
            t.seeds >= 5 &&
            t.magnetUri?.startsWith('magnet:?')
        )
        .sort((a, b) => b.seeds - a.seeds);

      // Se a fonte PT-BR tiver poucas sementes (<= 4), coloca no máximo 1 alternativa PT-BR seguida das fontes mais saudáveis
      const sameQualityAlts = (
        targetTorrent.seeds <= 4 && crossLangHealthySameQual.length > 0
          ? [...sameLangSameQual.slice(0, 1), ...crossLangHealthySameQual]
          : [...sameLangSameQual, ...crossLangHealthySameQual]
      ).map((t) => t.magnetUri);

      // Candidato de Fallback imediatamente inferior (ex: 1080p -> 720p) para o Health Check de 5s
      const lowerQualityTarget: FixedVideoQuality | null =
        targetTorrent.quality === '4K' ? '1080p' : targetTorrent.quality === '1080p' ? '720p' : null;

      const lowerQualitySameLang = lowerQualityTarget
        ? pool
            .filter(
              (t) =>
                t.quality === lowerQualityTarget &&
                t.isPortugueseAudio === targetTorrent.isPortugueseAudio &&
                t.magnetUri?.startsWith('magnet:?')
            )
            .sort((a, b) => b.seeds - a.seeds)
        : [];

      const lowerQualityAnyLang = lowerQualityTarget
        ? pool
            .filter(
              (t) =>
                t.quality === lowerQualityTarget &&
                t.isPortugueseAudio !== targetTorrent.isPortugueseAudio &&
                t.seeds >= 3 &&
                t.magnetUri?.startsWith('magnet:?')
            )
            .sort((a, b) => b.seeds - a.seeds)
        : [];

      const bestLowerFallback =
        lowerQualitySameLang[0] ||
        lowerQualityAnyLang[0] ||
        crossLangHealthySameQual[0];

      if (targetTorrent.magnetUri && targetTorrent.magnetUri.startsWith('magnet:?')) {
        return (
          api.getStreamUrl(targetTorrent.magnetUri, {
            quality: targetTorrent.quality,
            transcode: forceTranscode,
            audioOnly: false,
            altMagnets: sameQualityAlts.slice(0, 3),
            fallbackMagnet: bestLowerFallback?.magnetUri,
            fallbackQuality: bestLowerFallback?.quality,
            trackerPriority: priorityMode,
            streamKey: targetStreamKey,
            seekSeconds: opts.seekSeconds,
            preferPortugueseAudio: targetTorrent.isPortugueseAudio,
            audioTrackIndex: opts.audioTrackIndex,
            season: episode?.seasonNumber,
            episode: episode?.episodeNumber,
            fileIdx: targetTorrent.fileIdx
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
    [torrentsPool, forceTranscode, media, episode, isHybridMode, hybridPair, audioSyncOffsetSec]
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
      const isKnownMkvFile = /\.(mkv|avi|ts|m2ts)\b/i.test(
        `${targetTor.title || ''} ${liveStats?.name || ''}`
      );
      if (isKnownMkvFile) {
        isTranscodedRef.current = true;
      }
      const isProvenNativeSeekable = Boolean(
        v && Number.isFinite(v.duration) && v.duration > 30 && !isTranscodedRef.current && !isKnownMkvFile
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

  // Carrega a lista de legendas reais automaticamente em background para estarem prontas instantaneamente
  useEffect(() => {
    const fileName = liveStats?.name || '';
    const key = `${media.imdb_id || media.id || ''}|${episode?.seasonNumber || 0}|${episode?.episodeNumber || 0}|${fileName}`;
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
        if (active) setSubtitleTracks(tracks || []);
      })
      .catch(() => {
        if (active) setSubtitleTracks([]);
      })
      .finally(() => {
        if (active) setSubtitlesLoading(false);
      });
    return () => {
      active = false;
    };
  }, [liveStats?.name, media.imdb_id, media.id, media.media_type, episode?.seasonNumber, episode?.episodeNumber]);

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
        if (/\.(mkv|avi|ts|m2ts)\b/i.test(stats.name || '')) {
          isTranscodedRef.current = true;
        }
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

            // 1. Tenta candidatos da MESMA qualidade e MESMO idioma
      let candidates = torrentsPool.filter(
        (t) =>
          t.id !== currentTorrent.id &&
          t.quality === preferredQuality &&
          t.isPortugueseAudio === currentTorrent.isPortugueseAudio &&
          !failedTorrentIds.has(t.id)
      );

      // 2. Se não houver da mesma qualidade, tenta OUTRAS qualidades do MESMO idioma com seeds ativas
      if (candidates.length === 0) {
        candidates = torrentsPool.filter(
          (t) =>
            t.id !== currentTorrent.id &&
            t.isPortugueseAudio === currentTorrent.isPortugueseAudio &&
            !failedTorrentIds.has(t.id) &&
            t.seeds >= 1
        );
      }

      // 3. Força manual ou reset de falhas
      if (candidates.length === 0) {
        candidates = torrentsPool.filter(
          (t) =>
            t.id !== currentTorrent.id &&
            t.isPortugueseAudio === currentTorrent.isPortugueseAudio
        );
        if (candidates.length > 0) {
          setFailedTorrentIds(new Set());
        }
      }

      // 4. Último caso: semente em idioma Original com boas sementes
      if (candidates.length === 0) {
        candidates = torrentsPool.filter(
          (t) => t.id !== currentTorrent.id && !failedTorrentIds.has(t.id) && t.seeds >= 2
        );
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
      setPreferredQuality(nextStable.quality);
      setRetryAttempts(0);
      reconnectStreamAtTime(lastKnownTimeRef.current, true, nextStable, audioTrackOverride);

      showToastNotification(
        `Alternando para semente saudável ${nextStable.quality} ${nextStable.isPortugueseAudio ? 'Dublado PT-BR' : 'Original'} (${nextStable.seeds} seeds)...`,
        3500
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

  // Troca entre as 3 Qualidades Fixas (720p, 1080p, 4K) respeitando Quality Cap e detectando Mux Hibrido!
  const handleSelectFixedQuality = (newQuality: FixedVideoQuality) => {
    setShowQualityMenu(false);
    setPreferredQuality(newQuality);
    api.setPreferredQuality(newQuality);

    if (currentTorrent.quality === newQuality && !isHybridMode) {
      showToastNotification(`Qualidade atual já é ${newQuality}`, 2200);
      return;
    }

    // 1. Tenta encontrar fonte da mesma qualidade e mesmo idioma
    const sameLangCandidates = torrentsPool
      .filter((t) => t.quality === newQuality && t.isPortugueseAudio === currentTorrent.isPortugueseAudio)
      .sort((a, b) => b.seeds - a.seeds);

    if (sameLangCandidates.length > 0) {
      const bestTarget = sameLangCandidates[0];
      setIsHybridMode(false);
      setCurrentTorrent(bestTarget);
      setRetryAttempts(0);
      reconnectStreamAtTime(lastKnownTimeRef.current, !userPausedRef.current, bestTarget, audioTrackOverride);
      showToastNotification(
        `Qualidade definida para ${newQuality} (${bestTarget.isPortugueseAudio ? 'PT-BR' : 'Original'})`,
        2800
      );
      return;
    }

    // 2. FASE 3: Se pediu 1080p/4K com audio PT-BR mas PT-BR so existe em 720p e existe 1080p/4K EN, ativa Muxing Hibrido!
    if (currentTorrent.isPortugueseAudio && newQuality !== '720p' && hybridPair) {
      setIsHybridMode(true);
      isTranscodedRef.current = true;
      const hybridUrl = getStreamUrlForTorrent(hybridPair.videoTorrent, trackerPriority, {
        isRetry: true,
        seekSeconds: lastKnownTimeRef.current > 1.5 ? lastKnownTimeRef.current : undefined,
        useHybrid: true
      });
      setActiveVideoSrc(hybridUrl);
      setIsBuffering(true);
      showToastNotification(
        `Muxing Híbrido ativado: Vídeo ${hybridPair.videoTorrent.quality} EN + Áudio 720p PT-BR em tempo real`,
        3800
      );
      return;
    }

    // 3. Fallback estrito apenas para qualidade inferior disponivel (NUNCA sobe acima da escolhida)
    const lowerQualities: FixedVideoQuality[] =
      newQuality === '4K' ? ['1080p', '720p'] : newQuality === '1080p' ? ['720p'] : [];

    for (const lq of lowerQualities) {
      const lowerMatches = torrentsPool
        .filter((t) => t.quality === lq && t.isPortugueseAudio === currentTorrent.isPortugueseAudio)
        .sort((a, b) => b.seeds - a.seeds);
      if (lowerMatches.length > 0) {
        const bestLower = lowerMatches[0];
        setIsHybridMode(false);
        setCurrentTorrent(bestLower);
        setPreferredQuality(bestLower.quality);
        setRetryAttempts(0);
        reconnectStreamAtTime(lastKnownTimeRef.current, !userPausedRef.current, bestLower, audioTrackOverride);
        showToastNotification(`Conexão ajustada para ${bestLower.quality} para reprodução imediata`, 3500);
        return;
      }
    }

    showToastNotification(`Nenhuma fonte ${newQuality} disponível para este título.`, 3000);
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
          tmdbId: media.id,
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

  // FASE 2: Health Check de qualidade escolhida no cold start (sem interromper streams que já encontraram peers)
  useEffect(() => {
    if (!isBuffering || playbackError || !currentTorrent.magnetUri) return;

    const healthCheckTimer = setTimeout(() => {
      const hasZeroPeersAndSpeed =
        !liveStats || (liveStats.downloadSpeed < 8 * 1024 && liveStats.numPeers === 0);

      if (
        lastKnownTimeRef.current < 1.5 &&
        isBuffering &&
        hasZeroPeersAndSpeed &&
        currentTorrent.quality !== '720p'
      ) {
        const targetLower: FixedVideoQuality = currentTorrent.quality === '4K' ? '1080p' : '720p';
        const lowerCandidates = torrentsPool
          .filter(
            (t) =>
              (t.quality === targetLower || t.quality === '720p') &&
              t.isPortugueseAudio === currentTorrent.isPortugueseAudio &&
              t.seeds >= 1
          )
          .sort((a, b) => b.seeds - a.seeds);

        if (lowerCandidates.length > 0) {
          const downgraded = lowerCandidates[0];
          setIsHybridMode(false);
          setCurrentTorrent(downgraded);
          setPreferredQuality(downgraded.quality);
          setRetryAttempts(0);
          reconnectStreamAtTime(lastKnownTimeRef.current, true, downgraded, audioTrackOverride);
          showToastNotification(
            `Conexão ajustada para ${downgraded.quality} para reprodução imediata`,
            4500
          );
          return;
        }
      }

      if (
        lastKnownTimeRef.current < 1.5 &&
        isBuffering &&
        hasZeroPeersAndSpeed &&
        torrentsPool.length > 1
      ) {
        switchToNextStableSameQualitySeed(false);
      }
    }, 9500);

    return () => clearTimeout(healthCheckTimer);
  }, [
    isBuffering,
    playbackError,
    currentTorrent,
    liveStats,
    torrentsPool,
    audioTrackOverride,
    reconnectStreamAtTime,
    showToastNotification,
    switchToNextStableSameQualitySeed
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

  const isColdStartBuffering =
    isBuffering &&
    lastKnownTimeRef.current < 1 &&
    (!videoRef.current || videoRef.current.readyState === 0);

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
      setRetryAttempts(0);
      setPlaybackError(null);

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

      // 3. Caso contrário em MKV: antecipa a janela de peças P2P e reposiciona o FFmpeg após o debounce do arraste!
      if (debounceMs > 0) {
        seekDebounceTimerRef.current = setTimeout(() => {
          if (currentTorrent.magnetUri?.startsWith('magnet:?')) {
            api.prefetchNextChunks(currentTorrent.magnetUri, target, curDur).catch(() => { });
          }
          reconnectStreamAtTime(target, !userPausedRef.current);
        }, debounceMs);
      } else {
        setIsBuffering(true);
        if (currentTorrent.magnetUri?.startsWith('magnet:?')) {
          api.prefetchNextChunks(currentTorrent.magnetUri, target, curDur).catch(() => { });
        }
        reconnectStreamAtTime(target, !userPausedRef.current);
      }
    },
    [duration, authoritativeDuration, isTimeCachedInIndexedDB, reconnectStreamAtTime, currentTorrent.magnetUri]
  );

  const skipSeconds = (seconds: number) => {
    if (isColdStartBuffering) {
      triggerHud('Aguarde o carregamento inicial', 'pause');
      return;
    }
    seekToEffectiveTime(lastKnownTimeRef.current + seconds, 0);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isColdStartBuffering) return;
    const time = parseFloat(e.target.value);
    const v = videoRef.current;
    const needsDebouncedServerSeek =
      isTranscodedRef.current || !(v && Number.isFinite(v.duration) && v.duration > 30);
    seekToEffectiveTime(time, needsDebouncedServerSeek ? 240 : 0);
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
        case 'KeyI':
          e.preventDefault();
          setShowTechStats((prev) => {
            const next = !prev;
            triggerHud(next ? 'Telemetria P2P Ativada' : 'Telemetria Desativada', 'activity');
            return next;
          });
          break;
        default:
          if (e.key >= '0' && e.key <= '9') {
            e.preventDefault();
            if (isBuffering) {
              triggerHud('Aguarde o carregamento', 'pause');
              break;
            }
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
      style={
        isMini
          ? {
            width: `${miniWidth}px`,
            left: miniPos ? `${miniPos.x}px` : undefined,
            top: miniPos ? `${miniPos.y}px` : undefined,
            right: miniPos ? 'auto' : undefined,
            bottom: miniPos ? 'auto' : undefined,
            touchAction: 'none'
          }
          : undefined
      }
      className={
        isMini
          ? `dark fixed z-[70] ${miniPos ? '' : 'right-3 bottom-[96px] md:right-6 md:bottom-6'} rounded-2xl overflow-hidden bg-black text-white select-none shadow-[0_24px_60px_rgba(0,0,0,0.75)] ring-1 ring-white/20 group/mini touch-none`
          : 'dark fixed inset-0 z-50 bg-black text-white flex items-center justify-center select-none overflow-hidden'
      }
    >
      {/* Indicador Tatil HUD de Atalhos de Teclado e Gestos Touch */}
      {hudFeedback && !isMini && (
        <div
          key={hudFeedback.key}
          className="pointer-events-none absolute inset-0 z-50 flex items-center justify-center"
        >
          <div className="liquid-glass px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-3 text-white">
            {hudFeedback.icon === 'forward' && <RotateCw className="w-5 h-5 text-white" />}
            {hudFeedback.icon === 'replay' && <RotateCcw className="w-5 h-5 text-white" />}
            {hudFeedback.icon === 'volume' && <Volume2 className="w-5 h-5 text-white" />}
            {hudFeedback.icon === 'mute' && <VolumeX className="w-5 h-5 text-white/70" />}
            {hudFeedback.icon === 'fullscreen' && <Maximize className="w-5 h-5 text-white" />}
            {hudFeedback.icon === 'subtitles' && <Subtitles className="w-5 h-5 text-white" />}
            {hudFeedback.icon === 'play' && <Play className="w-5 h-5 fill-current text-white" />}
            {hudFeedback.icon === 'pause' && <Pause className="w-5 h-5 fill-current text-white" />}
            <span className="text-sm font-extrabold tracking-wide">{hudFeedback.text}</span>
          </div>
        </div>
      )}

      {/* Aviso em Liquid Glass (Downgrade de Qualidade 5s / Rede / Idioma) */}
      {failoverToast && !isMini && (
        <div className="absolute top-20 z-50 liquid-glass px-4 py-2.5 rounded-2xl shadow-2xl flex items-center gap-2.5 text-xs font-semibold text-white max-w-lg text-center">
          <Zap className="w-4 h-4 text-white shrink-0 animate-pulse" />
          <span>{failoverToast}</span>
        </div>
      )}


      {/* Vídeo HTML5 Principal */}
      <video
        ref={videoRef}
        src={activeVideoSrc}
        playsInline
        // @ts-ignore
        webkit-playsinline="true"
        // @ts-ignore
        x-webkit-airplay="allow"
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
          setRetryAttempts(0);
          setPlaybackError(null);
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
        onStalled={() => setIsBuffering(true)}
        onSuspend={() => {
          if (videoRef.current && videoRef.current.readyState >= 3) {
            setIsBuffering(false);
          }
        }}
        onPlaying={() => {
          setIsBuffering(false);
          setRetryAttempts(0);
          setPlaybackError(null);
        }}
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
          if (retryAttempts < 4) {
            setRetryAttempts((prev) => prev + 1);
            setIsBuffering(true);
            if (currentTorrent.magnetUri) {
              api.retryTorrentPeers(currentTorrent.magnetUri, trackerPriority).catch(() => { });
            }
            setTimeout(() => {
              reconnectStreamAtTime(savedPos, !userPausedRef.current);
            }, 1800);
            return;
          }

          // 2. Se após 4 tentativas a semente atual ainda falhar, tenta automaticamente a próxima semente ativa da mesma qualidade/idioma mantendo o minuto exato!
          const switchedSameQuality = switchToNextStableSameQualitySeed(false);
          if (switchedSameQuality) return;

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

      {/* Mini Player flutuante redimensionável e arrastável estilo Netflix */}
      {isMini && (
        <>
          {/* Único Handle de Redimensionamento na Quina Superior Esquerda Estilo Apple/Netflix */}
          <div
            onMouseDown={(e) => {
              e.stopPropagation();
              const rect = containerRef.current?.getBoundingClientRect();
              if (rect) {
                miniResizeRef.current = {
                  startX: e.clientX,
                  origW: rect.width,
                  origLeft: rect.left,
                  origTop: rect.top
                };
              }
            }}
            onTouchStart={(e) => {
              e.stopPropagation();
              const rect = containerRef.current?.getBoundingClientRect();
              if (rect) {
                miniResizeRef.current = {
                  startX: e.touches[0].clientX,
                  origW: rect.width,
                  origLeft: rect.left,
                  origTop: rect.top
                };
              }
            }}
            className="absolute top-0 left-0 w-8 h-8 z-50 cursor-nwse-resize flex items-start justify-start p-1.5 text-white/80 hover:text-white transition-colors touch-none group/handle select-none"
            title="Arraste na quina para redimensionar o mini player"
            aria-label="Redimensionar mini player"
          >
            <div className="w-3 h-3 border-t-2 border-l-2 border-white/90 rounded-tl shadow-md group-hover/handle:scale-110 transition-transform" />
          </div>

          <div
            onMouseDown={(e) => {
              const target = e.target as HTMLElement;
              if (target.closest('button')) return;
              const rect = containerRef.current?.getBoundingClientRect();
              if (rect) {
                miniDragRef.current = {
                  startX: e.clientX,
                  startY: e.clientY,
                  origX: rect.left,
                  origY: rect.top,
                  hasMoved: false,
                  lastX: rect.left,
                  lastY: rect.top
                };
              }
            }}
            onTouchStart={(e) => {
              const target = e.target as HTMLElement;
              if (target.closest('button')) return;
              const rect = containerRef.current?.getBoundingClientRect();
              if (rect) {
                miniDragRef.current = {
                  startX: e.touches[0].clientX,
                  startY: e.touches[0].clientY,
                  origX: rect.left,
                  origY: rect.top,
                  hasMoved: false,
                  lastX: rect.left,
                  lastY: rect.top
                };
              }
            }}
            className="absolute inset-x-0 top-0 aspect-video cursor-move select-none touch-none"
          >
            {isBuffering && !playbackError && (
              <div className="absolute inset-0 flex items-center justify-center bg-black/35 pointer-events-none">
                <Loader2 className="w-6 h-6 text-white/90 animate-spin" />
              </div>
            )}
            {playbackError && (
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-1.5 bg-black/75 px-3 text-center">
                <span className="text-[10px] font-semibold text-white/90">Pausado em {formatTime(currentTime)}</span>
                <button
                  type="button"
                  onClick={() => reconnectStreamAtTime(lastKnownTimeRef.current, true)}
                  className="px-2.5 py-1 rounded-full bg-white text-black text-[10px] font-bold"
                >
                  Continuar
                </button>
              </div>
            )}

            <div
              onClick={() => {
                if (!miniDragRef.current?.hasMoved) {
                  onExpand?.();
                }
              }}
              className="absolute inset-0 cursor-pointer bg-gradient-to-b from-black/55 via-transparent to-black/45 opacity-0 group-hover/mini:opacity-100 transition-opacity duration-200 flex items-center justify-center"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  togglePlay();
                }}
                className="w-10 h-10 rounded-full bg-white/25 hover:bg-white/35 backdrop-blur-md border border-white/25 flex items-center justify-center transition-transform active:scale-90"
                aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
              >
                {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onExpand?.();
                }}
                className="absolute top-2 left-9 p-1 rounded-full bg-black/45 hover:bg-black/70 backdrop-blur-md transition-colors"
                aria-label="Expandir player"
                title="Expandir"
              >
                <Maximize2 className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose();
                }}
                className="absolute top-2 right-2 p-1 rounded-full bg-black/45 hover:bg-black/70 backdrop-blur-md transition-colors"
                aria-label="Fechar player"
                title="Fechar"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="absolute bottom-0 inset-x-0 h-[3px] bg-white/20 pointer-events-none">
              <div className="h-full bg-white transition-[width] duration-200" style={{ width: `${progressPercent}%` }} />
            </div>
          </div>

          <div
            onMouseDown={(e) => {
              const target = e.target as HTMLElement;
              if (target.closest('button')) return;
              const rect = containerRef.current?.getBoundingClientRect();
              if (rect) {
                miniDragRef.current = {
                  startX: e.clientX,
                  startY: e.clientY,
                  origX: rect.left,
                  origY: rect.top,
                  hasMoved: false,
                  lastX: rect.left,
                  lastY: rect.top
                };
              }
            }}
            onTouchStart={(e) => {
              const target = e.target as HTMLElement;
              if (target.closest('button')) return;
              const rect = containerRef.current?.getBoundingClientRect();
              if (rect) {
                miniDragRef.current = {
                  startX: e.touches[0].clientX,
                  startY: e.touches[0].clientY,
                  origX: rect.left,
                  origY: rect.top,
                  hasMoved: false,
                  lastX: rect.left,
                  lastY: rect.top
                };
              }
            }}
            className="flex items-center gap-2 pl-2.5 pr-1.5 py-1.5 bg-[#0D1016] cursor-move select-none touch-none"
          >
            <button
              type="button"
              onClick={() => {
                if (!miniDragRef.current?.hasMoved) {
                  onExpand?.();
                }
              }}
              className="min-w-0 flex-1 text-left"
            >
              <p className="text-[11px] sm:text-xs font-semibold text-white truncate">{media.title}</p>
              <p className="text-[9px] sm:text-[10px] text-white/55 truncate">
                {episode
                  ? `T${episode.seasonNumber} · E${episode.episodeNumber}`
                  : `${currentTorrent.quality} · ${currentTorrent.isPortugueseAudio ? 'PT-BR' : 'Orig'}`}
              </p>
            </button>
            <button
              type="button"
              onClick={togglePlay}
              className="p-1.5 rounded-full hover:bg-white/10 transition-colors shrink-0"
              aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
            >
              {isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-full hover:bg-white/10 transition-colors shrink-0"
              aria-label="Fechar player"
            >
              <X className="w-3.5 h-3.5" />
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

          {/* Indicador de Buffering Estagiado */}
          {isBuffering && !playbackError && (
            <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/55 backdrop-blur-sm pointer-events-none z-30 animate-in fade-in duration-200">
              <div className="w-12 h-12 rounded-full border-2 border-white/20 border-t-white animate-spin mb-3.5 shadow-2xl" />
              <span className="text-sm font-bold text-white/95 tracking-wide">
                {connectedPeersCount === 0
                  ? 'Conectando ao enxame P2P…'
                  : (!duration || duration <= 0) && currentTime < 1
                  ? 'Buscando metadados e índice do vídeo…'
                  : currentTime > 3
                  ? `Sincronizando em ${formatTime(currentTime)}…`
                  : 'Carregando peças iniciais do vídeo…'}
              </span>
              <div className="flex items-center gap-2 text-xs font-mono text-white/70 mt-2 bg-black/50 px-3.5 py-1.5 rounded-full border border-white/10 shadow-lg">
                <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                  <ArrowDown className="w-3.5 h-3.5" />
                  {formatTransferSpeed(currentTransferSpeed)}
                </span>
                <span className="text-white/30">·</span>
                <span className="flex items-center gap-1 text-white/80">
                  <Users className="w-3.5 h-3.5 text-white/50" />
                  {connectedPeersCount} peers
                </span>
                {liveStats?.trackerPriority && (
                  <>
                    <span className="text-white/30">·</span>
                    <span className="text-white/60 text-[10px] uppercase">
                      {liveStats.trackerPriority === 'pt-br-stability' ? 'PT-BR' : liveStats.trackerPriority === 'ultra-speed' ? 'Ultra' : 'Global'}
                    </span>
                  </>
                )}
              </div>
            </div>
          )}

          {/* HUD Flutuante de Telemetria P2P */}
          {showTechStats && (
            <div
              onClick={(e) => e.stopPropagation()}
              className="absolute top-16 sm:top-20 right-3 sm:right-6 z-50 animate-in fade-in slide-in-from-top-2 duration-200 max-w-[92vw] sm:max-w-md"
            >
              <TorrentStatsBar
                stats={liveStats}
                magnetUri={currentTorrent.magnetUri}
                isTranscoded={isTranscodedRef.current}
                onClose={() => setShowTechStats(false)}
              />
            </div>
          )}

          {/* Diálogo de Recuperação sem Perder o Ponto do Filme */}
          {playbackError && (
            <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/75">
              <div className="max-w-md w-full liquid-glass-heavy p-6 rounded-2xl text-center space-y-4 shadow-2xl">
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
                  <div className="text-left space-y-1.5 max-h-40 overflow-y-auto no-scrollbar pr-1">
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
                              <span className="text-[10px] text-white/90 font-bold">Dublado PT-BR</span>
                            ) : (
                              <span className="text-[10px] text-white/50">Original</span>
                            )}
                            <span className="text-[10px] text-white/40 truncate">{alt.source}</span>
                          </div>
                          <span className="text-[10px] text-white/80 font-mono shrink-0">
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
                      handleManualNetworkRetry(true);
                    }}
                    className="flex-1 py-2.5 px-4 bg-white hover:bg-neutral-200 text-black font-extrabold text-xs rounded-xl shadow-md transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
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

          {/* Painel Superior de Controles Estilo Apple TV Liquid Glass */}
          <div
            className={`absolute top-0 left-0 right-0 p-3 sm:p-6 bg-gradient-to-b from-black/80 via-black/30 to-transparent flex items-center justify-between z-40 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
          >
            {/* Lado Esquerdo: Fechar (X) e Picture-in-Picture */}
            <div className="flex items-center gap-2 sm:gap-3">
              <button
                onClick={onClose}
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-xl border border-white/20 text-white flex items-center justify-center transition-all cursor-pointer"
                aria-label="Fechar"
                title="Fechar"
              >
                <X className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>

              <button
                onClick={togglePictureInPicture}
                className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-xl border border-white/20 text-white flex items-center justify-center transition-all cursor-pointer"
                aria-label="Picture-in-Picture"
                title="Picture-in-Picture"
              >
                <PictureInPicture className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>

              {onMinimize && (
                <button
                  onClick={handleMinimize}
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-full bg-black/40 hover:bg-black/60 backdrop-blur-xl border border-white/20 text-white flex items-center justify-center transition-all cursor-pointer"
                  aria-label="Minimizar para mini player"
                  title="Minimizar e continuar navegando"
                >
                  <ChevronDown className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              )}
            </div>

            {/* Lado Direito: Slider de Volume Apple TV */}
            <div className="flex items-center gap-2 sm:gap-3 shrink-0">
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-black/40 hover:bg-black/60 border border-white/20 backdrop-blur-xl transition-all">
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={isMuted ? 0 : volume}
                  onChange={handleVolumeChange}
                  className="w-16 sm:w-28 h-1 bg-white/30 rounded-lg appearance-none cursor-pointer accent-white"
                  aria-label="Volume"
                />
                <button
                  onClick={toggleMute}
                  className="text-white hover:text-white/80 transition-colors cursor-pointer"
                  aria-label={isMuted ? 'Ativar som' : 'Silenciar'}
                >
                  {isMuted || volume === 0 ? (
                    <VolumeX className="w-4 h-4 sm:w-5 sm:h-5" />
                  ) : (
                    <Volume2 className="w-4 h-4 sm:w-5 sm:h-5" />
                  )}
                </button>
              </div>
            </div>
          </div>

          {/* CONTROLES CENTRAIS APPLE TV (10 - || - 10) */}
          <div
            className={`absolute inset-0 pointer-events-none flex items-center justify-center gap-8 sm:gap-14 z-30 transition-opacity duration-300 ${showControls && !isBuffering && !playbackError ? 'opacity-100' : 'opacity-0'
              }`}
          >
            {/* Retroceder 10 segundos Apple TV */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                skipSeconds(-10);
                triggerHud('-10s', 'replay');
              }}
              className="pointer-events-auto p-2 text-white/90 hover:text-white active:scale-90 transition-all cursor-pointer flex items-center justify-center"
              aria-label="Voltar 10 segundos"
              title="Voltar 10s"
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-11 h-11 sm:w-14 sm:h-14">
                <path
                  d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M3 3v5h5"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M8.2 11.2 L9.6 10.2 V16.2 M8.2 16.2 H11"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <rect
                  x="12.6"
                  y="10.2"
                  width="4.4"
                  height="6"
                  rx="2.2"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
              </svg>
            </button>

            {/* Play / Pause Principal Apple TV */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                togglePlay();
              }}
              className="pointer-events-auto p-3 text-white hover:scale-105 active:scale-95 transition-all cursor-pointer flex items-center justify-center"
              aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
              title={isPlaying ? 'Pausar' : 'Reproduzir'}
            >
              {isPlaying ? (
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-12 h-12 sm:w-16 sm:h-16">
                  <rect x="5" y="4" width="4.5" height="16" rx="1.5" />
                  <rect x="14.5" y="4" width="4.5" height="16" rx="1.5" />
                </svg>
              ) : (
                <svg viewBox="0 0 24 24" fill="currentColor" className="w-12 h-12 sm:w-16 sm:h-16 ml-1">
                  <polygon points="6,4 20,12 6,20" />
                </svg>
              )}
            </button>

            {/* Avançar 10 segundos Apple TV */}
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                skipSeconds(10);
                triggerHud('+10s', 'forward');
              }}
              className="pointer-events-auto p-2 text-white/90 hover:text-white active:scale-90 transition-all cursor-pointer flex items-center justify-center"
              aria-label="Avançar 10 segundos"
              title="Avançar 10s"
            >
              <svg viewBox="0 0 24 24" fill="none" className="w-11 h-11 sm:w-14 sm:h-14">
                <path
                  d="M21 12a9 9 0 1 1-9-9c2.52 0 4.85.99 6.74 2.74L21 8"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M21 3v5h-5"
                  stroke="currentColor"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M8.2 11.2 L9.6 10.2 V16.2 M8.2 16.2 H11"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <rect
                  x="12.6"
                  y="10.2"
                  width="4.4"
                  height="6"
                  rx="2.2"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
              </svg>
            </button>
          </div>

          {/* Painel Inferior de Controles Apple TV Liquid Glass */}
          <div
            className={`absolute bottom-0 left-0 right-0 p-4 sm:p-7 bg-gradient-to-t from-black/95 via-black/60 to-transparent flex flex-col gap-2 z-40 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
              }`}
          >
            {/* Título & Informações do Filme/Episódio (Sem botão gigante por cima!) */}
            <div className="min-w-0 flex-1 mb-1">
              {episode ? (
                <>
                  <p className="text-xs sm:text-sm font-medium text-white/70 truncate">
                    {media.title}: Temporada {episode.seasonNumber}
                  </p>
                  <h2 className="text-base sm:text-2xl font-extrabold text-white tracking-tight truncate mt-0.5">
                    {episode.title || `Episódio ${episode.episodeNumber}`}
                  </h2>
                </>
              ) : (
                <>
                  <p className="text-xs sm:text-sm font-medium text-white/70 truncate">
                    {media.release_date ? media.release_date.slice(0, 4) : 'Popoca'} · {currentTorrent.quality}
                  </p>
                  <h2 className="text-base sm:text-2xl font-extrabold text-white tracking-tight truncate mt-0.5">
                    {media.title}
                  </h2>
                </>
              )}
            </div>

            {/* Scrubber Apple TV Liquid Glass Fluido (Sem brilho estourado, sem lag, com preview de minutos/segundos no hover/toque e bloqueio durante carregamento) */}
            <div
              ref={scrubberRef}
              onMouseMove={(e) => {
                if (!scrubberRef.current) return;
                const rect = scrubberRef.current.getBoundingClientRect();
                const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
                setHoverPercent(pct * 100);
                setHoverTime(pct * totalEffectiveDuration);
              }}
              onMouseLeave={() => setHoverTime(null)}
              onTouchMove={(e) => {
                if (!scrubberRef.current || e.touches.length === 0) return;
                const rect = scrubberRef.current.getBoundingClientRect();
                const pct = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / Math.max(1, rect.width)));
                setHoverPercent(pct * 100);
                setHoverTime(pct * totalEffectiveDuration);
              }}
              onTouchEnd={() => setHoverTime(null)}
              className={`relative w-full group/scrubber py-3 flex items-center touch-none select-none ${
                isColdStartBuffering ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'
              }`}
            >
              {/* Tooltip em Liquid Glass mostrando exatamente os minutos/segundos ao passar o dedo/mouse */}
              {hoverTime !== null && (
                <div
                  style={{
                    left: `${Math.max(4, Math.min(96, hoverPercent))}%`,
                    transform: 'translate3d(-50%, 0, 0)'
                  }}
                  className="pointer-events-none absolute -top-9 z-40 liquid-glass px-2.5 py-1 rounded-lg text-[11px] font-mono font-bold text-white whitespace-nowrap shadow-lg"
                >
                  {formatTime(hoverTime)}
                  {isColdStartBuffering ? ' · Carregando' : ''}
                </div>
              )}

              {/* Trilho de Fundo em Liquid Glass Suave */}
              <div className="relative w-full h-1.5 group-hover/scrubber:h-2 bg-white/15 rounded-full overflow-hidden pointer-events-none transition-[height] duration-150">
                {/* Segmentos de Buffer Carregados */}
                {idbSnapshot.segments.map((seg, index) => (
                  <div
                    key={`${seg.startByte}-${index}`}
                    className="absolute top-0 bottom-0 bg-white/30"
                    style={{
                      left: `${seg.startPercent}%`,
                      width: `${Math.max(0.4, seg.endPercent - seg.startPercent)}%`
                    }}
                  />
                ))}

                {/* Barra de Progresso Principal Animada com GPU Compositing (Sem lag e sem brilho feio) */}
                <div
                  className="absolute top-0 bottom-0 left-0 bg-white rounded-full transition-[width] duration-150 ease-out will-change-[width]"
                  style={{
                    width: `${progressPercent}%`,
                    transform: 'translate3d(0, 0, 0)'
                  }}
                />
              </div>

              {/* Indicador Circular Discreto */}
              <div
                className="absolute w-3 h-3 rounded-full bg-white border border-black/30 shadow-md pointer-events-none z-20 -translate-x-1/2 scale-90 group-hover/scrubber:scale-110 transition-transform duration-150"
                style={{
                  left: `${progressPercent}%`,
                  transform: 'translate3d(-50%, 0, 0)'
                }}
              />

              <input
                type="range"
                min={0}
                max={totalEffectiveDuration > 0 ? totalEffectiveDuration : 100}
                step={0.5}
                value={currentTime}
                disabled={isColdStartBuffering}
                onChange={handleSeek}
                className={`w-full h-8 -top-1 opacity-0 absolute inset-0 z-30 ${
                  isColdStartBuffering ? 'cursor-not-allowed' : 'cursor-pointer'
                }`}
                aria-label="Barra de progresso"
              />
            </div>

            {/* Linha Inferior de Horarios & Acoes (Com botoes de Legendas e Qualidade SEPARADOS) */}
            <div className="relative flex items-center justify-between text-xs sm:text-[13px] font-mono text-white/80 px-0.5">
              <span>{formatTime(currentTime)}</span>

              {/* Menu Popover Exclusivo de Legendas & Audio */}
              {showSubMenu && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute bottom-11 right-16 sm:right-28 z-50 w-72 liquid-glass-heavy rounded-2xl p-4 shadow-2xl text-white font-sans space-y-3 animate-in fade-in zoom-in-95 duration-150"
                >
                  <div className="flex items-center justify-between border-b border-white/10 pb-2">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-white/90">
                      Legendas & Idioma
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowSubMenu(false)}
                      className="p-1 rounded-full hover:bg-white/10 text-white/70 hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  <div className="space-y-1.5">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">
                      Áudio Principal
                    </span>
                    <div className="grid grid-cols-2 gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleSwitchLanguageMode(true, undefined)}
                        className={`py-1.5 px-2.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                          currentTorrent.isPortugueseAudio
                            ? 'bg-white text-black border-white'
                            : 'bg-white/5 text-white/80 border-white/10 hover:bg-white/10'
                        }`}
                      >
                        Dublado PT-BR
                      </button>
                      <button
                        type="button"
                        onClick={() => handleSwitchLanguageMode(false, undefined)}
                        className={`py-1.5 px-2.5 rounded-xl text-xs font-bold border transition-colors cursor-pointer ${
                          !currentTorrent.isPortugueseAudio
                            ? 'bg-white text-black border-white'
                            : 'bg-white/5 text-white/80 border-white/10 hover:bg-white/10'
                        }`}
                      >
                        Original / EN
                      </button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-white/50">
                        Faixas de Legenda
                      </span>
                      {subtitlesLoading && (
                        <span className="text-[10px] text-white/50 flex items-center gap-1">
                          <Loader2 className="w-3 h-3 animate-spin" /> Buscando
                        </span>
                      )}
                    </div>
                    <div className="space-y-1 max-h-36 overflow-y-auto no-scrollbar pr-1">
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSubtitleId('off');
                          setShowSubMenu(false);
                        }}
                        className={`w-full text-left py-1.5 px-2.5 rounded-lg text-xs border transition-colors cursor-pointer ${
                          selectedSubtitleId === 'off'
                            ? 'bg-white text-black font-bold border-white'
                            : 'bg-white/5 text-white/80 border-white/10 hover:bg-white/10'
                        }`}
                      >
                        Desativadas
                      </button>
                      {subtitleTracks.map((tr) => (
                        <button
                          key={tr.id}
                          type="button"
                          onClick={() => {
                            setSelectedSubtitleId(tr.id);
                            setShowSubMenu(false);
                          }}
                          className={`w-full text-left py-1.5 px-2.5 rounded-lg text-xs border transition-colors cursor-pointer ${
                            selectedSubtitleId === tr.id
                              ? 'bg-white text-black font-bold border-white'
                              : 'bg-white/5 text-white/80 border-white/10 hover:bg-white/10'
                          }`}
                        >
                          {tr.label}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {/* Menu Popover Exclusivo de Qualidade (Separado de Legendas!) */}
              {showQualityMenu && (
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="absolute bottom-11 right-8 sm:right-16 z-50 w-64 liquid-glass-heavy rounded-2xl p-4 shadow-2xl text-white font-sans space-y-2.5 animate-in fade-in zoom-in-95 duration-150"
                >
                  <div className="flex items-center justify-between border-b border-white/10 pb-2">
                    <span className="text-xs font-extrabold uppercase tracking-wider text-white/90">
                      Resolução (Quality Cap)
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowQualityMenu(false)}
                      className="p-1 rounded-full hover:bg-white/10 text-white/70 hover:text-white cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <div className="space-y-1.5">
                    {FIXED_QUALITY_OPTIONS.map((q) => (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => handleSelectFixedQuality(q.id)}
                        className={`w-full py-2 px-3 rounded-xl text-xs font-bold border transition-colors flex items-center justify-between cursor-pointer ${
                          preferredQuality === q.id
                            ? 'bg-white text-black border-white shadow-sm'
                            : 'bg-white/5 text-white/80 border-white/10 hover:bg-white/10'
                        }`}
                      >
                        <span>{q.label}</span>
                        <span className="text-[10px] opacity-80">{q.badge}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 sm:gap-2.5 font-sans">
                {/* Botao Dedicado de Legendas (Separado do de Qualidade) */}
                <button
                  type="button"
                  onClick={() => {
                    const next = !showSubMenu;
                    closeAllMenus();
                    setShowSubMenu(next);
                  }}
                  className={`px-2.5 py-1 rounded-full text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                    showSubMenu || selectedSubtitleId !== 'off'
                      ? 'bg-white text-black'
                      : 'liquid-glass text-white/85 hover:text-white'
                  }`}
                  title="Legendas e Áudio"
                  aria-label="Legendas e Áudio"
                >
                  <Subtitles className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Legendas</span>
                </button>

                {/* Botao Dedicado de Qualidade (Separado do de Legendas) */}
                <button
                  type="button"
                  onClick={() => {
                    const next = !showQualityMenu;
                    closeAllMenus();
                    setShowQualityMenu(next);
                  }}
                  className={`px-2.5 py-1 rounded-full text-xs font-extrabold flex items-center gap-1 transition-colors cursor-pointer ${
                    showQualityMenu
                      ? 'bg-white text-black'
                      : 'liquid-glass text-white/90 hover:text-white'
                  }`}
                  title="Selecionar Qualidade de Vídeo"
                  aria-label="Qualidade de Vídeo"
                >
                  <Layers className="w-3.5 h-3.5" />
                  <span>{isHybridMode ? `${preferredQuality} Hybrid` : preferredQuality}</span>
                </button>

                {/* Ajustes Avancados (Sincronia de Audio, Velocidade, Mux Hibrido) */}
                <button
                  type="button"
                  onClick={() => {
                    closeAllMenus();
                    setShowMobileSettingsSheet(true);
                  }}
                  className="p-1.5 rounded-full text-white/75 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  title="Ajustes Avançados e Sincronia de Áudio"
                  aria-label="Ajustes"
                >
                  <SlidersHorizontal className="w-4 h-4" />
                </button>

                {/* Transmissao / Cast Padrao */}
                <button
                  type="button"
                  onClick={() => {
                    closeAllMenus();
                    setShowCastModal(true);
                  }}
                  className="p-1.5 rounded-full text-white/75 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  title="Transmitir para TV / Web Video Caster / AirPlay"
                  aria-label="Transmitir para TV"
                >
                  <Cast className="w-4 h-4" />
                </button>

                {/* Telemetria P2P / HUD */}
                <button
                  type="button"
                  onClick={() => setShowTechStats(!showTechStats)}
                  className={`p-1.5 rounded-full transition-colors cursor-pointer ${
                    showTechStats
                      ? 'bg-white text-black'
                      : 'text-white/75 hover:text-white hover:bg-white/10'
                  }`}
                  title="Telemetria P2P e Mapa de Peças (I)"
                  aria-label="Telemetria P2P"
                >
                  <Activity className="w-4 h-4" />
                </button>

                {onNextEpisode && (
                  <button
                    type="button"
                    onClick={onNextEpisode}
                    className="p-1.5 rounded-full text-white/75 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                    title="Próximo Episódio"
                    aria-label="Próximo Episódio"
                  >
                    <SkipForward className="w-4 h-4" />
                  </button>
                )}

                {/* Tela Cheia */}
                <button
                  type="button"
                  onClick={toggleFullscreen}
                  className="p-1.5 rounded-full text-white/75 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
                  title={isFullscreen ? 'Sair da Tela Cheia' : 'Tela Cheia'}
                  aria-label="Tela Cheia"
                >
                  {isFullscreen ? <Minimize className="w-4 h-4" /> : <Maximize className="w-4 h-4" />}
                </button>

                {/* Tempo Restante Negativo */}
                <span className="font-mono text-white/80 ml-1">
                  -{formatTime(Math.max(0, totalEffectiveDuration - currentTime))}
                </span>
              </div>
            </div>
          </div>

          {/* PAINEL DE AJUSTES UNIVERSAL EM LIQUID GLASS (Com Sincronia de Audio -2.0s a +2.0s e Muxing Hibrido) */}
          {showMobileSettingsSheet && (
            <div
              onClick={() => setShowMobileSettingsSheet(false)}
              className="fixed inset-0 z-50 bg-black/70 flex flex-col justify-end sm:justify-center sm:items-center p-0 sm:p-4"
            >
              <div
                onClick={(e) => e.stopPropagation()}
                className="w-full sm:max-w-md liquid-glass-heavy rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 space-y-4 max-h-[88vh] overflow-y-auto text-white shadow-2xl"
              >
                {/* Header do Painel */}
                <div className="flex items-center justify-between border-b border-white/10 pb-3">
                  <div className="flex items-center gap-2">
                    <SlidersHorizontal className="w-4 h-4 text-white/90" />
                    <span className="font-bold text-sm">Configurações e Sincronia</span>
                  </div>
                  <button
                    onClick={() => setShowMobileSettingsSheet(false)}
                    className="p-1 rounded-full bg-white/10 hover:bg-white/20 text-white transition-colors cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                {/* Qualidade Fixa (720p, 1080p Padrao, 4K) */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">
                    Qualidade de Vídeo (Quality Cap)
                  </label>
                  <div className="grid grid-cols-3 gap-2">
                    {FIXED_QUALITY_OPTIONS.map((q) => (
                      <button
                        key={q.id}
                        onClick={() => handleSelectFixedQuality(q.id)}
                        className={`py-2 px-2.5 rounded-xl text-xs font-bold border transition-colors flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                          preferredQuality === q.id
                            ? 'bg-white text-black border-white shadow-md'
                            : 'bg-white/5 text-white/80 border-white/10 hover:bg-white/10'
                        }`}
                      >
                        <span>{q.label}</span>
                        <span
                          className={`text-[10px] font-normal ${
                            preferredQuality === q.id ? 'text-black/75' : 'text-white/50'
                          }`}
                        >
                          {q.badge}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* FASE 3: Controle de Sincronia de Audio (-2.0s a +2.0s em passos de 0.1s) */}
                <div className="space-y-2 p-3 rounded-2xl bg-white/[0.04] border border-white/10">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-white/80 uppercase tracking-wider">
                      Sincronia de Áudio
                    </label>
                    <span className="text-xs font-mono font-bold text-white">
                      {audioSyncOffsetSec > 0 ? `+${audioSyncOffsetSec.toFixed(1)}s` : `${audioSyncOffsetSec.toFixed(1)}s`}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => applyAudioSyncOffset(audioSyncOffsetSec - 0.1)}
                      className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-mono font-bold cursor-pointer"
                    >
                      -0.1s
                    </button>
                    <input
                      type="range"
                      min={-2.0}
                      max={2.0}
                      step={0.1}
                      value={audioSyncOffsetSec}
                      onChange={(e) => applyAudioSyncOffset(parseFloat(e.target.value))}
                      className="flex-1 h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white"
                      aria-label="Sincronia de Áudio"
                    />
                    <button
                      type="button"
                      onClick={() => applyAudioSyncOffset(audioSyncOffsetSec + 0.1)}
                      className="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-xs font-mono font-bold cursor-pointer"
                    >
                      +0.1s
                    </button>
                    {audioSyncOffsetSec !== 0 && (
                      <button
                        type="button"
                        onClick={() => applyAudioSyncOffset(0)}
                        className="px-2 py-1 rounded-lg bg-white text-black text-[10px] font-bold cursor-pointer"
                      >
                        Zero
                      </button>
                    )}
                  </div>
                </div>

                {/* FASE 3: Muxing Hibrido em Tempo Real (Video 1080p/4K EN + Audio 720p PT-BR) */}
                {hybridPair && (
                  <div className="p-3 rounded-2xl bg-white/[0.04] border border-white/10 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white">
                        Muxing Híbrido ({hybridPair.videoTorrent.quality} EN + Áudio PT-BR)
                      </p>
                      <p className="text-[11px] text-white/55 truncate">
                        Combina vídeo de alta definição com faixa dublada 720p sem recodificar
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const nextHybrid = !isHybridMode;
                        setIsHybridMode(nextHybrid);
                        isTranscodedRef.current = nextHybrid || forceTranscode;
                        const nextUrl = getStreamUrlForTorrent(
                          nextHybrid ? hybridPair.videoTorrent : currentTorrent,
                          trackerPriority,
                          {
                            isRetry: true,
                            seekSeconds: lastKnownTimeRef.current > 1.5 ? lastKnownTimeRef.current : undefined,
                            useHybrid: nextHybrid
                          }
                        );
                        setActiveVideoSrc(nextUrl);
                        setIsBuffering(true);
                        showToastNotification(
                          nextHybrid
                            ? `Muxing Híbrido ativado (${hybridPair.videoTorrent.quality} + Áudio PT-BR)`
                            : 'Muxing Híbrido desativado',
                          3000
                        );
                      }}
                      className={`px-3 py-1.5 rounded-full text-xs font-bold shrink-0 cursor-pointer transition-colors ${
                        isHybridMode
                          ? 'bg-white text-black'
                          : 'bg-white/10 text-white/80 hover:bg-white/20'
                      }`}
                    >
                      {isHybridMode ? 'Ativo' : 'Ativar'}
                    </button>
                  </div>
                )}

                {/* Velocidade */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">Velocidade</label>
                  <div className="grid grid-cols-5 gap-1.5">
                    {[0.75, 1, 1.25, 1.5, 2].map((spd) => (
                      <button
                        key={spd}
                        onClick={() => changeSpeed(spd)}
                        className={`py-1.5 rounded-xl text-xs font-mono font-bold border transition-colors ${
                          playbackSpeed === spd
                            ? 'bg-white text-black border-white'
                            : 'bg-white/5 text-white/80 border-white/10'
                        }`}
                      >
                        {spd}x
                      </button>
                    ))}
                  </div>
                </div>

                {/* Audio & Idioma */}
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">Áudio & Dublagem</label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() => handleSwitchLanguageMode(true, undefined)}
                      className={`py-2 px-3 rounded-xl text-xs font-bold border transition-colors flex items-center justify-center gap-1.5 ${
                        currentTorrent.isPortugueseAudio
                          ? 'bg-white text-black border-white'
                          : 'bg-white/5 text-white/80 border-white/10'
                      }`}
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>Dublado PT-BR</span>
                    </button>
                    <button
                      onClick={() => handleSwitchLanguageMode(false, undefined)}
                      className={`py-2 px-3 rounded-xl text-xs font-bold border transition-colors flex items-center justify-center gap-1.5 ${
                        !currentTorrent.isPortugueseAudio
                          ? 'bg-white text-black border-white'
                          : 'bg-white/5 text-white/80 border-white/10'
                      }`}
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>Original / Inglês</span>
                    </button>
                  </div>

                  {currentTorrent.isPortugueseAudio && (
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        onClick={() => handleSwitchLanguageMode(true, 0)}
                        className={`py-1.5 px-2 rounded-lg text-[11px] border ${
                          audioTrackOverride === 0
                            ? 'bg-white text-black font-bold border-white'
                            : 'bg-white/5 text-white/70 border-white/10'
                        }`}
                      >
                        Dual: Forçar Faixa 1
                      </button>
                      <button
                        onClick={() => handleSwitchLanguageMode(true, 1)}
                        className={`py-1.5 px-2 rounded-lg text-[11px] border ${
                          audioTrackOverride === 1
                            ? 'bg-white text-black font-bold border-white'
                            : 'bg-white/5 text-white/70 border-white/10'
                        }`}
                      >
                        Dual: Forçar Faixa 2
                      </button>
                    </div>
                  )}
                </div>

                {/* Legendas Oficiais */}
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-white/60 uppercase tracking-wider">Legendas</label>
                    {subtitlesLoading && (
                      <span className="text-[10px] text-white/50 flex items-center gap-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> Buscando...
                      </span>
                    )}
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto pr-1">
                    <button
                      onClick={() => setSelectedSubtitleId('off')}
                      className={`w-full text-left py-1.5 px-3 rounded-lg text-xs border ${
                        selectedSubtitleId === 'off'
                          ? 'bg-white text-black font-bold border-white'
                          : 'bg-white/5 text-white/80 border-white/10'
                      }`}
                    >
                      Desativadas (Padrão)
                    </button>
                    {subtitleTracks.map((tr) => (
                      <button
                        key={tr.id}
                        onClick={() => setSelectedSubtitleId(tr.id)}
                        className={`w-full text-left py-1.5 px-3 rounded-lg text-xs border ${
                          selectedSubtitleId === tr.id
                            ? 'bg-white text-black font-bold border-white'
                            : 'bg-white/5 text-white/80 border-white/10'
                        }`}
                      >
                        {tr.label}
                      </button>
                    ))}
                    {!subtitlesLoading && subtitleTracks.length === 0 && (
                      <p className="text-[11px] text-white/40 italic py-1 px-1">
                        Nenhuma legenda externa necessária (áudio em português integrado).
                      </p>
                    )}
                  </div>

                  <div className="pt-1">
                    <div className="text-[10px] text-white/50 mb-1">Tamanho da Legenda</div>
                    <div className="grid grid-cols-3 gap-1.5">
                      {(
                        [
                          ['sm', 'Pequena'],
                          ['md', 'Média'],
                          ['lg', 'Grande']
                        ] as Array<[SubtitleSize, string]>
                      ).map(([sz, lbl]) => (
                        <button
                          key={sz}
                          onClick={() => changeSubtitleSize(sz)}
                          className={`py-1 rounded-lg text-xs border ${
                            subtitleSize === sz
                              ? 'bg-white text-black font-bold border-white'
                              : 'bg-white/5 text-white/70 border-white/10'
                          }`}
                        >
                          {lbl}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Rede P2P Info */}
                <div className="pt-2 border-t border-white/10 flex items-center justify-between text-xs text-white/60 font-mono">
                  <span>Peers: <strong className="text-white">{connectedPeersCount}</strong></span>
                  <span>Velocidade: <strong className="text-white">{formatTransferSpeed(currentTransferSpeed)}</strong></span>
                </div>
              </div>
            </div>
          )}

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
                className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/75"
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-2xl max-h-[90vh] overflow-y-auto liquid-glass-heavy rounded-3xl p-5 sm:p-7 shadow-2xl space-y-5 text-white"
                >
                  <div className="flex items-start justify-between gap-3 border-b border-white/10 pb-4">
                    <div>
                      <div className="flex items-center gap-2 text-white/80 text-xs font-extrabold uppercase tracking-wider">
                        <Cast className="w-4 h-4" />
                        <span>Compartilhar Tela & Stream na Rede Wi-Fi</span>
                      </div>
                      <h3 className="text-lg sm:text-xl font-extrabold mt-1">
                        Transmitir para TV ou Outro Dispositivo
                      </h3>
                      <p className="text-xs text-white/60 mt-0.5">
                        {displayTitle} · {preferredQuality} ·{' '}
                        {currentTorrent.isPortugueseAudio ? 'Dublado PT-BR' : 'Áudio Original'} · Ponto atual:{' '}
                        <span className="font-mono text-white">{formatTime(castSeekSec)}</span>
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
                  <div className="p-4 rounded-2xl bg-white/[0.04] border border-white/15 flex flex-col sm:flex-row items-center gap-4">
                    <div className="w-36 h-36 rounded-2xl bg-white p-2 shrink-0 flex items-center justify-center shadow-lg">
                      <img
                        src={qrImageSrc}
                        alt="QR Code Web Video Caster e Smart TV"
                        className="w-full h-full object-contain"
                      />
                    </div>

                    <div className="flex-1 space-y-2.5 text-center sm:text-left">
                      <div className="flex items-center justify-center sm:justify-start gap-2">
                        <Smartphone className="w-4 h-4 text-white" />
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
                          className="px-3.5 py-2 rounded-xl bg-white hover:bg-neutral-200 text-black font-extrabold text-xs inline-flex items-center gap-1.5 transition-colors"
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
                          <Tv className="w-4 h-4 text-white" />
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
                          <Wifi className="w-4 h-4 text-white" />
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
                                <Check className="w-3.5 h-3.5 text-white" />
                                <span className="text-white font-bold">Link TV Copiado!</span>
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
                            className="py-2 px-3 rounded-xl bg-white/10 hover:bg-white/20 text-white border border-white/20 text-xs font-extrabold inline-flex items-center justify-center"
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
                            <span className="text-white font-sans font-bold">URL Direta Copiada!</span>
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
