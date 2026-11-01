/**
 * Popoca Streaming - Aplicação Principal
 * Experiência cinematográfica Apple TV+ Liquid Glass responsiva em todos os tamanhos de tela,
 * catálogo atualizado 2026 em Português (pt-BR), modo claro de alto contraste e streaming P2P veloz.
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
import { LetterboxdView } from './components/LetterboxdView.tsx';
import { LibrarySearchView } from './components/LibrarySearchView.tsx';
import { MediaItem, TorrentSource, WatchHistoryItem, Episode } from './types/index.ts';
import { api } from './services/api.ts';
import { storageService } from './services/storage.ts';
import { idbService } from './services/db.ts';
import { RefreshCw } from 'lucide-react';

export default function App() {
  const [currentCategory, setCurrentCategory] = useState<string>('trending');
  const [libraryQuery, setLibraryQuery] = useState<string>('');
  const [theme, setTheme] = useState<'dark' | 'light'>(() => storageService.getTheme());
  const [heroItem, setHeroItem] = useState<MediaItem | null>(null);

  const [trendingList, setTrendingList] = useState<MediaItem[]>([]);
  const [latestList, setLatestList] = useState<MediaItem[]>([]);
  const [moviesList, setMoviesList] = useState<MediaItem[]>([]);
  const [animationList, setAnimationList] = useState<MediaItem[]>([]);
  const [tvList, setTvList] = useState<MediaItem[]>([]);
  const [animeList, setAnimeList] = useState<MediaItem[]>([]);
  const [actionList, setActionList] = useState<MediaItem[]>([]);
  const [scifiList, setScifiList] = useState<MediaItem[]>([]);
  const [comedyList, setComedyList] = useState<MediaItem[]>([]);
  const [watchHistory, setWatchHistory] = useState<WatchHistoryItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const [selectedMedia, setSelectedMedia] = useState<MediaItem | null>(null);
  const [isPlayerMini, setIsPlayerMini] = useState(false);
  const [activePlayerState, setActivePlayerState] = useState<{
    media: MediaItem;
    torrent: TorrentSource;
    availableTorrents?: TorrentSource[];
    episode?: Episode;
    initialTime?: number;
    forceTranscode?: boolean;
    initialOpenCastModal?: boolean;
  } | null>(null);

  // Sincroniza classes dark e light na tag <html> para Tailwind v4 + Liquid Glass CSS
  useEffect(() => {
    storageService.setTheme(theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    document.documentElement.classList.toggle('light', theme === 'light');
  }, [theme]);

  const toggleTheme = () => {
    setTheme((prev) => (prev === 'dark' ? 'light' : 'dark'));
  };

  useEffect(() => {
    async function loadData() {
      try {
        const [cTrending, cLatest, cMovies, cAnim, cTv, cAnime, cAction, cSciFi, cComedy] = await Promise.all([
          idbService.getCachedCatalog('trending', 1),
          idbService.getCachedCatalog('latest', 1),
          idbService.getCachedCatalog('movies', 1),
          idbService.getCachedCatalog('animation', 1),
          idbService.getCachedCatalog('tv', 1),
          idbService.getCachedCatalog('anime', 1),
          idbService.getCachedCatalog('action', 1),
          idbService.getCachedCatalog('scifi', 1),
          idbService.getCachedCatalog('comedy', 1)
        ]);

        if (cTrending && cTrending.length > 0) {
          setTrendingList(cTrending);
          setHeroItem(cTrending[0]);
          setIsLoading(false);
        }
        if (cLatest && cLatest.length > 0) setLatestList(cLatest);
        if (cMovies && cMovies.length > 0) setMoviesList(cMovies);
        if (cAnim && cAnim.length > 0) setAnimationList(cAnim);
        if (cTv && cTv.length > 0) setTvList(cTv);
        if (cAnime && cAnime.length > 0) setAnimeList(cAnime);
        if (cAction && cAction.length > 0) setActionList(cAction);
        if (cSciFi && cSciFi.length > 0) setScifiList(cSciFi);
        if (cComedy && cComedy.length > 0) setComedyList(cComedy);
      } catch {
        // Sem cache inicial
      }

      try {
        const [
          trendingRes,
          latestRes,
          moviesRes,
          animRes,
          tvRes,
          animeRes,
          actionRes,
          scifiRes,
          comedyRes
        ] = await Promise.allSettled([
          api.getCatalog('trending'),
          api.getCatalog('latest'),
          api.getCatalog('movies'),
          api.getCatalog('animation'),
          api.getCatalog('tv'),
          api.getCatalog('anime'),
          api.getCatalog('action'),
          api.getCatalog('scifi'),
          api.getCatalog('comedy')
        ]);

        const trending = trendingRes.status === 'fulfilled' && trendingRes.value.length > 0 ? trendingRes.value : [];
        const latest = latestRes.status === 'fulfilled' && latestRes.value.length > 0 ? latestRes.value : [];
        const movies = moviesRes.status === 'fulfilled' && moviesRes.value.length > 0 ? moviesRes.value : [];
        const anim = animRes.status === 'fulfilled' && animRes.value.length > 0 ? animRes.value : [];
        const tv = tvRes.status === 'fulfilled' && tvRes.value.length > 0 ? tvRes.value : [];
        const anime = animeRes.status === 'fulfilled' && animeRes.value.length > 0 ? animeRes.value : [];
        const action = actionRes.status === 'fulfilled' && actionRes.value.length > 0 ? actionRes.value : [];
        const scifi = scifiRes.status === 'fulfilled' && scifiRes.value.length > 0 ? scifiRes.value : [];
        const comedy = comedyRes.status === 'fulfilled' && comedyRes.value.length > 0 ? comedyRes.value : [];

        if (trending.length > 0) {
          setTrendingList(trending);
          setHeroItem(trending[0]);
        }
        if (latest.length > 0) {
          setLatestList(latest);
        } else if (trending.length > 3) {
          setLatestList(trending.slice(3, 12));
        }
        if (movies.length > 0) setMoviesList(movies);
        if (anim.length > 0) setAnimationList(anim);
        if (tv.length > 0) setTvList(tv);
        if (anime.length > 0) setAnimeList(anime);
        if (action.length > 0) setActionList(action);
        if (scifi.length > 0) setScifiList(scifi);
        if (comedy.length > 0) setComedyList(comedy);
      } catch (err) {
        console.error('Erro ao atualizar catálogo da rede:', err);
      } finally {
        setIsLoading(false);
      }
    }

    loadData();
    refreshWatchHistory();

    const handleSynced = () => {
      refreshWatchHistory();
    };
    window.addEventListener('popoca_storage_synced', handleSynced);
    return () => {
      window.removeEventListener('popoca_storage_synced', handleSynced);
    };
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

  const handleResumeWatch = async (media: MediaItem) => {
    const historyItem = watchHistory.find((h) => h.id === media.id);
    if (!historyItem) {
      handlePlayMedia(media);
      return;
    }

    let targetEpisode: Episode | undefined = undefined;
    let hydratedMedia = media;
    if (typeof historyItem.episodeNumber === 'number') {
      try {
        const fullMedia = await api.getDetails(media.id, media.media_type);
        if (fullMedia) hydratedMedia = fullMedia;
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
            streamUrl:
              media.stream_url ||
              `/api/stream/${media.id}?season=${historyItem.seasonNumber || 1}&episode=${historyItem.episodeNumber || 1}`
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
          streamUrl:
            media.stream_url ||
            `/api/stream/${media.id}?season=${historyItem.seasonNumber || 1}&episode=${historyItem.episodeNumber || 1}`
        };
      }
    }

    handlePlayMedia(hydratedMedia, targetEpisode, historyItem.currentTime);
  };

  // Seleciona automaticamente a fonte mais rápida e estável (evitando torrents mortos de 1 seed)
  const handlePlayMedia = async (media: MediaItem, episode?: Episode, resumeTime?: number) => {
    if (
      !episode &&
      (media.media_type === 'tv' ||
        media.media_type === 'anime' ||
        (media.seasons && media.seasons.length > 0))
    ) {
      setSelectedMedia(media);
      return;
    }

    try {
      const year = media.release_date ? media.release_date.slice(0, 4) : undefined;
      const trackerPriority = api.getSavedTrackerPriority();
      const sources = await api.getTorrents(media.title, {
        originalTitle: media.original_title,
        year,
        imdbId: media.imdb_id,
        mediaType: media.media_type,
        season: episode?.seasonNumber,
        episode: episode?.episodeNumber,
        trackerPriority
      });
      const historyMatch = watchHistory.find((h) => h.id === media.id);
      const isSameHistoryEpisode =
        !episode ||
        (historyMatch?.seasonNumber === episode.seasonNumber &&
          historyMatch?.episodeNumber === episode.episodeNumber);

      // Prioriza estritamente Português (PT-BR Dublado/Dual) na qualidade escolhida pelo usuário (Padrão: 1080p)
      const preferredQuality = api.getPreferredQuality();
      const torrent =
        api.pickBestTorrentSource(sources, {
          preferredQuality,
          preferPortuguese: true
        }) || {
          id: 'stream-direct',
          title: media.title,
          magnetUri: '',
          infoHash: '',
          quality: preferredQuality,
          seeds: 1450,
          peers: 220,
          sizeBytes: 2400000000,
          sizeFormatted: '2.40 GB',
          isPortugueseAudio: true,
          source: 'Popoca P2P',
          trackerPriority,
          directUrl: episode?.streamUrl || media.stream_url || `/api/stream/${media.id}`
        };

      const autoResumeTime =
        historyMatch &&
        isSameHistoryEpisode &&
        historyMatch.currentTime >= 15 &&
        historyMatch.progressPercent < 96
          ? historyMatch.currentTime
          : 0;

      setActivePlayerState({
        media,
        torrent,
        availableTorrents: sources,
        episode,
        initialTime: typeof resumeTime === 'number' ? resumeTime : autoResumeTime
      });
    } catch {
      setSelectedMedia(media);
    }
  };

  const handleStartFromDetail = (
    media: MediaItem,
    torrent: TorrentSource,
    forceTranscode?: boolean,
    episode?: Episode,
    availableTorrents?: TorrentSource[],
    explicitResumeTime?: number,
    openCastImmediately?: boolean
  ) => {
    const historyMatch = watchHistory.find((h) => h.id === media.id);
    const isSameHistoryEpisode =
      !episode ||
      (historyMatch?.seasonNumber === episode.seasonNumber &&
        historyMatch?.episodeNumber === episode.episodeNumber);

    const autoResumeTime =
      historyMatch &&
      isSameHistoryEpisode &&
      historyMatch.currentTime >= 15 &&
      historyMatch.progressPercent < 96
        ? historyMatch.currentTime
        : 0;

    setSelectedMedia(null);
    setActivePlayerState({
      media,
      torrent,
      availableTorrents:
        availableTorrents && availableTorrents.length > 0 ? availableTorrents : [torrent],
      episode,
      initialTime: typeof explicitResumeTime === 'number' ? explicitResumeTime : autoResumeTime,
      forceTranscode,
      initialOpenCastModal: openCastImmediately
    });
  };

  const handleNextEpisode = async () => {
    if (!activePlayerState?.episode) return;
    let media = activePlayerState.media;
    const currentEp = activePlayerState.episode;

    if (!media.seasons || media.seasons.length === 0) {
      try {
        const full = await api.getDetails(media.id, media.media_type);
        if (full) media = full;
      } catch {}
    }

    const seasons = media.seasons || [];
    const currentSeasonObj = seasons.find((s) => s.seasonNumber === currentEp.seasonNumber);

    let seasonEpisodes = currentSeasonObj?.episodes || [];
    if (seasonEpisodes.length === 0) {
      seasonEpisodes = await api.getSeason(media.id, currentEp.seasonNumber);
    }

    const nextEpInSeason = seasonEpisodes.find(
      (e) => e.episodeNumber === currentEp.episodeNumber + 1
    );
    if (nextEpInSeason) {
      handlePlayMedia(media, nextEpInSeason, 0);
      return;
    }

    const nextSeasonObj = seasons.find((s) => s.seasonNumber === currentEp.seasonNumber + 1);
    if (nextSeasonObj) {
      const nextSeasonEps =
        nextSeasonObj.episodes && nextSeasonObj.episodes.length > 0
          ? nextSeasonObj.episodes
          : await api.getSeason(media.id, nextSeasonObj.seasonNumber);
      if (nextSeasonEps && nextSeasonEps.length > 0) {
        handlePlayMedia(media, nextSeasonEps[0], 0);
      }
    }
  };

  const handleClosePlayer = () => {
    setActivePlayerState(null);
    setIsPlayerMini(false);
    refreshWatchHistory();
  };

  const handleMinimizePlayer = () => {
    setIsPlayerMini(true);
  };

  const handleExpandPlayer = () => {
    setIsPlayerMini(false);
  };

  const handleSelectCategory = (cat: string, query?: string) => {
    setCurrentCategory(cat);
    if (query !== undefined) {
      setLibraryQuery(query);
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const isLight = theme === 'light';

  return (
    <div
      className={`min-h-screen flex flex-col font-sans transition-colors duration-300 pb-28 md:pb-10 ${
        isLight ? 'bg-[#EEF2F7] text-slate-900' : 'bg-[#07090E] text-white'
      }`}
    >
      <Navbar
        currentCategory={currentCategory}
        theme={theme}
        onToggleTheme={toggleTheme}
        onSelectCategory={handleSelectCategory}
        onSelectMedia={(media) => setSelectedMedia(media)}
      />

      <main className="flex-1">
        {isLoading ? (
          <div className="h-[70vh] flex flex-col items-center justify-center gap-3">
            <RefreshCw className={`w-7 h-7 animate-spin ${isLight ? 'text-slate-900' : 'text-white'}`} />
            <span className={`text-sm font-medium ${isLight ? 'text-slate-600' : 'text-white/60'}`}>
              Carregando...
            </span>
          </div>
        ) : (
          <AnimatePresence mode="wait">
            {currentCategory === 'trending' && (
              <motion.div
                key="trending"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.28 }}
              >
                <HeroBanner
                  media={heroItem}
                  items={trendingList}
                  onPlay={(m) => handlePlayMedia(m)}
                  onOpenDetails={(media) => setSelectedMedia(media)}
                />

                <div className="space-y-2 sm:space-y-4 pt-4 sm:pt-6 relative z-20">
                  {watchHistory.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 14 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.35 }}
                    >
                      <MediaRow
                        title="Continuar Assistindo"
                        items={watchHistory.map((h) => ({
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

                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.04 }}
                  >
                    <MediaRow
                      title="Em Alta"
                      items={trendingList}
                      progressMap={progressMap}
                      onSelectMedia={(media) => setSelectedMedia(media)}
                      onQuickPlay={(m) => handlePlayMedia(m)}
                      onPlayEpisode={(m, ep) => handlePlayMedia(m, ep)}
                    />
                  </motion.div>

                  {latestList.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, delay: 0.08 }}
                    >
                      <MediaRow
                        title="Estreias 2026"
                        items={latestList}
                        progressMap={progressMap}
                        onSelectMedia={(media) => setSelectedMedia(media)}
                        onQuickPlay={(m) => handlePlayMedia(m)}
                        onPlayEpisode={(m, ep) => handlePlayMedia(m, ep)}
                      />
                    </motion.div>
                  )}

                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.12 }}
                  >
                    <MediaRow
                      title="Filmes"
                      items={moviesList}
                      progressMap={progressMap}
                      onSelectMedia={(media) => setSelectedMedia(media)}
                      onQuickPlay={(m) => handlePlayMedia(m)}
                    />
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.16 }}
                  >
                    <MediaRow
                      title="Séries"
                      items={tvList}
                      progressMap={progressMap}
                      onSelectMedia={(media) => setSelectedMedia(media)}
                      onQuickPlay={(m) => handlePlayMedia(m)}
                      onPlayEpisode={(m, ep) => handlePlayMedia(m, ep)}
                    />
                  </motion.div>

                  <motion.div
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.4, delay: 0.2 }}
                  >
                    <MediaRow
                      title="Animes"
                      items={animeList}
                      progressMap={progressMap}
                      onSelectMedia={(media) => setSelectedMedia(media)}
                      onQuickPlay={(m) => handlePlayMedia(m)}
                      onPlayEpisode={(m, ep) => handlePlayMedia(m, ep)}
                    />
                  </motion.div>

                  {animationList.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, delay: 0.22 }}
                    >
                      <MediaRow
                        title="Filmes de Animação"
                        items={animationList}
                        progressMap={progressMap}
                        onSelectMedia={(media) => setSelectedMedia(media)}
                        onQuickPlay={(m) => handlePlayMedia(m)}
                      />
                    </motion.div>
                  )}

                  {actionList.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, delay: 0.24 }}
                    >
                      <MediaRow
                        title="Ação & Aventura"
                        items={actionList}
                        progressMap={progressMap}
                        onSelectMedia={(media) => setSelectedMedia(media)}
                        onQuickPlay={(m) => handlePlayMedia(m)}
                      />
                    </motion.div>
                  )}

                  {scifiList.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, delay: 0.26 }}
                    >
                      <MediaRow
                        title="Ficção Científica"
                        items={scifiList}
                        progressMap={progressMap}
                        onSelectMedia={(media) => setSelectedMedia(media)}
                        onQuickPlay={(m) => handlePlayMedia(m)}
                      />
                    </motion.div>
                  )}

                  {comedyList.length > 0 && (
                    <motion.div
                      initial={{ opacity: 0, y: 16 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.4, delay: 0.28 }}
                    >
                      <MediaRow
                        title="Comédias"
                        items={comedyList}
                        progressMap={progressMap}
                        onSelectMedia={(media) => setSelectedMedia(media)}
                        onQuickPlay={(m) => handlePlayMedia(m)}
                      />
                    </motion.div>
                  )}
                </div>
              </motion.div>
            )}

            {(currentCategory === 'movies' || currentCategory === 'tv' || currentCategory === 'anime') && (
              <motion.div
                key={currentCategory}
                initial={{ opacity: 0, y: 14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -14 }}
                transition={{ duration: 0.25 }}
                className="max-w-[1440px] mx-auto px-3.5 sm:px-6 lg:px-8 py-6 sm:py-8"
              >
                <div className="mb-5 sm:mb-6">
                  <h1
                    className={`text-2xl sm:text-3xl font-extrabold tracking-tight ${
                      isLight ? 'text-slate-900' : 'text-white'
                    }`}
                  >
                    {currentCategory === 'movies' ? 'Filmes' : currentCategory === 'tv' ? 'Séries' : 'Animes'}
                  </h1>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-5">
                  {(currentCategory === 'movies' ? moviesList : currentCategory === 'tv' ? tvList : animeList).map(
                    (item, idx) => (
                      <motion.div
                        key={item.id}
                        initial={{ opacity: 0, scale: 0.96 }}
                        animate={{ opacity: 1, scale: 1 }}
                        transition={{ duration: 0.22, delay: Math.min(idx * 0.025, 0.25) }}
                      >
                        <MovieCard
                          media={item}
                          fluid
                          progressPercent={progressMap[item.id]}
                          onSelect={(m) => setSelectedMedia(m)}
                          onQuickPlay={(m) => handlePlayMedia(m)}
                        />
                      </motion.div>
                    )
                  )}
                </div>
              </motion.div>
            )}

            {currentCategory === 'library' && (
              <motion.div
                key="library"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                <LibrarySearchView
                  initialQuery={libraryQuery}
                  theme={theme}
                  onSelectMedia={(m) => setSelectedMedia(m)}
                  onPlayMedia={(m) => handlePlayMedia(m)}
                />
              </motion.div>
            )}

            {(currentCategory === 'letterboxd' || currentCategory === 'lists') && (
              <motion.div
                key="letterboxd"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                <LetterboxdView
                  theme={theme}
                  catalogItems={[
                    ...trendingList,
                    ...latestList,
                    ...moviesList,
                    ...tvList,
                    ...animeList,
                    ...animationList
                  ]}
                  onSelectMedia={(m) => setSelectedMedia(m)}
                  onPlayMedia={(m) => handlePlayMedia(m)}
                />
              </motion.div>
            )}

            {currentCategory === 'profile' && (
              <motion.div
                key="profile"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25 }}
              >
                <ProfileView
                  theme={theme}
                  onSelectMedia={(m) => setSelectedMedia(m)}
                  onPlayMedia={(m) => handlePlayMedia(m)}
                  onOpenLetterboxd={() => handleSelectCategory('letterboxd')}
                />
              </motion.div>
            )}
          </AnimatePresence>
        )}
      </main>

      {selectedMedia && (
        <DetailModal
          media={selectedMedia}
          onClose={() => setSelectedMedia(null)}
          onStartPlayback={handleStartFromDetail}
        />
      )}

      {activePlayerState && (
        <VideoPlayer
          media={activePlayerState.media}
          torrent={activePlayerState.torrent}
          availableTorrents={activePlayerState.availableTorrents}
          episode={activePlayerState.episode}
          initialTime={activePlayerState.initialTime}
          forceTranscode={activePlayerState.forceTranscode}
          initialOpenCastModal={activePlayerState.initialOpenCastModal}
          isMini={isPlayerMini}
          onClose={handleClosePlayer}
          onMinimize={handleMinimizePlayer}
          onExpand={handleExpandPlayer}
          onNextEpisode={activePlayerState.episode ? handleNextEpisode : undefined}
        />
      )}

      <footer
        className={`mt-14 border-t py-6 text-xs transition-colors ${
          isLight ? 'border-slate-200/80 text-slate-500' : 'border-white/[0.06] text-white/35'
        }`}
      >
        <div className="max-w-[1440px] mx-auto px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-4">
          <span className={`font-extrabold tracking-wider ${isLight ? 'text-slate-900' : 'text-white/80'}`}>
            POPOCA
          </span>
          <span>Filmes · Séries · Animes</span>
        </div>
      </footer>

      <BottomNav
        currentCategory={currentCategory}
        theme={theme}
        onSelectCategory={handleSelectCategory}
      />
    </div>
  );
}
