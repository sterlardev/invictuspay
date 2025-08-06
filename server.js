const express = require('express');
const cors = require('cors');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;

app.use(cors());
app.use(express.json());

const API_BASE_URL = 'https://api.invictuspay.com.br/api/public/v1/';
const ACCESS_TOKEN = 'chr7bhRa016mEocWGz9I2ef9AMzmwFVae7cI8eehZ3YlAePUIRI2iEH23ANi';

function logInfo(message, context = {}) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const logEntry = `[${timestamp}] INFO: ${message} | Context: ${JSON.stringify(context)}\n`;
    console.log(logEntry.trim());
    fs.appendFileSync(path.join(__dirname, '..', 'error_log.txt'), logEntry);
}

function logError(message, context = {}) {
    const timestamp = new Date().toISOString().replace('T', ' ').substring(0, 19);
    const logEntry = `[${timestamp}] ERROR: ${message} | Context: ${JSON.stringify(context)}\n`;
    console.error(logEntry.trim());
    fs.appendFileSync(path.join(__dirname, '..', 'error_log.txt'), logEntry);
}

app.get('/health', (req, res) => {
    res.json({
        status: 'OK',
        timestamp: new Date().toISOString(),
        service: 'InvictusPay PIX API Server',
        version: '1.0.0'
    });
});

app.post('/geradorinvictus', async (req, res) => {
    try {
        logInfo('Nova requisição de pagamento recebida', { body: req.body });
        
        const {
            amount,
            customer = {},
            cart = [],
            utm = {}
        } = req.body;

        // Extrair dados do customer ou usar valores padrão
        const {
            name = 'Cliente Manu Gourmet',
            email = 'cliente@manugourmet.com',
            document = '23167861894',
            phone = '11940028922'
        } = customer;

        const cleanCpf = document.replace(/[^0-9]/g, '');
        const cleanPhone = phone.replace(/[^0-9]/g, '');

        if (cleanCpf.length !== 11) {
            logError('CPF inválido fornecido', { cpf_length: cleanCpf.length, cpf: cleanCpf });
            return res.status(400).json({ success: false, error: 'CPF deve ter 11 dígitos' });
        }

        if (amount <= 0) {
            logError('Valor inválido fornecido', { amount });
            return res.status(400).json({ success: false, error: 'Valor deve ser maior que zero' });
        }

        logInfo('Nova transação iniciada', { email, amount });

        const payload = {
            amount: amount,
            offer_hash: '9cfdc',
            payment_method: 'pix',
            customer: {
                name: name,
                email: email,
                phone_number: '11940028922',
                document: '23167861894',
                street_name: 'Rua Exemplo',
                number: '123',
                complement: 'Ap 101',
                neighborhood: 'Centro',
                city: 'São Paulo',
                state: 'SP',
                zip_code: '01502000'
            },
            cart: cart.length > 0 ? cart.map((item, index) => ({
                product_hash: 'manuudoces',
                title: item.name || 'Produto',
                cover: null,
                price: item.unit_price || Math.round(amount / (cart.reduce((sum, i) => sum + (i.quantity || 1), 0))),
                quantity: item.quantity || 1,
                operation_type: 1,
                tangible: false,
                product_id: 6561,
                offer_id: 9535
            })) : [
                {
                    product_hash: 'manuudoces',
                    title: 'Produto Digital',
                    cover: null,
                    price: amount,
                    quantity: 1,
                    operation_type: 1,
                    tangible: false,
                    product_id: 6561,
                    offer_id: 9535
                }
            ],
            installments: 1,
            expire_in_days: 1,
            transaction_origin: 'api',
            tracking: {
                src: '',
                utm_source: utm.utm_source || '',
                utm_medium: utm.utm_medium || '',
                utm_campaign: utm.utm_campaign || '',
                utm_term: utm.utm_term || '',
                utm_content: utm.utm_content || ''
            }
        };

        try {
            const apiUrl = `${API_BASE_URL}transactions?api_token=${ACCESS_TOKEN}`;
            const response = await axios.post(apiUrl, payload, {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                timeout: 10000
            });

            const data = response.data;
            const transactionId = data.transaction;
            const transactionHash = data.hash;
            const qrCodeText = data.pix?.pix_qr_code;

            if (transactionId && transactionHash && qrCodeText) {
                logInfo('Transação criada com sucesso', { transaction_id: transactionId, hash: transactionHash });
                
                const responseData = {
                    success: true,
                    data: {
                        hash: transactionHash,
                        qr_code_url: `https://quickchart.io/qr?text=${encodeURIComponent(qrCodeText)}`,
                        pix_code: qrCodeText,
                        expire_at: new Date(Date.now() + 30 * 60 * 1000).toLocaleString('pt-BR'),
                        amount: amount,
                        status: 'pending'
                    }
                };
                
                logInfo('Resposta da API InvictusPay enviada para o frontend', responseData);
                return res.json(responseData);
            } else {
                logError('Resposta da API incompleta', { response: data });
                throw new Error('Resposta da API incompleta');
            }
        } catch (apiError) {
            logError('Erro ao chamar API', { 
                error: apiError.message, 
                url: `${API_BASE_URL}transactions`,
                status: apiError.response?.status,
                response_data: apiError.response?.data
            });
            
            return res.status(500).json({ 
                success: false, 
                error: 'Falha na comunicação com a API de pagamentos',
                details: apiError.response?.data?.message || apiError.message
            });
        }
    } catch (error) {
        logError('Erro interno do servidor', { error: error.message });
        res.status(500).json({ success: false, error: 'Erro interno do servidor' });
    }
});

app.post('/verificar_status', async (req, res) => {
    try {
        const { hash } = req.body;
        
        if (!hash) {
            return res.status(400).json({ success: false, error: 'Hash da transação é obrigatório' });
        }

        if (hash.startsWith('test_')) {
            return res.json({
                success: true,
                status: 'pending',
                message: 'Pagamento pendente (modo teste)'
            });
        }

        try {
            const apiUrl = `${API_BASE_URL}transactions/${hash}?api_token=${ACCESS_TOKEN}`;
            const response = await axios.get(apiUrl, {
                headers: {
                    'Accept': 'application/json'
                },
                timeout: 10000
            });

            const data = response.data;
            // Verificar payment_status primeiro, depois status como fallback
            const transactionStatus = data.payment_status || data.status || 'pending';
            
            logInfo('Status da transação verificado', { 
                hash, 
                status: transactionStatus, 
                full_response: data 
            });
            
            // Mapear diferentes status para 'paid' se necessário
            const normalizedStatus = ['paid', 'approved', 'completed', 'success'].includes(transactionStatus.toLowerCase()) 
                ? 'paid' 
                : transactionStatus;
            
            return res.json({
                success: true,
                status: normalizedStatus,
                message: data.message || 'Status verificado',
                original_status: transactionStatus
            });
        } catch (apiError) {
            logError('Erro ao verificar status na API', { 
                error: apiError.message, 
                hash,
                status_code: apiError.response?.status,
                response_data: apiError.response?.data
            });
            
            // Se for 404, a transação pode não existir ainda
            if (apiError.response?.status === 404) {
                return res.json({
                    success: true,
                    status: 'not_found',
                    message: 'Transação não encontrada na API'
                });
            }
            
            return res.json({
                success: true,
                status: 'pending',
                message: 'Não foi possível verificar o status no momento'
            });
        }
    } catch (error) {
        logError('Erro ao verificar status', { error: error.message });
        res.status(500).json({ success: false, error: 'Erro interno do servidor' });
    }
});

app.listen(PORT, () => {
    console.log(`Servidor Node.js rodando na porta ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/health`);
    logInfo('Servidor iniciado', { port: PORT });
});

process.on('uncaughtException', (error) => {
    logError('Erro não capturado', { error: error.message, stack: error.stack });
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    logError('Promise rejeitada não tratada', { reason, promise });
});