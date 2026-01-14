const { Sequelize, DataTypes } = require('sequelize');
const config = require('./index');
const logger = require('../utils/logger')();
const redis = require('redis');

class Database {
  constructor() {
    this.sequelize = null;
    this.redisClient = null;
    this.isConnected = false;
    this.isRedisConnected = false;
    this.models = {};
  }

  async connect() {
    try {
      const connectionConfig = {
        dialect: 'postgres',
        logging: config.server.env === 'development' ? 
          (msg) => logger.debug(msg) : 
          false,
        pool: config.database.pool,
        define: {
          timestamps: true,
          underscored: true,
          paranoid: true,
          createdAt: 'created_at',
          updatedAt: 'updated_at',
          deletedAt: 'deleted_at',
        },
      };

      // Add SSL if configured
      if (config.database.ssl) {
        connectionConfig.dialectOptions = {
          ssl: {
            require: true,
            rejectUnauthorized: false,
          },
        };
      }

      this.sequelize = new Sequelize(config.database.url, connectionConfig);

      // Test connection with retry logic
      await this.retryConnection(3);
      this.isConnected = true;
      
      logger.info('Database connection established successfully', {
        host: config.database.host,
        port: config.database.port,
        database: config.database.name,
        user: config.database.user,
      });
      
      // Connect to Redis
      await this.connectRedis();
      
      // Sync models (in development)
      if (config.server.env === 'development') {
        await this.syncModels();
      }
      
    } catch (error) {
      logger.error('Unable to connect to the database:', {
        error: error.message,
        host: config.database.host,
        port: config.database.port,
        database: config.database.name,
      });
      throw error;
    }
  }

  async connectRedis() {
    try {
      this.redisClient = redis.createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              logger.warn('Too many Redis retries, giving up');
              return false;
            }
            return Math.min(retries * 100, 3000);
          }
        },
        // Use RESP2 protocol to avoid unexpected reply errors with older Redis servers
        protocol: 2
      });

      this.redisClient.on('error', (err) => {
        logger.error('Redis Client Error:', err.message);
        this.isRedisConnected = false;
      });

      this.redisClient.on('connect', () => {
        logger.info('Redis connected successfully');
        this.isRedisConnected = true;
      });

      this.redisClient.on('end', () => {
        logger.info('Redis connection closed');
        this.isRedisConnected = false;
      });

      await this.redisClient.connect();
    } catch (error) {
      logger.warn('Redis connection failed, continuing without Redis:', error.message);
      this.redisClient = null;
      this.isRedisConnected = false;
    }
  }

  async retryConnection(maxRetries, delay = 2000) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.sequelize.authenticate();
        return;
      } catch (error) {
        lastError = error;
        
        if (attempt < maxRetries) {
          logger.warn(`Database connection attempt ${attempt} failed, retrying in ${delay}ms...`, {
            error: error.message,
            attempt,
            maxRetries,
          });
          await new Promise(resolve => setTimeout(resolve, delay));
          // Exponential backoff
          delay *= 1.5;
        }
      }
    }
    
    throw lastError;
  }

  setupAssociations() {
    // Get the initialized models
    const { Merchant, Transaction } = this.models;

    // Define associations only if models exist
    if (Merchant && Transaction) {
      // Check if associations already exist
      if (!Merchant.associations || !Merchant.associations.transactions) {
        Merchant.hasMany(Transaction, {
          foreignKey: 'merchant_id',
          as: 'transactions',
        });
      }

      if (!Transaction.associations || !Transaction.associations.merchant) {
        Transaction.belongsTo(Merchant, {
          foreignKey: 'merchant_id',
          as: 'merchant',
        });
      }

      logger.debug('Database associations set up');
    }
  }

  async syncModels() {
    try {
      if (!this.isConnected) {
        await this.connect();
      }

      // Import and initialize models
      const MerchantModel = require('../models/Merchant');
      const TransactionModel = require('../models/Transaction');

      // Initialize models with sequelize instance and DataTypes
      this.models.Merchant = MerchantModel(this.sequelize, DataTypes);
      this.models.Transaction = TransactionModel(this.sequelize, DataTypes);

      // Setup associations
      this.setupAssociations();

      // Sync all models
      await this.sequelize.sync({ 
        force: config.server.env === 'development',
        alter: config.server.env === 'development',
      });
      
      logger.info('Database models synchronized', {
        force: config.server.env === 'development',
        alter: config.server.env === 'development',
        models: Object.keys(this.models),
      });
    } catch (error) {
      logger.error('Error syncing database models:', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }
  // Method to get models
  getModel(name) {
    if (!this.models[name]) {
      throw new Error(`Model ${name} not found. Database not initialized or model not loaded.`);
    }
    return this.models[name];
  }

  async disconnect() {
    try {
      if (this.sequelize) {
        await this.sequelize.close();
        this.isConnected = false;
        logger.info('Database connection closed');
      }
      if (this.redisClient) {
        await this.redisClient.quit();
        this.isRedisConnected = false;
        logger.info('Redis connection closed');
      }
    } catch (error) {
      logger.error('Error closing database connection:', {
        error: error.message,
      });
      throw error;
    }
  }

  async healthCheck() {
    const health = {
      database: {
        status: 'unhealthy',
        connected: this.isConnected,
        host: config.database.host,
        port: config.database.port,
        name: config.database.name,
      },
      redis: {
        status: 'unhealthy',
        connected: this.isRedisConnected,
      },
      timestamp: new Date().toISOString(),
    };

    try {
      // Check database
      if (this.isConnected) {
        await this.sequelize.query('SELECT 1');
        health.database.status = 'healthy';
      }
    } catch (error) {
      health.database.error = error.message;
    }

    try {
      // Check Redis
      if (this.redisClient && this.isRedisConnected) {
        await this.redisClient.ping();
        health.redis.status = 'healthy';
      } else {
        health.redis.error = 'Redis client not connected';
      }
    } catch (error) {
      health.redis.error = error.message;
    }

    // Overall status
    health.status = (health.database.status === 'healthy' && health.redis.status === 'healthy') 
      ? 'healthy' 
      : 'unhealthy';

    return health;
  }

  getSequelize() {
    if (!this.sequelize) {
      // Try to create connection if not already done
      this.connect().catch(() => {
        throw new Error('Database not connected and failed to connect');
      });
    }
    return this.sequelize;
  }

  getRedisClient() {
    return this.redisClient;
  }

  getDataTypes() {
    return DataTypes;
  }
}

// Singleton instance
let instance = null;

function getDatabase() {
  if (!instance) {
    instance = new Database();
  }
  return instance;
}

// For models to use - we'll export a getter that ensures connection
module.exports = {
  getDatabase,
  
  // // For use in models - this will lazily connect
  get sequelize() {
    const db = getDatabase();
    return db.getSequelize();
  },
  
  // // For use in models
  get DataTypes() {
    return DataTypes;
  },
  
  // Helper to initialize database
  async initialize() {
    const db = getDatabase();
    await db.connect();
    return db;
  },

  // Get models after initialization
  getModels: () => {
    const db = getDatabase();
    return db.models;
  },

  // Get model by name
  getModel: (name) => {
    const db = getDatabase();
    return db.getModel(name);
  },

  // Health check
  healthCheck: async () => {
    const db = getDatabase();
    return db.healthCheck();
  },

  // Disconnect
  disconnect: async () => {
    const db = getDatabase();
    return db.disconnect();
  },

  // // Get Redis client
  // getRedisClient() {
  //   const db = getDatabase();
  //   return db.getRedisClient();
  // },
};