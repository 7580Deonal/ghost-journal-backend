const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

const { initializeDatabase } = require('./src/models/database');
const logger = require('./src/utils/logger');
const uploadRoute = require('./src/routes/upload');
const progressRoute = require('./src/routes/progress');
const patternsRoute = require('./src/routes/patterns');
const alertsRoute = require('./src/routes/alerts');
const { errorHandler, notFound } = require('./src/middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3002;

// Trust proxy setting for Railway/Heroku/Vercel deployments
// This must be set before any rate limiting middleware
app.set('trust proxy', true);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

app.use(helmet());
// Permissive CORS configuration for Lovable frontend connection
const corsOptions = {
  origin: true, // Allow any origin for now
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  optionsSuccessStatus: 200
};

app.use(cors(corsOptions));
app.use(limiter);
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use('/uploads', express.static('uploads'));

// Explicit OPTIONS handler for all API routes
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    proxy_trust: app.get('trust proxy'),
    client_ip: req.ip,
    forwarded_for: req.get('X-Forwarded-For') || 'none',
    cors_info: {
      origin: req.get('Origin') || 'none',
      user_agent: req.get('User-Agent') || 'none',
      referer: req.get('Referer') || 'none'
    }
  });
});

app.use('/api', uploadRoute);
app.use('/api', progressRoute);
app.use('/api', patternsRoute);
app.use('/api', alertsRoute);

app.use(notFound);
app.use(errorHandler);

const startServer = async () => {
  try {
    logger.sessionStart();

    await initializeDatabase();
    logger.info('Database initialized successfully');

    app.listen(PORT, () => {
      logger.info('Ghost Journal Backend started', {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        goal: '$500 → $951,000 over 5 years'
      });

      console.log(`🚀 Ghost Journal Backend running on port ${PORT}`);
      console.log(`📊 Trading Coach API ready for MNQ scalping analysis`);
      console.log(`🎯 5-Year Goal: $500 → $951,000`);
      console.log(`💡 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔧 Proxy trust enabled: ${app.get('trust proxy')}`);
    });
  } catch (error) {
    logger.error('Failed to start server', { error: error.message, stack: error.stack });
    console.error('❌ Failed to start server:', error);
    process.exit(1);
  }
};

startServer();

module.exports = app;
