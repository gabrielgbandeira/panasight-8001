// frontend/reports.js (Versão Final: Filtros Completos)

const token = localStorage.getItem('authToken');
const user = JSON.parse(localStorage.getItem('user'));
const API_BASE_URL = ''; 

// Verifica permissão (Admin e Supervisor)
if (!token || !user) {
    window.location.href = 'login.html'; 
} else {
    const role = (user.role || '').toLowerCase();
    if (role !== 'admin' && role !== 'supervisor') {
        alert('Acesso restrito. Apenas Administradores e Supervisores.');
        window.location.href = 'hub.html';
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const exportForm = document.getElementById('export-form');
    
    // --- 1. Carregar Opções de Filtro (Câmeras e Usuários) ---
    const loadFilterOptions = async () => {
        try {
            // A) CARREGAR TODOS OS USUÁRIOS
            // Esta rota já retorna todos os usuários cadastrados no banco
            const resUsers = await fetch(`${API_BASE_URL}/api/users`, { 
                headers: { 'Authorization': `Bearer ${token}` } 
            });
            
            if (resUsers.ok) {
                const users = await resUsers.json();
                const userSelect = document.getElementById('filter-user');
                
                // Limpa opções anteriores (mantendo o "Todos")
                userSelect.innerHTML = '<option value="">Todos os Usuários</option>';
                
                users.forEach(u => {
                    const opt = document.createElement('option');
                    opt.value = u.id;
                    opt.textContent = u.username;
                    userSelect.appendChild(opt);
                });
            }

            // B) CARREGAR TODAS AS CÂMERAS (HISTÓRICO)
            // Agora chamamos a rota específica que criamos, em vez da lista de pendências
            const resCameras = await fetch(`${API_BASE_URL}/api/admin/all-cameras`, { 
                headers: { 'Authorization': `Bearer ${token}` } 
            });
            
            if(resCameras.ok) {
                const cameras = await resCameras.json();
                const camSelect = document.getElementById('filter-camera');

                // Limpa opções anteriores
                camSelect.innerHTML = '<option value="">Todas as Câmeras</option>';
                
                if (cameras.length === 0) {
                    // Feedback visual se não houver câmeras
                    const opt = document.createElement('option');
                    opt.disabled = true;
                    opt.textContent = "(Nenhuma câmera registrada)";
                    camSelect.appendChild(opt);
                } else {
                    cameras.forEach(c => {
                        const opt = document.createElement('option');
                        opt.value = c;
                        opt.textContent = c;
                        camSelect.appendChild(opt);
                    });
                }
            }

        } catch (error) {
            console.error("Erro ao carregar filtros:", error);
        }
    };

    // --- 2. Lógica de Exportação Dinâmica ---
    if (exportForm) {
        exportForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const btn = exportForm.querySelector('button');
            const originalText = btn.innerHTML;
            
            // Feedback visual de carregamento
            btn.disabled = true;
            btn.innerHTML = '<i class="fas fa-spinner fa-spin me-2"></i>Gerando Arquivo...';

            const filters = {
                type: document.getElementById('filter-type').value,
                startDate: document.getElementById('filter-start').value,
                endDate: document.getElementById('filter-end').value,
                cameraId: document.getElementById('filter-camera').value,
                userId: document.getElementById('filter-user').value
            };

            try {
                const response = await fetch(`${API_BASE_URL}/api/reports/export`, {
                    method: 'POST',
                    headers: { 
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${token}` 
                    },
                    body: JSON.stringify(filters)
                });

                if (!response.ok) {
                    const errJson = await response.json();
                    throw new Error(errJson.error || "Erro ao gerar relatório.");
                }

                // Processa o download do Blob (Arquivo Excel)
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                
                // Nome do arquivo baseado no tipo e data
                const timestamp = new Date().toISOString().slice(0,10); // YYYY-MM-DD
                a.download = `Relatorio_${filters.type.toUpperCase()}_${timestamp}.xlsx`;
                
                document.body.appendChild(a);
                a.click();
                a.remove();
                
            } catch (error) {
                alert('Erro ao exportar: ' + error.message);
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        });
    }

    // Inicializa os selects ao carregar a página
    loadFilterOptions();
});