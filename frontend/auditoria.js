// frontend/auditoria.js (VERSÃO FINAL - FILTRO DINÂMICO + SUPORTE HÍBRIDO EN/PT)

const API_BASE = '/api';

// Verifica autenticação e permissão ao carregar
document.addEventListener('DOMContentLoaded', async () => {
    const token = localStorage.getItem('authToken'); 
    
    if (!token) {
        window.location.href = 'login.html';
        return;
    }

    // Inicializa datas (Hoje)
    document.getElementById('startDate').valueAsDate = new Date();
    document.getElementById('endDate').valueAsDate = new Date();

    try {
        // Carrega usuários, Tipos de Ação (Dinâmico) e os Logs iniciais
        await Promise.all([fetchUsers(), fetchActionTypes(), loadLogs()]);
    } catch (err) {
        console.error("Erro na inicialização:", err);
    }

    // Event Listeners
    document.getElementById('filter-form').addEventListener('submit', (e) => {
        e.preventDefault();
        loadLogs();
    });

    document.getElementById('btn-export-audit').addEventListener('click', exportAudit);
});

// [NOVO] Busca tipos de ação que REALMENTE existem no banco (mistura de Inglês e PT-BR)
async function fetchActionTypes() {
    const token = localStorage.getItem('authToken');
    try {
        // Chama a nova rota do servidor
        const res = await fetch(`${API_BASE}/admin/audit-types`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) return;

        const types = await res.json();
        const select = document.getElementById('actionSelect');
        
        // Limpa opções (mantendo a opção "Todas")
        while (select.options.length > 1) {
            select.remove(1);
        }

        // Mapa de tradução para exibir bonito no Dropdown
        const displayMap = {
            // -- LEGADO (INGLÊS) --
            'LOGIN_SUCCESS': 'Login (Legado)',
            'USER_CREATE': 'Criação de Usuário (Legado)',
            'USER_DELETE': 'Exclusão de Usuário (Legado)',
            'USER_UPDATE': 'Edição de Usuário (Legado)',
            'IMPORT_MANUAL': 'Importação Manual (Legado)',
            'EVIDENCE_PROCESS': 'Processamento (Legado)',
            'INFRACTION_ISSUE': 'Autuação (Legado)',
            
            // -- NOVO PADRÃO (PT-BR) --
            'LOGIN_REALIZADO': 'Login Realizado',
            'VISUALIZAR_LISTA_USUARIOS': 'Visualizar Lista de Usuários',
            'CRIAR_USUARIO': 'Criação de Usuário',
            'EDITAR_USUARIO': 'Edição de Usuário',
            'EXCLUIR_USUARIO': 'Exclusão de Usuário',
            'VISUALIZAR_LOGS_AUDITORIA': 'Visualizar Logs de Auditoria',
            'PROCESSAR_EVIDENCIA': 'Processamento de Imagem',
            'AUTUAR_INFRACAO': 'Emissão de Multa',
            'REJEITAR_AUTUACAO': 'Rejeição de Autuação',
            'DOWNLOAD_IMAGEM_ORIGINAL': 'Download Imagem Original',
            'DOWNLOAD_IMAGEM_TARJADA': 'Download Imagem Tarjada',
            'EXPORTAR_RELATORIO': 'Exportação de Relatório',
            'CONSULTAR_PLACA_DETRAN': 'Consulta Detran',
            'IMPORTACAO_MANUAL_DETRAN': 'Importação Manual Detran',
            'FALHA_IMPORTACAO_DETRAN': 'Falha na Importação'
        };

        types.forEach(type => {
            const opt = document.createElement('option');
            opt.value = type;
            // Se tiver no mapa, usa a tradução. Se não, tira os underlines.
            opt.innerText = displayMap[type] || type.replace(/_/g, ' ');
            select.appendChild(opt);
        });
    } catch (err) {
        console.error("Erro ao buscar tipos de ação:", err);
    }
}

// Busca lista de usuários para o filtro
async function fetchUsers() {
    const token = localStorage.getItem('authToken');
    try {
        const res = await fetch(`${API_BASE}/users`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) return;

        const users = await res.json();
        const select = document.getElementById('userSelect');
        
        while (select.options.length > 1) {
            select.remove(1);
        }

        users.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.id;
            opt.innerText = u.username;
            select.appendChild(opt);
        });
    } catch (err) {
        console.error("Erro ao buscar usuários:", err);
    }
}

// Carrega os logs da API
async function loadLogs() {
    const token = localStorage.getItem('authToken');
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    const userId = document.getElementById('userSelect').value;
    const actionType = document.getElementById('actionSelect').value;

    const tbody = document.getElementById('audit-table-body');
    tbody.innerHTML = '<tr><td colspan="6" class="text-center py-5 text-muted"><i class="fas fa-spinner fa-spin me-2"></i>Atualizando...</td></tr>';

    const params = new URLSearchParams({ startDate, endDate, userId, actionType });

    try {
        const res = await fetch(`${API_BASE}/admin/audit-logs?${params}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (res.status === 403) {
            alert("🔒 ACESSO RESTRITO\n\nEsta página contém dados sensíveis e é exclusiva para o Super Admin.\nVocê será redirecionado para o Hub.");
            window.location.href = 'hub.html';
            return;
        }

        if (res.status === 401) {
            window.location.href = 'login.html';
            return;
        }

        if (!res.ok) throw new Error("Falha ao buscar logs");

        const logs = await res.json();
        tbody.innerHTML = '';

        if (logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center py-5 text-muted">Nenhum registro encontrado para os filtros selecionados.</td></tr>';
            return;
        }

        const now = new Date();

        logs.forEach(log => {
            let dateObj = new Date(log.created_at);

            // [CORREÇÃO INTELIGENTE DE FUSO HORÁRIO]
            if (dateObj.getTime() > now.getTime() + (10 * 60 * 1000)) {
                dateObj = new Date(dateObj.getTime() - (3 * 60 * 60 * 1000));
            }

            const date = dateObj.toLocaleString('pt-BR');
            const detailsJson = JSON.stringify(log.details, null, 2); 
            const detailsShort = JSON.stringify(log.details); 
            
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td class="ps-4 fw-bold text-light" style="font-size: 0.9rem;">${date}</td>
                <td><span class="text-info fw-bold">${log.username || 'Sistema'}</span></td>
                <td>${getActionBadge(log.action_type)}</td>
                <td class="text-muted small">${formatTarget(log.target_table, log.target_id)}</td>
                <td>
                    <div class="json-preview" title="Clique para ver detalhes" onclick="openDetailsModal(this)">
                        <i class="fas fa-code me-1 text-secondary"></i> ${detailsShort}
                    </div>
                    <div class="d-none full-json">${detailsJson}</div>
                </td>
                <td class="text-secondary small font-monospace">${log.ip_address || '-'}</td>
            `;
            tbody.appendChild(tr);
        });

    } catch (err) {
        console.error(err);
        tbody.innerHTML = '<tr><td colspan="6" class="text-center py-5 text-danger">Erro ao carregar dados. Tente novamente.</td></tr>';
    }
}

function formatTarget(table, id) {
    if (!table) return '-';
    return `${table.toUpperCase()} <span class="text-white">#${id || '?'}</span>`;
}

// [ATUALIZADO] Gera badges traduzidos e coloridos (Suporte PT-BR e EN)
function getActionBadge(action) {
    // Reutiliza o mesmo mapa para as Badges da tabela
    const traducoes = {
        'LOGIN_SUCCESS': 'Login Realizado',
        'USER_CREATE': 'Usuário Criado',
        'USER_UPDATE': 'Usuário Editado',
        'USER_DELETE': 'Usuário Excluído',
        'IMPORT_MANUAL': 'Importação Manual',
        'IMPORT_MANUAL_FAIL': 'Falha na Importação',
        'EVIDENCE_PROCESS': 'Evidência Processada',
        'INFRACTION_ISSUE': 'Infração Autuada',
        'AUTUACAO_REJECT': 'Autuação Rejeitada',
        'EXPORT_REPORT': 'Relatório Exportado',
        'DETRAN_LOOKUP': 'Consulta Detran',
        
        // Novos PT-BR
        'LOGIN_REALIZADO': 'Login Realizado',
        'VISUALIZAR_LISTA_USUARIOS': 'Lista de Usuários',
        'CRIAR_USUARIO': 'Usuário Criado',
        'EDITAR_USUARIO': 'Usuário Editado',
        'EXCLUIR_USUARIO': 'Usuário Excluído',
        'VISUALIZAR_LOGS_AUDITORIA': 'Auditoria Visualizada',
        'PROCESSAR_EVIDENCIA': 'Evidência Processada',
        'AUTUAR_INFRACAO': 'Infração Autuada',
        'REJEITAR_AUTUACAO': 'Autuação Rejeitada',
        'DOWNLOAD_IMAGEM_ORIGINAL': 'Download Original',
        'DOWNLOAD_IMAGEM_TARJADA': 'Download Tarjada',
        'EXPORTAR_RELATORIO': 'Relatório Exportado',
        'CONSULTAR_PLACA_DETRAN': 'Consulta Detran',
        'IMPORTACAO_MANUAL_DETRAN': 'Importação Manual',
        'FALHA_IMPORTACAO_DETRAN': 'Falha Importação'
    };

    const label = traducoes[action] || action.replace(/_/g, ' ');

    let cls = 'bg-info-custom';
    let icon = 'fa-info-circle';

    // Lógica de cores baseada em palavras-chave (funciona para EN e PT)
    if (action.includes('LOGIN')) { 
        cls = 'bg-login'; 
        icon = 'fa-sign-in-alt'; 
    }
    else if (action.includes('DELETE') || action.includes('REJECT') || action.includes('REJEITAR') || action.includes('EXCLUIR') || action.includes('FAIL') || action.includes('FALHA')) { 
        cls = 'bg-danger-custom'; 
        icon = 'fa-exclamation-triangle'; 
    }
    else if (action.includes('EXPORT') || action.includes('LOOKUP') || action.includes('CONSULTAR') || action.includes('VISUALIZAR')) { 
        cls = 'bg-warn-custom'; 
        icon = 'fa-eye'; 
    }
    else if (action.includes('PROCESS') || action.includes('ISSUE') || action.includes('CRIAR') || action.includes('EDITAR') || action.includes('AUTUAR')) { 
        cls = 'bg-info-custom'; 
        icon = 'fa-cogs'; 
    }

    return `<span class="badge badge-action ${cls}"><i class="fas ${icon} me-1"></i>${label}</span>`;
}

window.openDetailsModal = function(element) {
    const jsonContent = element.nextElementSibling.innerText; 
    document.getElementById('jsonViewer').innerText = jsonContent;
    const modal = new bootstrap.Modal(document.getElementById('detailsModal'));
    modal.show();
};

async function exportAudit() {
    const token = localStorage.getItem('authToken');
    const startDate = document.getElementById('startDate').value;
    const endDate = document.getElementById('endDate').value;
    const userId = document.getElementById('userSelect').value;

    const btn = document.getElementById('btn-export-audit');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Gerando...';
    btn.disabled = true;

    const body = { type: 'auditoria', startDate, endDate, userId };

    try {
        const res = await fetch(`${API_BASE}/reports/export`, {
            method: 'POST',
            headers: { 
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}` 
            },
            body: JSON.stringify(body)
        });

        if (res.status === 403) {
            alert('Apenas o Super Admin pode exportar este relatório.');
            return;
        }

        if (res.ok) {
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `auditoria_blindada_${new Date().getTime()}.xlsx`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
        } else {
            alert('Erro ao gerar exportação.');
        }
    } catch (err) {
        console.error(err);
        alert('Erro de conexão.');
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
}