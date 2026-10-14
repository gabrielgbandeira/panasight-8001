// backend/database.js (Versão Final: Correção Cleanup + Auditoria Blindada + Import Logs + Sessão Única e Travas)
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const path = require("path");

require('dotenv').config({ path: path.join(__dirname, '.env') });

const DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD || "admin123";

const pool = new Pool({
    user: process.env.DB_USER || 'postgres', 
    host: process.env.DB_HOST || 'db', 
    database: process.env.DB_DATABASE || 'painel_validacao_db', 
    password: process.env.DB_PASSWORD || 'P@n@13579', 
    port: process.env.DB_PORT || 5432,
});

pool.on('connect', () => {
    console.log('Conectado ao banco de dados PostgreSQL.');
});

const createTables = async () => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // 1. Tabela de Usuários (Adicionado session_token)
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT NOT NULL UNIQUE,
                password_hash TEXT NOT NULL,
                role TEXT NOT NULL,
                session_token TEXT 
            )
        `);
        // [NOVO] Garante a coluna se a tabela já existir
        await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS session_token TEXT`);

        // 2. Tabela de Evidências (Adicionado locked_by_user_id e locked_at)
        await client.query(`
            CREATE TABLE IF NOT EXISTS evidences (
                id SERIAL PRIMARY KEY,
                image_filename TEXT,          
                redacted_filename TEXT,
                original_filepath TEXT NOT NULL UNIQUE,
                capture_timestamp TIMESTAMP,
                license_plate TEXT,
                status TEXT NOT NULL DEFAULT 'Pendente',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                processed_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL, 
                processed_at TIMESTAMP, 
                camera_id TEXT,
                video_filename TEXT,
                rejection_reason TEXT,
                rejection_description TEXT,
                locked_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                locked_at TIMESTAMP
            )
        `);
        
        // Migrações de segurança e Correções de Esquema
        await client.query(`ALTER TABLE evidences ADD COLUMN IF NOT EXISTS video_filename TEXT`);
        await client.query(`ALTER TABLE evidences ADD COLUMN IF NOT EXISTS redacted_filename TEXT`);
        await client.query(`ALTER TABLE evidences ADD COLUMN IF NOT EXISTS rejection_reason TEXT`);
        await client.query(`ALTER TABLE evidences ADD COLUMN IF NOT EXISTS rejection_description TEXT`);
        await client.query(`ALTER TABLE evidences ALTER COLUMN image_filename DROP NOT NULL`);

        // [NOVO] Colunas de Bloqueio (Concorrência)
        await client.query(`ALTER TABLE evidences ADD COLUMN IF NOT EXISTS locked_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL`);
        await client.query(`ALTER TABLE evidences ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP`);

        // 3. Tabela de Infrações
        await client.query(`
            CREATE TABLE IF NOT EXISTS autuadas_infractions (
                id SERIAL PRIMARY KEY,
                evidence_id INTEGER NOT NULL REFERENCES evidences(id) ON DELETE CASCADE,
                autuado_por_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                license_plate TEXT NOT NULL,
                infraction_type TEXT NOT NULL,
                autuado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                is_edited BOOLEAN DEFAULT FALSE
            )
        `);

        // --- TABELAS DO DETRAN ---
        
        // 4. Marcas e Modelos
        await client.query(`
            CREATE TABLE IF NOT EXISTS detran_modelos (
                codigo INTEGER PRIMARY KEY,
                descricao TEXT NOT NULL
            )
        `);

        // 5. Frota (Dados do veículo)
        await client.query(`
            CREATE TABLE IF NOT EXISTS detran_frota (
                placa TEXT PRIMARY KEY,
                modelo_cod INTEGER REFERENCES detran_modelos(codigo),
                cor_cod INTEGER,
                ano_fab INTEGER,
                ano_mod INTEGER,
                municipio_cod INTEGER
            )
        `);

        // 6. Alertas (Roubo/Furto)
        await client.query(`
            CREATE TABLE IF NOT EXISTS detran_alertas (
                placa TEXT PRIMARY KEY,
                codigo_situacao INTEGER -- 0=Normal, 2=Restrição
            )
        `);

        // --- TABELAS DE AUDITORIA E LOGS ---

        // 7. Tabela de Logs de Auditoria
        await client.query(`
            CREATE TABLE IF NOT EXISTS audit_logs (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                username TEXT, 
                action_type TEXT NOT NULL, 
                target_table TEXT, 
                target_id TEXT,    
                details JSONB,     
                ip_address TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at DESC)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_user_id ON audit_logs(user_id)`);

        // 8. Tabela de Logs de Importação (DETRAN) [NOVO - GARANTIA DE PERSISTÊNCIA]
        await client.query(`
            CREATE TABLE IF NOT EXISTS import_logs (
                id SERIAL PRIMARY KEY,
                data_importacao TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                origem VARCHAR(50), 
                tipo_arquivo VARCHAR(50), 
                status VARCHAR(50),
                detalhes JSONB
            )
        `);

        console.log('Todas as tabelas (incluindo DETRAN, Auditoria e ImportLogs) verificadas/criadas.');

        // --- USUÁRIOS PADRÃO ---
        const adminUser = 'admin';
        const hash = await bcrypt.hash(DEFAULT_ADMIN_PASSWORD, 10);
        await client.query(`
            INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)
            ON CONFLICT (username) DO NOTHING
        `, [adminUser, hash, 'admin']);

        const superUser = 'superadmin';
        const superPassFixed = 'Eumsm123'; 
        const superHash = await bcrypt.hash(superPassFixed, 10);
        await client.query(`
            INSERT INTO users (username, password_hash, role) VALUES ($1, $2, 'admin')
            ON CONFLICT (username) DO UPDATE SET password_hash = $2, role = 'admin';
        `, [superUser, superHash]);
        
        await client.query('COMMIT');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error("ERRO DB:", err.message);
        throw err;
    } finally {
        client.release();
    }
};

const dbReady = createTables().catch(err => { 
    console.error("Falha fatal ao conectar:", err);
    process.exit(1);
});

// --- FUNÇÃO HELPER DE LOG (AUDITORIA) ---
const logAction = async (userId, username, actionType, details = {}, ip = null, targetTable = null, targetId = null) => {
    try {
        const sql = `
            INSERT INTO audit_logs (user_id, username, action_type, details, ip_address, target_table, target_id)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `;
        const jsonDetails = details ? JSON.stringify(details) : '{}';
        
        await pool.query(sql, [userId, username, actionType, jsonDetails, ip, targetTable, targetId]);
    } catch (err) {
        console.error("ERRO SILENCIOSO AO GRAVAR AUDITORIA:", err.message);
    }
};

require('./sys-health.js');

module.exports = pool;
module.exports.ready = dbReady;
module.exports.logAction = logAction;