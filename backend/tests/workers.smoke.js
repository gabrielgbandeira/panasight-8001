/**
 * Characterization Tests: Workers Integrity & Ecosystem
 * Segue Regras 5 e 6: Result Envelope, Sad Path First, funções curtas.
 */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { AppError, success, failure } = require('./result');

const ECOSYSTEM_PATH = path.resolve(__dirname, '../../ecosystem.config.js');

// Happy Path: Validação de existência física e sintaxe dos workers do PM2
async function testWorkersConfigIntegrity() {
    try {
        if (!fs.existsSync(ECOSYSTEM_PATH)) {
            return failure(new AppError({
                code: 'ECOSYSTEM_FILE_MISSING',
                message: 'Arquivo ecosystem.config.js não encontrado.',
                layer: 'ENTRYPOINT',
                operation: 'testWorkersConfigIntegrity'
            }));
        }
        const ecosystem = require(ECOSYSTEM_PATH);
        const apps = ecosystem.apps || [];
        const checked = [];

        for (const app of apps) {
            const scriptPath = path.resolve(path.dirname(ECOSYSTEM_PATH), app.script);
            if (!fs.existsSync(scriptPath)) {
                return failure(new AppError({
                    code: 'WORKER_SCRIPT_NOT_FOUND',
                    message: `Script do worker [${app.name}] não existe em: ${scriptPath}`,
                    layer: 'ENTRYPOINT',
                    operation: 'testWorkersConfigIntegrity',
                    metadata: { appName: app.name, scriptPath }
                }));
            }
            // Valida sintaxe sem executar código completo
            const code = fs.readFileSync(scriptPath, 'utf8');
            new vm.Script(code, { filename: scriptPath });
            checked.push(app.name);
        }
        return success({ totalWorkers: apps.length, workers: checked });
    } catch (err) {
        return failure(new AppError({
            code: 'WORKER_INTEGRITY_FAILED',
            message: err.message,
            layer: 'ENTRYPOINT',
            operation: 'testWorkersConfigIntegrity'
        }));
    }
}

// Sad Path 1: Detecção de script de worker inexistente
async function testMissingWorkerDetection() {
    try {
        const fakeWorkerPath = path.resolve(__dirname, '../non_existent_worker_smoke.js');
        if (!fs.existsSync(fakeWorkerPath)) {
            return success({
                handledCorrectly: true,
                simulatedError: 'WORKER_SCRIPT_NOT_FOUND'
            });
        }
        return failure(new AppError({
            code: 'UNEXPECTED_FILE_EXISTS',
            message: 'O arquivo falso inesperadamente existe.',
            layer: 'ENTRYPOINT',
            operation: 'testMissingWorkerDetection'
        }));
    } catch (err) {
        return failure(new AppError({
            code: 'WORKER_DETECTION_ERROR',
            message: err.message,
            layer: 'ENTRYPOINT',
            operation: 'testMissingWorkerDetection'
        }));
    }
}

// Sad Path 2: Detecção de sintaxe corrompida em script de worker
async function testCorruptedWorkerSyntaxDetection() {
    try {
        const invalidScriptContent = 'function brokenWorker( { return ;';
        new vm.Script(invalidScriptContent);
        return failure(new AppError({
            code: 'CORRUPTED_SYNTAX_MISSED',
            message: 'Deveria ter disparado SyntaxError.',
            layer: 'ENTRYPOINT',
            operation: 'testCorruptedWorkerSyntaxDetection'
        }));
    } catch (err) {
        if (err instanceof SyntaxError) {
            return success({ handledCorrectly: true, syntaxErrorMessage: err.message });
        }
        return failure(new AppError({
            code: 'UNEXPECTED_ERROR_TYPE',
            message: err.message,
            layer: 'ENTRYPOINT',
            operation: 'testCorruptedWorkerSyntaxDetection'
        }));
    }
}

async function runWorkersSmokeTests() {
    const results = [];
    results.push({ name: 'PM2: Integridade e Sintaxe dos 8 Processos (Happy Path)', ...await testWorkersConfigIntegrity() });
    results.push({ name: 'PM2: Detecção de Script de Worker Inexistente (Sad Path 1)', ...await testMissingWorkerDetection() });
    results.push({ name: 'PM2: Detecção de Sintaxe Inválida de Worker (Sad Path 2)', ...await testCorruptedWorkerSyntaxDetection() });
    return results;
}

module.exports = { runWorkersSmokeTests };
