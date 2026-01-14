const Stripe = require('stripe');
const config = require('../../config');
const logger = require('../../utils/logger')();
const RetryManager = require('../../utils/retry');

class StripeProcessor {
  constructor() {
    this.stripe = Stripe(config.processors.stripe.secretKey);
    this.retryManager = new RetryManager({
      maxAttempts: 3,
      initialDelay: 1000,
      backoffFactor: 2,
    });
    this.name = 'stripe';
  }

  /**
   * Process a payment
   */
  async processPayment(paymentData) {
    const startTime = Date.now();
    
    try {
      let paymentIntent;
      
      if (paymentData.paymentMethodId) {
        // Using saved payment method
        paymentIntent = await this.createPaymentIntentWithMethod(paymentData);
      } else if (paymentData.setupIntent) {
        // Setting up payment method for future use
        paymentIntent = await this.createSetupIntent(paymentData);
      } else {
        // Regular payment
        paymentIntent = await this.createPaymentIntent(paymentData);
      }
      
      const duration = Date.now() - startTime;
      logger.info('Stripe payment processed', {
        paymentIntentId: paymentIntent.id,
        amount: paymentData.amount,
        currency: paymentData.currency,
        duration,
      });
      
      return {
        processor: this.name,
        transactionId: paymentIntent.id,
        status: this.mapStatus(paymentIntent.status),
        rawResponse: paymentIntent,
        requiresAction: paymentIntent.status === 'requires_action',
        clientSecret: paymentIntent.client_secret,
        nextAction: paymentIntent.next_action,
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('Stripe payment failed', {
        error: error.message,
        code: error.code,
        type: error.type,
        duration,
        amount: paymentData.amount,
        currency: paymentData.currency,
      });
      
      throw this.normalizeError(error);
    }
  }

  /**
   * Create a payment intent
   */
  async createPaymentIntent(paymentData) {
    const {
      amount,
      currency,
      description,
      metadata,
      customerId,
      paymentMethodId,
      captureMethod = 'automatic',
      confirm = true,
    } = paymentData;

    const params = {
      amount: this.convertToSmallestUnit(amount, currency),
      currency: currency.toLowerCase(),
      description,
      metadata: this.sanitizeMetadata(metadata),
      capture_method: captureMethod,
      confirm,
    };

    // Add customer if provided
    if (customerId) {
      params.customer = customerId;
    }

    // Add payment method if provided
    if (paymentMethodId) {
      params.payment_method = paymentMethodId;
    }

    // Add statement descriptor if needed
    if (paymentData.statementDescriptor) {
      params.statement_descriptor = paymentData.statementDescriptor.substring(0, 22);
    }

    // Add receipt email if provided
    if (paymentData.receiptEmail) {
      params.receipt_email = paymentData.receiptEmail;
    }

    // Add shipping if provided
    if (paymentData.shipping) {
      params.shipping = paymentData.shipping;
    }

    return this.retryManager.execute(
      () => this.stripe.paymentIntents.create(params),
      {
        operationName: 'stripe_create_payment_intent',
        context: { amount, currency },
      }
    );
  }

  /**
   * Create payment intent with payment method
   */
  async createPaymentIntentWithMethod(paymentData) {
    // First, create or retrieve customer
    let customerId = paymentData.customerId;
    
    if (!customerId && paymentData.customerEmail) {
      const customer = await this.findOrCreateCustomer({
        email: paymentData.customerEmail,
        name: paymentData.customerName,
      });
      customerId = customer.id;
    }

    // Attach payment method to customer
    if (customerId && paymentData.paymentMethodId) {
      await this.stripe.paymentMethods.attach(paymentData.paymentMethodId, {
        customer: customerId,
      });
    }

    // Create payment intent
    return this.createPaymentIntent({
      ...paymentData,
      customerId,
    });
  }

  /**
   * Create setup intent for saving payment methods
   */
  async createSetupIntent(paymentData) {
    const params = {
      payment_method_types: ['card'],
      metadata: this.sanitizeMetadata(paymentData.metadata),
    };

    if (paymentData.customerId) {
      params.customer = paymentData.customerId;
    }

    if (paymentData.paymentMethodId) {
      params.payment_method = paymentData.paymentMethodId;
    }

    return this.retryManager.execute(
      () => this.stripe.setupIntents.create(params),
      {
        operationName: 'stripe_create_setup_intent',
      }
    );
  }

  /**
   * Capture a payment
   */
  async capturePayment(paymentIntentId, amount = null) {
    const params = amount ? {
      amount_to_capture: this.convertToSmallestUnit(amount, 'usd'), // Currency would be known from original
    } : {};

    return this.retryManager.execute(
      () => this.stripe.paymentIntents.capture(paymentIntentId, params),
      {
        operationName: 'stripe_capture_payment',
        context: { paymentIntentId, amount },
      }
    );
  }

  /**
   * Refund a payment
   */
  async refundPayment(paymentIntentId, amount = null, reason = null) {
    const params = {
      payment_intent: paymentIntentId,
      reason,
    };

    if (amount) {
      params.amount = this.convertToSmallestUnit(amount, 'usd'); // Currency would be known from original
    }

    return this.retryManager.execute(
      () => this.stripe.refunds.create(params),
      {
        operationName: 'stripe_refund_payment',
        context: { paymentIntentId, amount, reason },
      }
    );
  }

  /**
   * Void a payment
   */
  async voidPayment(paymentIntentId) {
    return this.retryManager.execute(
      () => this.stripe.paymentIntents.cancel(paymentIntentId),
      {
        operationName: 'stripe_void_payment',
        context: { paymentIntentId },
      }
    );
  }

  /**
   * Retrieve a payment intent
   */
  async getPayment(paymentIntentId) {
    return this.retryManager.execute(
      () => this.stripe.paymentIntents.retrieve(paymentIntentId),
      {
        operationName: 'stripe_retrieve_payment',
        context: { paymentIntentId },
      }
    );
  }

  /**
   * List payments
   */
  async listPayments(options = {}) {
    const params = {
      limit: options.limit || 10,
    };

    if (options.startingAfter) {
      params.starting_after = options.startingAfter;
    }

    if (options.endingBefore) {
      params.ending_before = options.endingBefore;
    }

    return this.retryManager.execute(
      () => this.stripe.paymentIntents.list(params),
      {
        operationName: 'stripe_list_payments',
        context: { limit: params.limit },
      }
    );
  }

  /**
   * Create or retrieve customer
   */
  async findOrCreateCustomer(customerData) {
    const { email, name, phone, metadata } = customerData;
    
    // Try to find existing customer
    if (email) {
      const customers = await this.stripe.customers.list({
        email,
        limit: 1,
      });
      
      if (customers.data.length > 0) {
        return customers.data[0];
      }
    }
    
    // Create new customer
    const params = {};
    if (email) params.email = email;
    if (name) params.name = name;
    if (phone) params.phone = phone;
    if (metadata) params.metadata = metadata;
    
    return this.stripe.customers.create(params);
  }

  /**
   * Calculate fees for a transaction
   */
  async calculateFee(amount, currency) {
    // Stripe fees: 2.9% + $0.30 for US cards
    // This is simplified - in production, calculate based on actual card type, country, etc.
    const percentageFee = 0.029; // 2.9%
    const fixedFee = 0.30; // $0.30
    
    // Convert to USD for calculation (simplified)
    let amountInUSD = amount;
    if (currency !== 'USD') {
      // In production, use real exchange rate
      amountInUSD = amount * 0.85; // Example conversion
    }
    
    return (amountInUSD * percentageFee) + fixedFee;
  }

  /**
   * Verify webhook signature
   */
  verifyWebhookSignature(payload, signature) {
    try {
      const event = this.stripe.webhooks.constructEvent(
        payload,
        signature,
        config.processors.stripe.webhookSecret
      );
      return event;
    } catch (error) {
      throw new Error(`Stripe webhook verification failed: ${error.message}`);
    }
  }

  /**
   * Convert amount to smallest currency unit (cents for USD)
   */
  convertToSmallestUnit(amount, currency) {
    // Currencies with no decimal places
    const zeroDecimalCurrencies = ['JPY', 'KRW', 'VND', 'CLP', 'PYG', 'XAF', 'XOF', 'XPF'];
    
    if (zeroDecimalCurrencies.includes(currency.toUpperCase())) {
      return Math.round(amount);
    }
    
    return Math.round(amount * 100);
  }

  /**
   * Map Stripe status to internal status
   */
  mapStatus(stripeStatus) {
    const statusMap = {
      'requires_payment_method': 'pending',
      'requires_confirmation': 'pending',
      'requires_action': 'pending',
      'processing': 'processing',
      'requires_capture': 'authorized',
      'canceled': 'voided',
      'succeeded': 'succeeded',
    };
    
    return statusMap[stripeStatus] || stripeStatus;
  }

  /**
   * Normalize Stripe errors
   */
  normalizeError(stripeError) {
    const error = new Error(stripeError.message);
    error.name = 'ProcessorError';
    error.code = stripeError.code;
    error.type = stripeError.type;
    error.statusCode = this.getStatusCodeFromError(stripeError);
    error.originalError = stripeError;
    
    return error;
  }

  /**
   * Get HTTP status code from Stripe error
   */
  getStatusCodeFromError(stripeError) {
    const codeMap = {
      'card_error': 400,
      'invalid_request_error': 400,
      'api_error': 500,
      'authentication_error': 401,
      'rate_limit_error': 429,
    };
    
    return codeMap[stripeError.type] || 400;
  }

  /**
   * Sanitize metadata for Stripe (limited to 50 keys, 500 chars each)
   */
  sanitizeMetadata(metadata) {
    if (!metadata) return {};
    
    const sanitized = {};
    const keys = Object.keys(metadata).slice(0, 50); // Limit to 50 keys
    
    keys.forEach(key => {
      const value = String(metadata[key]);
      sanitized[key] = value.substring(0, 500); // Limit to 500 chars
    });
    
    return sanitized;
  }

  /**
   * Get processor capabilities
   */
  getCapabilities() {
    return {
      paymentMethods: ['card', 'bank_transfer', 'klarna', 'affirm'],
      currencies: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY', 'CNY'],
      countries: ['US', 'CA', 'GB', 'AU', 'JP', 'EU'],
      features: ['3ds', 'save_cards', 'subscriptions', 'invoicing'],
      settlementTime: '2-7 business days',
      minAmount: 0.50,
      maxAmount: 999999.99,
    };
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      await this.stripe.balance.retrieve();
      return {
        healthy: true,
        processor: this.name,
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      return {
        healthy: false,
        processor: this.name,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }
}

module.exports = StripeProcessor;