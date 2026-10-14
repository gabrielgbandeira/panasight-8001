const fs = require('fs');
const path = require('path');
const readline = require('readline');
const db = require('./database'); 

const TIPO_ARQUIVO = {
    FROTA: 'FROTA',
    MODELO: 'MARCA_MODELO',
    ROUBO: 'ROUBO_FURTO'
};

const ORIGEM = {
    MANUAL: 'MANUAL',
    AUTO: 'AUTOMATICO'
};

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

async function processarArquivo(caminhoLocal, origem, usuarioId, dataArquivoFTP = new Date()) {
    const nomeArquivo = path.basename(caminhoLocal);
    const tipo = detectarTipo(nomeArquivo);
    
    // Stats para retorno
    const stats = { total: 0, inseridos: 0 };

    console.log(`\n=== [IMPORTADOR] Iniciando: ${nomeArquivo} (${origem}) ===`);

    if (tipo === 'DESCONHECIDO') {
        throw new Error('Nome de arquivo fora do padrão DETRAN.');
    }

    const client = await db.connect();
    try {
        await client.query('BEGIN');

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

        // [MELHORIA] Salva o nome do arquivo nos detalhes para conferência futura
        stats.arquivo = nomeArquivo;

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
        console.error(`[IMPORTADOR] ❌ Erro:`, err);
        
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

module.exports = { processarArquivo, ORIGEM };