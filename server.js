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
// RATE LIMITING - Production Ready with Frontend Whitelisting
// ============================================================================

// Define trusted IPs and domains for rate limiting exemption
const trustedSources = {
  ips: [
    '172.58.15.173', // Lovable frontend IP
    '127.0.0.1',     // Localhost
    '::1',           // IPv6 localhost
  ],
  ipRanges: [
    '172.16.0.0/12', // Private IP range (Docker/containers)
    '10.0.0.0/8',    // Private IP range
    '192.168.0.0/16' // Private IP range
  ],
  origins: [
    'https://76ed0371-d368-4787-bbbe-9b7497991383.lovableproject.com',
    /^https:\/\/.*\.lovableproject\.com$/,
    /^https:\/\/.*\.lovable\.dev$/,
    /^https:\/\/.*\.railway\.app$/,
    /^https:\/\/.*\.vercel\.app$/
  ]
};

// Helper function to check if IP is in range
const isIPInRange = (ip, range) => {
  try {
    const [rangeIP, prefixLength] = range.split('/');
    const ipNum = ipToNumber(ip);
    const rangeNum = ipToNumber(rangeIP);
    const mask = (0xffffffff << (32 - parseInt(prefixLength))) >>> 0;
    return (ipNum & mask) === (rangeNum & mask);
  } catch (error) {
    return false;
  }
};

const ipToNumber = (ip) => {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet), 0) >>> 0;
};

// Check if request should be exempt from rate limiting
const isExemptFromRateLimit = (req) => {
  const clientIP = req.ip;
  const origin = req.get('Origin');
  const referer = req.get('Referer');

  console.log('🔍 Rate limit check:', {
    clientIP,
    origin,
    referer: referer?.substring(0, 100),
    userAgent: req.get('User-Agent')?.substring(0, 50)
  });

  // Skip rate limiting for health checks
  if (req.path === '/api/health') {
    console.log('✅ Exempt: Health check endpoint');
    return true;
  }

  // Check if IP is in trusted list
  if (trustedSources.ips.includes(clientIP)) {
    console.log('✅ Exempt: Trusted IP', clientIP);
    return true;
  }

  // Check if IP is in trusted ranges
  for (const range of trustedSources.ipRanges) {
    if (isIPInRange(clientIP, range)) {
      console.log('✅ Exempt: IP in trusted range', clientIP, range);
      return true;
    }
  }

  // Check if origin is trusted
  if (origin) {
    for (const trustedOrigin of trustedSources.origins) {
      if (typeof trustedOrigin === 'string' && origin === trustedOrigin) {
        console.log('✅ Exempt: Trusted origin', origin);
        return true;
      } else if (trustedOrigin instanceof RegExp && trustedOrigin.test(origin)) {
        console.log('✅ Exempt: Origin matches pattern', origin);
        return true;
      }
    }
  }

  // Check referer as fallback
  if (referer && !origin) {
    for (const trustedOrigin of trustedSources.origins) {
      if (typeof trustedOrigin === 'string' && referer.includes(trustedOrigin)) {
        console.log('✅ Exempt: Trusted referer', referer);
        return true;
      } else if (trustedOrigin instanceof RegExp && trustedOrigin.test(referer)) {
        console.log('✅ Exempt: Referer matches pattern', referer);
        return true;
      }
    }
  }

  console.log('⚠️ Not exempt from rate limiting');
  return false;
};

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 500, // Increased limit for legitimate traffic
  message: (req) => {
    // Return JSON instead of HTML for API endpoints
    return {
      success: false,
      error: 'Rate limit exceeded',
      message: 'Too many requests from this IP. Please try again in 15 minutes.',
      retryAfter: Math.ceil(15 * 60),
      clientIP: req.ip,
      timestamp: new Date().toISOString()
    };
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: isExemptFromRateLimit,
  // Custom handler for when limit is exceeded
  handler: (req, res) => {
    console.log('🚫 Rate limit exceeded:', {
      ip: req.ip,
      path: req.path,
      origin: req.get('Origin'),
      userAgent: req.get('User-Agent')?.substring(0, 100)
    });

    // Always return JSON for API endpoints
    res.status(429).json({
      success: false,
      error: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests from this IP. Please try again later.',
      retryAfter: Math.ceil(15 * 60),
      details: {
        clientIP: req.ip,
        limit: 500,
        windowMs: 15 * 60 * 1000,
        timestamp: new Date().toISOString()
      }
    });
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

// Enhanced JSON error handling middleware
app.use((req, res, next) => {
  // Store original json method
  const originalJson = res.json;

  // Override json method to ensure we always return JSON
  res.json = function(obj) {
    // Set proper headers
    res.set('Content-Type', 'application/json');

    // Ensure the response is actually JSON serializable
    try {
      JSON.stringify(obj);
      return originalJson.call(this, obj);
    } catch (error) {
      console.error('JSON serialization error:', error);
      return originalJson.call(this, {
        success: false,
        error: 'Response serialization failed',
        message: 'Internal server error'
      });
    }
  };

  next();
});

// Body parsing with larger limits for file uploads
app.use(express.json({
  limit: '15mb',
  verify: (req, res, buf) => {
    req.rawBody = buf;
  },
  // Handle JSON parsing errors gracefully
  type: ['application/json', 'text/plain']
}));

app.use(express.urlencoded({
  extended: true,
  limit: '15mb',
  parameterLimit: 50
}));

// JSON parsing error handler
app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
    console.error('JSON parsing error:', {
      error: error.message,
      body: req.rawBody?.toString().substring(0, 200),
      contentType: req.get('Content-Type'),
      path: req.path
    });

    return res.status(400).json({
      success: false,
      error: 'INVALID_JSON',
      message: 'Invalid JSON in request body',
      details: error.message
    });
  }
  next(error);
});

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
  const clientIP = req.ip;
  const origin = req.get('Origin');
  const isExempt = isExemptFromRateLimit(req);

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
      client_ip: clientIP,
      forwarded_for: req.get('X-Forwarded-For') || 'none',
      user_agent: req.get('User-Agent')?.substring(0, 100) || 'none'
    },
    cors: {
      origin: origin || 'none',
      origin_allowed: origin ? 'yes' : 'no-origin'
    },
    rate_limiting: {
      client_exempt: isExempt,
      trusted_ip: trustedSources.ips.includes(clientIP),
      limit: 500,
      window: '15 minutes',
      current_ip: clientIP
    },
    api: {
      anthropic_configured: !!process.env.ANTHROPIC_API_KEY,
      upload_enabled: true,
      max_upload_size: '15MB'
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
