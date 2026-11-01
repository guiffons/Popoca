/**
 * Popoca Streaming - Dedicated Letterboxd Social Hub
 * Aba exclusiva para recursos sociais estilo Letterboxd:
 * - Diário & Avaliações (notas de 0.5 a 5.0 estrelas + resenhas/críticas)
 * - Listas Personalizadas (criar listas, buscar e adicionar/remover filmes)
 * - Top 4 Favoritos interativo, Watchlist (Quero Ver), Curtidos e Já Vistos
 * - Exportação CSV oficial compatível com Letterboxd
 */

import React, { useState, useEffect, useMemo } from 'react';
import {
  Star,
  Heart,
  Bookmark,
  CheckCircle2,
  ListPlus,
  Download,
  Trash2,
  Play,
  Plus,
  Search,
  X,
  Edit3,
  Sparkles,
  Film,
  Check
} from 'lucide-react';
import { MediaItem, MovieRating, CustomList, UserProfile } from '../types/index.ts';
import { letterboxdService } from '../services/letterboxd.ts';
import { storageService } from '../services/storage.ts';
import { api } from '../services/api.ts';
import { MovieCard } from './MovieCard.tsx';
import { LazyImage } from './LazyImage.tsx';

interface LetterboxdViewProps {
  theme: 'dark' | 'light';
  catalogItems?: MediaItem[];
  onSelectMedia: (media: MediaItem) => void;
  onPlayMedia: (media: MediaItem) => void;
}

export const LetterboxdView: React.FC<LetterboxdViewProps> = ({
  theme,
  catalogItems = [],
  onSelectMedia,
  onPlayMedia
}) => {
  const [activeSubTab, setActiveSubTab] = useState<'diary' | 'lists' | 'watchlist' | 'watched'>('diary');
  const [profile, setProfile] = useState<UserProfile>(() => letterboxdService.getProfile());
  const [watchedMovies, setWatchedMovies] = useState<MediaItem[]>([]);
  const [ratings, setRatings] = useState<Record<number, MovieRating>>({});
  const [likedMovies, setLikedMovies] = useState<MediaItem[]>([]);
  const [watchlist, setWatchlist] = useState<MediaItem[]>([]);
  const [customLists, setCustomLists] = useState<CustomList[]>([]);

  // Busca rápida para avaliar ou adicionar às listas sem sair da aba
  const [quickQuery, setQuickQuery] = useState('');
  const [quickResults, setQuickResults] = useState<MediaItem[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  // Modal de Avaliação / Resenha (0.5 a 5.0 estrelas)
  const [ratingModalMedia, setRatingModalMedia] = useState<MediaItem | null>(null);
  const [modalScore, setModalScore] = useState<number>(4.5);
  const [modalReview, setModalReview] = useState<string>('');
  const [modalLiked, setModalLiked] = useState<boolean>(false);
  const [modalInTop4, setModalInTop4] = useState<boolean>(false);

  // Modal Nova Lista & Adicionar filme em lista específica
  const [showNewListModal, setShowNewListModal] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListDesc, setNewListDesc] = useState('');
  const [addingToListId, setAddingToListId] = useState<string | null>(null);
  const [listSearchQuery, setListSearchQuery] = useState('');
  const [listSearchResults, setListSearchResults] = useState<MediaItem[]>([]);

  // Seletor de slot do Top 4 Favoritos
  const [pickingTop4Slot, setPickingTop4Slot] = useState<number | null>(null);
  const [top4SearchQuery, setTop4SearchQuery] = useState('');
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const isLight = theme === 'light';

  const triggerToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => {
      setToastMsg((prev) => (prev === msg ? null : prev));
    }, 2600);
  };

  const reloadData = () => {
    setProfile(letterboxdService.getProfile());
    setWatchedMovies(letterboxdService.getWatched());
    setRatings(letterboxdService.getRatings());
    setLikedMovies(letterboxdService.getLiked());
    setWatchlist(letterboxdService.getWatchlist());
    setCustomLists(letterboxdService.getCustomLists());
  };

  useEffect(() => {
    reloadData();
    const onSync = () => reloadData();
    window.addEventListener('popoca_storage_changed', onSync);
    window.addEventListener('popoca_storage_synced', onSync);
    return () => {
      window.removeEventListener('popoca_storage_changed', onSync);
      window.removeEventListener('popoca_storage_synced', onSync);
    };
  }, []);

  // Catálogo unificado sem duplicatas para busca instantânea e sugestões
  const deduplicatedCatalog = useMemo(() => {
    const map = new Map<number, MediaItem>();
    for (const item of [
      ...catalogItems,
      ...watchedMovies,
      ...likedMovies,
      ...watchlist
    ]) {
      if (item && item.id && !map.has(item.id)) {
        map.set(item.id, item);
      }
    }
    return Array.from(map.values());
  }, [catalogItems, watchedMovies, likedMovies, watchlist]);

  // Busca rápida principal
  useEffect(() => {
    const trimmed = quickQuery.trim();
    if (!trimmed) {
      setQuickResults([]);
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      setIsSearching(true);
      try {
        const res = await api.search(trimmed);
        if (res.length > 0) {
          setQuickResults(res.slice(0, 8));
        } else {
          const lower = trimmed.toLowerCase();
          setQuickResults(
            deduplicatedCatalog
              .filter(
                (m) =>
                  m.title.toLowerCase().includes(lower) ||
                  (m.original_title && m.original_title.toLowerCase().includes(lower))
              )
              .slice(0, 8)
          );
        }
      } catch {
        setQuickResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [quickQuery, deduplicatedCatalog]);

  // Busca dentro de uma lista personalizada
  useEffect(() => {
    const trimmed = listSearchQuery.trim();
    if (!addingToListId || !trimmed) {
      setListSearchResults(deduplicatedCatalog.slice(0, 8));
      return;
    }

    const timer = setTimeout(async () => {
      try {
        const res = await api.search(trimmed);
        setListSearchResults(res.length > 0 ? res.slice(0, 8) : []);
      } catch {
        setListSearchResults([]);
      }
    }, 200);

    return () => clearTimeout(timer);
  }, [addingToListId, listSearchQuery, deduplicatedCatalog]);

  const openRatingModal = (media: MediaItem) => {
    const existing = letterboxdService.getRating(media.id);
    const favs = letterboxdService.getProfile().favoriteIds || [];
    setRatingModalMedia(media);
    setModalScore(existing?.rating || 4.5);
    setModalReview(existing?.review || '');
    setModalLiked(letterboxdService.isLiked(media.id));
    setModalInTop4(favs.includes(media.id));
  };

  const handleSaveRatingModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!ratingModalMedia) return;

    letterboxdService.rateMovie(ratingModalMedia, modalScore, modalReview.trim(), modalLiked);
    letterboxdService.toggleLike(ratingModalMedia, modalLiked);

    const currentFavs = letterboxdService.getProfile().favoriteIds || [];
    const alreadyFav = currentFavs.includes(ratingModalMedia.id);
    if (modalInTop4 && !alreadyFav) {
      letterboxdService.toggleFavoriteFilm(ratingModalMedia.id);
    } else if (!modalInTop4 && alreadyFav) {
      letterboxdService.toggleFavoriteFilm(ratingModalMedia.id);
    }

    setRatingModalMedia(null);
    setQuickQuery('');
    reloadData();
    triggerToast(`Avaliação de "${ratingModalMedia.title}" salva no seu Diário!`);
  };

  const handleDeleteRating = (mediaId: number, title: string) => {
    letterboxdService.removeRating(mediaId);
    reloadData();
    triggerToast(`Avaliação de "${title}" removida.`);
  };

  const handleCreateList = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newListName.trim()) return;
    const created = letterboxdService.createCustomList(newListName.trim(), newListDesc.trim());
    setNewListName('');
    setNewListDesc('');
    setShowNewListModal(false);
    setActiveSubTab('lists');
    setAddingToListId(created.id);
    reloadData();
    triggerToast(`Lista "${created.name}" criada!`);
  };

  const handleAddMediaToCustomList = (listId: string, media: MediaItem) => {
    const added = letterboxdService.addToList(listId, media);
    reloadData();
    if (added) {
      triggerToast(`"${media.title}" adicionado à lista!`);
    } else {
      triggerToast(`"${media.title}" já está nesta lista.`);
    }
  };

  const handleRemoveFromCustomList = (listId: string, mediaId: number) => {
    letterboxdService.removeFromList(listId, mediaId);
    reloadData();
  };

  const handleAssignTop4Slot = (slotIdx: number, media: MediaItem) => {
    const currentFavs = [...(profile.favoriteIds || [])];
    // Remove se já estiver em outro slot para não duplicar
    const filtered = currentFavs.filter((id) => id !== media.id);
    while (filtered.length < slotIdx) {
      const filler = deduplicatedCatalog.find((c) => !filtered.includes(c.id));
      if (!filler) break;
      filtered.push(filler.id);
    }
    filtered[slotIdx] = media.id;
    letterboxdService.updateProfile({ favoriteIds: filtered.slice(0, 4) });
    // Garante que o filme fique salvo localmente para ter pôster sempre disponível
    if (!letterboxdService.isWatched(media.id)) {
      letterboxdService.markWatched(media, true);
    }
    setPickingTop4Slot(null);
    setTop4SearchQuery('');
    reloadData();
    triggerToast(`"${media.title}" fixado no Top 4 Favoritos!`);
  };

  const handleExportCSV = () => {
    const csv = letterboxdService.exportLetterboxdCSV();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `popoca_letterboxd_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    triggerToast('Arquivo CSV compatível com Letterboxd exportado!');
  };

  const stats = letterboxdService.getStats();
  const sortedRatings = useMemo(
    () => Object.values(ratings).sort((a, b) => b.watchedDate - a.watchedDate),
    [ratings]
  );

  const allKnownMap = useMemo(() => {
    const m = new Map<number, MediaItem>();
    for (const item of deduplicatedCatalog) {
      m.set(item.id, item);
    }
    for (const h of storageService.getWatchHistory()) {
      if (!m.has(h.id)) {
        m.set(h.id, {
          id: h.id,
          title: h.title,
          original_title: h.title,
          overview: '',
          poster_path: h.poster_path,
          backdrop_path: h.backdrop_path,
          release_date: '',
          vote_average: 0,
          vote_count: 0,
          genre_ids: [],
          media_type: h.mediaType
        });
      }
    }
    return m;
  }, [deduplicatedCatalog]);

  const top4Items = useMemo(() => {
    const ids = profile.favoriteIds || [];
    return [0, 1, 2, 3].map((idx) => {
      const id = ids[idx];
      return id ? allKnownMap.get(id) || null : null;
    });
  }, [profile.favoriteIds, allKnownMap]);

  const top4Candidates = useMemo(() => {
    const q = top4SearchQuery.trim().toLowerCase();
    if (!q) return deduplicatedCatalog.slice(0, 12);
    return deduplicatedCatalog
      .filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          (m.original_title && m.original_title.toLowerCase().includes(q))
      )
      .slice(0, 12);
  }, [top4SearchQuery, deduplicatedCatalog]);

  return (
    <div className="max-w-[1440px] mx-auto px-3.5 sm:px-6 lg:px-8 py-6 sm:py-8 animate-in fade-in duration-300">
      {/* Toast Flutuante */}
      {toastMsg && (
        <div className="fixed top-20 right-4 sm:right-8 z-50 glass-dropdown px-4 py-2.5 rounded-2xl border border-emerald-500/30 shadow-2xl flex items-center gap-2 text-xs font-bold text-slate-900 dark:text-white animate-in slide-in-from-top duration-200">
          <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Hero Social Letterboxd */}
      <div className="p-5 sm:p-8 rounded-3xl glass-panel mb-7 space-y-6">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-5">
          <div>
            <div className="flex items-center gap-2.5 mb-2">
              {/* Emblema 3 círculos inspirado no Letterboxd */}
              <div className="flex items-center -space-x-1">
                <span className="w-3.5 h-3.5 rounded-full bg-[#FF8000] ring-2 ring-black/10 dark:ring-black/40" />
                <span className="w-3.5 h-3.5 rounded-full bg-[#00E054] ring-2 ring-black/10 dark:ring-black/40" />
                <span className="w-3.5 h-3.5 rounded-full bg-[#40BCF4] ring-2 ring-black/10 dark:ring-black/40" />
              </div>
              <span className="text-xs font-extrabold uppercase tracking-widest text-emerald-600 dark:text-emerald-400">
                Comunidade & Diário
              </span>
            </div>

            <h1 className="text-2xl sm:text-4xl font-extrabold tracking-tight text-slate-900 dark:text-white">
              Letterboxd
            </h1>
            <p className="text-xs sm:text-sm text-slate-600 dark:text-white/65 mt-1 max-w-xl">
              Registre os filmes, séries e animes que você assistiu, dê notas de 0.5 a 5 estrelas, escreva críticas e organize suas listas personalizadas.
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              type="button"
              onClick={() => setShowNewListModal(true)}
              className="px-4 py-2.5 rounded-full bg-slate-900 text-white dark:bg-white dark:text-black text-xs font-extrabold flex items-center gap-1.5 shadow-md hover:opacity-90 transition-opacity cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Nova Lista</span>
            </button>

            <button
              type="button"
              onClick={handleExportCSV}
              className="px-4 py-2.5 rounded-full glass-subtle text-slate-800 dark:text-white/90 text-xs font-bold flex items-center gap-1.5 hover:opacity-85 transition-opacity cursor-pointer"
              title="Exportar histórico e avaliações no formato oficial do Letterboxd"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Exportar CSV</span>
            </button>
          </div>
        </div>

        {/* Barra de Busca Instantânea para Avaliar / Adicionar à Lista */}
        <div className="relative">
          <div className="relative flex items-center">
            <Search className="w-4 h-4 absolute left-4 text-slate-400 dark:text-white/45 pointer-events-none" />
            <input
              type="text"
              value={quickQuery}
              onChange={(e) => setQuickQuery(e.target.value)}
              placeholder="Buscar título para dar nota ★, escrever crítica ou salvar em uma lista..."
              className={`w-full pl-11 pr-10 py-3 rounded-2xl text-xs sm:text-sm transition-all focus:outline-none ${
                isLight
                  ? 'bg-white/85 text-slate-900 placeholder-slate-400 border border-slate-200/90 focus:border-slate-900/30 shadow-sm'
                  : 'bg-white/[0.06] text-white placeholder-white/40 border border-white/10 focus:bg-white/[0.1] focus:border-white/25'
              }`}
            />
            {quickQuery && (
              <button
                type="button"
                onClick={() => setQuickQuery('')}
                className="absolute right-3 p-1 rounded-full text-slate-400 hover:text-slate-900 dark:text-white/50 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>

          {quickQuery.trim() && (
            <div className="mt-2 p-2.5 rounded-2xl glass-dropdown border border-slate-200/90 dark:border-white/12 shadow-2xl space-y-1.5 max-h-96 overflow-y-auto">
              {isSearching ? (
                <div className="py-6 text-center text-xs text-slate-500 dark:text-white/50">
                  Buscando títulos...
                </div>
              ) : quickResults.length === 0 ? (
                <div className="py-6 text-center text-xs text-slate-500 dark:text-white/50">
                  Nenhum título encontrado para "{quickQuery}".
                </div>
              ) : (
                quickResults.map((item) => {
                  const existingRating = ratings[item.id];
                  const inWl = watchlist.some((w) => w.id === item.id);
                  return (
                    <div
                      key={item.id}
                      className={`p-2 rounded-xl flex items-center justify-between gap-3 transition-colors ${
                        isLight ? 'hover:bg-slate-100/90' : 'hover:bg-white/[0.06]'
                      }`}
                    >
                      <div
                        onClick={() => onSelectMedia(item)}
                        className="flex items-center gap-3 min-w-0 cursor-pointer flex-1"
                      >
                        <div className="w-10 h-14 rounded-lg overflow-hidden shrink-0 bg-slate-900">
                          <LazyImage
                            src={item.poster_path}
                            alt={item.title}
                            aspectRatio="poster"
                            className="w-full h-full object-cover"
                          />
                        </div>
                        <div className="min-w-0">
                          <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                            {item.title}
                          </h4>
                          <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-white/50">
                            {item.release_date && <span>{item.release_date.slice(0, 4)}</span>}
                            {existingRating && (
                              <span className="text-amber-500 dark:text-amber-400 font-mono font-bold flex items-center gap-0.5">
                                <Star className="w-3 h-3 fill-current" />
                                {existingRating.rating.toFixed(1)}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => openRatingModal(item)}
                          className="px-3 py-1.5 rounded-full bg-amber-500 hover:bg-amber-400 text-black text-xs font-extrabold flex items-center gap-1 cursor-pointer transition-colors"
                        >
                          <Star className="w-3.5 h-3.5 fill-current" />
                          <span>{existingRating ? 'Editar Nota' : 'Avaliar'}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            letterboxdService.toggleWatchlist(item);
                            reloadData();
                            triggerToast(
                              inWl
                                ? `"${item.title}" removido da Watchlist`
                                : `"${item.title}" salvo na Watchlist!`
                            );
                          }}
                          className={`p-2 rounded-full border transition-colors cursor-pointer ${
                            inWl
                              ? 'bg-emerald-500 text-black border-emerald-400'
                              : 'glass-subtle text-slate-700 dark:text-white/75 border-slate-200 dark:border-white/10'
                          }`}
                          title="Salvar na Watchlist (Quero Ver)"
                        >
                          <Bookmark className={`w-3.5 h-3.5 ${inWl ? 'fill-current' : ''}`} />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </div>

        {/* Métricas + Top 4 Favoritos lado a lado */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 pt-2 border-t border-slate-200/80 dark:border-white/[0.08]">
          {/* Estatísticas Rápidas */}
          <div className="lg:col-span-5 grid grid-cols-2 gap-3 self-start">
            <div className="p-3.5 rounded-2xl glass-subtle">
              <div className="text-2xl sm:text-3xl font-extrabold font-mono text-slate-900 dark:text-white">
                {stats.totalWatched}
              </div>
              <div className="text-xs text-slate-500 dark:text-white/50 mt-0.5">Títulos Vistos</div>
            </div>

            <div className="p-3.5 rounded-2xl glass-subtle">
              <div className="text-2xl sm:text-3xl font-extrabold font-mono text-slate-900 dark:text-white">
                {sortedRatings.length}
              </div>
              <div className="text-xs text-slate-500 dark:text-white/50 mt-0.5">Críticas & Notas</div>
            </div>

            <div className="p-3.5 rounded-2xl glass-subtle">
              <div className="text-2xl sm:text-3xl font-extrabold font-mono flex items-center gap-1 text-slate-900 dark:text-white">
                <Star className="w-5 h-5 text-amber-500 dark:text-amber-400 fill-current" />
                <span>{stats.averageRating}</span>
              </div>
              <div className="text-xs text-slate-500 dark:text-white/50 mt-0.5">Média Geral</div>
            </div>

            <div className="p-3.5 rounded-2xl glass-subtle">
              <div className="text-2xl sm:text-3xl font-extrabold font-mono text-slate-900 dark:text-white">
                {customLists.length}
              </div>
              <div className="text-xs text-slate-500 dark:text-white/50 mt-0.5">Listas Criadas</div>
            </div>
          </div>

          {/* Top 4 Favoritos (Estilo Clássico Letterboxd) */}
          <div className="lg:col-span-7">
            <div className="flex items-center justify-between mb-2.5">
              <h3 className="text-xs font-extrabold uppercase tracking-wider text-slate-600 dark:text-white/60 flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                <span>Top 4 Favoritos</span>
              </h3>
              <span className="text-[11px] text-slate-500 dark:text-white/40">
                Clique em alterar para personalizar
              </span>
            </div>

            <div className="grid grid-cols-4 gap-2.5 sm:gap-3.5">
              {top4Items.map((fav, slotIdx) => (
                <div
                  key={slotIdx}
                  className={`group relative aspect-[2/3] rounded-xl sm:rounded-2xl overflow-hidden border transition-all ${
                    isLight
                      ? 'border-slate-200 bg-slate-100/80'
                      : 'border-white/10 bg-white/[0.03]'
                  }`}
                >
                  {fav ? (
                    <>
                      <div
                        onClick={() => onSelectMedia(fav)}
                        className="w-full h-full cursor-pointer"
                      >
                        <LazyImage
                          src={fav.poster_path}
                          alt={fav.title}
                          aspectRatio="poster"
                          className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        />
                      </div>
                      <button
                        type="button"
                        onClick={() => setPickingTop4Slot(slotIdx)}
                        className="absolute bottom-1.5 right-1.5 px-2 py-1 rounded-lg bg-black/75 backdrop-blur-md text-[10px] font-bold text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      >
                        Trocar
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setPickingTop4Slot(slotIdx)}
                      className="w-full h-full flex flex-col items-center justify-center gap-1 text-slate-400 hover:text-slate-800 dark:text-white/30 dark:hover:text-white transition-colors p-2 cursor-pointer"
                    >
                      <Plus className="w-5 h-5" />
                      <span className="text-[10px] font-bold">Favorito #{slotIdx + 1}</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Navegação Interna da Aba Letterboxd */}
      <div className="flex items-center gap-1.5 border-b border-slate-200/80 dark:border-white/[0.08] pb-4 mb-6 overflow-x-auto no-scrollbar">
        {[
          { id: 'diary', label: `Diário & Avaliações (${sortedRatings.length})`, icon: Star },
          { id: 'lists', label: `Minhas Listas (${customLists.length})`, icon: ListPlus },
          { id: 'watchlist', label: `Watchlist · Quero Ver (${watchlist.length})`, icon: Bookmark },
          { id: 'watched', label: `Curtidos & Vistos (${watchedMovies.length})`, icon: Heart }
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeSubTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveSubTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-bold shrink-0 transition-all cursor-pointer ${
                active
                  ? isLight
                    ? 'bg-slate-900 text-white shadow-sm'
                    : 'bg-white text-black shadow-sm'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-900/[0.05]'
                  : 'text-white/65 hover:text-white hover:bg-white/10'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* 1. ABA DIÁRIO & AVALIAÇÕES */}
      {activeSubTab === 'diary' && (
        <div className="space-y-6">
          {sortedRatings.length === 0 ? (
            <div className="p-8 rounded-3xl glass-panel text-center space-y-5">
              <div>
                <Star className="w-10 h-10 mx-auto text-amber-400 mb-2" />
                <h3 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
                  Seu Diário Letterboxd está pronto para começar
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-white/55 max-w-md mx-auto mt-1">
                  Escolha um dos títulos abaixo ou use a barra de busca acima para registrar sua primeira nota e resenha!
                </p>
              </div>

              {deduplicatedCatalog.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-3 text-left pt-2">
                  {deduplicatedCatalog.slice(0, 6).map((item) => (
                    <div
                      key={item.id}
                      className="p-2 rounded-2xl glass-subtle flex flex-col justify-between gap-2"
                    >
                      <div
                        onClick={() => onSelectMedia(item)}
                        className="aspect-[2/3] rounded-xl overflow-hidden cursor-pointer"
                      >
                        <LazyImage
                          src={item.poster_path}
                          alt={item.title}
                          aspectRatio="poster"
                          className="w-full h-full object-cover"
                        />
                      </div>
                      <div>
                        <p className="text-xs font-bold text-slate-900 dark:text-white truncate">
                          {item.title}
                        </p>
                        <button
                          type="button"
                          onClick={() => openRatingModal(item)}
                          className="mt-1.5 w-full py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-black text-[11px] font-extrabold flex items-center justify-center gap-1 cursor-pointer"
                        >
                          <Star className="w-3 h-3 fill-current" />
                          <span>Avaliar</span>
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sortedRatings.map((entry) => {
                const mediaObj: MediaItem = allKnownMap.get(entry.mediaId) || {
                  id: entry.mediaId,
                  title: entry.title,
                  original_title: entry.title,
                  overview: '',
                  poster_path: entry.poster_path,
                  backdrop_path: entry.backdrop_path,
                  release_date: '',
                  vote_average: 0,
                  vote_count: 0,
                  genre_ids: [],
                  media_type: 'movie'
                };

                return (
                  <div
                    key={entry.mediaId}
                    className="p-4 sm:p-5 rounded-3xl glass-panel flex items-start gap-4 transition-all"
                  >
                    <div
                      onClick={() => onSelectMedia(mediaObj)}
                      className="w-20 sm:w-24 aspect-[2/3] rounded-2xl overflow-hidden shrink-0 cursor-pointer shadow-lg"
                    >
                      <LazyImage
                        src={entry.poster_path}
                        alt={entry.title}
                        aspectRatio="poster"
                        className="w-full h-full object-cover hover:scale-105 transition-transform"
                      />
                    </div>

                    <div className="flex-1 min-w-0 flex flex-col justify-between">
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <h4
                            onClick={() => onSelectMedia(mediaObj)}
                            className="text-sm sm:text-base font-extrabold text-slate-900 dark:text-white hover:underline cursor-pointer truncate"
                          >
                            {entry.title}
                          </h4>

                          <div className="flex items-center gap-1 font-mono text-amber-600 dark:text-amber-400 font-extrabold text-xs bg-amber-500/15 px-2.5 py-1 rounded-full border border-amber-500/25 shrink-0">
                            <Star className="w-3.5 h-3.5 fill-current" />
                            <span>{entry.rating.toFixed(1)}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-white/45 mt-1">
                          <span>Assistido em {new Date(entry.watchedDate).toLocaleDateString('pt-BR')}</span>
                          {entry.isLiked && (
                            <span className="inline-flex items-center gap-1 text-rose-500 font-semibold">
                              <Heart className="w-3 h-3 fill-current" /> Curtido
                            </span>
                          )}
                        </div>

                        {entry.review ? (
                          <p className="text-xs sm:text-sm mt-3 leading-relaxed text-slate-700 dark:text-white/85 bg-black/[0.03] dark:bg-white/[0.04] p-3 rounded-2xl italic">
                            “{entry.review}”
                          </p>
                        ) : (
                          <p className="text-xs text-slate-400 dark:text-white/35 mt-3 italic">
                            Sem resenha escrita.
                          </p>
                        )}
                      </div>

                      <div className="flex items-center gap-2 mt-4 pt-2 border-t border-slate-200/60 dark:border-white/[0.06]">
                        <button
                          type="button"
                          onClick={() => openRatingModal(mediaObj)}
                          className="px-3 py-1.5 rounded-full glass-subtle text-xs font-bold text-slate-800 dark:text-white/85 flex items-center gap-1 hover:opacity-85 cursor-pointer"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Editar</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => onPlayMedia(mediaObj)}
                          className="px-3 py-1.5 rounded-full glass-subtle text-xs font-bold text-slate-800 dark:text-white/85 flex items-center gap-1 hover:opacity-85 cursor-pointer"
                        >
                          <Play className="w-3 h-3 fill-current" />
                          <span>Rever</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => handleDeleteRating(entry.mediaId, entry.title)}
                          className="ml-auto p-1.5 text-slate-400 hover:text-rose-500 dark:text-white/35 dark:hover:text-rose-400 transition-colors cursor-pointer"
                          title="Excluir avaliação"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 2. ABA LISTAS PERSONALIZADAS */}
      {activeSubTab === 'lists' && (
        <div className="space-y-5">
          {customLists.length === 0 ? (
            <div className="p-10 rounded-3xl glass-panel text-center space-y-4">
              <ListPlus className="w-10 h-10 mx-auto text-slate-400 dark:text-white/35" />
              <div>
                <h3 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
                  Crie suas listas temáticas estilo Letterboxd
                </h3>
                <p className="text-xs sm:text-sm text-slate-500 dark:text-white/55 max-w-md mx-auto mt-1">
                  Ex: "Melhores Ficções Científicas", "Maratona de Fim de Semana", "Animes Favoritos".
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowNewListModal(true)}
                className="px-5 py-2.5 rounded-full bg-slate-900 text-white dark:bg-white dark:text-black text-xs font-extrabold inline-flex items-center gap-1.5 shadow-md cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Criar Primeira Lista</span>
              </button>
            </div>
          ) : (
            customLists.map((list) => {
              const isAddingHere = addingToListId === list.id;
              return (
                <div key={list.id} className="p-5 sm:p-6 rounded-3xl glass-panel space-y-4">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base sm:text-xl font-extrabold text-slate-900 dark:text-white">
                          {list.name}
                        </h3>
                        <span className="text-[11px] font-mono px-2 py-0.5 rounded-full glass-subtle text-slate-600 dark:text-white/70">
                          {list.items.length} {list.items.length === 1 ? 'título' : 'títulos'}
                        </span>
                      </div>
                      {list.description && (
                        <p className="text-xs sm:text-sm text-slate-500 dark:text-white/55 mt-1">
                          {list.description}
                        </p>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => {
                          setAddingToListId(isAddingHere ? null : list.id);
                          setListSearchQuery('');
                        }}
                        className={`px-3.5 py-1.5 rounded-full text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer ${
                          isAddingHere
                            ? 'bg-emerald-500 text-black'
                            : 'bg-slate-900 text-white dark:bg-white dark:text-black'
                        }`}
                      >
                        {isAddingHere ? <Check className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
                        <span>{isAddingHere ? 'Concluir' : 'Adicionar Títulos'}</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          letterboxdService.deleteCustomList(list.id);
                          reloadData();
                          triggerToast(`Lista "${list.name}" removida.`);
                        }}
                        className="p-2 rounded-full text-slate-400 hover:text-rose-500 dark:text-white/40 dark:hover:text-rose-400 transition-colors cursor-pointer"
                        title="Excluir lista"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {/* Painel inline para buscar e adicionar títulos na lista */}
                  {isAddingHere && (
                    <div className="p-3.5 rounded-2xl glass-subtle border border-emerald-500/25 space-y-3">
                      <div className="relative flex items-center">
                        <Search className="w-3.5 h-3.5 absolute left-3 text-slate-400 dark:text-white/45" />
                        <input
                          type="text"
                          value={listSearchQuery}
                          onChange={(e) => setListSearchQuery(e.target.value)}
                          placeholder={`Buscar filme, série ou anime para adicionar em "${list.name}"...`}
                          className="w-full pl-9 pr-4 py-2 rounded-xl text-xs bg-white/80 dark:bg-black/40 border border-slate-200 dark:border-white/10 text-slate-900 dark:text-white focus:outline-none"
                          autoFocus
                        />
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-2.5">
                        {listSearchResults.map((cand) => {
                          const alreadyIn = list.items.some((i) => i.id === cand.id);
                          return (
                            <button
                              key={cand.id}
                              type="button"
                              onClick={() => handleAddMediaToCustomList(list.id, cand)}
                              className={`p-1.5 rounded-xl text-left border transition-all cursor-pointer ${
                                alreadyIn
                                  ? 'border-emerald-500/50 bg-emerald-500/10'
                                  : 'border-transparent hover:bg-black/5 dark:hover:bg-white/10'
                              }`}
                            >
                              <div className="aspect-[2/3] rounded-lg overflow-hidden mb-1 relative">
                                <LazyImage
                                  src={cand.poster_path}
                                  alt={cand.title}
                                  aspectRatio="poster"
                                  className="w-full h-full object-cover"
                                />
                                {alreadyIn && (
                                  <div className="absolute inset-0 bg-emerald-950/60 flex items-center justify-center">
                                    <Check className="w-5 h-5 text-emerald-400" />
                                  </div>
                                )}
                              </div>
                              <p className="text-[11px] font-bold text-slate-900 dark:text-white truncate">
                                {cand.title}
                              </p>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {list.items.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-white/40 py-2">
                      Nenhum título adicionado ainda. Clique em "Adicionar Títulos" acima.
                    </p>
                  ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3.5">
                      {list.items.map((item) => (
                        <div key={item.id} className="relative group/listcard">
                          <MovieCard
                            media={item}
                            fluid
                            onSelect={onSelectMedia}
                            onQuickPlay={onPlayMedia}
                          />
                          <button
                            type="button"
                            onClick={() => handleRemoveFromCustomList(list.id, item.id)}
                            className="absolute top-2 right-2 z-20 p-1.5 rounded-full bg-black/75 text-white/80 hover:text-rose-400 opacity-0 group-hover/listcard:opacity-100 transition-opacity cursor-pointer"
                            title="Remover da lista"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      )}

      {/* 3. ABA WATCHLIST (QUERO VER) */}
      {activeSubTab === 'watchlist' && (
        <div>
          {watchlist.length === 0 ? (
            <div className="text-center py-16 text-slate-500 dark:text-white/40">
              <Bookmark className="w-10 h-10 mx-auto mb-2.5 opacity-35" />
              <p className="text-sm font-semibold">Sua Watchlist está vazia</p>
              <p className="text-xs mt-1">Salve filmes que deseja assistir usando a busca acima ou nos detalhes do filme.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-5">
              {watchlist.map((media) => (
                <MovieCard
                  key={media.id}
                  media={media}
                  fluid
                  onSelect={onSelectMedia}
                  onQuickPlay={onPlayMedia}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 4. ABA CURTIDOS & JÁ VISTOS */}
      {activeSubTab === 'watched' && (
        <div className="space-y-8">
          <div>
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
              <Heart className="w-4 h-4 text-rose-500 fill-current" />
              <span>Curtidos ({likedMovies.length})</span>
            </h3>
            {likedMovies.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-white/45">Nenhum título marcado com coração ainda.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-5">
                {likedMovies.map((media) => (
                  <MovieCard
                    key={media.id}
                    media={media}
                    fluid
                    onSelect={onSelectMedia}
                    onQuickPlay={onPlayMedia}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="pt-6 border-t border-slate-200/80 dark:border-white/[0.08]">
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white mb-4 flex items-center gap-2">
              <Film className="w-4 h-4 text-emerald-500" />
              <span>Todos os Já Vistos ({watchedMovies.length})</span>
            </h3>
            {watchedMovies.length === 0 ? (
              <p className="text-xs text-slate-500 dark:text-white/45">Nenhum título marcado como visto ainda.</p>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-5">
                {watchedMovies.map((media) => (
                  <MovieCard
                    key={media.id}
                    media={media}
                    fluid
                    onSelect={onSelectMedia}
                    onQuickPlay={onPlayMedia}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* MODAL DE AVALIAÇÃO E CRÍTICA (0.5 A 5.0 ESTRELAS) */}
      {ratingModalMedia && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xl animate-in fade-in duration-200">
          <div className="w-full max-w-lg glass-dropdown rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-white/15 text-slate-900 dark:text-white">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-12 h-18 rounded-xl overflow-hidden shrink-0 shadow-md">
                  <LazyImage
                    src={ratingModalMedia.poster_path}
                    alt={ratingModalMedia.title}
                    aspectRatio="poster"
                    className="w-full h-full object-cover"
                  />
                </div>
                <div className="min-w-0">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-amber-500">
                    Registrar no Diário
                  </span>
                  <h3 className="text-base sm:text-lg font-extrabold truncate">
                    {ratingModalMedia.title}
                  </h3>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setRatingModalMedia(null)}
                className="p-1.5 rounded-full text-slate-500 hover:text-slate-900 dark:text-white/60 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveRatingModal} className="space-y-4">
              {/* Seletor de Nota com suporte a meia-estrela (0.5 a 5.0) */}
              <div className="p-3.5 rounded-2xl glass-subtle space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-600 dark:text-white/70">Sua Nota:</span>
                  <span className="text-sm font-mono font-extrabold text-amber-500 dark:text-amber-400">
                    {modalScore.toFixed(1)} / 5.0 ★
                  </span>
                </div>
                <div className="grid grid-cols-10 gap-1">
                  {[0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5].map((val) => {
                    const active = modalScore >= val;
                    return (
                      <button
                        key={val}
                        type="button"
                        onClick={() => setModalScore(val)}
                        className={`py-1.5 rounded-lg text-[11px] font-mono font-bold transition-all cursor-pointer ${
                          active
                            ? 'bg-amber-500 text-black shadow-sm'
                            : 'bg-black/5 dark:bg-white/10 text-slate-500 dark:text-white/50 hover:opacity-90'
                        }`}
                      >
                        {val}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Opções Rápidas: Curtir ♥ & Top 4 Favoritos */}
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  type="button"
                  onClick={() => setModalLiked(!modalLiked)}
                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-colors cursor-pointer ${
                    modalLiked
                      ? 'bg-rose-500 text-white border-rose-400'
                      : 'glass-subtle text-slate-700 dark:text-white/75 border-slate-200 dark:border-white/10'
                  }`}
                >
                  <Heart className={`w-3.5 h-3.5 ${modalLiked ? 'fill-current' : ''}`} />
                  <span>{modalLiked ? 'Curtido ♥' : 'Curtir'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setModalInTop4(!modalInTop4)}
                  className={`flex-1 py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition-colors cursor-pointer ${
                    modalInTop4
                      ? 'bg-amber-500 text-black border-amber-400'
                      : 'glass-subtle text-slate-700 dark:text-white/75 border-slate-200 dark:border-white/10'
                  }`}
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>{modalInTop4 ? 'No Top 4 Favoritos' : 'Fixar no Top 4'}</span>
                </button>
              </div>

              {/* Crítica / Resenha */}
              <div>
                <label className="block text-xs font-bold text-slate-600 dark:text-white/70 mb-1.5">
                  Crítica ou comentário (opcional)
                </label>
                <textarea
                  rows={3}
                  value={modalReview}
                  onChange={(e) => setModalReview(e.target.value)}
                  placeholder="O que você achou da história, direção, trilha sonora ou atuação?"
                  className="w-full p-3 rounded-2xl text-xs sm:text-sm bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/15 text-slate-900 dark:text-white focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRatingModalMedia(null)}
                  className="px-4 py-2 text-xs font-semibold rounded-full text-slate-600 dark:text-white/60 hover:text-slate-900 dark:hover:text-white cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-extrabold rounded-full bg-slate-900 text-white dark:bg-white dark:text-black shadow-md hover:opacity-90 cursor-pointer"
                >
                  Salvar Avaliação
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL CRIAR NOVA LISTA */}
      {showNewListModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xl animate-in fade-in duration-200">
          <div className="w-full max-w-md glass-dropdown rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-white/15 text-slate-900 dark:text-white">
            <h3 className="text-lg font-extrabold mb-3">Nova Lista Personalizada</h3>
            <form onSubmit={handleCreateList} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-white/70 mb-1">
                  Nome da Lista
                </label>
                <input
                  type="text"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  placeholder="Ex: Melhores Filmes de 2026"
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/20 text-slate-900 dark:text-white focus:outline-none"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-white/70 mb-1">
                  Descrição (opcional)
                </label>
                <textarea
                  rows={2}
                  value={newListDesc}
                  onChange={(e) => setNewListDesc(e.target.value)}
                  placeholder="Uma breve descrição sobre esta lista..."
                  className="w-full p-3 text-sm rounded-xl bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/20 text-slate-900 dark:text-white focus:outline-none"
                />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewListModal(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-full text-slate-600 dark:text-white/60 cursor-pointer"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="px-5 py-2 text-xs font-extrabold rounded-full bg-slate-900 text-white dark:bg-white dark:text-black shadow-md cursor-pointer"
                >
                  Criar Lista
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL ESCOLHER FILME DO TOP 4 FAVORITOS */}
      {pickingTop4Slot !== null && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xl animate-in fade-in duration-200">
          <div className="w-full max-w-xl glass-dropdown rounded-3xl p-6 shadow-2xl border border-slate-200 dark:border-white/15 text-slate-900 dark:text-white space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base sm:text-lg font-extrabold">
                Escolher Favorito #{pickingTop4Slot + 1}
              </h3>
              <button
                type="button"
                onClick={() => {
                  setPickingTop4Slot(null);
                  setTop4SearchQuery('');
                }}
                className="p-1.5 rounded-full text-slate-500 hover:text-slate-900 dark:text-white/60 dark:hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <input
              type="text"
              value={top4SearchQuery}
              onChange={(e) => setTop4SearchQuery(e.target.value)}
              placeholder="Filtrar título pelo nome..."
              className="w-full px-3.5 py-2.5 text-xs sm:text-sm rounded-xl bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/15 text-slate-900 dark:text-white focus:outline-none"
              autoFocus
            />

            <div className="grid grid-cols-3 sm:grid-cols-4 gap-3 max-h-80 overflow-y-auto pr-1">
              {top4Candidates.map((cand) => (
                <button
                  key={cand.id}
                  type="button"
                  onClick={() => handleAssignTop4Slot(pickingTop4Slot, cand)}
                  className="text-left group cursor-pointer"
                >
                  <div className="aspect-[2/3] rounded-xl overflow-hidden mb-1 border border-slate-200 dark:border-white/10">
                    <LazyImage
                      src={cand.poster_path}
                      alt={cand.title}
                      aspectRatio="poster"
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                    />
                  </div>
                  <p className="text-[11px] font-bold truncate">{cand.title}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

