/**
 * Popoca Streaming - Cloud Sync & Device Pairing Modal
 * Permite ao usuário:
 * 1. Visualizar o status de sincronização em nuvem da conta
 * 2. Forçar sincronização imediata com 1 clique
 * 3. Gerar código de 6 dígitos para parear celular/tablet/Smart TV
 * 4. Inserir código de pareamento de outro dispositivo para migrar o progresso
 * 5. Alterar a conta de e-mail de sincronização
 * 6. Exportar / Importar backup JSON local
 */

import React, { useState, useEffect } from 'react';
import {
  Cloud,
  CloudCheck,
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

  // Pareamento
  const [generatedCode, setGeneratedCode] = useState<string | null>(null);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [inputPairCode, setInputPairCode] = useState('');
  const [isRedeemingCode, setIsRedeemingCode] = useState(false);
  const [pairError, setPairError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  // Troca de e-mail
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
    setSyncStatusMsg('Sincronizando com a nuvem...');
    const ok = await cloudSync.syncNow();
    if (ok) {
      setSyncStatusMsg('Sincronizado com sucesso!');
      if (onSyncCompleted) onSyncCompleted();
      setTimeout(() => setSyncStatusMsg(null), 3000);
    } else {
      setSyncStatusMsg('Falha ao sincronizar. Verifique a conexão.');
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
        setSyncStatusMsg('Dispositivo conectado com sucesso!');
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
    setSyncStatusMsg('Conta atualizada! Sincronizando dados...');
    setTimeout(() => setSyncStatusMsg(null), 3000);
  };

  const formatLastSync = (ts: number | null) => {
    if (!ts) return 'Pendente';
    const diff = Math.floor((Date.now() - ts) / 1000);
    if (diff < 15) return 'Agora mesmo';
    if (diff < 60) return `Há ${diff} segundos`;
    const mins = Math.floor(diff / 60);
    if (mins < 60) return `Há ${mins} minuto${mins > 1 ? 's' : ''}`;
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
        setSyncStatusMsg('Backup restaurado e sincronizado!');
        if (onSyncCompleted) onSyncCompleted();
        setTimeout(() => setSyncStatusMsg(null), 3000);
      } catch (err) {
        setSyncStatusMsg('Arquivo de backup inválido.');
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div
        className={`w-full max-w-xl rounded-2xl border shadow-2xl overflow-hidden flex flex-col max-h-[90vh] ${
          isLight
            ? 'bg-white border-zinc-200 text-zinc-900'
            : 'bg-[#12151D] border-white/10 text-white'
        }`}
      >
        {/* Header */}
        <div className="p-6 border-b border-white/[0.08] flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Cloud className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-xl font-bold tracking-tight">Sincronização em Nuvem</h2>
              <p className="text-xs text-zinc-400">
                Acesse seu histórico, avaliações e favoritos em qualquer aparelho
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corpo com Scroll */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Card de Status da Conta */}
          <div
            className={`p-4 rounded-xl border ${
              isLight ? 'bg-zinc-50 border-zinc-200' : 'bg-white/[0.03] border-white/10'
            }`}
          >
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                  </span>
                  <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                    Nuvem Conectada
                  </span>
                </div>
                {!isEditingEmail ? (
                  <div className="flex items-center gap-2 pt-1">
                    <span className="font-semibold text-sm sm:text-base break-all">
                      {account.email}
                    </span>
                    <button
                      onClick={() => {
                        setEmailInput(account.email);
                        setIsEditingEmail(true);
                      }}
                      className="text-xs text-blue-400 hover:underline ml-1"
                    >
                      Alterar
                    </button>
                  </div>
                ) : (
                  <form onSubmit={handleSaveEmail} className="flex items-center gap-2 pt-1">
                    <input
                      type="email"
                      value={emailInput}
                      onChange={(e) => setEmailInput(e.target.value)}
                      className={`text-xs px-2.5 py-1.5 rounded-lg border outline-none ${
                        isLight
                          ? 'bg-white border-zinc-300 text-zinc-900'
                          : 'bg-black/40 border-white/20 text-white'
                      }`}
                      placeholder="seu.email@exemplo.com"
                    />
                    <button
                      type="submit"
                      className="px-2.5 py-1.5 rounded-lg bg-emerald-500 text-black text-xs font-bold hover:bg-emerald-400"
                    >
                      Salvar
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsEditingEmail(false)}
                      className="px-2 py-1.5 rounded-lg bg-white/10 text-xs hover:bg-white/20"
                    >
                      Cancelar
                    </button>
                  </form>
                )}
                <div className="text-xs text-zinc-400 pt-1 flex items-center gap-2">
                  <span>Última sincronização:</span>
                  <span className="font-medium text-zinc-200">
                    {formatLastSync(lastSyncedAt)}
                  </span>
                </div>
              </div>

              {/* Botão de Sync Manual */}
              <button
                onClick={handleSyncNow}
                disabled={isSyncing}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium text-xs transition-all ${
                  isSyncing
                    ? 'opacity-70 cursor-not-allowed bg-zinc-700'
                    : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30'
                }`}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
                {isSyncing ? 'Sincronizando...' : 'Sincronizar'}
              </button>
            </div>

            {syncStatusMsg && (
              <div className="mt-3 text-xs px-3 py-2 rounded-lg bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 flex items-center gap-2 animate-in fade-in">
                <ShieldCheck className="w-4 h-4 shrink-0" />
                <span>{syncStatusMsg}</span>
              </div>
            )}
          </div>

          {/* Seção de Conectar Outro Dispositivo (Pareamento de 6 dígitos) */}
          <div className="space-y-4">
            <div className="flex items-center gap-2 text-sm font-semibold">
              <div className="flex items-center gap-1.5 text-zinc-400">
                <Laptop className="w-4 h-4" />
                <span>+</span>
                <Smartphone className="w-4 h-4" />
                <span>+</span>
                <Tv className="w-4 h-4" />
              </div>
              <span className="ml-2">Conectar Outro Aparelho</span>
            </div>

            {/* Gerar Código para Outro Dispositivo */}
            <div
              className={`p-4 rounded-xl border space-y-3 ${
                isLight ? 'bg-zinc-50 border-zinc-200' : 'bg-white/[0.02] border-white/10'
              }`}
            >
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                    Opção 1: Espelhar Este Dispositivo
                  </h4>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    Gere um código de 6 dígitos para usar no celular, tablet ou TV.
                  </p>
                </div>
                {!generatedCode && (
                  <button
                    onClick={handleGenerateCode}
                    disabled={isGeneratingCode}
                    className="px-3 py-1.5 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-medium transition-colors"
                  >
                    {isGeneratingCode ? 'Gerando...' : 'Gerar Código'}
                  </button>
                )}
              </div>

              {generatedCode && (
                <div className="flex items-center justify-between p-3 rounded-xl bg-black/40 border border-white/10">
                  <div>
                    <span className="text-xs text-zinc-400 block">Código Temporário (15 min):</span>
                    <span className="font-mono text-2xl font-bold tracking-widest text-emerald-400">
                      {generatedCode}
                    </span>
                  </div>
                  <button
                    onClick={handleCopyCode}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30 text-xs transition-colors"
                  >
                    {copiedCode ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    {copiedCode ? 'Copiado!' : 'Copiar'}
                  </button>
                </div>
              )}
            </div>

            {/* Inserir Código de Outro Dispositivo */}
            <div
              className={`p-4 rounded-xl border space-y-3 ${
                isLight ? 'bg-zinc-50 border-zinc-200' : 'bg-white/[0.02] border-white/10'
              }`}
            >
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                  Opção 2: Conectar com Código de Outro Aparelho
                </h4>
                <p className="text-xs text-zinc-400 mt-0.5">
                  Digite o código exibido na tela do seu outro dispositivo.
                </p>
              </div>

              <form onSubmit={handleRedeemCode} className="flex gap-2">
                <input
                  type="text"
                  maxLength={7}
                  value={inputPairCode}
                  onChange={(e) => setInputPairCode(e.target.value.toUpperCase())}
                  placeholder="EX: 482-195"
                  className={`flex-1 font-mono text-center tracking-widest text-base px-3 py-2 rounded-xl border outline-none ${
                    isLight
                      ? 'bg-white border-zinc-300 text-zinc-900 placeholder-zinc-400'
                      : 'bg-black/40 border-white/20 text-white placeholder-zinc-600'
                  }`}
                />
                <button
                  type="submit"
                  disabled={isRedeemingCode || !inputPairCode.trim()}
                  className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 disabled:opacity-50 text-black font-bold text-xs flex items-center gap-1.5 transition-colors"
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
                <div className="text-xs text-rose-400 flex items-center gap-1.5">
                  <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                  <span>{pairError}</span>
                </div>
              )}
            </div>
          </div>

          {/* Exportação & Importação de Backup Local */}
          <div className="pt-2 border-t border-white/[0.08] flex items-center justify-between text-xs text-zinc-400">
            <span>Backup de Segurança Local:</span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleExportBackup}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 transition-colors"
              >
                <Download className="w-3.5 h-3.5" />
                Exportar JSON
              </button>
              <label className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white/5 hover:bg-white/10 text-zinc-300 cursor-pointer transition-colors">
                <Upload className="w-3.5 h-3.5" />
                Importar JSON
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

        {/* Rodapé */}
        <div className="p-4 border-t border-white/[0.08] flex items-center justify-between bg-black/20">
          <span className="text-xs text-zinc-400 flex items-center gap-1.5">
            <UserCheck className="w-3.5 h-3.5 text-emerald-400" />
            Progresso salvo automaticamente
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-xs font-semibold transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
