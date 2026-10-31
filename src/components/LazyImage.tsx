/**
 * Popoca Streaming - LazyImage Component
 * Carregamento ultra-robusto com suporte a cache do navegador,
 * detecção de falha de CDN com fallback automático para proxy local (/api/proxy-image),
 * transição suave de opacidade e visual Liquid Glass elegante (grafite/branco).
 */

import React, { useState, useEffect, useRef } from 'react';
import { Film } from 'lucide-react';

interface LazyImageProps {
  src?: string;
  alt: string;
  className?: string;
  placeholderClassName?: string;
  aspectRatio?: 'poster' | 'backdrop' | 'square' | 'auto';
  objectFit?: 'cover' | 'contain';
  title?: string;
}

export const LazyImage: React.FC<LazyImageProps> = ({
  src,
  alt,
  className = '',
  placeholderClassName = '',
  aspectRatio = 'poster',
  objectFit = 'cover',
  title
}) => {
  const [currentSrc, setCurrentSrc] = useState<string>(src || '');
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [retryWithProxy, setRetryWithProxy] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  // Sincroniza se a prop src mudar externamente
  useEffect(() => {
    const nextSrc = src || '';
    setCurrentSrc(nextSrc);
    setHasError(!nextSrc);
    setRetryWithProxy(false);

    // Se já estiver em cache, ativa imediatamente para evitar o placeholder preso
    if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
      setIsLoaded(true);
    } else {
      setIsLoaded(false);
    }
  }, [src]);

  const handleImageError = () => {
    // Se a URL direta falhar (ex: bloqueio de CDN, CORS ou rede móvel),
    // tenta carregar através do proxy resiliente do servidor Popoca
    if (!retryWithProxy && currentSrc && currentSrc.startsWith('http') && !currentSrc.includes('/api/proxy-image')) {
      setRetryWithProxy(true);
      setCurrentSrc(`/api/proxy-image?url=${encodeURIComponent(currentSrc)}`);
    } else {
      setHasError(true);
      setIsLoaded(true);
    }
  };

  const aspectClass =
    aspectRatio === 'poster'
      ? 'aspect-[2/3]'
      : aspectRatio === 'backdrop'
      ? 'aspect-video'
      : aspectRatio === 'square'
      ? 'aspect-square'
      : '';

  const fitClass = objectFit === 'contain' ? 'object-contain' : 'object-cover';

  return (
    <div
      className={`relative overflow-hidden ${aspectClass} ${className} bg-slate-200 dark:bg-[#111318]`}
    >
      {/* Blurred Liquid Glass Placeholder enquanto carrega */}
      {!isLoaded && !hasError && (
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center bg-slate-200/90 dark:bg-[#13161f] backdrop-blur-md animate-pulse z-0 ${placeholderClassName}`}
        >
          <div className="w-8 h-8 rounded-full border border-slate-300 dark:border-white/10 flex items-center justify-center text-slate-400 dark:text-white/30">
            <Film className="w-4 h-4 opacity-50 text-slate-500 dark:text-white/60 animate-pulse" />
          </div>
        </div>
      )}

      {/* Tag de Imagem Nativa */}
      {!hasError && currentSrc ? (
        <img
          ref={imgRef}
          src={currentSrc}
          alt={alt}
          decoding="async"
          referrerPolicy="no-referrer"
          onLoad={() => {
            setIsLoaded(true);
            setHasError(false);
          }}
          onError={handleImageError}
          className={`w-full h-full ${fitClass} transition-all duration-300 ease-out z-1 relative ${
            isLoaded ? 'opacity-100 scale-100' : 'opacity-85 scale-[1.01]'
          }`}
        />
      ) : null}

      {/* Fallback elegante em Grafite puro caso a imagem falhe totalmente */}
      {hasError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center bg-gradient-to-b from-slate-200 to-slate-300 dark:from-[#181a22] dark:to-[#0e1015] text-slate-700 dark:text-white/60 z-2">
          <Film className="w-7 h-7 mb-2 text-slate-400 dark:text-white/30" />
          <span className="text-xs font-bold text-slate-900 dark:text-white/90 line-clamp-2 px-1">
            {title || alt}
          </span>
          <span className="text-[9px] font-mono tracking-wider text-slate-500 dark:text-white/40 uppercase mt-1">
            Popoca Play
          </span>
        </div>
      )}
    </div>
  );
};
