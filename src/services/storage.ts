/**
 * Popoca Streaming - Storage Service (Persistência Local & Letterboxd)
 * Gerencia histórico de reprodução, perfil do usuário, avaliações no padrão Letterboxd (1-5 estrelas),
 * filmes assistidos, curtidos, watchlist e listas personalizadas.
 */

import { WatchHistoryItem, MediaItem, MovieRating, CustomList, UserProfile } from '../types/index.ts';

const WATCH_HISTORY_KEY = 'popoca_watch_history_v1';
const RATINGS_KEY = 'popoca_letterboxd_ratings_v1';
const WATCHED_KEY = 'popoca_watched_movies_v1';
const WATCHLIST_KEY = 'popoca_watchlist_v1';
const LIKED_KEY = 'popoca_liked_movies_v1';
const CUSTOM_LISTS_KEY = 'popoca_custom_lists_v1';
const PROFILE_KEY = 'popoca_user_profile_v1';
const THEME_KEY = 'popoca_theme_mode_v1';

export const storageService = {
  // --- TEMA ---
  getTheme(): 'dark' | 'light' {
    return (localStorage.getItem(THEME_KEY) as 'dark' | 'light') || 'dark';
  },

  setTheme(theme: 'dark' | 'light') {
    localStorage.setItem(THEME_KEY, theme);
  },

  // --- HISTÓRICO DE REPRODUÇÃO ("Continuar Assistindo") ---
  getWatchHistory(): WatchHistoryItem[] {
    try {
      const data = localStorage.getItem(WATCH_HISTORY_KEY);
      if (!data) return [];
      const parsed: WatchHistoryItem[] = JSON.parse(data);
      return parsed.map(item => {
        if (!item.poster_path || item.poster_path.startsWith('/assets/')) {
          return {
            ...item,
            poster_path: `https://images.metahub.space/poster/medium/${item.id}/img`
          };
        }
        return item;
      }).sort((a, b) => b.lastWatched - a.lastWatched);
    } catch {
      return [];
    }
  },

  saveWatchProgress(item: {
    id: number;
    title: string;
    poster_path: string;
    backdrop_path: string;
    currentTime: number;
    duration: number;
    mediaType: 'movie' | 'tv' | 'anime';
    magnetUri?: string;
    episodeNumber?: number;
    seasonNumber?: number;
    episodeTitle?: string;
  }) {
    try {
      const history = this.getWatchHistory();
      const duration = item.duration || 1;
      const progressPercent = Math.min(100, Math.round((item.currentTime / duration) * 100));

      const updatedHistory: WatchHistoryItem[] = history.filter(h => h.id !== item.id);

      if (progressPercent < 96) {
        updatedHistory.unshift({
          id: item.id,
          title: item.title,
          poster_path: item.poster_path,
          backdrop_path: item.backdrop_path,
          currentTime: item.currentTime,
          duration: item.duration,
          progressPercent,
          lastWatched: Date.now(),
          mediaType: item.mediaType,
          magnetUri: item.magnetUri,
          episodeNumber: item.episodeNumber,
          seasonNumber: item.seasonNumber,
          episodeTitle: item.episodeTitle
        });
      } else {
        // Se concluiu mais de 96%, marca automaticamente como visto na biblioteca Letterboxd
        this.markAsWatched({
          id: item.id,
          title: item.title,
          original_title: item.title,
          overview: '',
          poster_path: item.poster_path,
          backdrop_path: item.backdrop_path,
          release_date: '',
          vote_average: 0,
          vote_count: 0,
          genre_ids: [],
          media_type: item.mediaType
        });
      }

      localStorage.setItem(WATCH_HISTORY_KEY, JSON.stringify(updatedHistory.slice(0, 25)));
    } catch (e) {
      console.warn('Erro ao salvar progresso:', e);
    }
  },

  removeWatchHistoryItem(id: number) {
    try {
      const history = this.getWatchHistory().filter(h => h.id !== id);
      localStorage.setItem(WATCH_HISTORY_KEY, JSON.stringify(history));
    } catch (e) {
      console.warn('Erro ao remover do histórico:', e);
    }
  },

  // --- PERFIL DO USUÁRIO ---
  getProfile(): UserProfile {
    try {
      const data = localStorage.getItem(PROFILE_KEY);
      if (data) return JSON.parse(data);
    } catch {
      // no-op
    }
    return {
      username: 'Cinéfilo Popoca',
      letterboxdUsername: '',
      avatarUrl: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      bio: 'Amante de cinema, animes e maratonas em streaming ultra-leve.',
      joinedAt: Date.now()
    };
  },

  updateProfile(profile: Partial<UserProfile>): UserProfile {
    const current = this.getProfile();
    const updated = { ...current, ...profile };
    localStorage.setItem(PROFILE_KEY, JSON.stringify(updated));
    return updated;
  },

  // --- AVALIAÇÕES E REVIEWS (Estilo Letterboxd: 0.5 a 5.0 estrelas) ---
  getRatings(): Record<number, MovieRating> {
    try {
      const data = localStorage.getItem(RATINGS_KEY);
      return data ? JSON.parse(data) : {};
    } catch {
      return {};
    }
  },

  saveRating(media: MediaItem, rating: number, review?: string, isLiked?: boolean): MovieRating {
    const ratings = this.getRatings();
    const existing = ratings[media.id];
    const newRating: MovieRating = {
      mediaId: media.id,
      title: media.title,
      poster_path: media.poster_path,
      backdrop_path: media.backdrop_path,
      rating,
      review: review !== undefined ? review : existing?.review,
      watchedDate: existing?.watchedDate || Date.now(),
      isLiked: isLiked !== undefined ? isLiked : (existing?.isLiked || false)
    };
    ratings[media.id] = newRating;
    localStorage.setItem(RATINGS_KEY, JSON.stringify(ratings));

    // Também garante que está na lista de vistos
    this.markAsWatched(media);
    if (isLiked) {
      this.toggleLiked(media, true);
    }

    return newRating;
  },

  getRating(mediaId: number): MovieRating | null {
    const ratings = this.getRatings();
    return ratings[mediaId] || null;
  },

  // --- FILMES JÁ VISTOS ---
  getWatchedMovies(): MediaItem[] {
    try {
      const data = localStorage.getItem(WATCHED_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  markAsWatched(media: MediaItem): boolean {
    try {
      const watched = this.getWatchedMovies();
      if (!watched.some(m => m.id === media.id)) {
        watched.unshift(media);
        localStorage.setItem(WATCHED_KEY, JSON.stringify(watched));
        return true;
      }
      return false;
    } catch {
      return false;
    }
  },

  removeWatched(mediaId: number) {
    try {
      const watched = this.getWatchedMovies().filter(m => m.id !== mediaId);
      localStorage.setItem(WATCHED_KEY, JSON.stringify(watched));
    } catch (e) {
      console.warn('Erro ao remover de vistos:', e);
    }
  },

  isWatched(mediaId: number): boolean {
    return this.getWatchedMovies().some(m => m.id === mediaId);
  },

  // --- CURTIDOS / FAVORITOS (Heart) ---
  getLikedMovies(): MediaItem[] {
    try {
      const data = localStorage.getItem(LIKED_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  toggleLiked(media: MediaItem, forceState?: boolean): boolean {
    try {
      const liked = this.getLikedMovies();
      const index = liked.findIndex(m => m.id === media.id);
      let isLiked = false;

      if (typeof forceState === 'boolean') {
        if (forceState && index === -1) {
          liked.unshift(media);
          isLiked = true;
        } else if (!forceState && index >= 0) {
          liked.splice(index, 1);
          isLiked = false;
        } else {
          isLiked = forceState;
        }
      } else {
        if (index >= 0) {
          liked.splice(index, 1);
          isLiked = false;
        } else {
          liked.unshift(media);
          isLiked = true;
        }
      }

      localStorage.setItem(LIKED_KEY, JSON.stringify(liked));
      return isLiked;
    } catch {
      return false;
    }
  },

  isLiked(mediaId: number): boolean {
    return this.getLikedMovies().some(m => m.id === mediaId);
  },

  // --- WATCHLIST ("Lista Para Ver") ---
  getWatchlist(): MediaItem[] {
    try {
      const data = localStorage.getItem(WATCHLIST_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  },

  toggleWatchlist(media: MediaItem): boolean {
    try {
      const list = this.getWatchlist();
      const index = list.findIndex(m => m.id === media.id);
      let inList = false;
      if (index >= 0) {
        list.splice(index, 1);
        inList = false;
      } else {
        list.unshift(media);
        inList = true;
      }
      localStorage.setItem(WATCHLIST_KEY, JSON.stringify(list));
      return inList;
    } catch {
      return false;
    }
  },

  isInWatchlist(mediaId: number): boolean {
    return this.getWatchlist().some(m => m.id === mediaId);
  },

  // --- LISTAS PERSONALIZADAS ---
  getCustomLists(): CustomList[] {
    try {
      const data = localStorage.getItem(CUSTOM_LISTS_KEY);
      if (data) return JSON.parse(data);
    } catch {
      // no-op
    }

    // Listas padrão para começar
    const defaultLists: CustomList[] = [
      {
        id: 'list-fav-scifi',
        name: 'Obras Primas de Ficção Científica',
        description: 'Meus filmes espaciais e futuristas favoritos de todos os tempos.',
        createdAt: Date.now() - 86400000 * 5,
        items: []
      },
      {
        id: 'list-maratona-fds',
        name: 'Maratona do Fim de Semana',
        description: 'Títulos selecionados para assistir comendo pipoca.',
        createdAt: Date.now() - 86400000 * 2,
        items: []
      }
    ];
    localStorage.setItem(CUSTOM_LISTS_KEY, JSON.stringify(defaultLists));
    return defaultLists;
  },

  createCustomList(name: string, description: string = ''): CustomList {
    const lists = this.getCustomLists();
    const newList: CustomList = {
      id: `list-${Date.now()}`,
      name,
      description,
      createdAt: Date.now(),
      items: []
    };
    lists.unshift(newList);
    localStorage.setItem(CUSTOM_LISTS_KEY, JSON.stringify(lists));
    return newList;
  },

  deleteCustomList(listId: string) {
    const lists = this.getCustomLists().filter(l => l.id !== listId);
    localStorage.setItem(CUSTOM_LISTS_KEY, JSON.stringify(lists));
  },

  addMovieToList(listId: string, media: MediaItem): boolean {
    const lists = this.getCustomLists();
    const target = lists.find(l => l.id === listId);
    if (!target) return false;
    if (!target.items.some(m => m.id === media.id)) {
      target.items.unshift(media);
      localStorage.setItem(CUSTOM_LISTS_KEY, JSON.stringify(lists));
      return true;
    }
    return false;
  },

  removeMovieFromList(listId: string, mediaId: number) {
    const lists = this.getCustomLists();
    const target = lists.find(l => l.id === listId);
    if (target) {
      target.items = target.items.filter(m => m.id !== mediaId);
      localStorage.setItem(CUSTOM_LISTS_KEY, JSON.stringify(lists));
    }
  },

  // --- EXPORTAR E IMPORTAR COMPATÍVEL COM LETTERBOXD (CSV) ---
  exportLetterboxdCSV(): string {
    const ratings = this.getRatings();
    const watched = this.getWatchedMovies();
    const headers = ['Title', 'Year', 'Rating10', 'WatchedDate', 'Review'];
    const rows = watched.map(m => {
      const r = ratings[m.id];
      const year = m.release_date ? m.release_date.slice(0, 4) : '';
      const rating10 = r ? (r.rating * 2).toFixed(0) : '';
      const date = r ? new Date(r.watchedDate).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);
      const review = r?.review ? `"${r.review.replace(/"/g, '""')}"` : '';
      return `"${m.title}",${year},${rating10},${date},${review}`;
    });

    return [headers.join(','), ...rows].join('\n');
  }
};
