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
  onStartPlayback: (media: MediaItem, torrent: TorrentSource, forceTranscode?: boolean, episode?: Episode) => void;
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

  // Seasons & Episodes State
  const [selectedSeasonNumber, setSelectedSeasonNumber] = useState<number>(1);
  const isSeriesOrAnime = media.media_type === 'tv' || media.media_type === 'anime' || (media.seasons && media.seasons.length > 0);
  const seasons: Season[] = media.seasons || [];

  const currentSeason = seasons.find((s) => s.seasonNumber === selectedSeasonNumber) || seasons[0];

  // Busca fontes torrent indexadas em tempo real
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
          season: selectedSeasonNumber,
          episode: 1
        });
        if (isMounted) {
          setTorrents(results);
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
  }, [media, selectedSeasonNumber]);

  // Sincroniza temporada padrão
  useEffect(() => {
    if (seasons.length > 0) {
      setSelectedSeasonNumber(seasons[0].seasonNumber);
    }
  }, [media]);

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

  const showToast = () => {
    setReviewSavedToast(true);
    setTimeout(() => setReviewSavedToast(false), 2400);
  };

  // Iniciar reprodução de um episódio específico
  const handlePlayEpisode = (episode: Episode) => {
    const defaultTorrent = torrents[0] || {
      id: `ep-${episode.id}`,
      title: `${media.title} - S${episode.seasonNumber}E${episode.episodeNumber}`,
      magnetUri: '',
      infoHash: '',
      quality: '1080p',
      seeds: 850,
      peers: 140,
      sizeBytes: 1250000000,
      sizeFormatted: '1.25 GB',
      isPortugueseAudio: true,
      source: 'Rede P2P Popoca',
      directUrl: episode.streamUrl
    };
    onStartPlayback(media, defaultTorrent, forceTranscode, episode);
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

        {/* Backdrop Header com LazyImage */}
        <div className="relative h-48 sm:h-72 w-full overflow-hidden shrink-0">
          <LazyImage
            src={media.backdrop_path}
            alt={media.title}
            title={media.title}
            aspectRatio="auto"
            className="w-full h-full object-cover"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-white/90 via-transparent to-transparent dark:from-[#0e1117] dark:via-[#0e1117]/70 dark:to-transparent" />
        </div>

        {/* Corpo do Conteúdo */}
        <div className="relative px-4 pb-6 pt-2 sm:px-8 sm:pb-8 sm:-mt-16 z-10 flex flex-col md:flex-row gap-5 sm:gap-6 box-border">
          {/* Poster Desktop com LazyImage */}
          <div className="w-32 sm:w-44 shrink-0 rounded-2xl overflow-hidden shadow-2xl border border-white/60 dark:border-white/10 hidden sm:block bg-slate-200 dark:bg-neutral-900 aspect-[2/3]">
            <LazyImage
              src={media.poster_path}
              alt={media.title}
              title={media.title}
              aspectRatio="poster"
              className="w-full h-full object-cover"
            />
          </div>

          {/* Dados & Ações */}
          <div className="flex-1 min-w-0 space-y-4">
            <div>
              <div className="flex items-center gap-2 flex-wrap text-xs text-slate-600 dark:text-white/60 mb-1">
                {year && <span className="font-mono">{year}</span>}
                {media.runtime && <span>· {media.runtime} min</span>}
                {isSeriesOrAnime && (
                  <span className="px-2 py-0.5 rounded-md bg-slate-200/80 dark:bg-white/10 text-slate-800 dark:text-white font-semibold">
                    {seasons.length || 1} {seasons.length > 1 ? 'Temporadas' : 'Temporada'}
                  </span>
                )}
                {media.vote_average > 0 && (
                  <span className="flex items-center gap-1 text-amber-500 dark:text-amber-400 font-mono font-bold">
                    <Star className="w-3.5 h-3.5 fill-current" />
                    {media.vote_average.toFixed(1)}
                  </span>
                )}
              </div>

              <h1 className="text-xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight break-words">
                {media.title}
              </h1>

              {media.original_title && media.original_title !== media.title && (
                <p className="text-xs text-slate-500 dark:text-white/40 italic mt-0.5 break-words">
                  Título original: {media.original_title}
                </p>
              )}
            </div>

            {/* Gêneros */}
            {media.genres && media.genres.length > 0 && (
              <div className="flex items-center gap-1.5 flex-wrap">
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

            {/* Sinopse */}
            <p className="text-xs sm:text-sm text-slate-700 dark:text-white/70 leading-relaxed break-words">
              {media.overview || 'Sinopse oficial em sincronização com o catálogo.'}
            </p>

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

            {/* SELETOR DE TEMPORADAS E EPISÓDIOS (PARA SÉRIES & ANIMES) */}
            {isSeriesOrAnime && seasons.length > 0 && (
              <div className="space-y-3 pt-2">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Tv className="w-4 h-4 text-slate-700 dark:text-white/70" />
                    <span>Temporadas & Episódios ({seasons.length} temporadas disponíveis)</span>
                  </h3>

                  {/* Abas de Temporada */}
                  <div className="flex items-center gap-1 p-1 bg-slate-200/60 dark:bg-white/[0.05] rounded-xl overflow-x-auto no-scrollbar">
                    {seasons.map((s) => (
                      <button
                        key={s.seasonNumber}
                        onClick={() => setSelectedSeasonNumber(s.seasonNumber)}
                        className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap ${
                          selectedSeasonNumber === s.seasonNumber
                            ? 'bg-slate-900 text-white dark:bg-white dark:text-black font-bold shadow-md'
                            : 'text-slate-600 dark:text-white/60 hover:text-black dark:hover:text-white'
                        }`}
                      >
                        {s.name.split(':')[0] || `Temp. ${s.seasonNumber}`}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Lista de Episódios com sinopse e play imediato */}
                {currentSeason && currentSeason.episodes.length > 0 ? (
                  <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
                    {currentSeason.episodes.map((ep) => (
                      <div
                        key={ep.id}
                        className="p-3 rounded-xl glass-subtle hover:bg-white/80 dark:hover:bg-white/[0.07] border border-slate-200/80 dark:border-white/[0.05] flex items-center justify-between gap-3 transition-colors shadow-sm"
                      >
                        <div className="flex items-center gap-3 min-w-0 flex-1">
                          <div className="w-10 h-10 rounded-lg bg-slate-200 dark:bg-white/10 flex items-center justify-center font-mono font-bold text-xs text-slate-800 dark:text-white shrink-0">
                            {ep.episodeNumber}
                          </div>
                          <div className="min-w-0 flex-1">
                            <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                              {ep.title}
                            </h4>
                            <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-white/50 mt-0.5">
                              <span className="flex items-center gap-1">
                                <Clock className="w-3 h-3" />
                                {ep.durationMinutes} min
                              </span>
                              <span aria-hidden="true">·</span>
                              <span className="text-emerald-600 dark:text-emerald-400 font-medium">Áudio pt-BR</span>
                            </div>
                          </div>
                        </div>

                        <button
                          onClick={() => handlePlayEpisode(ep)}
                          className="flex items-center gap-1.5 px-3.5 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-black text-xs font-extrabold rounded-xl shadow-md shrink-0 transition-transform active:scale-95"
                        >
                          <Play className="w-3.5 h-3.5 fill-current" />
                          <span>Assistir</span>
                        </button>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="p-4 rounded-xl glass-subtle text-xs text-slate-500 dark:text-white/50 text-center">
                    Episódios em sincronização para esta temporada.
                  </div>
                )}
              </div>
            )}

            {/* SELEÇÃO DE STREAMING P2P TORRENT COM FILTROS DE IDIOMA E FORMATO */}
            <div className="space-y-3 pt-2">
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between">
                  <h3 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-emerald-500" />
                    <span>Fontes de Streaming ({filteredTorrents.length})</span>
                  </h3>
                  <span className="text-[11px] text-slate-500 dark:text-white/40">
                    Filtre antes de assistir
                  </span>
                </div>

                {/* Linha de Filtros: Idioma, Formato e Qualidade */}
                <div className="flex items-center gap-2 flex-wrap">
                  {/* Filtro 1: Idioma (Áudio PT-BR vs Original) */}
                  <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-white/[0.04] rounded-xl">
                    <button
                      key="audio-all"
                      onClick={() => setSelectedAudio('all')}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                        selectedAudio === 'all'
                          ? 'bg-slate-900 text-white dark:bg-white dark:text-black font-bold shadow-sm'
                          : 'text-slate-600 dark:text-white/60 hover:text-black dark:hover:text-white'
                      }`}
                    >
                      Todos Áudios
                    </button>
                    <button
                      key="audio-ptbr"
                      onClick={() => setSelectedAudio('pt-br')}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors flex items-center gap-1 ${
                        selectedAudio === 'pt-br'
                          ? 'bg-emerald-600 text-white font-bold shadow-sm'
                          : 'text-emerald-700 dark:text-emerald-400 hover:text-emerald-900 dark:hover:text-emerald-300'
                      }`}
                    >
                      <span>🇧🇷 Dublado PT-BR</span>
                    </button>
                    <button
                      key="audio-orig"
                      onClick={() => setSelectedAudio('original')}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                        selectedAudio === 'original'
                          ? 'bg-slate-900 text-white dark:bg-white dark:text-black font-bold shadow-sm'
                          : 'text-slate-600 dark:text-white/60 hover:text-black dark:hover:text-white'
                      }`}
                    >
                      Original
                    </button>
                  </div>

                  {/* Filtro 2: Formato (WEB-DL vs Bluray) */}
                  <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-white/[0.04] rounded-xl">
                    <button
                      key="fmt-all"
                      onClick={() => setSelectedFormat('all')}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                        selectedFormat === 'all'
                          ? 'bg-slate-900 text-white dark:bg-white dark:text-black font-bold shadow-sm'
                          : 'text-slate-600 dark:text-white/60 hover:text-black dark:hover:text-white'
                      }`}
                    >
                      Todos Formatos
                    </button>
                    <button
                      key="fmt-webdl"
                      onClick={() => setSelectedFormat('WEB-DL')}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                        selectedFormat === 'WEB-DL'
                          ? 'bg-slate-900 text-white dark:bg-white dark:text-black font-bold shadow-sm'
                          : 'text-slate-600 dark:text-white/60 hover:text-black dark:hover:text-white'
                      }`}
                    >
                      WEB-DL
                    </button>
                    <button
                      key="fmt-bluray"
                      onClick={() => setSelectedFormat('Bluray')}
                      className={`px-2.5 py-1 text-xs font-semibold rounded-lg transition-colors ${
                        selectedFormat === 'Bluray'
                          ? 'bg-slate-900 text-white dark:bg-white dark:text-black font-bold shadow-sm'
                          : 'text-slate-600 dark:text-white/60 hover:text-black dark:hover:text-white'
                      }`}
                    >
                      BluRay
                    </button>
                  </div>

                  {/* Filtro 3: Resolução */}
                  <div className="flex items-center gap-1 p-1 bg-slate-200/70 dark:bg-white/[0.04] rounded-xl">
                    {(['all', '1080p', '720p', '4K'] as const).map((q) => (
                      <button
                        key={q}
                        onClick={() => setSelectedQuality(q)}
                        className={`px-2 py-1 text-xs font-semibold rounded-lg transition-colors ${
                          selectedQuality === q
                            ? 'bg-slate-900 text-white dark:bg-white dark:text-black font-bold shadow-sm'
                            : 'text-slate-600 dark:text-white/60 hover:text-black dark:hover:text-white'
                        }`}
                      >
                        {q === 'all' ? 'Resolução' : q}
                      </button>
                    ))}
                  </div>
                </div>
              </div>

              {isLoadingTorrents ? (
                <div className="py-6 flex flex-col items-center justify-center text-slate-500 dark:text-white/40 text-xs gap-2">
                  <RefreshCw className="w-5 h-5 animate-spin text-slate-700 dark:text-white" />
                  <span>Consultando indexadores em tempo real...</span>
                </div>
              ) : filteredTorrents.length > 0 ? (
                <div className="space-y-2 max-h-60 overflow-y-auto pr-1">
                  {filteredTorrents.map((torrent) => (
                    <div
                      key={torrent.id}
                      className="p-3 rounded-xl glass-subtle hover:bg-slate-100/90 dark:hover:bg-white/[0.06] border border-slate-200/80 dark:border-white/[0.04] flex items-center justify-between gap-3 transition-colors shadow-sm"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-slate-200 dark:bg-white/10 text-slate-900 dark:text-white font-mono">
                            {torrent.quality}
                          </span>
                          <span className="text-[11px] font-bold px-1.5 py-0.5 rounded bg-slate-300/80 dark:bg-white/15 text-slate-800 dark:text-neutral-200 font-mono">
                            {torrent.format || 'WEB-DL'}
                          </span>
                          {torrent.isPortugueseAudio ? (
                            <span className="text-[11px] font-semibold px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                              <Volume2 className="w-3 h-3" />
                              Dublado PT-BR
                            </span>
                          ) : (
                            <span className="text-[11px] text-slate-500 dark:text-white/50">
                              Áudio Original
                            </span>
                          )}
                          <span className="text-[11px] text-slate-500 dark:text-white/40 font-mono">
                            {torrent.sizeFormatted}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-white/50 mt-1 font-mono">
                          <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-bold">
                            <Users className="w-3 h-3" />
                            {torrent.seeds} seeds
                          </span>
                          <span>{torrent.peers} peers</span>
                          <span className="text-slate-400 dark:text-white/30 truncate max-w-[140px]">{torrent.source}</span>
                        </div>
                      </div>

                      <button
                        onClick={() => onStartPlayback(media, torrent, forceTranscode)}
                        className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-neutral-200 text-white dark:text-black text-xs font-extrabold rounded-xl shadow-md shrink-0 transition-transform active:scale-95"
                      >
                        <Play className="w-3.5 h-3.5 fill-current" />
                        <span>Assistir</span>
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-4 rounded-xl glass-subtle text-center text-xs text-slate-500 dark:text-white/50">
                  Nenhuma fonte encontrada com o filtro selecionado ({selectedAudio !== 'all' ? selectedAudio : ''} {selectedFormat !== 'all' ? selectedFormat : ''}).
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
