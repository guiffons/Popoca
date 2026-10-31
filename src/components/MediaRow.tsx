/**
 * Popoca Streaming - Media Row Component
 * Trilha horizontal estilo Apple TV com botões de rolagem suave, suporte a swipe touch
 * e gaveta expansível interativa para seleção direta de temporadas e episódios.
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
      const scrollAmount = direction === 'left' ? -500 : 500;
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

  const currentSeason: Season | undefined = expandedSeries?.seasons?.find(
    (s) => s.seasonNumber === selectedSeasonNumber
  ) || expandedSeries?.seasons?.[0];

  return (
    <section className="py-4 md:py-6 relative group/row select-none">
      {/* Cabeçalho da Seção */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mb-3 flex items-center justify-between">
        <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
          <span>{title}</span>
        </h2>

        {/* Controles de Navegação Desktop */}
        <div className="hidden md:flex items-center gap-1.5 opacity-0 group-hover/row:opacity-100 transition-opacity">
          <button
            onClick={() => scroll('left')}
            className="p-1.5 rounded-lg glass-subtle hover:bg-slate-200/60 dark:hover:bg-white/10 text-slate-700 hover:text-black dark:text-white/70 dark:hover:text-white transition-colors"
            aria-label={`Rolar ${title} para a esquerda`}
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <button
            onClick={() => scroll('right')}
            className="p-1.5 rounded-lg glass-subtle hover:bg-slate-200/60 dark:hover:bg-white/10 text-slate-700 hover:text-black dark:text-white/70 dark:hover:text-white transition-colors"
            aria-label={`Rolar ${title} para a direita`}
          >
            <ChevronRight className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Carrossel Horizontal com Snap e Touch Pan */}
      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto no-scrollbar scroll-smooth snap-x snap-mandatory px-4 sm:px-6 lg:px-8 pb-3"
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

      {/* Gaveta Expansível de Temporadas e Episódios (Apple TV Liquid Glass Tray) */}
      {expandedSeries && (
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 mt-3 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className="glass-panel rounded-2xl sm:rounded-3xl p-4 sm:p-6 border border-white/60 dark:border-white/10 shadow-2xl relative">
            {/* Botão Fechar Gaveta */}
            <button
              onClick={() => setExpandedSeries(null)}
              className="absolute top-4 right-4 p-2 rounded-full glass-subtle hover:bg-slate-200 dark:hover:bg-white/10 text-slate-600 dark:text-white/60 hover:text-black dark:hover:text-white transition-colors"
              aria-label="Fechar lista de episódios"
            >
              <X className="w-4 h-4" />
            </button>

            {/* Cabeçalho da Gaveta */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pr-10">
              <div>
                <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-neutral-400">
                  Seleção Rápida de Episódios
                </span>
                <h3 className="text-lg sm:text-xl font-bold text-slate-900 dark:text-white flex items-center gap-2">
                  <Layers className="w-5 h-5 text-slate-700 dark:text-neutral-300" />
                  {expandedSeries.title}
                </h3>
              </div>

              {/* Seletor de Temporadas (Tabs) */}
              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-1">
                {expandedSeries.seasons?.map((season) => (
                  <button
                    key={season.seasonNumber}
                    onClick={() => setSelectedSeasonNumber(season.seasonNumber)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold shrink-0 transition-all ${
                      selectedSeasonNumber === season.seasonNumber
                        ? 'bg-slate-900 text-white dark:bg-white dark:text-black shadow-lg font-bold'
                        : 'glass-subtle text-slate-600 hover:text-black dark:text-white/70 dark:hover:text-white hover:bg-slate-200/50 dark:hover:bg-white/10'
                    }`}
                  >
                    T{season.seasonNumber} · {season.name.split(':')[0]}
                  </button>
                ))}
              </div>
            </div>

            {/* Grid de Episódios da Temporada Selecionada */}
            {currentSeason && currentSeason.episodes.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-h-[380px] overflow-y-auto pr-1">
                {currentSeason.episodes.map((ep) => (
                  <div
                    key={ep.id}
                    className="p-3 rounded-xl glass-subtle hover:bg-white/60 dark:hover:bg-white/[0.07] border border-white/60 dark:border-white/[0.05] transition-all flex flex-col justify-between gap-2.5 group/ep shadow-sm"
                  >
                    <div>
                      <div className="flex items-start justify-between gap-2 mb-1">
                        <span className="text-xs font-bold text-slate-900 dark:text-white group-hover/ep:opacity-90 line-clamp-1">
                          {ep.title}
                        </span>
                        <span className="text-[10px] text-slate-500 dark:text-white/40 font-mono flex items-center gap-1 shrink-0">
                          <Clock className="w-3 h-3" />
                          {ep.durationMinutes}m
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-600 dark:text-white/50 line-clamp-2 leading-relaxed">
                        {ep.overview}
                      </p>
                    </div>

                    <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 dark:border-white/[0.04]">
                      <span className="text-[10px] font-mono text-slate-400 dark:text-white/30">
                        S{ep.seasonNumber} : E{ep.episodeNumber}
                      </span>
                      <button
                        onClick={() => {
                          if (onPlayEpisode) {
                            onPlayEpisode(expandedSeries, ep);
                          } else {
                            onSelectMedia(expandedSeries);
                          }
                        }}
                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-900 text-white dark:bg-white dark:text-black hover:bg-slate-800 dark:hover:bg-neutral-200 text-xs font-bold shadow-md transition-transform active:scale-95"
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
                Nenhum episódio cadastrado para esta temporada.
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
};
