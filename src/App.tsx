/**
 * Popoca Streaming - Aplicação Principal
 * Dashboard cinematográfico em estética Apple TV Liquid Glass (Grafite Minimalista ou Branco Puro),
 * transições fluidas framer-motion, catálogo TMDB dinâmico com episódios, busca avançada e streaming otimizado HTTP 206.
 */

import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Navbar } from './components/Navbar.tsx';
import { BottomNav } from './components/BottomNav.tsx';
import { HeroBanner } from './components/HeroBanner.tsx';
import { MediaRow } from './components/MediaRow.tsx';
import { MovieCard } from './components/MovieCard.tsx';
import { DetailModal } from './components/DetailModal.tsx';
import { VideoPlayer } from './components/VideoPlayer.tsx';
import { ProfileView } from './components/ProfileView.tsx';
import { LibrarySearchView } from './components/LibrarySearchView.tsx';
import { MediaItem, TorrentSource, WatchHistoryItem, Episode } from './types/index.ts';
import { api } from './services/api.ts';
import { storageService } from './services/storage.ts';
import { RefreshCw } from 'lucide-react';

export default function App() {
  const [currentCategory, setCurrentCategory] = useState<string>('trending');
  const [libraryQuery, setLibraryQuery] = useState<string>('');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => storageService.getTheme());
  const [heroItem, setHeroItem] = useState<MediaItem | null>(null);

  // Coleções de Mídia Dinâmicas consumindo TMDB
  const [trendingList, setTrendingList] = useState<MediaItem[]>([]);
  const [latestList, setLatestList] = useState<MediaItem[]>([]);
  const [moviesList, setMoviesList] = useState<MediaItem[]>([]);
  const [tvList, setTvList] = useState<MediaItem[]>([]);
  const [animeList, setAnimeList] = useState<MediaItem[]>([]);
  const [watchHistory, setWatchHistory] = useState<WatchHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Modais e Player
  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [activePlayerState, setActivePlayerState] = useState<{
    media: MediaItem;
    torrent: TorrentSource;
    episode?: Episode;
    initialTime?: number;
    forceTranscode?: boolean;
  } | null>(null);

  // Sincroniza tema com a tag <html>
  useEffect(() => {
    storageService.setTheme(theme);
    if (theme === 'light') {
      document.documentElement.classList.add('light');
    } else {
      document.documentElement.classList.remove('light');
    }
  }, [theme]);

  const toggleTheme = () => {
    setTheme(prev => (prev === 'dark' ? 'light' : 'dark'));
  };

  // Carrega catálogos e histórico
  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        const [trending, latest, movies, tv, anime] = await Promise.all([
          api.getCatalog('trending'),
          api.getCatalog('latest'),
          api.getCatalog('movies'),
          api.getCatalog('tv'),
          api.getCatalog('anime')
        ]);

        setTrendingList(trending);
        setLatestList(latest.length > 0 ? latest : trending.slice(3, 10));
        setMoviesList(movies);
        setTvList(tv);
        setAnimeList(anime);

        if (trending.length > 0) {
          setHeroItem(trending[0]);
        }
      } catch (err) {
        console.error('Erro ao carregar catálogo:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
    refreshWatchHistory();
  }, []);

  const refreshWatchHistory = () => {
    setWatchHistory(storageService.getWatchHistory());
  };

  const progressMap = watchHistory.reduce((acc, curr) => {
    acc[curr.id] = curr.progressPercent;
    return acc;
  }, {} as Record<number, number>);

  const historyMap = watchHistory.reduce((acc, curr) => {
    acc[curr.id] = curr;
    return acc;
  }, {} as Record<number, WatchHistoryItem>);

  // Retoma reprodução a partir do histórico com episódio exato
  const handleResumeWatch = async (media: MediaItem) => {
    const historyItem = watchHistory.find((h) => h.id === media.id);
    if (!historyItem) {
      handlePlayMedia(media);
      return;
    }

    let targetEpisode: Episode | undefined = undefined;
    if (typeof historyItem.episodeNumber === 'number') {
      try {
        const fullMedia = await api.getDetails(media.id, media.media_type);
        const targetSeason = fullMedia.seasons?.find(
          (s) => s.seasonNumber === (historyItem.seasonNumber || 1)
        );
        targetEpisode = targetSeason?.episodes.find(
          (e) => e.episodeNumber === historyItem.episodeNumber
        );
        if (!targetEpisode) {
          targetEpisode = {
            id: media.id * 1000 + (historyItem.episodeNumber || 1),
            episodeNumber: historyItem.episodeNumber || 1,
            seasonNumber: historyItem.seasonNumber || 1,
            title: historyItem.episodeTitle || `Episódio ${historyItem.episodeNumber}`,
            overview: '',
            durationMinutes: 45,
            stillPath: media.backdrop_path,
            streamUrl: media.stream_url || 'https://vjs.zencdn.net/v/oceans.mp4'
          };
        }
      } catch {
        targetEpisode = {
          id: media.id * 1000 + (historyItem.episodeNumber || 1),
          episodeNumber: historyItem.episodeNumber || 1,
          seasonNumber: historyItem.seasonNumber || 1,
          title: historyItem.episodeTitle || `Episódio ${historyItem.episodeNumber}`,
          overview: '',
          durationMinutes: 45,
          stillPath: media.backdrop_path,
          streamUrl: media.stream_url || 'https://vjs.zencdn.net/v/oceans.mp4'
        };
      }
    }

    handlePlayMedia(media, targetEpisode, historyItem.currentTime);
  };

  // Iniciar reprodução direta de um item
  const handlePlayMedia = async (media: MediaItem, episode?: Episode, resumeTime?: number) => {
    // Se for série ou anime e nenhum episódio foi selecionado previamente, abrir modal de episódios
    if (!episode && (media.media_type === 'tv' || media.media_type === 'anime' || (media.seasons && media.seasons.length > 0))) {
      setSelectedMedia(media);
      return;
    }

    try {
      const year = media.release_date ? media.release_date.slice(0, 4) : undefined;
      const sources = await api.getTorrents(media.title, {
        year,
        mediaType: media.media_type,
        season: episode?.seasonNumber,
        episode: episode?.episodeNumber
      });
      const historyMatch = watchHistory.find(h => h.id === media.id);

      const torrent = sources[0] || {
        id: 'stream-direct',
        title: media.title,
        magnetUri: '',
        infoHash: '',
        quality: '1080p',
        seeds: 1450,
        peers: 220,
        sizeBytes: 2400000000,
        sizeFormatted: '2.40 GB',
        isPortugueseAudio: true,
        source: 'Rede Popoca P2P Brasil',
        directUrl: episode?.streamUrl || media.stream_url || 'https://vjs.zencdn.net/v/oceans.mp4'
      };

      setActivePlayerState({
        media,
        torrent,
        episode,
        initialTime: typeof resumeTime === 'number' ? resumeTime : (historyMatch ? historyMatch.currentTime : 0)
      });
    } catch {
      setSelectedMedia(media);
    }
  };

  // Reprodução a partir do Modal de Detalhes
  const handleStartFromDetail = (media: MediaItem, torrent: TorrentSource, forceTranscode?: boolean, episode?: Episode) => {
    const historyMatch = watchHistory.find(h => h.id === media.id);
    setSelectedMedia(null);
    setActivePlayerState({
      media,
      torrent,
      episode,
      initialTime: historyMatch ? historyMatch.currentTime : 0,
      forceTranscode
    });
  };

  // Tocar próximo episódio (se em anime/série)
  const handleNextEpisode = () => {
    if (!activePlayerState?.episode || !activePlayerState.media.seasons) return;
    const media = activePlayerState.media;
    const currentEp = activePlayerState.episode;
    const seasons = media.seasons;
    if (!seasons) return;
    const season = seasons.find(s => s.seasonNumber === currentEp.seasonNumber);
    if (!season) return;

    const nextEp = season.episodes.find(e => e.episodeNumber === currentEp.episodeNumber + 1);
    if (nextEp) {
      handlePlayMedia(media, nextEp);
    }
  };

  const handleClosePlayer = () => {
    setActivePlayerState(null);
    refreshWatchHistory();
  };

  const handleSelectCategory = (cat: string, query?: string) => {
    setCurrentCategory(cat);
    if (query !== undefined) {
      setLibraryQuery(query);
    }
    // Rola suavemente para o topo ao trocar de categoria
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const isLight = theme === 'light';

  return (
    <div className={`min-h-screen flex flex-col font-sans transition-colors duration-300 pb-28 md:pb-8 ${
      isLight ? 'bg-[#F8FAFC] text-slate-900' : 'bg-[#0A0C10] text-white'
    }`}>
      
      {/* Barra de Navegação Topo */}
      <Navbar
        currentCategory={currentCategory}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSelectCategory={handleSelectCategory}
        onSelectMedia={(media) => setSelectedMedia(media)}
      />

      {/* Conteúdo Principal com Transições Suaves framer-motion */}
      <main className="flex-1">
        {isLoading ? (
          <div className="h-[70vh] flex flex-col items-center justify-center text-white/50 gap-3">
            <RefreshCw className={`w-8 h-8 animate-spin ${isLight ? 'text-slate-800' : 'text-white'}`} />
            <span className={`text-sm font-medium ${isLight ? 'text-slate-600' : 'text-white/60'}`}>
              Carregando catálogo cinematográfico Popoca...
            </span>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {/* 1. Página Inicial / Dashboard Dinâmico */}
            {currentCategory === 'trending' && (
              <motion.div
                key="trending"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                {/* Hero Banner Cinematográfico */}
                <HeroBanner
                  media={heroItem}
                  onPlay={(m) => handlePlayMedia(m)}
                  onOpenDetails={(media) => setSelectedMedia(media)}
                />

                <div className="space-y-4 -mt-8 relative z-20">
                  {/* Trilha: Continuar Assistindo (com indicação do último episódio assistido) */}
                  {watchHistory.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4 }}
                    >
                      <MediaRow
                        title="Continuar Assistindo"
                        items={watchHistory.map(h => ({
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
                        }))}
                        progressMap={progressMap}
                        historyMap={historyMap}
                        onSelectMedia={(m) => handleResumeWatch(m)}
                        onQuickPlay={(m) => handleResumeWatch(m)}
                      />
                    </motion.div>
                  )}

                  {/* Trilha: Em Alta Esta Semana */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.45, delay: 0.05 }}
                  >
                    <MediaRow
                      title="Em Alta Esta Semana"
                      items={trendingList}
                      progressMap={progressMap}
                      onSelectMedia={(media) => setSelectedMedia(media)}
                      onQuickPlay={(m) => handlePlayMedia(m)}
                      onPlayEpisode={(m, ep) => handlePlayMedia(m, ep)}
                    />
                  </motion.div>

                  {/* Trilha: Lançamentos Recentes */}
                  {latestList.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.45, delay: 0.1 }}
                    >
                      <MediaRow
                        title="Lançamentos Recentes"
                        items={latestList}
                        progressMap={progressMap}
                        onSelectMedia={(media) => setSelectedMedia(media)}
                        onQuickPlay={(m) => handlePlayMedia(m)}
                        onPlayEpisode={(m, ep) => handlePlayMedia(m, ep)}
                      />
                    </motion.div>
                  )}

                  {/* Trilha: Filmes Populares */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.45, delay: 0.15 }}
                  >
                    <MediaRow
                      title="Filmes Populares"
                      items={moviesList}
                      progressMap={progressMap}
                      onSelectMedia={(media) => setSelectedMedia(media)}
                      onQuickPlay={(m) => handlePlayMedia(m)}
                    />
                  </motion.div>

                  {/* Trilha: Séries Aclamadas */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.45, delay: 0.2 }}
                  >
                    <MediaRow
                      title="Séries Aclamadas"
                      items={tvList}
                      progressMap={progressMap}
                      onSelectMedia={(media) => setSelectedMedia(media)}
                      onQuickPlay={(m) => handlePlayMedia(m)}
                      onPlayEpisode={(m, ep) => handlePlayMedia(m, ep)}
                    />
                  </motion.div>

                  {/* Trilha: Animes em Destaque */}
                  <motion.div
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.45, delay: 0.25 }}
                  >
                    <MediaRow
                      title="Animes em Destaque"
                      items={animeList}
                      progressMap={progressMap}
                      onSelectMedia={(media) => setSelectedMedia(media)}
                      onQuickPlay={(m) => handlePlayMedia(m)}
                      onPlayEpisode={(m, ep) => handlePlayMedia(m, ep)}
                    />
                  </motion.div>
                </div>
              </motion.div>
            )}

            {/* 2. Categorias em Grid (Filmes, Séries ou Animes) */}
            {(currentCategory === 'movies' || currentCategory === 'tv' || currentCategory === 'anime') && (
              <motion.div
                key={currentCategory}
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -16 }}
                transition={{ duration: 0.3 }}
                className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8"
              >
                <div className="mb-6">
                  <h1 className={`text-2xl sm:text-3xl font-black tracking-tight capitalize ${isLight ? 'text-slate-900' : 'text-white'}`}>
                    {currentCategory === 'movies' ? 'Filmes' : (currentCategory === 'tv' ? 'Séries' : 'Animes')}
                  </h1>
                  <p className={`text-xs sm:text-sm mt-1 ${isLight ? 'text-slate-600' : 'text-white/50'}`}>
                    Streaming direto em alta resolução com temporadas e episódios sincronizados.
                  </p>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-6">
                  {(currentCategory === 'movies' ? moviesList : (currentCategory === 'tv' ? tvList : animeList)).map((item, idx) => (
                    <motion.div
                      key={item.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      transition={{ duration: 0.25, delay: Math.min(idx * 0.03, 0.3) }}
                    >
                      <MovieCard
                        media={item}
                        progressPercent={progressMap[item.id]}
                        onSelect={(m) => setSelectedMedia(m)}
                        onQuickPlay={(m) => handlePlayMedia(m)}
                      />
                    </motion.div>
                  ))}
                </div>
              </motion.div>
            )}

            {/* 3. Biblioteca & Busca Global Infinita */}
            {currentCategory === 'library' && (
              <motion.div
                key="library"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <LibrarySearchView
                  initialQuery={libraryQuery}
                  theme={theme}
                  onSelectMedia={(m) => setSelectedMedia(m)}
                  onPlayMedia={(m) => handlePlayMedia(m)}
                />
              </motion.div>
            )}

            {/* 4. Perfil do Usuário & Letterboxd & Listas */}
            {(currentCategory === 'profile' || currentCategory === 'lists') && (
              <motion.div
                key="profile"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.3 }}
              >
                <ProfileView
                  theme={theme}
                  onSelectMedia={(m) => setSelectedMedia(m)}
                  onPlayMedia={(m) => handlePlayMedia(m)}
                />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </main>

      {/* Modal de Detalhes com Episódios e Seleção de Torrent */}
      {selectedMedia && (
        <DetailModal
          media={selectedMedia}
          onClose={() => setSelectedMedia(null)}
          onStartPlayback={handleStartFromDetail}
        />
      )}

      {/* Player de Vídeo Customizado Avançado */}
      {activePlayerState && (
        <VideoPlayer
          media={activePlayerState.media}
          torrent={activePlayerState.torrent}
          episode={activePlayerState.episode}
          initialTime={activePlayerState.initialTime}
          forceTranscode={activePlayerState.forceTranscode}
          onClose={handleClosePlayer}
          onNextEpisode={activePlayerState.episode ? handleNextEpisode : undefined}
        />
      )}

      {/* Rodapé Grafite / Branco Minimalista */}
      <footer className={`mt-16 border-t py-8 text-center text-xs transition-colors ${
        isLight ? 'border-slate-200 text-slate-500' : 'border-white/[0.06] text-white/40'
      }`}>
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className={`font-black tracking-wider ${isLight ? 'text-slate-900' : 'text-white'}`}>POPOCA</span>
            <span>·</span>
            <span>Streaming Web & Diário Letterboxd</span>
          </div>
          <div className="flex items-center gap-4">
            <span>HTTP 206 Partial Content</span>
            <span>·</span>
            <span>Apple TV Liquid Glass</span>
            <span>·</span>
            <span>Temporadas & Episódios</span>
          </div>
        </div>
      </footer>

      {/* Barra de Navegação Inferior (Mobile com safe area) */}
      <BottomNav
        currentCategory={currentCategory}
        theme={theme}
        onSelectCategory={handleSelectCategory}
      />

    </div>
  );
}
