/**
 * Popoca Streaming - Detail Modal Component
 * Modal imersivo Liquid Glass estilo Apple TV com metadados em Português (pt-BR),
 * contagem exata de temporadas e episódios para séries/animes, integração Letterboxd,
 * Seletor de Prioridade de Tracker e seleção de fontes torrent P2P estáveis em tempo real.
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  Play,
  Star,
  CheckCircle2,
  Clock,
  Heart,
  Bookmark,
  Check,
  ListPlus,
  RefreshCw,
  Tv,
  Cast,
  Sparkles,
  Volume2,
  Radio,
  ShieldCheck,
  RotateCcw,
  ChevronLeft,
  ChevronRight,
  ChevronDown
} from 'lucide-react';
import {
  MediaItem,
  TorrentSource,
  Episode,
  Season,
  CustomList,
  TrackerPriorityMode
} from '../types/index.ts';
import { api, FixedVideoQuality } from '../services/api.ts';
import { letterboxdService } from '../services/letterboxd.ts';
import { storageService } from '../services/storage.ts';
import { LazyImage } from './LazyImage.tsx';

function formatResumeClock(secs: number): string {
  const s = Math.max(0, Math.floor(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const rem = s % 60;
  if (h > 0) {
    return `${h}:${m < 10 ? '0' : ''}${m}:${rem < 10 ? '0' : ''}${rem}`;
  }
  return `${m}:${rem < 10 ? '0' : ''}${rem}`;
}

interface DetailModalProps {
  media: MediaItem | null;
  onClose: () => void;
  onStartPlayback: (
    media: MediaItem,
    torrent: TorrentSource,
    forceTranscode?: boolean,
    episode?: Episode,
    availableTorrents?: TorrentSource[],
    explicitResumeTime?: number,
    openCastImmediately?: boolean
  ) => void;
}

const TRACKER_PRIORITY_OPTIONS: {
  id: TrackerPriorityMode;
  label: string;
  shortLabel: string;
  hint: string;
}[] = [
    {
      id: 'pt-br-stability',
      label: 'PT-BR & Estabilidade',
      shortLabel: 'PT-BR Estável',
      hint: 'Prioriza trackers com maior disponibilidade dublada/dual áudio em português e seeds estáveis'
    },
    {
      id: 'ultra-speed',
      label: 'Ultra Velocidade',
      shortLabel: 'Ultra Rápido',
      hint: 'Prioriza maior taxa de seeds por GB (WEB-DL MP4 leve) para início quase instantâneo'
    },
    {
      id: 'global-balanced',
      label: 'Global Balanceado',
      shortLabel: 'Global',
      hint: 'Equilibra trackers internacionais e brasileiros em todas as resoluções'
    }
  ];

export const DetailModal: React.FC<DetailModalProps> = ({
  media,
  onClose,
  onStartPlayback
}) => {
  if (!media) return null;

  const [hydratedMedia, setHydratedMedia] = useState<MediaItem>(media);
  const [torrents, setTorrents] = useState<TorrentSource[]>([]);
  const [isLoadingTorrents, setIsLoadingTorrents] = useState(false);
  const [trackerPriority, setTrackerPriority] = useState<TrackerPriorityMode>(() =>
    api.getSavedTrackerPriority()
  );
  const [selectedQuality, setSelectedQuality] = useState<'all' | FixedVideoQuality>(() =>
    api.getPreferredQuality()
  );
  const [selectedAudio, setSelectedAudio] = useState<'all' | 'pt-br' | 'original'>('pt-br');
  const [userChangedAudio, setUserChangedAudio] = useState(false);
  const [selectedFormat, setSelectedFormat] = useState<'all' | 'WEB-DL' | 'Bluray'>('all');
  const [forceTranscode] = useState(false);

  // Letterboxd State
  const [userRating, setUserRating] = useState<number>(() => letterboxdService.getRating(media.id)?.rating || 0);
  const [hoverRating, setHoverRating] = useState<number>(0);
  const [isLiked, setIsLiked] = useState<boolean>(() => letterboxdService.isLiked(media.id));
  const [inWatchlist, setInWatchlist] = useState<boolean>(() => letterboxdService.isInWatchlist(media.id));
  const [isWatched, setIsWatched] = useState<boolean>(() => letterboxdService.isWatched(media.id));
  const [reviewText, setReviewText] = useState<string>(() => letterboxdService.getRating(media.id)?.review || '');
  const [reviewSavedToast, setReviewSavedToast] = useState(false);
  const [showAddToList, setShowAddToList] = useState(false);
  const [customLists, setCustomLists] = useState<CustomList[]>(() => letterboxdService.getCustomLists());

  // Seasons & Episodes State com contagem exata e Lazy Loading sob demanda
  const [selectedSeasonNumber, setSelectedSeasonNumber] = useState<number>(1);
  const [selectedEpisodeNumber, setSelectedEpisodeNumber] = useState<number>(1);
  const isSeriesOrAnime =
    hydratedMedia.media_type === 'tv' ||
    hydratedMedia.media_type === 'anime' ||
    (hydratedMedia.seasons && hydratedMedia.seasons.length > 0) ||
    (hydratedMedia.number_of_seasons && hydratedMedia.number_of_seasons > 0);

  const [seasonsState, setSeasonsState] = useState<Season[]>(() => {
    if (media.seasons && media.seasons.length > 0) return media.seasons;
    const num = media.number_of_seasons || 1;
    return Array.from({ length: num }, (_, idx) => ({
      seasonNumber: idx + 1,
      name: `Temporada ${idx + 1}`,
      episodeCount: 0,
      episodes: []
    }));
  });

  const [isLoadingSeasonEpisodes, setIsLoadingSeasonEpisodes] = useState(false);
  const [visibleEpisodeCount, setVisibleEpisodeCount] = useState(30);
  const [expandedEpOverviewId, setExpandedEpOverviewId] = useState<number | null>(null);
  const seasonTabsRef = React.useRef<HTMLDivElement>(null);

  const scrollSeasonTabs = (direction: 'left' | 'right') => {
    if (seasonTabsRef.current) {
      const scrollAmount = direction === 'left' ? -260 : 260;
      seasonTabsRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const currentSeason =
    seasonsState.find((s) => s.seasonNumber === selectedSeasonNumber) || seasonsState[0];
  const currentEpisode =
    currentSeason?.episodes.find((e) => e.episodeNumber === selectedEpisodeNumber) ||
    currentSeason?.episodes[0];

  const totalExactEpisodes = seasonsState.reduce(
    (sum, s) => sum + (s.episodes?.length || s.episodeCount || 0),
    0
  );

  const [copiedTorrentId, setCopiedTorrentId] = useState<string | null>(null);

  // Hidrata detalhes completos (título PT-BR oficial, temporadas e quantidade exata de episódios)
  useEffect(() => {
    let cancelled = false;
    setHydratedMedia(media);
    setVisibleEpisodeCount(30);

    const hasExactSeasons = Boolean(media.seasons && media.seasons.length > 0);
    if (hasExactSeasons && media.seasons) {
      setSeasonsState(media.seasons);
      const firstS = media.seasons[0];
      setSelectedSeasonNumber(firstS.seasonNumber);
      if (firstS.episodes && firstS.episodes.length > 0) {
        setSelectedEpisodeNumber(firstS.episodes[0].episodeNumber);
      }
    }

    async function hydrateFullDetails() {
      try {
        if (media!.media_type === 'tv' || media!.media_type === 'anime') {
          if (!hasExactSeasons) setIsLoadingSeasonEpisodes(true);
        }

        const details = await api.getDetails(media!.id, media!.media_type);
        if (cancelled || !details) return;

        setHydratedMedia((prev) => ({
          ...prev,
          ...details,
          title: details.title || prev.title,
          original_title: details.original_title || prev.original_title,
          imdb_id: details.imdb_id || prev.imdb_id,
          overview: details.overview || prev.overview,
          runtime: details.runtime || prev.runtime
        }));

        if (details.seasons && details.seasons.length > 0) {
          setSeasonsState(details.seasons);
          const firstS = details.seasons[0];
          setSelectedSeasonNumber(firstS.seasonNumber);

          if (firstS.episodes && firstS.episodes.length > 0) {
            setSelectedEpisodeNumber(firstS.episodes[0].episodeNumber);
          } else {
            const eps = await api.getSeason(details.id, firstS.seasonNumber);
            if (!cancelled && eps && eps.length > 0) {
              setSeasonsState((prev) => {
                const next = [...prev];
                const idx = next.findIndex((s) => s.seasonNumber === firstS.seasonNumber);
                if (idx >= 0) {
                  next[idx] = { ...next[idx], episodes: eps, episodeCount: eps.length };
                }
                return next;
              });
              setSelectedEpisodeNumber(eps[0].episodeNumber);
            }
          }
        }
      } catch {
        // Caso offline ou sem detalhes extras, mantém dados do card
      } finally {
        if (!cancelled) setIsLoadingSeasonEpisodes(false);
      }
    }

    hydrateFullDetails();
    return () => {
      cancelled = true;
    };
  }, [media]);

  // Busca fontes torrent indexadas em tempo real respeitando o Seletor de Prioridade de Tracker
  useEffect(() => {
    let isMounted = true;
    async function fetchTorrents() {
      if (!hydratedMedia) return;
      setIsLoadingTorrents(true);
      try {
        const year = hydratedMedia.release_date ? hydratedMedia.release_date.slice(0, 4) : undefined;
        const results = await api.getTorrents(hydratedMedia.title, {
          originalTitle: hydratedMedia.original_title,
          year,
          imdbId: hydratedMedia.imdb_id,
          mediaType: hydratedMedia.media_type,
          season: isSeriesOrAnime ? selectedSeasonNumber : undefined,
          episode: isSeriesOrAnime ? selectedEpisodeNumber : undefined,
          trackerPriority
        });
        if (isMounted) {
          setTorrents(results);
          const hasPt = results.some((t) => t.isPortugueseAudio);
          if (!userChangedAudio) {
            setSelectedAudio(hasPt ? 'pt-br' : results.length > 0 ? 'original' : 'pt-br');
          }
          if (results.length > 0) {
            const best = api.pickBestTorrentSource(results, {
              preferredQuality: selectedQuality,
              preferPortuguese: true
            });
            if (best?.magnetUri) {
              api.preloadTorrent(best.magnetUri, trackerPriority);
              const savedHist = storageService
                .getWatchHistory()
                .find((h) => h.id === hydratedMedia.id);
              if (savedHist && savedHist.currentTime >= 15 && savedHist.progressPercent < 96) {
                const estDur =
                  savedHist.duration > 60
                    ? savedHist.duration
                    : ((hydratedMedia.runtime || 115) * 60);
                api.prefetchNextChunks(best.magnetUri, savedHist.currentTime, estDur).catch(() => { });
              }
            }
          }
        }
      } catch (err) {
        console.warn('Erro ao carregar fontes:', err);
      } finally {
        if (isMounted) setIsLoadingTorrents(false);
      }
    }

    fetchTorrents();
    return () => {
      isMounted = false;
    };
  }, [
    hydratedMedia.id,
    hydratedMedia.title,
    hydratedMedia.original_title,
    hydratedMedia.imdb_id,
    selectedSeasonNumber,
    selectedEpisodeNumber,
    isSeriesOrAnime,
    trackerPriority
  ]);

  const handleChangeTrackerPriority = async (mode: TrackerPriorityMode) => {
    setTrackerPriority(mode);
    await api.setTrackerPriority(mode);
  };

  const handleSeasonChange = async (seasonNum: number) => {
    setSelectedSeasonNumber(seasonNum);
    setVisibleEpisodeCount(30);

    const targetSeason = seasonsState.find((s) => s.seasonNumber === seasonNum);
    if (targetSeason && targetSeason.episodes && targetSeason.episodes.length > 0) {
      setSelectedEpisodeNumber(targetSeason.episodes[0].episodeNumber);
      return;
    }

    setIsLoadingSeasonEpisodes(true);
    try {
      const episodes = await api.getSeason(hydratedMedia.id, seasonNum);
      if (episodes && episodes.length > 0) {
        setSeasonsState((prev) => {
          const next = [...prev];
          const idx = next.findIndex((s) => s.seasonNumber === seasonNum);
          if (idx >= 0) {
            next[idx] = { ...next[idx], episodes, episodeCount: episodes.length };
          } else {
            next.push({
              seasonNumber: seasonNum,
              name: `Temporada ${seasonNum}`,
              episodeCount: episodes.length,
              episodes
            });
            next.sort((a, b) => a.seasonNumber - b.seasonNumber);
          }
          return next;
        });
        setSelectedEpisodeNumber(episodes[0].episodeNumber);
      }
    } catch (err) {
      console.warn('Erro ao carregar episódios da temporada:', err);
    } finally {
      setIsLoadingSeasonEpisodes(false);
    }
  };

  const handleSelectEpisode = (epNum: number) => {
    setSelectedEpisodeNumber(epNum);
  };

  // Contadores para os filtros
  const ptBrCount = torrents.filter((t) => t.isPortugueseAudio).length;
  const origCount = torrents.filter((t) => !t.isPortugueseAudio).length;
  const webdlCount = torrents.filter((t) => t.format === 'WEB-DL').length;
  const blurayCount = torrents.filter((t) => t.format === 'Bluray').length;
  const k4Count = torrents.filter((t) => t.quality === '4K').length;
  const fhdCount = torrents.filter((t) => t.quality === '1080p').length;
  const hdCount = torrents.filter((t) => t.quality === '720p').length;

  const strictFilteredTorrents = torrents.filter((t) => {
    if (selectedQuality !== 'all' && t.quality !== selectedQuality) return false;
    if (selectedAudio === 'pt-br' && !t.isPortugueseAudio) return false;
    if (selectedAudio === 'original' && t.isPortugueseAudio) return false;
    if (selectedFormat === 'WEB-DL' && t.format !== 'WEB-DL') return false;
    if (selectedFormat === 'Bluray' && t.format !== 'Bluray') return false;
    return true;
  });

  // Se o idioma escolhido (ex: PT-BR) existir em outra resolução diferente da travada (ex: só 720p),
  // exibe as opções daquele MESMO idioma sem misturar inglês com português!
  const languageOnlyTorrents = torrents.filter((t) => {
    if (selectedAudio === 'pt-br' && !t.isPortugueseAudio) return false;
    if (selectedAudio === 'original' && t.isPortugueseAudio) return false;
    if (selectedFormat === 'WEB-DL' && t.format !== 'WEB-DL') return false;
    if (selectedFormat === 'Bluray' && t.format !== 'Bluray') return false;
    return true;
  });

  const filteredTorrents =
    strictFilteredTorrents.length > 0 ? strictFilteredTorrents : languageOnlyTorrents;

  const handleSelectFixedQuality = (q: 'all' | FixedVideoQuality) => {
    setSelectedQuality(q);
    if (q !== 'all') {
      api.setPreferredQuality(q);
    }
  };

  const handleSelectAudioFilter = (audio: 'all' | 'pt-br' | 'original') => {
    setUserChangedAudio(true);
    setSelectedAudio(audio);
  };

  const year = hydratedMedia.release_date ? hydratedMedia.release_date.slice(0, 4) : '';

  const handleRate = (stars: number) => {
    setUserRating(stars);
    letterboxdService.rateMovie(hydratedMedia, stars, reviewText, isLiked);
    setIsWatched(true);
    showToast();
  };

  const handleSaveReview = () => {
    letterboxdService.rateMovie(hydratedMedia, userRating || 4, reviewText, isLiked);
    setIsWatched(true);
    showToast();
  };

  const handleToggleLike = () => {
    const newState = letterboxdService.toggleLike(hydratedMedia);
    setIsLiked(newState);
  };

  const handleToggleWatched = () => {
    if (isWatched) {
      letterboxdService.removeWatched(hydratedMedia.id);
      setIsWatched(false);
    } else {
      letterboxdService.markWatched(hydratedMedia, true);
      setIsWatched(true);
    }
  };

  const handleToggleWatchlist = () => {
    const newState = letterboxdService.toggleWatchlist(hydratedMedia);
    setInWatchlist(newState);
  };

  const handleAddMovieToList = (listId: string) => {
    letterboxdService.addToList(listId, hydratedMedia);
    setShowAddToList(false);
    setCustomLists(letterboxdService.getCustomLists());
    showToast();
  };

  const handleCopyMagnet = (t: TorrentSource) => {
    if (t.magnetUri) {
      navigator.clipboard.writeText(t.magnetUri).catch(() => { });
      setCopiedTorrentId(t.id);
      setTimeout(() => setCopiedTorrentId(null), 2000);
    }
  };

  const showToast = () => {
    setReviewSavedToast(true);
    setTimeout(() => setReviewSavedToast(false), 2400);
  };

  // Escolhe a fonte mais estável respeitando estritamente o idioma selecionado (PT-BR por padrão) + qualidade fixa
  const pickBestStableTorrent = (): TorrentSource | undefined => {
    const preferPt = selectedAudio !== 'original';
    return (
      api.pickBestTorrentSource(torrents, {
        preferredQuality: selectedQuality,
        preferPortuguese: preferPt
      }) || filteredTorrents[0]
    );
  };

  // Iniciar reprodução de um episódio específico direto
  const handlePlayEpisode = (episode: Episode, openCastImmediately?: boolean) => {
    setSelectedEpisodeNumber(episode.episodeNumber);
    const chosen = pickBestStableTorrent();
    const targetQuality = selectedQuality !== 'all' ? selectedQuality : (chosen?.quality || '1080p');
    const defaultTorrent: TorrentSource = chosen || {
      id: `ep-${episode.id}`,
      title: `${hydratedMedia.title} - S${episode.seasonNumber}E${episode.episodeNumber} [${targetQuality} WEB-DL Dublado PT-BR]`,
      magnetUri: '',
      infoHash: '',
      quality: targetQuality,
      format: 'WEB-DL',
      seeds: 950,
      peers: 160,
      sizeBytes: 1250000000,
      sizeFormatted: '1.25 GB',
      isPortugueseAudio: true,
      source: 'Rede P2P Popoca Brasil',
      trackerPriority,
      directUrl: episode.streamUrl
    };
    onStartPlayback(
      hydratedMedia,
      defaultTorrent,
      forceTranscode,
      episode,
      torrents,
      undefined,
      openCastImmediately
    );
  };

  const savedHistoryEntry = storageService.getWatchHistory().find((h) => {
    if (h.id !== hydratedMedia.id) return false;
    if (isSeriesOrAnime) {
      return (
        (h.seasonNumber || 1) === selectedSeasonNumber &&
        (h.episodeNumber || 1) === selectedEpisodeNumber
      );
    }
    return true;
  });
  const canResumeSavedPoint = Boolean(
    savedHistoryEntry &&
    savedHistoryEntry.currentTime >= 15 &&
    savedHistoryEntry.progressPercent < 96
  );

  // Iniciar reprodução selecionando um torrent específico
  const handlePlaySelectedTorrent = (
    torrent: TorrentSource,
    explicitResumeTime?: number,
    openCastImmediately?: boolean
  ) => {
    onStartPlayback(
      hydratedMedia,
      torrent,
      forceTranscode,
      isSeriesOrAnime ? currentEpisode : undefined,
      torrents,
      explicitResumeTime,
      openCastImmediately
    );
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-2 sm:p-4 md:p-6 overflow-y-auto bg-black/85 backdrop-blur-2xl animate-in fade-in duration-200">
      {/* Toast Feedback */}
      {reviewSavedToast && (
        <div className="fixed top-6 right-6 z-50 glass-dropdown px-4 py-2.5 rounded-xl text-xs font-semibold text-slate-900 dark:text-white border border-slate-200 dark:border-white/20 shadow-2xl flex items-center gap-2 animate-in slide-in-from-top">
          <CheckCircle2 className="w-4 h-4 text-emerald-500" />
          <span>Salvo no perfil!</span>
        </div>
      )}

      {/* Container Principal Glassmorphic */}
      <div className="relative w-full max-w-4xl max-h-[94vh] overflow-y-auto glass-panel rounded-2xl sm:rounded-3xl border border-white/60 dark:border-white/[0.08] shadow-2xl flex flex-col my-auto box-border text-slate-900 dark:text-white">
        {/* Botão Fechar */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 sm:top-4 sm:right-4 z-30 w-9 h-9 sm:w-10 sm:h-10 rounded-full glass-dropdown flex items-center justify-center text-slate-700 hover:text-black dark:text-white/70 dark:hover:text-white transition-colors"
          aria-label="Fechar modal"
        >
          <X className="w-4 h-4 sm:w-5 sm:h-5" />
        </button>

        {/* Banner Cinematográfico Limpo */}
        <div className="relative h-48 sm:h-64 md:h-72 w-full overflow-hidden shrink-0 rounded-t-2xl sm:rounded-t-3xl">
          <LazyImage
            src={hydratedMedia.backdrop_path}
            alt={hydratedMedia.title}
            title={hydratedMedia.title}
            aspectRatio="auto"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-white/95 via-transparent to-black/30 dark:from-[#0e1117] dark:via-[#0e1117]/40 dark:to-transparent" />
        </div>

        {/* Corpo do Conteúdo */}
        <div className="relative px-4 sm:px-8 pb-8 pt-4 z-10 flex flex-col items-center text-center max-w-3xl mx-auto space-y-6 box-border w-full">
          {/* Dados & Título em Português Centralizados */}
          <div className="space-y-3 w-full flex flex-col items-center">
            <div className="flex items-center justify-center gap-2 flex-wrap text-xs text-slate-600 dark:text-white/60">
              {year && <span className="font-mono">{year}</span>}
              {hydratedMedia.runtime && <span>· {hydratedMedia.runtime} min</span>}
              {isSeriesOrAnime && (
                <span className="px-2 py-0.5 rounded-md bg-slate-200/80 dark:bg-white/10 text-slate-800 dark:text-white font-semibold">
                  {seasonsState.length || 1} {seasonsState.length > 1 ? 'Temporadas' : 'Temporada'}
                  {totalExactEpisodes > 0 ? ` · ${totalExactEpisodes} eps` : ''}
                </span>
              )}
              {hydratedMedia.vote_average > 0 && (
                <span className="flex items-center gap-1 text-amber-500 dark:text-amber-400 font-mono font-bold">
                  <Star className="w-3.5 h-3.5 fill-current" />
                  {hydratedMedia.vote_average.toFixed(1)}
                </span>
              )}
            </div>

            <h1 className="text-2xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight break-words text-center">
              {hydratedMedia.title}
            </h1>

            {hydratedMedia.original_title && hydratedMedia.original_title !== hydratedMedia.title && (
              <p className="text-xs text-slate-500 dark:text-white/40 italic mt-0.5 break-words text-center">
                Título original: {hydratedMedia.original_title}
              </p>
            )}

            {/* Gêneros Centralizados */}
            {hydratedMedia.genres && hydratedMedia.genres.length > 0 && (
              <div className="flex items-center justify-center gap-1.5 flex-wrap pt-0.5">
                {hydratedMedia.genres.map((g) => (
                  <span
                    key={g.id}
                    className="text-[11px] font-medium px-2.5 py-0.5 rounded-full bg-slate-200/70 dark:bg-white/[0.06] text-slate-800 dark:text-white/80 border border-slate-300/60 dark:border-white/[0.04]"
                  >
                    {g.name}
                  </span>
                ))}
              </div>
            )}

            {/* Sinopse Centralizada */}
            <p className="text-xs sm:text-sm text-slate-700 dark:text-white/80 leading-relaxed break-words text-center max-w-2xl pt-1">
              {hydratedMedia.overview || 'Sinopse oficial em sincronização com o catálogo em português.'}
            </p>

            {/* Seletor Rápido: 3 Qualidades Fixas (720p · 1080p Padrão · 4K) + Idioma Separado (PT-BR vs Original) */}
            <div className="pt-2 flex flex-col items-center gap-3 w-full">
              <div className="flex flex-wrap items-center justify-center gap-2">
                {/* Separação Clara de Idioma */}
                <div className="flex items-center gap-1 p-1 rounded-full glass-subtle border border-slate-200/80 dark:border-white/10">
                  <button
                    type="button"
                    onClick={() => handleSelectAudioFilter('pt-br')}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-1.5 ${selectedAudio === 'pt-br'
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-black shadow-sm'
                        : 'text-slate-700 dark:text-white/70 hover:text-black dark:hover:text-white'
                      }`}
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>Dublado PT-BR {torrents.length > 0 ? `(${ptBrCount})` : ''}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSelectAudioFilter('original')}
                    className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all ${selectedAudio === 'original'
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-black shadow-sm'
                        : 'text-slate-700 dark:text-white/70 hover:text-black dark:hover:text-white'
                      }`}
                  >
                    Original / Inglês {torrents.length > 0 ? `(${origCount})` : ''}
                  </button>
                </div>

                {/* 3 Opções de Qualidade Fixa (Sem trocar seed sozinho) */}
                <div className="flex items-center gap-1 p-1 rounded-full glass-subtle border border-slate-200/80 dark:border-white/10">
                  {(
                    [
                      { id: '720p', label: '720p', sub: 'Leve' },
                      { id: '1080p', label: '1080p', sub: 'Padrão' },
                      { id: '4K', label: '4K', sub: 'Ultra' }
                    ] as const
                  ).map((q) => {
                    const active = selectedQuality === q.id;
                    return (
                      <button
                        key={q.id}
                        type="button"
                        onClick={() => handleSelectFixedQuality(q.id)}
                        className={`px-3 py-1.5 rounded-full text-xs font-bold transition-all flex items-center gap-1 ${active
                            ? 'bg-slate-900 text-white dark:bg-white dark:text-black shadow-sm'
                            : 'text-slate-700 dark:text-white/70 hover:text-black dark:hover:text-white'
                          }`}
                      >
                        <span>{q.label}</span>
                        <span className={`text-[10px] font-medium ${active ? 'opacity-75' : 'opacity-50'}`}>
                          · {q.sub}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Botão de Destaque Assistir Agora / Continuar de Onde Parou */}
              <div className="flex items-center justify-center gap-2.5 flex-wrap">
                <button
                  type="button"
                  onClick={() => {
                    const resumePoint = canResumeSavedPoint ? savedHistoryEntry!.currentTime : 0;
                    const chosen = pickBestStableTorrent();
                    if (chosen) {
                      handlePlaySelectedTorrent(chosen, resumePoint);
                    } else if (isSeriesOrAnime && currentEpisode) {
                      handlePlayEpisode(currentEpisode);
                    }
                  }}
                  disabled={isLoadingTorrents && torrents.length === 0}
                  className="px-7 py-3 bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-neutral-200 dark:text-black font-extrabold text-sm rounded-full shadow-xl flex items-center gap-2 active:scale-95 transition-all disabled:opacity-50 cursor-pointer"
                >
                  <Play className="w-4 h-4 fill-current" />
                  <span>
                    {canResumeSavedPoint
                      ? `Continuar de ${formatResumeClock(savedHistoryEntry!.currentTime)}${selectedQuality !== 'all' ? ` · ${selectedQuality}` : ''
                      }`
                      : `Assistir em ${selectedAudio === 'original' ? 'Inglês' : 'Português'}${selectedQuality !== 'all' ? ` · ${selectedQuality}` : ''
                      }`}
                  </span>
                </button>

                {canResumeSavedPoint && (
                  <button
                    type="button"
                    onClick={() => {
                      const chosen = pickBestStableTorrent();
                      if (chosen) {
                        handlePlaySelectedTorrent(chosen, 0);
                      } else if (isSeriesOrAnime && currentEpisode) {
                        handlePlayEpisode(currentEpisode);
                      }
                    }}
                    disabled={isLoadingTorrents && torrents.length === 0}
                    className="px-4 py-3 rounded-full glass-subtle border border-slate-200/80 dark:border-white/15 text-xs font-bold text-slate-800 dark:text-white/90 hover:opacity-85 flex items-center gap-1.5 transition-all cursor-pointer"
                    title="Começar a reprodução desde o início (00:00)"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Do Início</span>
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    const resumePoint = canResumeSavedPoint ? savedHistoryEntry!.currentTime : 0;
                    const chosen = pickBestStableTorrent();
                    if (chosen) {
                      handlePlaySelectedTorrent(chosen, resumePoint, true);
                    } else if (isSeriesOrAnime && currentEpisode) {
                      handlePlayEpisode(currentEpisode, true);
                    }
                  }}
                  disabled={isLoadingTorrents && torrents.length === 0}
                  className="px-4 py-3 rounded-full glass-subtle border border-slate-300 dark:border-white/20 text-xs font-bold text-slate-800 dark:text-white hover:bg-slate-200/50 dark:hover:bg-white/10 flex items-center gap-2 transition-all cursor-pointer shadow-md active:scale-95 disabled:opacity-50"
                  title="Transmitir para Smart TV, Chromecast ou Web Video Caster"
                >
                  <Cast className="w-4 h-4 text-slate-700 dark:text-white" />
                  <span>Transmitir</span>
                </button>
              </div>
            </div>
          </div>

          {/* Seção Letterboxd (Avaliação, Favoritos, Watchlist, Listas) */}
          <div className="p-3.5 sm:p-4 rounded-2xl glass-subtle border border-slate-200/80 dark:border-white/[0.06] space-y-3 w-full text-left">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-white/80 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-slate-600 dark:text-neutral-300" />
                Perfil & Avaliação Letterboxd
              </span>

              <div className="flex items-center gap-1.5 flex-wrap">
                <button
                  onClick={handleToggleWatched}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${isWatched
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-black font-bold shadow-md'
                      : 'glass-subtle text-slate-700 hover:text-black dark:text-white/70 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10'
                    }`}
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>{isWatched ? 'Já Visto' : 'Marcar Visto'}</span>
                </button>

                <button
                  onClick={handleToggleLike}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${isLiked
                      ? 'bg-slate-900 text-white dark:bg-neutral-200 dark:text-black font-bold shadow-md'
                      : 'glass-subtle text-slate-700 hover:text-black dark:text-white/70 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10'
                    }`}
                >
                  <Heart className={`w-3.5 h-3.5 ${isLiked ? 'fill-current' : ''}`} />
                  <span>{isLiked ? 'Curtido' : 'Curtir'}</span>
                </button>

                <button
                  onClick={handleToggleWatchlist}
                  className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${inWatchlist
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-black font-bold shadow-md'
                      : 'glass-subtle text-slate-700 hover:text-black dark:text-white/70 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10'
                    }`}
                >
                  <Bookmark className={`w-3.5 h-3.5 ${inWatchlist ? 'fill-current' : ''}`} />
                  <span>Watchlist</span>
                </button>

                <div className="relative">
                  <button
                    onClick={() => setShowAddToList(!showAddToList)}
                    className="px-3 py-1.5 rounded-xl text-xs font-semibold glass-subtle text-slate-700 hover:text-black dark:text-white/70 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10 flex items-center gap-1.5 transition-all"
                  >
                    <ListPlus className="w-3.5 h-3.5" />
                    <span>Listas</span>
                  </button>

                  {showAddToList && (
                    <div className="absolute right-0 top-10 w-56 glass-dropdown rounded-xl p-2 z-50 border border-slate-200 dark:border-white/10 shadow-2xl bg-white/95 dark:bg-[#12141a]/95 text-slate-900 dark:text-white">
                      <div className="text-[11px] font-bold text-slate-500 dark:text-white/50 px-2 py-1">Adicionar à lista:</div>
                      {customLists.map((cl) => (
                        <button
                          key={cl.id}
                          onClick={() => handleAddMovieToList(cl.id)}
                          className="w-full text-left px-2.5 py-1.5 text-xs text-slate-800 dark:text-white/80 hover:bg-slate-100 dark:hover:bg-white/10 rounded-lg truncate transition-colors"
                        >
                          + {cl.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Avaliação em Estrelas */}
            <div className="flex items-center gap-2 pt-1 flex-wrap">
              <span className="text-xs text-slate-600 dark:text-white/60">Sua nota:</span>
              <div className="flex items-center gap-1">
                {[1, 2, 3, 4, 5].map((star) => (
                  <button
                    key={star}
                    type="button"
                    onMouseEnter={() => setHoverRating(star)}
                    onMouseLeave={() => setHoverRating(0)}
                    onClick={() => handleRate(star)}
                    className="p-1 text-amber-400 hover:scale-125 transition-transform"
                  >
                    <Star
                      className={`w-5 h-5 ${(hoverRating || userRating) >= star ? 'fill-current' : 'text-slate-300 dark:text-white/20'
                        }`}
                    />
                  </button>
                ))}
              </div>
              {userRating > 0 && (
                <span className="text-xs font-mono font-bold text-amber-400">
                  {userRating.toFixed(1)} / 5.0
                </span>
              )}
            </div>

            {/* Caixa de Resenha */}
            <div className="pt-2 flex gap-2 w-full">
              <input
                type="text"
                placeholder="Deixe uma resenha curta ou diário..."
                value={reviewText}
                onChange={(e) => setReviewText(e.target.value)}
                className="flex-1 min-w-0 text-xs px-3 py-2 rounded-xl bg-white/70 dark:bg-white/[0.05] border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-white/40 focus:outline-none focus:bg-white dark:focus:bg-white/[0.08] shadow-sm"
              />
              <button
                onClick={handleSaveReview}
                className="px-4 py-2 bg-slate-900 text-white dark:bg-white dark:text-black font-bold text-xs rounded-xl shadow-md shrink-0 hover:bg-slate-800 dark:hover:bg-neutral-200 transition-colors"
              >
                Salvar
              </button>
            </div>
          </div>

          {/* SELETOR DE TEMPORADAS E EPISÓDIOS COM CONTAGEM EXATA */}
          {isSeriesOrAnime && seasonsState.length > 0 && (
            <div className="space-y-3 pt-2 w-full text-left">
              <div className="flex items-center justify-between flex-wrap gap-2.5">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Tv className="w-4 h-4 text-slate-700 dark:text-white/70" />
                  <span>
                    Temporadas & Episódios ({seasonsState.length}{' '}
                    {seasonsState.length === 1 ? 'temporada' : 'temporadas'}
                    {currentSeason && (currentSeason.episodes.length || currentSeason.episodeCount) > 0
                      ? ` · ${currentSeason.episodes.length || currentSeason.episodeCount} eps`
                      : ''}
                    )
                  </span>
                </h3>

                {/* Dropdown de Acesso Imediato + Setas de Rolagem */}
                <div className="flex items-center gap-2">
                  <div className="relative">
                    <select
                      value={selectedSeasonNumber}
                      onChange={(e) => handleSeasonChange(Number(e.target.value))}
                      className="appearance-none pl-3 pr-8 py-1.5 text-xs font-bold rounded-xl bg-slate-900 text-white dark:bg-white dark:text-black border border-slate-700 dark:border-white/20 shadow-md cursor-pointer focus:outline-none"
                    >
                      {seasonsState.map((s) => (
                        <option
                          key={s.seasonNumber}
                          value={s.seasonNumber}
                          className="bg-neutral-900 text-white"
                        >
                          {s.name || `Temporada ${s.seasonNumber}`} ({s.episodes?.length || s.episodeCount || 0} eps)
                        </option>
                      ))}
                    </select>
                    <ChevronDown className="w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none opacity-70" />
                  </div>

                  <div className="hidden sm:flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => scrollSeasonTabs('left')}
                      className="p-1.5 rounded-lg glass-subtle hover:bg-slate-300 dark:hover:bg-white/10 text-slate-700 dark:text-white cursor-pointer"
                      title="Rolar temporadas para a esquerda"
                    >
                      <ChevronLeft className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => scrollSeasonTabs('right')}
                      className="p-1.5 rounded-lg glass-subtle hover:bg-slate-300 dark:hover:bg-white/10 text-slate-700 dark:text-white cursor-pointer"
                      title="Rolar temporadas para a direita"
                    >
                      <ChevronRight className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>

              {/* Abas Horizontais com Suporte a Touch e Rolagem Suave */}
              <div
                ref={seasonTabsRef}
                className="flex items-center gap-1.5 p-1 bg-slate-200/70 dark:bg-white/[0.05] rounded-xl overflow-x-auto touch-pan-x scroll-smooth no-scrollbar max-w-full"
              >
                {seasonsState.map((s) => {
                  const epTotal = s.episodes?.length || s.episodeCount || 0;
                  const shortLabel = s.name.split(':')[0] || `Temp. ${s.seasonNumber}`;
                  return (
                    <button
                      key={s.seasonNumber}
                      onClick={() => handleSeasonChange(s.seasonNumber)}
                      className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap flex items-center gap-1.5 cursor-pointer shrink-0 ${selectedSeasonNumber === s.seasonNumber
                          ? 'bg-slate-900 text-white dark:bg-white dark:text-black font-bold shadow-md'
                          : 'text-slate-600 dark:text-white/60 hover:text-black dark:hover:text-white hover:bg-slate-300/50 dark:hover:bg-white/10'
                        }`}
                    >
                      <span>{shortLabel}</span>
                      {epTotal > 0 && (
                        <span
                          className={`text-[10px] font-mono px-1.5 py-0.2 rounded-md ${selectedSeasonNumber === s.seasonNumber
                              ? 'bg-white/20 dark:bg-black/15'
                              : 'bg-slate-300/70 dark:bg-white/10'
                            }`}
                        >
                          {epTotal}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {isLoadingSeasonEpisodes ? (
                <div className="py-10 rounded-2xl glass-subtle flex flex-col items-center justify-center text-slate-500 dark:text-white/50 text-xs gap-2.5 border border-slate-200/80 dark:border-white/[0.06]">
                  <RefreshCw className="w-5 h-5 animate-spin text-slate-900 dark:text-white" />
                  <span className="font-medium">
                    Sincronizando episódios exatos da Temporada {selectedSeasonNumber}...
                  </span>
                </div>
              ) : currentSeason && currentSeason.episodes.length > 0 ? (
                <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                  {currentSeason.episodes.slice(0, visibleEpisodeCount).map((ep) => {
                    const isSelected = selectedEpisodeNumber === ep.episodeNumber;
                    const isExpanded = expandedEpOverviewId === ep.id;
                    return (
                      <div
                        key={ep.id}
                        onClick={() => handleSelectEpisode(ep.episodeNumber)}
                        className={`p-2.5 sm:p-3 rounded-xl cursor-pointer transition-all border flex flex-col gap-2 shadow-sm ${isSelected
                            ? 'bg-slate-100 dark:bg-white/[0.1] border-slate-900/30 dark:border-white/30 ring-1 ring-slate-900/10 dark:ring-white/20'
                            : 'glass-subtle hover:bg-white/80 dark:hover:bg-white/[0.07] border-slate-200/80 dark:border-white/[0.05]'
                          }`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
                            {/* Miniatura do Episódio com Número */}
                            <div className="w-16 h-11 sm:w-20 sm:h-12 rounded-lg overflow-hidden shrink-0 bg-black/30 dark:bg-black/50 relative border border-slate-200/50 dark:border-white/10">
                              {ep.stillPath ? (
                                <img
                                  src={ep.stillPath}
                                  alt={ep.title}
                                  className="w-full h-full object-cover"
                                  loading="lazy"
                                />
                              ) : (
                                <div className="w-full h-full flex items-center justify-center font-mono font-bold text-xs bg-slate-200 dark:bg-white/10 text-slate-700 dark:text-white">
                                  {ep.episodeNumber}
                                </div>
                              )}
                              <div className="absolute top-1 left-1 px-1 rounded bg-black/75 text-[9px] font-mono font-bold text-white shadow-sm">
                                #{ep.episodeNumber}
                              </div>
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                                  {ep.title}
                                </h4>
                                {isSelected && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 shrink-0">
                                    Selecionado
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2.5 text-[11px] text-slate-500 dark:text-white/50 mt-0.5">
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {ep.durationMinutes || 24} min
                                </span>
                                {ep.overview && (
                                  <button
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setExpandedEpOverviewId(isExpanded ? null : ep.id);
                                    }}
                                    className="text-[10px] underline underline-offset-2 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                                  >
                                    {isExpanded ? 'Ocultar sinopse' : 'Ver sinopse'}
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-1.5 shrink-0">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePlayEpisode(ep, true);
                              }}
                              className="p-2 rounded-xl glass-subtle border border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15 transition-all cursor-pointer"
                              title="Transmitir este episódio"
                            >
                              <Cast className="w-3.5 h-3.5" />
                            </button>

                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handlePlayEpisode(ep);
                              }}
                              className="flex items-center gap-1 px-3 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-black text-xs font-extrabold rounded-xl shadow-md transition-transform active:scale-95 cursor-pointer"
                            >
                              <Play className="w-3 h-3 fill-current" />
                              <span className="hidden sm:inline">Assistir</span>
                            </button>
                          </div>
                        </div>

                        {/* Sinopse Expansível do Episódio */}
                        {isExpanded && ep.overview && (
                          <div className="p-2.5 rounded-lg bg-black/5 dark:bg-white/[0.04] text-[11px] text-slate-600 dark:text-white/70 leading-relaxed border border-slate-200/50 dark:border-white/5 animate-in fade-in">
                            {ep.overview}
                          </div>
                        )}
                      </div>
                    );
                  })}

                  {currentSeason.episodes.length > visibleEpisodeCount && (
                    <button
                      type="button"
                      onClick={() => setVisibleEpisodeCount((prev) => prev + 30)}
                      className="w-full py-2.5 mt-2 rounded-xl glass-subtle text-xs font-bold text-slate-700 dark:text-white/80 hover:text-black dark:hover:text-white border border-slate-200 dark:border-white/10 transition-colors"
                    >
                      Carregar mais episódios ({currentSeason.episodes.length - visibleEpisodeCount} restantes)
                    </button>
                  )}
                </div>
              ) : (
                <div className="p-4 rounded-xl glass-subtle text-xs text-slate-500 dark:text-white/50 text-center">
                  Episódios em sincronização para esta temporada.
                </div>
              )}
            </div>
          )}

          {/* SELEÇÃO DE STREAMING P2P COM SELETOR DE PRIORIDADE DE TRACKER E FILTROS */}
          <div className="space-y-3.5 pt-3 border-t border-slate-200/80 dark:border-white/[0.08] w-full text-left">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <h3 className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-500 shrink-0" />
                  <span>Opções de Streaming ({filteredTorrents.length})</span>
                </h3>
                {isSeriesOrAnime && currentEpisode && (
                  <p className="text-xs text-emerald-600 dark:text-emerald-400 font-medium mt-0.5">
                    Fontes para Temporada {selectedSeasonNumber} · Episódio {selectedEpisodeNumber}: "{currentEpisode.title}"
                  </p>
                )}
              </div>

              {(selectedAudio !== 'all' || selectedFormat !== 'all' || selectedQuality !== 'all') && (
                <button
                  onClick={() => {
                    setSelectedAudio('all');
                    setSelectedFormat('all');
                    setSelectedQuality('all');
                  }}
                  className="text-[11px] font-semibold text-slate-500 hover:text-black dark:text-white/50 dark:hover:text-white underline self-start sm:self-auto transition-colors"
                >
                  Limpar Filtros
                </button>
              )}
            </div>

            {/* Seletor de Prioridade de Tracker (PT-BR Estabilidade / Ultra Velocidade / Global) */}
            <div className="p-2.5 rounded-2xl glass-subtle border border-slate-200/80 dark:border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-white/80">
                <Radio className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                <span>Prioridade de Tracker:</span>
              </div>
              <div className="flex items-center gap-1 flex-wrap">
                {TRACKER_PRIORITY_OPTIONS.map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    title={opt.hint}
                    onClick={() => handleChangeTrackerPriority(opt.id)}
                    className={`px-2.5 py-1 text-[11px] font-bold rounded-lg transition-all ${trackerPriority === opt.id
                        ? 'bg-emerald-600 text-white shadow-sm ring-1 ring-emerald-400/40'
                        : 'text-slate-600 dark:text-white/60 hover:text-black dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10'
                      }`}
                  >
                    {opt.shortLabel}
                  </button>
                ))}
              </div>
            </div>

            {/* Barra de Filtros Responsiva */}
            <div className="flex flex-wrap items-center gap-2 max-w-full">
              {/* 1. Filtro Idioma (PT-BR) */}
              <div className="flex items-center gap-1 p-1 bg-slate-200/80 dark:bg-white/[0.05] rounded-xl border border-slate-300/60 dark:border-white/[0.06] overflow-x-auto no-scrollbar max-w-full">
                <button
                  onClick={() => handleSelectAudioFilter('all')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg whitespace-nowrap transition-all ${selectedAudio === 'all'
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-black shadow-sm font-bold'
                      : 'text-slate-600 dark:text-white/60 hover:text-black dark:hover:text-white'
                    }`}
                >
                  Todos ({torrents.length})
                </button>
                <button
                  onClick={() => handleSelectAudioFilter('pt-br')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg whitespace-nowrap transition-all flex items-center gap-1.5 ${selectedAudio === 'pt-br'
                      ? 'bg-emerald-600 text-white font-bold shadow-md ring-1 ring-emerald-400/40'
                      : 'text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10'
                    }`}
                >
                  <Volume2 className="w-3.5 h-3.5 shrink-0" />
                  <span>PT-BR ({ptBrCount})</span>
                </button>
                <button
                  onClick={() => handleSelectAudioFilter('original')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg whitespace-nowrap transition-all ${selectedAudio === 'original'
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-black shadow-sm font-bold'
                      : 'text-slate-600 dark:text-white/60 hover:text-black dark:hover:text-white'
                    }`}
                >
                  Original ({origCount})
                </button>
              </div>

              {/* 2. Filtro Formato (WEB-DL vs Bluray) */}
              <div className="flex items-center gap-1 p-1 bg-slate-200/80 dark:bg-white/[0.05] rounded-xl border border-slate-300/60 dark:border-white/[0.06] overflow-x-auto no-scrollbar max-w-full">
                <button
                  onClick={() => setSelectedFormat('all')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg whitespace-nowrap transition-all ${selectedFormat === 'all'
                      ? 'bg-slate-900 text-white dark:bg-white dark:text-black shadow-sm font-bold'
                      : 'text-slate-600 dark:text-white/60 hover:text-black dark:hover:text-white'
                    }`}
                >
                  Formatos ({torrents.length})
                </button>
                <button
                  onClick={() => setSelectedFormat('WEB-DL')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg whitespace-nowrap transition-all flex items-center gap-1 ${selectedFormat === 'WEB-DL'
                      ? 'bg-sky-600 text-white font-bold shadow-md ring-1 ring-sky-400/40'
                      : 'text-sky-700 dark:text-sky-400 hover:bg-sky-500/10'
                    }`}
                >
                  <span>WEB-DL ({webdlCount})</span>
                </button>
                <button
                  onClick={() => setSelectedFormat('Bluray')}
                  className={`px-2.5 py-1 text-xs font-semibold rounded-lg whitespace-nowrap transition-all flex items-center gap-1 ${selectedFormat === 'Bluray'
                      ? 'bg-purple-600 text-white font-bold shadow-md ring-1 ring-purple-400/40'
                      : 'text-purple-700 dark:text-purple-400 hover:bg-purple-500/10'
                    }`}
                >
                  <span>BluRay ({blurayCount})</span>
                </button>
              </div>

              {/* 3. Filtro Qualidade */}
              <div className="flex items-center gap-1 p-1 bg-slate-200/80 dark:bg-white/[0.05] rounded-xl border border-slate-300/60 dark:border-white/[0.06] overflow-x-auto no-scrollbar max-w-full">
                {(
                  [
                    { id: 'all', label: 'Todas' },
                    { id: '720p', label: `720p (${hdCount})` },
                    { id: '1080p', label: `1080p (${fhdCount})` },
                    { id: '4K', label: `4K (${k4Count})` }
                  ] as const
                ).map((q) => (
                  <button
                    key={q.id}
                    onClick={() => handleSelectFixedQuality(q.id)}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg whitespace-nowrap transition-all ${selectedQuality === q.id
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-black shadow-sm font-bold'
                        : 'text-slate-600 dark:text-white/60 hover:text-black dark:hover:text-white'
                      }`}
                  >
                    {q.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Lista de Torrents com Indicador de Estabilidade */}
            {isLoadingTorrents ? (
              <div className="py-8 flex flex-col items-center justify-center text-slate-500 dark:text-white/40 text-xs gap-2">
                <RefreshCw className="w-5 h-5 animate-spin text-slate-700 dark:text-white" />
                <span>Priorizando trackers estáveis e fontes em português em tempo real...</span>
              </div>
            ) : filteredTorrents.length > 0 ? (
              <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                {filteredTorrents.map((torrent, idx) => (
                  <div
                    key={torrent.id}
                    className="p-3.5 rounded-2xl glass-subtle hover:bg-slate-100/90 dark:hover:bg-white/[0.07] border border-slate-200/80 dark:border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all shadow-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                        {idx === 0 && (
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30 flex items-center gap-1">
                            <ShieldCheck className="w-3 h-3" />
                            <span>Mais Estável</span>
                          </span>
                        )}

                        <span
                          className={`text-[11px] font-bold px-2 py-0.5 rounded-md font-mono ${torrent.format === 'WEB-DL'
                              ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/25'
                              : 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/25'
                            }`}
                        >
                          {torrent.format || 'WEB-DL'}
                        </span>

                        {torrent.isPortugueseAudio ? (
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border border-emerald-500/25 flex items-center gap-1">
                            <Volume2 className="w-3 h-3" />
                            <span>Dublado PT-BR</span>
                          </span>
                        ) : (
                          <span className="text-[11px] font-medium px-2 py-0.5 rounded-md bg-slate-200 dark:bg-white/10 text-slate-600 dark:text-white/60">
                            Áudio Original
                          </span>
                        )}

                        <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-slate-900/10 dark:bg-white/10 text-slate-900 dark:text-white font-mono">
                          {torrent.quality}
                        </span>

                        <span className="text-[11px] font-mono text-slate-500 dark:text-white/50">
                          {torrent.sizeFormatted}
                        </span>
                      </div>

                      <h4 className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white truncate" title={torrent.title}>
                        {torrent.title}
                      </h4>

                      <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-white/50 mt-1 font-mono flex-wrap">
                        <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold">
                          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          {torrent.seeds} seeds
                        </span>
                        <span>·</span>
                        <span>{torrent.peers} peers</span>
                        <span>·</span>
                        <span className="text-slate-400 dark:text-white/40 truncate max-w-[180px]">
                          {torrent.source}
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-end sm:self-center">
                      {torrent.magnetUri && (
                        <button
                          type="button"
                          onClick={() => handleCopyMagnet(torrent)}
                          className="px-2.5 py-2 rounded-xl text-xs font-semibold glass-subtle text-slate-600 hover:text-black dark:text-white/60 dark:hover:text-white border border-slate-200 dark:border-white/10 transition-colors"
                          title="Copiar Magnet Link"
                        >
                          {copiedTorrentId === torrent.id ? <Check className="w-4 h-4 text-emerald-500" /> : 'Magnet'}
                        </button>
                      )}

                      <button
                        onClick={() => handlePlaySelectedTorrent(torrent)}
                        className="flex items-center gap-2 px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-black text-xs font-extrabold rounded-xl shadow-lg transition-transform active:scale-95"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Assistir ({torrent.quality})</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-6 rounded-2xl glass-subtle text-center space-y-2 border border-slate-200/80 dark:border-white/[0.06]">
                <p className="text-xs text-slate-600 dark:text-white/60 font-medium">
                  Nenhuma fonte encontrada com os filtros atuais ({selectedAudio !== 'all' ? selectedAudio : ''}{' '}
                  {selectedFormat !== 'all' ? selectedFormat : ''}{' '}
                  {selectedQuality !== 'all' ? selectedQuality : ''}).
                </p>
                <button
                  onClick={() => {
                    setSelectedAudio('all');
                    setSelectedFormat('all');
                    setSelectedQuality('all');
                  }}
                  className="px-3.5 py-1.5 bg-slate-900 text-white dark:bg-white dark:text-black text-xs font-bold rounded-xl shadow-sm"
                >
                  Exibir Todos os Torrents
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
