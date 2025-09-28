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
const PORT = process.env.PORT || 3000;

// =============================================================================
// RAILWAY/PRODUCTION CONFIGURATION
// =============================================================================

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

// =============================================================================
// RATE LIMITING WITH LOVABLE FRONTEND EXEMPTION
// =============================================================================

// Trusted sources configuration
const trustedSources = {
    ips: ['172.58.15.173'], // Your Lovable IP
    origins: ['https://76ed0371-d368-4787-bbbe-9b7497991383.lovableproject.com'],
    // + patterns for *.lovableproject.com, *.lovable.dev
};

// Enhanced rate limiting with exemption logic
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100, // Limit each IP to 100 requests per windowMs
    message: {
        success: false,
        error: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests from this IP, please try again later.',
        retryAfter: '15 minutes'
    },
    standardHeaders: true,
    legacyHeaders: false,
    skip: (req) => {
        const clientIP = req.ip || req.connection.remoteAddress;
        const origin = req.get('Origin') || req.get('Referer');
        
        // Check if IP is in trusted list
        const isTrustedIP = trustedSources.ips.includes(clientIP);
        
        // Check if origin is trusted
        const isTrustedOrigin = origin && trustedSources.origins.some(trustedOrigin => 
            origin.includes(trustedOrigin)
        );
        
        const isExempt = isTrustedIP || isTrustedOrigin;
        
        if (isExempt) {
            console.log(`🟢 Exempt: Trusted IP ${clientIP}`);
        }
        
        return isExempt;
    },
    handler: (req, res) => {
        const clientIP = req.ip || req.connection.remoteAddress;
        console.log(`🔴 Rate Limited: IP ${clientIP}`);
        
        // Return JSON instead of HTML
        res.status(429).json({
            success: false,
            error: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests from this IP, please try again later.',
            retryAfter: '15 minutes',
            clientIP: clientIP
        });
    }
});

app.use(limiter);

// =============================================================================
// CORS CONFIGURATION
// =============================================================================

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);
        
        const allowedOrigins = [
            'https://76ed0371-d368-4787-bbbe-9b7497991383.lovableproject.com',
            'http://localhost:3000',
            'http://localhost:3001',
            'http://localhost:5173'
        ];
        
        const isAllowed = allowedOrigins.some(allowedOrigin => 
            origin.includes(allowedOrigin) || 
            origin.includes('lovableproject.com') ||
            origin.includes('lovable.dev')
        );
        
        if (isAllowed) {
            callback(null, true);
        } else {
            console.log(`❌ CORS blocked origin: ${origin}`);
            callback(new Error('Not allowed by CORS'));
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// =============================================================================
// MIDDLEWARE
// =============================================================================

app.use(morgan('combined'));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Enhanced request logging middleware
app.use((req, res, next) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent') || 'Unknown';
    const origin = req.get('Origin') || req.get('Referer') || 'No origin';
    
    console.log(`📥 ${req.method} ${req.path}`);
    console.log(`   IP: ${clientIP}`);
    console.log(`   Origin: ${origin}`);
    console.log(`   User-Agent: ${userAgent.substring(0, 100)}`);
    
    next();
});

// =============================================================================
// HEALTH CHECK WITH RATE LIMITING STATUS
// =============================================================================

app.get('/api/health', (req, res) => {
    const clientIP = req.ip || req.connection.remoteAddress;
    const origin = req.get('Origin') || req.get('Referer');
    
    // Check if this client would be exempt from rate limiting
    const isTrustedIP = trustedSources.ips.includes(clientIP);
    const isTrustedOrigin = origin && trustedSources.origins.some(trustedOrigin => 
        origin.includes(trustedOrigin)
    );
    const isExempt = isTrustedIP || isTrustedOrigin;
    
    res.json({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        environment: process.env.NODE_ENV || 'development',
        proxy_trust: app.get('trust proxy'),
        anthropic_configured: !!process.env.ANTHROPIC_API_KEY,
        client_ip: clientIP,
        trusted_ip: isTrustedIP,
        client_exempt: isExempt,
        origin: origin
    });
});

// =============================================================================
// ROUTES
// =============================================================================

app.use('/api', uploadRoute);
app.use('/api', progressRoute);
app.use('/api', patternsRoute);
app.use('/api', alertsRoute);

// =============================================================================
// ERROR HANDLING
// =============================================================================

// Enhanced JSON parsing middleware
app.use((err, req, res, next) => {
    if (err instanceof SyntaxError && err.status === 400 && 'body' in err) {
        console.error('❌ JSON Parsing Error:', {
            error: err.message,
            body: req.body,
            contentType: req.get('Content-Type'),
            ip: req.ip
        });
        return res.status(400).json({
            success: false,
            error: 'INVALID_JSON',
            message: 'Invalid JSON in request body',
            details: err.message
        });
    }
    next(err);
});

app.use(notFound);
app.use(errorHandler);

// =============================================================================
// SERVER STARTUP
// =============================================================================

async function startServer() {
    try {
        // Initialize database
        await initializeDatabase();
        console.log('✅ Database tables created successfully');
        
        // Start server
        app.listen(PORT, '0.0.0.0', () => {
            console.log('🚀 Ghost Journal Backend Started successfully');
            console.log(`📡 Server running on port ${PORT}`);
            console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
            console.log(`🔐 Anthropic API: ${process.env.ANTHROPIC_API_KEY ? 'Configured' : 'Missing'}`);
            console.log(`🛡️  CORS enabled for Lovable frontend`);
            console.log(`⚡ Rate limiting active with frontend exemption`);
            console.log(`🔍 Enhanced debugging enabled`);
        });
        
    } catch (error) {
        console.error('❌ Failed to start server:', error);
        process.exit(1);
    }
}

startServer();
