// frontend/app.js (VERSÃO FINAL COMPLETA - COM SUPORTE A SUPERVISOR READ-ONLY)

const token = localStorage.getItem('authToken');
const user = JSON.parse(localStorage.getItem('user'));
const API_BASE_URL = ''; 

// 1. VERIFICAÇÃO DE SEGURANÇA E PERMISSÕES
if (!token || !user) {
    window.location.href = 'login.html';
} else {
    // Guarda de Rota: Admin, Processamento ou Supervisor
    // [ATUALIZADO] Supervisor permitido, mas em modo leitura
    if (user.role !== 'admin' && user.role !== 'operador' && user.role !== 'supervisor') {
        alert('ACESSO NEGADO: Seu perfil não permite acessar o Painel de Processamento.');
        
        // [CORREÇÃO SOLICITADA] Redireciona para o Hub em vez de deslogar
        window.location.href = 'hub.html';
        
        throw new Error("Acesso não autorizado.");
    }
}

// --- VARIÁVEIS GLOBAIS ---
let allImages = [], activeImageId = null;
let heartbeatInterval = null; 
let sessionCheckInterval = null; 
let listRefreshInterval = null;  

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

let isRedactionMode = false, isDrawing = false, rectStartX, rectStartY, redactionRects = [];
let mainImage, mainVideo, imageContainer, redactionCanvas, toggleMediaBtn;
let isShowingVideo = false;
let discardModal; 

// [NOVO] Flag de Supervisor
const isSupervisor = (user && user.role === 'supervisor');

// Mapeamento de Cores para o DETRAN
const CORES = { 1:'AMARELA', 2:'AZUL', 3:'BEGE', 4:'BRANCA', 5:'CINZA', 6:'DOURADA', 7:'GRENA', 8:'LARANJA', 9:'MARROM', 10:'PRATA', 11:'PRETA', 12:'ROSA', 13:'ROXA', 14:'VERDE', 15:'VERMELHA' };

// --- VERIFICADOR DE SESSÃO ATIVA ---
async function checkSessionStatus() {
    try {
        const res = await fetch(`${API_BASE_URL}/api/users/me`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.status === 401 || res.status === 403) {
            clearInterval(sessionCheckInterval);
            alert("Sua sessão foi encerrada (Login detectado em outro local ou token expirado).");
            window.location.href = 'login.html';
        }
    } catch (e) { console.error("Erro ao verificar sessão", e); }
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
    mainVideo = document.getElementById('main-video');
    imageContainer = document.getElementById('image-container');
    redactionCanvas = document.getElementById('redaction-canvas');
    toggleMediaBtn = document.getElementById('toggle-media-btn');

    const modalEl = document.getElementById('discardModal');
    if (modalEl) discardModal = new bootstrap.Modal(modalEl);

    if (user && user.role === 'admin') document.querySelectorAll('.admin-only').forEach(el => el.classList.remove('d-none'));
    
    // [NOVO] Configuração de Modo Leitura para Supervisor
    if (isSupervisor) {
        // Oculta botões de ação
        const btnValidate = document.getElementById('validate-btn');
        const btnDiscard = document.getElementById('discard-btn');
        const btnSpecial = document.getElementById('special-vehicle-btn');
        
        if(btnValidate) {
            btnValidate.disabled = true;
            btnValidate.style.opacity = '0.5';
            btnValidate.innerHTML = '<i class="fas fa-lock me-2"></i> MODO LEITURA';
        }
        if(btnDiscard) btnDiscard.style.display = 'none';
        if(btnSpecial) btnSpecial.style.display = 'none';
        
        // Desabilita input de placa para evitar confusão (opcional)
        // document.getElementById('license-plate').disabled = true;
    }

    // Listeners
    document.getElementById('validate-btn').addEventListener('click', validateAction);
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

    document.getElementById('special-vehicle-btn').addEventListener('click', () => sendUpdate('sem_placa', 'ESPECIAL'));
    
    // Controles Visuais
    document.getElementById('zoom-in-btn').addEventListener('click', () => updateZoom(0.2));
    document.getElementById('zoom-out-btn').addEventListener('click', () => updateZoom(-0.2));
    document.getElementById('reset-view-btn').addEventListener('click', resetImageStyles);
    
    document.getElementById('btn-invert').addEventListener('click', () => { imgState.invert = imgState.invert===0?100:0; requestUpdate(); });
    document.getElementById('btn-grayscale').addEventListener('click', () => { imgState.grayscale = imgState.grayscale===0?100:0; requestUpdate(); });
    document.getElementById('brightness-slider').addEventListener('input', (e) => { imgState.brightness = e.target.value; requestUpdate(); });
    document.getElementById('contrast-slider').addEventListener('input', (e) => { imgState.contrast = e.target.value; requestUpdate(); });

    document.getElementById('toggle-redaction-btn').addEventListener('click', toggleRedactionMode);
    document.getElementById('undo-redaction-btn').addEventListener('click', () => { redactionRects.pop(); redrawCanvas(); });
    toggleMediaBtn.addEventListener('click', toggleMediaView);

    redactionCanvas.addEventListener('mousedown', startDraw);
    redactionCanvas.addEventListener('mousemove', draw);
    redactionCanvas.addEventListener('mouseup', endDraw);

    imageContainer.addEventListener('mousedown', (e) => {
        if(imgState.zoom > 1 && !isRedactionMode) { 
            e.preventDefault(); 
            imgState.isPanning=true; 
            imgState.startX=e.clientX-imgState.translateX; 
            imgState.startY=e.clientY-imgState.translateY; 
            imageContainer.style.cursor='grabbing'; 
        }
    });
    window.addEventListener('mouseup', () => { imgState.isPanning=false; if(!isRedactionMode) imageContainer.style.cursor='grab'; });
    window.addEventListener('mousemove', (e) => { 
        if(imgState.isPanning){ 
            e.preventDefault(); 
            imgState.translateX=e.clientX-imgState.startX; 
            imgState.translateY=e.clientY-imgState.startY; 
            requestUpdate(); 
        }
    });
    imageContainer.addEventListener('wheel', (e) => { 
        e.preventDefault(); 
        const delta = e.deltaY > 0 ? -0.1 : 0.1; 
        updateZoom(delta); 
    }, { passive: false });

    document.getElementById('camera-filter').addEventListener('change', renderThumbnails);
    document.addEventListener('keydown', handleKeyboardShortcuts);
    
    // Garante destravar ao fechar a janela
    window.addEventListener('beforeunload', () => {
        if (activeImageId) unlockImage(activeImageId);
    });

    // Inicia os verificadores
    fetchImages();
    sessionCheckInterval = setInterval(checkSessionStatus, 10000); 
    listRefreshInterval = setInterval(() => fetchImages(true), 15000); 
});

// --- FUNÇÕES DE AUDITORIA ---
function openDiscardModal() {
    if (isSupervisor) return; // Bloqueio Supervisor
    if (!activeImageId) return;
    if (!discardModal) { if(confirm("Modal não encontrado. Descartar?")) sendUpdate('invalida'); return; }
    
    const form = document.getElementById('discard-form');
    if(form) form.reset();
    const otherContainer = document.getElementById('other-reason-container');
    if(otherContainer) otherContainer.classList.add('d-none');
    
    discardModal.show();
}

function confirmDiscard() {
    if (isSupervisor) return; // Bloqueio Supervisor
    const selectedRadio = document.querySelector('input[name="discardReason"]:checked');
    if (!selectedRadio) return alert("Selecione um motivo.");
    
    const selectedReason = selectedRadio.value;
    let description = '';

    if (selectedReason === 'Outros') {
        description = document.getElementById('discardDescription').value.trim();
        if (!description) return alert("Por favor, descreva o motivo.");
    }

    discardModal.hide();
    sendUpdate('invalida', null, selectedReason, description);
}

// --- FUNÇÕES DE MÍDIA ---
function toggleMediaView() { isShowingVideo = !isShowingVideo; updateMediaVisibility(); }

function updateMediaVisibility() {
    if (isShowingVideo) {
        mainImage.style.display='none'; 
        mainVideo.style.display='block'; 
        mainVideo.play().catch(()=>{});
        toggleMediaBtn.innerHTML='<i class="fas fa-image me-1"></i> VER FOTO'; 
        toggleMediaBtn.classList.replace('btn-primary','btn-info');
        redactionCanvas.style.display='none'; 
        if(isRedactionMode) toggleRedactionMode();
    } else {
        mainVideo.pause(); 
        mainVideo.style.display='none'; 
        mainImage.style.display='block';
        toggleMediaBtn.innerHTML='<i class="fas fa-video me-1"></i> VER VÍDEO'; 
        toggleMediaBtn.classList.replace('btn-info','btn-primary');
        if(isRedactionMode) redactionCanvas.style.display='block';
    }
}

function toggleRedactionMode() {
    if(isShowingVideo){ alert("A tarja só funciona na FOTO."); return; }
    isRedactionMode=!isRedactionMode; 
    
    redactionCanvas.style.display=isRedactionMode?'block':'none'; 
    redactionCanvas.style.pointerEvents=isRedactionMode?'auto':'none';
    imageContainer.style.cursor=isRedactionMode?'crosshair':'grab';
    document.getElementById('toggle-redaction-btn').classList.toggle('btn-danger');
    
    if(isRedactionMode){ 
        redactionCanvas.width=mainImage.clientWidth; 
        redactionCanvas.height=mainImage.clientHeight; 
        redrawCanvas(); 
    }
}

// --- FUNÇÕES DE DESENHO ---
function startDraw(e){if(!isRedactionMode)return;isDrawing=true;const r=redactionCanvas.getBoundingClientRect();rectStartX=e.clientX-r.left;rectStartY=e.clientY-r.top;}
function draw(e){if(!isDrawing)return;redrawCanvas();const r=redactionCanvas.getBoundingClientRect();const ctx=redactionCanvas.getContext('2d');ctx.fillStyle='rgba(0,0,0,0.5)';ctx.fillRect(rectStartX,rectStartY,(e.clientX-r.left)-rectStartX,(e.clientY-r.top)-rectStartY);}
function endDraw(e){if(!isDrawing)return;isDrawing=false;const r=redactionCanvas.getBoundingClientRect();const w=(e.clientX-r.left)-rectStartX;const h=(e.clientY-r.top)-rectStartY;if(Math.abs(w)>5){redactionRects.push({x:rectStartX,y:rectStartY,w,h});document.getElementById('undo-redaction-btn').disabled=false;}redrawCanvas();}
function redrawCanvas(){const ctx=redactionCanvas.getContext('2d');ctx.clearRect(0,0,redactionCanvas.width,redactionCanvas.height);ctx.fillStyle='black';redactionRects.forEach(r=>ctx.fillRect(r.x,r.y,r.w,r.h));}

// --- HELPERS VISUAIS ---
function requestUpdate(){requestAnimationFrame(()=>{const f=`brightness(${imgState.brightness}%) contrast(${imgState.contrast}%) invert(${imgState.invert}%) grayscale(${imgState.grayscale}%)`;mainImage.style.filter=f;mainVideo.style.filter=f;imageContainer.style.transform=`translate(${imgState.translateX}px,${imgState.translateY}px) scale(${imgState.zoom})`;});}
function updateZoom(d){imgState.zoom=Math.max(1,Math.min(5,imgState.zoom+d));if(imgState.zoom===1){imgState.translateX=0;imgState.translateY=0;}requestUpdate();}
function resetImageStyles(){imgState={zoom:1,brightness:100,contrast:100,invert:0,grayscale:0,translateX:0,translateY:0};document.getElementById('brightness-slider').value=100;document.getElementById('contrast-slider').value=100;redactionRects=[];redrawCanvas();requestUpdate();}

// --- API E LÓGICA DE TRAVAMENTO (LOCKING) ---
async function fetchImages(isBackgroundUpdate = false) {
    try {
        const res = await fetch(`${API_BASE_URL}/api/evidences`,{headers:{'Authorization':`Bearer ${token}`}});
        if(res.status===401) return window.location.href='login.html';
        
        allImages = await res.json(); 
        
        if (isBackgroundUpdate) {
            renderThumbnails();
            return;
        }

        populateCameraFilter(allImages); 
        renderThumbnails();
        
        const next = allImages.find(i => !i.is_locked);
        
        if(next) {
            displayImage(next.id);
        } else if (allImages.length > 0) {
            displayImage(allImages[0].id);
        } else {
            showEmpty();
        }
    } catch(e){}
}

function populateCameraFilter(imgs){
    const sel=document.getElementById('camera-filter');
    const c=sel.value;
    while(sel.options.length>1)sel.remove(1);
    [...new Set(imgs.map(i=>i.camera_id).filter(Boolean))].sort().forEach(k=>{
        const o=document.createElement('option');o.value=k;o.textContent=k;sel.appendChild(o)
    });
    sel.value=c;
}

function renderThumbnails(){
    const list=document.getElementById('thumbnail-list'); list.innerHTML='';
    const f=document.getElementById('camera-filter').value;
    const filtered=f==='all'?allImages:allImages.filter(i=>i.camera_id===f);
    
    if(!filtered.length){
        list.innerHTML='<p class="text-muted text-center mt-3 small">Fila vazia</p>';
        return;
    }
    
    filtered.forEach(img=>{
        const hasVideo=!!img.video_filename;
        const d=document.createElement('div');
        d.className=`thumbnail-item d-flex align-items-center ${img.id===activeImageId?'active':''}`;
        
        if (img.is_locked) {
            d.style.opacity = '0.5';
            d.style.borderLeft = '4px solid orange';
            d.title = `Em uso por ${img.locked_by_username || 'outro usuário'}`;
        }

        const timeStr = new Date(img.capture_timestamp).toLocaleTimeString();
        
        d.innerHTML=`
            <img src="${API_BASE_URL}/images/${img.image_filename}" class="rounded border border-secondary" style="width:70px;height:45px;object-fit:cover;">
            <div class="info ms-2 d-flex flex-column" style="overflow:hidden;">
                <span class="filename fw-bold text-white small text-truncate" style="max-width:130px;">${img.camera_id||'CAM'}</span>
                <span class="timestamp text-muted" style="font-size:0.75rem;">${timeStr} ${img.is_locked ? '🔒' : ''}</span>
            </div>
            ${hasVideo ? `<div class="ms-auto me-1"><i class="fas fa-video text-info"></i></div>` : ''}
        `;
        d.onclick=()=>displayImage(img.id); 
        list.appendChild(d);
    });
}

function unlockImage(id) {
    if(!id) return;
    fetch(`${API_BASE_URL}/api/unlock/${id}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
    }).catch(()=>{});
}

async function displayImage(id){
    try {
        const lockRes = await fetch(`${API_BASE_URL}/api/lock/${id}`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}` }
        });

        if (lockRes.status === 409) {
            const data = await lockRes.json();
            
            const alertBox = document.createElement('div');
            alertBox.className = 'alert alert-warning position-fixed top-0 start-50 translate-middle-x mt-3 shadow-lg';
            alertBox.style.zIndex = '9999';
            alertBox.innerHTML = `⚠️ <strong>Atenção:</strong> Imagem em uso por <strong>${data.lockedBy}</strong>. Selecionando próxima...`;
            document.body.appendChild(alertBox);
            setTimeout(() => alertBox.remove(), 4000);

            allImages = allImages.filter(i => i.id !== id);
            renderThumbnails();
            
            if (allImages.length > 0) {
                const next = allImages.find(i => !i.is_locked);
                if(next) displayImage(next.id);
                else displayImage(allImages[0].id);
            } else {
                showEmpty();
            }
            return; 
        } else if (lockRes.status === 401) {
             window.location.href = 'login.html';
             return;
        }
    } catch (e) {
        console.error("Erro ao tentar lock:", e);
    }

    if (activeImageId && activeImageId !== id) {
        unlockImage(activeImageId);
    }

    if (heartbeatInterval) clearInterval(heartbeatInterval);
    heartbeatInterval = setInterval(() => {
        fetch(`${API_BASE_URL}/api/lock/${id}`, { 
            method: 'POST', 
            headers: { 'Authorization': `Bearer ${token}` } 
        }).catch(()=>{});
    }, 30000);

    activeImageId=id;
    const img=allImages.find(i=>i.id===id);
    resetImageStyles();
    
    mainImage.src=`${API_BASE_URL}/images/${img.image_filename}`; 
    mainImage.onload=()=>{
        redactionCanvas.width=mainImage.clientWidth;
        redactionCanvas.height=mainImage.clientHeight;
    };

    if(img.video_filename){
        mainVideo.src=`${API_BASE_URL}/images/${img.video_filename}`;
        toggleMediaBtn.style.display='inline-block';
    }else{
        mainVideo.src="";
        toggleMediaBtn.style.display='none';
    }
    
    isShowingVideo=false; 
    updateMediaVisibility();
    
    document.getElementById('image-toolbar').style.display='block'; 
    document.getElementById('placeholder-text').style.display='none';
    document.getElementById('license-plate').value=img.license_plate||''; 
    
    lookupDetran();
    renderThumbnails();
}

function showEmpty(){
    mainImage.style.display='none';
    mainVideo.style.display='none';
    document.getElementById('image-toolbar').style.display='none';
    document.getElementById('placeholder-text').style.display='block';
}

function validateAction(){
    if (isSupervisor) return; // Bloqueio Supervisor
    const p=document.getElementById('license-plate').value;
    if(!p||p.length<3) return alert('Placa inválida');
    sendUpdate('valida', p.toUpperCase());
}

async function sendUpdate(act, pl=null, reason=null, desc=null) {
    if (isSupervisor) return; // Bloqueio Supervisor
    if(!activeImageId) return;
    
    await fetch(`${API_BASE_URL}/api/evidences/${activeImageId}`, { 
        method:'PUT', 
        headers:{'Content-Type':'application/json','Authorization':`Bearer ${token}`}, 
        body:JSON.stringify({
            action: act, 
            plate: pl, 
            reason: reason, 
            description: desc 
        })
    });
    
    unlockImage(activeImageId);

    allImages=allImages.filter(i=>i.id!==activeImageId); 
    renderThumbnails();
    
    const f=document.getElementById('camera-filter').value; 
    const nextList=f==='all'?allImages:allImages.filter(i=>i.camera_id===f);
    
    const next = nextList.find(i => !i.is_locked);
    
    if(next) displayImage(next.id);
    else if(nextList.length) displayImage(nextList[0].id);
    else showEmpty();
}

function handleKeyboardShortcuts(e) { 
    if(document.activeElement.tagName==='INPUT' || document.activeElement.tagName==='TEXTAREA'){
        if(e.key==='Enter' && (!discardModal || !document.getElementById('discardModal').classList.contains('show'))) {
            validateAction();
        }
        return;
    } 
    
    const modalEl = document.getElementById('discardModal');
    if (modalEl && modalEl.classList.contains('show')) {
        if (e.key === 'Enter') document.getElementById('confirm-discard-btn').click();
        if (e.key === 'Escape') discardModal.hide();
        return;
    }

    switch(e.key.toLowerCase()){
        case 'v':validateAction();break;
        case 'd':openDiscardModal();break;
        case '+':updateZoom(0.2);break;
        case '-':updateZoom(-0.2);break;
        case 'i':document.getElementById('btn-invert').click();break;
        case ' ': 
            if(toggleMediaBtn.style.display !== 'none') {
                e.preventDefault();
                toggleMediaView();
            }
            break;
    } 
}