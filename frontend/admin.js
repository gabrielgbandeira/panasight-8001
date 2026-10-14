// frontend/admin.js (VERSÃO FINAL - COM VISUALIZAÇÃO DE ORIGEM DA IMPORTAÇÃO + SUPERVISOR)

const token = localStorage.getItem('authToken');
const user = JSON.parse(localStorage.getItem('user'));
// Ajuste a URL se necessário (ex: 'http://localhost:3000')
const API_BASE_URL = ''; 

// 1. Verificação de Acesso (Admin ou Supervisor)
// [ATUALIZADO] Permite entrada de Supervisor
if (!token || !user || (user.role !== 'admin' && user.role !== 'supervisor')) {
    window.location.href = 'login.html'; 
}

const isSupervisor = user.role === 'supervisor'; // [NOVO] Flag de controle

// Variáveis Globais
let userModal, deleteModal;
let currentUserId = null; 

document.addEventListener('DOMContentLoaded', () => {
    // Inicialização dos Modais Bootstrap
    const modalUserEl = document.getElementById('userModal');
    if (modalUserEl) userModal = new bootstrap.Modal(modalUserEl);
    
    const modalDelEl = document.getElementById('deleteConfirmationModal');
    if (modalDelEl) deleteModal = new bootstrap.Modal(modalDelEl);

    // [NOVO] Lógica de Interface para Supervisor (Read-Only)
    if (isSupervisor) {
        // Oculta botão de criar usuário
        const btnNewUser = document.querySelector('button[data-bs-target="#userModal"]');
        if(btnNewUser) btnNewUser.style.display = 'none';

        // Desabilita form de importação
        const importForm = document.getElementById('import-detran-form');
        if(importForm) {
            Array.from(importForm.elements).forEach(el => el.disabled = true);
        }
        
        // Exibe aviso de bloqueio (se existir no HTML)
        const lockMsg = document.getElementById('supervisor-lock-message');
        if(lockMsg) lockMsg.classList.remove('d-none');
    }

    // --- GESTÃO DE USUÁRIOS (Listeners) ---
    const userForm = document.getElementById('user-form');
    if (userForm) userForm.addEventListener('submit', handleUserFormSubmit);
    
    // Botão que abre o modal de Novo Usuário
    const addUserButton = document.querySelector('button[data-bs-target="#userModal"]');
    if (addUserButton) addUserButton.addEventListener('click', prepareCreateModal);

    const confirmDeleteButton = document.getElementById('confirm-delete-btn');
    if (confirmDeleteButton) confirmDeleteButton.addEventListener('click', handleDeleteUser);

    const passHelp = document.getElementById('passwordHelp');
    if (passHelp) passHelp.textContent = 'Deixe em branco para manter a senha atual.';

    // Carregar lista inicial de usuários
    fetchUsers();

    // --- IMPORTAÇÃO DETRAN (Listener) ---
    const importForm = document.getElementById('import-detran-form');
    if (importForm) {
        importForm.addEventListener('submit', handleImportSubmit);
        // Só busca o status se a aba de importação existir
        fetchImportStatus();
    }
});

// [ATUALIZADO] Buscar e exibir data e método separadamente
async function fetchImportStatus() {
    const labelDate = document.getElementById('db-last-update');
    const labelMethod = document.getElementById('db-update-method'); // Novo elemento
    
    if (!labelDate || !labelMethod) return;

    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/import-status`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await response.json();

        if (data.lastUpdate) {
            const date = new Date(data.lastUpdate);
            
            // 1. Exibe a Data e Hora
            labelDate.textContent = date.toLocaleString('pt-BR');
            labelDate.classList.remove('text-warning');
            labelDate.classList.add('text-white');

            // 2. Exibe o Método (AUTOMATICO ou MANUAL)
            // Se vier null ou vazio, assume 'DESCONHECIDO'
            const metodo = data.source ? data.source.toUpperCase() : 'DESCONHECIDO';
            labelMethod.textContent = metodo;

            // Estilização condicional do método
            if (metodo === 'AUTOMATICO') {
                labelMethod.className = 'text-success fw-bold'; // Verde para Automático
            } else {
                labelMethod.className = 'text-info fw-bold';    // Azul para Manual (ou default)
            }

        } else {
            labelDate.textContent = "Nunca Atualizado";
            labelDate.classList.add('text-warning');
            labelMethod.textContent = "-";
        }
    } catch (error) {
        console.error("Erro ao buscar status:", error);
        labelDate.textContent = "Indisponível";
        labelMethod.textContent = "Erro";
    }
}

// --- LÓGICA DE USUÁRIOS ---

async function fetchUsers() {
    const userListBody = document.getElementById('user-list-body');
    if (!userListBody) return;

    userListBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted"><div class="spinner-border spinner-border-sm text-primary"></div> Carregando...</td></tr>';

    try {
        const response = await fetch(`${API_BASE_URL}/api/users`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (!response.ok) throw new Error('Falha ao carregar usuários.');

        const users = await response.json();
        userListBody.innerHTML = '';

        if (users.length > 0) {
            users.forEach(u => {
                const row = document.createElement('tr');
                
                let roleBadge = 'bg-secondary';
                if (u.role === 'admin') roleBadge = 'bg-danger';
                if (u.role === 'autuador') roleBadge = 'bg-warning text-dark';
                if (u.role === 'operador') roleBadge = 'bg-info text-dark';
                if (u.role === 'supervisor') roleBadge = 'bg-primary'; // [NOVO] Badge Supervisor

                // [NOVO] Define as ações baseadas no perfil
                let actionsHtml = '';
                if (!isSupervisor) {
                    actionsHtml = `
                        <button class="btn btn-sm btn-outline-light me-1 edit-btn" data-user-id="${u.id}">
                            <i class="fas fa-edit"></i> Editar
                        </button>
                        <button class="btn btn-sm btn-outline-danger ms-1 delete-btn" data-user-id="${u.id}" data-username="${u.username}">
                            <i class="fas fa-trash-alt"></i> Excluir
                        </button>
                    `;
                } else {
                    actionsHtml = `<span class="text-muted small"><i class="fas fa-lock"></i> Leitura</span>`;
                }

                row.innerHTML = `
                    <td class="ps-4 text-white-50 small">#${u.id}</td>
                    <td class="fw-bold text-white">${u.username}</td>
                    <td><span class="badge ${roleBadge}">${u.role.toUpperCase()}</span></td>
                    <td class="text-end pe-4">${actionsHtml}</td>
                `;
                userListBody.appendChild(row);
            });
            
            // [NOVO] Re-aplicar listeners APENAS se não for supervisor
            if (!isSupervisor) {
                document.querySelectorAll('.edit-btn').forEach(button => {
                    button.addEventListener('click', (e) => {
                        const userId = e.currentTarget.dataset.userId;
                        const userToEdit = users.find(usr => usr.id == userId);
                        if (userToEdit) prepareEditModal(userToEdit);
                    });
                });

                document.querySelectorAll('.delete-btn').forEach(button => {
                    button.addEventListener('click', (e) => {
                        const userId = e.currentTarget.dataset.userId;
                        const username = e.currentTarget.dataset.username;
                        prepareDeleteModal(userId, username);
                    });
                });
            }

        } else {
            userListBody.innerHTML = '<tr><td colspan="4" class="text-center text-muted">Nenhum usuário encontrado.</td></tr>';
        }
    } catch (error) {
        console.error('Erro:', error);
        userListBody.innerHTML = `<tr><td colspan="4" class="text-center text-danger">${error.message}</td></tr>`;
    }
}

function prepareCreateModal() {
    currentUserId = null;
    const label = document.getElementById('userModalLabel');
    if(label) label.textContent = 'Novo Usuário';
    
    const form = document.getElementById('user-form');
    if(form) form.reset();

    const passInput = document.getElementById('password');
    if(passInput) passInput.required = true; 
    
    const passHelp = document.getElementById('passwordHelp');
    if(passHelp) passHelp.textContent = 'Defina uma senha forte.';
}

function prepareEditModal(user) {
    currentUserId = user.id;
    const label = document.getElementById('userModalLabel');
    if(label) label.textContent = `Editar Usuário: ${user.username}`;
    
    document.getElementById('username').value = user.username;
    document.getElementById('role').value = user.role;
    
    const passInput = document.getElementById('password');
    if(passInput) {
        passInput.value = ''; 
        passInput.required = false; 
    }
    
    const passHelp = document.getElementById('passwordHelp');
    if(passHelp) passHelp.textContent = 'Deixe em branco para manter a senha atual.';
    
    if(userModal) userModal.show();
}

function prepareDeleteModal(userId, username) {
    currentUserId = userId;
    const nameSpan = document.getElementById('user-to-delete-name');
    if(nameSpan) nameSpan.textContent = username;
    
    if(deleteModal) deleteModal.show();
}

async function handleUserFormSubmit(e) {
    e.preventDefault();
    if(isSupervisor) return; // [NOVO] Segurança Front-End
    
    const username = document.getElementById('username').value;
    const password = document.getElementById('password').value;
    const role = document.getElementById('role').value;

    const payload = { username, role };
    if (password) payload.password = password;

    const method = currentUserId ? 'PUT' : 'POST';
    const url = currentUserId ? `${API_BASE_URL}/api/users/${currentUserId}` : `${API_BASE_URL}/api/users`;

    try {
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json();

        if (response.ok) {
            if(userModal) userModal.hide();
            fetchUsers(); 
        } else {
            alert(data.error || 'Erro ao salvar usuário.');
        }
    } catch (error) {
        console.error('Erro:', error);
        alert('Falha na comunicação com o servidor.');
    }
}

async function handleDeleteUser() {
    if (!currentUserId || isSupervisor) return; // [NOVO] Segurança Front-End

    try {
        const response = await fetch(`${API_BASE_URL}/api/users/${currentUserId}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        const data = await response.json();

        if (response.ok) {
            if(deleteModal) deleteModal.hide();
            fetchUsers();
        } else {
            alert(data.error || 'Erro ao excluir.');
        }
    } catch (error) {
        console.error('Erro:', error);
        alert('Erro ao excluir usuário.');
    }
}

// --- LÓGICA DE IMPORTAÇÃO DETRAN ---
async function handleImportSubmit(e) {
    e.preventDefault();
    if(isSupervisor) return; // [NOVO] Segurança Front-End

    const form = e.target;
    const formData = new FormData(form);
    const btn = document.getElementById('btn-importar');
    const progress = document.getElementById('import-progress');
    const resultBox = document.getElementById('import-result');

    // UI Reset
    if(btn) btn.disabled = true;
    if(resultBox) {
        resultBox.classList.add('d-none');
        resultBox.className = 'mt-3 d-none p-2 rounded border'; 
    }

    // [VALIDAÇÃO] Verifica se a justificativa foi preenchida
    const justificativa = formData.get('justificativa');
    if (!justificativa || justificativa.trim().length < 5) {
        if(resultBox) {
            resultBox.classList.remove('d-none');
            resultBox.classList.add('border-danger', 'bg-danger', 'bg-opacity-10', 'text-white');
            resultBox.innerHTML = `<strong class="text-danger"><i class="fas fa-exclamation-circle me-2"></i>Erro:</strong> É obrigatório informar a justificativa para upload manual.`;
        }
        if(btn) btn.disabled = false;
        return; // Interrompe o envio
    }

    if(progress) progress.classList.remove('d-none');
    
    try {
        const response = await fetch(`${API_BASE_URL}/api/admin/import-detran`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` },
            body: formData
        });

        const data = await response.json();

        if (response.ok) {
            if(resultBox) {
                resultBox.classList.remove('d-none');
                resultBox.classList.add('border-success', 'bg-success', 'bg-opacity-10', 'text-white');
                
                const d = data.details;
                resultBox.innerHTML = `
                    <strong class="text-success"><i class="fas fa-check-circle me-2"></i>Importação Concluída!</strong>
                    <hr class="border-secondary my-2">
                    <div class="small">
                        <div class="d-flex justify-content-between"><span>Modelos:</span> <strong>${d.modelos.inseridos} / ${d.modelos.total}</strong></div>
                        <div class="d-flex justify-content-between"><span>Alertas:</span> <strong>${d.alertas.inseridos} / ${d.alertas.total}</strong></div>
                        <div class="d-flex justify-content-between"><span>Frota:</span> <strong>${d.frota.inseridos} / ${d.frota.total}</strong></div>
                    </div>
                `;
            }
            form.reset();
            // Atualiza o status
            fetchImportStatus();
        } else {
            throw new Error(data.error || 'Erro desconhecido na importação.');
        }

    } catch (err) {
        console.error(err);
        if(resultBox) {
            resultBox.classList.remove('d-none');
            resultBox.classList.add('border-danger', 'bg-danger', 'bg-opacity-10', 'text-white');
            resultBox.innerHTML = `<strong class="text-danger"><i class="fas fa-exclamation-triangle me-2"></i>Erro:</strong> ${err.message}`;
        }
    } finally {
        if(btn) btn.disabled = false;
        if(progress) progress.classList.add('d-none');
    }
}