/**
 * Popoca Streaming - Profile & Letterboxd View Component
 * Gerenciamento de perfil cinematográfico com @handle, foto/avatar customizável,
 * Top 4 Filmes Favoritos (estilo clássico Letterboxd), estatísticas de horas/filmes,
 * histórico de vistos, avaliações de 0.5 a 5.0 estrelas, resenhas, curtidos, watchlist e criação de listas próprias.
 */

import React, { useState, useEffect } from 'react';
import {
  User,
  Star,
  Heart,
  Bookmark,
  CheckCircle2,
  Clock,
  ListPlus,
  Download,
  Trash2,
  Play,
  Film,
  ExternalLink,
  Plus,
  Share2,
  Edit3,
  Camera,
  Check,
  Cloud,
  RefreshCw
} from 'lucide-react';
import { MediaItem, WatchHistoryItem, MovieRating, CustomList, UserProfile } from '../types/index.ts';
import { letterboxdService } from '../services/letterboxd.ts';
import { storageService } from '../services/storage.ts';
import { cloudSync } from '../services/cloudSync.ts';
import { MovieCard } from './MovieCard.tsx';
import { LazyImage } from './LazyImage.tsx';
import { SyncAccountModal } from './SyncAccountModal.tsx';

interface ProfileViewProps {
  theme: 'dark' | 'light';
  onSelectMedia: (media: MediaItem) => void;
  onPlayMedia: (media: MediaItem) => void;
}

const AVATAR_PRESETS = [
  { name: 'Cinéfilo Noir', url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80' },
  { name: 'Diretor Moderno', url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80' },
  { name: 'Crítica de Cinema', url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80' },
  { name: 'Anime Enthusiast', url: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80' },
  { name: 'Minimalista Grafite', url: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=200&auto=format&fit=crop&q=80' }
];

export const ProfileView: React.FC<ProfileViewProps> = ({
  theme,
  onSelectMedia,
  onPlayMedia
}) => {
  const [activeTab, setActiveTab] = useState<'watched' | 'ratings' | 'liked' | 'watchlist' | 'history' | 'lists'>('watched');
  const [profile, setProfile] = useState<UserProfile>(() => letterboxdService.getProfile());
  
  // Modal de Edição de Perfil
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [usernameInput, setUsernameInput] = useState(profile.username);
  const [handleInput, setHandleInput] = useState(profile.handle || '@cinfilo');
  const [bioInput, setBioInput] = useState(profile.bio);
  const [letterboxdInput, setLetterboxdInput] = useState(profile.letterboxdUsername || '');
  const [avatarUrlInput, setAvatarUrlInput] = useState(profile.avatarUrl);

  // Coleções do Usuário
  const [watchHistory, setWatchHistory] = useState<WatchHistoryItem[]>([]);
  const [watchedMovies, setWatchedMovies] = useState<MediaItem[]>([]);
  const [ratings, setRatings] = useState<Record<number, MovieRating>>({});
  const [likedMovies, setLikedMovies] = useState<MediaItem[]>([]);
  const [watchlist, setWatchlist] = useState<MediaItem[]>([]);
  const [customLists, setCustomLists] = useState<CustomList[]>([]);

  // Modal de Criação de Lista
  const [showNewListModal, setShowNewListModal] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListDesc, setNewListDesc] = useState('');

  // Modal de Sincronização em Nuvem & Pareamento de Dispositivos
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [syncAccount, setSyncAccount] = useState(() => cloudSync.getAccount());
  const [isCloudSyncing, setIsCloudSyncing] = useState(false);

  const reloadData = () => {
    setProfile(letterboxdService.getProfile());
    setWatchHistory(storageService.getWatchHistory());
    setWatchedMovies(letterboxdService.getWatched());
    setRatings(letterboxdService.getRatings());
    setLikedMovies(letterboxdService.getLiked());
    setWatchlist(letterboxdService.getWatchlist());
    setCustomLists(letterboxdService.getCustomLists());
  };

  useEffect(() => {
    reloadData();

    // Sincronização em tempo real quando os dados mudam em outros aparelhos ou abas
    const handleStorageSynced = () => {
      reloadData();
    };
    window.addEventListener('popoca_storage_synced', handleStorageSynced);

    const unsubscribe = cloudSync.subscribe((state) => {
      setSyncAccount(state.account);
      setIsCloudSyncing(state.isSyncing);
    });

    return () => {
      window.removeEventListener('popoca_storage_synced', handleStorageSynced);
      unsubscribe();
    };
  }, []);

  const handleSaveProfile = () => {
    const updated = letterboxdService.updateProfile({
      username: usernameInput.trim() || 'Cinéfilo Popoca',
      handle: handleInput.trim() || '@cinfilo',
      bio: bioInput.trim(),
      letterboxdUsername: letterboxdInput.trim(),
      avatarUrl: avatarUrlInput.trim() || profile.avatarUrl
    });
    setProfile(updated);
    setIsEditingProfile(false);
  };

  const handleCreateList = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newListName.trim()) return;
    letterboxdService.createCustomList(newListName.trim(), newListDesc.trim());
    setNewListName('');
    setNewListDesc('');
    setShowNewListModal(false);
    reloadData();
  };

  const handleDeleteList = (listId: string) => {
    letterboxdService.deleteCustomList(listId);
    reloadData();
  };

  const handleExportCSV = () => {
    const csv = letterboxdService.exportLetterboxdCSV();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `popoca_letterboxd_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const isLight = theme === 'light';

  // Métricas do Serviço Letterboxd
  const stats = letterboxdService.getStats();

  // 4 Filmes Favoritos (Top 4)
  const allKnownMovies = [
    ...watchedMovies,
    ...likedMovies,
    ...watchlist,
    ...watchHistory.map(h => ({
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
    }))
  ];

  const top4Favorites = (profile.favoriteIds || [])
    .map((id) => allKnownMovies.find((m) => m.id === id))
    .filter(Boolean) as MediaItem[];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-in fade-in duration-300">
      
      {/* Cabeçalho do Perfil (Estilo Letterboxd / Apple TV) */}
      <div className={`p-6 sm:p-8 rounded-3xl glass-panel border mb-8 transition-colors ${
        isLight ? 'border-slate-200' : 'border-white/[0.08]'
      }`}>
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          
          <div className="flex items-center gap-4 sm:gap-6">
            <div className="relative group/avatar shrink-0">
              <div className={`w-20 h-20 sm:w-24 sm:h-24 rounded-2xl overflow-hidden shadow-xl border ${
                isLight ? 'border-slate-300 bg-slate-200' : 'border-white/20 bg-neutral-900'
              }`}>
                {profile.avatarUrl ? (
                  <img
                    src={profile.avatarUrl}
                    alt={profile.username}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center font-extrabold text-3xl text-white">
                    {profile.username ? profile.username[0].toUpperCase() : 'P'}
                  </div>
                )}
              </div>
              <button
                onClick={() => setIsEditingProfile(true)}
                className="absolute inset-0 bg-black/50 opacity-0 group-hover/avatar:opacity-100 rounded-2xl flex items-center justify-center text-white transition-opacity duration-200"
                title="Alterar foto de perfil"
              >
                <Camera className="w-5 h-5" />
              </button>
            </div>

            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h1 className={`text-2xl sm:text-3xl font-extrabold tracking-tight ${isLight ? 'text-slate-900' : 'text-white'}`}>
                  {profile.username}
                </h1>
                <span className="font-mono text-xs sm:text-sm text-neutral-400 font-semibold">
                  {profile.handle || '@cinfilo'}
                </span>
                {profile.letterboxdUsername && (
                  <a
                    href={`https://letterboxd.com/${profile.letterboxdUsername}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold glass-subtle text-white/80 hover:text-white transition-colors border border-white/10"
                  >
                    <span>Letterboxd</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                )}
              </div>

              <p className={`text-xs sm:text-sm max-w-xl mt-1.5 ${isLight ? 'text-slate-600' : 'text-white/70'}`}>
                {profile.bio}
              </p>

              <button
                onClick={() => {
                  setUsernameInput(profile.username);
                  setHandleInput(profile.handle || '@cinfilo');
                  setBioInput(profile.bio);
                  setLetterboxdInput(profile.letterboxdUsername || '');
                  setAvatarUrlInput(profile.avatarUrl);
                  setIsEditingProfile(true);
                }}
                className={`flex items-center gap-1.5 text-xs font-medium underline mt-2 ${
                  isLight ? 'text-slate-600 hover:text-black' : 'text-white/60 hover:text-white'
                }`}
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Editar Perfil & Foto</span>
              </button>
            </div>
          </div>

          {/* Ações de Conta & Nuvem */}
          <div className="flex items-center gap-2.5 shrink-0 flex-wrap">
            <button
              onClick={() => setShowSyncModal(true)}
              className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl border transition-all ${
                isLight
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                  : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
              }`}
              title="Sincronização em Nuvem & Pareamento de Aparelhos"
            >
              <div className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </div>
              <Cloud className="w-3.5 h-3.5" />
              <span>Nuvem Ativa</span>
            </button>

            <button
              onClick={handleExportCSV}
              className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl glass-subtle transition-all ${
                isLight ? 'hover:bg-slate-200 text-slate-800' : 'hover:bg-white/10 text-white/80 hover:text-white border border-white/10'
              }`}
              title="Baixar arquivo compatível com importação do Letterboxd"
            >
              <Download className="w-4 h-4" />
              <span>Exportar CSV</span>
            </button>
          </div>

        </div>

        {/* Indicadores Numéricos de Métricas */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-8 pt-6 border-t border-white/[0.08]">
          <div className="p-3 rounded-2xl glass-subtle">
            <div className={`text-2xl sm:text-3xl font-extrabold font-mono ${isLight ? 'text-slate-900' : 'text-white'}`}>
              {stats.totalWatched}
            </div>
            <div className={`text-xs mt-0.5 ${isLight ? 'text-slate-500' : 'text-white/50'}`}>
              Filmes Já Vistos
            </div>
          </div>

          <div className="p-3 rounded-2xl glass-subtle">
            <div className={`text-2xl sm:text-3xl font-extrabold font-mono ${isLight ? 'text-slate-900' : 'text-white'}`}>
              {stats.hoursWatched}h
            </div>
            <div className={`text-xs mt-0.5 ${isLight ? 'text-slate-500' : 'text-white/50'}`}>
              Tempo de Streaming
            </div>
          </div>

          <div className="p-3 rounded-2xl glass-subtle">
            <div className={`text-2xl sm:text-3xl font-extrabold font-mono flex items-center gap-1 ${
              isLight ? 'text-slate-900' : 'text-white'
            }`}>
              <Star className="w-5 h-5 text-amber-400 fill-current" />
              <span>{stats.averageRating}</span>
            </div>
            <div className={`text-xs mt-0.5 ${isLight ? 'text-slate-500' : 'text-white/50'}`}>
              Média das Suas Notas
            </div>
          </div>

          <div className="p-3 rounded-2xl glass-subtle">
            <div className={`text-2xl sm:text-3xl font-extrabold font-mono ${isLight ? 'text-slate-900' : 'text-white'}`}>
              {customLists.length}
            </div>
            <div className={`text-xs mt-0.5 ${isLight ? 'text-slate-500' : 'text-white/50'}`}>
              Listas Próprias
            </div>
          </div>
        </div>

        {/* Seção Clássica do Letterboxd: 4 Filmes Favoritos */}
        <div className="mt-8 pt-6 border-t border-white/[0.08]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-white/50">
              4 Filmes Favoritos (Estilo Letterboxd)
            </h3>
            <span className="text-[11px] text-white/40">
              Toque no coração de qualquer título para fixar
            </span>
          </div>

          <div className="grid grid-cols-4 gap-3 sm:gap-4">
            {[0, 1, 2, 3].map((slotIdx) => {
              const fav = top4Favorites[slotIdx] || likedMovies[slotIdx];
              return (
                <div
                  key={slotIdx}
                  onClick={() => fav && onSelectMedia(fav)}
                  className={`relative aspect-[2/3] rounded-xl overflow-hidden border cursor-pointer group/fav transition-transform hover:scale-105 ${
                    isLight ? 'border-slate-200 bg-slate-100' : 'border-white/10 bg-neutral-900'
                  }`}
                >
                  {fav ? (
                    <LazyImage
                      src={fav.poster_path}
                      alt={fav.title}
                      aspectRatio="poster"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex flex-col items-center justify-center text-white/20 p-2 text-center">
                      <Star className="w-5 h-5 mb-1" />
                      <span className="text-[10px]">Espaço #{slotIdx + 1}</span>
                    </div>
                  )}
                  {fav && (
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover/fav:opacity-100 transition-opacity p-2 flex flex-col justify-end text-left">
                      <p className="text-[11px] font-bold text-white line-clamp-2 leading-tight">
                        {fav.title}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {/* Modal de Edição de Perfil Completo */}
      {isEditingProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-lg glass-panel rounded-3xl p-6 sm:p-8 border border-white/10 shadow-2xl relative">
            <h2 className="text-xl font-bold text-white mb-4">Editar Perfil & Personalização</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-white/70 mb-1">Nome de Exibição</label>
                <input
                  type="text"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl bg-white/10 border border-white/15 text-white focus:outline-none focus:border-white/40"
                  placeholder="Seu nome ou apelido de cinéfilo"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-white/70 mb-1">@handle de Usuário</label>
                <input
                  type="text"
                  value={handleInput}
                  onChange={(e) => setHandleInput(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl bg-white/10 border border-white/15 text-white focus:outline-none focus:border-white/40 font-mono"
                  placeholder="@seunome"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-white/70 mb-1">Bio & Gostos de Cinema</label>
                <textarea
                  value={bioInput}
                  onChange={(e) => setBioInput(e.target.value)}
                  rows={2}
                  className="w-full p-3 text-sm rounded-xl bg-white/10 border border-white/15 text-white focus:outline-none focus:border-white/40"
                  placeholder="Quais seus gêneros e diretores favoritos..."
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-white/70 mb-1">Foto de Perfil (Avatar)</label>
                <div className="flex items-center gap-2 mb-2 overflow-x-auto pb-1">
                  {AVATAR_PRESETS.map((preset, pIdx) => (
                    <button
                      key={pIdx}
                      type="button"
                      onClick={() => setAvatarUrlInput(preset.url)}
                      className={`relative w-12 h-12 rounded-xl overflow-hidden border shrink-0 transition-transform ${
                        avatarUrlInput === preset.url ? 'border-white ring-2 ring-white scale-105' : 'border-white/20 opacity-70 hover:opacity-100'
                      }`}
                      title={preset.name}
                    >
                      <img src={preset.url} alt={preset.name} className="w-full h-full object-cover" />
                      {avatarUrlInput === preset.url && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                          <Check className="w-4 h-4 text-white" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
                <input
                  type="url"
                  value={avatarUrlInput}
                  onChange={(e) => setAvatarUrlInput(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-white/10 border border-white/15 text-white focus:outline-none focus:border-white/40"
                  placeholder="Ou cole a URL de uma imagem para sua foto..."
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-white/70 mb-1">Perfil do Letterboxd (Opcional)</label>
                <input
                  type="text"
                  value={letterboxdInput}
                  onChange={(e) => setLetterboxdInput(e.target.value)}
                  className="w-full px-3 py-2 text-sm rounded-xl bg-white/10 border border-white/15 text-white focus:outline-none focus:border-white/40"
                  placeholder="Seu usuário no Letterboxd.com"
                />
              </div>
            </div>

            <div className="flex justify-end gap-3 mt-6">
              <button
                onClick={() => setIsEditingProfile(false)}
                className="px-4 py-2 text-xs font-semibold rounded-xl text-white/60 hover:text-white transition-colors"
              >
                Cancelar
              </button>
              <button
                onClick={handleSaveProfile}
                className="px-5 py-2 text-xs font-bold rounded-xl bg-white text-black hover:bg-slate-200 transition-colors shadow-lg"
              >
                Salvar Alterações
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Navegação de Abas do Perfil (Apple TV Liquid Glass Tabs) */}
      <div className="flex items-center gap-2 border-b border-white/[0.08] pb-4 mb-6 overflow-x-auto no-scrollbar">
        {[
          { id: 'watched', label: `Vistos (${watchedMovies.length})`, icon: CheckCircle2 },
          { id: 'ratings', label: `Avaliações (${Object.keys(ratings).length})`, icon: Star },
          { id: 'liked', label: `Curtidos (${likedMovies.length})`, icon: Heart },
          { id: 'watchlist', label: `Watchlist (${watchlist.length})`, icon: Bookmark },
          { id: 'history', label: `Histórico (${watchHistory.length})`, icon: Clock },
          { id: 'lists', label: `Minhas Listas (${customLists.length})`, icon: ListPlus },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-semibold shrink-0 transition-all ${
                isActive
                  ? isLight
                    ? 'bg-slate-900 text-white shadow-md'
                    : 'bg-white text-black font-bold shadow-lg'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                  : 'text-white/60 hover:text-white hover:bg-white/10'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Conteúdo das Abas */}
      {activeTab === 'watched' && (
        <div>
          {watchedMovies.length === 0 ? (
            <div className="text-center py-16 text-white/40">
              <Film className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">Você ainda não marcou nenhum filme como assistido.</p>
              <p className="text-xs text-white/30 mt-1">
                Ao assistir até o fim ou clicar em 'Marcar Visto', os títulos aparecem aqui.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {watchedMovies.map((media) => (
                <MovieCard
                  key={media.id}
                  media={media}
                  onSelect={onSelectMedia}
                  onQuickPlay={onPlayMedia}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'ratings' && (
        <div>
          {Object.keys(ratings).length === 0 ? (
            <div className="text-center py-16 text-white/40">
              <Star className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">Nenhuma avaliação registrada ainda.</p>
              <p className="text-xs text-white/30 mt-1">
                Abra os detalhes de um filme para dar sua nota de 0.5 a 5 estrelas e escrever sua resenha.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {Object.values(ratings).map((item) => (
                <div
                  key={item.mediaId}
                  className={`p-4 rounded-2xl glass-panel border flex items-start gap-4 transition-all ${
                    isLight ? 'border-slate-200' : 'border-white/[0.08]'
                  }`}
                >
                  <div
                    onClick={() => onSelectMedia({
                      id: item.mediaId,
                      title: item.title,
                      original_title: item.title,
                      overview: '',
                      poster_path: item.poster_path,
                      backdrop_path: item.backdrop_path,
                      release_date: '',
                      vote_average: 0,
                      vote_count: 0,
                      genre_ids: [],
                      media_type: 'movie'
                    })}
                    className="w-16 h-24 rounded-xl overflow-hidden shrink-0 cursor-pointer shadow-md"
                  >
                    <LazyImage
                      src={item.poster_path}
                      alt={item.title}
                      aspectRatio="poster"
                      className="w-full h-full object-cover"
                    />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <h4
                        onClick={() => onSelectMedia({
                          id: item.mediaId,
                          title: item.title,
                          original_title: item.title,
                          overview: '',
                          poster_path: item.poster_path,
                          backdrop_path: item.backdrop_path,
                          release_date: '',
                          vote_average: 0,
                          vote_count: 0,
                          genre_ids: [],
                          media_type: 'movie'
                        })}
                        className="text-sm sm:text-base font-bold text-white hover:underline cursor-pointer truncate"
                      >
                        {item.title}
                      </h4>

                      <div className="flex items-center gap-1 font-mono text-amber-400 font-bold text-xs bg-amber-400/10 px-2 py-0.5 rounded-md border border-amber-400/20">
                        <Star className="w-3.5 h-3.5 fill-current" />
                        <span>{item.rating.toFixed(1)} / 5.0</span>
                      </div>
                    </div>

                    {item.review ? (
                      <p className={`text-xs mt-2 italic leading-relaxed ${isLight ? 'text-slate-700' : 'text-white/80'}`}>
                        "{item.review}"
                      </p>
                    ) : (
                      <p className="text-[11px] text-white/40 mt-1 italic">
                        Sem texto de resenha.
                      </p>
                    )}

                    <div className="flex items-center gap-3 text-[10px] text-white/40 mt-3">
                      <span>Avaliado em {new Date(item.watchedDate).toLocaleDateString('pt-BR')}</span>
                      {item.isLiked && (
                        <span className="flex items-center gap-1 text-neutral-300">
                          <Heart className="w-3 h-3 fill-current" /> Curtido
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'liked' && (
        <div>
          {likedMovies.length === 0 ? (
            <div className="text-center py-16 text-white/40">
              <Heart className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">Você ainda não curtiu nenhum filme.</p>
              <p className="text-xs text-white/30 mt-1">
                Clique no ícone de coração nos cards para favoritar títulos.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {likedMovies.map((media) => (
                <MovieCard
                  key={media.id}
                  media={media}
                  onSelect={onSelectMedia}
                  onQuickPlay={onPlayMedia}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'watchlist' && (
        <div>
          {watchlist.length === 0 ? (
            <div className="text-center py-16 text-white/40">
              <Bookmark className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">Sua Watchlist está vazia.</p>
              <p className="text-xs text-white/30 mt-1">
                Adicione filmes que deseja assistir mais tarde clicando em 'Watchlist'.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
              {watchlist.map((media) => (
                <MovieCard
                  key={media.id}
                  media={media}
                  onSelect={onSelectMedia}
                  onQuickPlay={onPlayMedia}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'history' && (
        <div>
          {watchHistory.length === 0 ? (
            <div className="text-center py-16 text-white/40">
              <Clock className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">Nenhum histórico recente de streaming.</p>
            </div>
          ) : (
            <div className="space-y-3">
              {watchHistory.map((item) => (
                <div
                  key={item.id}
                  className={`p-3.5 rounded-2xl glass-panel border flex items-center justify-between gap-4 transition-all ${
                    isLight ? 'border-slate-200' : 'border-white/[0.08]'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-16 rounded-lg overflow-hidden shrink-0 shadow-md">
                      <LazyImage
                        src={item.poster_path}
                        alt={item.title}
                        aspectRatio="poster"
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <div className="min-w-0">
                      <h4 className="text-xs sm:text-sm font-bold text-white truncate">
                        {item.title}
                      </h4>
                      {item.episodeNumber && (
                        <span className="text-[11px] font-mono font-bold text-white/90">
                          T{item.seasonNumber || 1}:E{item.episodeNumber} {item.episodeTitle ? `· ${item.episodeTitle}` : ''}
                        </span>
                      )}
                      <div className="flex items-center gap-2 text-[10px] text-white/50 mt-1">
                        <span>Progresso: {item.progressPercent}%</span>
                        <span aria-hidden="true">·</span>
                        <span>{new Date(item.lastWatched).toLocaleDateString('pt-BR')}</span>
                      </div>
                    </div>
                  </div>

                  <button
                    onClick={() => onPlayMedia({
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
                    })}
                    className="p-2 sm:px-3 sm:py-1.5 rounded-xl bg-white text-black text-xs font-bold flex items-center gap-1.5 hover:bg-slate-200 transition-colors shadow-md"
                  >
                    <Play className="w-3.5 h-3.5 fill-current" />
                    <span className="hidden sm:inline">Continuar</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'lists' && (
        <div>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-base font-bold text-white">Suas Listas Temáticas</h3>
            <button
              onClick={() => setShowNewListModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-black text-xs font-bold hover:bg-slate-200 transition-colors shadow-md"
            >
              <Plus className="w-4 h-4" />
              <span>Criar Nova Lista</span>
            </button>
          </div>

          {customLists.length === 0 ? (
            <div className="text-center py-16 text-white/40">
              <ListPlus className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="text-sm font-medium">Você ainda não criou nenhuma lista própria.</p>
              <p className="text-xs text-white/30 mt-1">
                Crie coleções como "Maratona Sci-Fi", "Melhores de 2024" ou "Animes Épicos".
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {customLists.map((list) => (
                <div
                  key={list.id}
                  className={`p-5 rounded-3xl glass-panel border ${
                    isLight ? 'border-slate-200' : 'border-white/[0.08]'
                  }`}
                >
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h4 className="text-base font-bold text-white">{list.name}</h4>
                      {list.description && (
                        <p className="text-xs text-white/50 mt-0.5">{list.description}</p>
                      )}
                    </div>
                    <button
                      onClick={() => handleDeleteList(list.id)}
                      className="p-2 text-white/40 hover:text-white transition-colors"
                      title="Excluir lista"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {list.items.length === 0 ? (
                    <p className="text-xs text-white/40 py-4 italic">Esta lista ainda está vazia.</p>
                  ) : (
                    <div className="flex gap-3 overflow-x-auto no-scrollbar py-2">
                      {list.items.map((item) => (
                        <div key={item.id} className="w-28 shrink-0">
                          <MovieCard
                            media={item}
                            onSelect={onSelectMedia}
                            onQuickPlay={onPlayMedia}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Modal Criar Nova Lista */}
      {showNewListModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
          <div className="w-full max-w-md glass-panel rounded-3xl p-6 border border-white/10 shadow-2xl">
            <h3 className="text-lg font-bold text-white mb-3">Criar Lista Personalizada</h3>
            <form onSubmit={handleCreateList} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-white/70 mb-1">Nome da Lista</label>
                <input
                  type="text"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  placeholder="Ex: Favoritos de Suspense, Maratonas 2024..."
                  className="w-full px-3 py-2 text-sm rounded-xl bg-white/10 border border-white/20 text-white focus:outline-none"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-white/70 mb-1">Descrição (opcional)</label>
                <textarea
                  value={newListDesc}
                  onChange={(e) => setNewListDesc(e.target.value)}
                  placeholder="Sobre o que é essa seleção..."
                  rows={2}
                  className="w-full p-3 text-xs rounded-xl bg-white/10 border border-white/20 text-white focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewListModal(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-xl text-white/60 hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!newListName.trim()}
                  className="px-5 py-2 text-xs font-bold rounded-xl bg-white text-black hover:bg-slate-200 transition-colors disabled:opacity-40"
                >
                  Criar Lista
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal de Sincronização em Nuvem & Pareamento */}
      <SyncAccountModal
        isOpen={showSyncModal}
        onClose={() => setShowSyncModal(false)}
        theme={theme}
        onSyncCompleted={reloadData}
      />

    </div>
  );
};
