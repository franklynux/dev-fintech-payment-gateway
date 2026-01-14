const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');
const ValidationError = require('../utils/errors/ValidationError');

class WebhookController {
  constructor({ webhookService, eventProcessor }) {
    this.webhookService = webhookService;
    this.eventProcessor = eventProcessor;
  }

  async handleStripeWebhook(req, res, next) {
    const signature = req.headers['stripe-signature'];
    const rawBody = req.body.toString(); // Stripe requires raw body
    
    try {
      // Verify webhook signature
      const event = this.webhookService.verifyStripeSignature(
        rawBody,
        signature,
        config.processors.stripe.webhookSecret
      );

      // Process the event asynchronously
      await this.processWebhookEvent('stripe', event);

      // Acknowledge receipt immediately
      res.status(200).json({ received: true });
    } catch (error) {
      logger.error('Stripe webhook verification failed', {
        error: error.message,
        signature,
      });
      res.status(400).json({ error: 'Invalid signature' });
    }
  }

  async handlePayPalWebhook(req, res, next) {
    const signature = req.headers['paypal-transmission-sig'];
    const transmissionId = req.headers['paypal-transmission-id'];
    const timestamp = req.headers['paypal-transmission-time'];
    
    try {
      const event = await this.webhookService.verifyPayPalWebhook(
        req.body,
        signature,
        transmissionId,
        timestamp,
        config.processors.paypal.clientId
      );

      await this.processWebhookEvent('paypal', event);
      res.status(200).json({ received: true });
    } catch (error) {
      logger.error('PayPal webhook verification failed', {
        error: error.message,
        transmissionId,
      });
      res.status(400).json({ error: 'Invalid webhook' });
    }
  }

  async handleGenericWebhook(req, res, next) {
    const processor = req.params.processor;
    const webhookId = req.headers['webhook-id'];
    
    try {
      const event = await this.webhookService.verifyGenericWebhook(
        processor,
        req.body,
        req.headers
      );

      await this.processWebhookEvent(processor, event);
      res.status(200).json({ received: true });
    } catch (error) {
      logger.error(`${processor} webhook processing failed`, {
        processor,
        webhookId,
        error: error.message,
      });
      res.status(400).json({ error: 'Webhook processing failed' });
    }
  }

  async handleInternalWebhook(req, res, next) {
    // For internal service communications (e.g., fraud service updates)
    const authToken = req.headers['x-internal-token'];
    
    try {
      // Verify internal token
      if (authToken !== process.env.INTERNAL_WEBHOOK_TOKEN) {
        throw new ValidationError('Invalid internal token');
      }

      const { event, data } = req.body;
      
      switch (event) {
        case 'fraud_update':
          await this.eventProcessor.handleFraudUpdate(data);
          break;
        case 'transaction_update':
          await this.eventProcessor.handleTransactionUpdate(data);
          break;
        case 'merchant_update':
          await this.eventProcessor.handleMerchantUpdate(data);
          break;
        default:
          logger.warn('Unknown internal webhook event', { event });
      }

      res.status(200).json({ processed: true });
    } catch (error) {
      logger.error('Internal webhook processing failed', {
        error: error.message,
        event: req.body?.event,
      });
      next(error);
    }
  }

  // Helper Methods
  async processWebhookEvent(source, event) {
    const eventId = event.id || crypto.randomBytes(16).toString('hex');
    const processingId = `webhook_${eventId}`;

    logger.info('Processing webhook event', {
      source,
      eventId,
      type: event.type,
      processingId,
    });

    try {
      // Store webhook for idempotency
      const isDuplicate = await this.webhookService.isDuplicate(eventId);
      if (isDuplicate) {
        logger.info('Duplicate webhook event, skipping', { eventId, source });
        return;
      }

      // Parse and validate event data
      const parsedEvent = this.parseWebhookEvent(source, event);

      // Process based on event type
      switch (parsedEvent.type) {
        case 'payment_succeeded':
          await this.eventProcessor.handlePaymentSuccess(parsedEvent);
          break;
        case 'payment_failed':
          await this.eventProcessor.handlePaymentFailure(parsedEvent);
          break;
        case 'refund_processed':
          await this.eventProcessor.handleRefund(parsedEvent);
          break;
        case 'dispute_opened':
          await this.eventProcessor.handleDispute(parsedEvent);
          break;
        case 'subscription_updated':
          await this.eventProcessor.handleSubscriptionUpdate(parsedEvent);
          break;
        default:
          logger.info('Unhandled webhook event type', {
            type: parsedEvent.type,
            source,
            eventId,
          });
      }

      // Mark as processed
      await this.webhookService.markAsProcessed(eventId, parsedEvent);

      logger.info('Webhook event processed successfully', {
        eventId,
        source,
        type: parsedEvent.type,
        processingId,
      });

    } catch (error) {
      logger.error('Failed to process webhook event', {
        eventId,
        source,
        type: event.type,
        error: error.message,
        stack: error.stack,
      });

      // Queue for retry
      await this.webhookService.queueForRetry(eventId, event, error);
      throw error;
    }
  }

  parseWebhookEvent(source, rawEvent) {
    const parsers = {
      stripe: this.parseStripeEvent.bind(this),
      paypal: this.parsePayPalEvent.bind(this),
    };

    const parser = parsers[source] || this.parseGenericEvent.bind(this);
    return parser(rawEvent);
  }

  parseStripeEvent(stripeEvent) {
    return {
      id: stripeEvent.id,
      type: stripeEvent.type,
      created: new Date(stripeEvent.created * 1000).toISOString(),
      data: stripeEvent.data.object,
      livemode: stripeEvent.livemode,
      pendingWebhooks: stripeEvent.pending_webhooks,
      requestId: stripeEvent.request?.id,
      source: 'stripe',
    };
  }

  parsePayPalEvent(paypalEvent) {
    return {
      id: paypalEvent.id,
      type: paypalEvent.event_type,
      created: paypalEvent.create_time,
      data: paypalEvent.resource,
      summary: paypalEvent.summary,
      links: paypalEvent.links,
      source: 'paypal',
    };
  }

  parseGenericEvent(genericEvent) {
    return {
      id: genericEvent.id || crypto.randomBytes(16).toString('hex'),
      type: genericEvent.type || 'unknown',
      created: genericEvent.timestamp || new Date().toISOString(),
      data: genericEvent.data || genericEvent,
      source: genericEvent.source || 'unknown',
    };
  }
}

module.exports = WebhookController;