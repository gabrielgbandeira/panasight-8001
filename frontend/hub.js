// frontend/hub.js

const token = localStorage.getItem('authToken');
const user = JSON.parse(localStorage.getItem('user'));
const API_BASE_URL = ''; 

// 1. VERIFICAÇÃO DE SEGURANÇA E REDIRECIONAMENTO
if (!token || !user) {
    window.location.href = 'login.html';
}

let sessionCheckInterval = null; 

document.addEventListener('DOMContentLoaded', () => {
    
    // --- 1. SETUP DE USUÁRIO E CARGO ---
    const userNameEl = document.getElementById('userName');
    const userRoleEl = document.getElementById('userRole');

    if (userNameEl) userNameEl.textContent = user.username || 'Agente';
    
    // Normalização da role para exibição
    if (userRoleEl) {
        const role = (user.role || '').toLowerCase();
        userRoleEl.textContent = user.role || 'Indefinido';

        // Definição de cores conforme o cargo
        if (role === 'admin') {
            userRoleEl.className = 'badge bg-warning text-dark';
        } else if (role === 'autuador') {
            userRoleEl.className = 'badge bg-info text-dark';
        } else if (role === 'supervisor') {
            userRoleEl.className = 'badge bg-primary'; 
        } else {
            userRoleEl.className = 'badge bg-secondary';
        }
    }

    // --- 2. RELÓGIO EM TEMPO REAL ---
    setInterval(() => {
        const el = document.getElementById('clock');
        if (el) el.textContent = new Date().toLocaleTimeString('pt-BR');
    }, 1000);

    // --- 3. CONTROLE DE PERMISSÕES (VISUALIZAÇÃO DE BOTÕES) ---
    if (user.role !== 'admin') {
        const adminBtn = document.querySelector('div[onclick*="admin.html"]');
        const auditBtn = document.querySelector('div[onclick*="auditoria.html"]');
        
        if (user.role !== 'supervisor') {
             if (adminBtn) adminBtn.style.display = 'none';
             if (auditBtn) auditBtn.style.display = 'none';
        }
    }

    // --- 4. LOGOUT ---
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => {
            localStorage.clear();
            window.location.href = 'login.html';
        });
    }

    // --- 5. INICIALIZAÇÃO DO DASHBOARD ---
    fetchDashboardStats();

    // Atualiza automaticamente a cada 15 segundos
    setInterval(fetchDashboardStats, 15000);
});

// =========================================================================
// FUNÇÕES DE DADOS (SIMPLIFICADAS PARA DADOS DIÁRIOS)
// =========================================================================

async function fetchDashboardStats() {
    try {
        const response = await fetch(`${API_BASE_URL}/api/dashboard/stats`, {
            method: 'GET',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        if (!response.ok) {
            if (response.status === 401) {
                console.warn("Sessão expirada no dashboard.");
                localStorage.clear();
                window.location.href = 'login.html';
                return;
            }
            throw new Error(`Erro na API: ${response.status}`);
        }

        const data = await response.json();

        // Atualiza os Cards com foco exclusivo no dado DIÁRIO (.day)
        updateValue('kpiPending', data.pending);
        updateValue('kpiProcessed', data.validations.day);
        updateValue('kpiRejected', data.rejected.day);
        updateValue('kpiTma', data.fines.day);

    } catch (error) {
        console.error('Falha ao atualizar dashboard:', error);
        displayErrorState(['kpiPending', 'kpiProcessed', 'kpiRejected', 'kpiTma']);
    }
}

// Atualiza valor simples (Agora o padrão do sistema)
function updateValue(elementId, value) {
    const el = document.getElementById(elementId);
    if (el) {
        el.innerText = (value || 0).toLocaleString('pt-BR');
        el.style.color = '#fff';
    }
}

// Mostra estado de erro nos cards
function displayErrorState(ids) {
    ids.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.innerText = '-';
            el.style.color = '#6c757d';
        }
    });
}