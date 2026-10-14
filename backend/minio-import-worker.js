// backend/minio-import-worker.js
const { S3Client, ListObjectsV2Command, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { pipeline } = require('stream/promises'); 
const db = require('./database.js'); 

require('dotenv').config({ path: path.join(__dirname, '.env') });

// Configuração do Cliente S3 (MinIO)
const s3Client = new S3Client({
    endpoint: process.env.MINIO_ENDPOINT, 
    region: process.env.MINIO_REGION || "us-east-1",
    credentials: {
        accessKeyId: process.env.MINIO_ACCESS_KEY,
        secretAccessKey: process.env.MINIO_SECRET_KEY
    },
    forcePathStyle: true, 
    tls: true 
});

const BUCKET_NAME = process.env.MINIO_BUCKET;
const INBOX_DIR = path.join(__dirname, '../images/inbox');

// Garante que o inbox existe
if (!fs.existsSync(INBOX_DIR)) {
    fs.mkdirSync(INBOX_DIR, { recursive: true });
}

const runMinioImport = async () => {
    console.log(`[MinIO] 📡 Verificando bucket: ${BUCKET_NAME}...`);

    try {
        const listCmd = new ListObjectsV2Command({
            Bucket: BUCKET_NAME,
            MaxKeys: 50 
        });

        const data = await s3Client.send(listCmd);

        if (!data.Contents || data.Contents.length === 0) {
            return;
        }

        console.log(`[MinIO] 📥 Encontrados ${data.Contents.length} arquivos...`);

        for (const item of data.Contents) {
            const key = item.Key; 

            // Ignorar objetos que são apenas pastas
            if (key.endsWith('/')) continue;
            
            if (!key.match(/\.(jpg|jpeg|png|mp4|dav|avi|mkv)$/i)) {
                console.log(`[MinIO] ⚠️ Ignorando arquivo (Extensão não suportada): ${key}`);
                continue;
            }

            // --- LÓGICA DE PASTAS CORRIGIDA ---
            // 1. Identifica a pasta de origem (Ex: "PTZ-30")
            const directory = path.dirname(key);
            const filename = path.basename(key);

            // 2. Define o caminho local mantendo a estrutura
            // Se directory for ".", salva na raiz, senão cria a subpasta
            const localTargetDir = directory === '.' ? INBOX_DIR : path.join(INBOX_DIR, directory);
            const localFilePath = path.join(localTargetDir, filename);

            // 3. Cria a pasta local se não existir (Ex: inbox/PTZ-30)
            if (!fs.existsSync(localTargetDir)) {
                console.log(`[MinIO] 📂 Criando pasta local: ${directory}`);
                fs.mkdirSync(localTargetDir, { recursive: true });
            }

            console.log(`[MinIO] Baixando: ${key}`);
            
            try {
                const getCmd = new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key });
                const { Body } = await s3Client.send(getCmd);

                await pipeline(Body, fs.createWriteStream(localFilePath));

                // Deletar do MinIO após sucesso
                const delCmd = new DeleteObjectCommand({ Bucket: BUCKET_NAME, Key: key });
                await s3Client.send(delCmd);

                console.log(`[MinIO] ✅ Sucesso: ${filename}`);

            } catch (err) {
                console.error(`[MinIO] ❌ Erro em ${key}:`, err.message);
                if (fs.existsSync(localFilePath)) fs.unlinkSync(localFilePath);
            }
        }

    } catch (err) {
        console.error("[MinIO] 🔥 Erro fatal na conexão:", err.message);
    }
};

db.ready.then(() => {
    console.log('🚀 MinIO Import Worker Iniciado.');
    cron.schedule('*/1 * * * *', () => { runMinioImport(); }, { scheduled: true });
    runMinioImport();
});