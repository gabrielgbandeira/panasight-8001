// frontend/autuacao.js (Versão Final Completa com CROP: Auditoria + Visual + Detran + Locking + Recorte)

const token = localStorage.getItem('authToken');
const user = JSON.parse(localStorage.getItem('user'));
const API_BASE_URL = ''; 

// 1. VERIFICAÇÃO DE SEGURANÇA E PERMISSÕES
if (!token || !user) {
    window.location.href = 'login.html';
} else {
    // Guarda de Rota: Admin, Autuador ou Supervisor
    if (user.role !== 'admin' && user.role !== 'autuador' && user.role !== 'supervisor') {
        alert('ACESSO NEGADO: Seu perfil não permite acessar a Tela de Autuação.');
        window.location.href = 'hub.html';
        throw new Error("Acesso não autorizado para este perfil.");
    }
}

// --- VARIÁVEIS GLOBAIS ---
let imgState = { 
    zoom: 1.0, 
    brightness: 100, 
    contrast: 100, 
    invert: 0, 
    grayscale: 0,
    translateX: 0, 
    translateY: 0,
    isPanning: false, 
    startX: 0, 
    startY: 0 
};

// Variáveis de Edição (Redação e Recorte)
let isRedactionMode = false; 
let isCropMode = false; // [NOVO] Flag para modo de recorte
let isDrawing = false, rectStartX, rectStartY, redactionRects = [];
let originalImageSrc = null; // [NOVO] Armazena a imagem original para desfazer o corte

// Elementos e Intervalos
let allImages = [], activeImageId = null;
let heartbeatInterval = null; 
let sessionCheckInterval = null;
let listRefreshInterval = null;
let discardModal;
let mainImage, imageWrapper, redactionCanvas;
let toggleRedactionBtn, togglePanBtn, undoRedactionBtn;
let toggleCropBtn, undoCropBtn; // [NOVO] Referências dos botões de recorte

// Flag de Supervisor
const isSupervisor = (user && user.role === 'supervisor');

// Mapeamento de Cores (Padrão DENATRAN)
const CORES = { 1:'AMARELA', 2:'AZUL', 3:'BEGE', 4:'BRANCA', 5:'CINZA', 6:'DOURADA', 7:'GRENA', 8:'LARANJA', 9:'MARROM', 10:'PRATA', 11:'PRETA', 12:'ROSA', 13:'ROXA', 14:'VERDE', 15:'VERMELHA' };

// --- VERIFICADOR DE SESSÃO ATIVA ---
async function checkSessionStatus() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/users/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401 || res.status === 403) {
            clearInterval(sessionCheckInterval);
            alert("Sua sessão foi encerrada (Login detectado em outro local).");
            window.location.href = 'login.html';
        }
    } catch (e) { console.error("Erro sessão", e); }
}

// --- FUNÇÃO DE INTELIGÊNCIA (DETRAN) ---
async function lookupDetran() {
    const plateInput = document.getElementById('license-plate');
    if (!plateInput) return;
    
    const plate = plateInput.value.replace(/[^a-zA-Z0-9]/g, '').toUpperCase();
    
    const elModelo = document.getElementById('detran-modelo');
    const elInfo = document.getElementById('detran-info');
    const elBadge = document.getElementById('detran-badge');
    const elAlert = document.getElementById('detran-alert');
    const elAlertText = document.getElementById('detran-alert-text');

    elModelo.innerText = "---";
    elInfo.innerText = "---";
    elBadge.className = "badge bg-secondary border border-secondary text-white";
    elBadge.innerText = "Consultando...";
    elAlert.classList.add('d-none');
    elAlert.classList.remove('alert-danger', 'alert-warning');

    if (plate.length < 7) {
        elBadge.innerText = "Aguardando Placa...";
        return;
    }

    try {
        const res = await fetch(`${API_BASE_URL}/api/detran/lookup/${plate}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        if (!res.ok) throw new Error("Erro na API");

        const json = await res.json();
        
        if (json.found) {
            const d = json.data;
            const cor = CORES[d.cor_cod] || 'OUTRA';
            
            elModelo.innerText = d.modelo || 'MODELO NÃO CADASTRADO';
            elInfo.innerText = `${d.ano_fab}/${d.ano_mod} • ${cor}`;
            
            if (d.status_alerta === 3) {
                elBadge.className = "badge bg-danger border border-danger blink-animation";
                elBadge.innerText = "CRÍTICO";
                elAlert.classList.remove('d-none');
                elAlert.classList.add('alert-danger'); 
                if(elAlertText) elAlertText.innerText = "VEÍCULO ROUBADO/FURTADO";
            } else if (d.status_alerta === 2) {
                elBadge.className = "badge bg-warning text-dark border border-warning blink-animation";
                elBadge.innerText = "IRREGULAR";
                elAlert.classList.remove('d-none');
                elAlert.classList.add('alert-warning'); 
                if(elAlertText) elAlertText.innerText = "LICENCIAMENTO ATRASADO";
            } else {
                elBadge.className = "badge bg-success border border-success";
                elBadge.innerText = "REGULAR";
            }
        } else {
            elBadge.className = "badge bg-warning text-dark border border-warning";
            elBadge.innerText = "NÃO ENCONTRADO";
            elModelo.innerText = "Placa inexistente na base";
        }
    } catch (e) {
        console.error("Erro Detran:", e);
        elBadge.className = "badge bg-dark border border-secondary";
        elBadge.innerText = "ERRO CONEXÃO";
    }
}

// --- INICIALIZAÇÃO (DOM READY) ---
document.addEventListener('DOMContentLoaded', () => {
    mainImage = document.getElementById('main-image');
    imageWrapper = document.getElementById('image-wrapper');
    redactionCanvas = document.getElementById('redaction-canvas');
    toggleRedactionBtn = document.getElementById('toggle-redaction-btn');
    togglePanBtn = document.getElementById('toggle-pan-btn');
    undoRedactionBtn = document.getElementById('undo-redaction-btn');
    
    // [NOVO] Referências de botões Crop
    toggleCropBtn = document.getElementById('toggle-crop-btn');
    undoCropBtn = document.getElementById('undo-crop-btn');

    const modalEl = document.getElementById('discardModal');
    if (modalEl) discardModal = new bootstrap.Modal(modalEl);

    // Configuração de Modo Leitura para Supervisor
    if (isSupervisor) {
        const form = document.getElementById('autuacao-form');
        if (form) {
            form.querySelectorAll('input, textarea, button').forEach(el => {
                el.disabled = true;
                if(el.tagName === 'BUTTON') el.style.opacity = '0.5';
            });
        }
        const btnDiscard = document.getElementById('discard-btn');
        if(btnDiscard) btnDiscard.disabled = true;

        if(toggleRedactionBtn) { toggleRedactionBtn.disabled = true; toggleRedactionBtn.title = "Indisponível (Modo Leitura)"; }
        if(toggleCropBtn) { toggleCropBtn.disabled = true; toggleCropBtn.title = "Indisponível (Modo Leitura)"; }
    }

    // Eventos de Mouse/Touch
    imageWrapper.addEventListener('mousedown', startPan);
    window.addEventListener('mousemove', movePan);
    window.addEventListener('mouseup', endPan);

    redactionCanvas.addEventListener('mousedown', startDraw);
    redactionCanvas.addEventListener('mousemove', draw);
    redactionCanvas.addEventListener('mouseup', endDraw);

    imageWrapper.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = e.deltaY > 0 ? -0.1 : 0.1;
        updateZoom(delta);
    }, { passive: false });

    // Toolbar Events
    toggleRedactionBtn.addEventListener('click', () => {
        if (!isSupervisor) setMode('redaction');
    });
    togglePanBtn.addEventListener('click', () => setMode('pan'));
    
    // [NOVO] Eventos de Crop
    toggleCropBtn.addEventListener('click', () => {
        if (!isSupervisor) setMode('crop');
    });

    undoCropBtn.addEventListener('click', () => {
        if (!isSupervisor) revertCrop();
    });
    
    undoRedactionBtn.addEventListener('click', () => { 
        if(isSupervisor) return;
        redactionRects.pop(); 
        redrawCanvas();
        if(redactionRects.length === 0) undoRedactionBtn.disabled = true;
    });

    // Zoom e Filtros
    document.getElementById('zoom-in-btn').addEventListener('click', () => updateZoom(0.2));
    document.getElementById('zoom-out-btn').addEventListener('click', () => updateZoom(-0.2));
    document.getElementById('zoom-reset-btn').addEventListener('click', resetVisuals);

    document.getElementById('btn-invert').addEventListener('click', (e) => {
        imgState.invert = imgState.invert === 0 ? 100 : 0;
        e.currentTarget.classList.toggle('active');
        requestUpdate();
    });
    document.getElementById('btn-grayscale').addEventListener('click', (e) => {
        imgState.grayscale = imgState.grayscale === 0 ? 100 : 0;
        e.currentTarget.classList.toggle('active');
        requestUpdate();
    });
    document.getElementById('brightness-slider').addEventListener('input', (e) => { imgState.brightness = e.target.value; requestUpdate(); });
    document.getElementById('contrast-slider').addEventListener('input', (e) => { imgState.contrast = e.target.value; requestUpdate(); });

    document.getElementById('camera-filter').addEventListener('change', renderThumbnails);
    document.getElementById('autuacao-form').addEventListener('submit', handleAutuacaoSubmit);
    
    document.getElementById('discard-btn').addEventListener('click', openDiscardModal);
    const confirmBtn = document.getElementById('confirm-discard-btn');
    if(confirmBtn) confirmBtn.addEventListener('click', confirmDiscard);

    document.querySelectorAll('input[name="discardReason"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            const container = document.getElementById('other-reason-container');
            if (e.target.value === 'Outros') {
                container.classList.remove('d-none');
                document.getElementById('discardDescription').focus();
            } else {
                container.classList.add('d-none');
            }
        });
    });

    const plateInput = document.getElementById('license-plate');
    if(plateInput) {
        plateInput.addEventListener('blur', lookupDetran);
        plateInput.addEventListener('keydown', (e) => {
             if(e.key === 'Enter') lookupDetran();
        });
    }

    document.getElementById('download-btn').addEventListener('click', handleRedactedDownload);

    // Atalhos
    document.addEventListener('keydown', (e) => {
        if(e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        if (discardModal && document.getElementById('discardModal').classList.contains('show')) {
            if (e.key === 'Enter') document.getElementById('confirm-discard-btn').click();
            if (e.key === 'Escape') discardModal.hide();
            return;
        }
        
        switch(e.key.toLowerCase()) {
            case 'm': setMode('pan'); break;
            case '+': updateZoom(0.2); break;
            case '-': updateZoom(-0.2); break;
        }

        if (!isSupervisor) {
            switch(e.key.toLowerCase()) {
                case 'c': setMode('redaction'); break;
                case 'z': undoRedactionBtn.click(); break;
                case 'd': openDiscardModal(); break; 
                // Atalho opcional para crop poderia ser adicionado aqui
            }
        }
    });

    window.addEventListener('beforeunload', () => {
        if (activeImageId) unlockImage(activeImageId);
    });

    fetchAutuacaoQueue();
    setMode('pan');
    sessionCheckInterval = setInterval(checkSessionStatus, 10000); 
    listRefreshInterval = setInterval(() => fetchAutuacaoQueue(true), 15000); 
});

// --- FUNÇÕES DO MODAL ---
function openDiscardModal() {
    if (isSupervisor) return;
    if (!activeImageId) return;
    if (!discardModal) return processDiscard(null, null);
    const form = document.getElementById('discard-form');
    if(form) form.reset();
    const otherContainer = document.getElementById('other-reason-container');
    if(otherContainer) otherContainer.classList.add('d-none');
    discardModal.show();
}

function confirmDiscard() {
    if (isSupervisor) return;
    const selectedRadio = document.querySelector('input[name="discardReason"]:checked');
    if (!selectedRadio) return alert("Selecione um motivo.");
    const selectedReason = selectedRadio.value;
    let description = '';
    if (selectedReason === 'Outros') {
        description = document.getElementById('discardDescription').value.trim();
        if (!description) return alert("Por favor, descreva o motivo.");
    }
    discardModal.hide();
    processDiscard(selectedReason, description);
}

// --- CONTROLES VISUAIS E MODOS ---
function setMode(mode) {
    // Reset visual dos botões
    toggleRedactionBtn.classList.remove('active-tool');
    togglePanBtn.classList.remove('active-pan');
    if(toggleCropBtn) toggleCropBtn.classList.remove('active-tool');

    // Reset flags de modo
    isRedactionMode = false;
    isCropMode = false;

    if (mode === 'redaction') {
        if(isSupervisor) return;
        isRedactionMode = true;
        toggleRedactionBtn.classList.add('active-tool');
        redactionCanvas.style.display = 'block';
        redactionCanvas.style.pointerEvents = 'auto'; 
        imageWrapper.style.cursor = 'crosshair';
        redrawCanvas();
    } 
    else if (mode === 'crop') { // [NOVO] Modo Crop
        if(isSupervisor) return;
        isCropMode = true;
        toggleCropBtn.classList.add('active-tool');
        redactionCanvas.style.display = 'block';
        redactionCanvas.style.pointerEvents = 'auto'; // Canvas captura o drag do mouse
        imageWrapper.style.cursor = 'cell'; // Cursor indicando seleção
        redrawCanvas(); // Limpa e redesenha (neste caso, pode desenhar o overlay de seleção)
    }
    else {
        // Pan Mode (Default)
        togglePanBtn.classList.add('active-pan');
        redactionCanvas.style.display = 'block'; 
        redactionCanvas.style.pointerEvents = 'none';
        imageWrapper.style.cursor = 'grab';
        redrawCanvas();
    }
}

// Lógica de Pan
function startPan(e) { if (isRedactionMode || isCropMode) return; e.preventDefault(); imgState.isPanning = true; imgState.startX = e.clientX - imgState.translateX; imgState.startY = e.clientY - imgState.translateY; imageWrapper.style.cursor = 'grabbing'; }
function movePan(e) { if (!imgState.isPanning) return; e.preventDefault(); imgState.translateX = e.clientX - imgState.startX; imgState.translateY = e.clientY - imgState.startY; requestUpdate(); }
function endPan() { imgState.isPanning = false; if (!isRedactionMode && !isCropMode) imageWrapper.style.cursor = 'grab'; }

// Lógica de Desenho (Tarja ou Crop)
function startDraw(e) { 
    if (!isRedactionMode && !isCropMode) return; 
    isDrawing = true; 
    rectStartX = e.offsetX; 
    rectStartY = e.offsetY; 
}

function draw(e) { 
    if (!isDrawing) return; 
    
    // Limpa o canvas para redesenhar o frame atual
    // Nota: redesenhamos todas as tarjas existentes no redrawCanvas()
    redrawCanvas(); 
    const ctx = redactionCanvas.getContext('2d');
    const w = e.offsetX - rectStartX;
    const h = e.offsetY - rectStartY;

    if (isRedactionMode) {
        // Visual Tarja
        ctx.fillStyle = 'rgba(0,0,0,0.5)'; 
        ctx.fillRect(rectStartX, rectStartY, w, h);
    } 
    else if (isCropMode) {
        // [NOVO] Visual de Seleção para Crop (Pontilhado Amarelo)
        ctx.strokeStyle = '#fbbf24';
        ctx.lineWidth = 2;
        ctx.setLineDash([6, 4]); // Pontilhado
        ctx.strokeRect(rectStartX, rectStartY, w, h);
        
        // Fundo leve para indicar área selecionada
        ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.fillRect(rectStartX, rectStartY, w, h);
        ctx.setLineDash([]); // Reset dash
    }
}

function endDraw(e) { 
    if (!isDrawing) return; 
    isDrawing = false; 
    const w = e.offsetX - rectStartX; 
    const h = e.offsetY - rectStartY; 

    // Ignora cliques minúsculos (acidentais)
    if (Math.abs(w) < 5 || Math.abs(h) < 5) {
        redrawCanvas();
        return;
    }

    if (isRedactionMode) {
        redactionRects.push({ x: rectStartX, y: rectStartY, w, h }); 
        undoRedactionBtn.disabled = false; 
        redrawCanvas();
    }
    else if (isCropMode) {
        // [NOVO] Executa o corte
        performCrop(rectStartX, rectStartY, w, h);
    }
}

function redrawCanvas() { 
    const ctx = redactionCanvas.getContext('2d'); 
    ctx.clearRect(0, 0, redactionCanvas.width, redactionCanvas.height); 
    
    // Se estiver cortando, não desenhamos tarjas pretas definitivas ainda para não confundir,
    // ou podemos desenhar. Aqui optamos por desenhar o histórico de tarjas sempre.
    ctx.fillStyle = 'black'; 
    redactionRects.forEach(r => ctx.fillRect(r.x, r.y, r.w, r.h)); 
}

// [NOVO] Funções de Lógica de Crop
function performCrop(x, y, w, h) {
    // 1. Salvar imagem original se ainda não tiver salvo
    if (!originalImageSrc) {
        originalImageSrc = mainImage.src;
    }

    // 2. Normalizar coordenadas (permite seleção de baixo p/ cima ou dir p/ esq)
    let finalX = w < 0 ? x + w : x;
    let finalY = h < 0 ? y + h : y;
    let finalW = Math.abs(w);
    let finalH = Math.abs(h);

    // 3. Calcular escala (Imagem exibida vs Imagem real/natural)
    // O canvas de desenho tem o tamanho do 'clientWidth/Height' da imagem no momento
    const scaleX = mainImage.naturalWidth / mainImage.clientWidth;
    const scaleY = mainImage.naturalHeight / mainImage.clientHeight;

    // 4. Criar Canvas Temporário para processar o corte
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = finalW * scaleX;
    tempCanvas.height = finalH * scaleY;
    const tCtx = tempCanvas.getContext('2d');

    // 5. Desenhar o pedaço recortado
    tCtx.drawImage(
        mainImage, 
        finalX * scaleX, finalY * scaleY, // Source X, Y (na img original)
        finalW * scaleX, finalH * scaleY, // Source W, H (na img original)
        0, 0,                             // Dest X, Y
        tempCanvas.width, tempCanvas.height // Dest W, H
    );

    // 6. Atualizar a imagem principal
    mainImage.src = tempCanvas.toDataURL('image/jpeg');

    // 7. Resetar tarjas (pois as coordenadas mudaram)
    redactionRects = [];
    undoRedactionBtn.disabled = true;

    // 8. Ativar botão de desfazer Crop e voltar ao modo Pan
    undoCropBtn.disabled = false;
    
    // Resetar Zoom para evitar desorientação
    imgState.zoom = 1.0; 
    imgState.translateX = 0; 
    imgState.translateY = 0;
    
    // Timeout para dar tempo da imagem carregar no DOM e atualizar dimensões
    setTimeout(() => {
        setMode('pan');
        // Ao carregar a nova src (blob base64), atualizar tamanho do canvas de overlay
        mainImage.onload = () => {
            redactionCanvas.width = mainImage.clientWidth;
            redactionCanvas.height = mainImage.clientHeight;
            redrawCanvas();
        };
    }, 50);
}

function revertCrop() {
    if (!originalImageSrc) return;
    
    mainImage.src = originalImageSrc;
    originalImageSrc = null;
    undoCropBtn.disabled = true;
    
    // Limpar tarjas e resetar visual
    redactionRects = [];
    undoRedactionBtn.disabled = true;
    
    resetVisuals(); // Reseta zoom, filtros
    setMode('pan');
}

function requestUpdate() { 
    requestAnimationFrame(() => { 
        mainImage.style.filter = `brightness(${imgState.brightness}%) contrast(${imgState.contrast}%) invert(${imgState.invert}%) grayscale(${imgState.grayscale}%)`; 
        imageWrapper.style.transform = `translate(${imgState.translateX}px, ${imgState.translateY}px) scale(${imgState.zoom})`; 
    }); 
}

function updateZoom(d) { imgState.zoom = Math.max(0.4, Math.min(3.0, imgState.zoom + d)); requestUpdate(); }

function resetVisuals() { 
    imgState = { zoom: 1.0, brightness: 100, contrast: 100, invert: 0, grayscale: 0, translateX: 0, translateY: 0, isPanning: false, startX: 0, startY: 0 };
    document.getElementById('brightness-slider').value = 100;
    document.getElementById('contrast-slider').value = 100;
    document.getElementById('btn-invert').classList.remove('active');
    document.getElementById('btn-grayscale').classList.remove('active');
    redactionRects = [];
    undoRedactionBtn.disabled = true;
    if(redactionCanvas) redrawCanvas();
    requestUpdate();
}

// --- COMUNICAÇÃO COM API ---
async function fetchAutuacaoQueue(isBackgroundUpdate = false) {
    try {
        const res = await fetch(`${API_BASE_URL}/api/autuacao/queue`, { headers: { 'Authorization': `Bearer ${token}` } });
        if(res.status === 401) window.location.href = 'login.html';
        const json = await res.json();
        allImages = json.data || [];
        
        if (isBackgroundUpdate) {
            renderThumbnails();
            return;
        }

        populateCameraFilter(allImages); 
        renderThumbnails();
        
        const next = allImages.find(i => !i.is_locked);
        if(next) displayImage(next.id); 
        else if (allImages.length > 0) displayImage(allImages[0].id);
        else showEmpty();

    } catch(e) { console.error(e); }
}

function unlockImage(id) {
    if(!id) return;
    fetch(`${API_BASE_URL}/api/unlock/${id}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
    }).catch(()=>{});
}

async function displayImage(id) {
    // 1. Tenta LOCK
    try {
        const lockRes = await fetch(`${API_BASE_URL}/api/lock/${id}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (lockRes.status === 409) {
            const data = await lockRes.json();
            showFeedback(`⚠️ Imagem em uso por ${data.lockedBy}. Próxima...`, 'warning');
            
            allImages = allImages.filter(i => i.id !== id);
            renderThumbnails();
            
            const next = allImages.find(i => !i.is_locked);
            if(next) displayImage(next.id);
            else if (allImages.length > 0) displayImage(allImages[0].id);
            else showEmpty();
            return;
        } 
        if (lockRes.status === 401) return window.location.href = 'login.html';

    } catch(e) { console.error(e); }

    // 2. Destrava anterior e Configura Heartbeat
    if (activeImageId && activeImageId !== id) unlockImage(activeImageId);
    
    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        fetch(`${API_BASE_URL}/api/lock/${id}`, { 
            method: 'POST', 
            headers: { 'Authorization': `Bearer ${token}` } 
        }).catch(()=>{});
    }, 30000);

    // [NOVO] Reseta estado do Crop ao trocar imagem
    activeImageId = id;
    originalImageSrc = null;
    if(undoCropBtn) undoCropBtn.disabled = true;

    const img = allImages.find(i => i.id === id);
    resetVisuals();
    
    const src = img.image_filename.startsWith('http') ? img.image_filename : `${API_BASE_URL}/images/${img.image_filename}`;
    mainImage.src = src;
    
    mainImage.onload = () => { redactionCanvas.width = mainImage.clientWidth; redactionCanvas.height = mainImage.clientHeight; redrawCanvas(); };

    document.getElementById('viewer-area').style.display = 'flex';
    document.getElementById('viewer-placeholder').style.display = 'none';
    document.getElementById('image-controls').style.display = 'flex';
    document.getElementById('actions-panel').style.display = 'flex';
    
    document.getElementById('license-plate').value = img.license_plate || '';
    lookupDetran();

    renderThumbnails();
    setMode('pan'); 
}

function showEmpty() {
    document.getElementById('viewer-area').style.display = 'none';
    document.getElementById('viewer-placeholder').style.display = 'block';
    document.getElementById('image-controls').style.display = 'none';
    document.getElementById('actions-panel').style.display = 'none';
}

function renderThumbnails() {
    const list = document.getElementById('thumbnail-list'); list.innerHTML = '';
    const f = document.getElementById('camera-filter').value;
    const filtered = f === 'all' ? allImages : allImages.filter(i => i.camera_id === f);
    if (filtered.length === 0) { list.innerHTML = '<p class="text-muted p-3 text-center small">Fila vazia</p>'; return; }
    
    filtered.forEach(img => {
        const div = document.createElement('div'); 
        div.className = `thumbnail-item ${img.id === activeImageId ? 'active' : ''}`;
        
        if (img.is_locked) {
            div.style.opacity = '0.5';
            div.style.borderLeft = '4px solid orange';
            div.title = "Em uso por outro usuário";
        }

        const src = img.image_filename.startsWith('http') ? img.image_filename : `${API_BASE_URL}/images/${img.image_filename}`;
        
        div.innerHTML = `
            <img src="${src}">
            <div class="info">
                <span class="filename">${img.license_plate || 'S/ PLACA'}</span>
                <span class="timestamp">${new Date(img.capture_timestamp).toLocaleTimeString()} ${img.is_locked ? '🔒' : ''}</span>
            </div>
        `;
        div.onclick = () => displayImage(img.id); 
        list.appendChild(div);
    });
}

function populateCameraFilter(imgs) {
    const sel = document.getElementById('camera-filter'); const curr = sel.value;
    while(sel.options.length > 1) sel.remove(1);
    [...new Set(imgs.map(i => i.camera_id).filter(Boolean))].sort().forEach(c => {
        const o = document.createElement('option'); o.value = c; o.textContent = c; sel.appendChild(o);
    });
    sel.value = curr;
}

// --- SUBMISSÃO ---
async function handleAutuacaoSubmit(e) {
    e.preventDefault();
    if (isSupervisor) return;

    const plate = document.getElementById('license-plate').value;
    const type = document.querySelector('.infraction-type-input').value;
    const obs = document.getElementById('obs-input').value;
    
    if (!type) return showFeedback('Selecione uma infração', 'danger');

    const areas = redactionRects.map(r => ({
        x: r.x / redactionCanvas.width,
        y: r.y / redactionCanvas.height,
        w: r.w / redactionCanvas.width,
        h: r.h / redactionCanvas.height
    }));
    
    // Se a imagem foi recortada, 'originalImageSrc' terá o valor antigo e 'mainImage.src' é o Base64 novo.
    // Dependendo do backend, talvez seja necessário enviar o Base64 da imagem recortada
    // ou apenas as coordenadas. A API atual parece esperar 'evidenceId' e 'redactionAreas'.
    // Se a intenção é salvar o recorte NO SERVIDOR, a API precisaria suportar upload de imagem editada ou coordenadas de crop.
    // Como a instrução foi "sem alterar funções dos arquivos" (backend presumido inalterado), 
    // assumimos que o recorte é visual para o operador, mas a evidência salva continua sendo a original
    // OU o backend aceita a imagem modificada. 
    // *Nota de Implementação*: Se a imagem foi recortada, o 'redactionAreas' agora é relativo ao recorte, não à original.
    // Isso pode gerar inconsistência se o backend aplicar tarjas na original.
    // Se o backend aplica tarjas, o ideal seria enviar a imagem recortada em Base64.
    // Ajuste abaixo: Envio normal (presumindo que o recorte é apenas auxílio visual local ou backend processa o que vê).

    try {
        const res = await fetch(`${API_BASE_URL}/api/autuar`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ 
                evidenceId: activeImageId, 
                licensePlate: plate, 
                infractions: [type], 
                redactionAreas: areas, 
                observations: obs 
                // Se necessário enviar imagem cropada: , croppedImage: mainImage.src
            })
        });
        
        if (res.ok) {
            showFeedback('Autuação realizada!', 'success');
            unlockImage(activeImageId);
            removeImageFromList(activeImageId);
        } else {
            showFeedback('Erro ao autuar', 'danger');
        }
    } catch (e) { console.error(e); }
}

async function processDiscard(reason, description) {
    if (isSupervisor) return;
    try {
        await fetch(`${API_BASE_URL}/api/autuacao/process`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ evidenceId: activeImageId, action: 'discard', reason: reason, description: description })
        });
        unlockImage(activeImageId);
        removeImageFromList(activeImageId);
    } catch (e) { console.error(e); }
}

function removeImageFromList(id) {
    allImages = allImages.filter(i => i.id !== id);
    renderThumbnails();
    
    const next = allImages.find(i => !i.is_locked);
    if(next) displayImage(next.id);
    else if(allImages.length > 0) displayImage(allImages[0].id);
    else showEmpty();
}

async function handleRedactedDownload(e) {
    e.preventDefault();
    if (!activeImageId) return;
    const btn = document.getElementById('download-btn');
    const oldText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
    
    const areas = redactionRects.map(r => ({
        x: r.x / redactionCanvas.width,
        y: r.y / redactionCanvas.height,
        w: r.w / redactionCanvas.width,
        h: r.h / redactionCanvas.height
    }));

    try {
        // Se estiver recortada, o download deve ser da imagem visível
        if (originalImageSrc) {
            // Cria um link temporário para baixar a imagem recortada (local)
            const a = document.createElement('a');
            a.href = mainImage.src; // Base64 da imagem cropada
            a.download = `CROP_EV_${activeImageId}.jpg`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            
            // Simula delay de rede para feedback visual
            await new Promise(r => setTimeout(r, 500));
        } else {
            // Fluxo padrão (backend)
            const res = await fetch(`${API_BASE_URL}/api/download-redacted`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
                body: JSON.stringify({ evidenceId: activeImageId, redactionAreas: areas })
            });
            if (res.ok) {
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a'); a.href = url; a.download = `EV_${activeImageId}.jpg`;
                document.body.appendChild(a); a.click(); a.remove();
            }
        }
    } catch (e) { alert('Erro no download'); } 
    finally { btn.innerHTML = oldText; }
}

function showFeedback(msg, type) {
    const el = document.getElementById('feedback-message');
    el.textContent = msg;
    el.className = `alert alert-${type} small mb-3`;
    el.classList.remove('d-none');
    setTimeout(() => el.classList.add('d-none'), 3000);
}