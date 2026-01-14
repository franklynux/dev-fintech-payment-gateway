// Export all services for easy importing
module.exports = {
  // Processors
  stripe: require('./processors/stripe'),
  paypal: require('./processors/paypal'),
  processorFactory: require('./processors/processorFactory'),
  
  // Core services
  fraudService: require('./fraudService'),
  routingService: require('./routingService'),
  tokenService: require('./tokenService'),
  webhookService: require('./webhookService'),
  eventProcessor: require('./eventProcessor'),
  
  // Utility services (if needed as singletons)
  metrics: require('../utils/metrics'),
  logger: require('../utils/logger'),
  encryption: require('../utils/encryption'),
  retry: require('../utils/retry'),
  idempotency: require('../utils/idempotency'),
};