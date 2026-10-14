const fs = require('fs');
const path = require('path');
const readline = require('readline');
const cron = require('node-cron');
const ftp = require('basic-ftp'); // NECESSÁRIO: npm install basic-ftp
const db = require('./database'); 

require('dotenv').config({ path: path.join(__dirname, '.env') });

const TIPO_ARQUIVO = {
    FROTA: 'FROTA',
    MODELO: 'MARCA_MODELO',
    ROUBO: 'ROUBO_FURTO'
};

const ORIGEM = {
    MANUAL: 'MANUAL',
    AUTO: 'AUTOMATICO'
};

// Pasta temporária para baixar arquivos antes de processar
const TEMP_DIR = path.join(__dirname, '../temp_import');

// Garante que a pasta temporária existe
if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
}

function detectarTipo(nomeArquivo) {
    if (nomeArquivo.includes('ArquivoFrotaPrefeituraPalmas')) return TIPO_ARQUIVO.FROTA;
    if (nomeArquivo.includes('ArquivoMarcaModeloPrefeituraPalmas')) return TIPO_ARQUIVO.MODELO;
    if (nomeArquivo.includes('ArquivoVeiculosComRouboFurto')) return TIPO_ARQUIVO.ROUBO;
    return 'DESCONHECIDO';
}

const safeInt = (val) => {
    if (!val || val.trim() === '') return null;
    const parsed = parseInt(val);
    return isNaN(parsed) ? null : parsed; 
};

// --- FUNÇÃO CORE DE PROCESSAMENTO ---
async function processarArquivo(caminhoLocal, origem, usuarioId, dataArquivoFTP = new Date()) {
    const nomeArquivo = path.basename(caminhoLocal);
    const tipo = detectarTipo(nomeArquivo);
    const stats = { total: 0, inseridos: 0, arquivo: nomeArquivo };

    console.log(`\n=== [IMPORTADOR] Processando: ${nomeArquivo} (${origem}) ===`);

    if (tipo === 'DESCONHECIDO') {
        throw new Error('Nome de arquivo fora do padrão DETRAN.');
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');
        
        // Configura Fuso Horário
        await client.query("SET TIME ZONE 'America/Sao_Paulo'");

        const stream = fs.createReadStream(caminhoLocal, { encoding: 'latin1' });
        const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });

        if (tipo === TIPO_ARQUIVO.MODELO) {
            for await (const line of rl) {
                if(line.trim()) { 
                    stats.total++;
                    const p = line.split('|');
                    if (p.length >= 2) {
                        const codigo = safeInt(p[0]);
                        if (codigo !== null) {
                            await client.query(`
                                INSERT INTO detran_modelos (codigo, descricao) VALUES ($1, $2)
                                ON CONFLICT (codigo) DO UPDATE SET descricao = $2
                            `, [codigo, p[1].trim()]);
                            stats.inseridos++;
                        }
                    }
                }
            }
        } 
        else if (tipo === TIPO_ARQUIVO.ROUBO) {
             // Para roubos, a lista é completa, então limpamos a anterior (snapshot)
             await client.query('TRUNCATE TABLE detran_alertas'); 
             for await (const line of rl) {
                if(line.trim()) {
                    stats.total++;
                    const p = line.split('|');
                    if (p.length >= 2) {
                        const cod = safeInt(p[1]);
                        await client.query(`
                            INSERT INTO detran_alertas (placa, codigo_situacao) VALUES ($1, $2)
                        `, [p[0], cod]);
                        stats.inseridos++;
                    }
                }
            }
        }
        else if (tipo === TIPO_ARQUIVO.FROTA) {
            for await (const line of rl) {
                if(line.trim()) {
                    stats.total++;
                    const p = line.split('|');
                    if (p.length >= 9 && p[0].trim() !== '') {
                        const modeloCod = safeInt(p[1]);
                        const corCod = safeInt(p[2]);
                        const muniCod = safeInt(p[6]); 
                        const anoFab = safeInt(p[7]);
                        const anoMod = safeInt(p[8]);

                        await client.query(`
                            INSERT INTO detran_frota (placa, modelo_cod, cor_cod, ano_fab, ano_mod, municipio_cod) 
                            VALUES ($1, $2, $3, $4, $5, $6)
                            ON CONFLICT (placa) DO UPDATE SET 
                                modelo_cod=$2, cor_cod=$3, ano_fab=$4, ano_mod=$5
                        `, [p[0], modeloCod, corCod, anoFab, anoMod, muniCod]);
                        stats.inseridos++;
                    }
                }
            }
        }

        // REGISTRA O LOG DA IMPORTAÇÃO
        await client.query(`
            INSERT INTO import_logs (origem, tipo_arquivo, status, detalhes)
            VALUES ($1, $2, 'SUCESSO', $3)
        `, [origem, tipo, JSON.stringify(stats)]);

        await client.query('COMMIT');
        console.log(`[IMPORTADOR] ✅ Sucesso. Inseridos: ${stats.inseridos}/${stats.total}`);

        return { status: 'sucesso', tipo, stats };

    } catch (err) {
        await client.query('ROLLBACK');
        console.error(`[IMPORTADOR] ❌ Erro ao processar arquivo:`, err);
        
        try {
            await db.query(`
                INSERT INTO import_logs (origem, tipo_arquivo, status, detalhes)
                VALUES ($1, $2, 'ERRO', $3)
            `, [origem, tipo, JSON.stringify({ erro: err.message, arquivo: nomeArquivo })]);
        } catch (logErr) {
            console.error("Erro ao salvar log de erro:", logErr);
        }
        throw err;
    } finally {
        client.release();
    }
}

// --- VERIFICAÇÃO NO BANCO DE DADOS ---
async function arquivoJaProcessado(nomeArquivo) {
    try {
        const result = await db.query(`
            SELECT id FROM import_logs 
            WHERE detalhes->>'arquivo' = $1 
            AND status = 'SUCESSO'
            LIMIT 1
        `, [nomeArquivo]);
        
        return result.rowCount > 0;
    } catch (err) {
        console.error("Erro ao verificar histórico de importação:", err);
        return false; 
    }
}

// --- JOB FTP AUTOMÁTICO (Lógica de Seleção Única) ---
async function runFtpJob() {
    console.log(`[${new Date().toLocaleString('pt-BR')}] 📡 FTP Worker: Verificando atualizações...`);

    const client = new ftp.Client();
    // client.ftp.verbose = true; 

    try {
        await client.access({
            host: process.env.FTP_HOST,
            user: process.env.FTP_USER,
            password: process.env.FTP_PASS,
            port: process.env.FTP_PORT || 21,
            secure: false 
        });

        // Entra na pasta configurada no .env (frota)
        if (process.env.FTP_REMOTE_DIR) {
            console.log(`📂 FTP: Entrando na pasta '${process.env.FTP_REMOTE_DIR}'...`);
            await client.cd(process.env.FTP_REMOTE_DIR);
        }

        const remoteFiles = await client.list();
        
        // 1. Filtra arquivos válidos e ordena do MAIS RECENTE para o MAIS ANTIGO
        const allValidFiles = remoteFiles
            .filter(f => detectingTipo(f.name) !== 'DESCONHECIDO')
            .sort((a, b) => {
                // [CORREÇÃO CRÍTICA] Ordenação por NOME
                // Ignora modifiedAt e confia na string YYYYMMDD no nome do arquivo
                // b.name vs a.name gera ordem DECRESCENTE (20251228 antes de 20251216)
                return b.name.localeCompare(a.name);
            });

        // 2. Seleciona APENAS O PRIMEIRO arquivo de cada tipo encontrado (o mais recente)
        const candidates = [];
        const tiposEncontrados = new Set();

        for (const file of allValidFiles) {
            const tipo = detectarTipo(file.name);
            // Se ainda não pegamos o mais recente deste tipo, pega agora
            if (!tiposEncontrados.has(tipo)) {
                candidates.push(file);
                tiposEncontrados.add(tipo);
            }
        }

        if (candidates.length === 0) {
            console.log("📡 FTP: Nenhum arquivo compatível encontrado.");
            return;
        }

        console.log(`🎯 FTP: Selecionados ${candidates.length} arquivos prioritários (1 de cada tipo):`);
        candidates.forEach(c => console.log(`   - [${detectarTipo(c.name)}] ${c.name}`));

        // 3. Processa os candidatos selecionados
        for (const file of candidates) {
            const jaExiste = await arquivoJaProcessado(file.name);
            
            if (jaExiste) {
                console.log(`⏭️  FTP: Arquivo '${file.name}' já está atualizado no banco. Pulando.`);
                continue;
            }

            console.log(`⬇️  FTP: Baixando ${file.name}...`);
            const localPath = path.join(TEMP_DIR, file.name);
            
            await client.downloadTo(localPath, file.name);
            
            // Processa
            try {
                await processarArquivo(localPath, ORIGEM.AUTO, null, file.modifiedAt);
                console.log(`✅ FTP: Ciclo completo para ${file.name}`);
            } catch (procErr) {
                console.error(`❌ FTP: Falha ao processar ${file.name}.`, procErr);
            }

            // Limpeza
            if (fs.existsSync(localPath)) {
                fs.unlinkSync(localPath);
            }
        }

    } catch (err) {
        console.error("🔥 FTP Worker Error:", err);
    } finally {
        client.close();
    }
}

// --- Helper para o filtro (mesma função de cima, só para o escopo do loop) ---
function detectingTipo(name) { return detectarTipo(name); }

// --- INICIALIZAÇÃO ---
db.ready.then(() => {
    console.log('🔄 Worker DETRAN-TO (FTP) Iniciado.');
    
    // Roda a cada 1 hora
    cron.schedule('0 * * * *', () => {
        runFtpJob();
    }, { scheduled: true, timezone: "America/Sao_Paulo" });

    // Roda verificação inicial
    setTimeout(runFtpJob, 5000);

}).catch(err => {
    console.error("Worker DETRAN não pôde iniciar conexão com Banco:", err);
});

module.exports = { processarArquivo, ORIGEM };