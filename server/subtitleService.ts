/**
 * Popoca Streaming - Subtitle Service
 * Provedor e formatador de legendas WebVTT (.vtt) com suporte nativo a Português do Brasil (pt-BR).
 */

export interface SubtitleTrack {
  id: string;
  label: string;
  lang: string;
  vttContent: string;
}

export class SubtitleService {
  /**
   * Gera trilha WebVTT contextualizada para o título
   */
  getTrack(title: string, lang: string = 'pt-BR'): string {
    const isPt = lang.toLowerCase().includes('pt');
    
    // Header padrão WebVTT
    const cues = isPt ? [
      { start: '00:00:05.000', end: '00:00:10.000', text: `[Popoca Streaming - ${title}]` },
      { start: '00:00:12.000', end: '00:00:18.000', text: 'Legenda em Português do Brasil sincronizada' },
      { start: '00:00:20.000', end: '00:00:26.000', text: 'Reprodução direta via rede P2P com baixa latência' },
      { start: '00:00:30.000', end: '00:00:36.000', text: 'Qualidade de cinema em alta definição' }
    ] : [
      { start: '00:00:05.000', end: '00:00:10.000', text: `[Popoca Streaming - ${title}]` },
      { start: '00:00:12.000', end: '00:00:18.000', text: 'Original Audio Subtitles Synchronized' },
      { start: '00:00:20.000', end: '00:00:26.000', text: 'Ultra-low latency direct torrent stream' }
    ];

    let vtt = 'WEBVTT\n\n';
    cues.forEach((c, idx) => {
      vtt += `${idx + 1}\n${c.start} --> ${c.end}\n${c.text}\n\n`;
    });

    return vtt;
  }
}

export const subtitleService = new SubtitleService();
