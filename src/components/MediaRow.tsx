/**
 * Popoca Streaming - Media Row Component
 * Trilha horizontal estilo Apple TV+ alinhada ao container widescreen de 1440px,
 * com rolagem suave e gaveta Liquid Glass para episódios.
 */

import React, { useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Play, X, Clock, Layers } from 'lucide-react';
import { MediaItem, Episode, Season, WatchHistoryItem } from '../types/index.ts';
import { MovieCard } from './MovieCard.tsx';

interface MediaRowProps {
  title: string;
  items: MediaItem[];
  progressMap?: Record<number, number>;
  historyMap?: Record<number, WatchHistoryItem>;
  onSelectMedia: (media: MediaItem) => void;
  onQuickPlay?: (media: MediaItem) => void;
  onPlayEpisode?: (media: MediaItem, episode: Episode) => void;
}

export const MediaRow: React.FC<MediaRowProps> = ({
  title,
  items,
  progressMap = {},
  historyMap = {},
  onSelectMedia,
  onQuickPlay,
  onPlayEpisode
}) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [expandedSeries, setExpandedSeries] = useState<MediaItem | null>(null);
  const [selectedSeasonNumber, setSelectedSeasonNumber] = useState<number>(1);

  const scroll = (direction: 'left' | 'right') => {
    if (scrollRef.current) {
      const scrollAmount = direction === 'left' ? -540 : 540;
      scrollRef.current.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    }
  };

  const handleOpenEpisodes = (media: MediaItem) => {
    if (media.seasons && media.seasons.length > 0) {
      setExpandedSeries(media);
      setSelectedSeasonNumber(media.seasons[0].seasonNumber);
    } else {
      onSelectMedia(media);
    }
  };

  if (!items || items.length === 0) return null;

  const currentSeason: Season | undefined =
    expandedSeries?.seasons?.find((s) => s.seasonNumber === selectedSeasonNumber) ||
    expandedSeries?.seasons?.[0];

  return (
    <section className="py-3 sm:py-4 relative group/row select-none">
      {/* Cabeçalho da Trilha */}
      <div className="max-w-[1440px] mx-auto px-3.5 sm:px-6 lg:px-8 mb-3 flex items-center justify-between">
        <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-slate-900 dark:text-white">
          {title}
        </h2>

        <div className="hidden md:flex items-center gap-1.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
          <button
            type="button"
            onClick={() => scroll('left')}
            className="w-8 h-8 rounded-full glass-subtle flex items-center justify-center hover:bg-slate-200/70 dark:hover:bg-white/15 text-slate-700 hover:text-black dark:text-white/75 dark:hover:text-white transition-colors cursor-pointer"
            aria-label={`Rolar ${title} para a esquerda`}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => scroll('right')}
            className="w-8 h-8 rounded-full glass-subtle flex items-center justify-center hover:bg-slate-200/70 dark:hover:bg-white/15 text-slate-700 hover:text-black dark:text-white/75 dark:hover:text-white transition-colors cursor-pointer"
            aria-label={`Rolar ${title} para a direita`}
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Trilha Horizontal */}
      <div
        ref={scrollRef}
        className="max-w-[1440px] mx-auto flex gap-3 sm:gap-4 overflow-x-auto no-scrollbar scroll-smooth snap-x snap-mandatory px-3.5 sm:px-6 lg:px-8 pb-3"
      >
        {items.map((item) => {
          const hist = historyMap[item.id];
          const epBadge =
            hist && typeof hist.episodeNumber === 'number'
              ? `T${hist.seasonNumber || 1}:E${hist.episodeNumber}`
              : undefined;
          const epSub = hist?.episodeTitle || undefined;

          return (
            <div key={item.id} className="snap-start">
              <MovieCard
                media={item}
                progressPercent={progressMap[item.id]}
                episodeBadge={epBadge}
                episodeSubtitle={epSub}
                onSelect={onSelectMedia}
                onQuickPlay={onQuickPlay}
                onSelectEpisodes={() => handleOpenEpisodes(item)}
              />
            </div>
          );
        })}
      </div>

      {/* Gaveta Expansível de Episódios */}
      {expandedSeries && (
        <div className="max-w-[1440px] mx-auto px-3.5 sm:px-6 lg:px-8 mt-2 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="glass-panel rounded-2xl sm:rounded-3xl p-4 sm:p-6 shadow-2xl relative">
            <button
              type="button"
              onClick={() => setExpandedSeries(null)}
              className="absolute top-4 right-4 w-8 h-8 rounded-full glass-subtle flex items-center justify-center hover:bg-slate-200 dark:hover:bg-white/15 text-slate-600 dark:text-white/60 hover:text-black dark:hover:text-white transition-colors"
              aria-label="Fechar"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pr-10">
              <h3 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-slate-700 dark:text-white/70" />
                {expandedSeries.title}
              </h3>

              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
                {expandedSeries.seasons?.map((season) => (
                  <button
                    key={season.seasonNumber}
                    type="button"
                    onClick={() => setSelectedSeasonNumber(season.seasonNumber)}
                    className={`px-3 py-1.5 rounded-full text-xs font-semibold shrink-0 transition-all ${
                      selectedSeasonNumber === season.seasonNumber
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-black shadow-md font-bold'
                        : 'glass-subtle text-slate-600 hover:text-black dark:text-white/70 dark:hover:text-white'
                    }`}
                  >
                    T{season.seasonNumber}
                  </button>
                ))}
              </div>
            </div>

            {currentSeason && currentSeason.episodes.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[360px] overflow-y-auto pr-1">
                {currentSeason.episodes.map((ep) => (
                  <div
                    key={ep.id}
                    className="p-3 rounded-2xl glass-subtle transition-all flex flex-col justify-between gap-2.5 group/ep"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="text-xs font-bold text-slate-900 dark:text-white line-clamp-1">
                          {ep.title}
                        </span>
                        <span className="text-[10px] text-slate-500 dark:text-white/45 font-mono flex items-center gap-1 shrink-0">
                          <Clock className="w-3 h-3" />
                          {ep.durationMinutes}m
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-white/55 line-clamp-2 leading-relaxed">
                        {ep.overview}
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-1.5 border-t border-slate-200/70 dark:border-white/[0.06]">
                      <span className="text-[10px] font-mono text-slate-500 dark:text-white/40">
                        T{ep.seasonNumber}:E{ep.episodeNumber}
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          if (onPlayEpisode) {
                            onPlayEpisode(expandedSeries, ep);
                          } else {
                            onSelectMedia(expandedSeries);
                          }
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-slate-900 text-white dark:bg-white dark:text-black hover:opacity-90 text-xs font-bold shadow-sm transition-transform active:scale-95"
                      >
                        <Play className="w-3 h-3 fill-current" />
                        <span>Assistir</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-slate-500 dark:text-white/50 py-4 text-center">
                Sem episódios nesta temporada.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
