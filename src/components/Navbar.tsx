/**
 * Popoca Streaming - Top Navigation Bar
 * Barra de navegação Liquid Glass estilo Apple TV com busca global em tempo real,
 * sugestões instantâneas via TMDB, alternador de tema (Grafite / Branco) e atalho para Perfil Letterboxd.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Search, Clapperboard, X, Sun, Moon, User, Film, Star, ListPlus, Compass } from 'lucide-react';
import { MediaItem } from '../types/index.ts';
import { api } from '../services/api.ts';
import { storageService } from '../services/storage.ts';

interface NavbarProps {
  currentCategory: string;
  theme: 'dark' | 'light';
  onToggleTheme: () => void;
  onSelectCategory: (category: string, query?: string) => void;
  onSelectMedia: (media: MediaItem) => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentCategory,
  theme,
  onToggleTheme,
  onSelectCategory,
  onSelectMedia
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);
  const searchContainerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const profile = storageService.getProfile();

  // Busca preditiva em tempo real enquanto o usuário digita
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSuggestions([]);
      setIsSearching(false);
      setShowDropdown(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await api.getSuggestions(searchQuery);
        setSuggestions(results);
        setShowDropdown(true);
      } catch (e) {
        console.warn('Erro ao obter sugestões:', e);
      } finally {
        setIsSearching(false);
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  // Fechar dropdown ao clicar fora
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (searchContainerRef.current && !searchContainerRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSelectSuggestion = async (suggestion: any) => {
    setShowDropdown(false);
    setSearchQuery('');
    try {
      const details = await api.getDetails(suggestion.id, suggestion.media_type);
      if (details) {
        onSelectMedia(details);
      } else {
        onSelectMedia(suggestion);
      }
    } catch {
      onSelectMedia(suggestion);
    }
  };

  const handleSubmitSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setShowDropdown(false);
    onSelectCategory('library', searchQuery.trim());
  };

  const isLight = theme === 'light';

  return (
    <header className="sticky top-0 z-40 w-full glass-panel border-b border-white/[0.08] backdrop-blur-3xl transition-colors duration-300">
      <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-2 sm:gap-4 md:gap-8">
        
        {/* Zona 1: Marca Popoca Minimalista (Sem Vermelho) */}
        <button
          onClick={() => onSelectCategory('trending')}
          className="flex items-center gap-1.5 sm:gap-2 text-left group shrink-0 focus-visible:outline-none"
        >
          <div className={`w-8 h-8 sm:w-9 sm:h-9 rounded-xl flex items-center justify-center transition-all duration-300 shadow-md ${
            isLight
              ? 'bg-slate-900 text-white shadow-slate-900/10'
              : 'bg-white/[0.08] text-white border border-white/10 group-hover:bg-white/15'
          }`}>
            <Clapperboard className="w-4 h-4 sm:w-5 sm:h-5" />
          </div>
          <span className={`hidden sm:inline text-base sm:text-xl font-black tracking-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
            POPOCA
          </span>
        </button>

        {/* Zona 2: Links de Navegação Desktop */}
        <nav className={`hidden lg:flex items-center gap-6 text-sm font-medium ${isLight ? 'text-slate-600' : 'text-white/70'}`}>
          <button
            onClick={() => onSelectCategory('trending')}
            className={`whitespace-nowrap transition-colors py-1 ${
              currentCategory === 'trending'
                ? isLight ? 'text-slate-900 font-bold border-b-2 border-slate-900' : 'text-white font-bold border-b-2 border-white'
                : isLight ? 'hover:text-slate-900' : 'hover:text-white'
            }`}
          >
            Início
          </button>
          <button
            onClick={() => onSelectCategory('movies')}
            className={`whitespace-nowrap transition-colors py-1 ${
              currentCategory === 'movies'
                ? isLight ? 'text-slate-900 font-bold border-b-2 border-slate-900' : 'text-white font-bold border-b-2 border-white'
                : isLight ? 'hover:text-slate-900' : 'hover:text-white'
            }`}
          >
            Filmes
          </button>
          <button
            onClick={() => onSelectCategory('tv')}
            className={`whitespace-nowrap transition-colors py-1 ${
              currentCategory === 'tv'
                ? isLight ? 'text-slate-900 font-bold border-b-2 border-slate-900' : 'text-white font-bold border-b-2 border-white'
                : isLight ? 'hover:text-slate-900' : 'hover:text-white'
            }`}
          >
            Séries
          </button>
          <button
            onClick={() => onSelectCategory('anime')}
            className={`whitespace-nowrap transition-colors py-1 ${
              currentCategory === 'anime'
                ? isLight ? 'text-slate-900 font-bold border-b-2 border-slate-900' : 'text-white font-bold border-b-2 border-white'
                : isLight ? 'hover:text-slate-900' : 'hover:text-white'
            }`}
          >
            Animes
          </button>
          <button
            onClick={() => onSelectCategory('library')}
            className={`whitespace-nowrap transition-colors py-1 flex items-center gap-1.5 ${
              currentCategory === 'library'
                ? isLight ? 'text-slate-900 font-bold border-b-2 border-slate-900' : 'text-white font-bold border-b-2 border-white'
                : isLight ? 'hover:text-slate-900' : 'hover:text-white'
            }`}
          >
            <Compass className="w-4 h-4" />
            Explorar Tudo
          </button>
          <button
            onClick={() => onSelectCategory('lists')}
            className={`whitespace-nowrap transition-colors py-1 flex items-center gap-1.5 ${
              currentCategory === 'lists'
                ? isLight ? 'text-slate-900 font-bold border-b-2 border-slate-900' : 'text-white font-bold border-b-2 border-white'
                : isLight ? 'hover:text-slate-900' : 'hover:text-white'
            }`}
          >
            <ListPlus className="w-4 h-4" />
            Minhas Listas
          </button>
          <button
            onClick={() => onSelectCategory('profile')}
            className={`whitespace-nowrap transition-colors py-1 flex items-center gap-1.5 ${
              currentCategory === 'profile'
                ? isLight ? 'text-slate-900 font-bold border-b-2 border-slate-900' : 'text-white font-bold border-b-2 border-white'
                : isLight ? 'hover:text-slate-900' : 'hover:text-white'
            }`}
          >
            <User className="w-4 h-4" />
            Perfil & Letterboxd
          </button>
        </nav>

        {/* Zona 3: Barra de Busca Global e Controles */}
        <div className="flex items-center gap-1.5 sm:gap-2.5 flex-1 min-w-0 justify-end max-w-full sm:max-w-md md:max-w-lg">
          
          {/* Campo de Busca Global em Tempo Real */}
          <div ref={searchContainerRef} className="relative flex-1 min-w-0 max-w-full sm:max-w-[340px]">
            <form onSubmit={handleSubmitSearch} className="relative flex items-center w-full">
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Buscar..."
                value={searchQuery}
                onFocus={() => {
                  if (suggestions.length > 0) setShowDropdown(true);
                }}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`w-full text-xs sm:text-sm pl-8 sm:pl-9 pr-7 sm:pr-8 py-1.5 sm:py-2 rounded-xl transition-all focus:outline-none ${
                  isLight
                    ? 'bg-white/70 text-slate-900 placeholder-slate-400 border border-slate-200/80 focus:bg-white focus:ring-2 focus:ring-slate-900/10 shadow-sm'
                    : 'bg-white/[0.05] text-white placeholder-white/40 border border-white/[0.08] focus:bg-white/[0.09] focus:border-white/20'
                }`}
              />
              <Search className={`w-3.5 h-3.5 sm:w-4 sm:h-4 absolute left-2.5 sm:left-3 pointer-events-none ${isLight ? 'text-slate-400' : 'text-white/40'}`} />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSuggestions([]);
                    setShowDropdown(false);
                  }}
                  className={`absolute right-2 p-0.5 rounded-full ${isLight ? 'text-slate-400 hover:text-slate-600' : 'text-white/40 hover:text-white'}`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </form>

            {/* Dropdown Flutuante de Sugestões em Tempo Real */}
            {showDropdown && (
              <div className={`absolute right-0 top-11 sm:top-12 w-72 sm:w-96 glass-dropdown rounded-2xl shadow-2xl p-2 z-50 border ${
                isLight ? 'border-slate-200' : 'border-white/10'
              }`}>
                {isSearching ? (
                  <div className={`py-4 text-center text-xs ${isLight ? 'text-slate-400' : 'text-white/40'}`}>
                    Pesquisando...
                  </div>
                ) : suggestions.length > 0 ? (
                  <div className="flex flex-col divide-y divide-white/[0.04] max-h-80 overflow-y-auto">
                    {suggestions.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectSuggestion(item)}
                        className={`flex items-center gap-2.5 p-2 rounded-xl text-left transition-colors group ${
                          isLight ? 'hover:bg-slate-100' : 'hover:bg-white/[0.08]'
                        }`}
                      >
                        <div className="w-9 h-12 rounded-lg bg-neutral-900 shrink-0 overflow-hidden border border-white/10">
                          {item.poster_path ? (
                            <img
                              src={item.poster_path}
                              alt={item.title}
                              referrerPolicy="no-referrer"
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center text-white/30">
                              <Film className="w-4 h-4" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className={`text-xs font-semibold truncate ${
                            isLight ? 'text-slate-900 group-hover:text-black' : 'text-white group-hover:text-white/90'
                          }`}>
                            {item.title}
                          </h4>
                          <div className={`flex items-center gap-1.5 text-[10px] sm:text-[11px] mt-0.5 ${isLight ? 'text-slate-500' : 'text-white/50'}`}>
                            {item.year && <span>{item.year}</span>}
                            {item.year && <span aria-hidden="true">·</span>}
                            <span className="capitalize">{item.media_type === 'tv' ? 'Série' : (item.media_type === 'anime' ? 'Anime' : 'Filme')}</span>
                            {item.vote_average > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="flex items-center gap-0.5 text-amber-400 font-mono">
                                  <Star className="w-2.5 h-2.5 fill-current" />
                                  {item.vote_average.toFixed(1)}
                                </span>
                              </>
                            )}
                          </div>
                        </div>
                      </button>
                    ))}

                    <button
                      type="button"
                      onClick={() => {
                        setShowDropdown(false);
                        onSelectCategory('library', searchQuery.trim());
                      }}
                      className="p-2 text-center text-xs font-bold text-white/70 hover:text-white pt-2.5"
                    >
                      Ver todos os resultados na Biblioteca →
                    </button>
                  </div>
                ) : (
                  <div className={`py-4 text-center text-xs ${isLight ? 'text-slate-400' : 'text-white/40'}`}>
                    Nenhum título encontrado para "{searchQuery}"
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Alternador de Tema */}
          <button
            type="button"
            onClick={onToggleTheme}
            className={`p-2 rounded-xl transition-colors glass-subtle shrink-0 ${
              isLight ? 'text-slate-700 hover:text-black hover:bg-slate-200/50' : 'text-white/70 hover:text-white hover:bg-white/10'
            }`}
            title={isLight ? 'Alternar para Modo Grafite Escuro' : 'Alternar para Modo Branco Minimalista'}
            aria-label="Alternar tema de cores"
          >
            {isLight ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>

          {/* Atalho de Perfil */}
          <button
            type="button"
            onClick={() => onSelectCategory('profile')}
            className={`flex items-center gap-2 p-1 rounded-xl transition-all shrink-0 ${
              currentCategory === 'profile'
                ? isLight ? 'ring-2 ring-slate-900' : 'ring-2 ring-white/60'
                : 'hover:opacity-80'
            }`}
            title="Meu Perfil & Letterboxd"
          >
            <div className={`w-7 h-7 sm:w-8 sm:h-8 rounded-lg flex items-center justify-center font-bold text-xs ${
              isLight ? 'bg-slate-200 text-slate-800' : 'bg-white/10 text-white'
            }`}>
              {profile.username ? profile.username[0].toUpperCase() : 'P'}
            </div>
          </button>

        </div>

      </div>
    </header>
  );
};
