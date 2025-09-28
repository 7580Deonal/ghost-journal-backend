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

// ============================================================================
// RAILWAY/PRODUCTION CONFIGURATION
// ============================================================================

// Trust proxy setting for Railway deployment - MUST be set before rate limiting
app.set('trust proxy', true);

// Enhanced security configuration for production
app.use(helmet({
  crossOriginEmbedderPolicy: false,
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// ============================================================================
// CORS CONFIGURATION - Optimized for Lovable Frontend Integration
// ============================================================================

const corsOptions = {
  origin: function (origin, callback) {
    // Define allowed origins with specific Lovable domain support
    const allowedOrigins = [
      'https://76ed0371-d368-4787-bbbe-9b7497991383.lovableproject.com',
      /^https:\/\/.*\.lovableproject\.com$/,
      /^https:\/\/.*\.lovable\.dev$/,
      'https://lovable.dev',
      /^https:\/\/.*\.railway\.app$/,
      /^https:\/\/.*\.vercel\.app$/,
      /^http:\/\/localhost:\d+$/,
    ];

    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);

    // Check if origin is in allowed list
    const isAllowed = allowedOrigins.some(allowedOrigin => {
      if (typeof allowedOrigin === 'string') {
        return origin === allowedOrigin;
      } else if (allowedOrigin instanceof RegExp) {
        return allowedOrigin.test(origin);
      }
      return false;
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      console.log(`🚫 CORS blocked origin: ${origin}`);
      callback(null, false);
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'Accept',
    'Origin',
    'Cache-Control',
    'X-File-Name',
    'X-File-Size',
    'X-Upload-Type'
  ],
  exposedHeaders: ['X-Total-Count', 'X-Rate-Limit-Remaining'],
  optionsSuccessStatus: 200,
  preflightContinue: false
};

app.use(cors(corsOptions));

// ============================================================================
// RATE LIMITING - Production Ready
// ============================================================================

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 200, // Increased for file uploads
  message: {
    error: 'Too many requests',
    message: 'Please try again in 15 minutes',
    retryAfter: 15 * 60
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => {
    // Skip rate limiting for health checks
    return req.path === '/api/health';
  }
});

app.use(limiter);

// ============================================================================
// MIDDLEWARE CONFIGURATION
// ============================================================================

// Enhanced logging for production debugging
app.use(morgan('combined', {
  stream: {
    write: (message) => {
      logger.info('HTTP Request', { message: message.trim() });
    }
  }
}));

// Body parsing with larger limits for file uploads
app.use(express.json({
  limit: '15mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  }
}));
app.use(express.urlencoded({
  extended: true,
  limit: '15mb',
  parameterLimit: 50
}));

// Static file serving with caching
app.use('/uploads', express.static('uploads', {
  maxAge: '1d',
  etag: false
}));

// ============================================================================
// EXPLICIT PREFLIGHT HANDLING
// ============================================================================

app.options('*', (req, res) => {
  const origin = req.get('Origin');

  if (origin && corsOptions.origin(origin, () => {})) {
    res.header('Access-Control-Allow-Origin', origin);
  } else {
    res.header('Access-Control-Allow-Origin', '*');
  }

  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS, PATCH');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With, Accept, Origin');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Max-Age', '86400'); // 24 hours
  res.sendStatus(200);
});

// ============================================================================
// HEALTH CHECK ENDPOINT - Enhanced for Production Monitoring
// ============================================================================

app.get('/api/health', (req, res) => {
  const healthData = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    version: '1.0.0',
    uptime: process.uptime(),
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + 'MB'
    },
    system: {
      proxy_trust: app.get('trust proxy'),
      client_ip: req.ip,
      forwarded_for: req.get('X-Forwarded-For') || 'none',
      user_agent: req.get('User-Agent')?.substring(0, 100) || 'none'
    },
    cors: {
      origin: req.get('Origin') || 'none',
      origin_allowed: req.get('Origin') ? 'checking...' : 'no-origin'
    }
  };

  res.header('Cache-Control', 'no-cache');
  res.json(healthData);
});

// ============================================================================
// API ROUTES
// ============================================================================

app.use('/api', uploadRoute);
app.use('/api', progressRoute);
app.use('/api', patternsRoute);
app.use('/api', alertsRoute);

// ============================================================================
// ERROR HANDLING
// ============================================================================

// Global error handler with enhanced logging
app.use((err, req, res, next) => {
  logger.error('Unhandled application error', {
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent')
  });

  // Handle specific error types
  if (err.code === 'EBADCSRFTOKEN') {
    return res.status(403).json({
      success: false,
      error: 'Invalid CSRF token',
      code: 'CSRF_ERROR'
    });
  }

  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({
      success: false,
      error: 'File too large',
      message: 'Maximum file size is 10MB',
      code: 'FILE_TOO_LARGE'
    });
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    return res.status(400).json({
      success: false,
      error: 'Unexpected file field',
      message: 'Please check your file upload configuration',
      code: 'UNEXPECTED_FIELD'
    });
  }

  // Default error response
  const statusCode = err.statusCode || err.status || 500;
  res.status(statusCode).json({
    success: false,
    error: statusCode === 500 ? 'Internal server error' : err.message,
    code: err.code || 'UNKNOWN_ERROR',
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

app.use(notFound);

// ============================================================================
// SERVER STARTUP
// ============================================================================

const startServer = async () => {
  try {
    // Initialize logging
    logger.sessionStart();

    // Initialize database
    await initializeDatabase();
    logger.info('✅ Database initialized successfully');

    // Start HTTP server
    const server = app.listen(PORT, '0.0.0.0', () => {
      const startupInfo = {
        port: PORT,
        environment: process.env.NODE_ENV || 'development',
        proxy_trust: app.get('trust proxy'),
        cors_enabled: true,
        upload_limit: '15MB',
        goal: '$500 → $951,000 over 5 years'
      };

      logger.info('🚀 Ghost Journal Backend started successfully', startupInfo);

      console.log('\n🎯 ================================');
      console.log('🚀 Ghost Journal Backend ONLINE');
      console.log('🎯 ================================');
      console.log(`📡 Port: ${PORT}`);
      console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`🔧 Proxy Trust: ${app.get('trust proxy')}`);
      console.log(`🌐 CORS: Configured for Lovable frontend`);
      console.log(`📊 AI Trading Coach: Ready for MNQ analysis`);
      console.log(`💰 Goal: $500 → $951,000 over 5 years`);
      console.log('🎯 ================================\n');
    });

    // Graceful shutdown handling
    process.on('SIGTERM', () => {
      console.log('🛑 SIGTERM received, shutting down gracefully');
      server.close(() => {
        logger.info('💤 Server closed successfully');
        process.exit(0);
      });
    });

    process.on('SIGINT', () => {
      console.log('🛑 SIGINT received, shutting down gracefully');
      server.close(() => {
        logger.info('💤 Server closed successfully');
        process.exit(0);
      });
    });

  } catch (error) {
    logger.error('❌ Failed to start server', {
      error: error.message,
      stack: error.stack
    });
    console.error('❌ STARTUP FAILED:', error.message);
    process.exit(1);
  }
};

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  logger.error('💥 Uncaught Exception', { error: err.message, stack: err.stack });
  console.error('💥 Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('💥 Unhandled Rejection', { reason, promise });
  console.error('💥 Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

startServer();

module.exports = app;
