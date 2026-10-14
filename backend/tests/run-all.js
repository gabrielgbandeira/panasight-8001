/**
 * PanaSight 8001 - Baseline Characterization / Smoke Test Runner
 * Executado dentro do contêiner backend
 */
const { runDbSmokeTests } = require('./db.smoke');
const { runApiSmokeTests } = require('./api.smoke');
const { runWorkersSmokeTests } = require('./workers.smoke');

const formatResult = (item) => {
    const symbol = item.success ? '✔ [PASS]' : '✖ [FAIL]';
    const detail = item.success
        ? JSON.stringify(item.data || {})
        : `[${item.error.code}] ${item.error.message}`;
    return `${symbol} - ${item.name}\n      ↳ ${detail}`;
};

const printSummary = (total, passed, failed, durationMs) => {
    const coverage = ((passed / total) * 100).toFixed(1);
    console.log('\n======================================================');
    console.log(`📊 RELATÓRIO DE BASELINE TESTING — PANASIGHT 8001`);
    console.log(`   Tempo de Execução: ${durationMs}ms`);
    console.log(`   Total de Testes:   ${total}`);
    console.log(`   Passaram (PASS):   ${passed}`);
    console.log(`   Falharam (FAIL):   ${failed}`);
    console.log(`   Cobertura Inicial: ${coverage}% dos fluxos críticos`);
    console.log('======================================================\n');
};

async function main() {
    const startTime = Date.now();
    console.log('\n🚀 Iniciando Baseline Characterization / Smoke Tests...\n');

    console.log('--- 1. Camada de Persistência (PostgreSQL) ---');
    const dbResults = await runDbSmokeTests();
    dbResults.forEach(r => console.log(formatResult(r)));

    console.log('\n--- 2. Camada de Entrada e API (:3000) ---');
    const apiResults = await runApiSmokeTests();
    apiResults.forEach(r => console.log(formatResult(r)));

    console.log('\n--- 3. Camada de Workers PM2 (Integridade & Sintaxe) ---');
    const workerResults = await runWorkersSmokeTests();
    workerResults.forEach(r => console.log(formatResult(r)));

    const all = [...dbResults, ...apiResults, ...workerResults];
    const passed = all.filter(r => r.success).length;
    const failed = all.filter(r => !r.success).length;
    const duration = Date.now() - startTime;

    printSummary(all.length, passed, failed, duration);

    if (failed > 0) {
        process.exit(1);
    }
}

main().catch(err => {
    console.error('Erro não tratado na suíte de testes:', err);
    process.exit(1);
});
