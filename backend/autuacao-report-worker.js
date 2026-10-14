// backend/autuacao-report-worker.js (Atualizado: Correção Inteligente de Fuso Horário)
const ExcelJS = require('exceljs');
const db = require('./database.js'); 
const pool = db; 
const path = require('path');
const cron = require('node-cron');
const fs = require('fs/promises');

require('dotenv').config({ path: path.join(__dirname, '.env') }); 

const REPORTS_DIR = path.join(__dirname, 'public', 'reports');
const FILE_PATH = path.join(REPORTS_DIR, 'relatorio-de-autuacao.xlsx');

const MAX_RETRIES = 3;
const RETRY_DELAY_MS = 15000;
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));

const yellowFill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFFF00' } 
};

// Estilo para linhas expiradas (Vermelho Claro)
const redFill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFFCCCC' } 
};

const deleteFileWithRetry = async () => {
    for (let i = 0; i < MAX_RETRIES; i++) {
        try {
            await fs.unlink(FILE_PATH);
            console.log("Planilha de autuação antiga excluída com sucesso.");
            return true;
        } catch (err) {
            if (err.code === 'ENOENT') {
                console.log("Planilha de autuação antiga não encontrada. Prosseguindo.");
                return true;
            }
            if (i < MAX_RETRIES - 1) {
                console.warn(`(Autuação) ERRO EBUSY na exclusão (tentativa ${i + 1}/${MAX_RETRIES}). A tentar novamente...`);
                await delay(RETRY_DELAY_MS);
            } else {
                console.error(`(Autuação) ERRO FATAL na exclusão: O arquivo permanece bloqueado.`, err);
                return false;
            }
        }
    }
};

const generateAutuacaoReport = async () => {
    console.log(`[${new Date().toLocaleString('pt-BR')}] Executando worker de relatório de Autuação...`);
    
    try {
        await fs.mkdir(REPORTS_DIR, { recursive: true });
        const deleteSuccess = await deleteFileWithRetry();
        if (!deleteSuccess) {
            console.error("(Autuação) Não foi possível garantir o acesso ao arquivo. Cancelando o relatório.");
            return;
        }
    } catch (dirError) {
        console.error("Erro fatal ao criar o diretório de relatórios:", dirError);
        return;
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Autuações');

    worksheet.columns = [
        { header: 'Usuário', key: 'username', width: 25 },
        { header: 'Nome da Imagem', key: 'image_filename', width: 50 },
        { header: 'Placa do Veículo', key: 'license_plate', width: 20 },
        { header: 'Tipo da Infração', key: 'infraction_type', width: 40 },
        { header: 'Data e Hora da Autuação', key: 'autuado_em', width: 25 },
        { header: 'Placa Editada', key: 'is_edited_text', width: 15 },
    ];

    // UNION ALL para incluir as expiradas
    const sql = `
        SELECT
            u.username,
            e.image_filename,
            ai.license_plate,
            ai.infraction_type,
            ai.autuado_em,
            ai.is_edited,
            'normal' as row_type
        FROM autuadas_infractions ai
        JOIN evidences e ON ai.evidence_id = e.id
        JOIN users u ON ai.autuado_por_user_id = u.id
        
        UNION ALL
        
        SELECT
            'SISTEMA (Expirado)' as username,
            e.image_filename,
            e.license_plate,
            'PRAZO EXPIRADO (>24h)' as infraction_type,
            (e.processed_at + INTERVAL '24 HOUR') as autuado_em,
            false as is_edited,
            'expired' as row_type
        FROM evidences e
        WHERE e.status = 'Validada'
        AND e.processed_at < (NOW() - INTERVAL '24 HOUR')
        
        ORDER BY autuado_em DESC
    `;

    try {
        const result = await pool.query(sql);
        const rows = result.rows;

        if (rows.length === 0) {
            console.log("Nenhuma infração Autuada ou Expirada para reportar.");
            worksheet.addRow({ username: 'Nenhum dado encontrado.' });
        } else {
             rows.forEach(row => {
                let autuacaoDate = new Date(row.autuado_em);
                
                // [CORREÇÃO INTELIGENTE DE FUSO HORÁRIO]
                // Se estiver no futuro (>10min), subtrai 3h
                if (autuacaoDate.getTime() > new Date().getTime() + (10 * 60 * 1000)) {
                    autuacaoDate = new Date(autuacaoDate.getTime() - (3 * 60 * 60 * 1000));
                }

                const formattedDate = autuacaoDate.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });

                const newRow = worksheet.addRow({
                    username: row.username,
                    image_filename: row.image_filename ? path.basename(row.image_filename) : 'Imagem Expirada/Removida',
                    license_plate: row.license_plate,
                    infraction_type: row.infraction_type,
                    autuado_em: formattedDate,
                    is_edited_text: row.is_edited ? 'Sim' : 'Não'
                });
                
                // Aplica cor amarela se editado, ou vermelha se expirado
                if (row.row_type === 'expired') {
                    newRow.fill = redFill;
                } else if (row.is_edited) {
                    newRow.fill = yellowFill;
                }
            });
        }
       
        for (let i = 0; i < MAX_RETRIES; i++) {
            try {
                await workbook.xlsx.writeFile(FILE_PATH);
                console.log("Relatório de Autuação salvo com sucesso.");
                return;
            } catch (err) {
                if (err.code === 'EBUSY' && i < MAX_RETRIES - 1) {
                    console.warn(`(Autuação) ERRO EBUSY na escrita (tentativa ${i + 1}/${MAX_RETRIES}). A tentar novamente...`);
                    await delay(RETRY_DELAY_MS);
                } else {
                    console.error("ERRO FINAL ao salvar a planilha de Autuação:", err);
                    return;
                }
            }
        }
    } catch (err) {
        console.error("ERRO ao gerar o relatório de Autuação:", err);
    }
};

db.ready.then(() => {
    console.log('Database está pronto, iniciando o autuacao-report worker.');
    // Roda a cada 5 minutos
    cron.schedule('*/5 * * * *', () => {
        generateAutuacaoReport();
    }, { scheduled: true, timezone: "America/Sao_Paulo" });

    console.log('Agendador do Relatório de Autuação configurado para rodar a cada 5 minutos.');
    generateAutuacaoReport();
}).catch(err => {
    console.error("Autuacao-report-worker não pôde iniciar:", err);
});