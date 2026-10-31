# Popoca — Plataforma de Streaming Web Ultra-Leve Torrent-to-Browser

Arquitetura e implementação de nível de produção para o **Popoca**, plataforma de streaming web ultra-leve que transmite filmes, séries e animes diretamente da rede torrent para o navegador com backend Node.js (HTTP 206 e FFmpeg on-the-fly) e frontend em Vite + React com estética Apple TV Liquid Glass (Grafite / Branco puro).

---

## 1. Novas Funcionalidades Concluídas

1. **Filtros Avançados de Torrent no `DetailModal`**:
   - **Idioma**: Alternador entre `[ Todos Áudios ]`, `[ 🇧🇷 Dublado PT-BR ]` e `[ 🌐 Original ]`.
   - **Formato**: Alternador entre `[ Todos Formatos ]`, `[ WEB-DL ]` e `[ BluRay ]`.
   - **Resolução**: Filtro dinâmico entre `[ 1080p ]`, `[ 720p ]`, `[ 4K ]` e `[ Resolução ]`.
   - Badges visuais em cada card: `WEB-DL` vs `Bluray`, `Dublado PT-BR`, tamanho exato em GB/MB e taxa de sementes ativas (`seeds` / `peers`).

2. **Camada de Persistência Offline-First com IndexedDB (`src/services/db.ts`)**:
   - Banco de dados `popoca_tmdb_db` com 3 object stores: `catalogs`, `media_details` e `search_cache`.
   - Cache com TTL de 24h e atualização assíncrona em background para renderização instantânea da interface sem latência de rede.
   - Integrado de forma transparente ao `api.ts` em `getCatalog`, `getDetails` e `search`.

3. **Correção e Otimização do Carregamento de Capas (`src/components/LazyImage.tsx`)**:
   - Detecção instantânea de cache via `imgRef.current?.complete`, evitando que a imagem fique presa no estado de placeholder.
   - Transição fluida de opacidade e renderização direta sem bloqueios.
   - Fallback de rede transparente para o proxy de alta performance `/api/proxy-image`.

4. **Streaming do Torrent Real Selecionado (Zero Vídeos Padrões)**:
   - Eliminada a interceptação em `VideoPlayer.tsx` que substituía o torrent por streams de demonstração.
   - O `VideoPlayer` agora prioriza estritamente o `magnetUri` da fonte escolhida e transmite via `/api/stream?magnet=...` através do `torrentStream` e transcode FFmpeg sob demanda (`-preset ultrafast`, `-tune zerolatency`).
