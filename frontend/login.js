// frontend/login.js

const API_BASE_URL = ''; // Ajuste este endereço conforme o seu backend

document.addEventListener('DOMContentLoaded', () => {
    const loginForm = document.getElementById('login-form');
    const errorMessageDiv = document.getElementById('error-message');
    const usernameInput = document.getElementById('username');
    const passwordInput = document.getElementById('password');
    const scannerReticle = document.getElementById('scanner-reticle');

    // Função auxiliar para remover classes de estado
    const resetReticleClasses = () => {
        scannerReticle.classList.remove('scan-active', 'lock-active', 'status-success', 'status-error');
    };

    // -----------------------------------------------------
    // 🌟 LÓGICA DE INTERAÇÃO DO RETÍCULO (FOCUS/BLUR) 🌟
    // -----------------------------------------------------

    usernameInput.addEventListener('focus', () => {
        resetReticleClasses();
        scannerReticle.classList.add('scan-active'); // Neon Magenta: Aquisição de Alvo
    });
    usernameInput.addEventListener('blur', () => {
        if (!passwordInput.matches(':focus')) {
            resetReticleClasses(); // Volta ao Standby
        }
    });

    passwordInput.addEventListener('focus', () => {
        resetReticleClasses();
        scannerReticle.classList.add('lock-active'); // Neon Amarelo: Bloqueio/Verificação
    });
    passwordInput.addEventListener('blur', () => {
        if (!usernameInput.matches(':focus')) {
            resetReticleClasses(); // Volta ao Standby
        }
    });

    // -----------------------------------------------------
    // LÓGICA DE SUBMIT (Com Feedback Visual do Retículo)
    // -----------------------------------------------------

    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        const username = usernameInput.value;
        const password = passwordInput.value;
        errorMessageDiv.classList.add('d-none');
        
        // Simula o estado de Verificação antes do fetch
        resetReticleClasses();
        scannerReticle.classList.add('lock-active'); 

        try {
            const response = await fetch(`${API_BASE_URL}/api/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username, password }),
            });

            const data = await response.json().catch(() => ({ error: 'Resposta do servidor não é JSON válido.' }));

            if (!response.ok) {
                // ERRO: Neon Vermelho
                scannerReticle.classList.remove('lock-active'); 
                scannerReticle.classList.add('status-error'); 
                setTimeout(resetReticleClasses, 1000); // Reseta após o piscar
                errorMessageDiv.textContent = data.error || `Erro de Servidor: ${response.status}`;
                errorMessageDiv.classList.remove('d-none');
                return;
            }

            // SUCESSO: Neon Verde
            localStorage.setItem('authToken', data.token);
            localStorage.setItem('user', JSON.stringify(data.user));

            scannerReticle.classList.remove('lock-active'); 
            scannerReticle.classList.add('status-success'); 
            
            // Redirecionamento após o efeito visual de sucesso
            setTimeout(() => {
                switch (data.user.role) {
                    case 'admin':
                        window.location.href = 'hub.html'; 
                        break;
                    case 'operador': 
                        window.location.href = 'hub.html'; 
                        break;
                    case 'autuador':
                        window.location.href = 'hub.html'; 
                        break;
                    case 'supervisor': // [NOVO] Redirecionamento para o Supervisor
                        window.location.href = 'hub.html'; 
                        break;
                    default:
                        // Perfil desconhecido
                        errorMessageDiv.textContent = 'Perfil de utilizador desconhecido ou sem acesso.';
                        errorMessageDiv.classList.remove('d-none');
                        localStorage.removeItem('authToken');
                        localStorage.removeItem('user');
                        resetReticleClasses();
                }
            }, 500); // Espera 0.5s para o efeito
        } catch (error) {
            console.error("Erro fatal na comunicação:", error);
            errorMessageDiv.textContent = 'Não foi possível ligar ao servidor.';
            errorMessageDiv.classList.remove('d-none');
            scannerReticle.classList.add('status-error');
            setTimeout(resetReticleClasses, 1000);
        }
    });
});