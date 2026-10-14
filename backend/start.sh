#!/bin/bash

echo "--> [START] Iniciando PanaSight com PM2..."

# O npx usa o binário do pm2 instalado localmente no node_modules
# Isso evita ter que instalar globalmente no Dockerfile
exec npx pm2-runtime start ecosystem.config.js