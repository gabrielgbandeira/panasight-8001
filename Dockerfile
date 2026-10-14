FROM node:20-slim

# Instala utilitários básicos do sistema
# [ATUALIZADO] Adicionado 'tzdata' para corrigir o fuso horário (UTC-3)
RUN apt-get update && apt-get install -y --no-install-recommends \
    bash \
    ffmpeg \
    procps \
    tzdata \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /usr/src/app

# Copia dependências e instala
COPY package*.json ./
RUN npm install --omit=dev --no-cache

# Copia todo o código fonte
COPY . .
RUN if [ -f backend/server.js.dump ]; then cp backend/server.js.dump backend/server.js; fi

# Garante permissão de execução no script de start
RUN chmod +x backend/start.sh

EXPOSE 3000

# Usa o script shell para iniciar todos os processos
CMD ["npm", "run", "docker-start"]