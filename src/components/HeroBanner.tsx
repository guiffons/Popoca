/**
 * Popoca Streaming - Hero Banner Cinematográfico
 * Destaque visual estilo Apple TV em estética grafite minimalista (zero vermelho)
 * com metadados unboxed, LazyImage e ações rápidas Letterboxd.
 */

import React, { useState } from 'react';
import { Play, Info, Star, Heart, Bookmark, Layers } from 'lucide-react';
import { MediaItem } from '../types/index.ts';
import { storageService } from '../services/storage.ts';
import { LazyImage } from './LazyImage.tsx';

interface HeroBannerProps {
  media: MediaItem | null;
  onPlay: (media: MediaItem) => void;
  onOpenDetails: (media: MediaItem) => void;
}

export const HeroBanner: React.FC<HeroBannerProps> = ({
  media,
  onPlay,
  onOpenDetails
}) => {
  if (!media) return null;

  const [isLiked, setIsLiked] = useState(storageService.isLiked(media.id));
  const [inWatchlist, setInWatchlist] = useState(storageService.isInWatchlist(media.id));

  const year = media.release_date ? media.release_date.slice(0, 4) : '2024';
  const categoryLabel = media.media_type === 'tv' ? 'Série' : (media.media_type === 'anime' ? 'Anime' : 'Filme');
  const isEpisodic = media.media_type === 'tv' || media.media_type === 'anime' || (media.seasons && media.seasons.length > 0);

  const handleToggleLike = () => {
    const newState = storageService.toggleLiked(media);
    setIsLiked(newState);
  };

  const handleToggleWatchlist = () => {
    const newState = storageService.toggleWatchlist(media);
    setInWatchlist(newState);
  };

  const handlePrimaryClick = () => {
    if (isEpisodic) {
      onOpenDetails(media);
    } else {
      onPlay(media);
    }
  };

  return (
    <section className="relative w-full h-[64vh] min-h-[460px] max-h-[700px] overflow-hidden select-none">
      {/* Imagem de Fundo em Alta Definição com LazyImage */}
      <div className="absolute inset-0">
        <LazyImage
          src={media.backdrop_path}
          alt={media.title}
          title={media.title}
          aspectRatio="auto"
          className="w-full h-full object-cover object-top scale-105"
        />

        {/* Gradientes cinematográficos de contraste (Horizontal e Vertical) */}
        <div className="absolute inset-0 bg-gradient-to-t from-[#F8FAFC] via-black/75 to-transparent dark:from-[#0A0C10] dark:via-[#0A0C10]/65 dark:to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-r from-black/85 via-black/60 to-transparent md:w-3/4" />
      </div>

      {/* Conteúdo do Destaque */}
      <div className="relative h-full max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 flex flex-col justify-end pb-16 md:pb-20 z-10">
        <div className="max-w-2xl space-y-4">
          {/* Metadados desempacotados (Zero-Pill Minimalist) */}
          <div className="flex items-center flex-wrap gap-2 text-xs sm:text-sm font-medium text-white/70">
            <span className="text-white font-semibold">{categoryLabel}</span>
            <span aria-hidden="true" className="text-white/40">·</span>
            <span>{year}</span>
            {media.runtime && (
              <>
                <span aria-hidden="true" className="text-white/40">·</span>
                <span>{Math.floor(media.runtime / 60)}h {media.runtime % 60}m</span>
              </>
            )}
            {media.vote_average > 0 && (
              <>
                <span aria-hidden="true" className="text-white/40">·</span>
                <span className="flex items-center gap-1 text-amber-400 font-mono font-bold">
                  <Star className="w-3.5 h-3.5 fill-current" />
                  {media.vote_average.toFixed(1)}
                </span>
              </>
            )}
            <span aria-hidden="true" className="text-white/40">·</span>
            <span className="text-white/90 tracking-wide font-medium">Áudio pt-BR Priorizado</span>
          </div>

          {/* Título Principal */}
          <h1 className="text-3xl sm:text-5xl lg:text-6xl font-black text-white tracking-tight leading-tight line-clamp-2">
            {media.title}
          </h1>

          {/* Sinopse resumida */}
          <p className="text-xs sm:text-sm text-white/80 line-clamp-3 leading-relaxed max-w-xl">
            {media.overview}
          </p>

          {/* Botões de Ação Apple TV Style (White & Graphite Glass) */}
          <div className="flex items-center gap-3 pt-2 flex-wrap">
            <button
              onClick={handlePrimaryClick}
              className="flex items-center gap-2.5 px-6 py-3.5 bg-white text-black hover:bg-neutral-200 text-sm font-black rounded-2xl shadow-2xl transition-transform active:scale-95"
            >
              {isEpisodic ? (
                <>
                  <Layers className="w-4 h-4 fill-current" />
                  <span>Escolher Episódio</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4 fill-current ml-0.5" />
                  <span>Assistir Agora</span>
                </>
              )}
            </button>

            <button
              onClick={() => onOpenDetails(media)}
              className="flex items-center gap-2 px-5 py-3.5 glass-panel hover:bg-white/10 text-white text-sm font-semibold rounded-2xl transition-colors"
            >
              <Info className="w-4 h-4" />
              <span>Mais Informações</span>
            </button>

            {/* Ações de Perfil Letterboxd Rápidas */}
            <div className="flex items-center gap-1.5 ml-1">
              <button
                onClick={handleToggleLike}
                className={`p-3 rounded-2xl glass-subtle hover:bg-white/10 transition-colors ${
                  isLiked ? 'text-white bg-white/20' : 'text-white/60 hover:text-white'
                }`}
                title={isLiked ? 'Curtido' : 'Curtir'}
                aria-label="Curtir"
              >
                <Heart className={`w-4 h-4 ${isLiked ? 'fill-current' : ''}`} />
              </button>

              <button
                onClick={handleToggleWatchlist}
                className={`p-3 rounded-2xl glass-subtle hover:bg-white/10 transition-colors ${
                  inWatchlist ? 'text-white bg-white/20' : 'text-white/60 hover:text-white'
                }`}
                title={inWatchlist ? 'Salvo na Watchlist' : 'Salvar na Watchlist'}
                aria-label="Watchlist"
              >
                <Bookmark className={`w-4 h-4 ${inWatchlist ? 'fill-current' : ''}`} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};
