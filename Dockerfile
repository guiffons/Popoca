# Multi-stage Dockerfile para Popoca Streaming
# Stage 1: Build Frontend (Vite) e Backend (esbuild)
FROM node:22-bookworm-slim AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

# Compila o frontend Vite (dist) e o servidor Express (dist-server)
RUN npm run build

# Stage 2: Imagem final de execução mínima e segura
FROM node:22-bookworm-slim AS runner

# Instala FFmpeg e dependências essenciais de mídia
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/var/data

# Instala apenas dependências de produção
COPY package*.json ./
RUN npm ci --omit=dev

# Copia artefatos compilados da etapa builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/dist-server ./dist-server
COPY --from=builder /app/popoca-sync-data.example.json ./

# Cria diretório de dados persistente com permissões para o usuário node
RUN mkdir -p /var/data && chown -R node:node /app /var/data

# Executa como usuário não-root por segurança
USER node

EXPOSE 3000

# Verificação contínua de integridade do container
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://localhost:3000/api/health || exit 1

# Inicializa o servidor bundle compilado
CMD ["node", "dist-server/server.js"]
