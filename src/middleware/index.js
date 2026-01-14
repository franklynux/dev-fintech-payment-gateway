// Export all middleware modules
const auth = require('./auth');
const validation = require('./validation');
const logging = require('./logging');
const errorHandler = require('./errorHandler');

// Rate limiting middleware
const rateLimit = require('express-rate-limit');
const { RedisStore } = require('rate-limit-redis');
const redis = require('../config/redis');
const config = require('../config');

const compression = require('compression');

// Create rate limiters
const rateLimiters = {
  // General API rate limiter
  api: rateLimit({
    windowMs: config.security.rateLimitWindow,
    max: config.security.rateLimitMax,
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    message: {
      error: 'RateLimitError',
      message: 'Too many requests, please try again later.',
    },
  }),

  // Stricter rate limiter for payment processing
  paymentProcessing: rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 30, // 30 requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    message: {
      error: 'RateLimitError',
      message: 'Too many payment requests, please try again later.',
    },
  }),

  // Stricter rate limiter for refunds
  refundProcessing: rateLimit({
    windowMs: 60 * 1000, // 1 minute
    max: 10, // 10 requests per minute
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: false,
    message: {
      error: 'RateLimitError',
      message: 'Too many refund requests, please try again later.',
    },
  }),

  // Webhook processing rate limiter
  webhookProcessing: rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 100, // 100 webhooks per 5 minutes
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // Don't count successful webhooks
    message: {
      error: 'RateLimitError',
      message: 'Too many webhook requests, please try again later.',
    },
  }),

  // Merchant-specific rate limiting using Redis
  merchant: rateLimit({
    store: new RedisStore({
      client: redis,
      sendCommand: (...args) => redis.command(...args),
      prefix: 'rate_limit:merchant:',
    }),
    windowMs: config.security.rateLimitWindow,
    max: (req) => {
      // Different limits based on merchant tier
      const merchant = req.merchant;
      if (!merchant) return 100; // Default limit
      
      const tier = merchant.metadata?.tier || 'standard';
      const limits = {
        basic: 100,
        standard: 1000,
        premium: 10000,
        enterprise: 100000,
      };
      
      return limits[tier] || 100;
    },
    keyGenerator: (req) => {
      return req.merchant?.id || req.ip;
    },
    standardHeaders: true,
    legacyHeaders: false,
    message: {
      error: 'RateLimitError',
      message: 'Rate limit exceeded for your merchant account.',
    },
  }),
};

// CORS middleware
const cors = require('cors');
const corsMiddleware = cors({
  origin: config.cors?.origin || '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'x-api-key',
    'idempotency-key',
    'x-request-id',
    'x-correlation-id',
  ],
  exposedHeaders: [
    'x-request-id',
    'x-correlation-id',
    'x-response-time',
    'x-response-size',
  ],
  credentials: config.cors?.credentials || false,
  maxAge: config.cors?.maxAge || 86400, // 24 hours
});

// Security middleware
const helmet = require('helmet');
const securityMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'"],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'"],
      frameSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  frameguard: { action: 'deny' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
});

// Body parsing middleware
const bodyParser = require('body-parser');
const bodyParserMiddleware = {
  json: bodyParser.json({
    limit: config.bodyParser?.limit || '10mb',
    strict: true,
  }),
  urlencoded: bodyParser.urlencoded({
    extended: true,
    limit: config.bodyParser?.limit || '10mb',
  }),
  raw: bodyParser.raw({
    type: 'application/json',
    limit: config.bodyParser?.limit || '10mb',
  }),
};

// Compression middleware
const compressionMiddleware = compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
});

// Request ID middleware
const requestIdMiddleware = (req, res, next) => {
  const requestId = req.headers['x-request-id'] || require('uuid').v4();
  req.requestId = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
};

// Correlation ID middleware
const correlationIdMiddleware = (req, res, next) => {
  const correlationId = req.headers['x-correlation-id'] || req.requestId || require('uuid').v4();
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);
  next();
};

// Response time middleware
const responseTime = require('response-time');
const responseTimeMiddleware = responseTime((req, res, time) => {
  res.setHeader('X-Response-Time', `${time.toFixed(2)}ms`);
});

// Metrics middleware
const metricsMiddleware = (req, res, next) => {
  const startTime = Date.now();
  
  // Capture response finish
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    
    // Record metrics
    const metrics = require('../utils/metrics')();
    const route = req.route?.path || req.path;
    
    metrics.httpRequestDuration.observe(
      { method: req.method, route, status_code: res.statusCode },
      duration / 1000
    );
    
    metrics.httpRequestsTotal.inc({
      method: req.method,
      route,
      status_code: res.statusCode,
    });
    
    // Log slow requests
    if (duration > 1000) {
      const logger = require('../utils/logger')();
      logger.warn('Slow request', {
        duration,
        method: req.method,
        path: req.path,
        merchantId: req.merchant?.id,
        statusCode: res.statusCode,
      });
    }
  });
  
  next();
};

// Cache control middleware
const cacheControlMiddleware = (req, res, next) => {
  // Only set cache headers for GET requests
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
  }
  next();
};

// Security headers middleware
const securityHeadersMiddleware = (req, res, next) => {
  // Prevent clickjacking
  res.setHeader('X-Frame-Options', 'DENY');
  
  // Prevent MIME type sniffing
  res.setHeader('X-Content-Type-Options', 'nosniff');
  
  // Enable XSS protection
  res.setHeader('X-XSS-Protection', '1; mode=block');
  
  // Referrer policy
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  
  // Permissions policy
  res.setHeader('Permissions-Policy', 'geolocation=(), microphone=(), camera=()');
  
  next();
};

// Async error handler wrapper
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

// Export all middleware
module.exports = {
  // Core middleware
  auth,
  validation,
  logging,
  errorHandler,
  
  // Rate limiting
  rateLimiter: rateLimiters,
  
  // Security
  cors: corsMiddleware,
  helmet: securityMiddleware,
  securityHeaders: securityHeadersMiddleware,
  
  // Body parsing
  bodyParser: bodyParserMiddleware,
  
  // Performance
  compression: compressionMiddleware,
  responseTime: responseTimeMiddleware,
  metrics: metricsMiddleware,
  
  // Request/Response
  requestId: requestIdMiddleware,
  correlationId: correlationIdMiddleware,
  cacheControl: cacheControlMiddleware,
  
  // Utilities
  asyncHandler,
  
  // Convenience methods
  initialize: (app) => {
    // Apply middleware in correct order
    app.use(requestIdMiddleware);
    app.use(correlationIdMiddleware);
    app.use(logging.requestLogger());
    app.use(logging.correlationId());
    app.use(logging.performanceMonitor());
    app.use(logging.securityLogger());
    app.use(securityMiddleware);
    app.use(corsMiddleware);
    app.use(securityHeadersMiddleware);
    app.use(rateLimiters.api);
    app.use(compressionMiddleware);
    app.use(bodyParserMiddleware.json);
    app.use(bodyParserMiddleware.urlencoded);
    app.use(responseTimeMiddleware);
    app.use(metricsMiddleware);
    app.use(cacheControlMiddleware);
    
    // Log middleware initialization
    const logger = require('../utils/logger')();
    logger.info('Middleware initialized', {
      environment: config.server.env,
      rateLimiting: 'enabled',
      compression: 'enabled',
      cors: 'enabled',
      securityHeaders: 'enabled',
    });
  },
};