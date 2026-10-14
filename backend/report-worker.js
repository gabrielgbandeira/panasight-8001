// backend/report-worker.js (Atualizado: Correção Inteligente de Fuso Horário)
const ExcelJS = require('exceljs');
const db = require('./database.js'); 
const pool = db; 
const path = require('path');
const cron = require('node-cron');
const fs = require('fs/promises');

require('dotenv').config({ path: path.join(__dirname, '.env') }); 

const REPORTS_DIR = path.join(__dirname, 'public', 'reports');
const FILE_PATH = path.join(REPORTS_DIR, 'relatorio-de-infracoes.xlsx');
const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 15000; 

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const deleteFileWithRetry = async () => {
    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            await fs.unlink(FILE_PATH);
            console.log("Planilha antiga excluída com sucesso.");
            return true;
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.log("Planilha antiga não encontrada. Prosseguindo com a criação.");
                return true;
            }
            if (i < MAX_RETRIES - 1) {
                console.warn(`ERRO EBUSY na exclusão (tentativa ${i + 1}/${MAX_RETRIES}). A tentar excluir novamente em ${RETRY_DELAY_MS / 1000}s...`);
                await delay(RETRY_DELAY_MS);
            } else {
                console.error("ERRO FINAL ao excluir a planilha antiga:", err);
                return false;
            }
        }
    }
    return false;
};

const generateReport = async () => {
    console.log(`[${new Date().toLocaleString('pt-BR')}] 📊 Gerando Relatório Geral de Infrações...`);

    try {
        if (!(await deleteFileWithRetry())) {
            console.error("Abortando geração do relatório: arquivo anterior está bloqueado.");
            return;
        }

        const workbook = new ExcelJS.Workbook();
        const worksheet = workbook.addWorksheet('Infrações');

        worksheet.columns = [
            { header: 'DATA', key: 'data', width: 15 },
            { header: 'HORÁRIO', key: 'horario', width: 12 },
            { header: 'PLACA', key: 'placa', width: 12 },
            { header: 'STATUS', key: 'status', width: 25 },
            { header: 'CÂMERA', key: 'camera', width: 15 },
            { header: 'LINK IMAGEM', key: 'link', width: 40 },
            { header: 'ID EVIDÊNCIA', key: 'evidence_id', width: 15 }
        ];

        // QUERY ATUALIZADA: Puxa o status para refletir se expirou na Triagem ou Autuação
        const sql = `
            SELECT id, license_plate, camera_id, created_at, status
            FROM evidences
            ORDER BY created_at DESC
        `;

        const result = await pool.query(sql);
        const rows = result.rows;

        rows.forEach(row => {
            const dataOriginal = new Date(row.created_at);
            const dataFormatada = dataOriginal.toLocaleDateString('pt-BR');
            const horaFormatada = dataOriginal.toLocaleTimeString('pt-BR');

            const imageUrl = row.status.includes('Expirada') 
                ? 'IMAGEM EXCLUÍDA' 
                : `${process.env.BASE_URL || 'http://localhost:3000'}/images/${row.id}`;

            worksheet.addRow({
                data: dataFormatada,
                horario: horaFormatada,
                placa: row.license_plate,
                status: row.status, // Aqui aparecerá 'Expirada (Triagem)', etc.
                camera: row.camera_id || 'N/A', 
                link: { text: row.status.includes('Expirada') ? 'N/A' : 'Ver Imagem', hyperlink: imageUrl },
                evidence_id: row.id 
            });
        });
        
        for (let i = 0; i < MAX_RETRIES; i++) {
            try {
                await workbook.xlsx.writeFile(FILE_PATH);
                console.log("Planilha de infrações recriada com sucesso.");
                return;
            } catch (err) {
                if (err.code === 'EBUSY' && i < MAX_RETRIES - 1) {
                    console.warn(`ERRO EBUSY na escrita (tentativa ${i + 1}/${MAX_RETRIES}). Tentando novamente em ${RETRY_DELAY_MS / 1000}s...`);
                    await delay(RETRY_DELAY_MS);
                } else {
                    console.error("ERRO FINAL ao salvar a planilha de infrações:", err);
                    return;
                }
            }
        }
    } catch (err) {
        console.error("ERRO ao gerar o relatório de infrações (query):", err);
    }
};

db.ready.then(() => {
    console.log('Database está pronto, iniciando o report worker.');
    
    cron.schedule('*/3 * * * *', () => {
        generateReport();
    }, { scheduled: true, timezone: "America/Sao_Paulo" });

    console.log('Agendador do Report Worker configurado para rodar a cada 3 minutos.');
    generateReport();
}).catch(err => {
    console.error("Erro ao iniciar Report Worker:", err);
});