// /usr/src/app/images/processador.js (Versão Final: Blindada + Recursiva + Smart Naming)
const fs = require('fs');
const path = require('path');

const INBOX_DIR = path.join(__dirname, 'inbox');
const INTERVALO_CHECK = 5000;

console.log(`[WORKER XML] Iniciando monitoramento avançado na pasta: ${INBOX_DIR}`);

// Função recursiva para buscar arquivos em subpastas e evitar o erro ESPIPE
const buscarArquivosXML = (dir) => {
    let resultados = [];
    try {
        const itens = fs.readdirSync(dir, { withFileTypes: true });
        
        for (const item of itens) {
            const fullPath = path.join(dir, item.name);
            
            // Se for diretório (ex: ANTT-TESTE, PTZ_30), entra nele
            if (item.isDirectory()) {
                resultados = resultados.concat(buscarArquivosXML(fullPath));
            } 
            // Se for arquivo e terminar em xml/XML, adiciona na lista
            else if (item.isFile() && item.name.toLowerCase().endsWith('.xml')) {
                resultados.push(fullPath);
            }
        }
    } catch (err) {
        // Ignora silenciosamente se a pasta inbox não existir ainda no boot
        if (err.code !== 'ENOENT') {
            console.error(`[WORKER XML] Erro ao ler diretório ${dir}:`, err.message);
        }
    }
    return resultados;
};

const processarPasta = () => {
    const xmlFiles = buscarArquivosXML(INBOX_DIR);

    if (xmlFiles.length > 0) {
        xmlFiles.forEach(filePath => {
            const fileName = path.basename(filePath);
            const fileDir = path.dirname(filePath); // Identifica a subpasta (ex: PTZ_30)

            try {
                const xmlContent = fs.readFileSync(filePath, 'utf8');
                let extraiuAlguma = false;

                // Extrai a placa para compor o nome da imagem (facilita auditoria e file-system-worker)
                const placaMatch = xmlContent.match(/<NS7:PlacaVeiculo>(.*?)<\/NS7:PlacaVeiculo>/);
                const placa = placaMatch ? placaMatch[1].trim() : "INDEFINIDA";

                const extrair = (tagConteudo, sufixo) => {
                    const regexConteudo = new RegExp(`<${tagConteudo}.*?>(.*?)<\/${tagConteudo}>`);
                    const matchConteudo = xmlContent.match(regexConteudo);

                    if (matchConteudo && matchConteudo[1]) {
                        const base64Data = matchConteudo[1];
                        const timestamp = Date.now();
                        
                        // Novo padrão de nomeação: PLACA_XML_TIMESTAMP_TIPO.jpg
                        const nomeImagem = `${placa}_XML_${timestamp}_${sufixo}.jpg`;
                        
                        // Salva na mesma subpasta onde o XML foi encontrado
                        // Isso garante que o file-system-worker.js leia a pasta e defina o camera_id correto
                        const caminhoImagem = path.join(fileDir, nomeImagem);
                        
                        fs.writeFileSync(caminhoImagem, Buffer.from(base64Data, 'base64'));
                        console.log(`[WORKER XML] Imagem salva: ${path.join(path.basename(fileDir), nomeImagem)}`);
                        extraiuAlguma = true;
                    }
                };

                // Padrões de tags do sistema da ANTT
                extrair('NS4:ConteudoImagem1', 'PANORAMICA');
                extrair('NS5:ConteudoImagem2', 'PLACA');

                if (extraiuAlguma) {
                    fs.unlinkSync(filePath);
                    console.log(`[WORKER XML] Arquivo original deletado: ${fileName}`);
                }

            } catch (readErr) {
                console.error(`[WORKER XML] Falha ao processar o arquivo ${fileName}:`, readErr.message);
            }
        });
    }
};

setInterval(processarPasta, INTERVALO_CHECK);
processarPasta();