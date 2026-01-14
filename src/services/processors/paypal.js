const paypal = require('@paypal/checkout-server-sdk');
const config = require('../../config');
const logger = require('../../utils/logger')();
const RetryManager = require('../../utils/retry');

class PayPalProcessor {
  constructor() {
    this.environment = this.createEnvironment();
    this.client = new paypal.core.PayPalHttpClient(this.environment);
    this.retryManager = new RetryManager({
      maxAttempts: 3,
      initialDelay: 1000,
      backoffFactor: 2,
    });
    this.name = 'paypal';
  }

  /**
   * Create PayPal environment
   */
  createEnvironment() {
    const { clientId, clientSecret, environment } = config.processors.paypal;
    
    if (environment === 'production') {
      return new paypal.core.LiveEnvironment(clientId, clientSecret);
    } else {
      return new paypal.core.SandboxEnvironment(clientId, clientSecret);
    }
  }

  /**
   * Process a payment
   */
  async processPayment(paymentData) {
    const startTime = Date.now();
    
    try {
      let order;
      
      if (paymentData.orderId) {
        // Capture existing order
        order = await this.captureOrder(paymentData.orderId);
      } else {
        // Create new order
        order = await this.createOrder(paymentData);
      }
      
      const duration = Date.now() - startTime;
      logger.info('PayPal payment processed', {
        orderId: order.id,
        amount: paymentData.amount,
        currency: paymentData.currency,
        duration,
      });
      
      return {
        processor: this.name,
        transactionId: order.id,
        status: this.mapStatus(order.status),
        rawResponse: order,
        approvalUrl: this.getApprovalUrl(order),
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error('PayPal payment failed', {
        error: error.message,
        details: error.details,
        duration,
        amount: paymentData.amount,
        currency: paymentData.currency,
      });
      
      throw this.normalizeError(error);
    }
  }

  /**
   * Create an order
   */
  async createOrder(paymentData) {
    const {
      amount,
      currency,
      description,
      returnUrl,
      cancelUrl,
      items,
      shipping,
    } = paymentData;

    const request = new paypal.orders.OrdersCreateRequest();
    
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: currency,
          value: amount.toString(),
          breakdown: this.createBreakdown(paymentData),
        },
        description,
        items: this.createItems(items),
        shipping: shipping ? {
          address: {
            address_line_1: shipping.line1,
            address_line_2: shipping.line2,
            admin_area_2: shipping.city,
            admin_area_1: shipping.state,
            postal_code: shipping.postalCode,
            country_code: shipping.country,
          },
        } : undefined,
      }],
      application_context: {
        brand_name: paymentData.brandName,
        locale: paymentData.locale || 'en-US',
        landing_page: paymentData.landingPage || 'NO_PREFERENCE',
        user_action: paymentData.userAction || 'PAY_NOW',
        return_url: returnUrl,
        cancel_url: cancelUrl,
        shipping_preference: shipping ? 'SET_PROVIDED_ADDRESS' : 'NO_SHIPPING',
      },
    });

    return this.retryManager.execute(
      () => this.client.execute(request),
      {
        operationName: 'paypal_create_order',
        context: { amount, currency },
      }
    ).then(response => response.result);
  }

  /**
   * Capture an order
   */
  async captureOrder(orderId) {
    const request = new paypal.orders.OrdersCaptureRequest(orderId);
    
    return this.retryManager.execute(
      () => this.client.execute(request),
      {
        operationName: 'paypal_capture_order',
        context: { orderId },
      }
    ).then(response => response.result);
  }

  /**
   * Get order details
   */
  async getOrder(orderId) {
    const request = new paypal.orders.OrdersGetRequest(orderId);
    
    return this.retryManager.execute(
      () => this.client.execute(request),
      {
        operationName: 'paypal_get_order',
        context: { orderId },
      }
    ).then(response => response.result);
  }

  /**
   * Refund a payment
   */
  async refundPayment(captureId, amount = null, reason = null) {
    const request = new paypal.payments.CapturesRefundRequest(captureId);
    
    request.requestBody({
      amount: amount ? {
        value: amount.toString(),
        currency_code: 'USD', // Should come from original payment
      } : undefined,
      note_to_payer: reason,
    });

    return this.retryManager.execute(
      () => this.client.execute(request),
      {
        operationName: 'paypal_refund',
        context: { captureId, amount, reason },
      }
    ).then(response => response.result);
  }

  /**
   * Authorize an order (for delayed capture)
   */
  async authorizeOrder(orderId) {
    const request = new paypal.orders.OrdersAuthorizeRequest(orderId);
    request.requestBody({});
    
    return this.retryManager.execute(
      () => this.client.execute(request),
      {
        operationName: 'paypal_authorize_order',
        context: { orderId },
      }
    ).then(response => response.result);
  }

  /**
   * Void an authorized payment
   */
  async voidPayment(authorizationId) {
    const request = new paypal.payments.AuthorizationsVoidRequest(authorizationId);
    
    return this.retryManager.execute(
      () => this.client.execute(request),
      {
        operationName: 'paypal_void_authorization',
        context: { authorizationId },
      }
    ).then(response => response.result);
  }

  /**
   * Create payment breakdown
   */
  createBreakdown(paymentData) {
    const breakdown = {
      item_total: {
        currency_code: paymentData.currency,
        value: paymentData.amount.toString(),
      },
    };

    if (paymentData.tax) {
      breakdown.tax_total = {
        currency_code: paymentData.currency,
        value: paymentData.tax.toString(),
      };
    }

    if (paymentData.shippingCost) {
      breakdown.shipping = {
        currency_code: paymentData.currency,
        value: paymentData.shippingCost.toString(),
      };
    }

    if (paymentData.discount) {
      breakdown.discount = {
        currency_code: paymentData.currency,
        value: paymentData.discount.toString(),
      };
    }

    if (paymentData.handling) {
      breakdown.handling = {
        currency_code: paymentData.currency,
        value: paymentData.handling.toString(),
      };
    }

    if (paymentData.insurance) {
      breakdown.insurance = {
        currency_code: paymentData.currency,
        value: paymentData.insurance.toString(),
      };
    }

    if (paymentData.shippingDiscount) {
      breakdown.shipping_discount = {
        currency_code: paymentData.currency,
        value: paymentData.shippingDiscount.toString(),
      };
    }

    return breakdown;
  }

  /**
   * Create items array
   */
  createItems(items) {
    if (!items) return undefined;
    
    return items.map(item => ({
      name: item.name,
      description: item.description,
      sku: item.sku,
      quantity: item.quantity.toString(),
      category: item.category || 'PHYSICAL_GOODS',
      unit_amount: {
        currency_code: item.currency || 'USD',
        value: item.price.toString(),
      },
      tax: item.tax ? {
        currency_code: item.currency || 'USD',
        value: item.tax.toString(),
      } : undefined,
    }));
  }

  /**
   * Get approval URL from order
   */
  getApprovalUrl(order) {
    const link = order.links?.find(link => link.rel === 'approve');
    return link ? link.href : null;
  }

  /**
   * Calculate fees for a transaction
   */
  async calculateFee(amount, currency) {
    // PayPal fees: 2.9% + $0.30 for domestic, 4.4% + fixed fee for international
    // This is simplified
    
    const isDomestic = currency === 'USD';
    const percentageFee = isDomestic ? 0.029 : 0.044;
    const fixedFee = isDomestic ? 0.30 : 0.30; // Simplified
    
    return (amount * percentageFee) + fixedFee;
  }

  /**
   * Verify webhook signature
   */
  async verifyWebhookSignature(webhookData, headers) {
    const request = new paypal.notifications.WebhooksVerifySignatureRequest();
    
    request.requestBody({
      transmission_id: headers['paypal-transmission-id'],
      transmission_time: headers['paypal-transmission-time'],
      cert_url: headers['paypal-cert-url'],
      auth_algo: headers['paypal-auth-algo'],
      transmission_sig: headers['paypal-transmission-sig'],
      webhook_id: config.processors.paypal.webhookId,
      webhook_event: webhookData,
    });

    try {
      const response = await this.client.execute(request);
      return response.result.verification_status === 'SUCCESS';
    } catch (error) {
      throw new Error(`PayPal webhook verification failed: ${error.message}`);
    }
  }

  /**
   * Map PayPal status to internal status
   */
  mapStatus(paypalStatus) {
    const statusMap = {
      'CREATED': 'pending',
      'SAVED': 'pending',
      'APPROVED': 'pending',
      'VOIDED': 'voided',
      'COMPLETED': 'succeeded',
      'PAYER_ACTION_REQUIRED': 'pending',
    };
    
    return statusMap[paypalStatus] || paypalStatus;
  }

  /**
   * Normalize PayPal errors
   */
  normalizeError(paypalError) {
    const error = new Error(paypalError.message || 'PayPal API error');
    error.name = 'ProcessorError';
    error.details = paypalError.details;
    error.statusCode = paypalError.statusCode || 400;
    error.originalError = paypalError;
    
    return error;
  }

  /**
   * Get processor capabilities
   */
  getCapabilities() {
    return {
      paymentMethods: ['paypal', 'paypal_credit', 'card', 'venmo'],
      currencies: ['USD', 'EUR', 'GBP', 'CAD', 'AUD', 'JPY'],
      countries: ['US', 'CA', 'GB', 'AU', 'JP', 'EU'],
      features: ['smart_buttons', 'subscriptions', 'billing_plans', 'payouts'],
      settlementTime: '1-2 business days',
      minAmount: 1.00,
      maxAmount: 100000.00,
    };
  }

  /**
   * Health check
   */
  async healthCheck() {
    try {
      // Simple API call to check connectivity
      const request = new paypal.orders.OrdersGetRequest('dummy');
      await this.client.execute(request);
      
      return {
        healthy: false, // Should fail with 404, not error
        processor: this.name,
        error: 'Unexpected response',
        timestamp: new Date().toISOString(),
      };
    } catch (error) {
      // We expect an error for invalid order ID
      if (error.statusCode === 404) {
        return {
          healthy: true,
          processor: this.name,
          timestamp: new Date().toISOString(),
        };
      }
      
      return {
        healthy: false,
        processor: this.name,
        error: error.message,
        timestamp: new Date().toISOString(),
      };
    }
  }

  /**
   * Generate client token for frontend
   */
  async generateClientToken() {
    // This would be implemented for client-side integration
    throw new Error('Not implemented - use PayPal JS SDK on frontend');
  }

  /**
   * Create billing agreement for subscriptions
   */
  async createBillingAgreement(agreementData) {
    const request = new paypal.billingAgreements.AgreementsCreateRequest();
    
    request.requestBody({
      name: agreementData.name,
      description: agreementData.description,
      start_date: new Date(Date.now() + 3600000).toISOString(), // 1 hour from now
      payer: {
        payment_method: 'PAYPAL',
      },
      plan: {
        type: 'MERCHANT_INITIATED_BILLING',
        merchant_preferences: {
          return_url: agreementData.returnUrl,
          cancel_url: agreementData.cancelUrl,
          auto_bill_amount: 'YES',
          initial_fail_amount_action: 'CONTINUE',
          max_fail_attempts: '3',
        },
      },
    });

    return this.retryManager.execute(
      () => this.client.execute(request),
      {
        operationName: 'paypal_create_billing_agreement',
      }
    ).then(response => response.result);
  }
}

module.exports = PayPalProcessor;