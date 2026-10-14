# Workspace Context — PanaSight 8001

## 1. Runtime & Stack Detection
- **Runtime:** Node.js (v18+ / v20+)
- **Process Manager:** PM2 (via `ecosystem.config.js`)
- **Container Engine:** Docker & Docker Compose
- **Database:** PostgreSQL 16 Alpine (`postgres:16-alpine`, pool `pg`)
- **Port Mappings:**
  - Frontend / Web App Proxy: `http://localhost:8001`
  - Backend Interno: `3000`
  - PostgreSQL: `5432`

## 2. Command Scripts (Mirrored from manifests)
- Iniciar Produção Local (Node): `npm start` (executa `node backend/server.js`)
- Iniciar Desenvolvimento: `npm run dev` (executa `nodemon backend/server.js`)
- Iniciar com PM2 (Docker/Prod): `bash backend/start.sh` ou `npm run docker-start`
- Iniciar via Docker Compose: `docker-compose up -d`
- Status dos Workers PM2: `npx pm2 status`
- Logs do PM2: `npx pm2 logs`

## 3. Diretórios Críticos
- `backend/`: Endpoints Express, conexão Postgres e workers PM2
- `frontend/`: Aplicação web vanilla (HTML/CSS/JS)
- `images/`: Evidências originais e tarjadas/redigidas
- `postgres_data/`: Volume de persistência do PostgreSQL
