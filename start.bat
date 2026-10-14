@echo off
echo =======================================================
echo 🚀 Iniciando PanaSight e abrindo no navegador...
echo =======================================================
docker compose up -d --build
echo.
echo 🌐 Abrindo http://localhost:8001 no navegador...
start http://localhost:8001
