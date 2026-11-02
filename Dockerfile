# Dockerfile para Popoca Streaming
# Compatível com Render, Railway, Fly.io, Koyeb e VPS Linux (Docker)
FROM node:22-bookworm-slim

# Instala FFmpeg e dependências de sistema para streaming de mídia e aceleração
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    ca-certificates \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Instala dependências do projeto
COPY package*.json ./
RUN npm install

# Copia todo o código fonte
COPY . .

# Compila o frontend Vite para produção
RUN npm run build

# Configuração de ambiente de produção
ENV NODE_ENV=production
ENV PORT=3000

# Porta padrão de escuta
EXPOSE 3000

# Inicializa o servidor Full-Stack (Express + P2P Torrent Engine + Vite Prod)
CMD ["npm", "start"]
