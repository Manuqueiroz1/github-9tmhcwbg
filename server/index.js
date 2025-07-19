import express from 'express';
import cors from 'cors';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';

dotenv.config();

// Tratamento de erros para exceções não capturadas
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

const app = express();
// CRÍTICO: Railway fornece porta via variável de ambiente
const PORT = process.env.PORT || 3001;

// CORS configurado para Railway - usa variável de ambiente para flexibilidade
app.use(cors({
  origin: [
    process.env.FRONTEND_URL, // URL do frontend no Railway (configure como variável)
    'http://localhost:5173',  // Para desenvolvimento local (Vite)
    'http://localhost:3000',  // Para desenvolvimento local (React)
    'http://localhost:4173'   // Para preview do Vite
  ],
  credentials: true
}));

app.use(express.json());

// Simulação de banco de dados em memória
const users = new Map();
const purchases = new Map();

// Health check endpoint - útil para Railway monitorar o serviço
app.get('/', (req, res) => {
  res.json({ 
    message: 'Backend funcionando no Railway!',
    timestamp: new Date().toISOString(),
    status: 'healthy'
  });
});

// Endpoint de health check específico
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Webhook da Hotmart
app.post('/webhook/hotmart', async (req, res) => {
  try {
    const { event, data } = req.body;
    
    if (event === 'PURCHASE_COMPLETE' || event === 'PURCHASE_APPROVED') {
      const { buyer, purchase } = data;
      
      purchases.set(buyer.email.toLowerCase(), {
        email: buyer.email.toLowerCase(),
        name: buyer.name,
        purchaseId: purchase.transaction,
        productId: purchase.product.id,
        status: 'active',
        purchaseDate: new Date(),
        hotmartData: data
      });
      
      console.log(`Purchase registered for: ${buyer.email}`);
    }
    
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Verificar se email tem compra válida
app.post('/api/auth/check-purchase', async (req, res) => {
  try {
    const { email } = req.body;
    
    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }
    
    const purchase = purchases.get(email.toLowerCase());
    
    if (!purchase) {
      return res.status(404).json({ 
        error: 'Nenhuma compra encontrada para este e-mail',
        hasPurchase: false 
      });
    }
    
    if (purchase.status !== 'active') {
      return res.status(403).json({ 
        error: 'Compra não está ativa',
        hasPurchase: false 
      });
    }
    
    res.json({
      hasPurchase: true,
      customerName: purchase.name,
      purchaseDate: purchase.purchaseDate
    });
    
  } catch (error) {
    console.error('Check purchase error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Criar senha para usuário novo
app.post('/api/auth/create-password', async (req, res) => {
  try {
    const { email, password, name } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    const purchase = purchases.get(email.toLowerCase());
    if (!purchase) {
      return res.status(404).json({ error: 'Nenhuma compra encontrada para este e-mail' });
    }
    
    if (users.has(email.toLowerCase())) {
      return res.status(409).json({ error: 'Usuário já possui senha cadastrada' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 12);
    
    users.set(email.toLowerCase(), {
      email: email.toLowerCase(),
      name: name || purchase.name,
      password: hashedPassword,
      createdAt: new Date(),
      hasCompletedOnboarding: false
    });
    
    const token = jwt.sign(
      { 
        email: email.toLowerCase(), 
        name: name || purchase.name 
      },
      process.env.JWT_SECRET || 'fallback_secret_change_in_production',
      { expiresIn: '7d' }
    );
    
    res.json({
      success: true,
      token,
      user: {
        email: email.toLowerCase(),
        name: name || purchase.name,
        hasCompletedOnboarding: false
      }
    });
    
  } catch (error) {
    console.error('Create password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Login com senha existente
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password are required' });
    }
    
    const user = users.get(email.toLowerCase());
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ error: 'Senha incorreta' });
    }
    
    const purchase = purchases.get(email.toLowerCase());
    if (!purchase || purchase.status !== 'active') {
      return res.status(403).json({ error: 'Acesso não autorizado' });
    }
    
    const token = jwt.sign(
      { 
        email: user.email, 
        name: user.name 
      },
      process.env.JWT_SECRET || 'fallback_secret_change_in_production',
      { expiresIn: '7d' }
    );
    
    res.json({
      success: true,
      token,
      user: {
        email: user.email,
        name: user.name,
        hasCompletedOnboarding: user.hasCompletedOnboarding
      }
    });
    
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Atualizar status de onboarding
app.post('/api/auth/complete-onboarding', async (req, res) => {
  try {
    const { email } = req.body;
    
    const user = users.get(email.toLowerCase());
    if (!user) {
      return res.status(404).json({ error: 'Usuário não encontrado' });
    }
    
    user.hasCompletedOnboarding = true;
    users.set(email.toLowerCase(), user);
    
    res.json({ success: true });
    
  } catch (error) {
    console.error('Complete onboarding error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Endpoint de teste para simular compra
app.post('/test/simulate-purchase', async (req, res) => {
  try {
    const { email, name } = req.body;
    
    purchases.set(email.toLowerCase(), {
      email: email.toLowerCase(),
      name: name || 'Usuário Teste',
      purchaseId: 'TEST_' + Date.now(),
      productId: 'teacher-poli-course',
      status: 'active',
      purchaseDate: new Date(),
      hotmartData: { test: true }
    });
    
    res.json({ success: true, message: 'Purchase simulated successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// CRÍTICO: '0.0.0.0' permite acesso externo no Railway
app.listen(PORT, '0.0.0.0', () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Ready to receive requests`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Webhook URL: http://0.0.0.0:${PORT}/webhook/hotmart`);
});
