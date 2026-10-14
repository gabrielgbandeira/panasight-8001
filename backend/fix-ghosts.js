// backend/fix-ghosts.js
const db = require('./database.js'); 
const pool = db; 
const path = require('path');
const fs = require('fs');
const cron = require('node-cron');

require('dotenv').config({ path: path.join(__dirname, '.env') }); 

// Caminho absoluto dentro do container Docker
const IMAGES_ROOT_DIR = '/usr/src/app/images';

const runFix = async () => {
    console.log(`[${new Date().toLocaleString('pt-BR')}] 👻 GhostBuster: Verificando integridade (Processamento + Autuação)...`);
    
    let client;
    try {
        client = await pool.connect();
        
        // [ATUALIZAÇÃO] Agora busca Pendente (Processamento) E Validada (Autuação)
        const sql = `
            SELECT id, image_filename, video_filename 
            FROM evidences 
            WHERE status IN ('Pendente', 'Validada')
        `;
        
        const result = await client.query(sql);
        const records = result.rows;

        // console.log(`🔎 Analisando ${records.length} registros ativos...`);

        let ghostCount = 0;
        const idsToExpire = [];

        for (const row of records) {
            let isGhost = false;

            // Verifica IMAGEM
            if (row.image_filename) {
                const cleanPath = row.image_filename.replace(/^\/|\\/, ''); 
                const fullPath = path.join(IMAGES_ROOT_DIR, cleanPath);
                
                // Verifica na raiz e na pasta processed
                const existsDirect = fs.existsSync(fullPath);
                const existsProcessed = fs.existsSync(path.join(IMAGES_ROOT_DIR, 'processed', path.basename(cleanPath)));

                // Se não existir em lugar nenhum, é fantasma
                if (!existsDirect && !existsProcessed) {
                    // console.log(`❌ Imagem sumiu: ${cleanPath} (ID: ${row.id})`);
                    isGhost = true;
                }
            }

            if (isGhost) {
                idsToExpire.push(row.id);
                ghostCount++;
            }
        }

        if (idsToExpire.length > 0) {
            console.log(`🧹 GhostBuster: Removendo ${idsToExpire.length} itens inexistentes dos painéis...`);
            
            // Marca como 'Expirada' para sumir das duas listas
            const updateSql = `
                UPDATE evidences 
                SET status = 'Expirada' 
                WHERE id = ANY($1::int[])
            `;
            await client.query(updateSql, [idsToExpire]);
            console.log("✅ Limpeza concluída.");
        } 

    } catch (err) {
        console.error("🔥 Erro no GhostBuster:", err);
    } finally {
        if (client) client.release();
    }
};

db.ready.then(() => {
    console.log('👻 Worker Caça-Fantasmas Iniciado (Automático - 10min).');
    
    // Roda a cada 10 minutos
    cron.schedule('*/10 * * * *', () => {
        runFix();
    }, { scheduled: true, timezone: "America/Sao_Paulo" });

    // Roda uma vez imediatamente ao iniciar
    runFix();
}).catch(console.error);