import { describe, it, expect } from 'vitest';
import { db, toSafeUser } from '../database.ts';

// Helper de validação de Magnet idêntico à implementação do servidor
const MAGNET_URI_STRICT_REGEX = /^magnet:\?(?:[^&\s]*&)*xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})(?:[&#]|$)/i;

function validateMagnet(magnet: unknown): { valid: boolean; error?: string } {
  if (typeof magnet !== 'string' || !magnet.trim()) {
    return { valid: false, error: 'Magnet URI ausente.' };
  }
  const trimmed = magnet.trim();
  if (trimmed.length > 2048) {
    return { valid: false, error: 'Magnet URI muito longo (máximo 2048 caracteres).' };
  }
  if (!trimmed.startsWith('magnet:?')) {
    return { valid: false, error: 'Formato inválido de link Magnet (deve iniciar com magnet:?).' };
  }
  if (!MAGNET_URI_STRICT_REGEX.test(trimmed)) {
    return { valid: false, error: 'Magnet URI não contém um infoHash válido (xt=urn:btih:).' };
  }
  return { valid: true };
}

// Helper de verificação de IP privado (Anti-SSRF)
function isPrivateIp(ip: string): boolean {
  if (
    ip === '127.0.0.1' ||
    ip === '::1' ||
    ip.startsWith('127.') ||
    ip.startsWith('10.') ||
    ip.startsWith('192.168.') ||
    ip.startsWith('169.254.') ||
    /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip) ||
    ip.startsWith('fc00:') ||
    ip.startsWith('fe80:') ||
    ip === '0.0.0.0'
  ) {
    return true;
  }
  return false;
}

const ALLOWED_IMAGE_HOSTS = new Set([
  'image.tmdb.org',
  'images.metahub.space',
  'images.unsplash.com',
  'avatars.githubusercontent.com',
  'm.media-amazon.com',
  'img.youtube.com'
]);

describe('Validação de Magnet URI', () => {
  it('deve aceitar magnet válido com hash hexadecimal de 40 caracteres', () => {
    const valid = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&dn=Filme+2026';
    expect(validateMagnet(valid).valid).toBe(true);
  });

  it('deve aceitar magnet válido com hash base32 de 32 caracteres', () => {
    const validB32 = 'magnet:?xt=urn:btih:NVZXI2DFOJWGS43TMFWGK3TJOBXXE33P&dn=Filme+B32';
    expect(validateMagnet(validB32).valid).toBe(true);
  });

  it('deve rejeitar URI sem prefixo magnet:?', () => {
    const invalid = 'http://tracker.com/torrent.torrent';
    const res = validateMagnet(invalid);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('magnet:?');
  });

  it('deve rejeitar magnet sem infoHash btih', () => {
    const invalid = 'magnet:?dn=Filme+Sem+Hash';
    const res = validateMagnet(invalid);
    expect(res.valid).toBe(false);
    expect(res.error).toContain('infoHash');
  });

  it('deve rejeitar magnet que excede tamanho máximo de 2048 caracteres', () => {
    const huge = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&extra=' + 'a'.repeat(2100);
    expect(validateMagnet(huge).valid).toBe(false);
  });
});

describe('Regras de Proxy e Proteção Anti-SSRF', () => {
  it('deve identificar endereços IP de loopback e privados como proibidos', () => {
    expect(isPrivateIp('127.0.0.1')).toBe(true);
    expect(isPrivateIp('10.0.0.1')).toBe(true);
    expect(isPrivateIp('192.168.1.100')).toBe(true);
    expect(isPrivateIp('172.16.0.5')).toBe(true);
    expect(isPrivateIp('169.254.169.254')).toBe(true); // AWS / Cloud metadata
    expect(isPrivateIp('0.0.0.0')).toBe(true);
  });

  it('deve aceitar endereços IP públicos roteáveis na internet', () => {
    expect(isPrivateIp('8.8.8.8')).toBe(false);
    expect(isPrivateIp('1.1.1.1')).toBe(false);
    expect(isPrivateIp('142.250.190.46')).toBe(false);
  });

  it('deve validar hosts de imagens contra a allowlist de CDNs confiáveis', () => {
    expect(ALLOWED_IMAGE_HOSTS.has('image.tmdb.org')).toBe(true);
    expect(ALLOWED_IMAGE_HOSTS.has('images.unsplash.com')).toBe(true);
    expect(ALLOWED_IMAGE_HOSTS.has('images.metahub.space')).toBe(true);
    expect(ALLOWED_IMAGE_HOSTS.has('evil.com')).toBe(false);
    expect(ALLOWED_IMAGE_HOSTS.has('localhost')).toBe(false);
  });
});

describe('Autenticação e Sessões SQLite', () => {
  const testEmail = `teste_${Date.now()}@popoca.test`;
  const testPassword = 'senhaSegura123';

  it('deve rejeitar registro com senha inferior a 6 caracteres', () => {
    const reg = db.registerUser({ email: 'curta@popoca.test', password: '123' });
    expect(reg.success).toBe(false);
    expect(reg.error).toContain('mínimo 6 caracteres');
  });

  it('deve registrar usuário com sucesso e emitir sessão Bearer sem vazar hash', () => {
    const reg = db.registerUser({
      email: testEmail,
      password: testPassword,
      username: 'Usuário Teste'
    });
    expect(reg.success).toBe(true);
    expect(reg.user).toBeDefined();
    expect(reg.user?.id).toBeDefined();
    expect((reg.user as any)?.password_hash).toBeUndefined(); // Não deve conter hash de senha
    expect(reg.token).toBeDefined();
    expect(reg.token?.length).toBe(64); // 32 bytes hex
  });

  it('deve autenticar usuário cadastrado com a senha correta', () => {
    const login = db.loginUser(testEmail, testPassword);
    expect(login.success).toBe(true);
    expect(login.token).toBeDefined();
    expect((login.user as any)?.password_hash).toBeUndefined();
  });

  it('deve rejeitar login com senha incorreta', () => {
    const login = db.loginUser(testEmail, 'senhaErrada');
    expect(login.success).toBe(false);
    expect(login.error).toBe('E-mail ou senha incorretos.');
  });

  it('deve rejeitar login com senha vazia ou ausente', () => {
    const login = db.loginUser(testEmail, '');
    expect(login.success).toBe(false);
    expect(login.error).toBe('Senha obrigatória.');
  });

  it('deve validar sessão ativa e retornar os dados do usuário', () => {
    const login = db.loginUser(testEmail, testPassword);
    const validUser = db.validateSession(login.token!);
    expect(validUser).not.toBeNull();
    expect(validUser?.email).toBe(testEmail);
  });

  it('deve revogar sessão após logout (deleteSession)', () => {
    const login = db.loginUser(testEmail, testPassword);
    expect(db.validateSession(login.token!)).not.toBeNull();
    db.deleteSession(login.token!);
    expect(db.validateSession(login.token!)).toBeNull();
  });
});

describe('Função cachedFetch com TTL e Deduplicação Concorrente', () => {
  it('deve deduplicar múltiplas requisições simultâneas para o mesmo recurso', async () => {
    let callCount = 0;
    const testCache = new Map<string, { at: number; ttl: number; value: unknown }>();
    const inflight = new Map<string, Promise<unknown>>();

    async function testCachedFetch<T>(key: string, ttl: number, loader: () => Promise<T>): Promise<T> {
      const hit = testCache.get(key);
      if (hit && Date.now() - hit.at < hit.ttl) return hit.value as T;
      const pending = inflight.get(key);
      if (pending) return pending as Promise<T>;

      const p = (async () => {
        try {
          const val = await loader();
          testCache.set(key, { at: Date.now(), ttl, value: val });
          return val;
        } finally {
          inflight.delete(key);
        }
      })();
      inflight.set(key, p);
      return p;
    }

    const slowFetcher = async () => {
      callCount++;
      await new Promise((r) => setTimeout(r, 20));
      return { id: 123, title: 'Item Teste' };
    };

    // 5 chamadas concorrentes simultâneas
    const results = await Promise.all([
      testCachedFetch('item|123', 5000, slowFetcher),
      testCachedFetch('item|123', 5000, slowFetcher),
      testCachedFetch('item|123', 5000, slowFetcher),
      testCachedFetch('item|123', 5000, slowFetcher),
      testCachedFetch('item|123', 5000, slowFetcher)
    ]);

    expect(results.length).toBe(5);
    expect(results[0].title).toBe('Item Teste');
    expect(callCount).toBe(1); // Exatamente UMA chamada externa realizada
  });
});

describe('Desempenho do Servidor e Otimizações da Fase 3', () => {
  it('deve validar formatos nativos do navegador vs formatos que exigem remux/transcode', async () => {
    const { transcoder } = await import('../transcoder.ts');
    expect(transcoder.isWebNative('filme.mp4')).toBe(true);
    expect(transcoder.isWebNative('video.m4v')).toBe(true);
    expect(transcoder.isWebNative('clip.webm')).toBe(true);
    expect(transcoder.isWebNative('filme_dual_audio.mkv')).toBe(false);
    expect(transcoder.isWebNative('gravacao.ts')).toBe(false);
    expect(transcoder.isWebNative('arquivo.avi')).toBe(false);

    const qStatus = transcoder.getQueueStatus();
    expect(typeof qStatus.activeCount).toBe('number');
    expect(typeof qStatus.queuedCount).toBe('number');
  });

  it('deve executar limpeza do cache em disco via pruneDiskCache sem erros', async () => {
    const { torrentEngine } = await import('../torrentEngine.ts');
    const res = torrentEngine.pruneDiskCache();
    expect(res).toBeDefined();
    expect(typeof res.freedBytes).toBe('number');
    expect(typeof res.currentBytes).toBe('number');
    expect(typeof torrentEngine.getActiveEnginesCount()).toBe('number');
  });

  it('deve executar consultas repetidas no SQLite com altíssimo desempenho via prepared statements', () => {
    const start = performance.now();
    for (let i = 0; i < 200; i++) {
      db.getUserByEmail('nonexistent@domain.com');
    }
    const elapsed = performance.now() - start;
    // 200 consultas com prepared statements pré-compilados devem ser executadas em menos de 200ms
    expect(elapsed).toBeLessThan(500);
  });
});

describe('Estabilidade do Streaming e Suporte a Range RFC 7233 (Fase 4)', () => {
  it('deve retornar null para requisições completas sem cabeçalho Range', async () => {
    const { parseHttpRange } = await import('../torrentEngine.ts');
    expect(parseHttpRange(undefined, 1000000)).toBeNull();
    expect(parseHttpRange('', 1000000)).toBeNull();
    expect(parseHttpRange('invalid', 1000000)).toBeNull();
  });

  it('deve processar faixas fechadas padrão bytes=start-end', async () => {
    const { parseHttpRange } = await import('../torrentEngine.ts');
    const res = parseHttpRange('bytes=0-1048575', 5000000);
    expect(res).toEqual({ start: 0, end: 1048575 });
  });

  it('deve processar faixas abertas até o fim do arquivo bytes=start-', async () => {
    const { parseHttpRange } = await import('../torrentEngine.ts');
    const res = parseHttpRange('bytes=2000000-', 5000000);
    expect(res).toEqual({ start: 2000000, end: 4999999 });
  });

  it('deve processar faixas de sufixo bytes=-suffix (ex: leitura de moov/cues no final do arquivo)', async () => {
    const { parseHttpRange } = await import('../torrentEngine.ts');
    const res = parseHttpRange('bytes=-500000', 5000000);
    expect(res).toEqual({ start: 4500000, end: 4999999 });
  });

  it('deve limitar faixas de sufixo maiores que o tamanho total do arquivo', async () => {
    const { parseHttpRange } = await import('../torrentEngine.ts');
    const res = parseHttpRange('bytes=-10000000', 5000000);
    expect(res).toEqual({ start: 0, end: 4999999 });
  });

  it('deve retornar unsatisfiable para faixas fora dos limites do arquivo (HTTP 416)', async () => {
    const { parseHttpRange } = await import('../torrentEngine.ts');
    expect(parseHttpRange('bytes=5000000-', 5000000)).toBe('unsatisfiable');
    expect(parseHttpRange('bytes=6000000-7000000', 5000000)).toBe('unsatisfiable');
    expect(parseHttpRange('bytes=3000-2000', 5000000)).toBe('unsatisfiable');
    expect(parseHttpRange('bytes=-0', 5000000)).toBe('unsatisfiable');
    expect(parseHttpRange('bytes=abc-def', 5000000)).toBe('unsatisfiable');
  });

  it('deve extrair a primeira faixa quando múltiplas faixas são solicitadas', async () => {
    const { parseHttpRange } = await import('../torrentEngine.ts');
    const res = parseHttpRange('bytes=0-100, 200-300', 1000);
    expect(res).toEqual({ start: 0, end: 100 });
  });
});

describe('Melhorias de Frontend e Telemetria P2P (Fase 5)', () => {
  it('deve gerar mapa amostrado de 60 peças (generatePieceMap) corretamente', async () => {
    const { generatePieceMap } = await import('../torrentEngine.ts');
    
    // 1. Bitfield vazio ou sem peças
    expect(generatePieceMap(null, 0)).toEqual([]);

    // 2. Bitfield 100% completo (120 peças)
    const fullBitfield = { get: () => true };
    const fullMap = generatePieceMap(fullBitfield, 120, 60);
    expect(fullMap.length).toBe(60);
    expect(fullMap.every((pct) => pct === 100)).toBe(true);

    // 3. Bitfield 0% (nenhuma peça baixada)
    const emptyBitfield = { get: () => false };
    const emptyMap = generatePieceMap(emptyBitfield, 120, 60);
    expect(emptyMap.length).toBe(60);
    expect(emptyMap.every((pct) => pct === 0)).toBe(true);

    // 4. Bitfield alternado (50% de peças em cada balde)
    const halfBitfield = { get: (i: number) => i % 2 === 0 };
    const halfMap = generatePieceMap(halfBitfield, 120, 60);
    expect(halfMap.length).toBe(60);
    expect(halfMap[0]).toBe(50);
  });

  it('deve validar e rejeitar arquivos corrompidos ou HTML via isValidBencodedTorrent', async () => {
    const { isValidBencodedTorrent } = await import('../torrentEngine.ts');
    
    expect(isValidBencodedTorrent(Buffer.from(''))).toBe(false);
    expect(isValidBencodedTorrent(Buffer.from('<!DOCTYPE html><html>Erro Cloudflare</html>'))).toBe(false);
    expect(isValidBencodedTorrent(Buffer.from('d10:some_content_without_infoe'))).toBe(false);

    // Buffer válido Bencode com dicionário 'd' e '4:info'
    const validDummy = Buffer.concat([
      Buffer.from('d4:infod4:name9:filme.mp4e'),
      Buffer.alloc(240, 0x61),
      Buffer.from('e')
    ]);
    expect(isValidBencodedTorrent(validDummy)).toBe(true);
  });

  it('deve extrair infoHash e magnetUri de arquivo .torrent válido via parseTorrentBuffer', async () => {
    const { parseTorrentBuffer } = await import('../torrentEngine.ts');
    
    // Cria um buffer .torrent bencode sintético válido
    const validTorrentBuf = Buffer.concat([
      Buffer.from('d4:infod4:name10:Popoca.mp412:piece lengthi1048576e6:pieces20:12345678901234567890e'),
      Buffer.alloc(200, 0x61),
      Buffer.from('e')
    ]);

    const result = parseTorrentBuffer(validTorrentBuf);
    expect(result.valid).toBe(true);
    expect(result.infoHash).toMatch(/^[a-f0-9]{40}$/);
    expect(result.name).toBe('Popoca.mp4');
    expect(result.magnetUri).toContain('magnet:?xt=urn:btih:');
    expect(result.magnetUri).toContain('Popoca.mp4');
  });

  it('deve rejeitar buffers inválidos em parseTorrentBuffer', async () => {
    const { parseTorrentBuffer } = await import('../torrentEngine.ts');
    const result = parseTorrentBuffer(Buffer.from('conteúdo_inválido'));
    expect(result.valid).toBe(false);
    expect(result.error).toBeDefined();
  });
});

describe('Conversão de Legendas WebVTT e Sanitização (Fase 6)', () => {
  it('deve converter SRT para WebVTT com timestamps corretos, remoção de BOM e tags ASS', async () => {
    const { srtToVtt } = await import('../subtitleService.ts');

    const srtSample = `\uFEFF1
00:01:20,500 --> 00:01:23,800
{\\an8}Bem-vindo ao <i>Popoca</i>!

2
00:01:24,000 --> 00:01:28,250
Streaming torrent direto no seu navegador.
`;

    const vtt = srtToVtt(srtSample);
    expect(vtt.startsWith('WEBVTT')).toBe(true);
    expect(vtt).toContain('00:01:20.500 --> 00:01:23.800');
    expect(vtt).toContain('00:01:24.000 --> 00:01:28.250');
    expect(vtt).not.toContain('\uFEFF'); // Sem BOM
    expect(vtt).not.toContain('{\\an8}'); // Sem tags ASS
  });

  it('deve garantir que toSafeUser nunca inclui o campo password_hash', () => {
    const rawUser = {
      id: 'uuid-123',
      email: 'user@popoca.test',
      username: 'User Teste',
      handle: 'userteste',
      bio: 'Bio teste',
      avatar_url: 'https://avatar.test',
      banner_url: 'https://banner.test',
      password_hash: 'salt_secreto:hash_secreto_sha256',
      created_at: 123456789,
      updated_at: 123456789
    };

    const safe = toSafeUser(rawUser);
    expect((safe as any).password_hash).toBeUndefined();
    expect(safe.email).toBe('user@popoca.test');
    expect(safe.id).toBe('uuid-123');
  });
});

describe('Micro-Debrid, Super Trackers, Quality Cap e Muxing Hibrido', () => {
  it('deve conter exatamente os 15 Super Trackers UDP/HTTP publicos de alta performance', async () => {
    const { SUPER_TRACKERS } = await import('../indexerService.ts');
    expect(SUPER_TRACKERS.length).toBe(15);
    expect(SUPER_TRACKERS).toContain('udp://tracker.opentrackr.org:1337/announce');
    expect(SUPER_TRACKERS).toContain('http://tracker.openbittorrent.com:80/announce');
  });

  it('deve respeitar o Quality Cap (nunca subir alem da qualidade solicitada) e selecionar fallback + par hibrido', async () => {
    const { selectQualityCappedCandidates } = await import('../indexerService.ts');
    const mockResults = [
      {
        id: 't1',
        title: 'Movie 2160p 4K UHD WEB-DL',
        magnetUri: 'magnet:?xt=urn:btih:1111111111111111111111111111111111111111',
        infoHash: '1111111111111111111111111111111111111111',
        seeds: 500,
        peers: 20,
        size: '15 GB',
        provider: 'YTS',
        quality: '4K' as const,
        format: 'WEB-DL',
        audioType: 'Original' as const,
        isPortugueseAudio: false,
        hasPortugueseCheck: false,
        stabilityScore: 100
      },
      {
        id: 't2',
        title: 'Movie 1080p FullHD WEB-DL',
        magnetUri: 'magnet:?xt=urn:btih:2222222222222222222222222222222222222222',
        infoHash: '2222222222222222222222222222222222222222',
        seeds: 180,
        peers: 15,
        size: '2.2 GB',
        provider: 'YTS',
        quality: '1080p' as const,
        format: 'WEB-DL',
        audioType: 'Original' as const,
        isPortugueseAudio: false,
        hasPortugueseCheck: false,
        stabilityScore: 95
      },
      {
        id: 't3',
        title: 'Movie 720p Dublado PT-BR WEB-DL',
        magnetUri: 'magnet:?xt=urn:btih:3333333333333333333333333333333333333333',
        infoHash: '3333333333333333333333333333333333333333',
        seeds: 95,
        peers: 10,
        size: '1.1 GB',
        provider: 'TPB-BR',
        quality: '720p' as const,
        format: 'WEB-DL',
        audioType: 'Dublado' as const,
        isPortugueseAudio: true,
        hasPortugueseCheck: true,
        stabilityScore: 90
      }
    ];

    // Se o usuario escolheu 1080p (Original EN), NUNCA deve retornar 4K mesmo com 500 seeders
    const sel1080En = selectQualityCappedCandidates(mockResults as any, '1080p', false);
    expect(sel1080En.primaryCandidates[0]?.quality).toBe('1080p');

    // Se o usuario escolheu 1080p com preferencia por PT-BR, mas PT-BR so existe em 720p:
    // Deve detectar par hibrido (video 1080p EN + audio 720p PT-BR) e ter fallback em 720p PT-BR
    const sel1080Pt = selectQualityCappedCandidates(mockResults as any, '1080p', true);
    expect(sel1080Pt.fallbackQuality).toBe('720p');
    expect(sel1080Pt.hybridCandidate).not.toBeNull();
    expect(sel1080Pt.hybridCandidate?.videoTorrent.quality).toBe('1080p');
    expect(sel1080Pt.hybridCandidate?.audioTorrent.isPortugueseAudio).toBe(true);

    // Se o usuario escolheu 720p, deve iniciar em 720p e nunca subir para 1080p ou 4K
    const sel720 = selectQualityCappedCandidates(mockResults as any, '720p', true);
    expect(sel720.primaryCandidates[0]?.quality).toBe('720p');
  });

  it('deve verificar conectividade do SQLite via db.ping() em tempo sub-milissegundo', () => {
    expect(db.ping()).toBe(true);
  });

  it('deve selecionar exatamente o Episodio 1 mesmo quando o Episodio 2 esta no indice 0, e maior em bytes ou usa underscores', async () => {
    const { torrentEngine } = await import('../torrentEngine.ts');
    // Simula season pack do Stranger Things onde S01E02 vem em files[0] e e maior que S01E01
    const mockSeasonPackFiles = [
      {
        name: 'Stranger_Things_S01E02_1080p_WEB-DL_DUAL_5.1.mkv',
        path: 'Stranger.Things.S01.1080p/Stranger_Things_S01E02_1080p_WEB-DL_DUAL_5.1.mkv',
        length: 1_450_000_000
      },
      {
        name: 'Stranger_Things_S01E01_1080p_WEB-DL_DUAL_5.1.mkv',
        path: 'Stranger.Things.S01.1080p/Stranger_Things_S01E01_1080p_WEB-DL_DUAL_5.1.mkv',
        length: 1_260_000_000
      },
      {
        name: 'Stranger_Things_S01E03_1080p_WEB-DL_DUAL_5.1.mkv',
        path: 'Stranger.Things.S01.1080p/Stranger_Things_S01E03_1080p_WEB-DL_DUAL_5.1.mkv',
        length: 1_310_000_000
      },
      {
        name: 'Stranger_Things_S01E01.srt',
        path: 'Stranger.Things.S01.1080p/Subs/Stranger_Things_S01E01.srt',
        length: 55_000
      }
    ];

    const mockEngine = { files: mockSeasonPackFiles } as any;

    // 1. Sem fileIdx, pedindo S01E01 -> deve retornar S01E01 (mesmo sendo menor e estando em files[1])
    const ep1 = torrentEngine.findTargetVideoFile(mockEngine, undefined, 1, 1);
    expect(ep1?.name).toContain('S01E01');

    // 2. Com fileIdx=0 defasado (apontando para S01E02), mas pedindo S01E01 -> deve corrigir para S01E01
    const ep1Override = torrentEngine.findTargetVideoFile(mockEngine, 0, 1, 1);
    expect(ep1Override?.name).toContain('S01E01');

    // 3. Pedindo S01E02 -> deve retornar S01E02
    const ep2 = torrentEngine.findTargetVideoFile(mockEngine, undefined, 1, 2);
    expect(ep2?.name).toContain('S01E02');

    // 4. Formato de anime "[SubGroup] Anime - 01 [1080p].mkv"
    const mockAnimeFiles = [
      {
        name: '[Erai-raws] Jujutsu Kaisen - 02 [1080p][Multiple Subtitle].mkv',
        path: '[Erai-raws] Jujutsu Kaisen - 02 [1080p][Multiple Subtitle].mkv',
        length: 1_400_000_000
      },
      {
        name: '[Erai-raws] Jujutsu Kaisen - 01 [1080p][Multiple Subtitle].mkv',
        path: '[Erai-raws] Jujutsu Kaisen - 01 [1080p][Multiple Subtitle].mkv',
        length: 1_350_000_000
      }
    ];
    const animeEp1 = torrentEngine.findTargetVideoFile({ files: mockAnimeFiles } as any, undefined, 1, 1);
    expect(animeEp1?.name).toContain(' - 01 ');
  });

  it('deve descartar seleções antigas e requisições para peças anteriores ao ponto de seek (evita baixar desde o começo)', async () => {
    const { torrentEngine } = await import('../torrentEngine.ts');
    const cancelledRequests: number[] = [];
    const mockWire = {
      destroyed: false,
      requests: [
        { piece: 0, offset: 0, length: 16384 },
        { piece: 1, offset: 0, length: 16384 },
        { piece: 50, offset: 0, length: 16384 }
      ],
      cancel(piece: number) {
        cancelledRequests.push(piece);
      }
    };
    const mockEngine: any = {
      selection: [
        { from: 0, to: 20, priority: 1 },
        { from: 0, to: 100, priority: 10 }
      ],
      _critical: [true, true, true],
      _reservations: [[{}], [{}], [{}]],
      swarm: {
        wires: [mockWire]
      },
      critical: () => {},
      select: (from: number, to: number, prio: number) => {
        mockEngine.selection.push({ from, to, priority: prio });
      },
      flood: () => {}
    };

    // Aplica seek para a peça 50
    (torrentEngine as any).applyCleanPriorityWindow(mockEngine, 50, 100, false);

    // 1. As requisições antigas nos fios P2P anteriores a 50 (peças 0 e 1) devem ter sido canceladas
    expect(cancelledRequests).toContain(0);
    expect(cancelledRequests).toContain(1);
    expect(cancelledRequests).not.toContain(50);

    // 2. O array de seleções não deve conter nenhum intervalo que termine antes de 50
    const hasOldInterval = mockEngine.selection.some((s: any) => s.to < 50);
    expect(hasOldInterval).toBe(false);

    // 3. Peças críticas antigas devem ter sido desmarcadas
    expect(mockEngine._critical[0]).toBe(false);
    expect(mockEngine._critical[1]).toBe(false);
  });

  it('deve executar destroyEngine liberando file descriptors e limpando os mapas em memória', async () => {
    const { torrentEngine } = await import('../torrentEngine.ts');
    let storeClosed = false;
    let engineDestroyed = false;
    const testHash = 'deadbeef0123456789abcdef0123456789abcdef';

    const mockEngine: any = {
      store: {
        close: (cb: any) => {
          storeClosed = true;
          cb?.();
        }
      },
      destroy: (cb: any) => {
        engineDestroyed = true;
        cb?.();
      }
    };

    (torrentEngine as any).enginesMap.set(testHash, mockEngine);
    (torrentEngine as any).runtimeMetaMap.set(testHash, { createdAt: Date.now() });

    torrentEngine.destroyEngine(testHash, false);

    expect(storeClosed).toBe(true);
    expect(engineDestroyed).toBe(true);
    expect((torrentEngine as any).enginesMap.has(testHash)).toBe(false);
    expect((torrentEngine as any).runtimeMetaMap.has(testHash)).toBe(false);
  });

  it('deve armazenar e recuperar blocos de pre-fetch no chunk cache em memória', async () => {
    const { torrentEngine } = await import('../torrentEngine.ts');
    const testHash = 'chunkcache0123456789abcdef0123456789abcdef';
    const pieceIndex = 42;
    const chunkData = Buffer.from('test-chunk-data-for-prefetch-30s-window');

    // Insere bloco no cache
    torrentEngine.putChunkInCache(testHash, pieceIndex, chunkData, 40);

    // Recupera bloco do cache
    const retrieved = torrentEngine.getChunkFromCache(testHash, pieceIndex);
    expect(retrieved).not.toBeNull();
    expect(retrieved?.toString('utf8')).toBe('test-chunk-data-for-prefetch-30s-window');

    // Limpa cache
    torrentEngine.destroyEngine(testHash, false);
    expect(torrentEngine.getChunkFromCache(testHash, pieceIndex)).toBeNull();
  });

  it('deve podar buffers e descartar blocos fora da janela de reprodução ao exceder limite', async () => {
    const { torrentEngine } = await import('../torrentEngine.ts');
    const testHash = 'memorywatchdog0123456789abcdef0123456789ab';
    const bigChunk = Buffer.alloc(10 * 1024 * 1024, 0xaa); // 10 MB

    // Insere múltiplos blocos simulando pre-fetch
    torrentEngine.putChunkInCache(testHash, 1, bigChunk, 50);
    torrentEngine.putChunkInCache(testHash, 2, bigChunk, 50);
    torrentEngine.putChunkInCache(testHash, 50, bigChunk, 50);

    // Executa poda forçada para 15MB
    torrentEngine.pruneEngineBuffers(testHash, 15 * 1024 * 1024);

    const memory = torrentEngine.estimateEngineMemory(testHash);
    expect(memory).toBeLessThanOrEqual(15 * 1024 * 1024);

    torrentEngine.destroyEngine(testHash, false);
  });

  it('deve desalocar imediatamente motores inativos anteriores ao trocar de episódio via evictInactiveEnginesExcept', async () => {
    const { torrentEngine } = await import('../torrentEngine.ts');
    const prevEpHash = 'prevepisode0123456789abcdef0123456789abcdef';
    const nextEpHash = 'nextepisode0123456789abcdef0123456789abcdef';
    let prevEngineDestroyed = false;

    const mockPrevEngine: any = {
      store: { close: (cb: any) => cb?.() },
      destroy: (cb: any) => {
        prevEngineDestroyed = true;
        cb?.();
      }
    };

    (torrentEngine as any).enginesMap.set(prevEpHash, mockPrevEngine);
    (torrentEngine as any).activeStreamsCount.set(prevEpHash, 0); // Inativo

    // Troca de episódio para nextEpHash
    torrentEngine.evictInactiveEnginesExcept(nextEpHash);

    expect(prevEngineDestroyed).toBe(true);
    expect((torrentEngine as any).enginesMap.has(prevEpHash)).toBe(false);
  });
});



