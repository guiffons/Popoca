/**
 * Popoca Streaming - Profile & Letterboxd View Component
 * Estética Apple TV+ Liquid Glass com contraste nítido em Modo Claro e Modo Escuro,
 * Top 4 Favoritos, métricas, avaliações, listas personalizadas e sincronização em nuvem.
 */

import React, { useState, useEffect, useRef } from 'react';
import {
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
  Edit3,
  Camera,
  Check,
  Cloud,
  Upload
} from 'lucide-react';
import { MediaItem, WatchHistoryItem, MovieRating, CustomList, UserProfile } from '../types/index.ts';
import { letterboxdService } from '../services/letterboxd.ts';
import { storageService } from '../services/storage.ts';
import { cloudSync } from '../services/cloudSync.ts';
import { apiUrl } from '../services/api.ts';
import { MovieCard } from './MovieCard.tsx';
import { LazyImage } from './LazyImage.tsx';
import { SyncAccountModal } from './SyncAccountModal.tsx';

interface ProfileViewProps {
  theme: 'dark' | 'light';
  onSelectMedia: (media: MediaItem) => void;
  onPlayMedia: (media: MediaItem) => void;
  onOpenLetterboxd?: () => void;
}

const AVATAR_PRESETS = [
  { name: 'Cinéfilo Noir', url: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=200&auto=format&fit=crop&q=80' },
  { name: 'Diretor Moderno', url: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=200&auto=format&fit=crop&q=80' },
  { name: 'Crítica de Cinema', url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=200&auto=format&fit=crop&q=80' },
  { name: 'Anime', url: 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=200&auto=format&fit=crop&q=80' },
  { name: 'Minimalista', url: 'https://images.unsplash.com/photo-1570295999919-56ceb5ecca61?w=200&auto=format&fit=crop&q=80' }
];

const BANNER_PRESETS = [
  { name: 'Interestelar Sci-Fi', url: 'https://images.unsplash.com/photo-1536440136628-849c177e76a1?w=1600&auto=format&fit=crop&q=80' },
  { name: 'Cyberpunk Neon', url: 'https://images.unsplash.com/photo-1518709268805-4e9042af9f23?w=1600&auto=format&fit=crop&q=80' },
  { name: 'Cinema 35mm', url: 'https://images.unsplash.com/photo-1489599849927-2ee91cede3ba?w=1600&auto=format&fit=crop&q=80' },
  { name: 'Aurora Cósmica', url: 'https://images.unsplash.com/photo-1506703719100-a0f3a48c0f86?w=1600&auto=format&fit=crop&q=80' },
  { name: 'Anime Sunset', url: 'https://images.unsplash.com/photo-1579783902614-a3fb3927b675?w=1600&auto=format&fit=crop&q=80' }
];

/**
 * Processa a imagem selecionada na galeria mobile/desktop via HTML5 <canvas>:
 * - Faz center-crop quadrado exato (256x256px)
 * - Exporta como string Base64 via canvas.toDataURL('image/webp', 0.8) (Zero custo de storage externo)
 */
function cropImageFileToWebp256(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Falha ao ler o arquivo de imagem.'));
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 256;
          canvas.height = 256;
          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Contexto Canvas 2D indisponível.'));
            return;
          }

          const minSide = Math.min(img.width, img.height);
          const sx = Math.floor((img.width - minSide) / 2);
          const sy = Math.floor((img.height - minSide) / 2);

          ctx.clearRect(0, 0, 256, 256);
          ctx.drawImage(img, sx, sy, minSide, minSide, 0, 0, 256, 256);

          const webpDataUrl = canvas.toDataURL('image/webp', 0.8);
          resolve(webpDataUrl);
        } catch (err) {
          reject(err);
        }
      };
      img.onerror = () => reject(new Error('Imagem inválida ou formato não suportado.'));
      img.src = dataUrl;
    };
    reader.readAsDataURL(file);
  });
}

export const ProfileView: React.FC<ProfileViewProps> = ({
  theme,
  onSelectMedia,
  onPlayMedia,
  onOpenLetterboxd
}) => {
  const [activeTab, setActiveTab] = useState<'watched' | 'ratings' | 'liked' | 'watchlist' | 'history' | 'lists'>('watched');
  const [profile, setProfile] = useState<UserProfile>(() => letterboxdService.getProfile());

  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [usernameInput, setUsernameInput] = useState(profile.username);
  const [handleInput, setHandleInput] = useState(profile.handle || '@cinefilo');
  const [bioInput, setBioInput] = useState(profile.bio);
  const [letterboxdInput, setLetterboxdInput] = useState(profile.letterboxdUsername || '');
  const [avatarUrlInput, setAvatarUrlInput] = useState(profile.avatarUrl);
  const [bannerUrlInput, setBannerUrlInput] = useState(profile.bannerUrl || BANNER_PRESETS[0].url);
  const [avatarUploadNotice, setAvatarUploadNotice] = useState<string | null>(null);
  const avatarFileInputRef = useRef<HTMLInputElement>(null);

  const [watchHistory, setWatchHistory] = useState<WatchHistoryItem[]>([]);
  const [watchedMovies, setWatchedMovies] = useState<MediaItem[]>([]);
  const [ratings, setRatings] = useState<Record<number, MovieRating>>({});
  const [likedMovies, setLikedMovies] = useState<MediaItem[]>([]);
  const [watchlist, setWatchlist] = useState<MediaItem[]>([]);
  const [customLists, setCustomLists] = useState<CustomList[]>([]);

  const [showNewListModal, setShowNewListModal] = useState(false);
  const [newListName, setNewListName] = useState('');
  const [newListDesc, setNewListDesc] = useState('');

  const [showSyncModal, setShowSyncModal] = useState(false);

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
    const handleStorageSynced = () => reloadData();
    window.addEventListener('popoca_storage_synced', handleStorageSynced);
    const unsubscribe = cloudSync.subscribe(() => {});
    return () => {
      window.removeEventListener('popoca_storage_synced', handleStorageSynced);
      unsubscribe();
    };
  }, []);

  const syncProfileWithBackend = async (updated: UserProfile) => {
    try {
      const acct = cloudSync.getAccount();
      const token = acct.token || (await cloudSync.ensureSession());
      if (token) {
        await fetch(apiUrl('/api/auth/profile'), {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`
          },
          body: JSON.stringify({
            username: updated.username,
            handle: updated.handle,
            bio: updated.bio,
            avatarUrl: updated.avatarUrl,
            bannerUrl: updated.bannerUrl
          })
        });
      }
      cloudSync.syncNow();
    } catch {}
  };

  const handleAvatarFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const webpBase64 = await cropImageFileToWebp256(file);
      setAvatarUrlInput(webpBase64);
      const updated = letterboxdService.updateProfile({
        avatarUrl: webpBase64
      });
      setProfile(updated);
      setAvatarUploadNotice('Foto otimizada em 256x256 WebP e salva no perfil.');
      setTimeout(() => setAvatarUploadNotice(null), 3500);
      await syncProfileWithBackend(updated);
    } catch {
      setAvatarUploadNotice('Não foi possível processar a imagem selecionada.');
      setTimeout(() => setAvatarUploadNotice(null), 3500);
    } finally {
      if (avatarFileInputRef.current) {
        avatarFileInputRef.current.value = '';
      }
    }
  };

  const handleSaveProfile = async () => {
    const updated = letterboxdService.updateProfile({
      username: usernameInput.trim() || 'Cinéfilo Popoca',
      handle: handleInput.trim() || '@cinefilo',
      bio: bioInput.trim(),
      letterboxdUsername: letterboxdInput.trim(),
      avatarUrl: avatarUrlInput.trim() || profile.avatarUrl,
      bannerUrl: bannerUrlInput.trim() || profile.bannerUrl
    });
    setProfile(updated);
    setIsEditingProfile(false);
    await syncProfileWithBackend(updated);
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
  const stats = letterboxdService.getStats();

  const allKnownMovies = [
    ...watchedMovies,
    ...likedMovies,
    ...watchlist,
    ...watchHistory.map((h) => ({
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
    <div className="max-w-[1440px] mx-auto px-3.5 sm:px-6 lg:px-8 py-6 sm:py-8">
      {/* Input oculto para upload de Avatar Mobile/Desktop via HTML5 Canvas (256x256 WebP) */}
      <input
        ref={avatarFileInputRef}
        type="file"
        accept="image/jpeg, image/png, image/webp"
        hidden
        onChange={handleAvatarFileSelected}
      />

      {/* Cabeçalho do Perfil com Widescreen Banner Cinematográfico em Liquid Glass */}
      <div className="rounded-3xl liquid-glass mb-7 transition-colors overflow-hidden">
        {/* Banner de Fundo */}
        <div className="relative h-36 sm:h-52 lg:h-64 w-full overflow-hidden bg-slate-900 group/banner">
          <img
            src={
              profile.bannerUrl ||
              BANNER_PRESETS[0].url
            }
            alt="Capa do Perfil"
            className="w-full h-full object-cover brightness-[0.70] contrast-[1.05] group-hover/banner:scale-105 transition-transform duration-700"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/35 to-transparent pointer-events-none" />
          <button
            type="button"
            onClick={() => {
              setUsernameInput(profile.username);
              setHandleInput(profile.handle || '@cinefilo');
              setBioInput(profile.bio);
              setLetterboxdInput(profile.letterboxdUsername || '');
              setAvatarUrlInput(profile.avatarUrl);
              setBannerUrlInput(profile.bannerUrl || BANNER_PRESETS[0].url);
              setIsEditingProfile(true);
            }}
            className="absolute top-3.5 right-3.5 px-3.5 py-1.5 rounded-full liquid-glass text-white text-xs font-semibold flex items-center gap-1.5 hover:border-white/30 transition-all cursor-pointer shadow-lg"
          >
            <Camera className="w-3.5 h-3.5 text-white/90" />
            <span>Editar Perfil & Capa</span>
          </button>
        </div>

        {/* Informações do Perfil sobrepostas */}
        <div className="p-5 sm:p-8 pt-0 relative -mt-12 sm:-mt-14">
          <div className="flex flex-col sm:flex-row items-start sm:items-end justify-between gap-5">
            <div className="flex items-end gap-4 sm:gap-6">
              {/* Avatar Circular com Botão Sobreposto para Galeria Mobile/Desktop */}
              <div className="relative group/avatar shrink-0">
                <div
                  className={`w-22 h-22 sm:w-28 sm:h-28 rounded-full overflow-hidden shadow-2xl border-2 ${
                    isLight ? 'border-white bg-slate-900' : 'border-white/25 bg-neutral-900'
                  }`}
                >
                  {profile.avatarUrl ? (
                    <img
                      src={profile.avatarUrl}
                      alt={profile.username}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center font-extrabold text-2xl text-white">
                      {profile.username ? profile.username[0].toUpperCase() : 'P'}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => avatarFileInputRef.current?.click()}
                  className="absolute inset-0 bg-black/55 opacity-0 group-hover/avatar:opacity-100 rounded-full flex flex-col items-center justify-center text-white transition-opacity duration-200 cursor-pointer"
                  title="Enviar foto da galeria"
                  aria-label="Alterar foto de perfil da galeria"
                >
                  <Camera className="w-5 h-5" />
                  <span className="text-[9px] font-bold uppercase tracking-wider mt-0.5">Foto</span>
                </button>
                <button
                  type="button"
                  onClick={() => avatarFileInputRef.current?.click()}
                  className="absolute -bottom-0.5 -right-0.5 w-8 h-8 rounded-full bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-neutral-200 dark:text-black border-2 border-[#0b0d13] flex items-center justify-center shadow-lg transition-transform active:scale-95 cursor-pointer"
                  title="Enviar foto da galeria (256x256 WebP)"
                  aria-label="Enviar foto da galeria"
                >
                  <Camera className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="pb-1">
                <div className="flex items-center gap-2.5 flex-wrap">
                  <h1 className="text-xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white">
                    {profile.username}
                  </h1>
                  <span className="font-mono text-xs sm:text-sm text-slate-500 dark:text-white/45 font-semibold">
                    {profile.handle || '@cinefilo'}
                  </span>
                  {profile.letterboxdUsername && (
                    <a
                      href={`https://letterboxd.com/${profile.letterboxdUsername}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold glass-subtle text-slate-800 dark:text-white/80 hover:opacity-80 transition-opacity"
                    >
                      <span>Letterboxd</span>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>

                {profile.bio && (
                  <p className="text-xs sm:text-sm max-w-xl mt-1.5 text-slate-600 dark:text-white/70">
                    {profile.bio}
                  </p>
                )}

                {avatarUploadNotice && (
                  <p className="text-xs font-semibold text-emerald-400 mt-1.5">
                    {avatarUploadNotice}
                  </p>
                )}

                <div className="flex items-center gap-3 mt-2.5 flex-wrap">
                  <button
                    type="button"
                    onClick={() => {
                      setUsernameInput(profile.username);
                      setHandleInput(profile.handle || '@cinefilo');
                      setBioInput(profile.bio);
                      setLetterboxdInput(profile.letterboxdUsername || '');
                      setAvatarUrlInput(profile.avatarUrl);
                      setBannerUrlInput(profile.bannerUrl || BANNER_PRESETS[0].url);
                      setIsEditingProfile(true);
                    }}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-neutral-200 dark:text-black text-xs font-bold shadow-md transition-all cursor-pointer"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Editar Perfil</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => avatarFileInputRef.current?.click()}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-subtle text-xs font-semibold text-slate-700 dark:text-white/85 hover:opacity-90 transition-opacity cursor-pointer"
                  >
                    <Upload className="w-3.5 h-3.5 text-slate-700 dark:text-white/90" />
                    <span>Trocar Foto da Galeria</span>
                  </button>
                </div>
              </div>
            </div>

            {/* Ações de Conta */}
            <div className="flex items-center gap-2 shrink-0 flex-wrap">
              {onOpenLetterboxd && (
                <button
                  type="button"
                  onClick={onOpenLetterboxd}
                  className="flex items-center gap-2 px-3.5 py-2 text-xs font-extrabold rounded-full bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-neutral-200 dark:text-black transition-all cursor-pointer shadow-sm"
                >
                  <Star className="w-3.5 h-3.5 fill-current" />
                  <span>Abrir Aba Letterboxd</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowSyncModal(true)}
                className={`flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-full border transition-all cursor-pointer ${
                  isLight
                    ? 'bg-emerald-50 text-emerald-700 border-emerald-200 hover:bg-emerald-100'
                    : 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30 hover:bg-emerald-500/20'
                }`}
              >
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                </span>
                <Cloud className="w-3.5 h-3.5" />
                <span>Nuvem</span>
              </button>

              <button
                type="button"
                onClick={handleExportCSV}
                className="flex items-center gap-2 px-3.5 py-2 text-xs font-bold rounded-full glass-subtle text-slate-800 dark:text-white/85 hover:opacity-85 transition-opacity cursor-pointer"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Exportar CSV</span>
              </button>
            </div>
          </div>

          {/* Métricas */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 mt-6 pt-6 border-t border-slate-200/80 dark:border-white/[0.08]">
            <div className="p-3.5 rounded-2xl liquid-glass">
              <div className="text-2xl sm:text-3xl font-extrabold font-mono text-slate-900 dark:text-white">
                {stats.totalWatched}
              </div>
              <div className="text-xs mt-0.5 text-slate-500 dark:text-white/50">
                Vistos
              </div>
            </div>

            <div className="p-3.5 rounded-2xl liquid-glass">
              <div className="text-2xl sm:text-3xl font-extrabold font-mono text-slate-900 dark:text-white">
                {stats.hoursWatched}h
              </div>
              <div className="text-xs mt-0.5 text-slate-500 dark:text-white/50">
                Assistidas
              </div>
            </div>

            <div className="p-3.5 rounded-2xl liquid-glass">
              <div className="text-2xl sm:text-3xl font-extrabold font-mono flex items-center gap-1 text-slate-900 dark:text-white">
                <Star className="w-5 h-5 text-amber-500 dark:text-amber-400 fill-current" />
                <span>{stats.averageRating}</span>
              </div>
              <div className="text-xs mt-0.5 text-slate-500 dark:text-white/50">
                Média
              </div>
            </div>

            <div className="p-3.5 rounded-2xl liquid-glass">
              <div className="text-2xl sm:text-3xl font-extrabold font-mono text-slate-900 dark:text-white">
                {customLists.length}
              </div>
              <div className="text-xs mt-0.5 text-slate-500 dark:text-white/50">
                Listas
              </div>
            </div>
          </div>

          {/* 4 Favoritos */}
          <div className="mt-6 pt-6 border-t border-slate-200/80 dark:border-white/[0.08]">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-white/50 mb-3">
              Favoritos
            </h3>

            <div className="grid grid-cols-4 gap-2.5 sm:gap-4 max-w-xl">
              {[0, 1, 2, 3].map((slotIdx) => {
                const fav = top4Favorites[slotIdx] || likedMovies[slotIdx];
                return (
                  <div
                    key={slotIdx}
                    onClick={() => fav && onSelectMedia(fav)}
                    className={`relative aspect-[2/3] rounded-xl sm:rounded-2xl overflow-hidden border transition-transform ${
                      fav ? 'cursor-pointer hover:scale-[1.03]' : ''
                    } ${
                      isLight
                        ? 'border-slate-200 bg-slate-100/80'
                        : 'border-white/10 bg-white/[0.03]'
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
                      <div className="w-full h-full flex flex-col items-center justify-center text-slate-400 dark:text-white/20 p-2 text-center">
                        <Heart className="w-4 h-4 mb-1" />
                        <span className="text-[10px]">#{slotIdx + 1}</span>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* Modal de Edição de Perfil em Liquid Glass */}
      {isEditingProfile && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
          <div className="w-full max-w-lg liquid-glass-heavy rounded-3xl p-6 sm:p-8 shadow-2xl relative text-slate-900 dark:text-white max-h-[90vh] overflow-y-auto">
            <h2 className="text-xl font-extrabold mb-4">Editar Perfil</h2>

            <div className="space-y-4">
              {/* Preview Circular com Upload via Canvas */}
              <div className="flex items-center gap-4 p-3.5 rounded-2xl liquid-glass">
                <div className="relative w-18 h-18 rounded-full overflow-hidden border-2 border-slate-900 dark:border-white shrink-0 bg-neutral-900">
                  {avatarUrlInput ? (
                    <img src={avatarUrlInput} alt="Preview Avatar" className="w-full h-full object-cover" />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center font-extrabold text-xl text-white">
                      {usernameInput ? usernameInput[0].toUpperCase() : 'P'}
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => avatarFileInputRef.current?.click()}
                    className="absolute inset-0 bg-black/50 opacity-0 hover:opacity-100 flex items-center justify-center text-white transition-opacity cursor-pointer"
                    title="Escolher foto da galeria"
                  >
                    <Camera className="w-4 h-4" />
                  </button>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-bold text-slate-900 dark:text-white">Foto de Perfil (256x256 WebP)</p>
                  <p className="text-[11px] text-slate-500 dark:text-white/55 mt-0.5">
                    Recorte central automático via HTML5 Canvas direto no navegador.
                  </p>
                  <button
                    type="button"
                    onClick={() => avatarFileInputRef.current?.click()}
                    className="mt-2 px-3.5 py-1.5 rounded-full bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-neutral-200 dark:text-black text-xs font-bold inline-flex items-center gap-1.5 transition-colors cursor-pointer shadow-sm"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Escolher da Galeria</span>
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-white/70 mb-1">Nome</label>
                <input
                  type="text"
                  value={usernameInput}
                  onChange={(e) => setUsernameInput(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm rounded-xl bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/15 text-slate-900 dark:text-white focus:outline-none"
                  placeholder="Seu nome"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-white/70 mb-1">@handle</label>
                <input
                  type="text"
                  value={handleInput}
                  onChange={(e) => setHandleInput(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm rounded-xl bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/15 text-slate-900 dark:text-white focus:outline-none font-mono"
                  placeholder="@seunome"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-white/70 mb-1">Bio</label>
                <textarea
                  value={bioInput}
                  onChange={(e) => setBioInput(e.target.value)}
                  rows={2}
                  className="w-full p-3 text-sm rounded-xl bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/15 text-slate-900 dark:text-white focus:outline-none"
                  placeholder="Filmes e gêneros favoritos"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-white/70 mb-1.5">Avatares Sugeridos</label>
                <div className="flex items-center gap-2 mb-2 overflow-x-auto pb-1">
                  {AVATAR_PRESETS.map((preset, pIdx) => (
                    <button
                      key={pIdx}
                      type="button"
                      onClick={() => setAvatarUrlInput(preset.url)}
                      className={`relative w-12 h-12 rounded-full overflow-hidden border shrink-0 transition-transform cursor-pointer ${
                        avatarUrlInput === preset.url
                          ? 'border-slate-900 dark:border-white ring-2 ring-slate-900 dark:ring-white scale-105'
                          : 'border-slate-300 dark:border-white/20 opacity-70 hover:opacity-100'
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
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-white/70 mb-1.5">Banner de Capa</label>
                <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-2 overflow-x-auto pb-1">
                  {BANNER_PRESETS.map((preset, bIdx) => (
                    <button
                      key={bIdx}
                      type="button"
                      onClick={() => setBannerUrlInput(preset.url)}
                      className={`relative h-14 rounded-xl overflow-hidden border transition-all cursor-pointer ${
                        bannerUrlInput === preset.url
                          ? 'border-slate-900 dark:border-white ring-2 ring-slate-900 dark:ring-white scale-105'
                          : 'border-slate-300 dark:border-white/20 opacity-70 hover:opacity-100'
                      }`}
                      title={preset.name}
                    >
                      <img src={preset.url} alt={preset.name} className="w-full h-full object-cover" />
                      <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex items-end p-1">
                        <span className="text-[9px] text-white font-medium truncate leading-tight">{preset.name.split(' ')[0]}</span>
                      </div>
                      {bannerUrlInput === preset.url && (
                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                          <Check className="w-4 h-4 text-white" />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
                <input
                  type="url"
                  value={bannerUrlInput}
                  onChange={(e) => setBannerUrlInput(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-xl bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/15 text-slate-900 dark:text-white focus:outline-none"
                  placeholder="URL personalizada do banner (opcional)"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-white/70 mb-1">Letterboxd (opcional)</label>
                <input
                  type="text"
                  value={letterboxdInput}
                  onChange={(e) => setLetterboxdInput(e.target.value)}
                  className="w-full px-3.5 py-2 text-sm rounded-xl bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/15 text-slate-900 dark:text-white focus:outline-none"
                  placeholder="Usuário no Letterboxd"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2.5 mt-6">
              <button
                type="button"
                onClick={() => setIsEditingProfile(false)}
                className="px-4 py-2 text-xs font-semibold rounded-full text-slate-600 hover:text-slate-900 dark:text-white/60 dark:hover:text-white transition-colors cursor-pointer"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveProfile}
                className="px-5 py-2 text-xs font-bold rounded-full bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-neutral-200 dark:text-black transition-colors shadow-md cursor-pointer"
              >
                Salvar Alterações
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Abas */}
      <div className="flex items-center gap-1.5 border-b border-slate-200/80 dark:border-white/[0.08] pb-4 mb-6 overflow-x-auto no-scrollbar">
        {[
          { id: 'watched', label: `Vistos (${watchedMovies.length})`, icon: CheckCircle2 },
          { id: 'ratings', label: `Avaliações (${Object.keys(ratings).length})`, icon: Star },
          { id: 'liked', label: `Curtidos (${likedMovies.length})`, icon: Heart },
          { id: 'watchlist', label: `Watchlist (${watchlist.length})`, icon: Bookmark },
          { id: 'history', label: `Histórico (${watchHistory.length})`, icon: Clock },
          { id: 'lists', label: `Listas (${customLists.length})`, icon: ListPlus }
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as any)}
              className={`flex items-center gap-2 px-4 py-2 rounded-full text-xs font-semibold shrink-0 transition-all cursor-pointer ${
                isActive
                  ? 'bg-slate-900 text-white dark:bg-white dark:text-black shadow-sm font-bold'
                  : isLight
                  ? 'text-slate-600 hover:text-slate-900 hover:bg-slate-900/[0.05]'
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
            <div className="text-center py-16 text-slate-500 dark:text-white/40">
              <Film className="w-10 h-10 mx-auto mb-2.5 opacity-35" />
              <p className="text-sm font-semibold">Nenhum título assistido ainda</p>
            </div>
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
      )}

      {activeTab === 'ratings' && (
        <div>
          {Object.keys(ratings).length === 0 ? (
            <div className="text-center py-16 text-slate-500 dark:text-white/40">
              <Star className="w-10 h-10 mx-auto mb-2.5 opacity-35" />
              <p className="text-sm font-semibold">Nenhuma avaliação registrada</p>
            </div>
          ) : (
            <div className="space-y-3">
              {Object.values(ratings).map((item) => (
                <div
                  key={item.mediaId}
                  className="p-4 rounded-2xl liquid-glass flex items-start gap-4 transition-all"
                >
                  <div
                    onClick={() =>
                      onSelectMedia({
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
                      })
                    }
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
                        onClick={() =>
                          onSelectMedia({
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
                          })
                        }
                        className="text-sm sm:text-base font-bold text-slate-900 dark:text-white hover:underline cursor-pointer truncate"
                      >
                        {item.title}
                      </h4>

                      <div className="flex items-center gap-1 font-mono text-amber-600 dark:text-amber-400 font-bold text-xs bg-amber-500/10 px-2.5 py-0.5 rounded-full border border-amber-500/20">
                        <Star className="w-3 h-3 fill-current" />
                        <span>{item.rating.toFixed(1)}</span>
                      </div>
                    </div>

                    {item.review && (
                      <p className="text-xs mt-2 italic leading-relaxed text-slate-700 dark:text-white/80">
                        "{item.review}"
                      </p>
                    )}

                    <div className="flex items-center gap-3 text-[11px] text-slate-500 dark:text-white/40 mt-2.5">
                      <span>{new Date(item.watchedDate).toLocaleDateString('pt-BR')}</span>
                      {item.isLiked && (
                        <span className="flex items-center gap-1 text-slate-700 dark:text-white/70">
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
            <div className="text-center py-16 text-slate-500 dark:text-white/40">
              <Heart className="w-10 h-10 mx-auto mb-2.5 opacity-35" />
              <p className="text-sm font-semibold">Nenhum título curtido</p>
            </div>
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
      )}

      {activeTab === 'watchlist' && (
        <div>
          {watchlist.length === 0 ? (
            <div className="text-center py-16 text-slate-500 dark:text-white/40">
              <Bookmark className="w-10 h-10 mx-auto mb-2.5 opacity-35" />
              <p className="text-sm font-semibold">Watchlist vazia</p>
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

      {activeTab === 'history' && (
        <div>
          {watchHistory.length === 0 ? (
            <div className="text-center py-16 text-slate-500 dark:text-white/40">
              <Clock className="w-10 h-10 mx-auto mb-2.5 opacity-35" />
              <p className="text-sm font-semibold">Sem histórico recente</p>
            </div>
          ) : (
            <div className="space-y-3">
              {watchHistory.map((item) => (
                <div
                  key={item.id}
                  className="p-3.5 rounded-2xl liquid-glass flex items-center justify-between gap-4 transition-all"
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
                      <h4 className="text-xs sm:text-sm font-bold text-slate-900 dark:text-white truncate">
                        {item.title}
                      </h4>
                      {item.episodeNumber && (
                        <span className="text-[11px] font-mono font-semibold text-slate-700 dark:text-white/85">
                          T{item.seasonNumber || 1}:E{item.episodeNumber}
                          {item.episodeTitle ? ` · ${item.episodeTitle}` : ''}
                        </span>
                      )}
                      <div className="flex items-center gap-2 text-[11px] text-slate-500 dark:text-white/45 mt-1">
                        <span>{item.progressPercent}%</span>
                        <span aria-hidden="true">·</span>
                        <span>{new Date(item.lastWatched).toLocaleDateString('pt-BR')}</span>
                      </div>
                    </div>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      onPlayMedia({
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
                      })
                    }
                    className="px-3.5 py-2 rounded-full bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-neutral-200 dark:text-black text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm shrink-0 cursor-pointer"
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
            <h3 className="text-base font-extrabold text-slate-900 dark:text-white">Listas</h3>
            <button
              type="button"
              onClick={() => setShowNewListModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-full bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-neutral-200 dark:text-black text-xs font-bold transition-colors shadow-sm cursor-pointer"
            >
              <Plus className="w-4 h-4" />
              <span>Nova Lista</span>
            </button>
          </div>

          {customLists.length === 0 ? (
            <div className="text-center py-16 text-slate-500 dark:text-white/40">
              <ListPlus className="w-10 h-10 mx-auto mb-2.5 opacity-35" />
              <p className="text-sm font-semibold">Nenhuma lista criada</p>
            </div>
          ) : (
            <div className="space-y-5">
              {customLists.map((list) => (
                <div key={list.id} className="p-5 rounded-3xl liquid-glass">
                  <div className="flex items-center justify-between mb-3">
                    <div>
                      <h4 className="text-base font-bold text-slate-900 dark:text-white">{list.name}</h4>
                      {list.description && (
                        <p className="text-xs text-slate-500 dark:text-white/50 mt-0.5">{list.description}</p>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => handleDeleteList(list.id)}
                      className="p-2 text-slate-400 hover:text-slate-900 dark:text-white/40 dark:hover:text-white transition-colors"
                      title="Excluir lista"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>

                  {list.items.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-white/40 py-3">Lista vazia</p>
                  ) : (
                    <div className="flex gap-3 overflow-x-auto no-scrollbar py-2">
                      {list.items.map((item) => (
                        <div key={item.id} className="w-32 shrink-0">
                          <MovieCard
                            media={item}
                            fluid
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
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70">
          <div className="w-full max-w-md liquid-glass-heavy rounded-3xl p-6 shadow-2xl text-slate-900 dark:text-white">
            <h3 className="text-lg font-extrabold mb-3">Nova Lista</h3>
            <form onSubmit={handleCreateList} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-white/70 mb-1">Nome</label>
                <input
                  type="text"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                  placeholder="Ex: Favoritos de 2026"
                  className="w-full px-3.5 py-2 text-sm rounded-xl bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/20 text-slate-900 dark:text-white focus:outline-none"
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-600 dark:text-white/70 mb-1">Descrição</label>
                <textarea
                  value={newListDesc}
                  onChange={(e) => setNewListDesc(e.target.value)}
                  placeholder="Opcional"
                  rows={2}
                  className="w-full p-3 text-xs rounded-xl bg-slate-100 dark:bg-white/10 border border-slate-200 dark:border-white/20 text-slate-900 dark:text-white focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setShowNewListModal(false)}
                  className="px-4 py-2 text-xs font-semibold rounded-full text-slate-600 hover:text-slate-900 dark:text-white/60 dark:hover:text-white"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={!newListName.trim()}
                  className="px-5 py-2 text-xs font-bold rounded-full bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:hover:bg-neutral-200 dark:text-black transition-colors disabled:opacity-40"
                >
                  Criar
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <SyncAccountModal
        isOpen={showSyncModal}
        onClose={() => setShowSyncModal(false)}
        theme={theme}
        onSyncCompleted={reloadData}
      />
    </div>
  );
};
