module.exports = {
  apps : [
    {
      name: "API-Server",
      script: "./backend/server.js",   
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '1G',
      env: { NODE_ENV: "production" }
    },
    {
      name: "Worker-MinIO-Import",
      script: "./backend/minio-import-worker.js",
      autorestart: true,
      env: {
        NODE_ENV: "production",
        MINIO_ENDPOINT: "https://minio.panavideo.com.br",
        MINIO_ACCESS_KEY: "vo1hNco8wasuJY5kJv3X",
        MINIO_SECRET_KEY: "GDfxZsSZIAsVCCvvbxYNfp6N8YCyzitd3ZFwixu3",
        MINIO_BUCKET: "siga",
        MINIO_REGION: "us-east-1"
      }
    }, 
    {
      name: "Worker-FileSystem",
      script: "./backend/file-system-worker.js",
      autorestart: true
    },
    {
      name: "Worker-Cleanup",
      script: "./backend/cleanup-worker.js",
      autorestart: true
    },
    {
      name: "Worker-Reports",
      script: "./backend/report-worker.js",
      autorestart: true
    },
    {
      name: "Worker-Autuacao",
      script: "./backend/autuacao-report-worker.js",
      autorestart: true
    },
    {
      name: "Worker-GhostBuster",
      script: "./backend/fix-ghosts.js",
      autorestart: true
    },
    {
      name: "Worker-Detran-FTP",
      script: "./backend/DETRAN-TO-import-worker.js",
      autorestart: true
    }
  ]
};