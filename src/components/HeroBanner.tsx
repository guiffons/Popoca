/**
 * Popoca Streaming - Apple TV+ Widescreen Cinema Stage (HeroBanner)
 * - Luminosidade cinematográfica constante (zero estouro de brilho após carregar o backdrop)
 * - Palco escuro arredondado estilo Apple TV+ que preserva contraste perfeito tanto no modo escuro quanto no modo claro
 * - Filmes atuais de 2026 verificados e layout 100% responsivo em telas pequenas e grandes
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Play,
  Info,
  Star,
  Heart,
  Bookmark,
  Layers,
  ChevronLeft,
  ChevronRight
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MediaItem } from '../types/index.ts';
import { storageService } from '../services/storage.ts';
import { LazyImage } from './LazyImage.tsx';

interface HeroBannerProps {
  media?: MediaItem | null;
  items?: MediaItem[];
  onPlay: (media: MediaItem) => void;
  onOpenDetails: (media: MediaItem) => void;
}

export const HeroBanner: React.FC<HeroBannerProps> = ({
  media,
  items,
  onPlay,
  onOpenDetails
}) => {
  const slides = (items && items.length > 0 ? items : media ? [media] : []).slice(0, 8);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const timerRef = useRef<any>(null);

  const activeIndex = currentIndex >= slides.length ? 0 : currentIndex;
  const currentMedia = slides[activeIndex];

  useEffect(() => {
    if (slides.length <= 1 || isHovered) return;

    timerRef.current = setInterval(() => {
      setCurrentIndex((prev) => (prev + 1) % slides.length);
    }, 8000);

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [slides.length, isHovered, activeIndex]);

  const [isLiked, setIsLiked] = useState(() =>
    currentMedia ? storageService.isLiked(currentMedia.id) : false
  );
  const [inWatchlist, setInWatchlist] = useState(() =>
    currentMedia ? storageService.isInWatchlist(currentMedia.id) : false
  );

  useEffect(() => {
    if (!currentMedia) return;
    setIsLiked(storageService.isLiked(currentMedia.id));
    setInWatchlist(storageService.isInWatchlist(currentMedia.id));
  }, [currentMedia?.id]);

  const touchStartRef = useRef<{ x: number; y: number; t: number } | null>(null);
  const [dragOffset, setDragOffset] = useState(0);
  const isHorizontalSwipeRef = useRef<boolean | null>(null);

  if (!currentMedia) return null;

  const year = currentMedia.release_date ? currentMedia.release_date.slice(0, 4) : '2026';
  const categoryLabel =
    currentMedia.media_type === 'tv'
      ? 'Série'
      : currentMedia.media_type === 'anime'
        ? 'Anime'
        : 'Filme';
  const primaryGenre = currentMedia.genres?.[0]?.name;
  const isEpisodic =
    currentMedia.media_type === 'tv' ||
    currentMedia.media_type === 'anime' ||
    Boolean(currentMedia.seasons && currentMedia.seasons.length > 0);

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev - 1 + slides.length) % slides.length);
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((prev) => (prev + 1) % slides.length);
  };

  // Swipe com o dedo (celular/tablet) para navegar entre os filmes do momento
  const handleTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY, t: Date.now() };
    isHorizontalSwipeRef.current = null;
    setIsHovered(true); // pausa o autoplay enquanto o dedo está na tela
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    const start = touchStartRef.current;
    if (!start || slides.length <= 1) return;
    const t = e.touches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (isHorizontalSwipeRef.current === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      isHorizontalSwipeRef.current = Math.abs(dx) > Math.abs(dy);
    }
    if (isHorizontalSwipeRef.current) {
      setDragOffset(dx);
    }
  };

  const handleTouchEnd = () => {
    const start = touchStartRef.current;
    touchStartRef.current = null;
    setIsHovered(false);
    if (!start || !isHorizontalSwipeRef.current || slides.length <= 1) {
      setDragOffset(0);
      return;
    }
    const elapsed = Math.max(1, Date.now() - start.t);
    const velocity = Math.abs(dragOffset) / elapsed; // px/ms
    if (Math.abs(dragOffset) > 50 || velocity > 0.45) {
      if (dragOffset < 0) {
        setCurrentIndex((prev) => (prev + 1) % slides.length);
      } else {
        setCurrentIndex((prev) => (prev - 1 + slides.length) % slides.length);
      }
    }
    setDragOffset(0);
    isHorizontalSwipeRef.current = null;
  };

  const handleToggleLike = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newState = storageService.toggleLiked(currentMedia);
    setIsLiked(newState);
  };

  const handleToggleWatchlist = (e: React.MouseEvent) => {
    e.stopPropagation();
    const newState = storageService.toggleWatchlist(currentMedia);
    setInWatchlist(newState);
  };

  const handlePrimaryClick = () => {
    if (isEpisodic) {
      onOpenDetails(currentMedia);
    } else {
      onPlay(currentMedia);
    }
  };

  return (
    <div className="max-w-[1440px] mx-auto px-2.5 sm:px-5 lg:px-8 pt-1.5 sm:pt-2">
      <section
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchEnd}
        style={{ touchAction: 'pan-y' }}
        className="relative w-full h-[430px] sm:h-[520px] lg:h-[620px] rounded-[24px] sm:rounded-[32px] overflow-hidden bg-[#07090E] select-none group shadow-[0_24px_60px_-15px_rgba(15,23,42,0.35)] dark:shadow-[0_28px_70px_-15px_rgba(0,0,0,0.75)] ring-1 ring-slate-900/10 dark:ring-white/[0.1]"
      >
        {/* Imagem de Fundo com Iluminação Suave e Gradual Cinematográfica estilo Apple TV */}
        <AnimatePresence mode="sync">
          <motion.div
            key={currentMedia.id}
            initial={{ opacity: 0, scale: 1.02, filter: 'brightness(0.65) contrast(1.02)' }}
            animate={{ opacity: 1, scale: 1, filter: 'brightness(0.88) contrast(1.05) saturate(1.08)' }}
            exit={{ opacity: 0, filter: 'brightness(0.60)' }}
            transition={{ duration: 1.4, ease: [0.16, 1, 0.3, 1] }}
            className="absolute inset-0 bg-[#07090E]"
          >
            <div
              className="w-full h-full"
              style={{
                transform: dragOffset ? `translateX(${dragOffset * 0.35}px)` : undefined,
                transition: dragOffset ? 'none' : 'transform 0.45s cubic-bezier(0.16, 1, 0.3, 1)'
              }}
            >
            <LazyImage
              src={currentMedia.backdrop_path}
              alt={currentMedia.title}
              title={currentMedia.title}
              aspectRatio="auto"
              darkPlaceholder
              className="w-full h-full"
              imgClassName="object-top"
            />
            </div>
          </motion.div>
        </AnimatePresence>

        {/* Scrims Cinematográficos Apple TV+ com Iluminação Balanceada e Legibilidade Nítida */}
        <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#07090E]/60 via-[#07090E]/15 to-transparent pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#07090E] via-[#07090E]/40 to-transparent pointer-events-none" />
        <div className="absolute inset-0 bg-gradient-to-r from-[#07090E]/90 via-[#07090E]/40 to-transparent sm:w-3/4 pointer-events-none" />

        {/* Setas Laterais Discretas */}
        {slides.length > 1 && (
          <>
            <button
              type="button"
              onClick={handlePrev}
              aria-label="Anterior"
              className="hidden sm:flex absolute left-4 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/45 backdrop-blur-xl border border-white/15 items-center justify-center text-white/75 hover:text-white hover:bg-white/20 transition-all opacity-0 group-hover:opacity-100 cursor-pointer"
            >
              <ChevronLeft className="w-5 h-5" />
            </button>
            <button
              type="button"
              onClick={handleNext}
              aria-label="Próximo"
              className="hidden sm:flex absolute right-4 top-1/2 -translate-y-1/2 z-20 w-10 h-10 rounded-full bg-black/45 backdrop-blur-xl border border-white/15 items-center justify-center text-white/75 hover:text-white hover:bg-white/20 transition-all opacity-0 group-hover:opacity-100 cursor-pointer"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
          </>
        )}

        {/* Conteúdo Editorial Limpo Apple TV+ */}
        <div
          className="relative h-full px-5 sm:px-9 lg:px-14 pb-6 sm:pb-10 lg:pb-12 flex flex-col justify-end z-10"
          style={{
            transform: dragOffset ? `translateX(${dragOffset * 0.45}px)` : undefined,
            opacity: dragOffset ? Math.max(0.5, 1 - Math.abs(dragOffset) / 500) : 1,
            transition: dragOffset ? 'none' : 'transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease'
          }}
        >
          <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5">
            <AnimatePresence mode="wait">
              <motion.div
                key={currentMedia.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.3, ease: 'easeOut' }}
                className="max-w-2xl space-y-2.5 sm:space-y-3.5"
              >
                {/* Linha de Metadados Minimalista */}
                <div className="flex items-center flex-wrap gap-2 text-[11px] sm:text-xs font-semibold tracking-wide text-white/75 uppercase">
                  <span className="text-white">{categoryLabel}</span>
                  {primaryGenre && (
                    <>
                      <span aria-hidden="true" className="text-white/35">·</span>
                      <span>{primaryGenre}</span>
                    </>
                  )}
                  <span aria-hidden="true" className="text-white/35">·</span>
                  <span className="font-mono">{year}</span>
                  {currentMedia.runtime && (
                    <>
                      <span aria-hidden="true" className="text-white/35">·</span>
                      <span className="normal-case">
                        {Math.floor(currentMedia.runtime / 60)}h {currentMedia.runtime % 60}m
                      </span>
                    </>
                  )}
                  {currentMedia.vote_average > 0 && (
                    <>
                      <span aria-hidden="true" className="text-white/35">·</span>
                      <span className="flex items-center gap-1 text-amber-400 font-mono font-bold">
                        <Star className="w-3 h-3 fill-current" />
                        {currentMedia.vote_average.toFixed(1)}
                      </span>
                    </>
                  )}
                </div>

                {/* Título */}
                <h1 className="text-2xl sm:text-4xl lg:text-[52px] font-extrabold text-white tracking-tight leading-[1.08] line-clamp-2">
                  {currentMedia.title}
                </h1>

                {/* Sinopse Concisa */}
                <p className="text-xs sm:text-sm text-white/80 line-clamp-2 sm:line-clamp-3 leading-relaxed max-w-xl">
                  {currentMedia.overview}
                </p>

                {/* Ações em Pílula Estilo Apple TV+ */}
                <div className="flex items-center gap-2.5 pt-1 flex-wrap">
                  <button
                    type="button"
                    onClick={handlePrimaryClick}
                    className="flex items-center gap-2 px-5 sm:px-7 py-2.5 sm:py-3 bg-white text-black hover:bg-white/90 text-xs sm:text-sm font-bold rounded-full shadow-xl transition-transform active:scale-95 cursor-pointer"
                  >
                    {isEpisodic ? (
                      <>
                        <Layers className="w-4 h-4 fill-current" />
                        <span>Episódios</span>
                      </>
                    ) : (
                      <>
                        <Play className="w-4 h-4 fill-current ml-0.5" />
                        <span>Assistir</span>
                      </>
                    )}
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenDetails(currentMedia)}
                    className="flex items-center gap-2 px-4 sm:px-5 py-2.5 sm:py-3 rounded-full bg-white/14 hover:bg-white/22 backdrop-blur-2xl border border-white/18 text-white text-xs sm:text-sm font-semibold transition-colors cursor-pointer"
                  >
                    <Info className="w-4 h-4" />
                    <span>Detalhes</span>
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleLike}
                    className={`w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center backdrop-blur-2xl border transition-colors cursor-pointer ${isLiked
                        ? 'bg-white text-black border-white'
                        : 'bg-white/12 border-white/16 text-white/80 hover:text-white hover:bg-white/20'
                      }`}
                    title={isLiked ? 'Curtido' : 'Curtir'}
                    aria-label="Curtir"
                  >
                    <Heart className={`w-4 h-4 ${isLiked ? 'fill-current' : ''}`} />
                  </button>

                  <button
                    type="button"
                    onClick={handleToggleWatchlist}
                    className={`w-10 h-10 sm:w-11 sm:h-11 rounded-full flex items-center justify-center backdrop-blur-2xl border transition-colors cursor-pointer ${inWatchlist
                        ? 'bg-white text-black border-white'
                        : 'bg-white/12 border-white/16 text-white/80 hover:text-white hover:bg-white/20'
                      }`}
                    title={inWatchlist ? 'Na Watchlist' : 'Adicionar à Watchlist'}
                    aria-label="Watchlist"
                  >
                    <Bookmark className={`w-4 h-4 ${inWatchlist ? 'fill-current' : ''}`} />
                  </button>
                </div>
              </motion.div>
            </AnimatePresence>

            {/* Indicadores Minimalistas Apple TV+ */}
            {slides.length > 1 && (
              <div className="flex items-center gap-1.5 self-start lg:self-end pt-1">
                {slides.map((s, idx) => {
                  const isActive = idx === activeIndex;
                  return (
                    <button
                      key={s.id}
                      type="button"
                      onClick={() => setCurrentIndex(idx)}
                      title={s.title}
                      aria-label={`Ir para ${s.title}`}
                      className={`h-1.5 rounded-full transition-all duration-300 cursor-pointer ${isActive
                          ? 'w-7 bg-white shadow-sm'
                          : 'w-1.5 bg-white/35 hover:bg-white/65'
                        }`}
                    />
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
};
