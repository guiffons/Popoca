/**
 * Popoca Streaming - Global Drag & Drop + Clipboard Magnet Listener
 * Permite arrastar arquivos .torrent para qualquer lugar da janela ou colar links magnet:?
 * com processamento instantâneo e início de streaming sem atritos.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { DownloadCloud, Magnet, Play, X, Upload, Loader2, Sparkles, FileVideo } from 'lucide-react';
import { api } from '../services/api.ts';

interface TorrentDropZoneProps {
  onPlayCustomTorrent: (params: { magnetUri: string; title: string }) => void;
  isModalOpen?: boolean;
  onCloseModal?: () => void;
}

export const TorrentDropZone: React.FC<TorrentDropZoneProps> = ({
  onPlayCustomTorrent,
  isModalOpen = false,
  onCloseModal
}) => {
  const [isDraggingOver, setIsDraggingOver] = useState<boolean>(false);
  const [isProcessing, setIsProcessing] = useState<boolean>(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Modal para magnet colado ou inserido manualmente
  const [manualMagnetInput, setManualMagnetInput] = useState<string>('');
  const [detectedMagnet, setDetectedMagnet] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragCounterRef = useRef<number>(0);

  const processFile = useCallback(
    async (file: File) => {
      if (!file.name.endsWith('.torrent') && !file.type.includes('torrent')) {
        setErrorMessage('Por favor, envie um arquivo com extensão .torrent');
        setTimeout(() => setErrorMessage(null), 4000);
        return;
      }

      setIsProcessing(true);
      setStatusMessage(`Lendo arquivo .torrent: ${file.name}...`);

      try {
        const reader = new FileReader();
        const base64Promise = new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const result = reader.result as string;
            const base64 = result.split(',')[1] || result;
            resolve(base64);
          };
          reader.onerror = reject;
        });
        reader.readAsDataURL(file);

        const base64 = await base64Promise;
        setStatusMessage('Extraindo metadados do torrent...');
        const res = await api.uploadTorrentFile(base64, file.name);

        if (res.success && res.magnetUri) {
          setStatusMessage('Iniciando reprodução...');
          onPlayCustomTorrent({
            magnetUri: res.magnetUri,
            title: res.name || file.name.replace(/\.torrent$/i, '')
          });
          if (onCloseModal) onCloseModal();
        } else {
          setErrorMessage(res.error || 'Não foi possível ler este arquivo .torrent.');
        }
      } catch (err: any) {
        setErrorMessage(err?.message || 'Erro ao processar arquivo torrent.');
      } finally {
        setIsProcessing(false);
        setTimeout(() => {
          setStatusMessage(null);
          setErrorMessage(null);
        }, 5000);
      }
    },
    [onPlayCustomTorrent, onCloseModal]
  );

  const handleProcessMagnet = useCallback(
    (magnetUri: string) => {
      const trimmed = magnetUri.trim();
      if (!trimmed.startsWith('magnet:?')) {
        setErrorMessage('O link deve começar com magnet:?');
        return;
      }
      if (!/xt=urn:btih:/i.test(trimmed)) {
        setErrorMessage('Magnet URI inválido (falta xt=urn:btih:).');
        return;
      }

      // Extrai nome do magnet (&dn=...) se existir
      const nameMatch = trimmed.match(/dn=([^&]+)/i);
      const title = nameMatch ? decodeURIComponent(nameMatch[1].replace(/\+/g, ' ')) : 'Torrent Externo';

      setDetectedMagnet(null);
      setManualMagnetInput('');
      if (onCloseModal) onCloseModal();

      onPlayCustomTorrent({
        magnetUri: trimmed,
        title
      });
    },
    [onPlayCustomTorrent, onCloseModal]
  );

  // Listener Global de Arrastar e Soltar na Janela
  useEffect(() => {
    const handleDragEnter = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current += 1;
      if (e.dataTransfer && e.dataTransfer.types.includes('Files')) {
        setIsDraggingOver(true);
      }
    };

    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };

    const handleDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current -= 1;
      if (dragCounterRef.current <= 0) {
        dragCounterRef.current = 0;
        setIsDraggingOver(false);
      }
    };

    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounterRef.current = 0;
      setIsDraggingOver(false);

      if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        const file = e.dataTransfer.files[0];
        processFile(file);
        return;
      }

      // Se arrastou texto puro (ex: link magnet solto na tela)
      const text = e.dataTransfer?.getData('text');
      if (text && text.trim().startsWith('magnet:?')) {
        handleProcessMagnet(text.trim());
      }
    };

    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('drop', handleDrop);

    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('drop', handleDrop);
    };
  }, [processFile, handleProcessMagnet]);

  // Listener Global de Paste (Ctrl+V / Cmd+V)
  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
      // Ignora se o usuário estiver digitando em campo de texto normal
      const activeEl = document.activeElement;
      if (
        activeEl &&
        (activeEl.tagName === 'INPUT' ||
          activeEl.tagName === 'TEXTAREA' ||
          (activeEl as HTMLElement).isContentEditable)
      ) {
        return;
      }

      const text = e.clipboardData?.getData('text') || '';
      if (text.trim().startsWith('magnet:?')) {
        e.preventDefault();
        setDetectedMagnet(text.trim());
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, []);

  return (
    <>
      {/* Overlay Global de Drag and Drop em Tela Cheia */}
      {isDraggingOver && (
        <div className="fixed inset-0 z-[100] bg-black/85 backdrop-blur-xl flex flex-col items-center justify-center p-6 text-white animate-in fade-in duration-200 pointer-events-none">
          <div className="max-w-md w-full border-2 border-dashed border-white/40 rounded-3xl p-10 flex flex-col items-center text-center space-y-4 bg-white/[0.04] shadow-2xl">
            <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center text-white animate-bounce">
              <DownloadCloud className="w-10 h-10" />
            </div>
            <div className="space-y-1">
              <h2 className="text-xl sm:text-2xl font-extrabold tracking-tight">
                Solte o arquivo .torrent aqui
              </h2>
              <p className="text-xs sm:text-sm text-white/70">
                O Popoca processará o torrent e iniciará o streaming imediatamente.
              </p>
            </div>
            <div className="flex items-center gap-2 text-[11px] font-mono text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-3 py-1.5 rounded-full">
              <Sparkles className="w-3.5 h-3.5" />
              <span>Transmissão P2P com buffer sequencial ultrarrápido</span>
            </div>
          </div>
        </div>
      )}

      {/* Banner de Processamento */}
      {isProcessing && (
        <div className="fixed bottom-6 right-6 z-[90] glass-panel p-4 rounded-2xl border border-white/20 text-white shadow-2xl flex items-center gap-3 animate-in slide-in-from-bottom duration-300">
          <Loader2 className="w-5 h-5 animate-spin text-white" />
          <div className="text-xs">
            <p className="font-bold">{statusMessage || 'Processando torrent...'}</p>
            <p className="text-white/50 text-[11px]">Conectando aos enxames de alta velocidade</p>
          </div>
        </div>
      )}

      {/* Alerta de Magnet Detectado no Clipboard */}
      {detectedMagnet && (
        <div className="fixed inset-0 z-[95] bg-black/70 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in">
          <div className="max-w-md w-full glass-panel p-6 rounded-3xl border border-white/20 text-white shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center border border-purple-500/30">
                  <Magnet className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">Link Magnet Detectado</h3>
                  <p className="text-[11px] text-white/50">Copiado da sua área de transferência</p>
                </div>
              </div>
              <button
                onClick={() => setDetectedMagnet(null)}
                className="p-1.5 rounded-full hover:bg-white/10 text-white/60 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="bg-black/40 border border-white/10 rounded-xl p-3 font-mono text-[11px] text-white/70 break-all max-h-24 overflow-y-auto">
              {detectedMagnet}
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => handleProcessMagnet(detectedMagnet)}
                className="flex-1 py-2.5 px-4 bg-white hover:bg-neutral-200 text-black font-extrabold text-xs rounded-xl shadow-md transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Reproduzir Agora</span>
              </button>
              <button
                onClick={() => setDetectedMagnet(null)}
                className="py-2.5 px-4 glass-subtle hover:bg-white/10 text-white text-xs font-semibold rounded-xl border border-white/10 transition-colors"
              >
                Ignorar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Manual de Abrir Magnet / Torrent (acessível pelo botão na Navbar) */}
      {isModalOpen && (
        <div
          onClick={onCloseModal}
          className="fixed inset-0 z-[85] bg-black/75 backdrop-blur-md flex items-center justify-center p-4 animate-in fade-in"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-w-lg w-full bg-[#10141D] border border-white/20 rounded-3xl p-6 text-white shadow-2xl space-y-4 animate-in zoom-in-95 duration-200"
          >
            <div className="flex items-center justify-between border-b border-white/10 pb-3">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-white/10 text-white flex items-center justify-center">
                  <FileVideo className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-sm font-bold">Abrir Magnet ou Arquivo .Torrent</h3>
                  <p className="text-[11px] text-white/50">Streaming P2P direto no seu navegador</p>
                </div>
              </div>
              {onCloseModal && (
                <button
                  onClick={onCloseModal}
                  className="p-1.5 rounded-full hover:bg-white/10 text-white/60 hover:text-white cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>

            {/* Opção 1: Arrastar ou Selecionar Arquivo do Disco */}
            <div>
              <label className="text-[11px] font-semibold text-white/60 uppercase tracking-wider block mb-2">
                1. Arquivo do Computador (.torrent)
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".torrent,application/x-bittorrent"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    processFile(e.target.files[0]);
                  }
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full py-4 border-2 border-dashed border-white/20 hover:border-white/40 rounded-2xl bg-white/[0.03] hover:bg-white/[0.06] transition-all flex flex-col items-center justify-center gap-2 cursor-pointer text-white/80 hover:text-white"
              >
                <Upload className="w-6 h-6 text-white/60" />
                <span className="text-xs font-semibold">Clique para escolher um arquivo .torrent</span>
                <span className="text-[10px] text-white/40">ou arraste e solte na janela a qualquer momento</span>
              </button>
            </div>

            {/* Opção 2: Colar Magnet Link */}
            <div>
              <label className="text-[11px] font-semibold text-white/60 uppercase tracking-wider block mb-2">
                2. Ou Cole um Magnet Link (magnet:?xt=urn:btih:...)
              </label>
              <textarea
                rows={3}
                placeholder="magnet:?xt=urn:btih:..."
                value={manualMagnetInput}
                onChange={(e) => {
                  setManualMagnetInput(e.target.value);
                  setErrorMessage(null);
                }}
                className="w-full text-xs font-mono p-3 rounded-xl bg-black/40 border border-white/15 text-white placeholder-white/30 focus:outline-none focus:border-white/40 resize-none"
              />
            </div>

            {errorMessage && (
              <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/20 rounded-xl p-2.5">
                {errorMessage}
              </p>
            )}

            <div className="flex gap-2 pt-2 border-t border-white/10">
              <button
                type="button"
                onClick={() => handleProcessMagnet(manualMagnetInput)}
                disabled={!manualMagnetInput.trim()}
                className="flex-1 py-2.5 px-4 bg-white hover:bg-neutral-200 disabled:opacity-40 text-black font-extrabold text-xs rounded-xl shadow-md transition-colors flex items-center justify-center gap-2 cursor-pointer"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>Iniciar Reprodução</span>
              </button>
              {onCloseModal && (
                <button
                  type="button"
                  onClick={onCloseModal}
                  className="py-2.5 px-4 glass-subtle hover:bg-white/10 text-white text-xs font-semibold rounded-xl border border-white/10 transition-colors cursor-pointer"
                >
                  Cancelar
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
};
