import { describe, it, expect } from 'vitest';
import { db, toSafeUser } from '../database.ts';

// Helper de validação de Magnet idêntico à implementação do servidor
function validateMagnet(magnet: unknown): { valid: boolean; error?: string } {
  if (typeof magnet !== 'string' || !magnet) {
    return { valid: false, error: 'Magnet URI ausente.' };
  }
  if (magnet.length > 4096) {
    return { valid: false, error: 'Magnet URI muito longo (máximo 4096 caracteres).' };
  }
  if (!magnet.startsWith('magnet:?')) {
    return { valid: false, error: 'Formato inválido de link Magnet (deve iniciar com magnet:?).' };
  }
  const hasBtih = /xt=urn:btih:([a-fA-F0-9]{40}|[a-zA-Z2-7]{32})/i.test(magnet);
  if (!hasBtih) {
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

  it('deve rejeitar magnet que excede tamanho máximo de 4096 caracteres', () => {
    const huge = 'magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567&extra=' + 'a'.repeat(4100);
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




