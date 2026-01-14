const dotenv = require('dotenv');
const path = require('path');

dotenv.config();

// Build database URL from individual components
const buildDatabaseUrl = () => {
  const {
    DATABASE_HOST,
    DATABASE_PORT,
    DATABASE_NAME,
    DATABASE_USER,
    DATABASE_PASSWORD,
  } = process.env;

  // URL encode the password to handle special characters
  const encodedPassword = encodeURIComponent(DATABASE_PASSWORD || '');
  
  return `postgresql://${DATABASE_USER}:${encodedPassword}@${DATABASE_HOST}:${DATABASE_PORT}/${DATABASE_NAME}`;
};

const config = {
  // Server Configuration
  server: {
    port: process.env.PORT || 8888,
    env: process.env.NODE_ENV || 'development',
    name: process.env.SERVICE_NAME || 'payment-gateway-proxy',
  },

  // Security & Authentication
  security: {
    jwtSecret: process.env.JWT_SECRET,
    apiKeyHeader: process.env.API_KEY_HEADER || 'x-api-key',
    rateLimitWindow: parseInt(process.env.RATE_LIMIT_WINDOW) || 15 * 60 * 1000, // 15 minutes
    rateLimitMax: parseInt(process.env.RATE_LIMIT_MAX) || 100,
  },

  // Payment Processors
  processors: {
    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY,
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
      timeout: parseInt(process.env.STRIPE_TIMEOUT) || 10000,
    },
    paypal: {
      clientId: process.env.PAYPAL_CLIENT_ID,
      clientSecret: process.env.PAYPAL_CLIENT_SECRET,
      environment: process.env.PAYPAL_ENVIRONMENT || 'sandbox',
      timeout: parseInt(process.env.PAYPAL_TIMEOUT) || 10000,
    },
  },

  // Fraud Service
  fraudService: {
    url: process.env.FRAUD_SERVICE_URL,
    apiKey: process.env.FRAUD_SERVICE_API_KEY,
    timeout: parseInt(process.env.FRAUD_SERVICE_TIMEOUT) || 5000,
    enabled: process.env.FRAUD_SERVICE_ENABLED !== 'false',
    threshold: parseFloat(process.env.FRAUD_THRESHOLD) || 0.7,
  },

  // Database
  database: {
    host: process.env.DATABASE_HOST || 'localhost',
    port: parseInt(process.env.DATABASE_PORT) || 5432,
    name: process.env.DATABASE_NAME || 'payment_gateway',
    user: process.env.DATABASE_USER || 'postgres',
    password: process.env.DATABASE_PASSWORD || '',
    url: buildDatabaseUrl(),
    ssl: process.env.DATABASE_SSL === 'true',
    maxConnections: parseInt(process.env.DATABASE_MAX_CONNECTIONS) || 20,
    // Connection pool settings
    pool: {
      max: parseInt(process.env.DB_POOL_MAX) || 20,
      min: parseInt(process.env.DB_POOL_MIN) || 0,
      acquire: parseInt(process.env.DB_POOL_ACQUIRE) || 30000,
      idle: parseInt(process.env.DB_POOL_IDLE) || 10000,
    },
  },

  // Redis (for idempotency, caching, rate limiting)
  redis: {
    url: process.env.REDIS_URL || 'redis://localhost:6379',
    prefix: process.env.REDIS_PREFIX || 'payment:',
    ttl: {
      idempotency: parseInt(process.env.IDEMPOTENCY_TTL) || 86400, // 24 hours
      tokens: parseInt(process.env.TOKEN_TTL) || 2592000, // 30 days
      rateLimit: parseInt(process.env.RATE_LIMIT_TTL) || 900, // 15 minutes
    },
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    format: process.env.LOG_FORMAT || 'json',
    directory: process.env.LOG_DIR || path.join(__dirname, '../../logs'),
  },

  // Monitoring
  monitoring: {
    enabled: process.env.MONITORING_ENABLED !== 'false',
    metricsPort: parseInt(process.env.METRICS_PORT) || 9091,
    namespace: process.env.METRICS_NAMESPACE || 'payment_gateway',
  },

  // Retry Configuration
  retry: {
    maxAttempts: parseInt(process.env.RETRY_MAX_ATTEMPTS) || 3,
    initialDelay: parseInt(process.env.RETRY_INITIAL_DELAY) || 1000,
    maxDelay: parseInt(process.env.RETRY_MAX_DELAY) || 10000,
    backoffFactor: parseFloat(process.env.RETRY_BACKOFF_FACTOR) || 2,
  },

  // Routing Configuration
  routing: {
    strategy: process.env.ROUTING_STRATEGY || 'cost', // cost, region, success_rate
    defaultProcessor: process.env.DEFAULT_PROCESSOR || 'stripe',
    failoverEnabled: process.env.FAILOVER_ENABLED !== 'false',
  },

  // PCI Compliance Settings (extended in pci.js)
  pci: require('./pci'),

  // Body parser config
  bodyParser: {
    limit: process.env.BODY_PARSER_LIMIT || '10mb',
  },
  
  // CORS config
  cors: {
    origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : '*',
    credentials: process.env.CORS_CREDENTIALS === 'true',
    maxAge: parseInt(process.env.CORS_MAX_AGE) || 86400,
  }
};

// Validate required configuration
const validateConfig = () => {
  const required = [
    'JWT_SECRET',
    'STRIPE_SECRET_KEY',
    'PAYPAL_CLIENT_ID',
    'PAYPAL_CLIENT_SECRET',
    'DATABASE_HOST',
    'DATABASE_NAME',
    'DATABASE_USER',
    'DATABASE_PASSWORD',
  ];

  const missing = required.filter(key => !process.env[key]);
  
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(', ')}`);
  }

  // PCI validation
  if (config.pci.enabled) {
    console.warn('⚠️  PCI DSS Compliance Mode Enabled - Extra security measures active');
  }
};

validateConfig();

module.exports = config;