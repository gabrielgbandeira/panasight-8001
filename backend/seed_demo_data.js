const pool = require('./database');

async function seedPanaSight() {
    console.log('🚗 Iniciando povoamento de dados demonstrativos para o PanaSight...');
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        console.log('🧹 Limpando evidências, infrações e dados DETRAN antigos...');
        await client.query('DELETE FROM autuadas_infractions');
        await client.query('DELETE FROM evidences');
        await client.query('DELETE FROM detran_alertas');
        await client.query('DELETE FROM detran_frota');
        await client.query('DELETE FROM detran_modelos');
        await client.query('DELETE FROM audit_logs');

        // 1. DETRAN Modelos
        console.log('📋 Inserindo catálogo de modelos DETRAN...');
        await client.query(`
            INSERT INTO detran_modelos (codigo, descricao) VALUES
            (101, 'TOYOTA COROLLA XEI 2.0'),
            (102, 'HONDA CIVIC TOURING 1.5'),
            (103, 'JEEP COMPASS LIMITED 1.3'),
            (104, 'VOLKSWAGEN POLO TSI 1.0'),
            (105, 'HYUNDAI HB20 EVOLUTION 1.0'),
            (106, 'CHEVROLET ONIX TURBO 1.0'),
            (107, 'FIAT STRADA VOLCANO 1.3'),
            (108, 'RENAULT DUSTER INTENSE 1.6')
            ON CONFLICT (codigo) DO NOTHING;
        `);

        // 2. DETRAN Frota e Alertas
        console.log('🚘 Inserindo veículos na Frota DETRAN...');
        const veículos = [
            { placa: 'MXT-2938', modelo: 101, cor: 1, fab: 2022, mod: 2023, alerta: 0 },
            { placa: 'OLH-8902', modelo: 102, cor: 2, fab: 2021, mod: 2021, alerta: 0 },
            { placa: 'QKG-4012', modelo: 103, cor: 3, fab: 2023, mod: 2024, alerta: 2 }, // Alerta de Restrição/Roubo
            { placa: 'RTA-5590', modelo: 104, cor: 1, fab: 2024, mod: 2024, alerta: 0 },
            { placa: 'NKG-1123', modelo: 105, cor: 4, fab: 2020, mod: 2020, alerta: 0 },
            { placa: 'HPB-7834', modelo: 106, cor: 2, fab: 2022, mod: 2022, alerta: 0 },
            { placa: 'MVW-9918', modelo: 107, cor: 1, fab: 2023, mod: 2023, alerta: 0 },
            { placa: 'KZZ-3341', modelo: 108, cor: 3, fab: 2021, mod: 2022, alerta: 0 }
        ];

        for (const v of veículos) {
            await client.query(`
                INSERT INTO detran_frota (placa, modelo_cod, cor_cod, ano_fab, ano_mod, municipio_cod)
                VALUES ($1, $2, $3, $4, $5, 172100)
                ON CONFLICT (placa) DO NOTHING;
            `, [v.placa, v.modelo, v.cor, v.fab, v.mod]);

            if (v.alerta > 0) {
                await client.query(`
                    INSERT INTO detran_alertas (placa, codigo_situacao)
                    VALUES ($1, $2)
                    ON CONFLICT (placa) DO NOTHING;
                `, [v.placa, v.alerta]);
            }
        }

        // 3. Inserindo Evidências com imagens de alta qualidade
        console.log('📸 Inserindo evidências fotográficas de trânsito...');

        const demoEvidences = [
            {
                filename: 'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?q=80&w=1000',
                plate: 'MXT-2938',
                status: 'Pendente',
                camera: 'CAM-JK-01',
                time: '2026-08-01 14:15:22',
                reason: null
            },
            {
                filename: 'https://images.unsplash.com/photo-1502877338535-766e1452684a?q=80&w=1000',
                plate: 'OLH-8902',
                status: 'Pendente',
                camera: 'CAM-TS-02',
                time: '2026-08-01 14:22:10',
                reason: null
            },
            {
                filename: 'https://images.unsplash.com/photo-1552519507-da3b142c6e3d?q=80&w=1000',
                plate: 'QKG-4012',
                status: 'Validada',
                camera: 'CAM-LO01-03',
                time: '2026-08-01 13:45:00',
                reason: null
            },
            {
                filename: 'https://images.unsplash.com/photo-1533473359331-0135ef1b58bf?q=80&w=1000',
                plate: 'RTA-5590',
                status: 'Autuada',
                camera: 'CAM-JK-02',
                time: '2026-08-01 12:30:15',
                reason: null
            },
            {
                filename: 'https://images.unsplash.com/photo-1541899481282-d53bffe3c35d?q=80&w=1000',
                plate: 'NKG-1123',
                status: 'Pendente',
                camera: 'CAM-TS-01',
                time: '2026-08-01 14:40:00',
                reason: null
            },
            {
                filename: 'https://images.unsplash.com/photo-1583121274602-3e2820c69888?q=80&w=1000',
                plate: 'HPB-7834',
                status: 'Autuada',
                camera: 'CAM-RADAR-04',
                time: '2026-08-01 11:10:05',
                reason: null
            },
            {
                filename: 'https://images.unsplash.com/photo-1494976388531-d1058494cdd8?q=80&w=1000',
                plate: 'MVW-9918',
                status: 'Descartada',
                camera: 'CAM-LO02-01',
                time: '2026-08-01 10:05:40',
                reason: 'Falso Positivo'
            },
            {
                filename: 'https://images.unsplash.com/photo-1511919884226-fd3cad34687c?q=80&w=1000',
                plate: 'KZZ-3341',
                status: 'Validada',
                camera: 'CAM-JK-03',
                time: '2026-08-01 14:02:18',
                reason: null
            }
        ];

        const adminUserRes = await client.query("SELECT id FROM users WHERE username = 'admin' LIMIT 1");
        const adminId = adminUserRes.rows[0] ? adminUserRes.rows[0].id : 1;

        for (const ev of demoEvidences) {
            const evIns = await client.query(`
                INSERT INTO evidences 
                (image_filename, original_filepath, capture_timestamp, license_plate, status, camera_id, processed_by_user_id, processed_at, rejection_reason)
                VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                RETURNING id
            `, [ev.filename, ev.filename, ev.time, ev.plate, ev.status, ev.camera, adminId, ev.time, ev.reason]);

            const evId = evIns.rows[0].id;

            if (ev.status === 'Autuada') {
                await client.query(`
                    INSERT INTO autuadas_infractions (evidence_id, autuado_por_user_id, license_plate, infraction_type, autuado_em)
                    VALUES ($1, $2, $3, 'Avanço de Sinal Vermelho', $4)
                `, [evId, adminId, ev.plate, ev.time]);
            }
        }

        // 4. Logs de Auditoria
        console.log('📝 Inserindo histórico de auditoria...');
        await client.query(`
            INSERT INTO audit_logs (user_id, username, action_type, target_table, target_id, details, ip_address) VALUES
            ($1, 'admin', 'LOGIN_REALIZADO', 'users', '1', '{"device_info": "Chrome on Windows 11"}'::jsonb, '127.0.0.1'),
            ($1, 'admin', 'PROCESSAR_EVIDENCIA', 'evidences', '4', '{"action": "valida", "status": "Autuada"}'::jsonb, '127.0.0.1'),
            ($1, 'admin', 'VISUALIZAR_LOGS_AUDITORIA', 'audit_logs', NULL, '{"filters": {}}'::jsonb, '127.0.0.1');
        `, [adminId]);

        await client.query('COMMIT');
        console.log('✨ PANASIGHT POVOADO COM SUCESSO! ✨');

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('❌ Erro ao povoar PanaSight:', err);
    } finally {
        client.release();
        process.exit(0);
    }
}

seedPanaSight();
