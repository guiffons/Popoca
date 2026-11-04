/**
 * Popoca Streaming - FFmpeg Prioritized Real-Time Transcoder & Queue Manager
 * - Probe ultrarrápido de cabeçalho em memória (~40ms) para detectar faixa exata PT-BR e codec real (H.264 vs HEVC/10-bit)
 * - Micro-fragmentação fMP4 de 0.4s (-frag_duration 400000) eliminando congelamento de 10s no início do filme
 * - Sincronismo labial A/V exato em seeks longos (-noaccurate_seek + -avoid_negative_ts make_zero + aresample=async=1)
 */

import ffmpeg from 'fluent-ffmpeg';
import { spawn } from 'child_process';
import { createRequire } from 'module';
import { Readable, Writable } from 'stream';

const require = createRequire(import.meta.url);

let resolvedFfmpegPath = 'ffmpeg';
try {
  const ffmpegInstaller = require('@ffmpeg-installer/ffmpeg');
  if (ffmpegInstaller?.path) {
    resolvedFfmpegPath = ffmpegInstaller.path;
    ffmpeg.setFfmpegPath(resolvedFfmpegPath);
    console.log(`[Transcoder] FFmpeg nativo pronto: ${resolvedFfmpegPath}`);
  }
} catch {
  console.warn('[Transcoder] @ffmpeg-installer/ffmpeg indisponível; usando ffmpeg do PATH.');
}

export interface ProbedAudioTrack {
  aIndex: number;
  lang: string;
  title: string;
  codec: string;
  channels: number;
}

export interface ProbedMediaInfo {
  videoCodec: string;
  is10Bit: boolean;
  audioTracks: ProbedAudioTrack[];
  hasPortugueseAudioTrack?: boolean;
}

export interface TranscodeJobOptions {
  seekSeconds?: number;
  audioOnly?: boolean;
  preferPortugueseAudio?: boolean;
  audioTrackIndex?: number;
  probedInfo?: ProbedMediaInfo | null;
  sourceFileName?: string;
  priority?: number;
  jobId?: string;
  onCancel?: () => void;
}

interface QueuedJob {
  id: string;
  priority: number;
  createdAt: number;
  inputSource: Readable | string;
  outputDestination: Writable;
  options: TranscodeJobOptions;
  command?: ffmpeg.FfmpegCommand;
  isStarted: boolean;
  isDestroyed: boolean;
}

export class TranscoderQueueManager {
  private activeJobs: Map<string, QueuedJob> = new Map();
  private queue: QueuedJob[] = [];
  private readonly maxConcurrent: number = 5;
  private jobCounter: number = 0;

  isWebNative(fileName: string): boolean {
    const ext = fileName.toLowerCase().split('.').pop() || '';
    return ['mp4', 'm4v', 'webm'].includes(ext);
  }

  /**
   * Inspeciona os primeiros ~128KB do contêiner em memória (~40ms) para identificar
   * todas as trilhas de áudio (ex: Português vs Inglês em Dual Áudio) e se o vídeo é HEVC/10-bit.
   */
  probeBufferStreams(headerBuffer: Buffer): Promise<ProbedMediaInfo | null> {
    return new Promise((resolve) => {
      if (!headerBuffer || headerBuffer.length < 4096) {
        resolve(null);
        return;
      }

      let settled = false;
      const done = (val: ProbedMediaInfo | null) => {
        if (settled) return;
        settled = true;
        resolve(val);
      };

      try {
        const proc = spawn(resolvedFfmpegPath, [
          '-hide_banner',
          '-probesize',
          String(Math.min(headerBuffer.length, 262144)),
          '-analyzeduration',
          '0',
          '-i',
          'pipe:0'
        ]);

        let stderr = '';
        const safetyTimer = setTimeout(() => {
          try {
            proc.kill('SIGKILL');
          } catch {}
          done(null);
        }, 1600);

        proc.stderr.on('data', (chunk) => {
          stderr += chunk.toString();
        });

        proc.on('error', () => {
          clearTimeout(safetyTimer);
          done(null);
        });

        proc.on('close', () => {
          clearTimeout(safetyTimer);
          done(this.parseFfmpegStderrProbe(stderr));
        });

        proc.stdin.on('error', () => {});
        proc.stdin.end(headerBuffer);
      } catch {
        done(null);
      }
    });
  }

  private parseFfmpegStderrProbe(stderr: string): ProbedMediaInfo | null {
    if (!stderr) return null;
    const lines = stderr.split(/\r?\n/);

    let videoCodec = 'h264';
    let is10Bit = false;
    const audioTracks: ProbedAudioTrack[] = [];
    let currentAudioTrack: ProbedAudioTrack | null = null;

    for (const line of lines) {
      const streamMatch = line.match(
        /Stream #0:\d+(?:\(([a-zA-Z0-9_-]+)\))?(?:\[[^\]]+\])?:\s*(Video|Audio|Subtitle):\s*([a-zA-Z0-9_]+)(.*)/
      );
      if (streamMatch) {
        const lang = (streamMatch[1] || 'und').toLowerCase();
        const kind = streamMatch[2];
        const codec = (streamMatch[3] || '').toLowerCase();
        const rest = streamMatch[4] || '';

        if (kind === 'Video') {
          currentAudioTrack = null;
          videoCodec = codec;
          if (/10le|10be|10-bit|p010/i.test(rest)) {
            is10Bit = true;
          }
        } else if (kind === 'Audio') {
          const channels = /5\.1|6 channels/i.test(rest)
            ? 6
            : /7\.1|8 channels/i.test(rest)
            ? 8
            : /mono|1 channels/i.test(rest)
            ? 1
            : 2;
          currentAudioTrack = {
            aIndex: audioTracks.length,
            lang,
            title: '',
            codec,
            channels
          };
          audioTracks.push(currentAudioTrack);
        } else {
          currentAudioTrack = null;
        }
        continue;
      }

      if (currentAudioTrack) {
        const titleMatch = line.match(/^\s*title\s*:\s*(.+)$/i);
        if (titleMatch) {
          currentAudioTrack.title = titleMatch[1].trim();
        }
      }
    }

    const hasPortugueseAudioTrack = audioTracks.some(
      (t) =>
        /^(por|pt|pt-br|pob|pb)$/i.test(t.lang) ||
        /(portug|dublado|\bdub\b|pt-br|ptbr|brasil|nacional)/i.test(t.title)
    );

    return { videoCodec, is10Bit, audioTracks, hasPortugueseAudioTrack };
  }

  private resolveAudioSelection(options: TranscodeJobOptions): {
    audioIndex: number;
    canCopyAudio: boolean;
  } {
    const info = options.probedInfo;
    const tracks = info?.audioTracks || [];

    if (typeof options.audioTrackIndex === 'number' && options.audioTrackIndex >= 0) {
      const clamped =
        tracks.length > 0 ? Math.min(options.audioTrackIndex, tracks.length - 1) : options.audioTrackIndex;
      const found = tracks[clamped];
      return {
        audioIndex: clamped,
        canCopyAudio: Boolean(found && found.codec === 'aac' && found.channels <= 2 && !options.seekSeconds)
      };
    }

    if (tracks.length === 0) {
      return { audioIndex: 0, canCopyAudio: false };
    }

    const preferPt = options.preferPortugueseAudio !== false;
    let chosen = tracks[0];

    if (preferPt) {
      const ptMatch = tracks.find(
        (t) =>
          /^(por|pt|pt-br|pob|pb)$/i.test(t.lang) ||
          /(portug|dublado|\bdub\b|pt-br|ptbr|brasil|nacional)/i.test(t.title)
      );
      if (ptMatch) {
        chosen = ptMatch;
      } else if (
        tracks.length >= 2 &&
        /^(eng|en|jpn|ja)$/i.test(tracks[0].lang) &&
        tracks[1].lang === 'und' &&
        /dublado|\bdual\b|pt-br/i.test(options.sourceFileName || '')
      ) {
        // Caso clássico de Dual Áudio onde a trilha 0 está marcada 'eng' e a trilha 1 dublada ficou 'und'
        chosen = tracks[1];
      }
    } else {
      const origMatch = tracks.find(
        (t) =>
          /^(eng|en|jpn|ja|kor|ko|spa|fra|ita|deu)$/i.test(t.lang) ||
          /(original|english|ingl[eê]s|japanese|japon[eê]s)/i.test(t.title)
      );
      if (origMatch) chosen = origMatch;
    }

    return {
      audioIndex: chosen.aIndex,
      canCopyAudio: Boolean(chosen.codec === 'aac' && chosen.channels <= 2 && !options.seekSeconds)
    };
  }

  transcodeStream(
    inputSource: Readable | string,
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
      inputSource,
      outputDestination,
      options,
      isStarted: false,
      isDestroyed: false
    };

    this.queue.push(job);
    this.queue.sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.createdAt - b.createdAt;
    });

    this.processQueue();

    return {
      id: jobId,
      cancel: () => this.cancelJob(jobId),
      getCommand: () => job.command
    };
  }

  private processQueue() {
    while (this.activeJobs.size < this.maxConcurrent && this.queue.length > 0) {
      const nextJob = this.queue.shift();
      if (!nextJob || nextJob.isDestroyed) continue;
      this.startJob(nextJob);
    }
  }

  private startJob(job: QueuedJob) {
    job.isStarted = true;
    this.activeJobs.set(job.id, job);

    const probed = job.options.probedInfo;
    const probedNeedsReencode = probed
      ? probed.videoCodec !== 'h264' || probed.is10Bit
      : /(hevc|x265|h\.?265|10\s*-?bits?|av1)/i.test(job.options.sourceFileName || '');

    const isHttpInput = typeof job.inputSource === 'string';
    const seekSec =
      job.options.seekSeconds && job.options.seekSeconds > 0 ? job.options.seekSeconds : 0;

    // Ordem exata antes do -i:
    // -noaccurate_seek garante que vídeo (-c:v copy) e áudio (-c:a aac) partam JUNTOS do mesmo keyframe
    // eliminando o atraso de áudio e o congelamento de 7-10s após avançar o filme!
    const inOpts: string[] = [];
    if (seekSec > 0) {
      inOpts.push('-noaccurate_seek', '-ss', seekSec.toFixed(2));
    }
    inOpts.push('-fflags', '+discardcorrupt+nobuffer+genpts');
    if (isHttpInput) {
      inOpts.push('-seekable', '1', '-reconnect', '1', '-reconnect_streamed', '1');
    }
    if (seekSec > 0) {
      inOpts.push('-probesize', '5242880', '-analyzeduration', '5000000');
    } else {
      inOpts.push('-probesize', '2097152', '-analyzeduration', '2000000');
    }

    const command = ffmpeg(job.inputSource);
    command.inputOptions(inOpts);
    job.command = command;

    const { audioIndex, canCopyAudio } = this.resolveAudioSelection(job.options);

    if (job.options.audioOnly) {
      command
        .outputOptions([`-map 0:a:${audioIndex}?`, '-sn', '-dn'])
        .noVideo()
        .audioCodec('aac')
        .audioBitrate('128k')
        .audioChannels(2)
        .format('adts');
    } else if (probedNeedsReencode) {
      command
        .outputOptions([
          '-map 0:v:0',
          `-map 0:a:${audioIndex}?`,
          '-sn',
          '-dn',
          '-disposition:a:0 default',
          '-preset ultrafast',
          '-tune zerolatency',
          '-crf 24',
          '-pix_fmt yuv420p',
          '-af aresample=async=1',
          '-avoid_negative_ts make_zero',
          '-max_muxing_queue_size 2048',
          '-frag_duration 400000',
          '-movflags frag_keyframe+empty_moov+default_base_moof'
        ])
        .videoCodec('libx264')
        .audioCodec('aac')
        .audioBitrate('160k')
        .audioChannels(2)
        .format('mp4');
    } else {
      const outOpts = [
        '-map 0:v:0',
        `-map 0:a:${audioIndex}?`,
        '-sn',
        '-dn',
        '-disposition:a:0 default',
        '-avoid_negative_ts make_zero',
        '-max_muxing_queue_size 2048',
        '-frag_duration 400000',
        '-movflags frag_keyframe+empty_moov+default_base_moof'
      ];
      if (!canCopyAudio) {
        outOpts.push('-af aresample=async=1');
      }

      command
        .outputOptions(outOpts)
        .videoCodec('copy')
        .audioCodec(canCopyAudio ? 'copy' : 'aac');

      if (!canCopyAudio) {
        command.audioBitrate('192k').audioChannels(2);
      }
      command.format('mp4');
    }

    command.on('start', (cmdline) => {
      console.log(
        `[Transcoder FFmpeg] Job ${job.id} [audio=#${audioIndex}, seek=${seekSec}s, copyV=${!probedNeedsReencode}]: ${cmdline.slice(0, 92)}...`
      );
    });

    command.on('error', (err) => {
      const msg = err?.message || '';
      if (
        !msg.includes('SIGKILL') &&
        !msg.includes('Output stream closed') &&
        !msg.includes('Premature close') &&
        !msg.includes('pipe:0: Invalid data')
      ) {
        console.warn(`[Transcoder FFmpeg] Aviso no Job ${job.id}:`, msg);
      }
      this.finalizeJob(job.id);
    });

    command.on('end', () => {
      this.finalizeJob(job.id);
    });

    command.pipe(job.outputDestination, { end: true });

    job.outputDestination.on('close', () => {
      this.cancelJob(job.id);
    });
    job.outputDestination.on('error', () => {
      this.cancelJob(job.id);
    });
  }

  /**
   * FASE 3: Muxing Hibrido em Tempo Real (Video 4K/1080p EN + Audio 720p PT-BR)
   * Mapeia o video do Stream 0 (-map 0:v:0) com -c:v copy (zero custo de CPU)
   * e o audio do Stream 1 (-map 1:a:0) convertido para AAC estereo 192k (-c:a aac -b:a 192k -ac 2)
   * em container Fragmented MP4 (-f mp4 -movflags frag_keyframe+empty_moov+default_base_moof).
   */
  transcodeHybridStream(
    videoInput: Readable | string,
    audioInput: Readable | string,
    outputDestination: Writable,
    options: {
      seekSeconds?: number;
      audioDelayMs?: number;
      onCancel?: () => void;
    } = {}
  ): { id: string; cancel: () => void; command: ffmpeg.FfmpegCommand } {
    this.jobCounter += 1;
    const jobId = `hybrid-${this.jobCounter}-${Date.now()}`;
    const seekSec = options.seekSeconds && options.seekSeconds > 0 ? options.seekSeconds : 0;
    const delayMs = options.audioDelayMs ? Math.round(options.audioDelayMs) : 0;

    const buildInputOpts = (src: Readable | string) => {
      const opts: string[] = [];
      if (seekSec > 0) {
        opts.push('-noaccurate_seek', '-ss', seekSec.toFixed(2));
      }
      opts.push('-fflags', '+discardcorrupt+nobuffer+genpts');
      if (typeof src === 'string') {
        opts.push('-seekable', '1', '-reconnect', '1', '-reconnect_streamed', '1');
      }
      if (seekSec > 0) {
        opts.push('-probesize', '5242880', '-analyzeduration', '5000000');
      } else {
        opts.push('-probesize', '2097152', '-analyzeduration', '2000000');
      }
      return opts;
    };

    const command = ffmpeg();
    command.input(videoInput).inputOptions(buildInputOpts(videoInput));
    command.input(audioInput).inputOptions(buildInputOpts(audioInput));

    const audioFilters: string[] = ['aresample=async=1'];
    if (delayMs > 0) {
      audioFilters.push(`adelay=${delayMs}|${delayMs}`);
    }

    command
      .outputOptions([
        '-map 0:v:0',
        '-map 1:a:0',
        '-sn',
        '-dn',
        '-c:v copy',
        '-c:a aac',
        '-b:a 192k',
        '-ac 2',
        `-af ${audioFilters.join(',')}`,
        '-avoid_negative_ts make_zero',
        '-max_muxing_queue_size 2048',
        '-frag_duration 400000',
        '-movflags frag_keyframe+empty_moov+default_base_moof'
      ])
      .format('mp4');

    let isCleaned = false;
    const cleanupHybrid = () => {
      if (isCleaned) return;
      isCleaned = true;
      try {
        command.kill('SIGKILL');
      } catch {}
      try {
        if (typeof videoInput !== 'string') videoInput.destroy();
      } catch {}
      try {
        if (typeof audioInput !== 'string') audioInput.destroy();
      } catch {}
      options.onCancel?.();
    };

    command.on('start', (cmdline) => {
      console.log(`[Transcoder Hybrid Mux] Job ${jobId} iniciado: ${cmdline.slice(0, 110)}...`);
    });

    command.on('error', (err) => {
      const msg = err?.message || '';
      if (
        !msg.includes('SIGKILL') &&
        !msg.includes('Output stream closed') &&
        !msg.includes('Premature close')
      ) {
        console.warn(`[Transcoder Hybrid Mux] Aviso no Job ${jobId}:`, msg);
      }
      cleanupHybrid();
    });

    command.on('end', () => {
      cleanupHybrid();
    });

    outputDestination.on('close', cleanupHybrid);
    outputDestination.on('error', cleanupHybrid);

    command.pipe(outputDestination, { end: true });

    return {
      id: jobId,
      cancel: cleanupHybrid,
      command
    };
  }

  cancelJob(jobId: string) {
    const queueIdx = this.queue.findIndex((j) => j.id === jobId);
    if (queueIdx !== -1) {
      const [removed] = this.queue.splice(queueIdx, 1);
      removed.isDestroyed = true;
      try {
        if (typeof removed.inputSource !== 'string') {
          removed.inputSource.destroy();
        }
      } catch {}
      removed.options.onCancel?.();
      return;
    }

    const active = this.activeJobs.get(jobId);
    if (active) {
      active.isDestroyed = true;
      try {
        if (active.command) {
          active.command.kill('SIGKILL');
        }
      } catch {}
      try {
        if (typeof active.inputSource !== 'string') {
          active.inputSource.destroy();
        }
      } catch {}
      this.finalizeJob(jobId);
    }
  }

  private finalizeJob(jobId: string) {
    const job = this.activeJobs.get(jobId);
    if (!job) return;
    this.activeJobs.delete(jobId);
    job.options.onCancel?.();
    this.processQueue();
  }

  getQueueStatus() {
    return {
      activeCount: this.activeJobs.size,
      queuedCount: this.queue.length
    };
  }
}

export const transcoder = new TranscoderQueueManager();
