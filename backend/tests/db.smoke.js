/**
 * Characterization Tests: Database & Schema Integrity
 * Segue Regras 5 e 6: Result Envelope, Sad Path First, funções curtas.
 */
const { Pool } = require('pg');
const { AppError, success, failure } = require('./result');

const createTestPool = () => new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'db',
    database: process.env.DB_DATABASE || 'painel_validacao_db',
    password: process.env.DB_PASSWORD || 'P@n@13579',
    port: process.env.DB_PORT || 5432,
    connectionTimeoutMillis: 5000
});

// Happy Path: Validação de Conectividade e Tabelas Essenciais
async function testDbConnectivity(pool) {
    try {
        const res = await pool.query('SELECT 1 as alive');
        const tablesRes = await pool.query(`
            SELECT table_name FROM information_schema.tables 
            WHERE table_schema = 'public'
        `);
        const tables = tablesRes.rows.map(r => r.table_name);
        const required = ['users', 'evidences', 'autuadas_infractions', 'detran_frota'];
        const missing = required.filter(t => !tables.includes(t));
        
        if (missing.length > 0) {
            return failure(new AppError({
                code: 'DB_SCHEMA_INCOMPLETE',
                message: `Tabelas ausentes: ${missing.join(', ')}`,
                layer: 'ADAPTER',
                operation: 'testDbConnectivity',
                metadata: { missing, found: tables }
            }));
        }
        return success({ alive: res.rows[0].alive === 1, tablesFound: tables.length });
    } catch (err) {
        return failure(new AppError({
            code: 'DB_CONNECTION_FAILED',
            message: err.message,
            layer: 'ADAPTER',
            operation: 'testDbConnectivity'
        }));
    }
}

// Sad Path 1: Consulta a tabela inexistente deve retornar erro controlado
async function testDbNonExistentTable(pool) {
    try {
        await pool.query('SELECT * FROM non_existent_table_xyz_smoke LIMIT 1');
        return failure(new AppError({
            code: 'DB_EXPECTED_FAILURE_MISSED',
            message: 'Deveria ter falhado para tabela inexistente.',
            layer: 'ADAPTER',
            operation: 'testDbNonExistentTable'
        }));
    } catch (err) {
        // Código PostgreSQL 42P01: undefined_table
        if (err.code === '42P01') {
            return success({ handledCorrectly: true, pgCode: err.code });
        }
        return failure(new AppError({
            code: 'DB_UNEXPECTED_ERROR',
            message: err.message,
            layer: 'ADAPTER',
            operation: 'testDbNonExistentTable'
        }));
    }
}

// Sad Path 2: Consulta com erro de sintaxe SQL
async function testDbSyntaxError(pool) {
    try {
        await pool.query('SELECT FROM WHERE ;');
        return failure(new AppError({
            code: 'DB_EXPECTED_SYNTAX_ERROR_MISSED',
            message: 'Deveria ter disparado erro de sintaxe SQL.',
            layer: 'ADAPTER',
            operation: 'testDbSyntaxError'
        }));
    } catch (err) {
        // Código PostgreSQL 42601: syntax_error
        if (err.code === '42601') {
            return success({ handledCorrectly: true, pgCode: err.code });
        }
        return failure(new AppError({
            code: 'DB_UNEXPECTED_ERROR',
            message: err.message,
            layer: 'ADAPTER',
            operation: 'testDbSyntaxError'
        }));
    }
}

async function runDbSmokeTests() {
    const pool = createTestPool();
    const results = [];
    try {
        results.push({ name: 'DB: Conexão e Schema Essencial (Happy Path)', ...await testDbConnectivity(pool) });
        results.push({ name: 'DB: Tratamento de Tabela Inexistente (Sad Path 1)', ...await testDbNonExistentTable(pool) });
        results.push({ name: 'DB: Tratamento de Sintaxe SQL Inválida (Sad Path 2)', ...await testDbSyntaxError(pool) });
    } finally {
        await pool.end();
    }
    return results;
}

module.exports = { runDbSmokeTests };
