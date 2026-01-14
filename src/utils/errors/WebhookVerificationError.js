const BaseError = require('./BaseError');

/**
 * Error for webhook verification failures
 */
class WebhookVerificationError extends BaseError {
  constructor(message = 'Webhook verification failed', details = null) {
    super('WebhookVerificationError', message, 401, true, details);
    
    // Ensure the prototype chain is correct
    Object.setPrototypeOf(this, WebhookVerificationError.prototype);
  }
  
  /**
   * Create webhook verification error for Stripe
   */
  static stripe() {
    return new WebhookVerificationError(
      'Invalid Stripe webhook signature',
      { processor: 'stripe' }
    );
  }
  
  /**
   * Create webhook verification error for PayPal
   */
  static paypal() {
    return new WebhookVerificationError(
      'Invalid PayPal webhook signature',
      { processor: 'paypal' }
    );
  }
  
  /**
   * Create webhook verification error for generic webhook
   */
  static generic(processor) {
    return new WebhookVerificationError(
      `Invalid ${processor} webhook signature`,
      { processor }
    );
  }
  
  /**
   * Create webhook verification error for missing signature
   */
  static missingSignature() {
    return new WebhookVerificationError(
      'Webhook signature is required',
      { reason: 'missing_signature' }
    );
  }
}

module.exports = WebhookVerificationError;