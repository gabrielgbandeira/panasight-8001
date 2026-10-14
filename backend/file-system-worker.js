// backend/file-system-worker.js
const path = require("path");
const fs = require("fs/promises");
const fsSync = require("fs");
const crypto = require("crypto");
const cron = require('node-cron');
const db = require("./database.js"); 
const pool = db; 
const ffmpeg = require('fluent-ffmpeg'); 

require("dotenv").config({ path: path.join(__dirname, '.env') });

const INBOX_PATH = path.join(__dirname, "..", "images", "inbox");
const PROCESSED_PATH = path.join(__dirname, "..", "images", "processed");
const RELATIVE_PROCESSED_PATH = path.join("processed");

const sanitizeFilename = (name) => {
    name = name.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); 
    name = name.replace(/[^a-zA-Z0-9_\-.]/g, '_'); 
    name = name.replace(/_+/g, '_'); 
    return name.toLowerCase();
};

// --- FUNÇÃO DE PROCESSAMENTO DE VÍDEO (ESTRATÉGIA BLINDADA) ---
function processVideo(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        
        // Estratégia 1: Tentar detectar formato automaticamente (padrão)
        // com buffer de análise aumentado
        const runAttempt = (formatStrategy) => {
            let command = ffmpeg(inputPath);

            if (formatStrategy === 'h264') {
                // FORÇA BRUTA: Diz que é H264 Cru (Comum em .dav Dahua/Intelbras)
                command.inputOptions(['-f h264']);
            } else if (formatStrategy === 'hevc') {
                // FORÇA BRUTA: Diz que é H265 Cru (Câmeras mais novas)
                command.inputOptions(['-f hevc']);
            }

            command
                .inputOptions([
                    '-analyzeduration 100M', 
                    '-probesize 100M'
                ])
                .setStartTime(0)
                .setDuration(1) // Pega apenas 1 segundo
                .outputOptions([
                    '-c:v libx264',      // Garante saída MP4 compatível
                    '-pix_fmt yuv420p',  // Garante cor correta
                    '-preset ultrafast', // Processamento rápido
                    '-movflags +faststart',
                    '-y' // Sobrescreve
                ])
                .save(outputPath)
                .on('end', () => resolve(outputPath))
                .on('error', (err) => {
                    // Lógica de Retry (Tentativa e Erro)
                    if (formatStrategy === 'auto') {
                        console.warn(`[FFMPEG] Auto-detect falhou para ${path.basename(inputPath)}. Tentando forçar H.264...`);
                        runAttempt('h264');
                    } else if (formatStrategy === 'h264') {
                        console.warn(`[FFMPEG] H.264 falhou. Tentando forçar HEVC/H.265...`);
                        runAttempt('hevc');
                    } else {
                        // Se falhou em tudo, desiste
                        reject(new Error(`Falha fatal após todas as tentativas: ${err.message}`));
                    }
                });
        };

        // Inicia com detecção automática (alguns .dav têm cabeçalho)
        // Se falhar, a função chama a si mesma com 'h264', depois 'hevc'
        // Mas para seus logs atuais, vamos começar DIRETO com 'h264' pois 'auto' já falhou
        runAttempt('h264'); 
    });
}

// Busca Recursiva 
async function getFilesRecursively(dir) {
    let results = [];
    try {
        const list = await fs.readdir(dir, { withFileTypes: true });
        for (const file of list) {
            const fullPath = path.join(dir, file.name);
            if (file.isDirectory()) {
                results = results.concat(await getFilesRecursively(fullPath));
            } else if (file.isFile()) {
                // Aceita vídeos DAV e formatos comuns
                if (file.name.toLowerCase().match(/\.(dav|mp4|avi|mov|mkv)$/)) {
                    results.push(fullPath);
                } else if (file.name.toLowerCase().match(/\.(jpg|jpeg|png)$/)) {
                    results.push(fullPath);
                }
            }
        }
    } catch (err) {
        console.error(`Erro ao ler pasta ${dir}:`, err.message);
    }
    return results;
}

// Limpeza de pastas vazias
async function cleanEmptyFolders(folder) {
    if (!fsSync.existsSync(folder)) return;
    let isDir = false;
    try { const stats = await fs.stat(folder); isDir = stats.isDirectory(); } catch { return; }
    if (!isDir) return;

    let files = await fs.readdir(folder);
    if (files.length > 0) {
        for (const file of files) {
            await cleanEmptyFolders(path.join(folder, file));
        }
        files = await fs.readdir(folder);
    }
    if (files.length === 0 && folder !== INBOX_PATH) {
        try { await fs.rmdir(folder); } catch (err) { }
    }
}

async function processInbox() {
    console.log(`[${new Date().toLocaleString('pt-BR')}] Processando Mídia (Modo DAV Robusto)...`);
    
    try {
        await fs.mkdir(INBOX_PATH, { recursive: true });
        await fs.mkdir(PROCESSED_PATH, { recursive: true });

        const allFiles = await getFilesRecursively(INBOX_PATH);
        
        if (allFiles.length > 0) {
            console.log(`[FileSystem] 📂 Arquivos encontrados no inbox: ${allFiles.length}`);
        }

        const images = allFiles.filter(f => f.match(/\.(jpg|jpeg|png)$/i));
        const videos = allFiles.filter(f => f.match(/\.(dav|mp4|avi|mov|mkv)$/i));

        if (allFiles.length === 0) {
            await cleanEmptyFolders(INBOX_PATH);
            return;
        }

        // --- FASE 1: Imagens ---
        for (const imgPath of images) {
            const relativePath = path.relative(INBOX_PATH, imgPath);
            const pathParts = relativePath.split(path.sep);
            
            let cameraId = 'CAM_DEFAULT';
            if (pathParts.length > 1) {
                cameraId = pathParts[0];
            } else {
                 const filenameParts = path.basename(imgPath).split('_');
                 if (filenameParts.length > 1) cameraId = filenameParts[0];
            }

            // [DEBUG] Diagnóstico de identificação de Câmera
            console.log(`[DEBUG] Arquivo: ${relativePath} | Pasta: ${pathParts[0]} | CameraID Final: ${cameraId}`);

            const stats = await fs.stat(imgPath);
            const captureTimestamp = stats.mtime;
            const ext = path.extname(imgPath);
            const newName = `${sanitizeFilename(cameraId)}_${captureTimestamp.getTime()}_${crypto.randomUUID()}${ext}`;
            const newPath = path.join(PROCESSED_PATH, newName);
            const dbPath = path.posix.join(RELATIVE_PROCESSED_PATH, newName);

            try {
                await fs.rename(imgPath, newPath);
                await pool.query(
                    "INSERT INTO evidences (image_filename, original_filepath, capture_timestamp, status, camera_id) VALUES ($1, $2, $3, $4, $5)",
                    [dbPath, imgPath, captureTimestamp, "Pendente", cameraId]
                );
                console.log(`[FOTO] Processada: ${newName}`);
            } catch (err) {
                console.error(`Erro foto ${imgPath}:`, err.message);
            }
        }

        // --- FASE 2: Vídeos ---
        for (const vidPath of videos) {
            const relativePath = path.relative(INBOX_PATH, vidPath);
            const pathParts = relativePath.split(path.sep);
            let cameraId = pathParts.length > 1 ? pathParts[0] : 'CAM_DEFAULT';

            const stats = await fs.stat(vidPath);
            const videoTime = stats.mtime;

            const mp4Name = `${sanitizeFilename(cameraId)}_VIDEO_1s_${videoTime.getTime()}_${crypto.randomUUID()}.mp4`;
            const mp4Path = path.join(PROCESSED_PATH, mp4Name);
            const dbMp4Path = path.posix.join(RELATIVE_PROCESSED_PATH, mp4Name);

            console.log(`[VIDEO] Processando: ${path.basename(vidPath)}`);
            
            try {
                // Tenta processar com a nova lógica robusta
                await processVideo(vidPath, mp4Path);
                
                // Remove original após sucesso
                await fs.unlink(vidPath);

                const sqlLink = `
                    UPDATE evidences 
                    SET video_filename = $1 
                    WHERE camera_id = $2 
                    AND video_filename IS NULL
                    AND capture_timestamp BETWEEN $3::timestamp - INTERVAL '10 seconds' AND $3::timestamp + INTERVAL '10 seconds'
                    RETURNING id
                `;
                
                const res = await pool.query(sqlLink, [dbMp4Path, cameraId, videoTime]);

                if (res.rowCount > 0) {
                    console.log(`[SUCESSO] Vídeo vinculado! ID: ${res.rows[0].id}`);
                } else {
                    console.log(`[ORFAO] Vídeo salvo, sem foto compatível.`);
                }

            } catch (err) {
                console.error(`❌ FALHA TOTAL no vídeo ${path.basename(vidPath)}:`, err.message);
                // Opcional: Mover arquivo corrompido para uma pasta 'quarentena' para não travar o loop
            }
        }

        await cleanEmptyFolders(INBOX_PATH);

    } catch (err) {
        console.error("ERRO GERAL Worker:", err);
    }
}

db.ready.then(() => {
    console.log('Worker Iniciado (Modo .DAV Force H264).');
    cron.schedule('*/1 * * * *', () => processInbox(), { scheduled: true, timezone: "America/Sao_Paulo" });
    processInbox(); 
}).catch(console.error);