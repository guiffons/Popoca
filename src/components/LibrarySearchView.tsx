/**
 * Popoca Streaming - Library & Infinite Search View Component
 * Catálogo infinito no estilo Stremio com pesquisa avançada (título, ator, diretor, ano),
 * filtros dinâmicos de tipo e gênero, paginação fluida e animações de entrada framer-motion.
 */

import React, { useState, useEffect, useMemo } from 'react';
import { Search, Film, Tv, Sparkles, Filter, SlidersHorizontal, Star, X, Calendar, RefreshCw, ChevronDown } from 'lucide-react';
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
  { id: '2025', name: '2025' },
  { id: '2024', name: '2024' },
  { id: '2023', name: '2023' },
  { id: '2022', name: '2022' },
  { id: '2020-2021', name: '2020 - 2021' },
  { id: '2010s', name: 'Anos 2010' },
  { id: 'classics', name: 'Clássicos (Antes de 2010)' }
];

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
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [page, setPage] = useState(1);
  const [visibleLimit, setVisibleLimit] = useState(24);

  useEffect(() => {
    setQuery(initialQuery);
  }, [initialQuery]);

  // Carrega catálogo inicial completo para a biblioteca (Stremio mega catalog)
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

        // Indexa e une sem duplicatas
        const map = new Map<number, MediaItem>();
        [...trending, ...movies, ...tv, ...anime].forEach(item => {
          if (!map.has(item.id)) map.set(item.id, item);
        });

        setAllItems(Array.from(map.values()));
      } catch (err) {
        console.warn('Erro ao carregar catálogo da biblioteca:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadCatalog();
  }, []);

  // Busca remota instantânea no TMDB e Cinemeta enquanto o usuário digita
  useEffect(() => {
    if (!query.trim()) return;

    const timer = setTimeout(async () => {
      try {
        const results = await api.search(query);
        if (results && results.length > 0) {
          setAllItems(prev => {
            const map = new Map<number, MediaItem>();
            results.forEach(r => map.set(r.id, r));
            prev.forEach(p => {
              if (!map.has(p.id)) map.set(p.id, p);
            });
            return Array.from(map.values());
          });
        }
      } catch {
        // no-op
      }
    }, 240);

    return () => clearTimeout(timer);
  }, [query]);

  // Carrega páginas adicionais do catálogo dinâmico (Scroll Infinito / Paginação)
  const handleLoadMore = async () => {
    setIsLoadingMore(true);
    const nextPage = page + 1;
    setPage(nextPage);

    try {
      const moreItems = await api.getCatalog(selectedType === 'all' ? 'movies' : selectedType, nextPage);
      if (moreItems && moreItems.length > 0) {
        setAllItems(prev => {
          const map = new Map<number, MediaItem>();
          prev.forEach(p => map.set(p.id, p));
          moreItems.forEach(m => {
            if (!map.has(m.id)) map.set(m.id, m);
          });
          return Array.from(map.values());
        });
      }
      setVisibleLimit(prev => prev + 24);
    } catch (e) {
      console.warn('Não há mais itens adicionais:', e);
      setVisibleLimit(prev => prev + 24);
    } finally {
      setIsLoadingMore(false);
    }
  };

  // Filtragem e Ordenação dos resultados em memória
  const filteredItems = useMemo(() => {
    let result = [...allItems];

    // 1. Filtro por texto (título, título original ou sinopse)
    if (query.trim()) {
      const q = query.toLowerCase().trim();
      result = result.filter(item => 
        item.title.toLowerCase().includes(q) ||
        item.original_title.toLowerCase().includes(q) ||
        (item.overview && item.overview.toLowerCase().includes(q))
      );
    }

    // 2. Filtro por tipo de mídia
    if (selectedType !== 'all') {
      result = result.filter(item => item.media_type === selectedType);
    }

    // 3. Filtro por gênero
    if (selectedGenre !== 'all') {
      const genreId = Number(selectedGenre);
      result = result.filter(item => item.genre_ids?.includes(genreId));
    }

    // 4. Filtro por ano de lançamento
    if (selectedYear !== 'all') {
      result = result.filter(item => {
        const itemYear = parseInt((item.release_date || '').slice(0, 4), 10);
        if (isNaN(itemYear)) return false;

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

    // 5. Ordenação
    switch (sortBy) {
      case 'rating':
        result.sort((a, b) => b.vote_average - a.vote_average);
        break;
      case 'recent':
        result.sort((a, b) => (b.release_date || '').localeCompare(a.release_date || ''));
        break;
      case 'title':
        result.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'popularity':
      default:
        result.sort((a, b) => b.vote_count - a.vote_count);
        break;
    }

    return result;
  }, [allItems, query, selectedType, selectedGenre, selectedYear, sortBy]);

  const visibleItems = filteredItems.slice(0, visibleLimit);
  const hasMore = visibleLimit < filteredItems.length;

  const isLight = theme === 'light';

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8"
    >
      
      {/* Cabeçalho da Biblioteca */}
      <div className="mb-6">
        <h1 className={`text-2xl sm:text-4xl font-black tracking-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
          Biblioteca & Busca Avançada
        </h1>
        <p className={`text-xs sm:text-sm mt-1.5 ${isLight ? 'text-slate-600' : 'text-white/50'}`}>
          O catálogo completo e infinito do Popoca: pesquise por títulos, diretores ou filtre por gênero e ano.
        </p>
      </div>

      {/* Barra de Pesquisa Principal */}
      <div className="relative mb-6">
        <input
          type="text"
          placeholder="Pesquisar por título, diretor, personagem ou sinopse..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className={`w-full text-sm sm:text-base pl-12 pr-10 py-3.5 rounded-2xl border transition-all focus:outline-none ${
            isLight
              ? 'bg-white/80 border-slate-200 text-slate-900 placeholder-slate-400 shadow-sm focus:border-slate-900 focus:bg-white focus:ring-2 focus:ring-slate-900/10'
              : 'bg-white/[0.05] border-white/10 text-white placeholder-white/40 focus:bg-white/[0.08] focus:border-white/30'
          }`}
        />
        <Search className={`w-5 h-5 absolute left-4 top-1/2 -translate-y-1/2 ${isLight ? 'text-slate-400' : 'text-white/40'}`} />
        {query && (
          <button
            onClick={() => setQuery('')}
            className={`absolute right-4 top-1/2 -translate-y-1/2 p-1 rounded-full ${
              isLight ? 'text-slate-400 hover:text-black' : 'text-white/40 hover:text-white'
            }`}
          >
            <X className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Controles de Filtros e Ordenação estilo Apple TV */}
      <div className={`p-4 rounded-2xl glass-subtle border mb-8 flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4 ${
        isLight ? 'border-slate-200/80 bg-white/60 shadow-sm' : 'border-white/[0.06] bg-[#12151c]/70'
      }`}>
        
        {/* Filtros por Categoria (Abas) */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {[
            { id: 'all', label: 'Tudo' },
            { id: 'movie', label: 'Filmes' },
            { id: 'tv', label: 'Séries' },
            { id: 'anime', label: 'Animes' }
          ].map((type) => (
            <button
              key={type.id}
              onClick={() => setSelectedType(type.id as any)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-bold transition-all ${
                selectedType === type.id
                  ? isLight
                    ? 'bg-slate-900 text-white shadow-md'
                    : 'bg-white text-black shadow-md'
                  : isLight
                    ? 'text-slate-600 hover:text-black hover:bg-slate-200/60'
                    : 'text-white/60 hover:text-white hover:bg-white/[0.06]'
              }`}
            >
              {type.label}
            </button>
          ))}
        </div>

        {/* Filtros de Gênero, Ano e Ordenação */}
        <div className="flex items-center gap-2.5 w-full lg:w-auto flex-wrap">
          
          {/* Seletor de Gênero */}
          <div className="relative">
            <select
              value={selectedGenre}
              onChange={(e) => setSelectedGenre(e.target.value)}
              className={`text-xs pl-3 pr-8 py-2 rounded-xl border appearance-none focus:outline-none transition-colors cursor-pointer ${
                isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-[#14161c] border-white/10 text-white'
              }`}
            >
              {GENRES.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
            <ChevronDown className={`w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${isLight ? 'text-slate-400' : 'text-white/40'}`} />
          </div>

          {/* Seletor de Ano */}
          <div className="relative">
            <select
              value={selectedYear}
              onChange={(e) => setSelectedYear(e.target.value)}
              className={`text-xs pl-3 pr-8 py-2 rounded-xl border appearance-none focus:outline-none transition-colors cursor-pointer ${
                isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-[#14161c] border-white/10 text-white'
              }`}
            >
              {YEAR_FILTERS.map((y) => (
                <option key={y.id} value={y.id}>
                  {y.name}
                </option>
              ))}
            </select>
            <ChevronDown className={`w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${isLight ? 'text-slate-400' : 'text-white/40'}`} />
          </div>

          {/* Seletor de Ordenação */}
          <div className="relative">
            <select
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value as any)}
              className={`text-xs pl-3 pr-8 py-2 rounded-xl border appearance-none focus:outline-none transition-colors cursor-pointer ${
                isLight ? 'bg-white border-slate-200 text-slate-800 shadow-sm' : 'bg-[#14161c] border-white/10 text-white'
              }`}
            >
              <option value="popularity">Mais Populares</option>
              <option value="rating">Melhores Avaliados ★</option>
              <option value="recent">Mais Recentes</option>
              <option value="title">Ordem Alfabética</option>
            </select>
            <ChevronDown className={`w-3.5 h-3.5 absolute right-2.5 top-1/2 -translate-y-1/2 pointer-events-none ${isLight ? 'text-slate-400' : 'text-white/40'}`} />
          </div>

        </div>

      </div>

      {/* Resultados da Biblioteca e Grade Infinita */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <span className={`text-xs font-mono ${isLight ? 'text-slate-600 font-medium' : 'text-white/50'}`}>
            Exibindo {visibleItems.length} de {filteredItems.length} {filteredItems.length === 1 ? 'título' : 'títulos'}
          </span>
        </div>

        {visibleItems.length > 0 ? (
          <>
            <motion.div
              layout
              className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-6"
            >
              <AnimatePresence mode="popLayout">
                {visibleItems.map((item, idx) => (
                  <motion.div
                    key={item.id}
                    initial={{ opacity: 0, scale: 0.94 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.94 }}
                    transition={{ duration: 0.25, delay: Math.min(idx * 0.02, 0.3) }}
                  >
                    <MovieCard
                      media={item}
                      onSelect={onSelectMedia}
                      onQuickPlay={onPlayMedia}
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </motion.div>

            {/* Botão de Paginação / Scroll Infinito Estilo Stremio */}
            {hasMore && (
              <div className="mt-12 text-center">
                <button
                  onClick={handleLoadMore}
                  disabled={isLoadingMore}
                  className={`inline-flex items-center gap-2 px-6 py-3 rounded-2xl text-xs sm:text-sm font-bold transition-all shadow-md active:scale-95 ${
                    isLight
                      ? 'bg-slate-900 text-white hover:bg-slate-800'
                      : 'bg-white text-black hover:bg-slate-200'
                  }`}
                >
                  {isLoadingMore ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Carregando mais títulos...</span>
                    </>
                  ) : (
                    <span>Carregar mais títulos do catálogo →</span>
                  )}
                </button>
              </div>
            )}
          </>
        ) : (
          <div className="py-20 text-center glass-subtle rounded-3xl max-w-lg mx-auto p-6 border border-white/10">
            <Search className={`w-12 h-12 mx-auto mb-3 opacity-30 ${isLight ? 'text-slate-700' : 'text-white'}`} />
            <p className={`text-base font-bold ${isLight ? 'text-slate-900' : 'text-white'}`}>
              Nenhum título encontrado
            </p>
            <p className={`text-xs mt-1 ${isLight ? 'text-slate-600' : 'text-white/50'}`}>
              Tente pesquisar com outro termo ou redefinir os filtros de gênero e ano.
            </p>
          </div>
        )}
      </div>

    </motion.div>
  );
};
