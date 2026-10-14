document.addEventListener('DOMContentLoaded', () => {
    // Função principal de logout
    const handleLogout = () => {
        // 1. Remover o token e os dados do usuário do armazenamento local
        localStorage.removeItem('authToken');
        localStorage.removeItem('user');
        
        // 2. Redirecionar para a página de login
        window.location.href = 'login.html';
    };

    // 3. Mapear o botão de logout
    const logoutButton = document.getElementById('logout-btn');
    if (logoutButton) {
        logoutButton.addEventListener('click', handleLogout);
    }
});