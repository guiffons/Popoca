/**
 * Popoca Streaming - Cloud Sync & Device Pairing Modal
 * Modal Liquid Glass com suporte de alto contraste para Modo Claro e Modo Escuro.
 */

import React, { useState, useEffect } from 'react';
import {
  Cloud,
  RefreshCw,
  Smartphone,
  Laptop,
  Tv,
  Copy,
  Check,
  X,
  AlertCircle,
  ArrowRight,
  ShieldCheck,
  Download,
  Upload,
  UserCheck
} from 'lucide-react';
import { cloudSync } from '../services/cloudSync.ts';
import { UserAccount } from '../types/index.ts';

interface SyncAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  theme: 'dark' | 'light';
  onSyncCompleted?: () => void;
}

export const SyncAccountModal: React.FC<SyncAccountModalProps> = ({
  isOpen,
  onClose,
  theme,
  onSyncCompleted
}) => {
  const [account, setAccount] = useState<UserAccount>(() => cloudSync.getAccount());
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [syncStatusMsg, setSyncStatusMsg] = useState<string | null>(null);

  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [inputPairCode, setInputPairCode] = useState('');
  const [isRedeemingCode, setIsRedeemingCode] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const [isEditingEmail, setIsEditingEmail] = useState(false);
  const [emailInput, setEmailInput] = useState(account.email);

  useEffect(() => {
    const unsubscribe = cloudSync.subscribe((state) => {
      setAccount(state.account);
      setIsSyncing(state.isSyncing);
      setLastSyncedAt(state.lastSyncedAt);
      if (state.error) {
        setSyncStatusMsg(`Erro: ${state.error}`);
      }
    });
    return unsubscribe;
  }, []);

  if (!isOpen) return null;

  const isLight = theme === 'light';

  const handleSyncNow = async () => {
    setSyncStatusMsg('Sincronizando...');
    const ok = await cloudSync.syncNow();
    if (ok) {
      setSyncStatusMsg('Sincronizado!');
      if (onSyncCompleted) onSyncCompleted();
      setTimeout(() => setSyncStatusMsg(null), 3000);
    } else {
      setSyncStatusMsg('Falha ao sincronizar.');
    }
  };

  const handleGenerateCode = async () => {
    setIsGeneratingCode(true);
    setPairError(null);
    try {
      const code = await cloudSync.generatePairCode();
      setGeneratedCode(code);
    } catch (err: any) {
      setPairError(err.message || 'Erro ao gerar código');
    } finally {
      setIsGeneratingCode(false);
    }
  };

  const handleCopyCode = () => {
    if (!generatedCode) return;
    navigator.clipboard.writeText(generatedCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleRedeemCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputPairCode.trim()) return;
    setIsRedeemingCode(true);
    setPairError(null);
    try {
      const ok = await cloudSync.linkDeviceWithPairCode(inputPairCode.trim());
      if (ok) {
        setSyncStatusMsg('Dispositivo conectado!');
        setInputPairCode('');
        if (onSyncCompleted) onSyncCompleted();
        setTimeout(() => setSyncStatusMsg(null), 3000);
      }
    } catch (err: any) {
      setPairError(err.message || 'Código inválido ou expirado');
    } finally {
      setIsRedeemingCode(false);
    }
  };

  const handleSaveEmail = (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput.trim()) return;
    cloudSync.updateAccount(emailInput.trim());
    setIsEditingEmail(false);
    setSyncStatusMsg('Conta atualizada!');
    setTimeout(() => setSyncStatusMsg(null), 3000);
  };

  const formatLastSync = (ts: number | null) => {
    if (!ts) return 'Pendente';
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 15) return 'Agora mesmo';
    if (diff < 60) return `Há ${diff}s`;
    const mins = Math.floor(diff / 60);
    if (mins < 60) return `Há ${mins}m`;
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const handleExportBackup = () => {
    const data = cloudSync.getLocalState();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `popoca_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportBackup = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const json = JSON.parse(event.target?.result as string);
        cloudSync.applyMergedState(json);
        cloudSync.syncNow();
        setSyncStatusMsg('Backup restaurado!');
        if (onSyncCompleted) onSyncCompleted();
        setTimeout(() => setSyncStatusMsg(null), 3000);
      } catch {
        setSyncStatusMsg('Arquivo inválido.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-xl animate-in fade-in duration-200">
      <div className="w-full max-w-xl rounded-3xl glass-dropdown overflow-hidden flex flex-col max-h-[90vh] text-slate-900 dark:text-white">
        {/* Header */}
        <div className="p-5 sm:p-6 border-b border-slate-200/80 dark:border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg sm:text-xl font-extrabold tracking-tight">Sincronização em Nuvem</h2>
              <p className="text-xs text-slate-500 dark:text-white/50">
                Histórico, avaliações e favoritos sincronizados
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-8 h-8 rounded-full glass-subtle flex items-center justify-center text-slate-600 hover:text-slate-900 dark:text-white/60 dark:hover:text-white transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5">
          <div className="p-4 rounded-2xl glass-subtle">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span className="text-xs font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                    Nuvem Ativa
                  </span>
                </div>
                {!isEditingEmail ? (
                  <div className="flex items-center gap-2 pt-1">
                    <span className="font-semibold text-sm break-all">{account.email}</span>
                    <button
                      type="button"
                      onClick={() => {
                        setEmailInput(account.email);
                        setIsEditingEmail(true);
                      }}
                      className="text-xs text-slate-500 hover:text-slate-900 dark:text-white/60 dark:hover:text-white underline"
                    >
                      Alterar
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSaveEmail} className="flex items-center gap-2 pt-1 flex-wrap">
                    <input
                      type="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      className={`text-xs px-3 py-1.5 rounded-xl border outline-none ${
                        isLight
                          ? 'bg-white border-slate-300 text-slate-900'
                          : 'bg-black/40 border-white/20 text-white'
                      }`}
                      placeholder="seu.email@exemplo.com"
                    />
                    <button
                      type="submit"
                      className="px-3 py-1.5 rounded-full bg-slate-900 text-white dark:bg-white dark:text-black text-xs font-bold"
                    >
                      Salvar
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditingEmail(false)}
                      className="px-2.5 py-1.5 rounded-full text-xs text-slate-500 dark:text-white/60"
                    >
                      Cancelar
                    </button>
                  </form>
                )}
                <div className="text-xs text-slate-500 dark:text-white/50 pt-1 flex items-center gap-1.5">
                  <span>Última sincronização:</span>
                  <span className="font-semibold text-slate-800 dark:text-white/85">
                    {formatLastSync(lastSyncedAt)}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleSyncNow}
                disabled={isSyncing}
                className="flex items-center gap-2 px-4 py-2 rounded-full font-bold text-xs bg-slate-900 text-white dark:bg-white dark:text-black hover:opacity-90 transition-opacity disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Sincronizando...' : 'Sincronizar'}
              </button>
            </div>

            {syncStatusMsg && (
              <div className="mt-3 text-xs px-3 py-2 rounded-xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25 flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>{syncStatusMsg}</span>
              </div>
            )}
          </div>

          {/* Pareamento */}
          <div className="space-y-3.5">
            <div className="flex items-center gap-2 text-sm font-bold">
              <div className="flex items-center gap-1.5 text-slate-500 dark:text-white/50">
                <Laptop className="w-4 h-4" />
                <span>·</span>
                <Smartphone className="w-4 h-4" />
                <span>·</span>
                <Tv className="w-4 h-4" />
              </div>
              <span>Parear Outro Aparelho</span>
            </div>

            <div className="p-4 rounded-2xl glass-subtle space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-white/70">
                    Gerar código deste aparelho
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-white/50 mt-0.5">
                    Código temporário de 6 dígitos válido por 15 minutos
                  </p>
                </div>
                {!generatedCode && (
                  <button
                    type="button"
                    onClick={handleGenerateCode}
                    disabled={isGeneratingCode}
                    className="px-3.5 py-1.5 rounded-full bg-slate-900 text-white dark:bg-white dark:text-black text-xs font-bold shrink-0"
                  >
                    {isGeneratingCode ? 'Gerando...' : 'Gerar'}
                  </button>
                )}
              </div>

              {generatedCode && (
                <div className="flex items-center justify-between p-3 rounded-xl bg-slate-900 text-white dark:bg-black/50 border border-white/10">
                  <span className="font-mono text-xl font-bold tracking-widest text-emerald-400">
                    {generatedCode}
                  </span>
                  <button
                    type="button"
                    onClick={handleCopyCode}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/15 text-white text-xs font-semibold hover:bg-white/25"
                  >
                    {copiedCode ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copiedCode ? 'Copiado' : 'Copiar'}
                  </button>
                </div>
              )}
            </div>

            <div className="p-4 rounded-2xl glass-subtle space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-white/70">
                Inserir código de outro aparelho
              </h4>

              <form onSubmit={handleRedeemCode} className="flex gap-2">
                <input
                  type="text"
                  maxLength={7}
                  value={inputPairCode}
                  onChange={(e) => setInputPairCode(e.target.value.toUpperCase())}
                  placeholder="482-195"
                  className={`flex-1 font-mono text-center tracking-widest text-sm px-3 py-2 rounded-xl border outline-none ${
                    isLight
                      ? 'bg-white border-slate-300 text-slate-900 placeholder-slate-400'
                      : 'bg-black/40 border-white/15 text-white placeholder-white/30'
                  }`}
                />
                <button
                  type="submit"
                  disabled={isRedeemingCode || !inputPairCode.trim()}
                  className="px-4 py-2 rounded-xl bg-slate-900 text-white dark:bg-white dark:text-black disabled:opacity-40 font-bold text-xs flex items-center gap-1.5"
                >
                  {isRedeemingCode ? (
                    <RefreshCw className="w-4 h-4 animate-spin" />
                  ) : (
                    <>
                      <span>Conectar</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </>
                  )}
                </button>
              </form>

              {pairError && (
                <div className="text-xs text-rose-500 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{pairError}</span>
                </div>
              )}
            </div>
          </div>

          {/* Backup Local */}
          <div className="pt-2 border-t border-slate-200/80 dark:border-white/[0.08] flex items-center justify-between text-xs text-slate-500 dark:text-white/50 flex-wrap gap-2">
            <span>Backup JSON:</span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleExportBackup}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-subtle text-slate-800 dark:text-white/80 font-semibold"
              >
                <Download className="w-3.5 h-3.5" />
                Exportar
              </button>
              <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-full glass-subtle text-slate-800 dark:text-white/80 font-semibold cursor-pointer">
                <Upload className="w-3.5 h-3.5" />
                Importar
                <input
                  type="file"
                  accept=".json"
                  onChange={handleImportBackup}
                  className="hidden"
                />
              </label>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-200/80 dark:border-white/[0.08] flex items-center justify-between bg-slate-100/60 dark:bg-black/25">
          <span className="text-xs text-slate-600 dark:text-white/50 flex items-center gap-1.5">
            <UserCheck className="w-3.5 h-3.5 text-emerald-500" />
            Sincronização automática
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-full bg-slate-900 text-white dark:bg-white dark:text-black text-xs font-bold"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
