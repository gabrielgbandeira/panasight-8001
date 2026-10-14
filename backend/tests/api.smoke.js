/**
 * Characterization Tests: API Endpoints (:3000)
 * Segue Regras 5 e 6: Result Envelope, Sad Path First, funções curtas.
 */
const http = require('http');
const { AppError, success, failure } = require('./result');

const API_HOST = process.env.API_HOST || '127.0.0.1';
const API_PORT = process.env.API_PORT || 3000;

function httpRequest({ path, method = 'GET', headers = {}, body = null }) {
    return new Promise((resolve, reject) => {
        const payload = body ? JSON.stringify(body) : null;
        const options = {
            hostname: API_HOST,
            port: API_PORT,
            path,
            method,
            headers: {
                ...headers,
                ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {})
            },
            timeout: 5000
        };

        const req = http.request(options, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => resolve({ statusCode: res.statusCode, headers: res.headers, body: data }));
        });

        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('REQUEST_TIMEOUT'));
        });
        if (payload) req.write(payload);
        req.end();
    });
}

// Happy Path: GET / deve retornar status 200 e página HTML
async function testRootEndpoint() {
    try {
        const res = await httpRequest({ path: '/' });
        if (res.statusCode === 200 && res.body.includes('html')) {
            return success({ status: res.statusCode, hasHtml: true });
        }
        return failure(new AppError({
            code: 'API_ROOT_UNEXPECTED_STATUS',
            message: `Status retornado: ${res.statusCode}`,
            layer: 'ENTRYPOINT',
            operation: 'testRootEndpoint'
        }));
    } catch (err) {
        return failure(new AppError({
            code: 'API_CONNECTION_REFUSED',
            message: err.message,
            layer: 'ENTRYPOINT',
            operation: 'testRootEndpoint'
        }));
    }
}

// Sad Path 1: GET /api/users/me sem token de autenticação deve retornar 401
async function testUnauthorizedEndpoint() {
    try {
        const res = await httpRequest({ path: '/api/users/me' });
        if (res.statusCode === 401) {
            return success({ handledCorrectly: true, status: 401, body: res.body });
        }
        return failure(new AppError({
            code: 'API_AUTH_BYPASS_DETECTED',
            message: `Esperava 401, mas recebeu ${res.statusCode}`,
            layer: 'ENTRYPOINT',
            operation: 'testUnauthorizedEndpoint'
        }));
    } catch (err) {
        return failure(new AppError({
            code: 'API_REQUEST_FAILED',
            message: err.message,
            layer: 'ENTRYPOINT',
            operation: 'testUnauthorizedEndpoint'
        }));
    }
}

// Sad Path 2: POST /api/login com credenciais inválidas deve retornar 401
async function testInvalidLoginCredentials() {
    try {
        const res = await httpRequest({
            path: '/api/login',
            method: 'POST',
            body: { username: 'usuario_inexistente_smoke', password: 'senha_errada_123' }
        });
        if (res.statusCode === 401) {
            return success({ handledCorrectly: true, status: 401 });
        }
        return failure(new AppError({
            code: 'API_INVALID_LOGIN_RESPONSE',
            message: `Esperava 401 para credenciais inválidas, recebeu ${res.statusCode}`,
            layer: 'ENTRYPOINT',
            operation: 'testInvalidLoginCredentials'
        }));
    } catch (err) {
        return failure(new AppError({
            code: 'API_REQUEST_FAILED',
            message: err.message,
            layer: 'ENTRYPOINT',
            operation: 'testInvalidLoginCredentials'
        }));
    }
}

async function runApiSmokeTests() {
    const results = [];
    results.push({ name: 'API: Servir Raiz / Frontend (Happy Path)', ...await testRootEndpoint() });
    results.push({ name: 'API: Bloqueio sem Token em /api/users/me (Sad Path 1)', ...await testUnauthorizedEndpoint() });
    results.push({ name: 'API: Rejeição de Login Inválido (Sad Path 2)', ...await testInvalidLoginCredentials() });
    return results;
}

module.exports = { runApiSmokeTests };
