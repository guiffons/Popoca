/**
 * Popoca Streaming - Apple TV+ Floating Liquid Glass Navigation Bar
 * Cápsula flutuante translúcida responsiva em todas as janelas (mobile, janela compacta e widescreen),
 * com navegação em pílulas estilo Apple TV+, busca instantânea limpa e alternador de tema.
 */

import React, { useState, useRef, useEffect } from 'react';
import { Search, Clapperboard, X, Sun, Moon, Film, Star } from 'lucide-react';
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

const NAV_TABS = [
  { id: 'trending', label: 'Início' },
  { id: 'movies', label: 'Filmes' },
  { id: 'tv', label: 'Séries' },
  { id: 'anime', label: 'Animes' },
  { id: 'letterboxd', label: 'Letterboxd' },
  { id: 'library', label: 'Explorar' }
];

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
  const isLight = theme === 'light';

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
      } catch {
        // Silencioso
      } finally {
        setIsSearching(false);
      }
    }, 180);

    return () => clearTimeout(timer);
  }, [searchQuery]);

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
      onSelectMedia(details || suggestion);
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

  return (
    <header className="sticky top-0 z-40 w-full px-2.5 sm:px-5 lg:px-8 pt-2.5 sm:pt-3 pb-1.5">
      <div className="max-w-[1440px] mx-auto h-13 sm:h-14 px-2.5 sm:px-4 rounded-2xl sm:rounded-full glass-capsule flex items-center justify-between gap-2 sm:gap-3 transition-all duration-300">
        {/* Marca Apple TV Minimalista */}
        <button
          type="button"
          onClick={() => onSelectCategory('trending')}
          className="flex items-center gap-2 text-left group shrink-0 pl-0.5 sm:pl-1 focus-visible:outline-none cursor-pointer"
        >
          <div
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300 ${
              isLight
                ? 'bg-slate-900 text-white shadow-sm'
                : 'bg-white text-black shadow-sm group-hover:scale-105'
            }`}
          >
            <Clapperboard className="w-4 h-4" />
          </div>
          <span
            className={`text-sm sm:text-base font-extrabold tracking-tight ${
              isLight ? 'text-slate-900' : 'text-white'
            }`}
          >
            Popoca
          </span>
        </button>

        {/* Cápsula Central de Navegação Estilo Apple TV+ (visível a partir de 768px) */}
        <nav
          className={`hidden md:flex items-center gap-1 p-1 rounded-full ${
            isLight
              ? 'bg-slate-900/[0.05] border border-slate-900/[0.06]'
              : 'bg-white/[0.05] border border-white/[0.07]'
          }`}
        >
          {NAV_TABS.map((tab) => {
            const isActive = currentCategory === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSelectCategory(tab.id)}
                className={`px-3.5 lg:px-4 py-1.5 rounded-full text-xs lg:text-[13px] font-semibold whitespace-nowrap transition-all duration-200 cursor-pointer ${
                  isActive
                    ? isLight
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-white text-black shadow-sm'
                    : isLight
                    ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-900/[0.05]'
                    : 'text-white/70 hover:text-white hover:bg-white/[0.08]'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>

        {/* Controles à Direita: Busca Compacta, Tema e Perfil */}
        <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 flex-1 md:flex-initial justify-end">
          <div
            ref={searchContainerRef}
            className="relative flex-1 md:flex-initial min-w-0 max-w-[190px] sm:max-w-[230px] lg:w-56"
          >
            <form onSubmit={handleSubmitSearch} className="relative flex items-center w-full">
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Buscar"
                value={searchQuery}
                onFocus={() => {
                  if (suggestions.length > 0) setShowDropdown(true);
                }}
                onChange={(e) => setSearchQuery(e.target.value)}
                className={`w-full text-xs sm:text-[13px] pl-8 pr-7 py-1.5 rounded-full transition-all focus:outline-none ${
                  isLight
                    ? 'bg-slate-900/[0.06] text-slate-900 placeholder-slate-500 border border-slate-900/[0.08] focus:bg-white focus:border-slate-900/25 focus:ring-2 focus:ring-slate-900/10'
                    : 'bg-white/[0.07] text-white placeholder-white/45 border border-white/[0.09] focus:bg-white/[0.12] focus:border-white/25'
                }`}
              />
              <Search
                className={`w-3.5 h-3.5 absolute left-2.5 pointer-events-none ${
                  isLight ? 'text-slate-500' : 'text-white/45'
                }`}
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    setSuggestions([]);
                    setShowDropdown(false);
                  }}
                  className={`absolute right-2 p-0.5 rounded-full ${
                    isLight ? 'text-slate-500 hover:text-slate-900' : 'text-white/45 hover:text-white'
                  }`}
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </form>

            {showDropdown && (
              <div
                className={`absolute right-0 top-11 w-[calc(100vw-24px)] max-w-80 sm:w-88 glass-dropdown rounded-2xl p-2 z-50 border ${
                  isLight ? 'border-slate-200/90' : 'border-white/12'
                }`}
              >
                {isSearching ? (
                  <div className={`py-4 text-center text-xs ${isLight ? 'text-slate-500' : 'text-white/50'}`}>
                    Buscando...
                  </div>
                ) : suggestions.length > 0 ? (
                  <div
                    className={`flex flex-col divide-y max-h-80 overflow-y-auto ${
                      isLight ? 'divide-slate-200/70' : 'divide-white/[0.05]'
                    }`}
                  >
                    {suggestions.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => handleSelectSuggestion(item)}
                        className={`flex items-center gap-2.5 p-2 rounded-xl text-left transition-colors group ${
                          isLight ? 'hover:bg-slate-100' : 'hover:bg-white/[0.08]'
                        }`}
                      >
                        <div className="w-9 h-12 rounded-lg bg-slate-900 shrink-0 overflow-hidden border border-black/10 dark:border-white/10">
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
                          <h4
                            className={`text-xs font-bold truncate ${
                              isLight ? 'text-slate-900' : 'text-white'
                            }`}
                          >
                            {item.title}
                          </h4>
                          <div
                            className={`flex items-center gap-1.5 text-[11px] mt-0.5 ${
                              isLight ? 'text-slate-500' : 'text-white/50'
                            }`}
                          >
                            {item.year && <span>{item.year}</span>}
                            {item.year && <span aria-hidden="true">·</span>}
                            <span>
                              {item.media_type === 'tv' ? 'Série' : item.media_type === 'anime' ? 'Anime' : 'Filme'}
                            </span>
                            {item.vote_average > 0 && (
                              <>
                                <span aria-hidden="true">·</span>
                                <span className="flex items-center gap-0.5 text-amber-500 dark:text-amber-400 font-mono font-semibold">
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
                      className={`p-2 text-center text-xs font-bold pt-2.5 ${
                        isLight ? 'text-slate-800 hover:text-black' : 'text-white/80 hover:text-white'
                      }`}
                    >
                      Ver todos os resultados →
                    </button>
                  </div>
                ) : (
                  <div className={`py-4 text-center text-xs ${isLight ? 'text-slate-500' : 'text-white/45'}`}>
                    Nenhum resultado para "{searchQuery}"
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Alternador de Tema */}
          <button
            type="button"
            onClick={onToggleTheme}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition-all shrink-0 cursor-pointer ${
              isLight
                ? 'bg-slate-900/[0.06] text-slate-800 hover:bg-slate-900/[0.12]'
                : 'bg-white/[0.08] text-white/80 hover:text-white hover:bg-white/[0.15]'
            }`}
            title={isLight ? 'Modo Escuro' : 'Modo Claro'}
            aria-label="Alternar tema"
          >
            {isLight ? <Moon className="w-4 h-4" /> : <Sun className="w-4 h-4" />}
          </button>

          {/* Avatar / Perfil */}
          <button
            type="button"
            onClick={() => onSelectCategory('profile')}
            className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs transition-all shrink-0 overflow-hidden cursor-pointer ${
              currentCategory === 'profile' || currentCategory === 'lists'
                ? isLight
                  ? 'ring-2 ring-slate-900 bg-slate-900 text-white'
                  : 'ring-2 ring-white bg-white text-black'
                : isLight
                ? 'bg-slate-900 text-white hover:opacity-90'
                : 'bg-white/15 text-white hover:bg-white/25'
            }`}
            title="Perfil"
            aria-label="Perfil"
          >
            {profile.avatarUrl ? (
              <img src={profile.avatarUrl} alt={profile.username} className="w-full h-full object-cover" />
            ) : (
              <span>{profile.username ? profile.username[0].toUpperCase() : 'P'}</span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
