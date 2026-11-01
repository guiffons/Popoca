/**
 * Popoca Streaming - Library & Search View (Explorar)
 * Catálogo completo estilo Apple TV+ com busca bilíngue instantânea tolerante a acentos,
 * filtros de gênero/ano (incluindo 2026) e grade responsiva fluida.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Search, X, RefreshCw, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { MediaItem } from '../types/index.ts';
import { api } from '../services/api.ts';
import { MovieCard } from './MovieCard.tsx';

interface LibrarySearchViewProps {
  initialQuery?: string;
  theme: 'dark' | 'light';
  onSelectMedia: (media: MediaItem) => void;
  onPlayMedia: (media: MediaItem) => void;
}

const GENRES = [
  { id: 'all', name: 'Todos os Gêneros' },
  { id: 28, name: 'Ação' },
  { id: 878, name: 'Ficção Científica' },
  { id: 18, name: 'Drama' },
  { id: 27, name: 'Terror' },
  { id: 35, name: 'Comédia' },
  { id: 16, name: 'Animação & Anime' },
  { id: 80, name: 'Crime' },
  { id: 12, name: 'Aventura' },
  { id: 53, name: 'Suspense' },
  { id: 14, name: 'Fantasia' },
  { id: 9648, name: 'Mistério' }
];

const YEAR_FILTERS = [
  { id: 'all', name: 'Todos os Anos' },
  { id: '2026', name: '2026' },
  { id: '2025', name: '2025' },
  { id: '2024', name: '2024' },
  { id: '2023', name: '2023' },
  { id: '2022', name: '2022' },
  { id: '2020-2021', name: '2020 - 2021' },
  { id: '2010s', name: 'Anos 2010' },
  { id: 'classics', name: 'Clássicos' }
];

function normalizeSearchText(text: string = ''): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[-:.,!?'"()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

export const LibrarySearchView: React.FC<LibrarySearchViewProps> = ({
  initialQuery = '',
  theme,
  onSelectMedia,
  onPlayMedia
}) => {
  const [query, setQuery] = useState(initialQuery);
  const [selectedType, setSelectedType] = useState<'all' | 'movie' | 'tv' | 'anime'>('all');
  const [selectedGenre, setSelectedGenre] = useState<string | number>('all');
  const [selectedYear, setSelectedYear] = useState<string>('all');
  const [sortBy, setSortBy] = useState<'popularity' | 'rating' | 'recent' | 'title'>('popularity');
  const [allItems, setAllItems] = useState<MediaItem[]>([]);
  const [remoteQueryHits, setRemoteQueryHits] = useState<Set<number>>(new Set());
  const [isLoading, setIsLoading] = useState(false);
  const [isSearchingRemote, setIsSearchingRemote] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [visibleLimit, setVisibleLimit] = useState(24);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    async function loadCatalog() {
      setIsLoading(true);
      try {
        const [trending, movies, tv, anime] = await Promise.all([
          api.getCatalog('trending'),
          api.getCatalog('movies'),
          api.getCatalog('tv'),
          api.getCatalog('anime')
        ]);

        const map = new Map<number, MediaItem>();
        [...trending, ...movies, ...tv, ...anime].forEach((item) => {
          if (!map.has(item.id)) map.set(item.id, item);
        });

        setAllItems(Array.from(map.values()));
      } catch {
        // Silencioso
      } finally {
        setIsLoading(false);
      }
    }

    loadCatalog();
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setRemoteQueryHits(new Set());
      setIsSearchingRemote(false);
      return;
    }

    let cancelled = false;
    setIsSearchingRemote(true);

    const timer = setTimeout(async () => {
      try {
        const results = await api.search(query);
        if (cancelled) return;
        if (results && results.length > 0) {
          setRemoteQueryHits(new Set(results.map((r) => r.id)));
          setAllItems((prev) => {
            const map = new Map<number, MediaItem>();
            results.forEach((r) => map.set(r.id, r));
            prev.forEach((p) => {
              if (!map.has(p.id)) map.set(p.id, p);
            });
            return Array.from(map.values());
          });
        } else {
          setRemoteQueryHits(new Set());
        }
      } catch {
        // no-op
      } finally {
        if (!cancelled) setIsSearchingRemote(false);
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [query]);

  const handleLoadMore = async () => {
    setIsLoadingMore(true);
    const nextPage = page + 1;
    setPage(nextPage);

    try {
      const moreItems = await api.getCatalog(selectedType === 'all' ? 'movies' : selectedType, nextPage);
      if (moreItems && moreItems.length > 0) {
        setAllItems((prev) => {
          const map = new Map<number, MediaItem>();
          prev.forEach((p) => map.set(p.id, p));
          moreItems.forEach((m) => {
            if (!map.has(m.id)) map.set(m.id, m);
          });
          return Array.from(map.values());
        });
      }
      setVisibleLimit((prev) => prev + 24);
    } catch {
      setVisibleLimit((prev) => prev + 24);
    } finally {
      setIsLoadingMore(false);
    }
  };

  const filteredItems = useMemo(() => {
    let result = [...allItems];
    const normQuery = normalizeSearchText(query);
    const compactQuery = normQuery.replace(/\s+/g, '');

    if (normQuery) {
      const queryTokens = normQuery.split(' ').filter((t) => t.length > 0);
      result = result.filter((item) => {
        if (remoteQueryHits.has(item.id)) return true;

        const normTitle = normalizeSearchText(item.title);
        const normOrig = normalizeSearchText(item.original_title);
        const normOverview = normalizeSearchText(item.overview || '');
        const compactTitle = normTitle.replace(/\s+/g, '');

        if (
          normTitle.includes(normQuery) ||
          normOrig.includes(normQuery) ||
          compactTitle.includes(compactQuery) ||
          normOverview.includes(normQuery)
        ) {
          return true;
        }

        if (queryTokens.length > 1) {
          return queryTokens.every((tk) => normTitle.includes(tk) || normOrig.includes(tk));
        }
        return false;
      });
    }

    if (selectedType !== 'all') {
      result = result.filter((item) => item.media_type === selectedType);
    }

    if (selectedGenre !== 'all') {
      const genreId = Number(selectedGenre);
      result = result.filter((item) => item.genre_ids?.includes(genreId));
    }

    if (selectedYear !== 'all') {
      result = result.filter((item) => {
        const itemYear = parseInt((item.release_date || '').slice(0, 4), 10);
        if (isNaN(itemYear)) return false;

        if (selectedYear === '2026') return itemYear === 2026;
        if (selectedYear === '2025') return itemYear === 2025;
        if (selectedYear === '2024') return itemYear === 2024;
        if (selectedYear === '2023') return itemYear === 2023;
        if (selectedYear === '2022') return itemYear === 2022;
        if (selectedYear === '2020-2021') return itemYear >= 2020 && itemYear <= 2021;
        if (selectedYear === '2010s') return itemYear >= 2010 && itemYear <= 2019;
        if (selectedYear === 'classics') return itemYear < 2010;
        return true;
      });
    }

    if (normQuery) {
      result.sort((a, b) => {
        const aTitle = normalizeSearchText(a.title);
        const bTitle = normalizeSearchText(b.title);
        const aExact = aTitle.startsWith(normQuery) ? 2 : aTitle.includes(normQuery) ? 1 : 0;
        const bExact = bTitle.startsWith(normQuery) ? 2 : bTitle.includes(normQuery) ? 1 : 0;
        if (bExact !== aExact) return bExact - aExact;
        return b.vote_count - a.vote_count;
      });
      return result;
    }

    switch (sortBy) {
      case 'rating':
        result.sort((a, b) => b.vote_average - a.vote_average);
        break;
      case 'recent':
        result.sort((a, b) => (b.release_date || '').localeCompare(a.release_date || ''));
        break;
      case 'title':
        result.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR'));
        break;
      case 'popularity':
      default:
        result.sort((a, b) => b.vote_count - a.vote_count);
        break;
    }

    return result;
  }, [allItems, remoteQueryHits, query, selectedType, selectedGenre, selectedYear, sortBy]);

  const visibleItems = filteredItems.slice(0, visibleLimit);
  const hasMore = visibleLimit < filteredItems.length;
  const isLight = theme === 'light';

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="max-w-[1440px] mx-auto px-3.5 sm:px-6 lg:px-8 py-6 sm:py-8"
    >
      {/* Cabeçalho Limpo */}
      <div className="mb-5">
        <h1 className={`text-2xl sm:text-3xl font-extrabold tracking-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
          Explorar
        </h1>
      </div>

      {/* Barra de Pesquisa Liquid Glass */}
      <div className="relative mb-5">
        <input
          type="text"
          placeholder="Filmes, séries e animes"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`w-full text-sm sm:text-base pl-11 pr-10 py-3 sm:py-3.5 rounded-2xl border transition-all focus:outline-none ${
            isLight
              ? 'bg-white/90 border-slate-900/10 text-slate-900 placeholder-slate-400 shadow-sm focus:border-slate-900/30 focus:bg-white focus:ring-2 focus:ring-slate-900/10'
              : 'bg-white/[0.06] border-white/10 text-white placeholder-white/40 focus:bg-white/[0.1] focus:border-white/25'
          }`}
        />
        <Search className={`w-4 h-4 sm:w-5 sm:h-5 absolute left-4 top-1/2 -translate-y-1/2 ${isLight ? 'text-slate-400' : 'text-white/40'}`} />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className={`absolute right-3.5 top-1/2 -translate-y-1/2 p-1 rounded-full ${
              isLight ? 'text-slate-400 hover:text-black' : 'text-white/40 hover:text-white'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Filtros Responsivos Estilo Apple TV+ */}
      <div className="p-3 sm:p-4 rounded-2xl glass-panel mb-7 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {[
            { id: 'all', label: 'Tudo' },
            { id: 'movie', label: 'Filmes' },
            { id: 'tv', label: 'Séries' },
            { id: 'anime', label: 'Animes' }
          ].map((type) => (
            <button
              key={type.id}
              type="button"
              onClick={() => setSelectedType(type.id as any)}
              className={`px-3.5 py-1.5 rounded-full text-xs font-bold shrink-0 transition-all cursor-pointer ${
                selectedType === type.id
                  ? isLight
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-white text-black shadow-sm'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-900/[0.05]'
                  : 'text-white/65 hover:text-white hover:bg-white/[0.08]'
              }`}
            >
              {type.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 sm:flex items-center gap-2 w-full lg:w-auto">
          <div className="relative">
            <select
              value={selectedGenre}
              onChange={(e) => setSelectedGenre(e.target.value)}
              className={`w-full sm:w-auto text-xs pl-3 pr-7 py-2 rounded-xl border appearance-none focus:outline-none transition-colors cursor-pointer ${
                isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-[#121620] border-white/10 text-white'
              }`}
            >
              {GENRES.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <ChevronDown className={`w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${isLight ? 'text-slate-500' : 'text-white/40'}`} />
          </div>

          <div className="relative">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className={`w-full sm:w-auto text-xs pl-3 pr-7 py-2 rounded-xl border appearance-none focus:outline-none transition-colors cursor-pointer ${
                isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-[#121620] border-white/10 text-white'
              }`}
            >
              {YEAR_FILTERS.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </select>
            <ChevronDown className={`w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${isLight ? 'text-slate-500' : 'text-white/40'}`} />
          </div>

          <div className="relative col-span-2 sm:col-span-1">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className={`w-full sm:w-auto text-xs pl-3 pr-7 py-2 rounded-xl border appearance-none focus:outline-none transition-colors cursor-pointer ${
                isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-[#121620] border-white/10 text-white'
              }`}
            >
              <option value="popularity">Mais Populares</option>
              <option value="rating">Melhores Avaliados</option>
              <option value="recent">Mais Recentes</option>
              <option value="title">A–Z</option>
            </select>
            <ChevronDown className={`w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${isLight ? 'text-slate-500' : 'text-white/40'}`} />
          </div>
        </div>
      </div>

      {/* Grade de Resultados */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <span className={`text-xs font-medium ${isLight ? 'text-slate-600' : 'text-white/45'}`}>
            {filteredItems.length} {filteredItems.length === 1 ? 'título' : 'títulos'}
          </span>
          {(isLoading || isSearchingRemote) && (
            <span className={`flex items-center gap-1.5 text-xs font-medium ${isLight ? 'text-slate-700' : 'text-white/70'}`}>
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              <span>Atualizando...</span>
            </span>
          )}
        </div>

        {visibleItems.length > 0 ? (
          <>
            <motion.div
              layout
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-5"
            >
              <AnimatePresence mode="popLayout">
                {visibleItems.map((item, idx) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, scale: 0.96 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.96 }}
                    transition={{ duration: 0.22, delay: Math.min(idx * 0.02, 0.25) }}
                  >
                    <MovieCard
                      media={item}
                      fluid
                      onSelect={onSelectMedia}
                      onQuickPlay={onPlayMedia}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>

            {hasMore && (
              <div className="mt-10 text-center">
                <button
                  type="button"
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className={`inline-flex items-center gap-2 px-6 py-2.5 rounded-full text-xs sm:text-sm font-bold transition-all shadow-md active:scale-95 cursor-pointer ${
                    isLight
                      ? 'bg-slate-900 text-white hover:bg-slate-800'
                      : 'bg-white text-black hover:bg-slate-200'
                  }`}
                >
                  {isLoadingMore ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Carregando...</span>
                    </>
                  ) : (
                    <span>Carregar mais</span>
                  )}
                </button>
              </div>
            )}
          </>
        ) : isSearchingRemote || isLoading ? (
          <div className="py-20 text-center glass-panel rounded-3xl max-w-md mx-auto p-6">
            <RefreshCw className={`w-8 h-8 mx-auto mb-3 animate-spin opacity-60 ${isLight ? 'text-slate-800' : 'text-white'}`} />
            <p className={`text-sm font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>
              Buscando...
            </p>
          </div>
        ) : (
          <div className="py-20 text-center glass-panel rounded-3xl max-w-md mx-auto p-6">
            <Search className={`w-10 h-10 mx-auto mb-3 opacity-30 ${isLight ? 'text-slate-800' : 'text-white'}`} />
            <p className={`text-sm font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>
              Nenhum resultado encontrado
            </p>
          </div>
        )}
      </div>
    </motion.div>
  );
};
