/**
 * Popoca Streaming - Advanced Custom Video Player
 * Interface Glassmorphic cinematográfica grafite/titânio (zero vermelho), Picture-in-Picture nativo,
 * Barra de progresso de buffer visual (buffered ranges múltiplos), prefetch inteligente antecipando
 * os próximos 3 chunks P2P, auto-failover resiliente contra quedas de sementes, suporte a episódios,
 * legendas WebVTT e controle manual de fontes P2P.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
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
  RefreshCw
} from 'lucide-react';
import { MediaItem, TorrentSource, Episode } from '../types/index.ts';
import { api } from '../services/api.ts';
import { storageService } from '../services/storage.ts';

interface BufferedRangeSegment {
  startPercent: number;
  endPercent: number;
}

interface VideoPlayerProps {
  media: MediaItem;
  torrent: TorrentSource;
  availableTorrents?: TorrentSource[];
  episode?: Episode;
  initialTime?: number;
  forceTranscode?: boolean;
  onClose: () => void;
  onNextEpisode?: () => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  media,
  torrent,
  availableTorrents = [],
  episode,
  initialTime = 0,
  forceTranscode = false,
  onClose,
  onNextEpisode
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const lastPrefetchCallRef = useRef<number>(0);
  const bufferStallTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Fonte atual de torrent (permite auto-failover e troca manual transparente)
  const [currentTorrent, setCurrentTorrent] = useState<TorrentSource>(torrent);
  const [failedTorrentIds, setFailedTorrentIds] = useState<Set<string>>(new Set());
  const [failoverToast, setFailoverToast] = useState<string | null>(null);

  // Duração autoritativa de referência (TMDB metadata para filme ou episódio)
  const authoritativeDuration = React.useMemo(() => {
    if (episode?.durationMinutes && episode.durationMinutes > 0) {
      return episode.durationMinutes * 60;
    }
    if (media.runtime && media.runtime > 0) {
      return media.runtime * 60;
    }
    if (media.media_type === 'tv' || media.media_type === 'anime') {
      return 24 * 60;
    }
    return 115 * 60; // 115 min padrão para longa-metragem
  }, [media, episode]);

  // Estados de Reprodução
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(initialTime);
  const [duration, setDuration] = useState<number>(authoritativeDuration);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [isBuffering, setIsBuffering] = useState(true);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [retryAttempts, setRetryAttempts] = useState(0);

  // Barra de Progresso de Buffer Visual (Buffered Ranges múltiplos)
  const [bufferedRanges, setBufferedRanges] = useState<BufferedRangeSegment[]>([]);
  const [totalBufferedPercent, setTotalBufferedPercent] = useState<number>(0);
  const [prefetchCount, setPrefetchCount] = useState<number>(3);

  // Modo Apenas Áudio
  const [isAudioOnly, setIsAudioOnly] = useState(false);

  // Legendas e Menus
  const [selectedSubtitle, setSelectedSubtitle] = useState<'pt-BR' | 'en' | 'off'>('pt-BR');
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showSubMenu, setShowSubMenu] = useState(false);
  const [showSourcesMenu, setShowSourcesMenu] = useState(false);

  // Helper para construir a URL de streaming com fallback de altMagnets
  const getStreamUrlForTorrent = useCallback(
    (targetTorrent: TorrentSource, isRetry = false): string => {
      const altMagnets = (availableTorrents || [])
        .filter((t) => t.id !== targetTorrent.id && t.magnetUri?.startsWith('magnet:?'))
        .map((t) => t.magnetUri);

      if (targetTorrent.magnetUri && targetTorrent.magnetUri.startsWith('magnet:?')) {
        return (
          api.getStreamUrl(targetTorrent.magnetUri, {
            transcode: forceTranscode,
            audioOnly: false,
            altMagnets: altMagnets.slice(0, 3)
          }) + (isRetry ? `&_retry=${Date.now()}` : '')
        );
      }

      if (media.id) {
        return (
          api.getStreamByTmdbIdUrl(media.id, {
            mediaType: media.media_type,
            season: episode?.seasonNumber,
            episode: episode?.episodeNumber,
            transcode: forceTranscode,
            audioOnly: false
          }) + (isRetry ? `&_retry=${Date.now()}` : '')
        );
      }

      if (episode?.streamUrl) return api.getVideoStreamProxyUrl(episode.streamUrl);
      if (targetTorrent.directUrl) return api.getVideoStreamProxyUrl(targetTorrent.directUrl);
      if (media.stream_url) return api.getVideoStreamProxyUrl(media.stream_url);
      return '/api/stream';
    },
    [availableTorrents, forceTranscode, media, episode]
  );

  const [activeVideoSrc, setActiveVideoSrc] = useState<string>(() =>
    getStreamUrlForTorrent(currentTorrent)
  );

  const displayTitle = episode
    ? `${media.title} · S${episode.seasonNumber}E${episode.episodeNumber}: ${episode.title}`
    : media.title;

  const subtitleUrl =
    selectedSubtitle !== 'off' ? api.getSubtitleUrl(media.title, selectedSubtitle) : '';

  // Atualizar visual buffered ranges a partir do videoRef
  const updateBufferedRanges = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;

    const curDuration = duration > 0 ? duration : authoritativeDuration;
    if (!curDuration || curDuration <= 0) return;

    const ranges: BufferedRangeSegment[] = [];
    const buf = video.buffered;
    let maxEnd = 0;

    for (let i = 0; i < buf.length; i++) {
      try {
        const start = buf.start(i);
        const end = buf.end(i);
        if (end > maxEnd) maxEnd = end;

        const startPercent = Math.max(0, Math.min(100, (start / curDuration) * 100));
        const endPercent = Math.max(0, Math.min(100, (end / curDuration) * 100));

        if (endPercent > startPercent) {
          ranges.push({ startPercent, endPercent });
        }
      } catch {
        // Ignora caso TimeRanges esteja mudando durante seek
      }
    }

    setBufferedRanges(ranges);
    setTotalBufferedPercent(Math.min(100, Math.round((maxEnd / curDuration) * 100)));
  }, [duration, authoritativeDuration]);

  // Sistema de Auto-Failover inteligente para alternar para a próxima fonte P2P estável
  const handleAutoFailover = useCallback(
    (reason = 'Instabilidade no enxame'): boolean => {
      const candidates = (availableTorrents || []).filter(
        (t) => t.id !== currentTorrent.id && !failedTorrentIds.has(t.id)
      );

      if (candidates.length > 0) {
        // Ordena priorizando áudio PT-BR e maior número de sementes ativas
        const nextSource = candidates.sort((a, b) => {
          if (a.isPortugueseAudio && !b.isPortugueseAudio) return -1;
          if (!a.isPortugueseAudio && b.isPortugueseAudio) return 1;
          return b.seeds - a.seeds;
        })[0];

        setFailedTorrentIds((prev) => new Set(prev).add(currentTorrent.id));
        setCurrentTorrent(nextSource);
        const newUrl = getStreamUrlForTorrent(nextSource, true);
        setActiveVideoSrc(newUrl);
        setIsBuffering(true);
        setPlaybackError(null);
        setRetryAttempts(0);

        setFailoverToast(
          `Alternando automaticamente para fonte P2P estável (${nextSource.quality} ${nextSource.format || ''} · ${nextSource.seeds} seeds)...`
        );
        setTimeout(() => setFailoverToast(null), 3600);

        if (videoRef.current) {
          videoRef.current.load();
          videoRef.current.play().catch(() => {});
        }
        return true;
      }

      return false;
    },
    [availableTorrents, currentTorrent.id, failedTorrentIds, getStreamUrlForTorrent]
  );

  // Troca manual de fonte pelo usuário
  const handleSelectAlternativeTorrent = (newTorrent: TorrentSource) => {
    setShowSourcesMenu(false);
    if (newTorrent.id === currentTorrent.id) return;

    setCurrentTorrent(newTorrent);
    const newUrl = getStreamUrlForTorrent(newTorrent, true);
    setActiveVideoSrc(newUrl);
    setIsBuffering(true);
    setPlaybackError(null);
    setRetryAttempts(0);

    setFailoverToast(`Conectando à fonte: ${newTorrent.quality} (${newTorrent.seeds} seeds)...`);
    setTimeout(() => setFailoverToast(null), 2500);

    if (videoRef.current) {
      videoRef.current.load();
      videoRef.current.play().catch(() => {});
    }
  };

  // Prefetch inteligente: antecipa os próximos 3 chunks do torrent baseado na velocidade
  useEffect(() => {
    if (!currentTorrent.magnetUri || !currentTorrent.magnetUri.startsWith('magnet:?')) return;

    const runPrefetch = async () => {
      const now = Date.now();
      if (now - lastPrefetchCallRef.current < 2600) return;
      lastPrefetchCallRef.current = now;

      try {
        const curDuration = duration > 0 ? duration : authoritativeDuration;
        const res = await api.prefetchNextChunks(
          currentTorrent.magnetUri,
          currentTime,
          curDuration,
          2000000 // 2MB/s taxa estimada
        );

        if (res?.prefetchedCount) {
          setPrefetchCount(res.prefetchedCount);
        }
      } catch {
        // Prefetch silencioso em background
      }
    };

    const interval = setInterval(runPrefetch, 2800);
    return () => clearInterval(interval);
  }, [currentTorrent.magnetUri, currentTime, duration, authoritativeDuration]);

  // Monitor de Stall de Buffer: se ficar travado por mais de 8s, aciona auto-failover
  useEffect(() => {
    if (isBuffering && !playbackError) {
      bufferStallTimerRef.current = setTimeout(() => {
        console.warn('[VideoPlayer] Buffering prolongado detectado. Iniciando failover resiliente...');
        const switched = handleAutoFailover('Buffering estagnado');
        if (!switched && retryAttempts < 2) {
          setRetryAttempts((prev) => prev + 1);
          if (videoRef.current) {
            videoRef.current.load();
            videoRef.current.play().catch(() => {});
          }
        }
      }, 8500);
    } else {
      if (bufferStallTimerRef.current) {
        clearTimeout(bufferStallTimerRef.current);
      }
    }

    return () => {
      if (bufferStallTimerRef.current) clearTimeout(bufferStallTimerRef.current);
    };
  }, [isBuffering, playbackError, handleAutoFailover, retryAttempts]);

  // Atualizador periódico do buffer range a cada 1s
  useEffect(() => {
    const bufInterval = setInterval(updateBufferedRanges, 1000);
    return () => clearInterval(bufInterval);
  }, [updateBufferedRanges]);

  // Salvar progresso no LocalStorage a cada 3s
  useEffect(() => {
    const saveProgress = () => {
      if (videoRef.current && (duration > 0 || authoritativeDuration > 0)) {
        storageService.saveWatchProgress({
          id: media.id,
          title: media.title,
          poster_path: media.poster_path,
          backdrop_path: media.backdrop_path,
          currentTime: videoRef.current.currentTime,
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

  // Autoplay ao montar ou trocar fonte
  useEffect(() => {
    const playTimer = setTimeout(() => {
      if (videoRef.current) {
        videoRef.current.play().catch(() => {
          setIsPlaying(false);
        });
      }
    }, 150);

    return () => clearTimeout(playTimer);
  }, [activeVideoSrc]);

  // Ocultar controles após 3.2s
  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) {
        setShowControls(false);
        setShowSpeedMenu(false);
        setShowSubMenu(false);
        setShowSourcesMenu(false);
      }
    }, 3200);
  };

  const togglePlay = () => {
    if (!videoRef.current) return;
    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.play().catch(console.warn);
    }
  };

  const skipSeconds = (seconds: number) => {
    if (!videoRef.current) return;
    setIsBuffering(true);
    const curDur = duration > 0 ? duration : authoritativeDuration;
    const newTime = Math.max(0, Math.min(curDur, videoRef.current.currentTime + seconds));
    videoRef.current.currentTime = newTime;
    setCurrentTime(newTime);
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
    setIsBuffering(true);
    const time = parseFloat(e.target.value);
    videoRef.current.currentTime = time;
    setCurrentTime(time);
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
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(console.warn);
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(console.warn);
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

  const totalEffectiveDuration = duration > 0 ? duration : authoritativeDuration;
  const progressPercent =
    totalEffectiveDuration > 0
      ? Math.min(100, Math.max(0, (currentTime / totalEffectiveDuration) * 100))
      : 0;

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center select-none overflow-hidden"
    >
      {/* Toast de Failover / Notificação Suave */}
      {failoverToast && (
        <div className="absolute top-20 z-50 glass-dropdown px-4 py-2.5 rounded-2xl border border-white/20 shadow-2xl flex items-center gap-2.5 animate-in slide-in-from-top duration-300 text-xs font-semibold text-white">
          <Zap className="w-4 h-4 text-emerald-400 animate-pulse" />
          <span>{failoverToast}</span>
        </div>
      )}

      {/* Vídeo HTML5 Principal */}
      <video
        ref={videoRef}
        src={activeVideoSrc}
        playsInline
        autoPlay
        className={`w-full h-full object-contain ${isAudioOnly ? 'hidden' : 'block'}`}
        onPlay={() => {
          setIsPlaying(true);
          setIsBuffering(false);
        }}
        onCanPlay={() => {
          setIsBuffering(false);
          updateBufferedRanges();
        }}
        onLoadedData={() => {
          setIsBuffering(false);
          updateBufferedRanges();
        }}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onSeeking={() => setIsBuffering(true)}
        onSeeked={() => {
          setIsBuffering(false);
          updateBufferedRanges();
        }}
        onProgress={() => {
          updateBufferedRanges();
        }}
        onTimeUpdate={() => {
          setIsBuffering(false);
          if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
          updateBufferedRanges();
        }}
        onLoadedMetadata={() => {
          setIsBuffering(false);
          if (videoRef.current) {
            const rawDur = videoRef.current.duration;
            if (rawDur && isFinite(rawDur) && rawDur > 120) {
              setDuration(rawDur);
            } else {
              setDuration(authoritativeDuration);
            }
            if (initialTime > 0) {
              videoRef.current.currentTime = initialTime;
            }
          }
          updateBufferedRanges();
        }}
        onDurationChange={() => {
          if (videoRef.current) {
            const rawDur = videoRef.current.duration;
            if (rawDur && isFinite(rawDur) && rawDur > 120) {
              setDuration(rawDur);
            }
          }
          updateBufferedRanges();
        }}
        onError={() => {
          setIsBuffering(false);

          // 1. Tenta Failover automático para outra fonte disponível
          const failoverSuccess = handleAutoFailover('Falha no fluxo');
          if (failoverSuccess) return;

          // 2. Se não houver outra fonte, tenta reconexão rápida com cache-buster (até 2x)
          if (retryAttempts < 2) {
            console.log(`[VideoPlayer] Reconectando stream P2P (${retryAttempts + 1}/2)...`);
            setRetryAttempts((prev) => prev + 1);
            setIsBuffering(true);
            setTimeout(() => {
              if (videoRef.current) {
                const retryUrl = getStreamUrlForTorrent(currentTorrent, true);
                setActiveVideoSrc(retryUrl);
                videoRef.current.load();
                videoRef.current.play().catch(() => {});
              }
            }, 1200);
            return;
          }

          // 3. Somente exibe erro se todas as fontes falharem
          setPlaybackError(
            `A fonte selecionada "${currentTorrent.quality} ${currentTorrent.format || 'WEB-DL'}" encontrou instabilidade nas sementes P2P. Selecione outra fonte abaixo ou tente novamente.`
          );
        }}
      >
        {subtitleUrl && (
          <track
            kind="subtitles"
            src={subtitleUrl}
            srcLang={selectedSubtitle}
            label={selectedSubtitle === 'pt-BR' ? 'Português' : 'English'}
            default
          />
        )}
      </video>

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

          <h2 className="text-lg sm:text-xl font-bold text-white max-w-md">
            {displayTitle}
          </h2>
          <p className="text-xs text-white/50 mt-1">
            Modo Somente Áudio Ativo · Economizando dados e bateria
          </p>

          <div className="flex items-center gap-1.5 mt-6 h-8">
            {[40, 70, 100, 60, 90, 45, 80, 100, 50, 75, 95, 30].map((h, i) => (
              <div
                key={i}
                className={`w-1 bg-white rounded-full transition-all duration-300 ${
                  isPlaying ? 'animate-pulse' : 'opacity-30'
                }`}
                style={{ height: isPlaying ? `${h}%` : '20%' }}
              />
            ))}
          </div>
        </div>
      )}

      {/* Indicador de Buffering com Prefetch inteligente */}
      {isBuffering && !playbackError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/45 backdrop-blur-sm pointer-events-none z-30">
          <div className="w-10 h-10 rounded-full border-2 border-white/20 border-t-white animate-spin mb-3" />
          <span className="text-xs font-semibold text-white/90">
            Carregando stream P2P ({currentTorrent.quality})...
          </span>
          <span className="text-[11px] font-mono text-emerald-400 mt-1 flex items-center gap-1">
            <Zap className="w-3 h-3" />
            Prefetch ativo: antecipando 3 chunks
          </span>
        </div>
      )}

      {/* Diálogo de Erro / Troca de Fonte Rápida */}
      {playbackError && (
        <div className="absolute inset-0 z-50 flex items-center justify-center p-4 bg-black/85 backdrop-blur-xl animate-in fade-in">
          <div className="max-w-md w-full glass-panel p-6 rounded-2xl border border-white/10 text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-full bg-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
              <Users className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">Fonte P2P Indisponível</h3>
              <p className="text-xs text-white/70 mt-1 leading-relaxed">
                {playbackError}
              </p>
            </div>

            {/* Lista de Fontes Alternativas Rápidas para Selecionar com 1 Clique */}
            {availableTorrents.length > 1 && (
              <div className="text-left space-y-1.5 max-h-40 overflow-y-auto pr-1">
                <span className="text-[11px] font-semibold text-white/50 uppercase tracking-wider">
                  Trocar para outra fonte disponível:
                </span>
                {availableTorrents
                  .filter((t) => t.id !== currentTorrent.id)
                  .map((alt) => (
                    <button
                      key={alt.id}
                      onClick={() => handleSelectAlternativeTorrent(alt)}
                      className="w-full p-2 rounded-xl glass-subtle hover:bg-white/10 text-white text-xs flex items-center justify-between border border-white/5 transition-colors"
                    >
                      <div className="flex items-center gap-2 truncate">
                        <span className="font-bold">{alt.quality}</span>
                        <span className="text-white/40">{alt.format || 'WEB-DL'}</span>
                        {alt.isPortugueseAudio && (
                          <span className="text-[10px] text-emerald-400 font-bold">PT-BR</span>
                        )}
                      </div>
                      <span className="text-[10px] text-white/50 font-mono shrink-0">
                        {alt.seeds} seeds
                      </span>
                    </button>
                  ))}
              </div>
            )}

            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <button
                onClick={() => {
                  setPlaybackError(null);
                  setIsBuffering(true);
                  if (videoRef.current) {
                    const retryUrl = getStreamUrlForTorrent(currentTorrent, true);
                    setActiveVideoSrc(retryUrl);
                    videoRef.current.load();
                    videoRef.current.play().catch(() => {});
                  }
                }}
                className="flex-1 py-2.5 px-4 bg-white hover:bg-neutral-200 text-black font-bold text-xs rounded-xl shadow-md transition-colors"
              >
                Tentar Novamente
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
        className={`absolute top-0 left-0 right-0 p-4 sm:p-6 bg-gradient-to-b from-black/80 to-transparent flex items-center justify-between z-40 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-3 min-w-0 flex-1 mr-4">
          <button
            onClick={onClose}
            className="p-2 rounded-xl glass-panel hover:bg-white/10 text-white transition-colors shrink-0"
            aria-label="Voltar"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="min-w-0">
            <h3 className="text-xs sm:text-sm md:text-base font-bold text-white truncate">
              {displayTitle}
            </h3>
            <div className="flex items-center gap-2 text-[11px] text-white/50">
              <span className="font-semibold text-white/80">{currentTorrent.quality}</span>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-400">
                {currentTorrent.isPortugueseAudio ? 'Áudio pt-BR Priorizado' : 'Áudio Original'}
              </span>
            </div>
          </div>
        </div>

        {/* Telemetria Minimalista & Seletor de Fontes */}
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Seletor Rápido de Fontes P2P */}
          {availableTorrents.length > 1 && (
            <div className="relative">
              <button
                onClick={() => {
                  setShowSourcesMenu(!showSourcesMenu);
                  setShowSpeedMenu(false);
                  setShowSubMenu(false);
                }}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl glass-subtle hover:bg-white/15 border border-white/10 text-xs font-medium text-white transition-colors"
                title="Trocar fonte torrent"
              >
                <Layers className="w-3.5 h-3.5 text-white/70" />
                <span className="hidden sm:inline">Fonte:</span>
                <span className="font-bold">{currentTorrent.quality}</span>
                <span className="text-[10px] px-1 rounded bg-white/10 text-white/60">
                  {availableTorrents.length}
                </span>
              </button>

              {showSourcesMenu && (
                <div className="absolute right-0 top-11 w-64 glass-dropdown rounded-2xl p-2 border border-white/15 shadow-2xl z-50 animate-in fade-in">
                  <div className="text-[11px] font-semibold text-white/50 px-2 py-1 flex items-center justify-between">
                    <span>Fontes Torrent P2P</span>
                    <span className="text-emerald-400 font-mono text-[10px]">Auto-failover ativo</span>
                  </div>
                  <div className="space-y-1 mt-1 max-h-52 overflow-y-auto">
                    {availableTorrents.map((t) => {
                      const isCur = t.id === currentTorrent.id;
                      return (
                        <button
                          key={t.id}
                          onClick={() => handleSelectAlternativeTorrent(t)}
                          className={`w-full text-left p-2 rounded-xl text-xs transition-colors flex items-center justify-between gap-2 ${
                            isCur
                              ? 'bg-white text-black font-bold shadow-md'
                              : 'text-white/80 hover:bg-white/10'
                          }`}
                        >
                          <div className="min-w-0">
                            <div className="flex items-center gap-1.5">
                              <span>{t.quality}</span>
                              <span className="text-[10px] opacity-60">{t.format || 'WEB-DL'}</span>
                              {t.isPortugueseAudio && (
                                <span
                                  className={`text-[9px] px-1 rounded font-bold ${
                                    isCur ? 'bg-black text-white' : 'bg-emerald-500/20 text-emerald-400'
                                  }`}
                                >
                                  PT-BR
                                </span>
                              )}
                            </div>
                            <div className="text-[10px] opacity-60 font-mono truncate">{t.source}</div>
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

          {/* Seeds e Tamanho */}
          <div className="hidden md:flex items-center gap-2.5 text-xs font-mono glass-subtle px-3 py-1.5 rounded-xl border border-white/10 text-white/70">
            <span className="flex items-center gap-1.5 text-emerald-400">
              <Users className="w-3.5 h-3.5" />
              {currentTorrent.seeds} seeds
            </span>
            <span aria-hidden="true" className="text-white/20">·</span>
            <span className="text-white/90 font-medium">{currentTorrent.sizeFormatted}</span>
          </div>
        </div>
      </div>

      {/* Painel Inferior de Controles (Grafite Minimalista, Zero Vermelho) */}
      <div
        className={`absolute bottom-0 left-0 right-0 p-4 sm:p-6 bg-gradient-to-t from-black/95 via-black/60 to-transparent flex flex-col gap-3 z-40 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Barra de Progresso / Scrubber com Buffered Ranges Múltiplos Visuais */}
        <div className="relative w-full group/scrubber cursor-pointer py-2 flex items-center">
          {/* Fundo da barra */}
          <div className="absolute left-0 right-0 h-1.5 bg-white/15 rounded-lg pointer-events-none" />

          {/* Barras de Buffer Pré-carregado em Memória (Buffered Ranges Visuais) */}
          {bufferedRanges.length > 0 ? (
            bufferedRanges.map((range, index) => (
              <div
                key={index}
                className="absolute h-1.5 bg-white/40 rounded-lg pointer-events-none transition-all duration-200"
                style={{
                  left: `${range.startPercent}%`,
                  width: `${Math.max(0.5, range.endPercent - range.startPercent)}%`
                }}
                title={`Buffer: ${range.startPercent.toFixed(1)}% - ${range.endPercent.toFixed(1)}%`}
              />
            ))
          ) : (
            <div
              className="absolute left-0 h-1.5 bg-white/30 rounded-lg pointer-events-none transition-all duration-300"
              style={{ width: `${totalBufferedPercent}%` }}
            />
          )}

          {/* Progresso de Reprodução Reproduzido (Branco Sólido) */}
          <div
            className="absolute left-0 h-1.5 bg-white rounded-lg pointer-events-none z-10 transition-all duration-75"
            style={{ width: `${progressPercent}%` }}
          />

          {/* Slider invisível sobreposto para controle de toque e clique */}
          <input
            type="range"
            min={0}
            max={totalEffectiveDuration > 0 ? totalEffectiveDuration : 100}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-2.5 opacity-0 cursor-pointer accent-white relative z-20"
          />
        </div>

        {/* Linha de Botões e Informações de Reprodução */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          {/* Lado Esquerdo: Play, Pular 10s, Volume, Timestamp + Badge de Buffer */}
          <div className="flex items-center gap-2.5 sm:gap-4 flex-wrap">
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

            {/* Próximo Episódio */}
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
                aria-label={isMuted ? 'Ativar som' : 'Mudar som'}
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

            {/* Timestamp e Badge de Buffer Visual Inteligente */}
            <div className="flex items-center gap-2.5">
              <div className="text-[11px] sm:text-xs font-mono text-white/80">
                <span>{formatTime(currentTime)}</span>
                <span className="text-white/30"> / </span>
                <span>{formatTime(totalEffectiveDuration)}</span>
              </div>

              {/* Indicador de Buffer e Prefetch em vez de contagem de segundos avulsos */}
              <div className="hidden sm:flex items-center gap-1.5 text-[10px] font-mono px-2 py-0.5 rounded-md glass-subtle border border-white/10 text-white/70">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                <span>Buffer {totalBufferedPercent}%</span>
                {prefetchCount > 0 && (
                  <span className="text-emerald-300 font-semibold">
                    (+{prefetchCount} chunks antecipados)
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Lado Direito: Apenas Áudio, PiP, Legendas, Velocidade, Fullscreen */}
          <div className="flex items-center gap-1.5 sm:gap-2.5">
            {/* Toggle Modo Apenas Áudio */}
            <button
              onClick={() => setIsAudioOnly(!isAudioOnly)}
              className={`p-2 rounded-xl transition-colors flex items-center gap-1.5 text-xs font-medium ${
                isAudioOnly
                  ? 'bg-white text-black font-bold shadow-md'
                  : 'glass-subtle text-white/70 hover:text-white'
              }`}
              title="Modo Apenas Áudio"
            >
              <Headphones className="w-4 h-4" />
              <span className="hidden md:inline">Apenas Áudio</span>
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

            {/* Seletor de Legendas */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowSubMenu(!showSubMenu);
                  setShowSpeedMenu(false);
                  setShowSourcesMenu(false);
                }}
                className={`p-2 transition-colors ${
                  selectedSubtitle !== 'off' ? 'text-white font-bold' : 'text-white/70 hover:text-white'
                }`}
                title="Legendas"
                aria-label="Menu de legendas"
              >
                <Subtitles className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>

              {showSubMenu && (
                <div className="absolute right-0 bottom-12 w-44 glass-dropdown rounded-xl p-1.5 border border-white/10 shadow-2xl z-50">
                  <div className="text-[11px] font-semibold text-white/50 px-2 py-1">Legendas</div>
                  <button
                    onClick={() => {
                      setSelectedSubtitle('pt-BR');
                      setShowSubMenu(false);
                    }}
                    className={`w-full text-left px-2 py-1.5 text-xs rounded-lg transition-colors ${
                      selectedSubtitle === 'pt-BR'
                        ? 'bg-white text-black font-bold'
                        : 'text-white/80 hover:bg-white/10'
                    }`}
                  >
                    Português (pt-BR)
                  </button>
                  <button
                    onClick={() => {
                      setSelectedSubtitle('en');
                      setShowSubMenu(false);
                    }}
                    className={`w-full text-left px-2 py-1.5 text-xs rounded-lg transition-colors ${
                      selectedSubtitle === 'en'
                        ? 'bg-white text-black font-bold'
                        : 'text-white/80 hover:bg-white/10'
                    }`}
                  >
                    Inglês (Original)
                  </button>
                  <button
                    onClick={() => {
                      setSelectedSubtitle('off');
                      setShowSubMenu(false);
                    }}
                    className={`w-full text-left px-2 py-1.5 text-xs rounded-lg transition-colors ${
                      selectedSubtitle === 'off'
                        ? 'bg-white text-black font-bold'
                        : 'text-white/80 hover:bg-white/10'
                    }`}
                  >
                    Desativadas
                  </button>
                </div>
              )}
            </div>

            {/* Seletor de Velocidade */}
            <div className="relative">
              <button
                onClick={() => {
                  setShowSpeedMenu(!showSpeedMenu);
                  setShowSubMenu(false);
                  setShowSourcesMenu(false);
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
                      className={`w-full text-left px-2.5 py-1 text-xs rounded-lg font-mono transition-colors ${
                        playbackSpeed === spd
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
    </div>
  );
};
