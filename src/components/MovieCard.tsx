/**
 * Popoca Streaming - Movie Card Component
 * Card Liquid Glass estilo Apple TV+ com contraste nítido em modo claro e escuro,
 * suporte fluido para grades responsivas (fluid) e largura calibrada para trilhas horizontais.
 */

import React from 'react';
import { Play, Star, Heart, Bookmark, Layers, X } from 'lucide-react';
import { MediaItem } from '../types/index.ts';
import { storageService } from '../services/storage.ts';
import { LazyImage } from './LazyImage.tsx';

interface MovieCardProps {
  media: MediaItem;
  fluid?: boolean;
  progressPercent?: number;
  remainingTimeText?: string;
  episodeBadge?: string;
  episodeSubtitle?: string;
  onSelect: (media: MediaItem) => void;
  onQuickPlay?: (media: MediaItem) => void;
  onSelectEpisodes?: (media: MediaItem) => void;
  onRemoveHistory?: (mediaId: number) => void;
}

export const MovieCard: React.FC<MovieCardProps> = ({
  media,
  fluid = false,
  progressPercent,
  remainingTimeText,
  episodeBadge,
  episodeSubtitle,
  onSelect,
  onQuickPlay,
  onSelectEpisodes,
  onRemoveHistory
}) => {
  const year = media.release_date ? media.release_date.slice(0, 4) : '';
  const userRating = storageService.getRating(media.id);
  const isLiked = storageService.isLiked(media.id);
  const inWatchlist = storageService.isInWatchlist(media.id);
  const isEpisodic =
    media.media_type === 'tv' ||
    media.media_type === 'anime' ||
    Boolean(media.seasons && media.seasons.length > 0);
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
      className={`group relative ${
        fluid ? 'w-full' : 'flex-none w-[142px] sm:w-[174px] md:w-[202px]'
      } cursor-pointer apple-card rounded-2xl overflow-hidden bg-white/90 dark:bg-[#11151E]/90 backdrop-blur-xl border border-slate-900/[0.08] dark:border-white/[0.08] select-none shadow-sm dark:shadow-xl transition-all`}
    >
      {/* Poster 2:3 */}
      <div className="relative aspect-[2/3] w-full overflow-hidden bg-slate-200 dark:bg-[#0B0E14]">
        <LazyImage
          src={media.poster_path}
          alt={media.title}
          title={media.title}
          aspectRatio="poster"
          className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
        />

        {/* Indicadores superiores */}
        <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none z-10">
          {userRating ? (
            <div className="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-black/75 backdrop-blur-md text-amber-400 font-mono text-[10px] font-bold shadow-md">
              <Star className="w-2.5 h-2.5 fill-current" />
              <span>{userRating.rating.toFixed(1)}</span>
            </div>
          ) : (
            <div />
          )}

          <div className="flex items-center gap-1">
            {isLiked && (
              <div className="p-1 rounded-full bg-black/75 backdrop-blur-md text-white shadow-md">
                <Heart className="w-3 h-3 fill-current" />
              </div>
            )}
            {inWatchlist && (
              <div className="p-1 rounded-full bg-black/75 backdrop-blur-md text-white shadow-md">
                <Bookmark className="w-3 h-3 fill-current" />
              </div>
            )}
            {onRemoveHistory && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onRemoveHistory(media.id);
                }}
                className="p-1 rounded-full bg-black/80 hover:bg-rose-600 backdrop-blur-md text-white shadow-md opacity-0 group-hover:opacity-100 transition-opacity pointer-events-auto cursor-pointer"
                title="Remover do histórico"
                aria-label="Remover do histórico"
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </div>
        </div>

        {/* Badge de Episódio ou Temporada */}
        {episodeBadge ? (
          <div className="absolute bottom-2 left-2 z-10">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-bold bg-white text-black shadow-lg">
              {episodeBadge}
            </span>
          </div>
        ) : isEpisodic ? (
          <div className="absolute bottom-2 left-2 z-10">
            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-black/75 backdrop-blur-md text-white border border-white/15 flex items-center gap-1 shadow-lg">
              <Layers className="w-2.5 h-2.5 text-white/80" />
              {seasonCount} Temp.
            </span>
          </div>
        ) : null}

        {/* Tempo Restante do Histórico */}
        {remainingTimeText && (
          <div className="absolute bottom-2.5 right-2 z-10 pointer-events-none">
            <span className="px-1.5 py-0.5 rounded-md text-[9px] font-mono font-bold bg-black/85 backdrop-blur-md text-white/90 shadow-md">
              {remainingTimeText}
            </span>
          </div>
        )}

        {/* Overlay Play Hover */}
        <div className="hidden md:flex absolute inset-0 bg-black/35 opacity-0 group-hover:opacity-100 transition-opacity duration-200 items-center justify-center">
          <button
            type="button"
            onClick={handlePlayAction}
            className="w-12 h-12 rounded-full bg-white/95 text-black flex items-center justify-center shadow-2xl transform scale-90 group-hover:scale-100 transition-transform duration-200 hover:bg-white active:scale-95 cursor-pointer"
            aria-label={isEpisodic && !episodeBadge ? `Episódios de ${media.title}` : `Assistir ${media.title}`}
          >
            {isEpisodic && !episodeBadge ? (
              <Layers className="w-5 h-5 text-black" />
            ) : (
              <Play className="w-5 h-5 fill-current ml-0.5 text-black" />
            )}
          </button>
        </div>

        {/* Progresso */}
        {typeof progressPercent === 'number' && progressPercent > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/60">
            <div
              className="h-full bg-white transition-all duration-300"
              style={{ width: `${Math.min(100, progressPercent)}%` }}
            />
          </div>
        )}
      </div>

      {/* Rodapé do Card com Alto Contraste */}
      <div className="p-2.5 sm:p-3">
        <h3
          className="text-xs sm:text-[13px] font-bold text-slate-900 dark:text-white truncate line-clamp-1"
          title={media.title}
        >
          {media.title}
        </h3>

        {episodeSubtitle ? (
          <p
            className="text-[11px] text-slate-600 dark:text-white/75 font-medium truncate line-clamp-1 mt-0.5"
            title={episodeSubtitle}
          >
            {episodeSubtitle}
          </p>
        ) : null}

        <div className="flex items-center gap-1.5 text-[10px] sm:text-[11px] text-slate-500 dark:text-white/50 mt-1">
          {year && <span>{year}</span>}
          {year && media.vote_average > 0 && <span aria-hidden="true">·</span>}
          {media.vote_average > 0 && (
            <span className="flex items-center gap-0.5 text-amber-600 dark:text-amber-400 font-mono font-semibold">
              <Star className="w-2.5 h-2.5 fill-current" />
              {media.vote_average.toFixed(1)}
            </span>
          )}
          <span aria-hidden="true">·</span>
          <span className="truncate">
            {media.media_type === 'tv' ? 'Série' : media.media_type === 'anime' ? 'Anime' : 'Filme'}
          </span>
        </div>
      </div>
    </div>
  );
};
