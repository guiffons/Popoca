/**
 * Popoca Streaming - Letterboxd Service
 * Serviço dedicado de integração e sincronização com o ecossistema Letterboxd:
 * - Filmes vistos (Watched status)
 * - Avaliações com notas de 0.5 a 5.0 estrelas e resenhas (Reviews/Diary)
 * - Filmes curtidos (Heart/Liked) e Watchlist (Lista Para Ver)
 * - Listas personalizadas criadas pelo usuário
 * - Perfil personalizado (@handle, foto/avatar, bio, Top 4 filmes favoritos)
 * - Exportação de dados em formato CSV compatível com import do Letterboxd oficial
 */

import { MediaItem, MovieRating, CustomList, UserProfile } from '../types/index.ts';

const LETTERBOXD_WATCHED_KEY = 'popoca_letterboxd_watched_v2';
const LETTERBOXD_RATINGS_KEY = 'popoca_letterboxd_ratings_v2';
const LETTERBOXD_LIKED_KEY = 'popoca_letterboxd_liked_v2';
const LETTERBOXD_WATCHLIST_KEY = 'popoca_letterboxd_watchlist_v2';
const LETTERBOXD_LISTS_KEY = 'popoca_letterboxd_lists_v2';
const LETTERBOXD_PROFILE_KEY = 'popoca_letterboxd_profile_v2';

// Migração segura a partir das chaves antigas se existirem
function safeGet<T>(key: string, fallbackKey?: string, defaultValue: T = [] as unknown as T): T {
  try {
    const val = localStorage.getItem(key);
    if (val) return JSON.parse(val);
    if (fallbackKey) {
      const oldVal = localStorage.getItem(fallbackKey);
      if (oldVal) {
        const parsed = JSON.parse(oldVal);
        localStorage.setItem(key, oldVal);
        return parsed;
      }
    }
  } catch (e) {
    console.warn(`Erro ao ler ${key}:`, e);
  }
  return defaultValue;
}

function safeSet<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('popoca_storage_changed'));
    }
  } catch (e) {
    console.warn(`Erro ao salvar ${key}:`, e);
  }
}

export const letterboxdService = {
  // ==========================================
  // 1. FILMES VISTOS (WATCHED)
  // ==========================================
  getWatched(): MediaItem[] {
    return safeGet<MediaItem[]>(LETTERBOXD_WATCHED_KEY, 'popoca_watched_movies_v1', []);
  },

  isWatched(mediaId: number): boolean {
    const watched = this.getWatched();
    return watched.some((m) => m.id === mediaId);
  },

  markWatched(media: MediaItem, forceState?: boolean): boolean {
    const list = this.getWatched();
    const index = list.findIndex((m) => m.id === media.id);
    let state = false;

    if (typeof forceState === 'boolean') {
      if (forceState && index === -1) {
        list.unshift(media);
        state = true;
      } else if (!forceState && index >= 0) {
        list.splice(index, 1);
        state = false;
      } else {
        state = forceState;
      }
    } else {
      if (index >= 0) {
        list.splice(index, 1);
        state = false;
      } else {
        list.unshift(media);
        state = true;
      }
    }

    safeSet(LETTERBOXD_WATCHED_KEY, list);
    return state;
  },

  removeWatched(mediaId: number): void {
    const list = this.getWatched().filter((m) => m.id !== mediaId);
    safeSet(LETTERBOXD_WATCHED_KEY, list);
  },

  // ==========================================
  // 2. AVALIAÇÕES & RESENHAS (RATINGS: 0.5 A 5.0)
  // ==========================================
  getRatings(): Record<number, MovieRating> {
    return safeGet<Record<number, MovieRating>>(
      LETTERBOXD_RATINGS_KEY,
      'popoca_letterboxd_ratings_v1',
      {}
    );
  },

  getRating(mediaId: number): MovieRating | null {
    const ratings = this.getRatings();
    return ratings[mediaId] || null;
  },

  rateMovie(media: MediaItem, rating: number, review?: string, isLiked?: boolean): MovieRating {
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
    safeSet(LETTERBOXD_RATINGS_KEY, ratings);

    // Avaliar automaticamente marca como visto
    this.markWatched(media, true);

    if (isLiked) {
      this.toggleLike(media, true);
    }

    return newRating;
  },

  removeRating(mediaId: number): void {
    const ratings = this.getRatings();
    delete ratings[mediaId];
    safeSet(LETTERBOXD_RATINGS_KEY, ratings);
  },

  // ==========================================
  // 3. CURTIDOS (LIKED)
  // ==========================================
  getLiked(): MediaItem[] {
    return safeGet<MediaItem[]>(LETTERBOXD_LIKED_KEY, 'popoca_liked_movies_v1', []);
  },

  isLiked(mediaId: number): boolean {
    const liked = this.getLiked();
    return liked.some((m) => m.id === mediaId);
  },

  toggleLike(media: MediaItem, forceState?: boolean): boolean {
    const list = this.getLiked();
    const index = list.findIndex((m) => m.id === media.id);
    let state = false;

    if (typeof forceState === 'boolean') {
      if (forceState && index === -1) {
        list.unshift(media);
        state = true;
      } else if (!forceState && index >= 0) {
        list.splice(index, 1);
        state = false;
      } else {
        state = forceState;
      }
    } else {
      if (index >= 0) {
        list.splice(index, 1);
        state = false;
      } else {
        list.unshift(media);
        state = true;
      }
    }

    safeSet(LETTERBOXD_LIKED_KEY, list);

    // Sincroniza campo isLiked na avaliação se existir
    const ratings = this.getRatings();
    if (ratings[media.id]) {
      ratings[media.id].isLiked = state;
      safeSet(LETTERBOXD_RATINGS_KEY, ratings);
    }

    return state;
  },

  // ==========================================
  // 4. WATCHLIST (PARA VER)
  // ==========================================
  getWatchlist(): MediaItem[] {
    return safeGet<MediaItem[]>(LETTERBOXD_WATCHLIST_KEY, 'popoca_watchlist_v1', []);
  },

  isInWatchlist(mediaId: number): boolean {
    const watchlist = this.getWatchlist();
    return watchlist.some((m) => m.id === mediaId);
  },

  toggleWatchlist(media: MediaItem, forceState?: boolean): boolean {
    const list = this.getWatchlist();
    const index = list.findIndex((m) => m.id === media.id);
    let state = false;

    if (typeof forceState === 'boolean') {
      if (forceState && index === -1) {
        list.unshift(media);
        state = true;
      } else if (!forceState && index >= 0) {
        list.splice(index, 1);
        state = false;
      } else {
        state = forceState;
      }
    } else {
      if (index >= 0) {
        list.splice(index, 1);
        state = false;
      } else {
        list.unshift(media);
        state = true;
      }
    }

    safeSet(LETTERBOXD_WATCHLIST_KEY, list);
    return state;
  },

  // ==========================================
  // 5. LISTAS PERSONALIZADAS DO USUÁRIO
  // ==========================================
  getCustomLists(): CustomList[] {
    return safeGet<CustomList[]>(LETTERBOXD_LISTS_KEY, 'popoca_custom_lists_v1', []);
  },

  createCustomList(name: string, description: string = ''): CustomList {
    const lists = this.getCustomLists();
    const newList: CustomList = {
      id: `list_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      name: name.trim(),
      description: description.trim(),
      createdAt: Date.now(),
      items: []
    };
    lists.unshift(newList);
    safeSet(LETTERBOXD_LISTS_KEY, lists);
    return newList;
  },

  addToList(listId: string, media: MediaItem): boolean {
    const lists = this.getCustomLists();
    const list = lists.find((l) => l.id === listId);
    if (!list) return false;

    if (!list.items.some((item) => item.id === media.id)) {
      list.items.unshift(media);
      safeSet(LETTERBOXD_LISTS_KEY, lists);
      return true;
    }
    return false;
  },

  removeFromList(listId: string, mediaId: number): boolean {
    const lists = this.getCustomLists();
    const list = lists.find((l) => l.id === listId);
    if (!list) return false;

    const initialLen = list.items.length;
    list.items = list.items.filter((item) => item.id !== mediaId);
    if (list.items.length !== initialLen) {
      safeSet(LETTERBOXD_LISTS_KEY, lists);
      return true;
    }
    return false;
  },

  deleteCustomList(listId: string): void {
    const lists = this.getCustomLists().filter((l) => l.id !== listId);
    safeSet(LETTERBOXD_LISTS_KEY, lists);
  },

  // ==========================================
  // 6. PERFIL CUSTOMIZADO & TOP 4 FAVORITOS
  // ==========================================
  getProfile(): UserProfile {
    const existing = safeGet<UserProfile | null>(LETTERBOXD_PROFILE_KEY, 'popoca_user_profile_v1', null);
    if (existing) {
      return {
        username: existing.username || 'Cinéfilo Popoca',
        handle: existing.handle || '@cinfilo',
        letterboxdUsername: existing.letterboxdUsername || '',
        bannerUrl: existing.bannerUrl || 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1600&auto=format&fit=crop&q=80',
        avatarUrl:
          existing.avatarUrl ||
          'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
        bio: existing.bio || 'Amante de cinema, séries e maratonas em streaming ultra-leve Popoca.',
        joinedAt: existing.joinedAt || Date.now(),
        favoriteIds: existing.favoriteIds || [693134, 85937, 533535, 155]
      };
    }

    return {
      username: 'Cinéfilo Popoca',
      handle: '@cinfilo',
      letterboxdUsername: '',
      bannerUrl: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1600&auto=format&fit=crop&q=80',
      avatarUrl:
        'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=150&auto=format&fit=crop&q=80',
      bio: 'Amante de cinema, séries e maratonas em streaming ultra-leve Popoca.',
      joinedAt: Date.now(),
      favoriteIds: [693134, 85937, 533535, 155]
    };
  },

  updateProfile(data: Partial<UserProfile>): UserProfile {
    const current = this.getProfile();
    const updated: UserProfile = {
      ...current,
      ...data,
      handle: data.handle ? (data.handle.startsWith('@') ? data.handle : `@${data.handle}`) : current.handle
    };
    safeSet(LETTERBOXD_PROFILE_KEY, updated);
    return updated;
  },

  toggleFavoriteFilm(mediaId: number): number[] {
    const profile = this.getProfile();
    let favs = profile.favoriteIds || [];

    if (favs.includes(mediaId)) {
      favs = favs.filter((id) => id !== mediaId);
    } else {
      if (favs.length >= 4) {
        favs = [...favs.slice(1), mediaId]; // Mantém os 4 mais recentes
      } else {
        favs.push(mediaId);
      }
    }

    this.updateProfile({ favoriteIds: favs });
    return favs;
  },

  // ==========================================
  // 7. EXPORTAÇÃO COMPATÍVEL LETTERBOXD (CSV)
  // ==========================================
  exportLetterboxdCSV(): string {
    const ratings = this.getRatings();
    const watched = this.getWatched();

    // Cabeçalho padrão do Letterboxd Import Spec:
    // Title,Year,Rating10,WatchedDate,Review,Rewatch
    const rows = ['Title,Year,Rating10,WatchedDate,Review'];

    const processedIds = new Set<number>();

    // Filmes avaliados
    Object.values(ratings).forEach((r) => {
      processedIds.add(r.mediaId);
      const titleEscaped = `"${r.title.replace(/"/g, '""')}"`;
      const year = '';
      const rating10 = Math.round(r.rating * 2); // Escala 1 a 10 no Letterboxd
      const watchedDate = new Date(r.watchedDate).toISOString().slice(0, 10);
      const reviewEscaped = r.review ? `"${r.review.replace(/"/g, '""')}"` : '';
      rows.push(`${titleEscaped},${year},${rating10},${watchedDate},${reviewEscaped}`);
    });

    // Filmes vistos sem nota formal
    watched.forEach((m) => {
      if (!processedIds.has(m.id)) {
        const titleEscaped = `"${m.title.replace(/"/g, '""')}"`;
        const year = m.release_date ? m.release_date.slice(0, 4) : '';
        const watchedDate = new Date().toISOString().slice(0, 10);
        rows.push(`${titleEscaped},${year},,${watchedDate},`);
      }
    });

    return rows.join('\n');
  },

  // ==========================================
  // 8. ESTATÍSTICAS DO PERFIL
  // ==========================================
  getStats() {
    const watched = this.getWatched();
    const ratings = this.getRatings();
    const ratedArr = Object.values(ratings);
    const lists = this.getCustomLists();

    const totalWatched = watched.length;
    const averageRating =
      ratedArr.length > 0
        ? (ratedArr.reduce((acc, curr) => acc + curr.rating, 0) / ratedArr.length).toFixed(1)
        : '0.0';
    const hoursWatched = Math.round(totalWatched * 2.1);
    const reviewsCount = ratedArr.filter((r) => Boolean(r.review && r.review.trim())).length;

    return {
      totalWatched,
      averageRating,
      hoursWatched,
      reviewsCount,
      listsCount: lists.length
    };
  }
};
