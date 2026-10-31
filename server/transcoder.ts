/**
 * Popoca Streaming - FFmpeg Prioritized Real-Time Transcoder & Queue Manager
 * Gerencia processos FFmpeg via fluent-ffmpeg com fila de priorização (Priority Queue),
 * flags de performance de baixa latência (-preset ultrafast, -tune zerolatency, -threads 2),
 * limite de concorrência e destruição imediata de streams e processos ao fechar conexão.
 */

import ffmpeg from 'fluent-ffmpeg';
import { Readable, Writable } from 'stream';

export interface TranscodeJobOptions {
  seekSeconds?: number;
  audioOnly?: boolean;
  priority?: number; // 1 = Alta (streaming interativo do usuário), 2 = Normal
  jobId?: string;
  onCancel?: () => void;
}

interface QueuedJob {
  id: string;
  priority: number;
  createdAt: number;
  inputStream: Readable;
  outputDestination: Writable;
  options: TranscodeJobOptions;
  command?: ffmpeg.FfmpegCommand;
  isStarted: boolean;
  isDestroyed: boolean;
}

export class TranscoderQueueManager {
  private activeJobs: Map<string, QueuedJob> = new Map();
  private queue: QueuedJob[] = [];
  private readonly maxConcurrent: number = 2; // Evita saturação de CPU em múltiplos acessos
  private jobCounter: number = 0;

  /**
   * Determina se o arquivo já possui contêiner e formato nativo para o navegador
   */
  isWebNative(fileName: string): boolean {
    const ext = fileName.toLowerCase().split('.').pop() || '';
    return ['mp4', 'm4v', 'webm'].includes(ext);
  }

  /**
   * Adiciona uma tarefa de transcodificação à fila de priorização
   */
  transcodeStream(
    inputStream: Readable,
    outputDestination: Writable,
    options: TranscodeJobOptions = {}
  ): { id: string; cancel: () => void; getCommand: () => ffmpeg.FfmpegCommand | undefined } {
    this.jobCounter += 1;
    const jobId = options.jobId || `transcode-${this.jobCounter}-${Date.now()}`;
    const priority = options.priority !== undefined ? options.priority : 1;

    const job: QueuedJob = {
      id: jobId,
      priority,
      createdAt: Date.now(),
      inputStream,
      outputDestination,
      options,
      isStarted: false,
      isDestroyed: false
    };

    // Insere ordenado por prioridade (menor número = maior prioridade) e timestamp
    this.queue.push(job);
    this.queue.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.createdAt - b.createdAt;
    });

    console.log(`[TranscoderQueue] Job ${jobId} enfileirado com prioridade ${priority}. Fila atual: ${this.queue.length}, Ativos: ${this.activeJobs.size}`);

    this.processQueue();

    // Retorna interface de controle para destruição e cancelamento imediato
    return {
      id: jobId,
      cancel: () => this.cancelJob(jobId),
      getCommand: () => job.command
    };
  }

  /**
   * Processa o próximo job da fila se houver capacidade disponível
   */
  private processQueue() {
    if (this.activeJobs.size >= this.maxConcurrent) {
      return;
    }

    const nextJob = this.queue.shift();
    if (!nextJob) return;

    if (nextJob.isDestroyed) {
      this.processQueue();
      return;
    }

    this.startJob(nextJob);
  }

  /**
   * Inicia o processo FFmpeg com as flags de altíssimo desempenho exigidas
   */
  private startJob(job: QueuedJob) {
    job.isStarted = true;
    this.activeJobs.set(job.id, job);

    console.log(`[TranscoderQueue] Iniciando job FFmpeg ${job.id} (Ativos: ${this.activeJobs.size}/${this.maxConcurrent})`);

    const command = ffmpeg(job.inputStream);
    job.command = command;

    if (job.options.seekSeconds && job.options.seekSeconds > 0) {
      command.seekInput(job.options.seekSeconds);
    }

    if (job.options.audioOnly) {
      // Modo Somente Áudio: AAC ultra-leve com streaming nativo
      command
        .noVideo()
        .audioCodec('aac')
        .audioBitrate('128k')
        .audioChannels(2)
        .format('adts');
    } else {
      // Remuxing ultra-rápido com cópia direta do fluxo de vídeo (-c:v copy) para eliminar gargalo de CPU e travamentos
      command
        .videoCodec('copy')
        .outputOptions([
          '-sn', // Ignora legendas embutidas para evitar corrupção de streaming
          '-movflags frag_keyframe+empty_moov+default_base_moof'
        ])
        .audioCodec('aac')
        .audioBitrate('192k')
        .audioChannels(2)
        .format('mp4');
    }

    command.on('start', (cmdline) => {
      console.log(`[Transcoder FFmpeg] Job ${job.id} rodando: ${cmdline.slice(0, 80)}...`);
    });

    command.on('error', (err) => {
      if (err.message && (err.message.includes('SIGKILL') || err.message.includes('Output stream closed'))) {
        console.log(`[Transcoder FFmpeg] Job ${job.id} encerrado pelo cliente.`);
      } else {
        console.warn(`[Transcoder FFmpeg] Aviso no Job ${job.id}:`, err.message);
      }
      this.finalizeJob(job.id);
    });

    command.on('end', () => {
      console.log(`[Transcoder FFmpeg] Job ${job.id} finalizado.`);
      this.finalizeJob(job.id);
    });

    command.pipe(job.outputDestination, { end: true });
  }

  /**
   * Cancela e destrói imediatamente o processo FFmpeg e libera recursos
   */
  cancelJob(jobId: string) {
    // 1. Se estiver na fila pendente, remove
    const queueIdx = this.queue.findIndex(j => j.id === jobId);
    if (queueIdx !== -1) {
      const [removed] = this.queue.splice(queueIdx, 1);
      removed.isDestroyed = true;
      try { removed.inputStream.destroy(); } catch {}
      removed.options.onCancel?.();
      console.log(`[TranscoderQueue] Job ${jobId} removido da fila antes de iniciar.`);
      return;
    }

    // 2. Se estiver em execução ativa, mata o processo imediatamente com SIGKILL
    const active = this.activeJobs.get(jobId);
    if (active) {
      active.isDestroyed = true;
      try {
        if (active.command) {
          active.command.kill('SIGKILL');
        }
      } catch (err) {
        // no-op
      }
      try {
        active.inputStream.destroy();
      } catch {}

      active.options.onCancel?.();
      this.activeJobs.delete(jobId);
      console.log(`[TranscoderQueue] Job ativo ${jobId} cancelado e destruído com SIGKILL.`);
      this.processQueue();
    }
  }

  /**
   * Finaliza o job e aloca o próximo da fila
   */
  private finalizeJob(jobId: string) {
    const job = this.activeJobs.get(jobId);
    if (job) {
      job.isDestroyed = true;
      try { job.inputStream.destroy(); } catch {}
      this.activeJobs.delete(jobId);
      this.processQueue();
    }
  }

  /**
   * Retorna estatísticas da fila
   */
  getStats() {
    return {
      activeCount: this.activeJobs.size,
      queuedCount: this.queue.length,
      maxConcurrent: this.maxConcurrent
    };
  }
}

export const transcoder = new TranscoderQueueManager();
