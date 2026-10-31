/**
 * Popoca Streaming - Advanced Custom Video Player
 * Interface Glassmorphic cinematográfica grafite/titânio (zero vermelho), Picture-in-Picture nativo,
 * Modo Apenas Áudio, suporte a Episódios de Séries/Animes, legendas WebVTT, velocidade e pular 10s.
 */

import React, { useState, useRef, useEffect } from 'react';
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
  SkipForward
} from 'lucide-react';
import { MediaItem, TorrentSource, Episode } from '../types/index.ts';
import { api } from '../services/api.ts';
import { storageService } from '../services/storage.ts';

interface VideoPlayerProps {
  media: MediaItem;
  torrent: TorrentSource;
  episode?: Episode;
  initialTime?: number;
  forceTranscode?: boolean;
  onClose: () => void;
  onNextEpisode?: () => void;
}

export const VideoPlayer: React.FC<VideoPlayerProps> = ({
  media,
  torrent,
  episode,
  initialTime = 0,
  forceTranscode = false,
  onClose,
  onNextEpisode
}) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);

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

  // Modo Apenas Áudio
  const [isAudioOnly, setIsAudioOnly] = useState(false);

  // Legendas e Menus
  const [selectedSubtitle, setSelectedSubtitle] = useState<'pt-BR' | 'en' | 'off'>('pt-BR');
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showSubMenu, setShowSubMenu] = useState(false);

  // Fonte de Vídeo (Garante streaming do torrent real escolhido sem interceptação)
  const [activeVideoSrc, setActiveVideoSrc] = useState<string>(() => {
    // 1. Prioridade máxima: Magnet URI do torrent real selecionado pelo usuário
    if (torrent.magnetUri && torrent.magnetUri.startsWith('magnet:?')) {
      return api.getStreamUrl(torrent.magnetUri, { transcode: forceTranscode, audioOnly: false });
    }
    // 2. Transmissão vinculada ao TMDB para o filme ou episódio específico da série/anime
    if (media.id) {
      return api.getStreamByTmdbIdUrl(media.id, {
        mediaType: media.media_type,
        season: episode?.seasonNumber,
        episode: episode?.episodeNumber,
        transcode: forceTranscode,
        audioOnly: false
      });
    }
    if (episode?.streamUrl) return api.getVideoStreamProxyUrl(episode.streamUrl);
    if (torrent.directUrl) return api.getVideoStreamProxyUrl(torrent.directUrl);
    if (media.stream_url) return api.getVideoStreamProxyUrl(media.stream_url);
    return '/api/stream';
  });

  const displayTitle = episode 
    ? `${media.title} · S${episode.seasonNumber}E${episode.episodeNumber}: ${episode.title}`
    : media.title;

  const subtitleUrl = selectedSubtitle !== 'off' 
    ? api.getSubtitleUrl(media.title, selectedSubtitle)
    : '';

  // Salvar progresso no LocalStorage a cada 3s
  useEffect(() => {
    const saveProgress = () => {
      if (videoRef.current && duration > 0) {
        storageService.saveWatchProgress({
          id: media.id,
          title: media.title,
          poster_path: media.poster_path,
          backdrop_path: media.backdrop_path,
          currentTime: videoRef.current.currentTime,
          duration,
          mediaType: media.media_type,
          magnetUri: torrent.magnetUri,
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
  }, [media, duration, torrent.magnetUri, episode]);

  // Autoplay ao montar
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

  // Ocultar controles após 3s
  const handleMouseMove = () => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => {
      if (isPlaying) setShowControls(false);
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
    videoRef.current.currentTime = Math.max(0, Math.min(duration, videoRef.current.currentTime + seconds));
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!videoRef.current) return;
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

  // Picture-in-Picture
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

  // Fullscreen
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

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className="fixed inset-0 z-50 bg-black flex items-center justify-center select-none overflow-hidden"
    >
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
        onCanPlay={() => setIsBuffering(false)}
        onLoadedData={() => setIsBuffering(false)}
        onPause={() => setIsPlaying(false)}
        onWaiting={() => setIsBuffering(true)}
        onPlaying={() => setIsBuffering(false)}
        onTimeUpdate={() => {
          setIsBuffering(false);
          if (videoRef.current) setCurrentTime(videoRef.current.currentTime);
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
        }}
        onDurationChange={() => {
          if (videoRef.current) {
            const rawDur = videoRef.current.duration;
            if (rawDur && isFinite(rawDur) && rawDur > 120) {
              setDuration(rawDur);
            }
          }
        }}
        onError={() => {
          setIsBuffering(false);
          // Tentativa de reconexão automática resiliente
          if (retryAttempts < 2) {
            console.log(`[VideoPlayer] Tentativa de reconexão do stream P2P ${retryAttempts + 1}/2...`);
            setRetryAttempts((prev) => prev + 1);
            setIsBuffering(true);
            setTimeout(() => {
              if (videoRef.current) {
                const sep = activeVideoSrc.includes('?') ? '&' : '?';
                setActiveVideoSrc(`${activeVideoSrc}${sep}_retry=${Date.now()}`);
                videoRef.current.load();
                videoRef.current.play().catch(() => {});
              }
            }, 1200);
            return;
          }

          setPlaybackError(
            `A fonte selecionada "${torrent.quality} ${torrent.format || 'WEB-DL'}" encontrou instabilidade nas sementes P2P. Tente reconectar ou selecione outra fonte disponível.`
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

      {/* Indicador de Buffering */}
      {isBuffering && !playbackError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/40 backdrop-blur-sm pointer-events-none z-30">
          <div className="w-10 h-10 rounded-full border-2 border-white/20 border-t-white animate-spin mb-3" />
          <span className="text-xs font-medium text-white/80">Conectando aos pares P2P...</span>
        </div>
      )}

      {/* Diálogo de Erro / Troca de Fonte */}
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

            <div className="flex flex-col sm:flex-row gap-2 pt-2">
              <button
                onClick={() => {
                  setPlaybackError(null);
                  setIsBuffering(true);
                  if (videoRef.current) {
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
                Escolher Outra Fonte
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
              <span>{torrent.quality}</span>
              <span aria-hidden="true">·</span>
              <span className="text-emerald-400">Áudio pt-BR Priorizado</span>
            </div>
          </div>
        </div>

        {/* Telemetria Minimalista */}
        <div className="hidden sm:flex items-center gap-3 text-xs font-mono glass-subtle px-3 py-1.5 rounded-xl border border-white/10 text-white/70 shrink-0">
          <span className="flex items-center gap-1.5 text-emerald-400">
            <Users className="w-3.5 h-3.5" />
            {torrent.seeds} seeds
          </span>
          <span aria-hidden="true" className="text-white/20">·</span>
          <span className="text-white/90 font-medium">{torrent.sizeFormatted}</span>
          {torrent.infoHash && (
            <>
              <span aria-hidden="true" className="text-white/20">·</span>
              <span className="text-white/50 text-[11px] truncate max-w-[90px]" title={torrent.infoHash}>
                #{torrent.infoHash.slice(0, 8)}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Painel Inferior de Controles (Grafite Minimalista, Zero Vermelho) */}
      <div
        className={`absolute bottom-0 left-0 right-0 p-4 sm:p-6 bg-gradient-to-t from-black/95 via-black/60 to-transparent flex flex-col gap-3 z-40 transition-opacity duration-300 ${
          showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* Barra de Progresso / Scrubber Branco/Titânio */}
        <div className="relative w-full group/scrubber cursor-pointer py-2">
          <input
            type="range"
            min={0}
            max={duration > 0 ? duration : authoritativeDuration}
            value={currentTime}
            onChange={handleSeek}
            className="w-full h-1.5 bg-white/20 rounded-lg appearance-none cursor-pointer accent-white focus:outline-none"
          />
        </div>

        {/* Linha de Botões */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          
          {/* Lado Esquerdo: Play, Pular 10s, Volume, Timestamp */}
          <div className="flex items-center gap-2.5 sm:gap-4">
            <button
              onClick={togglePlay}
              className="p-2 sm:p-2.5 rounded-full bg-white hover:bg-slate-200 text-black transition-all transform active:scale-90"
              aria-label={isPlaying ? 'Pausar' : 'Reproduzir'}
            >
              {isPlaying ? <Pause className="w-5 h-5 fill-current" /> : <Play className="w-5 h-5 fill-current ml-0.5" />}
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

            {/* Próximo Episódio (se disponível) */}
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
                {isMuted || volume === 0 ? <VolumeX className="w-4 h-4 sm:w-5 sm:h-5" /> : <Volume2 className="w-4 h-4 sm:w-5 sm:h-5" />}
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
            <div className="text-[11px] sm:text-xs font-mono text-white/70">
              <span>{formatTime(currentTime)}</span>
              <span className="text-white/30"> / </span>
              <span>{formatTime(duration > 0 ? duration : authoritativeDuration)}</span>
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
                      selectedSubtitle === 'pt-BR' ? 'bg-white text-black font-bold' : 'text-white/80 hover:bg-white/10'
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
                      selectedSubtitle === 'en' ? 'bg-white text-black font-bold' : 'text-white/80 hover:bg-white/10'
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
                      selectedSubtitle === 'off' ? 'bg-white text-black font-bold' : 'text-white/80 hover:bg-white/10'
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
                        playbackSpeed === spd ? 'bg-white text-black font-bold' : 'text-white/80 hover:bg-white/10'
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
              {isFullscreen ? <Minimize className="w-4 h-4 sm:w-5 sm:h-5" /> : <Maximize className="w-4 h-4 sm:w-5 sm:h-5" />}
            </button>

          </div>
        </div>

      </div>
    </div>
  );
};
