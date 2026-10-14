document.addEventListener('DOMContentLoaded', () => {
    const canvas = document.getElementById('reactive-background');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    let width, height;
    let particles = [];
    
    // Configurações de Grid para Monitoramento Panavideo
    const maxDist = 120; 
    const gridDensity = 40; 
    const OVERSCAN = 1.1; // 110% da tela para eliminar bordas mortas
    
    const mouse = { x: 0, y: 0 };
    const particleSize = 1.8; 
    const color = '#0ea5e9';

    function resizeCanvas() {
        // Captura o tamanho atual do viewport
        const viewWidth = window.innerWidth;
        const viewHeight = window.innerHeight;

        // Define a resolução interna do Canvas (Overscan)
        width = canvas.width = Math.floor(viewWidth * OVERSCAN);
        height = canvas.height = Math.floor(viewHeight * OVERSCAN);

        // Aplica o estilo para transbordar a tela e centralizar
        canvas.style.position = 'fixed';
        canvas.style.width = (viewWidth * OVERSCAN) + 'px';
        canvas.style.height = (viewHeight * OVERSCAN) + 'px';
        canvas.style.left = `-${(width - viewWidth) / 2}px`;
        canvas.style.top = `-${(height - viewHeight) / 2}px`;

        createParticles();
    }

    class Particle {
        constructor(x, y) {
            this.baseX = x;
            this.baseY = y;
            this.x = x;
            this.y = y;
            this.color = color;
            this.size = particleSize;
        }

        draw() {
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.closePath();
            ctx.fill();
        }

        update() {
            let dx = mouse.x - this.x;
            let dy = mouse.y - this.y;
            let distance = Math.sqrt(dx * dx + dy * dy);
            
            if (distance < maxDist) {
                let forceDirectionX = dx / distance;
                let forceDirectionY = dy / distance;
                let pushForce = (maxDist - distance) / maxDist;
                
                this.x -= pushForce * forceDirectionX * 3.5; 
                this.y -= pushForce * forceDirectionY * 3.5;
            }
            
            // Retorno suave à posição original do grid
            if (this.x !== this.baseX) {
                let dx_base = this.baseX - this.x;
                this.x += dx_base * 0.15; 
            }
            if (this.y !== this.baseY) {
                let dy_base = this.baseY - this.y;
                this.y += dy_base * 0.15; 
            }
        }
    }

    function createParticles() {
        particles = [];
        // Preenche toda a área expandida do canvas
        for (let y = 0; y < height; y += gridDensity) {
            for (let x = 0; x < width; x += gridDensity) {
                particles.push(new Particle(x, y));
            }
        }
    }

    function connectParticles() {
        for (let a = 0; a < particles.length; a++) {
            for (let b = a + 1; b < particles.length; b++) { 
                let dx = particles[a].x - particles[b].x;
                let dy = particles[a].y - particles[b].y;
                let distance = Math.sqrt(dx * dx + dy * dy);

                if (distance < maxDist) {
                    let opacityValue = 1 - (distance / maxDist);
                    
                    // Brilho extra perto do mouse
                    let mdx = particles[a].x - mouse.x;
                    let mdy = particles[a].y - mouse.y;
                    let mDist = Math.sqrt(mdx * mdx + mdy * mdy);
                    
                    if (mDist < maxDist) {
                        opacityValue = Math.min(1, opacityValue + (1 - (mDist / maxDist)) * 0.5);
                    }

                    ctx.strokeStyle = `rgba(14, 165, 233, ${opacityValue})`;
                    ctx.lineWidth = 1;
                    ctx.beginPath();
                    ctx.moveTo(particles[a].x, particles[a].y);
                    ctx.lineTo(particles[b].x, particles[b].y);
                    ctx.stroke();
                }
            }
        }
    }

    function animate() {
        ctx.clearRect(0, 0, width, height);
        connectParticles();
        particles.forEach(p => {
            p.update();
            p.draw();
        });
        requestAnimationFrame(animate);
    }

    // Gerenciamento de Eventos
    window.addEventListener('resize', () => {
        // Debounce simples para evitar sobrecarga no resize
        clearTimeout(window.resizeTimer);
        window.resizeTimer = setTimeout(resizeCanvas, 100);
    });
    
    window.addEventListener('mousemove', (e) => {
        const rect = canvas.getBoundingClientRect();
        mouse.x = e.clientX - rect.left;
        mouse.y = e.clientY - rect.top;
    });

    // Início do Sistema
    resizeCanvas();
    animate();
});