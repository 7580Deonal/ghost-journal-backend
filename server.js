const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const sharp = require('sharp');
const Anthropic = require('@anthropic-ai/sdk');
const fs = require('fs').promises;
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3001;

// RAILWAY FIX: Trust proxy for Railway's load balancer
app.set('trust proxy', true);

// Rate limiting configuration for Railway
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// CORS configuration for Railway
app.use(cors({
  origin: process.env.NODE_ENV === 'production'
    ? ['https://your-frontend-domain.vercel.app', 'https://*.railway.app']
    : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:3001', 'http://localhost:3002'],
  credentials: true
}));

// Security and parsing middleware
app.use(helmet());
app.use(limiter);
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY
});

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024 // 10MB
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'));
    }
  }
});

// Enhanced health check endpoint with proxy status
app.get('/api/health', (req, res) => {
  const healthInfo = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    proxy_trust: app.get('trust proxy'),
    client_ip: req.ip,
    forwarded_for: req.get('X-Forwarded-For') || 'none',
    anthropic_configured: !!process.env.ANTHROPIC_API_KEY
  };
  
  console.log('Health check - Proxy trust enabled:', app.get('trust proxy'));
  res.json(healthInfo);
});

// Upload and analyze trade screenshot
app.post('/api/upload-trade', upload.single('screenshot'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No screenshot uploaded' });
    }

    // Process image with sharp
    const processedImage = await sharp(req.file.buffer)
      .resize(1920, 1080, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();

    // Convert to base64 for Anthropic API
    const base64Image = processedImage.toString('base64');

    // Analyze with Claude
    const analysis = await anthropic.messages.create({
      model: 'claude-3-sonnet-20240229',
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/jpeg',
              data: base64Image
            }
          },
          {
            type: 'text',
            text: `Analyze this trading screenshot. Provide:

1. **Trade Details:**
   - Instrument/Symbol
   - Entry price
   - Exit price (if visible)
   - Position size
   - P&L amount
   - Trade direction (long/short)

2. **Execution Analysis:**
   - Entry timing quality (1-10 scale)
   - Risk management assessment
   - Position sizing appropriateness
   - Exit strategy execution

3. **Improvement Suggestions:**
   - What could be optimized
   - Risk management recommendations
   - Timing improvements

4. **Emotional State Indicators:**
   - Signs of FOMO, revenge trading, or discipline
   - Confidence level assessment

Format as structured JSON with clear categories.`
          }
        ]
      }]
    });

    const analysisText = analysis.content[0].text;
    
    // Generate trade ID and store (in production, use proper database)
    const tradeId = Date.now().toString();
    
    res.json({
      success: true,
      tradeId,
      analysis: analysisText,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Upload analysis error:', error);
    res.status(500).json({ 
      error: 'Failed to analyze screenshot',
      details: error.message 
    });
  }
});

// Get trade details
app.get('/api/trade/:id', async (req, res) => {
  try {
    const { id } = req.params;
    
    // In production, fetch from database
    // For now, return mock data
    res.json({
      tradeId: id,
      status: 'completed',
      analysis: 'Trade analysis would be stored here',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Get trade error:', error);
    res.status(500).json({ error: 'Failed to retrieve trade' });
  }
});

// Execute trade analysis
app.post('/api/trade/:id/execution', async (req, res) => {
  try {
    const { id } = req.params;
    const { executionData } = req.body;
    
    // Process execution analysis
    res.json({
      success: true,
      tradeId: id,
      executionAnalysis: 'Execution analysis completed',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Execution analysis error:', error);
    res.status(500).json({ error: 'Failed to analyze execution' });
  }
});

// Complete analysis endpoint
app.get('/api/trade/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    
    res.json({
      success: true,
      tradeId: id,
      completeAnalysis: 'Complete analysis data',
      recommendations: ['Improve entry timing', 'Better risk management'],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Complete analysis error:', error);
    res.status(500).json({ error: 'Failed to complete analysis' });
  }
});

// Progress tracking
app.get('/api/progress', async (req, res) => {
  try {
    res.json({
      totalTrades: 0,
      winRate: 0,
      averageReturn: 0,
      riskMetrics: {
        averageRisk: 0,
        maxDrawdown: 0
      },
      improvementAreas: []
    });
  } catch (error) {
    console.error('Progress error:', error);
    res.status(500).json({ error: 'Failed to get progress' });
  }
});

// Pattern analysis
app.get('/api/patterns', async (req, res) => {
  try {
    res.json({
      patterns: [],
      insights: 'Pattern analysis coming soon'
    });
  } catch (error) {
    console.error('Patterns error:', error);
    res.status(500).json({ error: 'Failed to get patterns' });
  }
});

// Execution patterns
app.get('/api/execution-patterns', async (req, res) => {
  try {
    res.json({
      executionPatterns: [],
      recommendations: 'Execution pattern analysis coming soon'
    });
  } catch (error) {
    console.error('Execution patterns error:', error);
    res.status(500).json({ error: 'Failed to get execution patterns' });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Error:', error);
  
  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'File too large. Maximum size is 10MB.' });
    }
  }
  
  res.status(500).json({ 
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? error.message : undefined
  });
});

// 404 handler with available endpoints
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint Not Found',
    message: 'Route / not found',
    availableEndpoints: {
      health: 'GET /api/health',
      upload: 'POST /api/upload-trade',
      execution: 'POST /api/trade/{id}/execution',
      complete_analysis: 'GET /api/trade/{id}/complete',
      trade_details: 'GET /api/trade/{id}',
      progress: 'GET /api/progress',
      patterns: 'GET /api/patterns',
      execution_patterns: 'GET /api/execution-patterns'
    }
  });
});

// Proxy logging for debugging
console.log('Proxy trust enabled at startup:', app.get('trust proxy'));

// Start server
app.listen(PORT, () => {
  console.log(`Ghost Journal backend running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Anthropic API configured: ${!!process.env.ANTHROPIC_API_KEY}`);
  console.log(`Trust proxy setting: ${app.get('trust proxy')}`);
});
