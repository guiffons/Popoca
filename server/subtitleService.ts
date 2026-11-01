/**
 * Popoca Streaming - Subtitle Service
 * Legendas REAIS via addon público OpenSubtitles v3 (Stremio), convertidas de SRT para WebVTT.
 * - Prioriza Português do Brasil (pob), depois Português (por), Inglês e Espanhol
 * - Ranqueia as legendas pela compatibilidade com o arquivo de vídeo do torrent
 *   (grupo de release, formato WEB-DL/BluRay, penaliza CAM/TS) para melhor sincronia
 */

const OPENSUBS_ADDON = 'https://opensubtitles-v3.strem.io';

const LANG_MAP: Record<string, { code: string; label: string; order: number }> = {
  pob: { code: 'pt-BR', label: 'Português (Brasil)', order: 0 },
  por: { code: 'pt', label: 'Português (Portugal)', order: 1 },
  eng: { code: 'en', label: 'Inglês', order: 2 },
  spa: { code: 'es', label: 'Espanhol', order: 3 }
};

const MAX_OPTIONS_PER_LANG = 3;

export interface SubtitleTrackInfo {
  id: string;
  lang: string;
  label: string;
  release?: string;
}

interface RawSubtitle {
  id: string;
  url: string;
  lang: string;
  m?: string;
  subtitleFileName?: string;
  movieReleaseName?: string;
  releaseGroup?: string;
  releaseFormat?: string;
}

const FORMAT_TOKENS: Array<[RegExp, string]> = [
  [/web[\s.-]?dl/i, 'webdl'],
  [/web[\s.-]?rip/i, 'webrip'],
  [/blu[\s.-]?ray|bdrip|brrip/i, 'bluray'],
  [/hdtv/i, 'hdtv'],
  [/\b(cam|hdcam|ts|telesync|hdts)\b/i, 'cam']
];

function detectFormat(text: string): string | null {
  for (const [re, token] of FORMAT_TOKENS) {
    if (re.test(text)) return token;
  }
  return null;
}

/**
 * Converte SRT para WebVTT (timestamps com ponto, remove tags ASS/SSA e BOM)
 */
export function srtToVtt(srt: string): string {
  const body = srt
    .replace(/^\uFEFF/, '')
    .replace(/\r\n?/g, '\n')
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
    .replace(/\{\\[^}]*\}/g, '')
    .trim();

  if (body.startsWith('WEBVTT')) return body + '\n';
  return `WEBVTT\n\n${body}\n`;
}

export class SubtitleService {
  private urlById = new Map<string, string>();
  private listCache = new Map<string, { at: number; tracks: SubtitleTrackInfo[] }>();
  private vttCache = new Map<string, string>();

  private remember<K, V>(map: Map<K, V>, key: K, value: V, max: number) {
    if (map.has(key)) map.delete(key);
    map.set(key, value);
    while (map.size > max) {
      const oldest = map.keys().next().value as K;
      map.delete(oldest);
    }
  }

  /**
   * Lista as legendas reais disponíveis para um título (filme ou episódio)
   */
  async listTracks(opts: {
    imdbId: string;
    type: 'movie' | 'series';
    season?: number;
    episode?: number;
    fileName?: string;
  }): Promise<SubtitleTrackInfo[]> {
    const { imdbId, type, season, episode, fileName } = opts;
    if (!/^tt\d+$/.test(imdbId)) return [];

    const stremioId =
      type === 'series' && season && episode ? `${imdbId}:${season}:${episode}` : imdbId;
    const cacheKey = `${type}|${stremioId}|${fileName || ''}`;
    const cached = this.listCache.get(cacheKey);
    if (cached && Date.now() - cached.at < 6 * 60 * 60 * 1000) {
      return cached.tracks;
    }

    let raw: RawSubtitle[] = [];
    try {
      const res = await fetch(`${OPENSUBS_ADDON}/subtitles/${type}/${stremioId}.json`, {
        signal: AbortSignal.timeout(8000)
      });
      if (res.ok) {
        const data = await res.json();
        raw = Array.isArray(data?.subtitles) ? data.subtitles : [];
      }
    } catch (err: any) {
      console.warn('[SubtitleService] Falha ao listar legendas:', err?.message || err);
      return [];
    }

    const fileFormat = fileName ? detectFormat(fileName) : null;
    const fileLower = (fileName || '').toLowerCase();

    const scored = raw
      .filter((s) => s && s.id && s.url && LANG_MAP[s.lang])
      .map((s, idx) => {
        let score = -idx * 0.1; // mantém a ordem de popularidade do addon como desempate
        const subText = `${s.movieReleaseName || ''} ${s.subtitleFileName || ''} ${s.releaseFormat || ''}`;
        const subFormat = detectFormat(subText);

        if (s.m === 'h') score += 100; // correspondência por hash do arquivo = sincronia perfeita
        if (s.releaseGroup && fileLower.includes(s.releaseGroup.toLowerCase())) score += 50;
        if (fileFormat && subFormat === fileFormat) score += 30;
        if (subFormat === 'cam' && fileFormat !== 'cam') score -= 40;

        return { s, score };
      })
      .sort((a, b) => {
        const la = LANG_MAP[a.s.lang].order;
        const lb = LANG_MAP[b.s.lang].order;
        return la - lb || b.score - a.score;
      });

    const perLangCount: Record<string, number> = {};
    const tracks: SubtitleTrackInfo[] = [];

    for (const { s } of scored) {
      const info = LANG_MAP[s.lang];
      const n = (perLangCount[s.lang] || 0) + 1;
      if (n > MAX_OPTIONS_PER_LANG) continue;
      perLangCount[s.lang] = n;

      const id = `os-${s.id}`;
      this.remember(this.urlById, id, s.url, 2000);
      tracks.push({
        id,
        lang: info.code,
        label: n === 1 ? info.label : `${info.label} · opção ${n}`,
        release: s.movieReleaseName || s.subtitleFileName
      });
    }

    this.remember(this.listCache, cacheKey, { at: Date.now(), tracks }, 300);
    return tracks;
  }

  /**
   * Baixa a legenda selecionada e devolve em WebVTT (apenas IDs previamente listados)
   */
  async getVtt(id: string): Promise<string | null> {
    const cached = this.vttCache.get(id);
    if (cached) return cached;

    const url = this.urlById.get(id);
    if (!url) return null;

    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
      if (!res.ok) return null;
      const vtt = srtToVtt(await res.text());
      this.remember(this.vttCache, id, vtt, 60);
      return vtt;
    } catch (err: any) {
      console.warn('[SubtitleService] Falha ao baixar legenda:', err?.message || err);
      return null;
    }
  }
}

export const subtitleService = new SubtitleService();
