const express = require("express");
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const pino = require('pino-http');
const createTerminus = require('@godaddy/terminus');

const config = require('./config');
const routes = require('./routes');
const middleware = require('./middleware');
const metrics = require('./utils/metrics')();
const { initialize: initializeDatabase } = require('./config/database');
const logger = require('./utils/logger')();

const app = express();

// Initialize database connection
let db;

async function initializeDatabaseConnection() {
  try {
    logger.info('Initializing database connection...');
    db = await initializeDatabase();
    logger.info('Database initialized successfully');
    return db;
  } catch (error) {
    logger.error('Failed to initialize database:', {
      error: error.message,
      stack: error.stack,
    });
    throw error;
  }
}

function setupMiddleware() {
  // Security middleware
  app.use(helmet());
  app.use(cors(config.cors));
  
  // Logging
  app.use(pino({
    level: config.logging.level,
    autoLogging: {
      ignore: (req) => req.url === '/health' || req.url === '/metrics'
    }
  }));

  // Metrics middleware - ONLY ONCE
  app.use(metrics.middleware.bind(metrics));
  
  // Rate limiting - ONLY ONCE with proper configuration
  const limiter = rateLimit({
    windowMs: config.security?.rateLimitWindow || 15 * 60 * 1000, // 15 minutes
    max: config.security?.rateLimitMax || 100, // Limit each IP to 100 requests per windowMs
    message: {
      error: 'RateLimitError',
      message: 'Too many requests, please try again later.',
    },
    standardHeaders: true,
    legacyHeaders: false,
  });
  
  // Apply rate limiting to API routes
  app.use('/api/v1', limiter);
  
  // Body parsing (with PCI considerations)
  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: false }));
  
  // Request validation middleware
  if (middleware.validation && middleware.validation.validatePciData) {
    app.use(middleware.validation.validatePciData);
  }
}

function setupRoutes() {
  // API Routes
  app.use('/api/v1', routes);
  
  // Metrics endpoint - MOVE THIS HERE FROM setupMiddleware
  app.get('/metrics', metrics.handler.bind(metrics));

  // Health endpoints
  app.get('/health', async (req, res) => {
    try {
      const health = {
        status: 'healthy',
        service: config.server.name,
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        database: db ? await db.healthCheck() : { status: 'disconnected' },
        memory: process.memoryUsage(),
      };
      res.status(200).json(health);
    } catch (error) {
      res.status(503).json({
        status: 'unhealthy',
        service: config.server.name,
        timestamp: new Date().toISOString(),
        error: error.message,
      });
    }
  });
  
  app.get('/ready', async (req, res) => {
    try {
      if (!db) {
        return res.status(503).json({
          status: 'NOT_READY',
          error: 'Database not initialized',
        });
      }
      
      const dbHealth = await db.healthCheck();
      const checks = { database: dbHealth };
      
      const allHealthy = Object.values(checks).every(
        check => check.status === 'healthy' || check.status === 'OK'
      );
      
      if (allHealthy) {
        res.status(200).json({ status: 'READY', checks });
      } else {
        res.status(503).json({ status: 'NOT_READY', checks });
      }
    } catch (error) {
      res.status(503).json({
        status: 'NOT_READY',
        error: error.message,
      });
    }
  });
  
  // 404 handler for undefined routes
  app.use('*', (req, res) => {
    res.status(404).json({
      error: 'NotFound',
      message: `Route ${req.originalUrl} not found`,
    });
  });
}

function setupErrorHandling() {
  // Global error handler
  app.use((err, req, res, next) => {
    logger.error('Unhandled error:', {
      error: err.message,
      stack: err.stack,
      path: req.path,
      method: req.method,
    });
    
    if (res.headersSent) {
      return next(err);
    }
    
    const statusCode = err.statusCode || err.status || 500;
    res.status(statusCode).json({
      error: err.name || 'InternalServerError',
      message: process.env.NODE_ENV === 'development' 
        ? err.message 
        : 'An unexpected error occurred',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    });
  });
}

function setupGracefulShutdown(server) {
  createTerminus(server, {
    signals: ['SIGTERM', 'SIGINT', 'SIGUSR2'],
    healthChecks: {
      '/health': () => Promise.resolve(),
      '/ready': async () => {
        if (!db) throw new Error('Database not initialized');
        const health = await db.healthCheck();
        if (health.status !== 'healthy') {
          throw new Error('Database not healthy');
        }
      },
    },
    onSignal: async () => {
      logger.info('Starting graceful shutdown...');
      try {
        if (db && db.disconnect) {
          await db.disconnect();
          logger.info('Database connection closed');
        }
      } catch (error) {
        logger.error('Error during shutdown:', { error: error.message });
      }
    },
    onShutdown: async () => {
      logger.info('Clean shutdown completed');
    },
    logger: (msg, err) => {
      logger.error(msg, { error: err?.message });
    },
  });
}

// Handle uncaught errors
process.on('uncaughtException', (error) => {
  logger.fatal('Uncaught Exception:', {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection:', {
    reason: reason?.message || reason,
    promise: promise.toString(),
  });
});

// Start the server
async function startServer() {
  try {
    logger.info('🔗 Starting Payment Gateway Proxy...');
    
    // 1. Initialize database
    await initializeDatabaseConnection();
    
    // 2. Setup middleware
    setupMiddleware();
    
    // 3. Setup routes
    setupRoutes();
    
    // 4. Setup error handling
    setupErrorHandling();
    
    // 5. Start HTTP server
    const PORT = config.server.port || 8888;
    const server = app.listen(PORT, () => {
      logger.info(`🚀 Server running on port ${PORT}`);
      logger.info(`🚀 Payment Gateway Proxy running on port ${PORT}`);
      logger.info(`🌍 Environment: ${config.server.env || 'development'}`);
      logger.info(`📊 Metrics: http://localhost:${PORT}/metrics`);
      logger.info(`🏥 Health: http://localhost:${PORT}/health`);
      logger.info(`🔍 Ready: http://localhost:${PORT}/ready`);
    });
    
    // 6. Setup graceful shutdown
    setupGracefulShutdown(server);
    
    return { app, server };
  } catch (error) {
    logger.info('❌ Failed to start server:', {
      error: error.message,
      stack: error.stack,
    });
    console.error('❌ Failed to start server:', error.message);
    process.exit(1);
  }
}

module.exports = { app, startServer };