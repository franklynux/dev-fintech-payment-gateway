const logger = require('../utils/logger')();
const metrics = require('../utils/metrics')();

class EventProcessor {
  constructor() {
    this.handlers = new Map();
    this.setupDefaultHandlers();
  }

  /**
   * Setup default event handlers
   */
  setupDefaultHandlers() {
    // Payment events
    this.registerHandler('payment.succeeded', this.handlePaymentSuccess.bind(this));
    this.registerHandler('payment.failed', this.handlePaymentFailure.bind(this));
    this.registerHandler('payment.refunded', this.handlePaymentRefund.bind(this));
    this.registerHandler('payment.disputed', this.handlePaymentDispute.bind(this));
    
    // Fraud events
    this.registerHandler('fraud.detected', this.handleFraudDetection.bind(this));
    this.registerHandler('fraud.review', this.handleFraudReview.bind(this));
    
    // Subscription events
    this.registerHandler('subscription.created', this.handleSubscriptionCreated.bind(this));
    this.registerHandler('subscription.updated', this.handleSubscriptionUpdated.bind(this));
    this.registerHandler('subscription.canceled', this.handleSubscriptionCanceled.bind(this));
    
    // Merchant events
    this.registerHandler('merchant.updated', this.handleMerchantUpdate.bind(this));
    this.registerHandler('merchant.suspended', this.handleMerchantSuspension.bind(this));
    
    // System events
    this.registerHandler('processor.health', this.handleProcessorHealth.bind(this));
    this.registerHandler('system.alert', this.handleSystemAlert.bind(this));
  }

  /**
   * Register an event handler
   */
  registerHandler(eventType, handler) {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }
    this.handlers.get(eventType).push(handler);
    
    logger.info('Event handler registered', {
      eventType,
      handlerCount: this.handlers.get(eventType).length,
    });
  }

  /**
   * Process an event
   */
  async process(event) {
    const { type, data, metadata = {} } = event;
    const startTime = Date.now();
    
    logger.info('Processing event', {
      type,
      eventId: metadata.eventId,
      timestamp: new Date().toISOString(),
    });
    
    try {
      // Get handlers for this event type
      const handlers = this.handlers.get(type) || [];
      
      if (handlers.length === 0) {
        logger.warn('No handlers registered for event type', { type });
        return { processed: false, reason: 'no_handlers' };
      }
      
      // Execute all handlers in parallel
      const results = await Promise.allSettled(
        handlers.map(handler => handler(data, metadata))
      );
      
      // Process results
      const succeeded = results.filter(r => r.status === 'fulfilled');
      const failed = results.filter(r => r.status === 'rejected');
      
      const duration = Date.now() - startTime;
      
      // Log results
      logger.info('Event processing completed', {
        type,
        eventId: metadata.eventId,
        duration,
        handlers: handlers.length,
        succeeded: succeeded.length,
        failed: failed.length,
      });
      
      // Log failures
      if (failed.length > 0) {
        failed.forEach((result, index) => {
          logger.error('Event handler failed', {
            eventType: type,
            handlerIndex: index,
            error: result.reason.message,
            stack: result.reason.stack,
          });
        });
      }
      
      // Record metrics
      metrics.recordProcessingTime(`event_${type}`, duration / 1000);
      
      return {
        processed: true,
        type,
        handlers: handlers.length,
        succeeded: succeeded.length,
        failed: failed.length,
        duration,
      };
    } catch (error) {
      logger.error('Event processing failed', {
        type,
        eventId: metadata.eventId,
        error: error.message,
        stack: error.stack,
      });
      
      throw error;
    }
  }

  /**
   * Payment event handlers
   */
  async handlePaymentSuccess(data, metadata) {
    const { transactionId, amount, currency, merchantId } = data;
    
    logger.info('Payment succeeded handler', {
      transactionId,
      amount,
      currency,
      merchantId,
    });
    
    // Update transaction status
    // Notify merchant
    // Trigger fulfillment
    // Record metrics
    
    metrics.recordTransaction({
      processor: data.processor,
      status: 'succeeded',
      amount,
      currency,
      merchantId,
      paymentMethod: data.paymentMethod,
    });
  }

  async handlePaymentFailure(data, metadata) {
    const { transactionId, error, merchantId } = data;
    
    logger.warn('Payment failed handler', {
      transactionId,
      error,
      merchantId,
    });
    
    // Update transaction status
    // Notify merchant
    // Trigger retry logic if applicable
    // Record metrics
    
    metrics.recordError('payment_failure', data.processor, 'process_payment');
  }

  async handlePaymentRefund(data, metadata) {
    const { transactionId, refundId, amount, merchantId } = data;
    
    logger.info('Payment refunded handler', {
      transactionId,
      refundId,
      amount,
      merchantId,
    });
    
    // Update transaction with refund
    // Update accounting
    // Notify merchant
    // Record metrics
    
    metrics.recordRefund(data.processor, amount, data.currency, data.reason);
  }

  async handlePaymentDispute(data, metadata) {
    const { transactionId, disputeId, reason, merchantId } = data;
    
    logger.warn('Payment disputed handler', {
      transactionId,
      disputeId,
      reason,
      merchantId,
    });
    
    // Update transaction status
    // Notify merchant
    // Trigger dispute handling workflow
    // Record metrics
  }

  /**
   * Fraud event handlers
   */
  async handleFraudDetection(data, metadata) {
    const { transactionId, score, reasons, merchantId } = data;
    
    logger.warn('Fraud detected handler', {
      transactionId,
      score,
      reasons,
      merchantId,
    });
    
    // Block transaction if score is high
    // Notify fraud team
    // Update risk assessment
    // Record metrics
    
    metrics.recordFraudDecision(score, 'detected', reasons.join(','));
  }

  async handleFraudReview(data, metadata) {
    const { transactionId, decision, reviewer, merchantId } = data;
    
    logger.info('Fraud review handler', {
      transactionId,
      decision,
      reviewer,
      merchantId,
    });
    
    // Update transaction based on review decision
    // Notify relevant parties
    // Record metrics
    
    metrics.recordFraudDecision(0.5, decision, 'manual_review');
  }

  /**
   * Subscription event handlers
   */
  async handleSubscriptionCreated(data, metadata) {
    const { subscriptionId, planId, customerId, merchantId } = data;
    
    logger.info('Subscription created handler', {
      subscriptionId,
      planId,
      customerId,
      merchantId,
    });
    
    // Create subscription record
    // Schedule next payment
    // Notify merchant
  }

  async handleSubscriptionUpdated(data, metadata) {
    const { subscriptionId, changes, merchantId } = data;
    
    logger.info('Subscription updated handler', {
      subscriptionId,
      changes: Object.keys(changes),
      merchantId,
    });
    
    // Update subscription record
    // Adjust billing if needed
    // Notify customer
  }

  async handleSubscriptionCanceled(data, metadata) {
    const { subscriptionId, reason, merchantId } = data;
    
    logger.info('Subscription canceled handler', {
      subscriptionId,
      reason,
      merchantId,
    });
    
    // Cancel subscription
    // Stop future billing
    // Notify merchant and customer
  }

  /**
   * Merchant event handlers
   */
  async handleMerchantUpdate(data, metadata) {
    const { merchantId, updates } = data;
    
    logger.info('Merchant updated handler', {
      merchantId,
      updates: Object.keys(updates),
    });
    
    // Update merchant configuration cache
    // Notify relevant services
    // Audit log
  }

  async handleMerchantSuspension(data, metadata) {
    const { merchantId, reason, suspendedBy } = data;
    
    logger.warn('Merchant suspended handler', {
      merchantId,
      reason,
      suspendedBy,
    });
    
    // Block merchant transactions
    // Notify merchant
    // Trigger compliance review
  }

  /**
   * System event handlers
   */
  async handleProcessorHealth(data, metadata) {
    const { processor, healthy, error } = data;
    
    if (!healthy) {
      logger.error('Processor health issue', {
        processor,
        error,
      });
      
      // Alert operations team
      // Update routing to avoid unhealthy processor
      // Record metrics
    }
  }

  async handleSystemAlert(data, metadata) {
    const { severity, message, component } = data;
    
    logger[severity === 'critical' ? 'error' : 'warn']('System alert', {
      severity,
      message,
      component,
    });
    
    // Send to alerting system (PagerDuty, Slack, etc.)
    // Trigger automated response if needed
  }

  /**
   * Get handler statistics
   */
  getHandlerStats() {
    const stats = {
      totalHandlers: 0,
      byEventType: {},
    };
    
    for (const [eventType, handlers] of this.handlers) {
      stats.byEventType[eventType] = handlers.length;
      stats.totalHandlers += handlers.length;
    }
    
    return stats;
  }

  /**
   * List all registered event types
   */
  listEventTypes() {
    return Array.from(this.handlers.keys());
  }

  /**
   * Remove all handlers for an event type
   */
  clearHandlers(eventType) {
    const count = this.handlers.get(eventType)?.length || 0;
    this.handlers.delete(eventType);
    
    logger.info('Event handlers cleared', {
      eventType,
      removedCount: count,
    });
    
    return count;
  }

  /**
   * Process batch of events
   */
  async processBatch(events, options = {}) {
    const { maxConcurrent = 5, stopOnError = false } = options;
    const results = [];
    const errors = [];
    
    // Process events in batches
    for (let i = 0; i < events.length; i += maxConcurrent) {
      const batch = events.slice(i, i + maxConcurrent);
      
      const batchResults = await Promise.allSettled(
        batch.map(event => this.process(event))
      );
      
      batchResults.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          results.push(result.value);
        } else {
          errors.push({
            event: batch[index],
            error: result.reason,
          });
          
          if (stopOnError) {
            throw result.reason;
          }
        }
      });
      
      // Small delay between batches
      if (options.batchDelay) {
        await new Promise(resolve => setTimeout(resolve, options.batchDelay));
      }
    }
    
    return {
      total: events.length,
      succeeded: results.length,
      failed: errors.length,
      results,
      errors,
    };
  }

  /**
   * Validate event structure
   */
  validateEvent(event) {
    const required = ['type', 'data'];
    const missing = required.filter(field => !event[field]);
    
    if (missing.length > 0) {
      throw new Error(`Missing required event fields: ${missing.join(', ')}`);
    }
    
    // Validate type format
    if (!/^[a-z]+\.[a-z_]+$/.test(event.type)) {
      throw new Error(`Invalid event type format: ${event.type}`);
    }
    
    return true;
  }

  /**
   * Create event object
   */
  createEvent(type, data, metadata = {}) {
    const event = {
      type,
      data,
      metadata: {
        ...metadata,
        eventId: metadata.eventId || `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        timestamp: new Date().toISOString(),
        source: metadata.source || 'event_processor',
      },
    };
    
    this.validateEvent(event);
    return event;
  }
}

// Singleton instance
let instance = null;

function getEventProcessor() {
  if (!instance) {
    instance = new EventProcessor();
  }
  return instance;
}

module.exports = getEventProcessor();