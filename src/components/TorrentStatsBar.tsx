/**
 * Popoca Streaming - Torrent Technical HUD & Piece Visualizer
 * Exibe telemetria em tempo real da rede P2P:
 * - Taxa de download e upload instantânea
 * - Peers conectados vs ativos (seeds que estão enviando dados)
 * - ETA (tempo restante estimado)
 * - Mapa visual de peças (60 setores do enxame bitfield)
 * - Seletor dinâmico de perfil de trackers e botão de forçar Re-try
 */

import React, { useState } from 'react';
import {
  Activity,
  ArrowDown,
  ArrowUp,
  Users,
  Clock,
  RefreshCw,
  Zap,
  ChevronDown,
  ChevronUp,
  ShieldCheck,
  Radio,
  X
} from 'lucide-react';
import { TorrentLiveStats, TrackerPriorityMode } from '../types/index.ts';
import { api } from '../services/api.ts';

interface TorrentStatsBarProps {
  stats: TorrentLiveStats | null;
  magnetUri?: string;
  isTranscoded?: boolean;
  onClose?: () => void;
  className?: string;
}

function formatSpeed(bytesPerSec: number): string {
  if (!bytesPerSec || bytesPerSec <= 0) return '0 KB/s';
  if (bytesPerSec >= 1024 * 1024) {
    return `${(bytesPerSec / (1024 * 1024)).toFixed(1)} MB/s`;
  }
  return `${Math.round(bytesPerSec / 1024)} KB/s`;
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 MB';
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(2)} GB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function calculateEta(totalBytes: number, downloadedBytes: number, speedBytesSec: number): string {
  if (!speedBytesSec || speedBytesSec <= 1024) return '—';
  const remaining = Math.max(0, totalBytes - downloadedBytes);
  if (remaining <= 0) return 'Pronto';
  const sec = Math.round(remaining / speedBytesSec);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return `${min}m ${remSec}s`;
  const hours = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hours}h ${remMin}m`;
}

export const TorrentStatsBar: React.FC<TorrentStatsBarProps> = ({
  stats,
  magnetUri,
  isTranscoded = false,
  onClose,
  className = ''
}) => {
  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [isRetrying, setIsRetrying] = useState<boolean>(false);
  const [retryNotice, setRetryNotice] = useState<string | null>(null);
  const [selectedProfile, setSelectedProfile] = useState<TrackerPriorityMode>(() =>
    stats?.trackerPriority || api.getSavedTrackerPriority()
  );

  const handleRetry = async () => {
    if (!magnetUri || isRetrying) return;
    setIsRetrying(true);
    setRetryNotice('Re-conectando aos melhores peers...');
    try {
      const res = await api.retryTorrentPeers(magnetUri, selectedProfile);
      if (res.success) {
        setRetryNotice(`Re-try executado com sucesso (${res.stats?.numPeers || 0} peers).`);
      } else {
        setRetryNotice('Re-try enviado para os trackers.');
      }
    } catch {
      setRetryNotice('Não foi possível atualizar a lista de peers.');
    } finally {
      setIsRetrying(false);
      setTimeout(() => setRetryNotice(null), 3500);
    }
  };

  const handleSwitchProfile = async (mode: TrackerPriorityMode) => {
    setSelectedProfile(mode);
    try {
      await api.setTrackerPriority(mode, magnetUri);
      setRetryNotice(`Perfil alterado para ${mode === 'pt-br-stability' ? 'PT-BR Estável' : mode === 'ultra-speed' ? 'Ultra Velocidade' : 'Global'}`);
      setTimeout(() => setRetryNotice(null), 3000);
    } catch {}
  };

  if (!stats) {
    return (
      <div
        className={`glass-panel rounded-2xl p-3 border border-white/10 text-white/70 text-xs flex items-center justify-between gap-3 shadow-2xl backdrop-blur-xl ${className}`}
      >
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 animate-spin text-white/50" />
          <span>Aguardando metadados do enxame P2P...</span>
        </div>
        {onClose && (
          <button
            onClick={onClose}
            className="p-1 rounded-full hover:bg-white/10 text-white/60 hover:text-white"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    );
  }

  const pieceMap = stats.pieceMap && stats.pieceMap.length > 0 ? stats.pieceMap : [];
  const eta = calculateEta(stats.length, stats.downloaded, stats.downloadSpeed);

  return (
    <aside
      aria-label="Telemetria P2P"
      className={`glass-panel rounded-2xl border border-white/15 text-white shadow-2xl backdrop-blur-2xl transition-all duration-300 max-w-lg w-full ${className}`}
    >
      {/* Barra de Título / Cabeçalho Rápido */}
      <div className="p-3 sm:p-3.5 flex items-center justify-between gap-2 border-b border-white/10 select-none">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-lg bg-emerald-500/20 border border-emerald-500/30 flex items-center justify-center text-emerald-400 shrink-0">
            <Radio className="w-4 h-4 animate-pulse" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold tracking-tight text-white flex items-center gap-1.5 truncate">
                Telemetria P2P
              </span>
              <span
                className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${
                  isTranscoded
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                }`}
              >
                {isTranscoded ? 'Remux FFmpeg' : 'Nativo MP4'}
              </span>
            </div>
            <p className="text-[10px] text-white/50 truncate font-mono">
              {stats.name || 'Vídeo Torrent'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            onClick={() => setIsExpanded(!isExpanded)}
            className="p-1.5 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer"
            title={isExpanded ? 'Recolher detalhes' : 'Expandir detalhes'}
            aria-label={isExpanded ? 'Recolher' : 'Expandir'}
          >
            {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          {onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/10 text-white/70 hover:text-white transition-colors cursor-pointer"
              title="Fechar painel de telemetria"
              aria-label="Fechar"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {/* Mini Resumo sempre visível */}
      <div className="px-3 sm:px-4 py-2.5 flex items-center justify-between text-xs font-mono border-b border-white/5 bg-black/20">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1 text-emerald-400 font-bold" title="Taxa de Download">
            <ArrowDown className="w-3.5 h-3.5" />
            {formatSpeed(stats.downloadSpeed)}
          </span>
          <span className="flex items-center gap-1 text-white/50 text-[11px]" title="Taxa de Upload">
            <ArrowUp className="w-3 h-3" />
            {formatSpeed(stats.uploadSpeed)}
          </span>
        </div>

        <div className="flex items-center gap-3 text-white/80 text-[11px]">
          <span className="flex items-center gap-1" title="Peers Conectados (Ativos)">
            <Users className="w-3.5 h-3.5 text-white/50" />
            <strong className="text-white">{stats.numPeers}</strong>
            <span className="text-white/40">({stats.activePeers} ativos)</span>
          </span>
          <span className="flex items-center gap-1" title="Tempo estimado restante">
            <Clock className="w-3 h-3 text-white/50" />
            {eta}
          </span>
        </div>
      </div>

      {/* Visualizador de Peças (Swarm Bitfield) */}
      <div className="p-3 sm:p-4 space-y-3">
        <div>
          <div className="flex items-center justify-between text-[11px] mb-1.5">
            <span className="text-white/60 font-semibold uppercase tracking-wider flex items-center gap-1">
              <span>Mapa de Peças (Bitfield)</span>
              {stats.totalPieces ? (
                <span className="text-white/40 font-mono text-[10px]">
                  · {stats.totalPieces} peças
                </span>
              ) : null}
            </span>
            <span className="font-mono text-white/90 font-bold">
              {stats.progress.toFixed(1)}% ({formatBytes(stats.downloaded)} / {formatBytes(stats.length)})
            </span>
          </div>

          {/* Gráfico Segmentado de 60 Blocos */}
          <div
            className="gap-[1.5px] h-4 sm:h-5 p-1 bg-black/40 rounded-lg border border-white/10 overflow-hidden"
            style={{ display: 'grid', gridTemplateColumns: 'repeat(60, minmax(0, 1fr))' }}
          >
            {pieceMap.length > 0 ? (
              pieceMap.map((pct, idx) => {
                let bgClass = 'bg-white/5';
                if (pct >= 90) {
                  bgClass = 'bg-emerald-400 shadow-[0_0_4px_rgba(52,211,153,0.6)]';
                } else if (pct >= 40) {
                  bgClass = 'bg-emerald-500/60';
                } else if (pct > 0) {
                  bgClass = 'bg-sky-400/50 animate-pulse';
                }
                return (
                  <div
                    key={idx}
                    className={`rounded-[1px] transition-colors duration-200 ${bgClass}`}
                    title={`Setor ${idx + 1}/60: ${pct}% baixado`}
                  />
                );
              })
            ) : (
              <div
                className="col-span-60 h-full bg-emerald-500/40 rounded-[2px] transition-all"
                style={{ width: `${Math.min(100, stats.progress)}%` }}
              />
            )}
          </div>
          <div className="flex items-center justify-between text-[9px] text-white/40 mt-1 font-mono">
            <span>Início (Átomo Moov)</span>
            <span>Janela Deslizante de Reprodução</span>
            <span>Final (Índice Cues)</span>
          </div>
        </div>

        {/* Seção Expandida: Perfis de Tracker e Re-try */}
        {isExpanded && (
          <div className="pt-2 border-t border-white/10 space-y-3 animate-in fade-in duration-200">
            <div>
              <label className="text-[10px] font-semibold text-white/50 uppercase tracking-wider block mb-1.5">
                Prioridade de Conexão com Trackers
              </label>
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleSwitchProfile('pt-br-stability')}
                  className={`py-1.5 px-2 rounded-xl text-[11px] font-semibold border transition-all cursor-pointer flex flex-col items-center justify-center ${
                    selectedProfile === 'pt-br-stability'
                      ? 'bg-white text-black font-bold border-white shadow-sm'
                      : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <span>🇧🇷 PT-BR</span>
                  <span className={`text-[9px] ${selectedProfile === 'pt-br-stability' ? 'text-black/70' : 'text-white/40'}`}>
                    Estabilidade
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSwitchProfile('ultra-speed')}
                  className={`py-1.5 px-2 rounded-xl text-[11px] font-semibold border transition-all cursor-pointer flex flex-col items-center justify-center ${
                    selectedProfile === 'ultra-speed'
                      ? 'bg-white text-black font-bold border-white shadow-sm'
                      : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <span>⚡ Ultra</span>
                  <span className={`text-[9px] ${selectedProfile === 'ultra-speed' ? 'text-black/70' : 'text-white/40'}`}>
                    Velocidade
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => handleSwitchProfile('global-balanced')}
                  className={`py-1.5 px-2 rounded-xl text-[11px] font-semibold border transition-all cursor-pointer flex flex-col items-center justify-center ${
                    selectedProfile === 'global-balanced'
                      ? 'bg-white text-black font-bold border-white shadow-sm'
                      : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10'
                  }`}
                >
                  <span>🌐 Global</span>
                  <span className={`text-[9px] ${selectedProfile === 'global-balanced' ? 'text-black/70' : 'text-white/40'}`}>
                    Balanceado
                  </span>
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2 pt-1">
              <button
                type="button"
                onClick={handleRetry}
                disabled={isRetrying || !magnetUri}
                className="flex-1 py-2 px-3 rounded-xl bg-white/10 hover:bg-white/20 active:scale-98 disabled:opacity-50 text-white text-xs font-semibold border border-white/15 transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isRetrying ? 'animate-spin' : ''}`} />
                <span>Forçar Re-try de Peers</span>
              </button>

              <div className="text-[11px] text-white/50 font-mono text-right shrink-0">
                <span>Tentativas: <strong className="text-white">{stats.autoRetryCount}</strong></span>
              </div>
            </div>

            {retryNotice && (
              <p className="text-[11px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg py-1 px-2.5 text-center animate-in fade-in">
                {retryNotice}
              </p>
            )}
          </div>
        )}
      </div>
    </aside>
  );
};
