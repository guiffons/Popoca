/**
 * Popoca Streaming - Movie Card Component
 * Efeito de escala imersivo estilo Apple TV no desktop e resposta tátil nativa no mobile.
 * Suporte a Lazy Loading avançado com IntersectionObserver e placeholder de vidro fosco.
 */

import React from 'react';
import { Play, Star, Heart, Bookmark, Layers } from 'lucide-react';
import { MediaItem } from '../types/index.ts';
import { storageService } from '../services/storage.ts';
import { LazyImage } from './LazyImage.tsx';

interface MovieCardProps {
  media: MediaItem;
  progressPercent?: number;
  episodeBadge?: string;
  episodeSubtitle?: string;
  onSelect: (media: MediaItem) => void;
  onQuickPlay?: (media: MediaItem) => void;
  onSelectEpisodes?: (media: MediaItem) => void;
}

export const MovieCard: React.FC<MovieCardProps> = ({
  media,
  progressPercent,
  episodeBadge,
  episodeSubtitle,
  onSelect,
  onQuickPlay,
  onSelectEpisodes
}) => {
  const year = media.release_date ? media.release_date.slice(0, 4) : '';
  const userRating = storageService.getRating(media.id);
  const isLiked = storageService.isLiked(media.id);
  const inWatchlist = storageService.isInWatchlist(media.id);
  const isEpisodic = media.media_type === 'tv' || media.media_type === 'anime' || (media.seasons && media.seasons.length > 0);
  const seasonCount = media.number_of_seasons || media.seasons?.length || 1;

  const handleCardClick = () => {
    onSelect(media);
  };

  const handlePlayAction = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isEpisodic) {
      if (onSelectEpisodes) {
        onSelectEpisodes(media);
      } else {
        onSelect(media);
      }
    } else if (onQuickPlay) {
      onQuickPlay(media);
    } else {
      onSelect(media);
    }
  };

  return (
    <div
      onClick={handleCardClick}
      className="group relative flex-none w-[140px] sm:w-[175px] md:w-[205px] cursor-pointer apple-card rounded-2xl overflow-hidden bg-white/50 dark:bg-[#111318]/90 backdrop-blur-xl border border-white/70 dark:border-white/[0.08] select-none shadow-sm dark:shadow-xl transition-all"
    >
      {/* Poster Proporção 2:3 com Lazy Loading */}
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-slate-200 dark:bg-neutral-950">
        <LazyImage
          src={media.poster_path}
          alt={media.title}
          title={media.title}
          aspectRatio="poster"
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        />

        {/* Indicadores do Letterboxd no topo do Card */}
        <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none z-10">
          {userRating ? (
            <div className="flex items-center gap-0.5 px-2 py-0.5 rounded-md bg-black/80 backdrop-blur-md text-amber-400 font-mono text-[11px] font-bold shadow-md">
              <Star className="w-3 h-3 fill-current" />
              <span>{userRating.rating.toFixed(1)}</span>
            </div>
          ) : <div />}

          <div className="flex items-center gap-1">
            {isLiked && (
              <div className="p-1 rounded-md bg-black/80 backdrop-blur-md text-white shadow-md">
                <Heart className="w-3 h-3 fill-current text-neutral-300" />
              </div>
            )}
            {inWatchlist && (
              <div className="p-1 rounded-md bg-black/80 backdrop-blur-md text-white shadow-md">
                <Bookmark className="w-3 h-3 fill-current text-neutral-300" />
              </div>
            )}
          </div>
        </div>

        {/* Badge de Episódio em Destaque (ex: T1:E3) ou Temporadas */}
        {episodeBadge ? (
          <div className="absolute bottom-2 left-2 z-10">
            <span className="px-2 py-0.5 rounded-md text-[10px] font-mono font-bold bg-slate-900 text-white dark:bg-white dark:text-black shadow-lg">
              {episodeBadge}
            </span>
          </div>
        ) : isEpisodic ? (
          <div className="absolute bottom-2 left-2 z-10">
            <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-black/80 backdrop-blur-md text-white border border-white/10 flex items-center gap-1 shadow-lg">
              <Layers className="w-2.5 h-2.5 text-neutral-300" />
              {seasonCount} Temp.
            </span>
          </div>
        ) : null}

        {/* Overlay com Botão de Play no Hover Desktop */}
        <div className="hidden md:flex absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 items-center justify-center">
          <button
            onClick={handlePlayAction}
            className="w-12 h-12 rounded-full bg-white text-black flex items-center justify-center shadow-2xl transform scale-75 group-hover:scale-100 transition-transform duration-200 hover:bg-slate-200 active:scale-90"
            aria-label={isEpisodic && !episodeBadge ? `Escolher episódio de ${media.title}` : `Reproduzir ${media.title}`}
          >
            {isEpisodic && !episodeBadge ? (
              <Layers className="w-5 h-5 text-black" />
            ) : (
              <Play className="w-5 h-5 fill-current ml-0.5 text-black" />
            )}
          </button>
        </div>

        {/* Barra de Progresso visual se estiver no "Continuar Assistindo" */}
        {typeof progressPercent === 'number' && progressPercent > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/60">
            <div
              className="h-full bg-slate-900 dark:bg-white transition-all duration-300"
              style={{ width: `${Math.min(100, progressPercent)}%` }}
            />
          </div>
        )}
      </div>

      {/* Informações do Título e Metadados com Contraste Perfeito */}
      <div className="p-2.5 sm:p-3">
        <h3 className="text-xs sm:text-sm font-semibold text-slate-900 dark:text-white truncate line-clamp-1 group-hover:opacity-85 transition-opacity" title={media.title}>
          {media.title}
        </h3>

        {episodeSubtitle ? (
          <p className="text-[11px] text-slate-600 dark:text-white/80 font-medium truncate line-clamp-1 mt-0.5" title={episodeSubtitle}>
            {episodeSubtitle}
          </p>
        ) : null}
        
        <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-slate-500 dark:text-white/50 mt-1">
          {year && <span>{year}</span>}
          {year && media.vote_average > 0 && <span aria-hidden="true">·</span>}
          {media.vote_average > 0 && (
            <span className="flex items-center gap-0.5 text-amber-500 dark:text-amber-400 font-mono">
              <Star className="w-3 h-3 fill-current" />
              {media.vote_average.toFixed(1)}
            </span>
          )}
          <span aria-hidden="true">·</span>
          <span className="text-slate-500 dark:text-white/40 capitalize">
            {media.media_type === 'tv' ? 'Série' : (media.media_type === 'anime' ? 'Anime' : 'Filme')}
          </span>
        </div>
      </div>
    </div>
  );
};
