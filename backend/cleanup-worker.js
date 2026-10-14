// backend/cleanup-worker.js
const db = require('./database.js'); 
const pool = db; 
const path = require('path');
const cron = require('node-cron');
const fs = require('fs/promises');

require('dotenv').config({ path: path.join(__dirname, '.env') }); 

// CAMINHOS ABSOLUTOS DENTRO DO DOCKER
const IMAGES_ROOT_DIR = '/usr/src/app/images';
const INBOX_DIR = path.join(IMAGES_ROOT_DIR, 'inbox');
const UPLOADS_DIR = '/usr/src/app/uploads'; // Diretório temporário do Multer

// Função auxiliar para varrer e deletar arquivos órfãos (físicos)
const sweepOrphanFiles = async (dirPath, maxAgeMs) => {
    try {
        await fs.access(dirPath);
        const files = await fs.readdir(dirPath);
        const now = Date.now();
        let count = 0;

        for (const file of files) {
            const fullPath = path.join(dirPath, file);
            const stats = await fs.stat(fullPath);
            
            // Se for arquivo e for mais velho que o maxAgeMs, deleta
            if (stats.isFile() && (now - stats.mtimeMs > maxAgeMs)) {
                await fs.unlink(fullPath);
                count++;
            }
        }
        if (count > 0) console.log(`🧹 Varredura: ${count} arquivos órfãos removidos de ${dirPath}`);
    } catch (err) {
        // Ignora erro se a pasta não existir ainda
        if (err.code !== 'ENOENT') {
            console.error(`Erro ao varrer diretório ${dirPath}:`, err.message);
        }
    }
};

const runCleanup = async () => {
    console.log(`[${new Date().toLocaleString('pt-BR')}] 🧹 CHECK: Iniciando rotina de limpeza avançada...`);
    
    // 1. Limpeza Física de Órfãos (Arquivos sem registro no banco que ficaram presos)
    const TWENTY_FOUR_HOURS = 24 * 60 * 60 * 1000;
    await sweepOrphanFiles(INBOX_DIR, TWENTY_FOUR_HOURS);
    await sweepOrphanFiles(UPLOADS_DIR, TWENTY_FOUR_HOURS);
    
    // 2. Limpeza via Banco de Dados (Processamento em Lotes)
    let client;
    try {
        client = await pool.connect();
        let totalProcessed = 0;
        let hasMore = true;

        // Loop para esvaziar a fila inteira em blocos de 1000, evitando limite de 600/hora
        while (hasMore) {
            const sql = `
                SELECT id, image_filename, video_filename, redacted_filename, created_at, status
                FROM evidences 
                WHERE status NOT LIKE 'Expirada%' 
                AND created_at < NOW() - INTERVAL '24 hours'
                LIMIT 1000
            `;

            const result = await client.query(sql);
            const filesToExpire = result.rows;

            if (filesToExpire.length === 0) {
                hasMore = false;
                continue;
            }

            const idsToUpdate = [];

            for (const row of filesToExpire) {
                const filesToDelete = [row.image_filename, row.video_filename, row.redacted_filename];
                
                for (const fileName of filesToDelete) {
                    if (!fileName) continue;

                    const cleanRelative = fileName.replace(/^\/?images\//, '');
                    const fullPath = path.join(IMAGES_ROOT_DIR, cleanRelative);

                    try {
                        await fs.unlink(fullPath);
                    } catch (err) {
                        if (err.code !== 'ENOENT') {
                            console.error(`❌ ERRO ao deletar ${fullPath}:`, err.message);
                        }
                    }
                }
                idsToUpdate.push(row.id);
            }

            if (idsToUpdate.length > 0) {
                const updateSql = `
                    UPDATE evidences 
                    SET status = CASE 
                        WHEN status = 'Pendente' THEN 'Expirada (Triagem)'
                        WHEN status = 'Validada' THEN 'Expirada (Autuação)'
                        ELSE 'Expirada'
                    END, 
                    image_filename = NULL, 
                    video_filename = NULL, 
                    redacted_filename = NULL 
                    WHERE id = ANY($1::int[])
                `;
                await client.query(updateSql, [idsToUpdate]);
                totalProcessed += idsToUpdate.length;
            }
        }

        if (totalProcessed > 0) {
            console.log(`🏁 DB Atualizado: ${totalProcessed} registros marcados com status de expiração detalhado.`);
        } else {
            console.log("✅ Limpeza DB: Nenhum arquivo expirado pendente.");
        }

    } catch (err) {
        console.error("🔥 ERRO FATAL no Cleanup Worker:", err);
    } finally {
        if (client) client.release();
    }
};

db.ready.then(() => {
    console.log('🗑️ Cleanup Worker (24h) Iniciado.');
    
    cron.schedule('*/10 * * * *', () => {
        runCleanup();
    }, { scheduled: true, timezone: "America/Sao_Paulo" });

    runCleanup(); 
}).catch(err => {
    console.error("Erro ao iniciar Cleanup Worker:", err);
});