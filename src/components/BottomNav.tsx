/**
 * Popoca Streaming - Floating Apple Liquid Glass Mobile Dock
 * Barra flutuante em cápsula translúcida para telas compactas e smartphones (< 768px).
 */

import React from 'react';
import { Home, Film, Tv, Sparkles, Compass, Star } from 'lucide-react';

interface BottomNavProps {
  currentCategory: string;
  theme: 'dark' | 'light';
  onSelectCategory: (category: string) => void;
}

export const BottomNav: React.FC<BottomNavProps> = ({
  currentCategory,
  theme,
  onSelectCategory
}) => {
  const tabs = [
    { id: 'trending', label: 'Início', icon: Home },
    { id: 'movies', label: 'Filmes', icon: Film },
    { id: 'tv', label: 'Séries', icon: Tv },
    { id: 'anime', label: 'Animes', icon: Sparkles },
    { id: 'letterboxd', label: 'Social', icon: Star },
    { id: 'library', label: 'Explorar', icon: Compass }
  ];

  const isLight = theme === 'light';

  return (
    <div
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)' }}
      className="md:hidden fixed bottom-2 left-2 right-2 z-40 pointer-events-none flex justify-center"
    >
      <nav className="pointer-events-auto w-full max-w-lg liquid-glass rounded-full p-1.5 shadow-2xl">
        <div className="grid grid-cols-6 items-center">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = currentCategory === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onSelectCategory(tab.id)}
                className={`flex flex-col items-center justify-center py-1.5 px-1 rounded-full transition-all active:scale-95 ${
                  isActive
                    ? isLight
                      ? 'bg-slate-900 text-white shadow-sm'
                      : 'bg-white text-black shadow-sm'
                    : isLight
                    ? 'text-slate-600 hover:text-slate-900'
                    : 'text-white/60 hover:text-white'
                }`}
                aria-label={tab.label}
              >
                <Icon className="w-4 h-4" />
                <span className="text-[10px] font-semibold tracking-tight mt-0.5 leading-none">
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
};
