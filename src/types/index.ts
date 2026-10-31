/**
 * Popoca Streaming - Definições de Tipos TypeScript
 * Inclui modelos para Mídia, Séries/Animes com Episódios e Temporadas,
 * Torrents, Histórico, Sistema Letterboxd e Listas do Usuário.
 */

export interface Episode {
  id: number;
  episodeNumber: number;
  seasonNumber: number;
  title: string;
  overview: string;
  durationMinutes: number;
  stillPath: string;
  streamUrl?: string;
}

export interface Season {
  seasonNumber: number;
  name: string;
  episodeCount: number;
  episodes: Episode[];
}

export interface MediaItem {
  id: number;
  title: string;
  original_title: string;
  overview: string;
  poster_path: string;
  backdrop_path: string;
  release_date: string;
  vote_average: number;
  vote_count: number;
  genre_ids: number[];
  media_type: 'movie' | 'tv' | 'anime';
  runtime?: number;
  number_of_seasons?: number;
  genres?: { id: number; name: string }[];
  stream_url?: string;
  seasons?: Season[];
}

export interface TorrentSource {
  id: string;
  title: string;
  magnetUri: string;
  infoHash: string;
  quality: '4K' | '1080p' | '720p';
  format?: 'WEB-DL' | 'Bluray' | 'Outro';
  seeds: number;
  peers: number;
  sizeBytes: number;
  sizeFormatted: string;
  isPortugueseAudio: boolean;
  source: string;
  directUrl?: string;
}

export interface WatchHistoryItem {
  id: number;
  title: string;
  poster_path: string;
  backdrop_path: string;
  currentTime: number;
  duration: number;
  progressPercent: number;
  lastWatched: number;
  mediaType: 'movie' | 'tv' | 'anime';
  magnetUri?: string;
  episodeNumber?: number;
  seasonNumber?: number;
  episodeTitle?: string;
}

export interface MovieRating {
  mediaId: number;
  title: string;
  poster_path: string;
  backdrop_path: string;
  rating: number; // 0.5 a 5.0 estrelas
  review?: string;
  watchedDate: number;
  isLiked?: boolean;
}

export interface CustomList {
  id: string;
  name: string;
  description: string;
  createdAt: number;
  items: MediaItem[];
}

export interface UserProfile {
  username: string;
  handle?: string; // e.g. @cinfilopopoca
  letterboxdUsername?: string;
  avatarUrl: string;
  bio: string;
  joinedAt: number;
  favoriteIds?: number[]; // Top 4 filmes favoritos (padrão Letterboxd)
}

