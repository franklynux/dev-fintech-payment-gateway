const StripeProcessor = require('./stripe');
const PayPalProcessor = require('./paypal');
const config = require('../../config');
const logger = require('../../utils/logger')();

class ProcessorFactory {
  constructor() {
    this.processors = new Map();
    this.initializeProcessors();
  }

  /**
   * Initialize all available processors
   */
  initializeProcessors() {
    // Initialize Stripe
    try {
      const stripe = new StripeProcessor();
      this.processors.set('stripe', stripe);
      logger.info('Stripe processor initialized');
    } catch (error) {
      logger.error('Failed to initialize Stripe processor', {
        error: error.message,
      });
    }

    // Initialize PayPal
    try {
      const paypal = new PayPalProcessor();
      this.processors.set('paypal', paypal);
      logger.info('PayPal processor initialized');
    } catch (error) {
      logger.error('Failed to initialize PayPal processor', {
        error: error.message,
      });
    }

    // Additional processors can be added here
    // e.g., Adyen, Square, Braintree, etc.
  }

  /**
   * Get a processor by name
   */
  getProcessor(name, merchantId = null) {
    const processor = this.processors.get(name.toLowerCase());
    
    if (!processor) {
      throw new Error(`Processor not found: ${name}`);
    }

    // If merchant ID is provided, configure processor with merchant-specific settings
    if (merchantId) {
      return this.configureProcessor(processor, merchantId);
    }

    return processor;
  }

  /**
   * Get all available processors
   */
  getAllProcessors() {
    return Array.from(this.processors.values());
  }

  /**
   * Get processor names
   */
  getProcessorNames() {
    return Array.from(this.processors.keys());
  }

  /**
   * Check if processor is available
   */
  hasProcessor(name) {
    return this.processors.has(name.toLowerCase());
  }

  /**
   * Configure processor with merchant-specific settings
   */
  configureProcessor(processor, merchantId) {
    // This would typically load merchant configuration from database
    // and apply processor-specific settings (API keys, webhooks, etc.)
    
    // For now, return the processor as-is
    // In production, you might create a wrapped processor with merchant config
    return processor;
  }

  /**
   * Get processor health status
   */
  async getProcessorHealth(name = null) {
    const results = {};
    
    if (name) {
      const processor = this.getProcessor(name);
      results[name] = await processor.healthCheck();
    } else {
      const healthChecks = await Promise.allSettled(
        this.getAllProcessors().map(async (processor) => {
          return {
            name: processor.name,
            health: await processor.healthCheck(),
          };
        })
      );
      
      healthChecks.forEach(result => {
        if (result.status === 'fulfilled') {
          results[result.value.name] = result.value.health;
        }
      });
    }
    
    return results;
  }

  /**
   * Get processor capabilities
   */
  getProcessorCapabilities(name = null) {
    const capabilities = {};
    
    if (name) {
      const processor = this.getProcessor(name);
      capabilities[name] = processor.getCapabilities();
    } else {
      this.getAllProcessors().forEach(processor => {
        capabilities[processor.name] = processor.getCapabilities();
      });
    }
    
    return capabilities;
  }

  /**
   * Get recommended processor for transaction
   */
  async getRecommendedProcessor(transactionData, merchantConfig) {
    const { amount, currency, region } = transactionData;
    const availableProcessors = this.getAllProcessors();
    
    // Filter by merchant configuration
    let processors = availableProcessors.filter(processor => {
      const capabilities = processor.getCapabilities();
      
      // Check currency support
      if (!capabilities.currencies.includes(currency)) {
        return false;
      }
      
      // Check region support
      if (region && !capabilities.countries.includes(region)) {
        return false;
      }
      
      // Check amount limits
      if (amount < capabilities.minAmount || amount > capabilities.maxAmount) {
        return false;
      }
      
      return true;
    });
    
    if (processors.length === 0) {
      throw new Error('No processors available for this transaction');
    }
    
    // Sort by fee (estimate)
    const processorsWithFees = await Promise.all(
      processors.map(async (processor) => {
        const fee = await processor.calculateFee(amount, currency);
        return { processor, fee };
      })
    );
    
    processorsWithFees.sort((a, b) => a.fee - b.fee);
    
    return processorsWithFees[0].processor;
  }

  /**
   * Register a new processor
   */
  registerProcessor(name, processorClass, options = {}) {
    if (this.processors.has(name)) {
      logger.warn(`Processor already registered: ${name}`);
      return;
    }
    
    try {
      const processor = new processorClass(options);
      this.processors.set(name, processor);
      logger.info(`Processor registered: ${name}`);
    } catch (error) {
      logger.error(`Failed to register processor: ${name}`, {
        error: error.message,
      });
      throw error;
    }
  }

  /**
   * Unregister a processor
   */
  unregisterProcessor(name) {
    if (this.processors.delete(name)) {
      logger.info(`Processor unregistered: ${name}`);
    }
  }

  /**
   * Execute operation on all processors (e.g., for failover)
   */
  async executeOnAll(operation, options = {}) {
    const { stopOnSuccess = false, timeout = 5000 } = options;
    const results = [];
    const errors = [];
    
    for (const [name, processor] of this.processors) {
      try {
        const result = await Promise.race([
          operation(processor),
          new Promise((_, reject) => 
            setTimeout(() => reject(new Error('Timeout')), timeout)
          ),
        ]);
        
        results.push({ processor: name, result });
        
        if (stopOnSuccess) {
          return { results, errors, successful: name };
        }
      } catch (error) {
        errors.push({ processor: name, error: error.message });
      }
    }
    
    return { results, errors, successful: results.length > 0 };
  }

  /**
   * Get processor metrics
   */
  getProcessorMetrics() {
    const metrics = {};
    
    this.getAllProcessors().forEach(processor => {
      metrics[processor.name] = {
        available: true,
        capabilities: processor.getCapabilities(),
      };
    });
    
    return metrics;
  }

  /**
   * Validate processor configuration
   */
  validateProcessorConfig(name, config) {
    // This would validate that all required configuration is present
    // for the given processor
    
    const requiredConfig = {
      stripe: ['secretKey', 'webhookSecret'],
      paypal: ['clientId', 'clientSecret', 'environment'],
    };
    
    const required = requiredConfig[name];
    if (!required) {
      throw new Error(`Unknown processor: ${name}`);
    }
    
    const missing = required.filter(key => !config[key]);
    if (missing.length > 0) {
      throw new Error(`Missing required configuration for ${name}: ${missing.join(', ')}`);
    }
    
    return true;
  }
}

// Singleton instance
let instance = null;

function getProcessorFactory() {
  if (!instance) {
    instance = new ProcessorFactory();
  }
  return instance;
}

module.exports = getProcessorFactory();