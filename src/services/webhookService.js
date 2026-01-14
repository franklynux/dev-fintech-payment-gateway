const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const logger = require('../utils/logger')();
const Queue = require('bull');

class WebhookService {
  constructor() {
    this.webhookQueue = new Queue('webhook-processing', {
      redis: config.redis.url,
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
        removeOnComplete: 100,
        removeOnFail: 1000,
      },
    });

    this.processedEvents = new Set(); // In production, use Redis
    this.setupQueueProcessors();
  }

  /**
   * Setup queue processors
   */
  setupQueueProcessors() {
    // Process webhook events
    this.webhookQueue.process('process-webhook', async (job) => {
      const { event, merchantId, timestamp } = job.data;
      return this.processWebhookEvent(event, merchantId, timestamp);
    });

    // Retry failed webhooks
    this.webhookQueue.process('retry-webhook', async (job) => {
      const { event, attempts, lastError } = job.data;
      return this.retryWebhookEvent(event, attempts, lastError);
    });

    // Send merchant notifications
    this.webhookQueue.process('send-notification', async (job) => {
      const { merchantId, event, data } = job.data;
      return this.sendMerchantNotification(merchantId, event, data);
    });
  }

  /**
   * Verify Stripe webhook signature
   */
  verifyStripeWebhook(payload, signature, secret) {
    const stripe = require('stripe')(config.processors.stripe.secretKey);
    
    try {
      return stripe.webhooks.constructEvent(payload, signature, secret);
    } catch (error) {
      throw new Error(`Stripe webhook verification failed: ${error.message}`);
    }
  }

  /**
   * Verify PayPal webhook signature
   */
  async verifyPayPalWebhook(webhookEvent, headers) {
    // This is a simplified version
    // In production, implement full PayPal webhook verification
    const requiredHeaders = [
      'paypal-transmission-id',
      'paypal-transmission-sig',
      'paypal-transmission-time',
      'paypal-auth-algo',
      'paypal-cert-url',
    ];

    const missingHeaders = requiredHeaders.filter(header => !headers[header]);
    if (missingHeaders.length > 0) {
      throw new Error(`Missing PayPal webhook headers: ${missingHeaders.join(', ')}`);
    }

    // Note: Full verification requires API call to PayPal
    // For now, return the event
    return webhookEvent;
  }

  /**
   * Verify generic webhook signature
   */
  verifyGenericWebhook(payload, signature, secret) {
    const hmac = crypto.createHmac('sha256', secret);
    const computedSignature = `sha256=${hmac.update(payload).digest('hex')}`;
    
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(computedSignature)
    );
  }

  /**
   * Process incoming webhook
   */
  async processIncomingWebhook(source, payload, headers, merchantId = null) {
    const webhookId = uuidv4();
    const timestamp = new Date().toISOString();
    
    logger.info('Processing incoming webhook', {
      webhookId,
      source,
      merchantId,
      eventType: payload.type || payload.event_type,
    });

    try {
      // Verify webhook signature
      const verifiedEvent = await this.verifyWebhook(source, payload, headers, merchantId);
      
      // Check for duplicates
      const isDuplicate = await this.isDuplicateWebhook(verifiedEvent);
      if (isDuplicate) {
        logger.info('Duplicate webhook ignored', {
          webhookId,
          source,
          eventId: verifiedEvent.id,
        });
        return { processed: false, reason: 'duplicate' };
      }

      // Queue for processing
      await this.webhookQueue.add('process-webhook', {
        webhookId,
        event: verifiedEvent,
        source,
        merchantId,
        timestamp,
        headers: this.sanitizeHeaders(headers),
      }, {
        jobId: webhookId,
      });

      logger.info('Webhook queued for processing', {
        webhookId,
        source,
        eventId: verifiedEvent.id,
      });

      return { processed: true, webhookId };
    } catch (error) {
      logger.error('Webhook processing failed', {
        webhookId,
        source,
        error: error.message,
        headers: this.sanitizeHeaders(headers),
      });

      // Queue for retry if it's a transient error
      if (this.isTransientError(error)) {
        await this.webhookQueue.add('retry-webhook', {
          webhookId,
          event: payload,
          source,
          merchantId,
          error: error.message,
          timestamp,
        }, {
          delay: 60000, // Retry after 1 minute
          attempts: 3,
        });
      }

      throw error;
    }
  }

  /**
   * Process webhook event
   */
  async processWebhookEvent(event, merchantId, timestamp) {
    const eventId = event.id || crypto.randomBytes(16).toString('hex');
    
    try {
      // Parse event based on source
      const parsedEvent = this.parseWebhookEvent(event, merchantId);
      
      // Store event
      await this.storeWebhookEvent(eventId, parsedEvent);
      
      // Process based on event type
      await this.handleEventType(parsedEvent);
      
      // Send merchant notification if configured
      if (merchantId) {
        await this.sendMerchantWebhook(merchantId, parsedEvent);
      }
      
      // Mark as processed
      await this.markAsProcessed(eventId);
      
      logger.info('Webhook event processed successfully', {
        eventId,
        type: parsedEvent.type,
        merchantId,
      });
      
      return { success: true, eventId };
    } catch (error) {
      logger.error('Failed to process webhook event', {
        eventId,
        merchantId,
        error: error.message,
        eventType: event.type,
      });
      
      throw error;
    }
  }

  /**
   * Parse webhook event
   */
  parseWebhookEvent(event, merchantId) {
    const baseEvent = {
      id: event.id || crypto.randomBytes(16).toString('hex'),
      timestamp: new Date().toISOString(),
      merchantId,
      raw: event,
    };
    
    if (event.type) {
      // Stripe-style event
      return {
        ...baseEvent,
        type: event.type,
        data: event.data?.object || event.data,
        livemode: event.livemode,
        created: event.created ? new Date(event.created * 1000).toISOString() : baseEvent.timestamp,
      };
    } else if (event.event_type) {
      // PayPal-style event
      return {
        ...baseEvent,
        type: event.event_type,
        data: event.resource,
        summary: event.summary,
        links: event.links,
        created: event.create_time || baseEvent.timestamp,
      };
    } else {
      // Generic event
      return {
        ...baseEvent,
        type: event.event || 'unknown',
        data: event.data || event,
      };
    }
  }

  /**
   * Handle different event types
   */
  async handleEventType(event) {
    const eventHandlers = {
      // Payment events
      'payment_intent.succeeded': this.handlePaymentSuccess.bind(this),
      'payment_intent.payment_failed': this.handlePaymentFailure.bind(this),
      'charge.refunded': this.handleRefund.bind(this),
      'charge.dispute.created': this.handleDispute.bind(this),
      
      // Subscription events
      'customer.subscription.created': this.handleSubscriptionCreated.bind(this),
      'customer.subscription.updated': this.handleSubscriptionUpdated.bind(this),
      'customer.subscription.deleted': this.handleSubscriptionDeleted.bind(this),
      
      // Invoice events
      'invoice.paid': this.handleInvoicePaid.bind(this),
      'invoice.payment_failed': this.handleInvoicePaymentFailed.bind(this),
      
      // PayPal events
      'PAYMENT.CAPTURE.COMPLETED': this.handlePaymentSuccess.bind(this),
      'PAYMENT.CAPTURE.DENIED': this.handlePaymentFailure.bind(this),
      'PAYMENT.CAPTURE.REFUNDED': this.handleRefund.bind(this),
    };
    
    const handler = eventHandlers[event.type] || this.handleUnknownEvent.bind(this);
    return handler(event);
  }

  /**
   * Event handlers
   */
  async handlePaymentSuccess(event) {
    const transactionId = event.data.id;
    const amount = event.data.amount || event.data.amount_captured;
    const currency = event.data.currency;
    
    logger.info('Payment succeeded', {
      transactionId,
      amount,
      currency,
      eventId: event.id,
    });
    
    // Update transaction status in database
    // Notify relevant services
    // Trigger any post-payment workflows
  }

  async handlePaymentFailure(event) {
    const transactionId = event.data.id;
    const error = event.data.last_payment_error || event.data.failure_message;
    
    logger.warn('Payment failed', {
      transactionId,
      error,
      eventId: event.id,
    });
    
    // Update transaction status
    // Notify merchant
    // Trigger retry logic if applicable
  }

  async handleRefund(event) {
    const refundId = event.data.id;
    const transactionId = event.data.payment_intent || event.data.capture_id;
    const amount = event.data.amount;
    
    logger.info('Refund processed', {
      refundId,
      transactionId,
      amount,
      eventId: event.id,
    });
    
    // Update transaction with refund
    // Notify merchant
  }

  async handleDispute(event) {
    const disputeId = event.data.id;
    const transactionId = event.data.charge;
    const reason = event.data.reason;
    
    logger.warn('Dispute opened', {
      disputeId,
      transactionId,
      reason,
      eventId: event.id,
    });
    
    // Update transaction status
    // Notify merchant
    // Trigger dispute handling workflow
  }

  async handleUnknownEvent(event) {
    logger.info('Unknown webhook event type', {
      type: event.type,
      eventId: event.id,
      data: event.data,
    });
    
    // Store for later analysis
    // Alert if suspicious
  }

  /**
   * Send webhook to merchant
   */
  async sendMerchantWebhook(merchantId, event) {
    try {
      // Get merchant webhook configuration
      const merchantConfig = await this.getMerchantWebhookConfig(merchantId);
      
      if (!merchantConfig.webhookUrl) {
        return; // No webhook configured
      }
      
      // Prepare webhook payload
      const payload = {
        id: event.id,
        type: event.type,
        data: event.data,
        timestamp: event.timestamp,
        merchantId,
      };
      
      // Generate signature
      const signature = this.generateWebhookSignature(payload, merchantConfig.webhookSecret);
      
      // Send webhook
      const response = await fetch(merchantConfig.webhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Webhook-Signature': signature,
          'X-Webhook-Id': event.id,
          'X-Webhook-Timestamp': event.timestamp,
        },
        body: JSON.stringify(payload),
      });
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      logger.info('Merchant webhook sent successfully', {
        merchantId,
        eventId: event.id,
        status: response.status,
      });
    } catch (error) {
      logger.error('Failed to send merchant webhook', {
        merchantId,
        eventId: event.id,
        error: error.message,
      });
      
      // Retry with exponential backoff
      await this.retryMerchantWebhook(merchantId, event, error);
    }
  }

  /**
   * Generate webhook signature
   */
  generateWebhookSignature(payload, secret) {
    const hmac = crypto.createHmac('sha256', secret);
    return `sha256=${hmac.update(JSON.stringify(payload)).digest('hex')}`;
  }

  /**
   * Store webhook event
   */
  async storeWebhookEvent(eventId, event) {
    // In production, store in database
    // For now, log it
    logger.debug('Webhook event stored', {
      eventId,
      type: event.type,
      timestamp: event.timestamp,
    });
  }

  /**
   * Check for duplicate webhooks
   */
  async isDuplicateWebhook(event) {
    const eventId = event.id;
    
    // Check in-memory set (in production, use Redis or database)
    if (this.processedEvents.has(eventId)) {
      return true;
    }
    
    // Also check recent events in queue
    const jobs = await this.webhookQueue.getJobs(['waiting', 'active', 'delayed']);
    return jobs.some(job => job.data.event.id === eventId);
  }

  /**
   * Mark event as processed
   */
  async markAsProcessed(eventId) {
    this.processedEvents.add(eventId);
    
    // Cleanup old events (keep last 1000)
    if (this.processedEvents.size > 1000) {
      const oldest = Array.from(this.processedEvents).slice(0, this.processedEvents.size - 1000);
      oldest.forEach(id => this.processedEvents.delete(id));
    }
  }

  /**
   * Verify webhook based on source
   */
  async verifyWebhook(source, payload, headers, merchantId) {
    switch (source) {
      case 'stripe':
        return this.verifyStripeWebhook(
          JSON.stringify(payload),
          headers['stripe-signature'],
          config.processors.stripe.webhookSecret
        );
      
      case 'paypal':
        return this.verifyPayPalWebhook(payload, headers);
      
      default:
        // For merchant webhooks, use their secret
        if (merchantId) {
          const merchantConfig = await this.getMerchantWebhookConfig(merchantId);
          const isValid = this.verifyGenericWebhook(
            JSON.stringify(payload),
            headers['x-webhook-signature'],
            merchantConfig.webhookSecret
          );
          
          if (!isValid) {
            throw new Error('Invalid webhook signature');
          }
          
          return payload;
        }
        
        throw new Error(`Unknown webhook source: ${source}`);
    }
  }

  /**
   * Check if error is transient
   */
  isTransientError(error) {
    const transientErrors = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'EAI_AGAIN',
      'timeout',
      'network',
      'connection',
    ];
    
    const errorMessage = error.message.toLowerCase();
    return transientErrors.some(keyword => errorMessage.includes(keyword));
  }

  /**
   * Sanitize headers for logging
   */
  sanitizeHeaders(headers) {
    const sanitized = { ...headers };
    const sensitiveHeaders = ['authorization', 'stripe-signature', 'x-webhook-signature'];
    
    sensitiveHeaders.forEach(header => {
      if (sanitized[header]) {
        sanitized[header] = '[REDACTED]';
      }
    });
    
    return sanitized;
  }

  /**
   * Get merchant webhook configuration
   */
  async getMerchantWebhookConfig(merchantId) {
    // In production, fetch from database
    return {
      webhookUrl: process.env.MERCHANT_WEBHOOK_URL,
      webhookSecret: process.env.MERCHANT_WEBHOOK_SECRET,
      enabled: true,
      events: ['payment.succeeded', 'payment.failed', 'refund.processed'],
    };
  }

  /**
   * Get webhook statistics
   */
  async getWebhookStats() {
    const counts = await this.webhookQueue.getJobCounts();
    
    return {
      queue: 'webhook-processing',
      stats: counts,
      processedEvents: this.processedEvents.size,
      timestamp: new Date().toISOString(),
    };
  }
}

// Singleton instance
let instance = null;

function getWebhookService() {
  if (!instance) {
    instance = new WebhookService();
  }
  return instance;
}

module.exports = getWebhookService();