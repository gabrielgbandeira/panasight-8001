// backend/server.js (VERSÃO FINAL INTEGRAL - CORREÇÃO KPI + SUPERVISOR READ-ONLY)

process.env.TZ = 'America/Sao_Paulo'; // [CORREÇÃO] Força o Node a usar o fuso do Brasil

const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcrypt');
const cors = require('cors');
const path = require('path');
const os = require('os');
const fs = require('fs');
const sharp = require('sharp'); // Biblioteca para processamento de imagem (Tarjas)
// Bibliotecas para Importação DETRAN e Relatórios
const multer = require('multer'); 
const readline = require('readline');
const ExcelJS = require('exceljs'); 

// [NOVO] Importa a lógica unificada do DETRAN (Manual + Worker)
const { processarArquivo, ORIGEM } = require('./Importador-DETRAN-TO');

require('dotenv').config({ path: path.join(__dirname, '.env') }); 

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const JWT_SECRET = process.env.JWT_SECRET;

// Importa o pool do DB
const db = require('./database'); 
const pool = db; 

// Configuração do Upload (Salva na pasta temporária 'uploads/')
const upload = multer({ dest: 'uploads/' });

if (!JWT_SECRET) {
    console.error("ERRO FATAL: JWT_SECRET não está definido no ficheiro .env.");
    process.exit(1);
}

const app = express();

// [CORREÇÃO DE REDE] Confiar no Proxy (Necessário para pegar IP real atrás de Nginx/LoadBalancer/Docker)
app.set('trust proxy', true);

app.use(cors({
    origin: '*', 
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true,
}));

// Limite aumentado para suportar uploads grandes (importação Detran)
app.use(express.json({ limit: '50mb' })); 
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        console.error('ERRO FATAL DE JSON:', err); 
        return res.status(400).send({ error: 'JSON inválido.' });
    }
    next();
});

// --- HELPER DE AUDITORIA AVANÇADA ---
// Função para extrair IP real e User-Agent (Identificação do Dispositivo)
const getClientInfo = (req) => {
    // Tenta pegar o primeiro IP da lista de encaminhamento (o cliente real)
    let ip = req.headers['x-forwarded-for'] || req.ip || req.socket.remoteAddress;
    
    // Se houver múltiplos IPs (proxy chain), pega o primeiro
    if (ip && typeof ip === 'string' && ip.includes(',')) {
        ip = ip.split(',')[0].trim();
    }
    
    // Captura informações do navegador/sistema (Ex: Chrome on Windows 10)
    const device = req.get('User-Agent') || 'Unknown Device';
    
    return { ip, device };
};

// Middleware de Autenticação (Atualizado: Verifica Sessão Única)
const authMiddleware = async (req, res, next) => {
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Token não fornecido.' });
    
    const parts = authHeader.split(' ');
    if (parts.length !== 2 || parts[0].toLowerCase() !== 'bearer') {
        return res.status(401).json({ error: 'Formato de token inválido.' });
    }
    
    const token = parts[1];

    try {
        const decoded = jwt.verify(token, JWT_SECRET);
        
        // [NOVO] Verifica se este é o token ativo no banco (Sessão Única)
        const userCheck = await pool.query('SELECT session_token FROM users WHERE id = $1', [decoded.id]);
        
        if (userCheck.rowCount === 0 || userCheck.rows[0].session_token !== token) {
            return res.status(401).json({ error: 'Sessão expirada ou iniciada em outro dispositivo.' });
        }

        req.user = decoded;
        next();
    } catch (err) {
        return res.status(401).json({ error: 'Token inválido ou expirado.' });
    }
};

// ---------------------------------------------------------------------
// 🔑 ROTAS DE AUTENTICAÇÃO
// ---------------------------------------------------------------------
app.post('/api/login', async (req, res) => {
    const { username, password } = req.body;
    try {
        const userResult = await pool.query('SELECT id, username, password_hash, role FROM users WHERE username = $1', [username]);
        
        if (userResult.rowCount === 0) {
            return res.status(401).json({ error: "Utilizador ou senha incorretos." });
        }
        
        const user = userResult.rows[0];
        const isPasswordValid = await bcrypt.compare(password, user.password_hash);
        
        if (!isPasswordValid) {
            // Opcional: Logar tentativa falha para prevenir brute-force
            return res.status(401).json({ error: "Utilizador ou senha incorretos." });
        }
        
        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '8h' });
        
        // [NOVO] Salva o token no banco para invalidar sessões anteriores
        await pool.query('UPDATE users SET session_token = $1 WHERE id = $2', [token, user.id]);
        
        // [AUDITORIA PT-BR] Log de Login
        const { ip, device } = getClientInfo(req);
        await db.logAction(user.id, user.username, 'LOGIN_REALIZADO', { role: user.role, device_info: device }, ip);

        res.status(200).json({ token, user: { role: user.role, username: user.username, id: user.id } });
        
    } catch (error) {
        console.error("Erro no login:", error);
        res.status(500).json({ error: 'Erro interno do servidor.' });
    }
});

app.get('/api/users/me', authMiddleware, async (req, res) => {
    res.json({ id: req.user.id, username: req.user.username, role: req.user.role });
});

// ---------------------------------------------------------------------
// 👤 ROTAS DE GESTÃO DE USUÁRIOS (ADMIN)
// ---------------------------------------------------------------------

// [ATUALIZADO] Listar Usuários: Permite Admin e Supervisor
app.get('/api/users', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin' && req.user.role !== 'supervisor') {
        return res.status(403).json({ error: 'Acesso negado.' });
    }
    try {
        // [AUDITORIA PT-BR]
        const { ip, device } = getClientInfo(req);
        // Log levemente diferente para supervisor (leitura apenas)
        const actionType = req.user.role === 'supervisor' ? 'VISUALIZAR_LISTA_USUARIOS_READONLY' : 'VISUALIZAR_LISTA_USUARIOS';
        await db.logAction(req.user.id, req.user.username, actionType, { device_info: device }, ip, 'users');

        const result = await pool.query('SELECT id, username, role FROM users ORDER BY id');
        res.json(result.rows);
    } catch (error) {
        console.error("Erro ao buscar usuários:", error);
        res.status(500).json({ error: 'Erro interno.' });
    }
});

// [MANTIDO RESTRICT] Criar Usuário: Apenas Admin (Supervisor bloqueado)
app.post('/api/users', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso negado.' });
    
    const { username, password, role } = req.body;
    if (!username || !password || !role) {
        return res.status(400).json({ error: 'Todos os campos são obrigatórios.' });
    }

    try {
        const hash = await bcrypt.hash(password, 10);
        await pool.query(
            'INSERT INTO users (username, password_hash, role) VALUES ($1, $2, $3)',
            [username, hash, role]
        );
        
        // [AUDITORIA PT-BR]
        const { ip, device } = getClientInfo(req);
        await db.logAction(req.user.id, req.user.username, 'CRIAR_USUARIO', { created_user: username, role: role, device_info: device }, ip, 'users');

        res.status(201).json({ message: 'Usuário criado com sucesso.' });
    } catch (err) {
        if (err.code === '23505') { 
            return res.status(409).json({ error: 'Nome de usuário já existe.' });
        }
        console.error(err);
        res.status(500).json({ error: 'Erro ao criar usuário.' });
    }
});

// [MANTIDO RESTRICT] Editar Usuário: Apenas Admin
app.put('/api/users/:id', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso negado.' });
    
    const { id } = req.params;
    const { username, password, role } = req.body;

    try {
        // [SEGURANÇA] Proteção do Super Admin
        const targetUserCheck = await pool.query('SELECT username FROM users WHERE id = $1', [id]);
        
        if (targetUserCheck.rowCount > 0) {
            const targetUsername = targetUserCheck.rows[0].username;
            if (targetUsername === 'superadmin') {
                return res.status(403).json({ 
                    error: 'AÇÃO PROIBIDA: O Super Admin não pode ser editado.' 
                });
            }
        }

        if (password && password.trim() !== "") {
            const hash = await bcrypt.hash(password, 10);
            await pool.query(
                'UPDATE users SET username = $1, password_hash = $2, role = $3 WHERE id = $4',
                [username, hash, role, id]
            );
        } else {
            await pool.query(
                'UPDATE users SET username = $1, role = $2 WHERE id = $3',
                [username, role, id]
            );
        }

        // [AUDITORIA PT-BR]
        const { ip, device } = getClientInfo(req);
        await db.logAction(req.user.id, req.user.username, 'EDITAR_USUARIO', { target_id: id, new_role: role, device_info: device }, ip, 'users', id);

        res.json({ message: 'Usuário atualizado com sucesso.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao atualizar usuário.' });
    }
});

// [MANTIDO RESTRICT] Excluir Usuário: Apenas Admin
app.delete('/api/users/:id', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso negado.' });
    
    const { id } = req.params;

    if (parseInt(id) === req.user.id) {
        return res.status(400).json({ error: 'Você não pode excluir a si mesmo.' });
    }

    try {
        // [SEGURANÇA] Proteção do Super Admin
        const targetUserCheck = await pool.query('SELECT username FROM users WHERE id = $1', [id]);
        
        if (targetUserCheck.rowCount > 0) {
            const targetUsername = targetUserCheck.rows[0].username;
            if (targetUsername === 'superadmin') {
                return res.status(403).json({ 
                    error: 'CRÍTICO: Tentativa de golpe detectada. O Super Admin não pode ser excluído.' 
                });
            }
        }

        await pool.query('DELETE FROM users WHERE id = $1', [id]);
        
        // [AUDITORIA PT-BR]
        const { ip, device } = getClientInfo(req);
        await db.logAction(req.user.id, req.user.username, 'EXCLUIR_USUARIO', { deleted_id: id, device_info: device }, ip, 'users', id);

        res.json({ message: 'Usuário excluído com sucesso.' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Erro ao excluir usuário.' });
    }
});

// ---------------------------------------------------------------------
// 🛡️ ROTAS DE AUDITORIA (RESTRICT: SUPER ADMIN & SUPERVISOR)
// ---------------------------------------------------------------------

// [ATUALIZADO] Rota para listar TIPOS de ação: Permite Admin ou Supervisor
app.get('/api/admin/audit-types', authMiddleware, async (req, res) => {
    if (req.user.role !== 'admin' && req.user.role !== 'supervisor') {
        return res.status(403).json({ error: 'Acesso negado.' });
    }
    try {
        // Busca todos os tipos distintos de ação gravados no banco
        const result = await pool.query('SELECT DISTINCT action_type FROM audit_logs ORDER BY action_type');
        res.json(result.rows.map(r => r.action_type));
    } catch (err) {
        console.error("Erro ao buscar tipos de ação:", err);
        res.status(500).json({ error: "Erro interno." });
    }
});

// [ATUALIZADO] Rota de Logs: Permite Superadmin e Supervisor
app.get('/api/admin/audit-logs', authMiddleware, async (req, res) => {
    // 1. Permite entrada se for Admin ou Supervisor
    if (req.user.role !== 'admin' && req.user.role !== 'supervisor') {
        return res.status(403).json({ error: 'Acesso negado.' });
    }

    // 2. [SEGURANÇA] Verifica se é o SUPER ADMIN ou SUPERVISOR
    const isSuperAdmin = req.user.username === 'superadmin';
    const isSupervisor = req.user.role === 'supervisor';

    if (!isSuperAdmin && !isSupervisor) {
        return res.status(403).json({ error: 'Acesso restrito. Apenas o Super Admin e Supervisores podem visualizar logs de auditoria.' });
    }

    const { startDate, endDate, userId, actionType } = req.query;
    
    // [AUDITORIA PT-BR] Meta-Auditoria
    const { ip, device } = getClientInfo(req);
    await db.logAction(
        req.user.id, 
        req.user.username, 
        'VISUALIZAR_LOGS_AUDITORIA', 
        { filters: { startDate, endDate, targetUser: userId, actionType }, device_info: device }, 
        ip,
        'audit_logs'
    );

    let sql = `SELECT * FROM audit_logs WHERE 1=1`;
    const params = [];
    let counter = 1;

    if (startDate) {
        sql += ` AND created_at >= $${counter++}`;
        params.push(startDate);
    }
    if (endDate) {
        // Ajusta para o final do dia
        sql += ` AND created_at <= $${counter++}::timestamp + INTERVAL '1 day'`;
        params.push(endDate);
    }
    if (userId) {
        sql += ` AND user_id = $${counter++}`;
        params.push(userId);
    }
    
    // [FILTRO FLEXÍVEL] Usa ILIKE para permitir encontrar logs novos (PT) e antigos (EN)
    if (actionType && actionType.trim() !== '') {
        sql += ` AND action_type ILIKE $${counter++}`;
        params.push(`%${actionType}%`);
    }

    sql += ` ORDER BY created_at DESC LIMIT 1000`; // Aumentei o limite para ver mais logs

    try {
        const result = await pool.query(sql, params);
        res.json(result.rows);
    } catch (err) {
        console.error("Erro ao buscar logs:", err);
        res.status(500).json({ error: "Erro interno ao buscar auditoria." });
    }
});

// ---------------------------------------------------------------------
// 📊 ROTAS DE KPI INTELIGENTES (Lógica de Mês/Dia + Conversão Multas)
// ---------------------------------------------------------------------
app.get('/api/dashboard/stats', authMiddleware, async (req, res) => {
    const role = (req.user.role || '').toLowerCase();
    const userId = req.user.id;
    try {
        // 1. PENDENTES (Fila de entrada): Sempre snapshot atual (sem mês/dia)
        const pendingResult = await pool.query("SELECT COUNT(*) FROM evidences WHERE status = 'Pendente'");
        const pending = parseInt(pendingResult.rows[0].count);

        // [CORREÇÃO FINAL] Calcular datas em JS para garantir precisão
        const now = new Date();
        const spDateStr = now.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' });
        const spDate = new Date(spDateStr);
        
        const year = spDate.getFullYear();
        const month = spDate.getMonth() + 1;
        const day = spDate.getDate();

        // Formato ISO simples YYYY-MM-DD HH:mm:ss
        const monthStart = `${year}-${String(month).padStart(2, '0')}-01 00:00:00`;
        const dayStart = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} 00:00:00`;

        let valM = 0, valD = 0; // Validations (Card 2)
        let rejM = 0, rejD = 0; // Rejections (Card 3)
        let finesM = 0, finesD = 0; // Fines (Card 4)

        // [ATUALIZADO] Supervisor vê os dados globais da empresa (igual Admin)
        if (role === 'admin' || role === 'supervisor') {
            // --- ADMIN/SUPERVISOR: Vê Totais da Empresa ---
            const vm = await pool.query(`SELECT COUNT(*) FROM evidences WHERE status IN ('Validada', 'Autuada') AND processed_at >= $1`, [monthStart]);
            const vd = await pool.query(`SELECT COUNT(*) FROM evidences WHERE status IN ('Validada', 'Autuada') AND processed_at >= $1`, [dayStart]);
            valM = parseInt(vm.rows[0].count); valD = parseInt(vd.rows[0].count);

            const rm = await pool.query(`SELECT COUNT(*) FROM evidences WHERE status IN ('Descartada', 'Placa Mal Conservada', 'Veículo Especial', 'Rejeitada') AND processed_at >= $1`, [monthStart]);
            const rd = await pool.query(`SELECT COUNT(*) FROM evidences WHERE status IN ('Descartada', 'Placa Mal Conservada', 'Veículo Especial', 'Rejeitada') AND processed_at >= $1`, [dayStart]);
            rejM = parseInt(rm.rows[0].count); rejD = parseInt(rd.rows[0].count);

            const fm = await pool.query(`SELECT COUNT(*) FROM autuadas_infractions WHERE autuado_em >= $1`, [monthStart]);
            const fd = await pool.query(`SELECT COUNT(*) FROM autuadas_infractions WHERE autuado_em >= $1`, [dayStart]);
            finesM = parseInt(fm.rows[0].count); finesD = parseInt(fd.rows[0].count);

        } else if (role === 'autuador') {
            // --- AUTUADOR: Vê fluxo da empresa na entrada, e seus dados na saída ---
            
            // Card 2 (Entrada): Vê Total da Empresa (Fluxo disponível para autuação)
            const vm = await pool.query(`SELECT COUNT(*) FROM evidences WHERE status IN ('Validada', 'Autuada') AND processed_at >= $1`, [monthStart]);
            const vd = await pool.query(`SELECT COUNT(*) FROM evidences WHERE status IN ('Validada', 'Autuada') AND processed_at >= $1`, [dayStart]);
            valM = parseInt(vm.rows[0].count); valD = parseInt(vd.rows[0].count);

            // Card 3 (Rejeições): Vê o que ELE rejeitou
            const rm = await pool.query(`SELECT COUNT(*) FROM evidences WHERE status = 'Rejeitada' AND processed_by_user_id = $1 AND processed_at >= $2`, [userId, monthStart]);
            const rd = await pool.query(`SELECT COUNT(*) FROM evidences WHERE status = 'Rejeitada' AND processed_by_user_id = $1 AND processed_at >= $2`, [userId, dayStart]);
            rejM = parseInt(rm.rows[0].count); rejD = parseInt(rd.rows[0].count);

            // Card 4 (Multas): Vê o que ELE autuou
            const fm = await pool.query(`SELECT COUNT(*) FROM autuadas_infractions WHERE autuado_por_user_id = $1 AND autuado_em >= $2`, [userId, monthStart]);
            const fd = await pool.query(`SELECT COUNT(*) FROM autuadas_infractions WHERE autuado_por_user_id = $1 AND autuado_em >= $2`, [userId, dayStart]);
            finesM = parseInt(fm.rows[0].count); finesD = parseInt(fd.rows[0].count);

        } else {
            // --- OPERADOR: Vê sua produtividade ---
            
            // Card 2: Vê o que ELE validou
            const vm = await pool.query(`SELECT COUNT(*) FROM evidences WHERE status IN ('Validada', 'Autuada') AND processed_by_user_id = $1 AND processed_at >= $2`, [userId, monthStart]);
            const vd = await pool.query(`SELECT COUNT(*) FROM evidences WHERE status IN ('Validada', 'Autuada') AND processed_by_user_id = $1 AND processed_at >= $2`, [userId, dayStart]);
            valM = parseInt(vm.rows[0].count); valD = parseInt(vd.rows[0].count);

            // Card 3: Vê o que ELE descartou
            const rm = await pool.query(`SELECT COUNT(*) FROM evidences WHERE status IN ('Descartada', 'Placa Mal Conservada', 'Veículo Especial') AND processed_by_user_id = $1 AND processed_at >= $2`, [userId, monthStart]);
            const rd = await pool.query(`SELECT COUNT(*) FROM evidences WHERE status IN ('Descartada', 'Placa Mal Conservada', 'Veículo Especial') AND processed_by_user_id = $1 AND processed_at >= $2`, [userId, dayStart]);
            rejM = parseInt(rm.rows[0].count); rejD = parseInt(rd.rows[0].count);

            // Card 4 (Conversão): Vê quantas das SUAS validações viraram multa
            const fm = await pool.query(`SELECT COUNT(DISTINCT ai.evidence_id) FROM autuadas_infractions ai JOIN evidences e ON ai.evidence_id = e.id WHERE e.processed_by_user_id = $1 AND ai.autuado_em >= $2`, [userId, monthStart]);
            const fd = await pool.query(`SELECT COUNT(DISTINCT ai.evidence_id) FROM autuadas_infractions ai JOIN evidences e ON ai.evidence_id = e.id WHERE e.processed_by_user_id = $1 AND ai.autuado_em >= $2`, [userId, dayStart]);
            finesM = parseInt(fm.rows[0].count); finesD = parseInt(fd.rows[0].count);
        }

        res.json({
            pending: pending,
            validations: { month: valM, day: valD },
            rejected: { month: rejM, day: rejD },
            fines: { month: finesM, day: finesD }
        });

    } catch (error) {
        console.error("Erro ao calcular KPIs:", error);
        res.status(500).json({ error: 'Falha ao processar dados do KPI.' });
    }
});

// ---------------------------------------------------------------------
// 🔒 ROTAS DE CONTROLE DE CONCORRÊNCIA (LOCKING) [NOVO]
// ---------------------------------------------------------------------

// Tentar travar uma imagem para visualização
app.post('/api/lock/:id', authMiddleware, async (req, res) => {
    // [MODIFICAÇÃO SUPERVISOR] Se for supervisor, retorna sucesso MAS não trava nada.
    // Isso permite que ele visualize em tempo real sem bloquear o operador.
    if (req.user.role === 'supervisor') {
        return res.status(200).json({ success: true, readOnly: true });
    }

    const evidenceId = req.params.id;
    const userId = req.user.id;

    try {
        // Verifica se está travada por OUTRO usuário nos últimos 2 minutos
        // Se estiver travada pelo MESMO usuário, apenas renova o tempo (heartbeat)
        const checkLock = await pool.query(`
            SELECT locked_by_user_id, locked_at, u.username 
            FROM evidences e
            LEFT JOIN users u ON e.locked_by_user_id = u.id
            WHERE e.id = $1
        `, [evidenceId]);

        if (checkLock.rowCount === 0) return res.status(404).json({ error: 'Imagem não encontrada.' });

        const lockData = checkLock.rows[0];
        const now = new Date();
        const lockTime = new Date(lockData.locked_at);
        const diffMinutes = (now - lockTime) / 1000 / 60;

        // Regra: Se está travada por OUTRO e o lock é recente (< 2 min), bloqueia
        if (lockData.locked_by_user_id && lockData.locked_by_user_id !== userId && diffMinutes < 2) {
            return res.status(409).json({ 
                error: 'Imagem em uso.', 
                lockedBy: lockData.username 
            });
        }

        // Aplica o lock (ou renova)
        await pool.query(`
            UPDATE evidences 
            SET locked_by_user_id = $1, locked_at = CURRENT_TIMESTAMP 
            WHERE id = $2
        `, [userId, evidenceId]);

        res.json({ success: true });
    } catch (err) {
        console.error("Erro ao travar imagem:", err);
        res.status(500).json({ error: "Erro interno." });
    }
});

// Destravar imagem (ao sair ou mudar)
app.post('/api/unlock/:id', authMiddleware, async (req, res) => {
    // Supervisor não tem lock para liberar
    if (req.user.role === 'supervisor') return res.json({ success: true });

    const evidenceId = req.params.id;
    const userId = req.user.id;

    try {
        // Só destrava se for o dono do lock
        await pool.query(`
            UPDATE evidences 
            SET locked_by_user_id = NULL, locked_at = NULL 
            WHERE id = $1 AND locked_by_user_id = $2
        `, [evidenceId, userId]);
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: "Erro interno." });
    }
});

// ---------------------------------------------------------------------
// 🖼️ ROTAS DE PROCESSAMENTO (index.html) - COM TRAVA DE SEGURANÇA
// ---------------------------------------------------------------------
app.get('/api/evidences', authMiddleware, async (req, res) => {
    // [SEGURANÇA] Apenas Admin, Operador e Supervisor podem ver
    const role = (req.user.role || '').toLowerCase();
    // [ATUALIZADO] Incluído supervisor e renomeado processamento -> operador
    if (!['admin', 'operador', 'supervisor'].includes(role)) {
        return res.status(403).json({ error: 'Acesso negado. Apenas operadores.' });
    }

    // [NOVO] Traz informações de lock para o frontend
    const sql = `
        SELECT e.*, u.username as locked_by_username,
        (e.locked_by_user_id IS NOT NULL AND e.locked_by_user_id != $1 AND e.locked_at > NOW() - INTERVAL '2 minutes') as is_locked
        FROM evidences e
        LEFT JOIN users u ON e.locked_by_user_id = u.id
        WHERE e.status = 'Pendente' 
        ORDER BY e.capture_timestamp ASC
    `;
    try {
        const result = await pool.query(sql, [req.user.id]);
        res.json(result.rows);
    } catch (error) {
        console.error("Erro ao buscar evidências:", error);
        res.status(500).json({ error: "Falha ao buscar evidências." });
    }
});

// ---------------------------------------------------------------------
//  ROTA AUXILIAR: LISTAR TODAS AS CÂMERAS (PARA FILTROS)
// ---------------------------------------------------------------------
app.get('/api/admin/all-cameras', authMiddleware, async (req, res) => {
    // Permite Admin e Supervisor
    if (req.user.role !== 'admin' && req.user.role !== 'supervisor') {
        return res.status(403).json({ error: 'Acesso negado.' });
    }

    try {
        // Busca todas as câmeras distintas que já passaram pelo sistema (Histórico Completo)
        const result = await pool.query(`
            SELECT DISTINCT camera_id 
            FROM evidences 
            WHERE camera_id IS NOT NULL AND camera_id != '' 
            ORDER BY camera_id ASC
        `);
        
        // Retorna apenas a lista de nomes: ['CAM-01', 'CAM-02', ...]
        res.json(result.rows.map(r => r.camera_id));
    } catch (err) {
        console.error("Erro ao listar câmeras:", err);
        res.status(500).json({ error: 'Erro interno.' });
    }
});

// Rota de Processamento com Auditoria
app.put('/api/evidences/:id', authMiddleware, async (req, res) => {
    // [SEGURANÇA] Apenas Admin e Operador podem validar. Supervisor NÃO.
    const role = (req.user.role || '').toLowerCase();
    if (!['admin', 'operador'].includes(role)) {
        return res.status(403).json({ error: 'Acesso negado.' });
    }

    const evidenceId = req.params.id;
    const { action, plate, reason, description } = req.body; 
    const userId = req.user.id;
    let newStatus, licensePlate;

    switch (action.toLowerCase()) {
        case 'valida':
            newStatus = 'Validada';
            licensePlate = plate.toUpperCase().trim();
            break;
        case 'invalida': 
            newStatus = 'Descartada';
            licensePlate = null;
            break;
        case 'placa_mal_conservada': 
            newStatus = 'Placa Mal Conservada';
            licensePlate = '#######';
            break;
        case 'sem_placa': 
            newStatus = 'Veículo Especial';
            licensePlate = 'ESPECIAL';
            break;
        default:
            return res.status(400).json({ error: 'Ação inválida.' });
    }

    const sql = `
        UPDATE evidences SET 
            status = $1, 
            license_plate = $2, 
            processed_by_user_id = $3, 
            processed_at = (NOW() - INTERVAL '3 hours'), -- [FORÇADO] Subtrai 3h
            rejection_reason = $4,
            rejection_description = $5,
            locked_by_user_id = NULL 
        WHERE id = $6 
        RETURNING *
    `;

    try {
        const result = await pool.query(sql, [
            newStatus, 
            licensePlate, 
            userId, 
            reason || null, 
            description || null,
            evidenceId
        ]);
        
        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Evidência não encontrada.' });
        }
        
        // [AUDITORIA PT-BR]
        const { ip, device } = getClientInfo(req);
        await db.logAction(userId, req.user.username, 'PROCESSAR_EVIDENCIA', { evidence_id: evidenceId, action: action, status: newStatus, device_info: device }, ip, 'evidences', evidenceId);

        res.json({ message: 'Evidência processada com sucesso.', evidence: result.rows[0] });
    } catch (error) {
        console.error("Erro ao atualizar evidência:", error);
        res.status(500).json({ error: 'Erro interno ao processar evidência.' });
    }
});

// ---------------------------------------------------------------------
// 📝 ROTAS DE AUTUAÇÃO (autuacao.html) - COM TRAVA DE SEGURANÇA
// ---------------------------------------------------------------------
app.get('/api/autuacao/queue', authMiddleware, async (req, res) => {
    // [SEGURANÇA] Admin, Autuador e Supervisor podem ver
    const role = (req.user.role || '').toLowerCase();
    // [ATUALIZADO] Incluído supervisor
    if (!['admin', 'autuador', 'supervisor'].includes(role)) {
        return res.status(403).json({ error: 'Acesso negado. Apenas autuadores.' });
    }

    // [NOVO] Inclui info de lock
    const sqlEvidences = `
        SELECT e.*, u.username as locked_by_username,
        (e.locked_by_user_id IS NOT NULL AND e.locked_by_user_id != $1 AND e.locked_at > NOW() - INTERVAL '2 minutes') as is_locked
        FROM evidences e
        LEFT JOIN users u ON e.locked_by_user_id = u.id
        WHERE e.status = 'Validada' 
        ORDER BY e.capture_timestamp ASC
    `;
    
    try {
        const client = await pool.connect();
        const result = await client.query(sqlEvidences, [req.user.id]);
        const evidences = result.rows;

        // Para cada evidência, buscamos os dados do DETRAN
        for (let ev of evidences) {
            if (ev.license_plate) {
                const detranQuery = `
                    SELECT 
                        f.placa,
                        f.ano_fab,
                        f.ano_mod,
                        f.cor_cod,
                        m.descricao as modelo,
                        COALESCE(a.codigo_situacao, 0) as status_alerta
                    FROM detran_frota f
                    LEFT JOIN detran_modelos m ON f.modelo_cod = m.codigo
                    LEFT JOIN detran_alertas a ON f.placa = a.placa
                    WHERE f.placa = $1
                `;
                const detranRes = await client.query(detranQuery, [ev.license_plate]);
                
                if (detranRes.rowCount > 0) {
                    ev.detranData = detranRes.rows[0];
                } else {
                    ev.detranData = null; // Placa não encontrada no banco do Detran
                }
            }
        }
        
        client.release();
        res.json({ data: evidences });

    } catch (error) {
        console.error("Erro ao buscar fila de autuação:", error);
        res.status(500).json({ error: "Falha ao buscar fila de autuação." });
    }
});

// Autuar
app.post('/api/autuar', authMiddleware, async (req, res) => {
    // [SEGURANÇA] Validação de role também no POST. Supervisor NÃO PODE.
    const role = (req.user.role || '').toLowerCase();
    if (!['admin', 'autuador'].includes(role)) {
        return res.status(403).json({ error: 'Acesso negado.' });
    }
    
    const { evidenceId, licensePlate, infractions, redactionAreas, observations } = req.body; 
    const userId = req.user.id;

    if (!infractions || !Array.isArray(infractions) || infractions.length === 0) {
        return res.status(400).json({ error: 'É necessário fornecer pelo menos uma infração válida.' });
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        let redactedFilename = null;
        if (redactionAreas && Array.isArray(redactionAreas) && redactionAreas.length > 0) {
            const evRes = await client.query('SELECT image_filename FROM evidences WHERE id = $1', [evidenceId]);
            if(evRes.rowCount === 0) throw new Error("Evidência não encontrada para tarjar");
            
            const originalFilename = evRes.rows[0].image_filename;
            const imagesBase = path.join(__dirname, '../images'); 
            
            let inputPath = path.join(imagesBase, originalFilename);
            if (!fs.existsSync(inputPath)) {
                inputPath = path.join(imagesBase, 'processed', path.basename(originalFilename));
            }
            if (!fs.existsSync(inputPath)) {
                 inputPath = path.join(__dirname, '../images', 'processed', originalFilename);
            }

            if (!fs.existsSync(inputPath)) {
                throw new Error(`Arquivo de imagem original não encontrado no servidor: ${originalFilename}`);
            }
            
            const ext = path.extname(originalFilename);
            const namePart = path.basename(originalFilename, ext);
            redactedFilename = `${namePart}_redacted_${Date.now()}${ext}`;
            const outputPath = path.join(__dirname, '../images', 'processed', redactedFilename);

            const metadata = await sharp(inputPath).metadata();
            const svgRects = redactionAreas.map(r => 
                `<rect x="${r.x * metadata.width}" y="${r.y * metadata.height}" width="${r.w * metadata.width}" height="${r.h * metadata.height}" fill="black" />`
            ).join('\n');
            const svgOverlay = `<svg width="${metadata.width}" height="${metadata.height}">${svgRects}</svg>`;

            await sharp(inputPath)
                .composite([{ input: Buffer.from(svgOverlay), blend: 'over' }])
                .toFile(outputPath);
        }

        // [FORÇADO] autuado em explícito com -3 horas
        const insertInfractionSql = `
            INSERT INTO autuadas_infractions (evidence_id, infraction_type, autuado_por_user_id, license_plate, autuado_em)
            VALUES ($1, $2, $3, $4, (NOW() - INTERVAL '3 hours'))
        `;

        for (const infractionType of infractions) {
            if (typeof infractionType === 'string' && infractionType.trim()) {
                await client.query(insertInfractionSql, [
                    evidenceId, 
                    infractionType.trim(), 
                    userId, 
                    licensePlate
                ]);
            }
        }
        
        let updateSql, updateParams;
        
        if (redactedFilename) {
            updateSql = `UPDATE evidences SET status = 'Autuada', redacted_filename = $2, locked_by_user_id = NULL WHERE id = $1 RETURNING *`;
            updateParams = [evidenceId, redactedFilename];
        } else {
            updateSql = `UPDATE evidences SET status = 'Autuada', locked_by_user_id = NULL WHERE id = $1 RETURNING *`;
            updateParams = [evidenceId];
        }
        
        const updatedEvidence = await client.query(updateSql, updateParams);
        if (updatedEvidence.rowCount === 0) {
            throw new Error('Evidência não encontrada para atualização.');
        }

        // [AUDITORIA PT-BR]
        const { ip, device } = getClientInfo(req);
        await db.logAction(userId, req.user.username, 'AUTUAR_INFRACAO', { evidence_id: evidenceId, plate: licensePlate, infractions: infractions, device_info: device }, ip, 'evidences', evidenceId);

        await client.query('COMMIT');
        res.status(201).json({ message: 'Infração autuada e registrada com sucesso.' });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Erro na autuação:", error);
        res.status(500).json({ error: 'Erro interno ao processar autuação: ' + error.message });
    } finally {
        client.release();
    }
});

// Rota de Rejeição na Autuação
app.post('/api/autuacao/process', authMiddleware, async (req, res) => {
    const { evidenceId, action, reason, description } = req.body;
    const userId = req.user.id;
    // [SEGURANÇA] Supervisor não pode rejeitar
    const role = (req.user.role || '').toLowerCase();
    if (!['admin', 'autuador'].includes(role)) return res.status(403).json({ error: 'Acesso negado.' });

    if (action !== 'discard') return res.status(400).json({ error: 'Ação inválida.' });
    try {
        // [FORÇADO] processed_at com -3 horas
        const result = await pool.query(`UPDATE evidences SET status = 'Rejeitada', processed_by_user_id = $1, processed_at = (NOW() - INTERVAL '3 hours'), rejection_reason = $2, rejection_description = $3, locked_by_user_id = NULL WHERE id = $4 RETURNING *`, [userId, reason || null, description || null, evidenceId]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Não encontrada.' });
        const { ip, device } = getClientInfo(req);
        await db.logAction(userId, req.user.username, 'REJEITAR_AUTUACAO', { evidence_id: evidenceId, reason, device_info: device }, ip, 'evidences', evidenceId);
        res.json({ message: 'Rejeitada com sucesso.' });
    } catch (error) { res.status(500).json({ error: 'Erro interno.' }); }
});

// ---------------------------------------------------------------------
// ⬛ ROTA DE DOWNLOAD UNIFICADA
// ---------------------------------------------------------------------
app.post('/api/download-redacted', authMiddleware, async (req, res) => {
    const { evidenceId, redactionAreas } = req.body;

    if (!evidenceId) return res.status(400).json({ error: 'ID obrigatório.' });

    try {
        const result = await pool.query('SELECT image_filename FROM evidences WHERE id = $1', [evidenceId]);
        if (result.rowCount === 0) return res.status(404).json({ error: 'Não encontrado.' });

        const dbFilename = result.rows[0].image_filename;
        const cleanFilename = path.basename(dbFilename); 
        const imagesBase = path.join(__dirname, '../images');
        let inputPath = path.join(imagesBase, dbFilename);
        
        if (!fs.existsSync(inputPath)) {
            inputPath = path.join(imagesBase, 'processed', cleanFilename);
        }
        if (!fs.existsSync(inputPath)) {
             inputPath = path.join(__dirname, '../images', 'processed', dbFilename);
        }

        if (!fs.existsSync(inputPath)) {
            return res.status(404).json({ error: 'Arquivo físico não encontrado no disco.' });
        }

        // [AUDITORIA PT-BR]
        const { ip, device } = getClientInfo(req);
        await db.logAction(
            req.user.id, 
            req.user.username, 
            'DOWNLOAD_IMAGEM_TARJADA', 
            { evidence_id: evidenceId, has_redaction: (redactionAreas && redactionAreas.length > 0), device_info: device }, 
            ip, 
            'evidences', 
            evidenceId
        );

        if (!redactionAreas || !Array.isArray(redactionAreas) || redactionAreas.length === 0) {
            return res.download(inputPath, cleanFilename);
        }

        const metadata = await sharp(inputPath).metadata();
        const svgRects = redactionAreas.map(r => 
            `<rect x="${r.x * metadata.width}" y="${r.y * metadata.height}" width="${r.w * metadata.width}" height="${r.h * metadata.height}" fill="black" />`
        ).join('\n');
        
        const svgOverlay = `<svg width="${metadata.width}" height="${metadata.height}">${svgRects}</svg>`;
        
        const outputBuffer = await sharp(inputPath)
            .composite([{ input: Buffer.from(svgOverlay), blend: 'over' }])
            .jpeg({ quality: 90 })
            .toBuffer();

        res.set({
            'Content-Type': 'image/jpeg',
            'Content-Disposition': `attachment; filename="${cleanFilename}"`,
            'Content-Length': outputBuffer.length
        });
        res.send(outputBuffer);

    } catch (err) {
        console.error("Erro download tarja:", err);
        res.status(500).json({ error: 'Erro ao gerar imagem.' });
    }
});

app.get('/api/reports', authMiddleware, async (req, res) => {
    const reportsDir = path.join(__dirname, 'public', 'reports');
    try {
        await fs.promises.access(reportsDir);
        const files = await fs.promises.readdir(reportsDir);
        const reportFiles = [];
        
        for (const file of files) {
            if(file.endsWith('.xlsx')) {
                const stats = await fs.promises.stat(path.join(reportsDir, file));
                reportFiles.push({
                    filename: file,
                    url: `/reports/${file}`,
                    lastModified: stats.mtime.toLocaleString('pt-BR')
                });
            }
        }
        res.json(reportFiles);
    } catch (err) {
        res.json([]);
    }
});

// ---------------------------------------------------------------------
// 📉 ROTA DE EXPORTAÇÃO DINÂMICA (FILTROS)
// ---------------------------------------------------------------------
app.post('/api/reports/export', authMiddleware, async (req, res) => {
    // [ATUALIZADO] Permite Admin ou Supervisor
    if (req.user.role !== 'admin' && req.user.role !== 'supervisor') return res.status(403).json({ error: 'Acesso negado.' });

    const { type, startDate, endDate, cameraId, userId } = req.body;
    
    // [AUDITORIA PT-BR]
    const { ip, device } = getClientInfo(req);
    await db.logAction(req.user.id, req.user.username, 'EXPORTAR_RELATORIO', { type, range: { startDate, endDate }, filters: { cameraId, userId }, device_info: device }, ip);

    try {
        const workbook = new ExcelJS.Workbook();
        let sql = '';
        let params = [];
        let paramCounter = 1;

        if (type === 'auditoria') {
            // [SEGURANÇA] Bloqueio adicional: Só Super Admin e Supervisor
            const isSuperAdmin = req.user.username === 'superadmin';
            const isSupervisor = req.user.role === 'supervisor';

            if (!isSuperAdmin && !isSupervisor) {
                return res.status(403).json({ error: 'Acesso restrito. Apenas o Super Admin e Supervisores podem exportar logs de auditoria.' });
            }

            const worksheet = workbook.addWorksheet('Auditoria');
            worksheet.columns = [
                { header: 'Data/Hora', key: 'created_at', width: 20 },
                { header: 'Usuário', key: 'username', width: 20 },
                { header: 'Ação', key: 'action', width: 25 },
                { header: 'Tabela Alvo', key: 'table', width: 15 },
                { header: 'ID Alvo', key: 'target_id', width: 10 },
                { header: 'Detalhes (JSON)', key: 'details', width: 50 },
                { header: 'IP Origem', key: 'ip', width: 15 }
            ];
            
            sql = `SELECT * FROM audit_logs WHERE 1=1`;
            if (startDate) { sql += ` AND created_at >= $${paramCounter++}`; params.push(startDate); }
            if (endDate) { sql += ` AND created_at <= $${paramCounter++}::timestamp + INTERVAL '1 day'`; params.push(endDate); }
            if (userId) { sql += ` AND user_id = $${paramCounter++}`; params.push(userId); }
            
            sql += ` ORDER BY created_at DESC LIMIT 5000`; // Limite maior para exportação
            
            const result = await pool.query(sql, params);
            result.rows.forEach(row => {
                const date = new Date(row.created_at);
                
                // [CORREÇÃO FUSO] Formatação correta sem subtração manual
                worksheet.addRow({
                    created_at: date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
                    username: row.username,
                    action: row.action_type,
                    table: row.target_table || '-',
                    target_id: row.target_id || '-',
                    details: JSON.stringify(row.details),
                    ip: row.ip_address || '-'
                });
            });

        // --- TIPO 1: RELATÓRIO GERAL (Processamento - Auditoria) ---
        } else if (type === 'geral') {
            const worksheet = workbook.addWorksheet('Geral');
            worksheet.columns = [
                { header: 'Data Ação', key: 'data', width: 12 }, 
                { header: 'Horário Ação', key: 'horario', width: 12 },
                { header: 'Placa', key: 'placa', width: 15 }, 
                { header: 'Ação do Operador', key: 'status', width: 25 },
                { header: 'Motivo Descarte', key: 'reason', width: 20 },
                { header: 'Obs Descarte', key: 'desc', width: 30 },
                { header: 'Câmera', key: 'camera', width: 15 },
                { header: 'Operador ID', key: 'user', width: 15 }
            ];

            // [MODIFICADO] Usa processed_at (data da ação) para ordenar
            sql = `SELECT * FROM evidences WHERE 1=1 `;

            // Filtros aplicados na data de processamento (se existir)
            if (startDate) { 
                sql += ` AND COALESCE(processed_at, capture_timestamp) >= $${paramCounter++}`; 
                params.push(startDate); 
            }
            if (endDate) { 
                sql += ` AND COALESCE(processed_at, capture_timestamp) <= $${paramCounter++}`; 
                params.push(endDate); 
            }
            
            if (cameraId)  { sql += ` AND camera_id = $${paramCounter++}`; params.push(cameraId); }
            if (userId)    { sql += ` AND processed_by_user_id = $${paramCounter++}`; params.push(userId); }
            
            // Ordenar pela ação (processed_at)
            sql += ` ORDER BY COALESCE(processed_at, capture_timestamp) DESC`;

            const result = await pool.query(sql, params);
            
            result.rows.forEach(row => {
                // 1. Usa data do processamento (ação). Se não tiver, usa captura.
                const rawDate = row.processed_at ? new Date(row.processed_at) : new Date(row.capture_timestamp);
                
                const baseUrl = process.env.URL_BASE_IMAGEM || 'http://localhost:3000/images/';
                
                // 3. STATUS DE AUDITORIA: Mostra a ação (Validada) mesmo se já avançou
                let acaoDoOperador = row.status;
                if (['Autuada', 'Rejeitada', 'Validada'].includes(row.status)) {
                    acaoDoOperador = 'Validada'; 
                }

                // [CORREÇÃO FUSO] Uso de toLocaleString com timeZone
                worksheet.addRow({
                    data: rawDate.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }), 
                    horario: rawDate.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo' }),
                    placa: row.license_plate || '-',
                    status: acaoDoOperador,
                    reason: row.rejection_reason || '-',
                    desc: row.rejection_description || '-',
                    camera: row.camera_id,
                    user: row.processed_by_user_id || '-',
                    link: { text: 'Abrir', hyperlink: `${baseUrl}${row.image_filename}` }
                });
            });

        // --- TIPO 2: RELATÓRIO DE AUTUAÇÃO (Final + Expiradas) ---
        // --- TIPO 2: RELATÓRIO DE AUTUAÇÃO (Final + Expiradas) ---
        } else if (type === 'autuacao') {
            const worksheet = workbook.addWorksheet('Autuações');
            
            // 1. DEFINIÇÃO DAS COLUNAS (As "keys" aqui devem ser iguais às do addRow)
            worksheet.columns = [
                { header: 'Data Autuação', key: 'data', width: 15 },
                { header: 'Horário', key: 'hora', width: 12 },      // <--- A chave é 'hora'
                { header: 'Placa', key: 'placa', width: 15 }, 
                { header: 'Infração', key: 'infracao', width: 40 },
                { header: 'Câmera', key: 'camera', width: 15 },
                { header: 'Autuador', key: 'user', width: 20 },
                { header: 'Editado?', key: 'edited', width: 10 }
            ];

            // 2. BUSCA NO BANCO
            sql = `
                WITH CombinedData AS (
                    -- Parte 1: Autuadas Realmente
                    SELECT 
                        ai.autuado_em as data_evento,
                        ai.license_plate,
                        ai.infraction_type,
                        ai.is_edited,
                        u.username as autuador_nome,
                        e.camera_id,
                        e.processed_by_user_id
                    FROM autuadas_infractions ai
                    JOIN evidences e ON ai.evidence_id = e.id
                    JOIN users u ON ai.autuado_por_user_id = u.id
                    
                    UNION ALL
                    
                    -- Parte 2: Expiradas (Validada > 24h)
                    SELECT 
                        (e.processed_at + INTERVAL '24 HOUR') as data_evento,
                        e.license_plate,
                        'PRAZO EXPIRADO (>24h)' as infraction_type,
                        false as is_edited,
                        'SISTEMA (Expirado)' as autuador_nome,
                        e.camera_id,
                        e.processed_by_user_id
                    FROM evidences e
                    WHERE e.status = 'Validada'
                    AND e.processed_at < (NOW() - INTERVAL '24 HOUR')
                )
                SELECT * FROM CombinedData WHERE 1=1
            `;

            if (startDate) { sql += ` AND data_evento >= $${paramCounter++}`; params.push(startDate); }
            if (endDate)   { sql += ` AND data_evento <= $${paramCounter++}`; params.push(endDate); }
            if (cameraId)  { sql += ` AND camera_id = $${paramCounter++}`; params.push(cameraId); }
            if (userId)    { sql += ` AND processed_by_user_id = $${paramCounter++}`; params.push(userId); }

            sql += ` ORDER BY data_evento DESC`;

            const result = await pool.query(sql, params);

            // 3. PREENCHIMENTO DAS LINHAS
            result.rows.forEach(row => {
                const date = new Date(row.data_evento);
                
                // Formatação forçada para garantir o horário
                const dataStr = date.toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
                const horaStr = date.toLocaleTimeString('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', second: '2-digit' });

                const rowData = worksheet.addRow({
                    data: dataStr,
                    hora: horaStr,        // <--- CORRIGIDO: Agora usa 'hora' igual ao cabeçalho
                    placa: row.license_plate,
                    infracao: row.infraction_type,
                    camera: row.camera_id,
                    user: row.autuador_nome,
                    edited: row.is_edited ? 'SIM' : 'NÃO'
                });

                // Pinta de vermelho se for expirada
                if (row.autuador_nome === 'SISTEMA (Expirado)') {
                    rowData.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFCCCC' } };
                }
            });
        }

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', `attachment; filename=relatorio_${type}.xlsx`);

        await workbook.xlsx.write(res);
        res.end();

    } catch (error) {
        console.error("Erro na exportação:", error);
        res.status(500).json({ error: 'Erro ao gerar Excel.' });
    }
});

// [CORRIGIDO] Rota de Download Direto
app.get('/api/download-evidence/:filename', authMiddleware, async (req, res) => {
    // Decodifica URI para evitar erros com espaços
    const filename = decodeURIComponent(req.params.filename);
    const imagesBase = path.join(__dirname, '../images');
    let fullPath = path.join(imagesBase, filename);
    
    // [AUDITORIA PT-BR]
    const { ip, device } = getClientInfo(req);
    await db.logAction(
        req.user.id, 
        req.user.username, 
        'DOWNLOAD_IMAGEM_ORIGINAL', 
        { filename: filename, device_info: device }, 
        ip
    );

    if (!fs.existsSync(fullPath)) {
        // Tenta na pasta processed
        const altPath = path.join(imagesBase, 'processed', path.basename(filename));
        if (fs.existsSync(altPath)) {
            fullPath = altPath;
        } else {
             // Fallback final: tenta processed + nome original (caso o reqPath já tenha vindo limpo)
             const fallbackPath = path.join(imagesBase, 'processed', filename);
             if(fs.existsSync(fallbackPath)) {
                 fullPath = fallbackPath;
             }
        }
    }
    
    res.download(fullPath, filename, (err) => {
        if (err && !res.headersSent) res.status(404).send({ error: "Não encontrado." });
    });
});

// ---------------------------------------------------------------------
// 🕵️ ROTA DE INTELIGÊNCIA (CONSULTA PLACA) - [NOVO]
// ---------------------------------------------------------------------
app.get('/api/detran/lookup/:plate', authMiddleware, async (req, res) => {
    const plate = req.params.plate.toUpperCase().replace(/[^A-Z0-9]/g, '');
    
    if (plate.length < 7) return res.json({ found: false });

    // [AUDITORIA] Log de Consulta Sensível
    const { ip, device } = getClientInfo(req);

    try {
        const client = await pool.connect();
        const query = `
            SELECT 
                f.placa, f.ano_fab, f.ano_mod, f.cor_cod,
                m.descricao as modelo,
                COALESCE(a.codigo_situacao, 0) as status_alerta
            FROM detran_frota f
            LEFT JOIN detran_modelos m ON f.modelo_cod = m.codigo
            LEFT JOIN detran_alertas a ON f.placa = a.placa
            WHERE f.placa = $1
        `;
        const result = await client.query(query, [plate]);
        client.release();

        if (result.rowCount > 0) {
            // Log apenas se encontrou algo, pois é quando a informação foi revelada
            // [AUDITORIA PT-BR]
            await db.logAction(req.user.id, req.user.username, 'CONSULTAR_PLACA_DETRAN', { plate: plate, found: true, device_info: device }, ip);
            res.json({ found: true, data: result.rows[0] });
        } else {
            res.json({ found: false });
        }
    } catch (error) {
        console.error("Erro no lookup Detran:", error);
        res.status(500).json({ error: "Erro na consulta." });
    }
});

// ---------------------------------------------------------------------
// 📥 NOVA ROTA: UPLOAD MANUAL UNIFICADO (USA LÓGICA DO WORKER)
// ---------------------------------------------------------------------
app.post('/api/upload-manual', authMiddleware, upload.single('arquivo'), async (req, res) => {
    // [SEGURANÇA] Apenas Admin (Supervisor bloqueado)
    const role = (req.user.role || '').toLowerCase();
    if (role !== 'admin') {
        // Se a role for negada, o Multer já fez o upload. Precisamos limpar o lixo antes de barrar.
        if (req.file && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
        return res.status(403).json({ error: 'Acesso negado.' });
    }

    try {
        if (!req.file) return res.status(400).json({ error: 'Arquivo obrigatório' });

        const usuarioLogado = req.user.username || 'ADMIN_MANUAL'; // Pega do token
        const dataReferencia = new Date(); // No manual, data é agora

        // Chama o cérebro (mesma lógica do robô)
        const resultado = await processarArquivo(
            req.file.path, 
            ORIGEM.MANUAL, 
            usuarioLogado,
            dataReferencia
        );

        res.json({ msg: 'Importado com sucesso!', dados: resultado });

    } catch (erro) {
        console.error("Erro no upload manual:", erro);
        res.status(500).json({ error: erro.message });
    } finally {
        // [CORREÇÃO] O finally garante que, dando sucesso ou erro na leitura do Detran,
        // o arquivo físico que o Multer jogou na pasta uploads/ será sumariamente destruído.
        if (req.file && fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
    }
});

// ---------------------------------------------------------------------
// 📂 ROTA DE IMPORTAÇÃO (LEGADO - ADMIN) - COM AUDITORIA E JUSTIFICATIVA
// ---------------------------------------------------------------------
app.post('/api/admin/import-detran', authMiddleware, upload.fields([
    { name: 'frota', maxCount: 1 }, 
    { name: 'modelos', maxCount: 1 }, 
    { name: 'alertas', maxCount: 1 }
]), async (req, res) => {
    
    if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acesso negado.' });

    // [AUDITORIA] Captura a justificativa enviada pelo formulário
    const { justificativa } = req.body;
    if (!justificativa || justificativa.trim().length < 5) {
        return res.status(400).json({ error: 'É obrigatório fornecer uma justificativa válida para a operação manual.' });
    }

    const files = req.files;
    const client = await pool.connect();
    
    // Objeto para estatísticas detalhadas (UI/UX)
    const stats = {
        modelos: { total: 0, inseridos: 0, status: 'skipped' },
        frota: { total: 0, inseridos: 0, status: 'skipped' },
        alertas: { total: 0, inseridos: 0, status: 'skipped' }
    };

    const safeInt = (val) => {
        if (!val || val.trim() === '') return null;
        const parsed = parseInt(val);
        return isNaN(parsed) ? null : parsed; 
    };

    try {
        await client.query('BEGIN');
        
        // [CORREÇÃO CRÍTICA] Força o fuso horário da SESSÃO para UTC-3 (Brasília)
        // Isso garante que CURRENT_TIMESTAMP ou NOW() sejam salvos com a hora correta (-3h)
        await client.query("SET TIME ZONE 'America/Sao_Paulo'");

        // 1. Processar MODELOS
        if (files.modelos) {
            console.log('Importando Modelos...');
            stats.modelos.status = 'processing';
            const stream = fs.createReadStream(files.modelos[0].path, { encoding: 'latin1' });
            const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
            
            for await (const line of rl) {
                if(line.trim()) { 
                    stats.modelos.total++;
                    const p = line.split('|');
                    if (p.length >= 2) {
                        const codigo = safeInt(p[0]);
                        if (codigo !== null) {
                            await client.query(`
                                INSERT INTO detran_modelos (codigo, descricao) VALUES ($1, $2)
                                ON CONFLICT (codigo) DO UPDATE SET descricao = $2
                            `, [codigo, p[1].trim()]);
                            stats.modelos.inseridos++;
                        }
                    }
                }
            }
            stats.modelos.status = 'success';
            await fs.promises.unlink(files.modelos[0].path);
        }

        // 2. Processar ALERTAS
        if (files.alertas) {
            console.log('Importando Alertas...');
            stats.alertas.status = 'processing';
            await client.query('TRUNCATE TABLE detran_alertas'); 
            const stream = fs.createReadStream(files.alertas[0].path, { encoding: 'latin1' });
            const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
            
            for await (const line of rl) {
                if(line.trim()) {
                    stats.alertas.total++;
                    const p = line.split('|');
                    if (p.length >= 2) {
                        const cod = safeInt(p[1]);
                        await client.query(`
                            INSERT INTO detran_alertas (placa, codigo_situacao) VALUES ($1, $2)
                        `, [p[0], cod]);
                        stats.alertas.inseridos++;
                    }
                }
            }
            stats.alertas.status = 'success';
            await fs.promises.unlink(files.alertas[0].path);
        }

        // 3. Processar FROTA
        if (files.frota) {
            console.log('Importando Frota (Isso pode demorar)...');
            stats.frota.status = 'processing';
            const stream = fs.createReadStream(files.frota[0].path, { encoding: 'latin1' });
            const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
            
            for await (const line of rl) {
                if(line.trim()) {
                    stats.frota.total++;
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
                        
                        stats.frota.inseridos++;
                    }
                }
            }
            stats.frota.status = 'success';
            await fs.promises.unlink(files.frota[0].path);
        }

        // [IMPORTANTE] Atualiza a tabela de logs de importação para o painel reconhecer
        await client.query(`
            INSERT INTO import_logs (origem, tipo_arquivo, status, detalhes)
            VALUES ('MANUAL', 'MULTIPLOS', 'SUCESSO', $1)
        `, [JSON.stringify(stats)]);

        // [AUDITORIA PT-BR]
        const { ip, device } = getClientInfo(req);
        await db.logAction(req.user.id, req.user.username, 'IMPORTACAO_MANUAL_DETRAN', {
            justificativa: justificativa, // AQUI ESTÁ A JUSTIFICATIVA
            arquivos_processados: {
                frota: !!files.frota,
                modelos: !!files.modelos,
                alertas: !!files.alertas
            },
            stats: stats,
            device_info: device
        }, ip, 'detran_frota');

        await client.query('COMMIT');
        
        res.json({ 
            message: 'Processamento concluído.', 
            details: stats 
        });

    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Erro na importação:", error);
        
        // [AUDITORIA PT-BR]
        const { ip, device } = getClientInfo(req);
        await db.logAction(req.user.id, req.user.username, 'FALHA_IMPORTACAO_DETRAN', {
            justificativa: justificativa,
            erro: error.message,
            device_info: device
        }, ip);

        res.status(500).json({ error: 'Falha crítica ao processar arquivos.', details: error.message });
    } finally {
        client.release();
    }
});

// ---------------------------------------------------------------------
// 🔄 ROTA DE STATUS DA IMPORTAÇÃO (PARA O ADMIN.JS) [NOVO]
// ---------------------------------------------------------------------
app.get('/api/admin/import-status', authMiddleware, async (req, res) => {
    try {
        // Pega a última importação de sucesso
        const result = await pool.query(`
            SELECT data_importacao, origem, tipo_arquivo 
            FROM import_logs 
            WHERE status = 'SUCESSO' 
            ORDER BY data_importacao DESC 
            LIMIT 1
        `);

        if (result.rowCount > 0) {
            const row = result.rows[0];
            res.json({
                lastUpdate: row.data_importacao,
                source: row.origem, // 'MANUAL' ou 'AUTOMATICO'
                type: row.tipo_arquivo
            });
        } else {
            res.json({ lastUpdate: null });
        }
    } catch (error) {
        console.error("Erro ao buscar status de importação:", error);
        res.status(500).json({ error: "Erro interno." });
    }
});

// ---------------------------------------------------------------------
// 📦 SERVIR ARQUIVOS ESTÁTICOS [CORRIGIDO]
// ---------------------------------------------------------------------
app.get('/images/*', (req, res) => { 
    // Decodifica %20 para espaços e outros caracteres
    const reqPath = decodeURIComponent(req.params[0]); 
    const imagesBase = path.join(__dirname, '../images');
    
    // Tenta caminho direto
    let fullPath = path.join(imagesBase, reqPath);

    if (!fs.existsSync(fullPath)) {
        // Tenta na pasta processed usando o basename
        const alternativePath = path.join(imagesBase, 'processed', path.basename(reqPath));
        if (fs.existsSync(alternativePath)) {
            fullPath = alternativePath;
        } else {
            // Fallback final: tenta processed + nome original (caso o reqPath já tenha vindo limpo)
            const fallbackPath = path.join(imagesBase, 'processed', reqPath);
            if(fs.existsSync(fallbackPath)) {
                fullPath = fallbackPath;
            }
        }
    }
    
    res.sendFile(fullPath, (err) => {
        if (err && !res.headersSent) res.status(404).send('Imagem não encontrada');
    });
});

app.use('/reports', express.static(path.join(__dirname, 'public', 'reports')));
const FRONTEND_PATH = path.join(__dirname, '..', 'frontend'); 
app.use(express.static(FRONTEND_PATH));

app.get('/', (req, res) => {
    res.sendFile(path.join(FRONTEND_PATH, 'login.html'));
});
pool.ready.then(() => {
    app.listen(PORT, HOST, () => {
        console.log(`Servidor rodando em http://${HOST}:${PORT}`);
    });
}).catch(err => {
    console.error("Falha fatal no DB:", err);
    process.exit(1);
});