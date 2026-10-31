/**
 * Popoca Streaming - Mobile Bottom Navigation
 * Barra ergonômica inferior para smartphones com feedback de toque instantâneo (zero vermelho).
 */

import React from 'react';
import { Home, Film, Tv, Compass, User } from 'lucide-react';

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
    { id: 'library', label: 'Explorar', icon: Compass },
    { id: 'profile', label: 'Perfil', icon: User }
  ];

  const isLight = theme === 'light';

  return (
    <nav
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom, 0px), 8px)' }}
      className={`md:hidden fixed bottom-0 left-0 right-0 z-40 glass-dropdown border-t transition-colors ${
        isLight ? 'border-slate-200/80 bg-white/85 shadow-lg' : 'border-white/[0.08] bg-[#0E1016]/95'
      }`}
    >
      <div className="grid grid-cols-5 items-center h-16 max-w-md mx-auto px-1">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = currentCategory === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => onSelectCategory(tab.id)}
              className="flex flex-col items-center justify-center min-h-[48px] py-1 transition-transform active:scale-90"
              aria-label={tab.label}
            >
              <div
                className={`p-1.5 rounded-xl transition-colors ${
                  isActive
                    ? isLight
                      ? 'bg-slate-900 text-white shadow-md'
                      : 'bg-white text-black shadow-md'
                    : isLight
                      ? 'text-slate-400 hover:text-black'
                      : 'text-white/50 hover:text-white'
                }`}
              >
                <Icon className="w-5 h-5" />
              </div>
              <span
                className={`text-[10px] font-medium tracking-tight mt-1 ${
                  isActive
                    ? isLight ? 'text-slate-900 font-bold' : 'text-white font-bold'
                    : isLight ? 'text-slate-400' : 'text-white/40'
                }`}
              >
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>
    </nav>
  );
};
