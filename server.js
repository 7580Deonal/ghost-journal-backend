const express = require('express');
const cors = require('cors');
require('dotenv').config();

const { initializeDatabase } = require('./src/models/database');
const uploadRoute = require('./src/routes/upload');
const progressRoute = require('./src/routes/progress');
const patternsRoute = require('./src/routes/patterns');
const alertsRoute = require('./src/routes/alerts');

const app = express();
const PORT = process.env.PORT || 3002;

// Trust proxy for Railway
app.set('trust proxy', true);

// CORS configuration
app.use(cors({
  origin: function (origin, callback) {
    const allowedOrigins = [
      'https://76ed0371-d368-4787-bbbe-9b7497991383.lovableproject.com',
      'https://1d-preview-76ed0371-d368-4787-bbbe-9b7497991383.lovable.app',
      /^https:\/\/.*\.lovableproject\.com$/,
      /^https:\/\/.*\.lovable\.app$/,
      /^http:\/\/localhost:\d+$/,
    ];

    if (!origin) return callback(null, true);

    const isAllowed = allowedOrigins.some(allowedOrigin => {
      if (typeof allowedOrigin === 'string') {
        return origin === allowedOrigin;
      } else if (allowedOrigin instanceof RegExp) {
        return allowedOrigin.test(origin);
      }
      return false;
    });

    callback(null, isAllowed);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
}));

// Body parsing
app.use(express.json({ limit: '15mb' }));
app.use(express.urlencoded({ extended: true, limit: '15mb' }));

// Static files
app.use('/uploads', express.static('uploads'));

// EMERGENCY TRADES ENDPOINT
app.get('/api/trades', async (req, res) => {
  try {
    const { getDatabase } = require('./src/models/database');
    const db = getDatabase();

    const allTrades = db.prepare(`
      SELECT
        id as trade_id,
        pattern_type,
        setup_quality,
        risk_reward_ratio,
        entry_quality,
        target_selection as exit_quality,
        setup_quality as overall_grade,
        created_at,
        timestamp as updated_at
      FROM trades
      ORDER BY created_at DESC
    `).all();

    res.json({
      success: true,
      trades: allTrades.map(trade => ({
        trade_id: trade.trade_id,
        pattern_type: trade.pattern_type || 'unknown',
        setup_quality: trade.setup_quality || 5,
        risk_reward_ratio: trade.risk_reward_ratio || 2,
        entry_quality: trade.entry_quality || 'fair',
        exit_quality: trade.exit_quality || 'fair',
        overall_grade: trade.overall_grade || 5,
        created_at: trade.created_at,
        updated_at: trade.updated_at
      })),
      total: allTrades.length,
      emergency_mode: true
    });

    db.close();
  } catch (error) {
    console.error('Emergency trades endpoint error:', error);
    res.status(500).json({
      success: false,
      error: 'DATABASE_ERROR',
      message: 'Failed to retrieve trades'
    });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    emergency_mode: true,
    environment: process.env.NODE_ENV || 'development'
  });
});

// API routes
app.use('/api', uploadRoute);
app.use('/api', progressRoute);
app.use('/api', patternsRoute);
app.use('/api', alertsRoute);

// Error handling
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({
    success: false,
    error: 'Internal server error'
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: 'Route not found'
  });
});

// Start server
const startServer = async () => {
  try {
    await initializeDatabase();
    console.log('✅ Database initialized');

    const server = app.listen(PORT, '0.0.0.0', () => {
      console.log(`🚀 EMERGENCY SERVER ONLINE - Port: ${PORT}`);
    });

    process.on('SIGTERM', () => {
      server.close(() => process.exit(0));
    });

  } catch (error) {
    console.error('❌ Emergency server failed:', error);
    process.exit(1);
  }
};

startServer();
module.exports = app;
