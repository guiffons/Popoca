# Popoca — Plataforma de Streaming Web Torrent-to-Browser

O **Popoca** é uma plataforma de streaming web desenvolvida para reproduzir filmes, séries e animes diretamente da rede BitTorrent para o navegador em tempo real, sem necessidade de aguardar o download completo. A interface é inspirada na estética cinematográfica **Apple TV+ Liquid Glass** (Grafite Ônix e Alabastro Frosted), com reprodução instantânea (HTTP 206 Partial Content), transcodificação de contêineres e áudio sob demanda via FFmpeg, legendas automatizadas e sincronização de dados de usuário e perfil Letterboxd com SQLite em modo WAL.

---

## Índice

- [1. Arquitetura do Sistema](#1-arquitetura-do-sistema)
- [2. Principais Funcionalidades](#2-principais-funcionalidades)
- [3. Pilha Tecnológica](#3-pilha-tecnológica)
- [4. Segurança e Hardening](#4-segurança-e-hardening)
- [5. Instalação e Execução Local](#5-instalação-e-execução-local)
- [6. Guia de Deploy](#6-guia-de-deploy)
  - [Deploy com Docker Multi-Stage](#deploy-com-docker-multi-stage)
  - [Deploy no Render (com Disco Persistente)](#deploy-no-render-com-disco-persistente)
  - [Deploy Desacoplado no Vercel + Backend Render](#deploy-desacoplado-no-vercel--backend-render)
- [7. Variáveis de Ambiente](#7-variáveis-de-ambiente)
- [8. Comandos Disponíveis](#8-comandos-disponíveis)
- [9. Migração e Limpeza de Segurança](#9-migração-e-limpeza-de-segurança)

---

## 1. Arquitetura do Sistema

O Popoca opera como uma aplicação full-stack unificada em Node.js e React:

```
┌─────────────────────────────────────────────────────────────┐
│                       Navegador Web                         │
│  React 19 · Vite 8 · Tailwind v4 · IndexedDB (Cache Chunks) │
└──────────────┬──────────────────────────────▲───────────────┘
               │ HTTP Range (206) / SSE       │ Chunks de Vídeo
┌──────────────▼──────────────────────────────┴───────────────┐
│                      Servidor Express                       │
│  Helmet · Rate Limiting · Token Bearer · Anti-SSRF Proxy    │
└───────┬─────────────────────────────┬────────────────┬──────┘
        │                             │                │
┌───────▼─────────┐           ┌───────▼────────┐ ┌─────▼──────┐
│  TorrentEngine  │           │   Transcoder   │ │   SQLite   │
│  torrent-stream │           │     FFmpeg     │ │  node:sqlite│
│  Swarm & DHT    │           │ (MKV -> H.264) │ │ (WAL Mode) │
└─────────────────┘           └────────────────┘ └────────────┘
```

1. **Cliente Web (Frontend)**: Construído com React 19 e Vite, consome a API do servidor e gerencia o buffer local em IndexedDB para avanço e retrocesso instantâneos sem recarregar dados já trafegados.
2. **Servidor HTTP (Backend)**: Construído em Node.js 22 com Express, gerencia requisições `Range` conforme RFC 7233, realiza proxy seguro contra SSRF e autenticação por tokens Bearer.
3. **Motor Torrent (`TorrentEngine`)**: Integra `torrent-stream`, biblioteca DHT integrada e lista com mais de 20 trackers globais e brasileiros de alta performance. Aplica janela deslizante de prioridade de peças (primeiros 3% e últimos 2% críticos para átomo `moov` e índice de quadros `cues`).
4. **Mecanismo de Transcodificação (`Transcoder`)**: Identifica se o arquivo é nativo do navegador (`.mp4`, `.webm`, `.m4v`). Se for `.mkv` com áudio DTS/AC3 ou legendas embutidas complexas, faz remux ultra-rápido on-the-fly (`-preset ultrafast`, `-tune zerolatency`).
5. **Banco de Dados (`SQLite`)**: Utiliza o módulo nativo `node:sqlite` do Node 22 com `journal_mode = WAL` e `synchronous = NORMAL` para leitura e escrita ultrarrápidas sem contenção de disco.

---

## 2. Principais Funcionalidades

- **Streaming P2P Sem Espera**: Inicia a reprodução em média entre 1.5s e 3.5s focando a banda diretamente nas peças necessárias para decodificação inicial.
- **Telemetria P2P e HUD de Peças**: Barra de telemetria técnica integrada com mapa visual de 60 setores do enxame (bitfield), taxas de download/upload, peers conectados e seletor rápido de prioridade de trackers.
- **Drag & Drop de Arquivos `.torrent`**: Arraste qualquer arquivo `.torrent` ou cole um link `magnet:?` (Ctrl+V) de qualquer lugar para iniciar o streaming instantaneamente.
- **Trilha "Continuar Assistindo"**: Salva o progresso no armazenamento local e nuvem a cada 5 segundos, com pílula de tempo restante e botão para exclusão rápida do histórico.
- **Filtros Avançados de Torrent**: Selecione entre Dublado PT-BR e Áudio Original, qualidade (720p, 1080p, 4K) e formato (WEB-DL vs BluRay).
- **Legendas Automáticas**: Consulta concorrente à API REST do OpenSubtitles v3 com conversão dinâmica de `.srt` para `.vtt` limpo (tags ASS/SSA removidas, timestamps padronizados e sem caracteres BOM).
- **Atalhos de Teclado**:
  - `Espaço` / `K`: Play / Pause.
  - `Seta Esquerda` / `J`: Voltar 10s.
  - `Seta Direita` / `L`: Avançar 10s.
  - `Seta Cima` / `Seta Baixo`: Volume (±10%).
  - `M`: Silenciar / Ativar Som.
  - `F`: Tela Cheia.
  - `C`: Ativar / Desativar Legendas.
  - `I`: Abrir / Fechar Painel de Telemetria P2P e Mapa de Peças.
  - `0-9`: Pular para 0% a 90% da duração.

---

## 3. Pilha Tecnológica

| Camada | Tecnologia | Propósito |
| :--- | :--- | :--- |
| **Frontend** | React 19 + TypeScript | Interface de usuário reativa |
| **Bundler** | Vite 8 + Tailwind CSS v4 | Compilação ultrarrápida e design moderno |
| **Animações** | Motion (`motion/react`) | Transições fluidas da interface |
| **Backend** | Express 4 + Node.js 22 | Servidor HTTP e orquestrador de streams |
| **P2P Torrent** | `torrent-stream` | Conexões DHT, Wire Swarm e transferência P2P |
| **Mídia** | `@ffmpeg-installer` + `fluent-ffmpeg` | Remux e transcode de áudio e vídeo sob demanda |
| **Banco de Dados** | `node:sqlite` nativo | Armazenamento de contas, sessões e histórico |
| **Testes** | Vitest 5 | Testes unitários e de integração automatizados |

---

## 4. Segurança e Hardening

1. **Autenticação Segura com Tokens Bearer**:
   - Registro e login separados;
   - Senha mínima obrigatória (mínimo 6 caracteres);
   - Hash criptográfico com salteamento (salt) único por usuário via SHA-256;
   - Rotas `/api/sync/:userId` e `/api/auth/profile` exigem `Authorization: Bearer <token>`, eliminando vulnerabilidades de IDOR;
   - O hash da senha é removido em todas as respostas da API (`toSafeUser`).

2. **Proteção Anti-SSRF Estrita**:
   - Rotas de proxy de imagem (`/api/proxy-image`) e vídeo validam protocolo exclusivamente HTTPS;
   - Resolução de DNS prévia bloqueia qualquer endereço IP privado, loopback, link-local ou metadata de nuvem (`127.0.0.1`, `10.x`, `192.168.x`, `169.254.169.254`, `::1`);
   - Allowlist estrita de CDNs confiáveis (`image.tmdb.org`, `images.metahub.space`, `images.unsplash.com`, etc.).

3. **Rate Limiting em Memória**:
   - Limite por IP nas rotas de autenticação (20 requisições/minuto) e streaming (60 requisições/minuto);
   - Resposta HTTP 429 com cabeçalho `Retry-After`.

4. **Cabeçalhos de Segurança (`helmet`) & CORS**:
   - Cabeçalhos `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN` e `Cross-Origin-Resource-Policy`;
   - CORS restrito às origens permitidas via variável `ALLOWED_ORIGINS`.

---

## 5. Instalação e Execução Local

### Pré-requisitos
- Node.js 22.x ou superior.
- NPM 10+.

### Passos

1. Clone o repositório:
```bash
git clone https://github.com/guiffons/Popoca.git
cd Popoca
```

2. Instale as dependências:
```bash
npm install
```

3. Crie o arquivo `.env`:
```bash
cp .env.example .env
```

4. Inicie o servidor de desenvolvimento:
```bash
npm run dev
```
O aplicativo estará disponível em: [http://localhost:3000](http://localhost:3000)

---

## 6. Guia de Deploy

### Deploy com Docker Multi-Stage

O projeto inclui um `Dockerfile` multi-stage otimizado para produção, que compila o frontend e o backend em imagens separadas e roda sob o usuário não-root `node`:

```bash
# Construir a imagem Docker
docker build -t popoca-streaming:latest .

# Executar o container com montagem de volume persistente
docker run -d \
  --name popoca \
  -p 3000:3000 \
  -v popoca_data:/var/data \
  -e NODE_ENV=production \
  -e DATA_DIR=/var/data \
  -e JWT_SECRET=chave_secreta_super_forte_com_32_caracteres \
  popoca-streaming:latest
```

### Deploy no Render (com Disco Persistente)

O arquivo `render.yaml` já está configurado:
1. No dashboard do [Render](https://render.com), conecte seu repositório Git.
2. Adicione um **Persistent Disk** montado em `/var/data` (1 GB é suficiente para o banco SQLite).
3. Defina as variáveis de ambiente:
   - `NODE_ENV`: `production`
   - `DATA_DIR`: `/var/data`
   - `JWT_SECRET`: uma chave de pelo menos 32 caracteres gerada aleatoriamente.
4. O Render executará automaticamente `npm install && npm run build` e inicializará via `npm start`.

### Deploy Desacoplado no Vercel + Backend Render

Caso deseje hospedar o frontend estático no **Vercel** e o backend Node.js no **Render**:
1. No Vercel, aponte a variável `VITE_API_URL` para o endereço do seu backend no Render:
   ```
   VITE_API_URL=https://popoca-api.onrender.com
   ```
2. No backend Render, configure a variável `ALLOWED_ORIGINS` para incluir a URL gerada pelo Vercel:
   ```
   ALLOWED_ORIGINS=https://seu-app.vercel.app,http://localhost:3000
   ```

---

## 7. Variáveis de Ambiente

| Variável | Padrão | Descrição |
| :--- | :--- | :--- |
| `PORT` | `3000` | Porta onde o servidor HTTP escutará |
| `NODE_ENV` | `development` | Ambiente de execução (`development` ou `production`) |
| `DATA_DIR` | `./` | Caminho do diretório de persistência do SQLite |
| `CACHE_DIR` | `DATA_DIR/popoca-cache` | Diretório temporário dos blocos de torrent |
| `MAX_ACTIVE_TORRENTS` | `5` | Limite de motores torrent simultâneos em memória |
| `MAX_CACHE_BYTES` | `2147483648` (2 GB) | Limite máximo do cache de torrents em disco |
| `ALLOWED_ORIGINS` | `http://localhost:3000` | Origens autorizadas pelo CORS (separadas por vírgula) |
| `JWT_SECRET` | — | Segredo para assinatura de tokens de sessão |
| `VITE_API_URL` | `""` (mesma origem) | URL base do backend consumida pelo cliente Vite |

---

## 8. Comandos Disponíveis

```bash
# Iniciar o servidor de desenvolvimento full-stack (Vite + Express via tsx)
npm run dev

# Executar a suíte de 30 testes unitários automatizados
npm test

# Verificar tipos TypeScript estritos sem emitir arquivos
npm run lint

# Compilar frontend (dist) e backend (dist-server) para produção
npm run build

# Iniciar o servidor bundle compilado em produção
npm start

# Limpar artefatos de build e cache em disco
npm run clean
```

---

## 9. Migração e Limpeza de Segurança

- **Contas e Histórico**: Ao atualizar para versões recentes, as contas antigas sem senha não recebem credenciais padrão; qualquer conta legada é forçada a definir uma senha forte antes de autenticar.
- **Histórico do Git**: Nenhum dado sensível ou arquivo `.json` de usuários deve ser versionado. O arquivo `popoca-sync-data.json` foi devidamente removido do repositório e substituído por `popoca-sync-data.example.json` para demonstrações locais.
