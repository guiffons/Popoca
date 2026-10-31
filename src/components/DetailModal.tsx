/**
 * Popoca Streaming - Detail Modal Component
 * Modal imersivo Liquid Glass estilo Apple TV com metadados sem caixas desnecessárias,
 * seletor completo de temporadas e episódios para séries/animes, integração Letterboxd,
 * e seleção de fontes torrent P2P em tempo real.
 */

import React, { useState, useEffect } from 'react';
import {
  X,
  Play,
  Star,
  Users,
  CheckCircle2,
  Clock,
  Heart,
  Bookmark,
  Check,
  ListPlus,
  RefreshCw,
  Tv,
  Film,
  Sparkles,
  Volume2
} from 'lucide-react';
import { MediaItem, TorrentSource, Episode, Season, CustomList } from '../types/index.ts';
import { api } from '../services/api.ts';
import { storageService } from '../services/storage.ts';
import { letterboxdService } from '../services/letterboxd.ts';
import { LazyImage } from './LazyImage.tsx';

interface DetailModalProps {
  media: MediaItem | null;
  onClose: () => void;
  onStartPlayback: (
    media: MediaItem,
    torrent: TorrentSource,
    forceTranscode?: boolean,
    episode?: Episode,
    availableTorrents?: TorrentSource[]
  ) => void;
}

export const DetailModal: React.FC<DetailModalProps> = ({
  media,
  onClose,
  onStartPlayback
}) => {
  if (!media) return null;

  const [torrents, setTorrents] = useState<TorrentSource[]>([]);
  const [isLoadingTorrents, setIsLoadingTorrents] = useState(false);
  const [selectedQuality, setSelectedQuality] = useState<'all' | '1080p' | '720p' | '4K'>('all');
  const [selectedAudio, setSelectedAudio] = useState<'all' | 'pt-br' | 'original'>('all');
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

  // Seasons & Episodes State com suporte a Lazy Loading sob demanda
  const [selectedSeasonNumber, setSelectedSeasonNumber] = useState<number>(1);
  const [selectedEpisodeNumber, setSelectedEpisodeNumber] = useState<number>(1);
  const isSeriesOrAnime = media.media_type === 'tv' || media.media_type === 'anime' || (media.seasons && media.seasons.length > 0) || (media.number_of_seasons && media.number_of_seasons > 0);

  const [seasonsState, setSeasonsState] = useState<Season[]>(() => {
    if (media.seasons && media.seasons.length > 0) return media.seasons;
    const num = media.number_of_seasons || 1;
    return Array.from({ length: num }, (_, idx) => ({
      seasonNumber: idx + 1,
      name: `Temporada ${idx + 1}`,
      episodeCount: 12,
      episodes: []
    }));
  });

  const [isLoadingSeasonEpisodes, setIsLoadingSeasonEpisodes] = useState(false);
  const [visibleEpisodeCount, setVisibleEpisodeCount] = useState(30);

  const currentSeason = seasonsState.find((s) => s.seasonNumber === selectedSeasonNumber) || seasonsState[0];
  const currentEpisode = currentSeason?.episodes.find((e) => e.episodeNumber === selectedEpisodeNumber) || currentSeason?.episodes[0];

  const [copiedTorrentId, setCopiedTorrentId] = useState<string | null>(null);

  // Sincroniza e pré-carrega temporada sob demanda ao abrir ou mudar mídia
  useEffect(() => {
    const initialSeasons = media.seasons && media.seasons.length > 0
      ? media.seasons
      : Array.from({ length: media.number_of_seasons || 1 }, (_, idx) => ({
          seasonNumber: idx + 1,
          name: `Temporada ${idx + 1}`,
          episodeCount: 12,
          episodes: []
        }));

    setSeasonsState(initialSeasons);
    setVisibleEpisodeCount(30);

    if (initialSeasons.length > 0) {
      const firstS = initialSeasons[0];
      setSelectedSeasonNumber(firstS.seasonNumber);
      if (firstS.episodes && firstS.episodes.length > 0) {
        setSelectedEpisodeNumber(firstS.episodes[0].episodeNumber);
      } else if (isSeriesOrAnime) {
        setIsLoadingSeasonEpisodes(true);
        api.getSeason(media.id, firstS.seasonNumber)
          .then((eps) => {
            if (eps && eps.length > 0) {
              setSeasonsState((prev) => {
                const next = [...prev];
                next[0] = { ...next[0], episodes: eps, episodeCount: eps.length };
                return next;
              });
              setSelectedEpisodeNumber(eps[0].episodeNumber);
            }
          })
          .catch(() => {})
          .finally(() => setIsLoadingSeasonEpisodes(false));
      }
    }
  }, [media]);

  // Busca fontes torrent indexadas em tempo real com base no episódio específico ou filme
  useEffect(() => {
    let isMounted = true;
    async function fetchTorrents() {
      if (!media) return;
      setIsLoadingTorrents(true);
      try {
        const year = media.release_date ? media.release_date.slice(0, 4) : undefined;
        const results = await api.getTorrents(media.title, {
          year,
          imdbId: (media as any).imdb_id,
          mediaType: media.media_type,
          season: isSeriesOrAnime ? selectedSeasonNumber : undefined,
          episode: isSeriesOrAnime ? selectedEpisodeNumber : undefined
        });
        if (isMounted) {
          setTorrents(results);
          if (results.length > 0) {
            const best = results.find((t) => t.isPortugueseAudio && t.seeds > 0) || results[0];
            if (best?.magnetUri) {
              api.preloadTorrent(best.magnetUri);
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
  }, [media, selectedSeasonNumber, selectedEpisodeNumber, isSeriesOrAnime]);

  const handleSeasonChange = async (seasonNum: number) => {
    setSelectedSeasonNumber(seasonNum);
    setVisibleEpisodeCount(30);

    const targetSeason = seasonsState.find((s) => s.seasonNumber === seasonNum);
    if (targetSeason && targetSeason.episodes && targetSeason.episodes.length > 0) {
      setSelectedEpisodeNumber(targetSeason.episodes[0].episodeNumber);
      return;
    }

    // Carregamento sob demanda (lazy-loading) dos episódios desta temporada
    setIsLoadingSeasonEpisodes(true);
    try {
      const episodes = await api.getSeason(media.id, seasonNum);
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

  const filteredTorrents = torrents.filter((t) => {
    // 1. Filtro de Resolução / Qualidade
    if (selectedQuality !== 'all' && t.quality !== selectedQuality) return false;
    // 2. Filtro de Idioma (Áudio PT-BR vs Áudio Original)
    if (selectedAudio === 'pt-br' && !t.isPortugueseAudio) return false;
    if (selectedAudio === 'original' && t.isPortugueseAudio) return false;
    // 3. Filtro de Formato (WEB-DL vs Bluray)
    if (selectedFormat === 'WEB-DL' && t.format !== 'WEB-DL') return false;
    if (selectedFormat === 'Bluray' && t.format !== 'Bluray') return false;
    return true;
  });

  const year = media.release_date ? media.release_date.slice(0, 4) : '';

  const handleRate = (stars: number) => {
    setUserRating(stars);
    letterboxdService.rateMovie(media, stars, reviewText, isLiked);
    setIsWatched(true);
    showToast();
  };

  const handleSaveReview = () => {
    letterboxdService.rateMovie(media, userRating || 4, reviewText, isLiked);
    setIsWatched(true);
    showToast();
  };

  const handleToggleLike = () => {
    const newState = letterboxdService.toggleLike(media);
    setIsLiked(newState);
  };

  const handleToggleWatched = () => {
    if (isWatched) {
      letterboxdService.removeWatched(media.id);
      setIsWatched(false);
    } else {
      letterboxdService.markWatched(media, true);
      setIsWatched(true);
    }
  };

  const handleToggleWatchlist = () => {
    const newState = letterboxdService.toggleWatchlist(media);
    setInWatchlist(newState);
  };

  const handleAddMovieToList = (listId: string) => {
    letterboxdService.addToList(listId, media);
    setShowAddToList(false);
    setCustomLists(letterboxdService.getCustomLists());
    showToast();
  };

  const handleCopyMagnet = (t: TorrentSource) => {
    if (t.magnetUri) {
      navigator.clipboard.writeText(t.magnetUri).catch(() => {});
      setCopiedTorrentId(t.id);
      setTimeout(() => setCopiedTorrentId(null), 2000);
    }
  };

  const showToast = () => {
    setReviewSavedToast(true);
    setTimeout(() => setReviewSavedToast(false), 2400);
  };

  // Iniciar reprodução de um episódio específico direto
  const handlePlayEpisode = (episode: Episode) => {
    setSelectedEpisodeNumber(episode.episodeNumber);
    // Prioriza torrent Dublado PT-BR com mais seeds
    const ptBrBest = torrents.find((t) => t.isPortugueseAudio && t.seeds > 0) || torrents[0];
    const defaultTorrent: TorrentSource = ptBrBest || {
      id: `ep-${episode.id}`,
      title: `${media.title} - S${episode.seasonNumber}E${episode.episodeNumber} [1080p WEB-DL Dublado PT-BR]`,
      magnetUri: '',
      infoHash: '',
      quality: '1080p',
      format: 'WEB-DL',
      seeds: 950,
      peers: 160,
      sizeBytes: 1250000000,
      sizeFormatted: '1.25 GB',
      isPortugueseAudio: true,
      source: 'Rede P2P Popoca Brasil',
      directUrl: episode.streamUrl
    };
    onStartPlayback(media, defaultTorrent, forceTranscode, episode, torrents);
  };

  // Iniciar reprodução selecionando um torrent específico
  const handlePlaySelectedTorrent = (torrent: TorrentSource) => {
    onStartPlayback(media, torrent, forceTranscode, isSeriesOrAnime ? currentEpisode : undefined, torrents);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 overflow-y-auto bg-black/85 backdrop-blur-2xl animate-in fade-in duration-200">
      {/* Toast Feedback */}
      {reviewSavedToast && (
        <div className="fixed top-6 right-6 z-50 glass-dropdown px-4 py-2.5 rounded-xl text-xs font-semibold text-white border border-white/20 shadow-2xl flex items-center gap-2 animate-in slide-in-from-top">
          <CheckCircle2 className="w-4 h-4 text-emerald-400" />
          <span>Salvo no seu perfil Letterboxd!</span>
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

        {/* Banner Cinematográfico Limpo - Sem imagens gigantes sobrepostas e sem textos por cima */}
        <div className="relative h-48 sm:h-64 md:h-72 w-full overflow-hidden shrink-0 rounded-t-2xl sm:rounded-t-3xl">
          <LazyImage
            src={media.backdrop_path}
            alt={media.title}
            title={media.title}
            aspectRatio="auto"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-white/95 via-transparent to-black/30 dark:from-[#0e1117] dark:via-[#0e1117]/40 dark:to-transparent" />
        </div>

        {/* Corpo do Conteúdo - Totalmente Centralizado e Sem Textos Por Cima da Imagem */}
        <div className="relative px-4 sm:px-8 pb-8 pt-4 z-10 flex flex-col items-center text-center max-w-3xl mx-auto space-y-6 box-border w-full">
          {/* Dados & Título Centralizados */}
          <div className="space-y-3 w-full flex flex-col items-center">
            <div className="flex items-center justify-center gap-2 flex-wrap text-xs text-slate-600 dark:text-white/60">
              {year && <span className="font-mono">{year}</span>}
              {media.runtime && <span>· {media.runtime} min</span>}
              {isSeriesOrAnime && (
                <span className="px-2 py-0.5 rounded-md bg-slate-200/80 dark:bg-white/10 text-slate-800 dark:text-white font-semibold">
                  {seasonsState.length || 1} {seasonsState.length > 1 ? 'Temporadas' : 'Temporada'}
                </span>
              )}
              {media.vote_average > 0 && (
                <span className="flex items-center gap-1 text-amber-500 dark:text-amber-400 font-mono font-bold">
                  <Star className="w-3.5 h-3.5 fill-current" />
                  {media.vote_average.toFixed(1)}
                </span>
              )}
            </div>

            <h1 className="text-2xl sm:text-4xl font-extrabold text-slate-900 dark:text-white tracking-tight break-words text-center">
              {media.title}
            </h1>

            {media.original_title && media.original_title !== media.title && (
              <p className="text-xs text-slate-500 dark:text-white/40 italic mt-0.5 break-words text-center">
                Título original: {media.original_title}
              </p>
            )}

            {/* Gêneros Centralizados */}
            {media.genres && media.genres.length > 0 && (
              <div className="flex items-center justify-center gap-1.5 flex-wrap pt-0.5">
                {media.genres.map((g) => (
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
              {media.overview || 'Sinopse oficial em sincronização com o catálogo.'}
            </p>

            {/* Botão de Destaque Assistir Agora */}
            <div className="pt-2 flex items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  const bestPtBr = torrents.find((t) => t.isPortugueseAudio && t.seeds > 0) || torrents[0];
                  if (bestPtBr) {
                    handlePlaySelectedTorrent(bestPtBr);
                  } else if (isSeriesOrAnime && currentEpisode) {
                    handlePlayEpisode(currentEpisode);
                  }
                }}
                disabled={isLoadingTorrents && torrents.length === 0}
                className="px-6 py-3 bg-white hover:bg-slate-200 text-black font-extrabold text-sm rounded-2xl shadow-xl flex items-center gap-2 active:scale-95 transition-all disabled:opacity-50"
              >
                <Play className="w-4 h-4 fill-current" />
                <span>
                  {torrents.some((t) => t.isPortugueseAudio)
                    ? 'Assistir Agora (Dublado PT-BR)'
                    : 'Assistir Agora'}
                </span>
              </button>
            </div>
          </div>

            {/* Seção Letterboxd (Avaliação, Favoritos, Watchlist, Listas) */}
            <div className="p-3.5 sm:p-4 rounded-2xl glass-subtle border border-slate-200/80 dark:border-white/[0.06] space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-white/80 flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-slate-600 dark:text-neutral-300" />
                  Perfil & Avaliação Letterboxd
                </span>

                <div className="flex items-center gap-1.5 flex-wrap">
                  {/* Marcar Visto */}
                  <button
                    onClick={handleToggleWatched}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                      isWatched
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-black font-bold shadow-md'
                        : 'glass-subtle text-slate-700 hover:text-black dark:text-white/70 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10'
                    }`}
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>{isWatched ? 'Já Visto' : 'Marcar Visto'}</span>
                  </button>

                  {/* Curtir */}
                  <button
                    onClick={handleToggleLike}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                      isLiked
                        ? 'bg-slate-900 text-white dark:bg-neutral-200 dark:text-black font-bold shadow-md'
                        : 'glass-subtle text-slate-700 hover:text-black dark:text-white/70 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10'
                    }`}
                  >
                    <Heart className={`w-3.5 h-3.5 ${isLiked ? 'fill-current' : ''}`} />
                    <span>{isLiked ? 'Curtido' : 'Curtir'}</span>
                  </button>

                  {/* Watchlist */}
                  <button
                    onClick={handleToggleWatchlist}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                      inWatchlist
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-black font-bold shadow-md'
                        : 'glass-subtle text-slate-700 hover:text-black dark:text-white/70 dark:hover:text-white hover:bg-slate-200/60 dark:hover:bg-white/10'
                    }`}
                  >
                    <Bookmark className={`w-3.5 h-3.5 ${inWatchlist ? 'fill-current' : ''}`} />
                    <span>Watchlist</span>
                  </button>

                  {/* Adicionar a Listas */}
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

              {/* Avaliação em Estrelas (Letterboxd) */}
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
                        className={`w-5 h-5 ${
                          (hoverRating || userRating) >= star ? 'fill-current' : 'text-slate-300 dark:text-white/20'
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

              {/* Caixa de Resenha / Anotações */}
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

            {/* SELETOR DE TEMPORADAS E EPISÓDIOS (PARA SÉRIES & ANIMES) COM LAZY LOADING SOB DEMANDA */}
            {isSeriesOrAnime && seasonsState.length > 0 && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Tv className="w-4 h-4 text-slate-700 dark:text-white/70" />
                    <span>Temporadas & Episódios ({seasonsState.length} temporadas)</span>
                  </h3>

                  {/* Abas de Temporada */}
                  <div className="flex items-center gap-1.5 p-1 bg-slate-200/70 dark:bg-white/[0.05] rounded-xl overflow-x-auto no-scrollbar max-w-full">
                    {seasonsState.map((s) => (
                      <button
                        key={s.seasonNumber}
                        onClick={() => handleSeasonChange(s.seasonNumber)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-all whitespace-nowrap ${
                          selectedSeasonNumber === s.seasonNumber
                            ? 'bg-slate-900 text-white dark:bg-white dark:text-black font-bold shadow-md'
                            : 'text-slate-600 dark:text-white/60 hover:text-black dark:hover:text-white hover:bg-slate-300/50 dark:hover:bg-white/10'
                        }`}
                      >
                        {s.name.split(':')[0] || `Temp. ${s.seasonNumber}`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Carregamento sob demanda com spinner animado */}
                {isLoadingSeasonEpisodes ? (
                  <div className="py-10 rounded-2xl glass-subtle flex flex-col items-center justify-center text-slate-500 dark:text-white/50 text-xs gap-2.5 border border-slate-200/80 dark:border-white/[0.06]">
                    <RefreshCw className="w-5 h-5 animate-spin text-slate-900 dark:text-white" />
                    <span className="font-medium">Carregando episódios da Temporada {selectedSeasonNumber} sob demanda...</span>
                  </div>
                ) : currentSeason && currentSeason.episodes.length > 0 ? (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {currentSeason.episodes.slice(0, visibleEpisodeCount).map((ep) => {
                      const isSelected = selectedEpisodeNumber === ep.episodeNumber;
                      return (
                        <div
                          key={ep.id}
                          onClick={() => handleSelectEpisode(ep.episodeNumber)}
                          className={`p-3 rounded-xl cursor-pointer transition-all border flex items-center justify-between gap-3 shadow-sm ${
                            isSelected
                              ? 'bg-slate-100 dark:bg-white/[0.1] border-slate-900/30 dark:border-white/30 ring-1 ring-slate-900/10 dark:ring-white/20'
                              : 'glass-subtle hover:bg-white/80 dark:hover:bg-white/[0.07] border-slate-200/80 dark:border-white/[0.05]'
                          }`}
                        >
                          <div className="flex items-center gap-3 min-w-0 flex-1">
                            <div
                              className={`w-10 h-10 rounded-lg flex items-center justify-center font-mono font-bold text-xs shrink-0 transition-colors ${
                                isSelected
                                  ? 'bg-slate-900 text-white dark:bg-white dark:text-black shadow-md'
                                  : 'bg-slate-200 dark:bg-white/10 text-slate-800 dark:text-white'
                              }`}
                            >
                              {ep.episodeNumber}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                                  {ep.title}
                                </h4>
                                {isSelected && (
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 shrink-0">
                                    Ativo
                                  </span>
                                )}
                              </div>
                              <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-white/50 mt-0.5">
                                <span className="flex items-center gap-1">
                                  <Clock className="w-3 h-3" />
                                  {ep.durationMinutes} min
                                </span>
                                <span aria-hidden="true">·</span>
                                <span className="text-emerald-600 dark:text-emerald-400 font-medium">Áudio pt-BR</span>
                                <span aria-hidden="true">·</span>
                                <span className="text-slate-500 dark:text-white/40">Clique p/ ver fontes abaixo</span>
                              </div>
                            </div>
                          </div>

                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handlePlayEpisode(ep);
                            }}
                            className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-black text-xs font-extrabold rounded-xl shadow-md shrink-0 transition-transform active:scale-95"
                          >
                            <Play className="w-3.5 h-3.5 fill-current" />
                            <span>Assistir</span>
                          </button>
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

            {/* SELEÇÃO REFATORADA DE STREAMING P2P COM FILTROS DE IDIOMA E FORMATO */}
            <div className="space-y-3.5 pt-3 border-t border-slate-200/80 dark:border-white/[0.08]">
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

              {/* Barra de Filtros: Idioma (Dublado PT-BR), Formato (WEB-DL vs Bluray) e Resolução */}
              <div className="flex flex-wrap items-center gap-2">
                {/* 1. Filtro Idioma (PT-BR) */}
                <div className="flex items-center gap-1 p-1 bg-slate-200/80 dark:bg-white/[0.05] rounded-xl border border-slate-300/60 dark:border-white/[0.06]">
                  <button
                    onClick={() => setSelectedAudio('all')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                      selectedAudio === 'all'
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-black shadow-sm font-bold'
                        : 'text-slate-600 dark:text-white/60 hover:text-black dark:hover:text-white'
                    }`}
                  >
                    Todos Áudios ({torrents.length})
                  </button>
                  <button
                    onClick={() => setSelectedAudio('pt-br')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1.5 ${
                      selectedAudio === 'pt-br'
                        ? 'bg-emerald-600 text-white font-bold shadow-md ring-1 ring-emerald-400/40'
                        : 'text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/10'
                    }`}
                  >
                    <Volume2 className="w-3.5 h-3.5" />
                    <span>🇧🇷 Dublado PT-BR ({ptBrCount})</span>
                  </button>
                  <button
                    onClick={() => setSelectedAudio('original')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                      selectedAudio === 'original'
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-black shadow-sm font-bold'
                        : 'text-slate-600 dark:text-white/60 hover:text-black dark:hover:text-white'
                    }`}
                  >
                    Original ({origCount})
                  </button>
                </div>

                {/* 2. Filtro Formato (WEB-DL vs Bluray) */}
                <div className="flex items-center gap-1 p-1 bg-slate-200/80 dark:bg-white/[0.05] rounded-xl border border-slate-300/60 dark:border-white/[0.06]">
                  <button
                    onClick={() => setSelectedFormat('all')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                      selectedFormat === 'all'
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-black shadow-sm font-bold'
                        : 'text-slate-600 dark:text-white/60 hover:text-black dark:hover:text-white'
                    }`}
                  >
                    Formatos ({torrents.length})
                  </button>
                  <button
                    onClick={() => setSelectedFormat('WEB-DL')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1 ${
                      selectedFormat === 'WEB-DL'
                        ? 'bg-sky-600 text-white font-bold shadow-md ring-1 ring-sky-400/40'
                        : 'text-sky-700 dark:text-sky-400 hover:bg-sky-500/10'
                    }`}
                  >
                    <span>WEB-DL ({webdlCount})</span>
                  </button>
                  <button
                    onClick={() => setSelectedFormat('Bluray')}
                    className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all flex items-center gap-1 ${
                      selectedFormat === 'Bluray'
                        ? 'bg-purple-600 text-white font-bold shadow-md ring-1 ring-purple-400/40'
                        : 'text-purple-700 dark:text-purple-400 hover:bg-purple-500/10'
                    }`}
                  >
                    <span>BluRay ({blurayCount})</span>
                  </button>
                </div>

                {/* 3. Filtro Qualidade */}
                <div className="flex items-center gap-1 p-1 bg-slate-200/80 dark:bg-white/[0.05] rounded-xl border border-slate-300/60 dark:border-white/[0.06]">
                  {(['all', '1080p', '720p', '4K'] as const).map((q) => (
                    <button
                      key={q}
                      onClick={() => setSelectedQuality(q)}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-all ${
                        selectedQuality === q
                          ? 'bg-slate-900 text-white dark:bg-white dark:text-black shadow-sm font-bold'
                          : 'text-slate-600 dark:text-white/60 hover:text-black dark:hover:text-white'
                      }`}
                    >
                      {q === 'all' ? 'Todas' : q}
                    </button>
                  ))}
                </div>
              </div>

              {/* Lista de Torrents com Seleção Clara */}
              {isLoadingTorrents ? (
                <div className="py-8 flex flex-col items-center justify-center text-slate-500 dark:text-white/40 text-xs gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-slate-700 dark:text-white" />
                  <span>Consultando agregadores e indexadores P2P em tempo real...</span>
                </div>
              ) : filteredTorrents.length > 0 ? (
                <div className="space-y-2.5 max-h-72 overflow-y-auto pr-1">
                  {filteredTorrents.map((torrent) => (
                    <div
                      key={torrent.id}
                      className="p-3.5 rounded-2xl glass-subtle hover:bg-slate-100/90 dark:hover:bg-white/[0.07] border border-slate-200/80 dark:border-white/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-all shadow-sm"
                    >
                      <div className="min-w-0 flex-1">
                        {/* Badges de Destaque */}
                        <div className="flex items-center gap-1.5 flex-wrap mb-1.5">
                          {/* Formato */}
                          <span
                            className={`text-[11px] font-bold px-2 py-0.5 rounded-md font-mono ${
                              torrent.format === 'WEB-DL'
                                ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border border-sky-500/25'
                                : 'bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/25'
                            }`}
                          >
                            {torrent.format || 'WEB-DL'}
                          </span>

                          {/* Idioma PT-BR */}
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

                          {/* Qualidade */}
                          <span className="text-[11px] font-bold px-2 py-0.5 rounded-md bg-slate-900/10 dark:bg-white/10 text-slate-900 dark:text-white font-mono">
                            {torrent.quality}
                          </span>

                          {/* Tamanho */}
                          <span className="text-[11px] font-mono text-slate-500 dark:text-white/50">
                            💾 {torrent.sizeFormatted}
                          </span>
                        </div>

                        {/* Título do Arquivo */}
                        <h4 className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white truncate" title={torrent.title}>
                          {torrent.title}
                        </h4>

                        {/* Saúde P2P & Rastreador */}
                        <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-white/50 mt-1 font-mono flex-wrap">
                          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            {torrent.seeds} sementes (seeds)
                          </span>
                          <span>·</span>
                          <span>{torrent.peers} pares (peers)</span>
                          <span>·</span>
                          <span className="text-slate-400 dark:text-white/40 truncate max-w-[150px]">
                            {torrent.source}
                          </span>
                        </div>
                      </div>

                      {/* Botões de Ação */}
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
                          <span>Assistir este Torrent</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-6 rounded-2xl glass-subtle text-center space-y-2 border border-slate-200/80 dark:border-white/[0.06]">
                  <p className="text-xs text-slate-600 dark:text-white/60 font-medium">
                    Nenhuma fonte encontrada com os filtros atuais ({selectedAudio !== 'all' ? selectedAudio : ''} {selectedFormat !== 'all' ? selectedFormat : ''} {selectedQuality !== 'all' ? selectedQuality : ''}).
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
