/**
 * Popoca Streaming - LazyImage Component
 * Carregamento resiliente com fallback automático para proxy local (/api/proxy-image),
 * transição suave sem picos de brilho e estética Apple TV+ Liquid Glass.
 */

import React, { useState, useEffect, useRef } from 'react';
import { Film } from 'lucide-react';

interface LazyImageProps {
  src?: string;
  alt: string;
  className?: string;
  imgClassName?: string;
  placeholderClassName?: string;
  aspectRatio?: 'poster' | 'backdrop' | 'square' | 'auto';
  objectFit?: 'cover' | 'contain';
  title?: string;
  darkPlaceholder?: boolean;
}

export const LazyImage: React.FC<LazyImageProps> = ({
  src,
  alt,
  className = '',
  imgClassName = '',
  placeholderClassName = '',
  aspectRatio = 'poster',
  objectFit = 'cover',
  title,
  darkPlaceholder = false
}) => {
  const [currentSrc, setCurrentSrc] = useState<string>(src || '');
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [retryWithProxy, setRetryWithProxy] = useState(false);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    const nextSrc = src || '';
    setCurrentSrc(nextSrc);
    setHasError(!nextSrc);
    setRetryWithProxy(false);

    if (imgRef.current && imgRef.current.complete && imgRef.current.naturalWidth > 0) {
      setIsLoaded(true);
    } else {
      setIsLoaded(false);
    }
  }, [src]);

  const handleImageError = () => {
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
      className={`relative overflow-hidden ${aspectClass} ${className} ${
        darkPlaceholder ? 'bg-[#07090E]' : 'bg-slate-200/80 dark:bg-[#10131B]'
      }`}
    >
      {!isLoaded && !hasError && (
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center ${
            darkPlaceholder
              ? 'bg-[#090C14]'
              : 'bg-slate-200/90 dark:bg-[#121620] animate-pulse'
          } z-0 ${placeholderClassName}`}
        >
          {!darkPlaceholder && (
            <div className="w-8 h-8 rounded-full border border-slate-300 dark:border-white/10 flex items-center justify-center text-slate-400 dark:text-white/30">
              <Film className="w-4 h-4 opacity-50 text-slate-500 dark:text-white/60" />
            </div>
          )}
        </div>
      )}

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
          className={`w-full h-full ${fitClass} ${imgClassName} transition-all duration-1000 ease-out z-1 relative ${
            isLoaded ? 'opacity-100' : 'opacity-0'
          }`}
        />
      ) : null}

      {hasError && (
        <div
          className={`absolute inset-0 flex flex-col items-center justify-center p-3 text-center z-2 ${
            darkPlaceholder
              ? 'bg-gradient-to-b from-[#131722] to-[#07090E] text-white/60'
              : 'bg-gradient-to-b from-slate-200 to-slate-300 dark:from-[#161923] dark:to-[#0C0E14] text-slate-700 dark:text-white/60'
          }`}
        >
          <Film className={`w-7 h-7 mb-2 ${darkPlaceholder ? 'text-white/25' : 'text-slate-400 dark:text-white/30'}`} />
          <span className={`text-xs font-bold line-clamp-2 px-1 ${darkPlaceholder ? 'text-white/90' : 'text-slate-900 dark:text-white/90'}`}>
            {title || alt}
          </span>
        </div>
      )}
    </div>
  );
};
