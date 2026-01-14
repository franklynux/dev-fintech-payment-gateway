const BaseError = require('./BaseError');

/**
 * Error for payment processor failures
 */
class ProcessorError extends BaseError {
  constructor(message = 'Payment processor error', details = null) {
    super('ProcessorError', message, 502, true, details);
    
    // Ensure the prototype chain is correct
    Object.setPrototypeOf(this, ProcessorError.prototype);
  }
  
  /**
   * Create processor error from Stripe error
   */
  static fromStripe(stripeError) {
    const details = {
      code: stripeError.code,
      type: stripeError.type,
      param: stripeError.param,
      processor: 'stripe',
    };
    
    return new ProcessorError(
      stripeError.message || 'Stripe payment failed',
      details
    );
  }
  
  /**
   * Create processor error from PayPal error
   */
  static fromPayPal(paypalError) {
    const details = {
      processor: 'paypal',
      details: paypalError.details,
    };
    
    return new ProcessorError(
      paypalError.message || 'PayPal payment failed',
      details
    );
  }
  
  /**
   * Create processor error for timeout
   */
  static timeout(processorName, timeoutMs) {
    return new ProcessorError(
      `${processorName} request timed out after ${timeoutMs}ms`,
      {
        processor: processorName,
        timeout: timeoutMs,
        type: 'timeout',
      }
    );
  }
  
  /**
   * Create processor error for network failure
   */
  static networkError(processorName, errorCode) {
    return new ProcessorError(
      `Network error connecting to ${processorName}`,
      {
        processor: processorName,
        code: errorCode,
        type: 'network',
      }
    );
  }
  
  /**
   * Create processor error for configuration issue
   */
  static configuration(processorName, missingField) {
    return new ProcessorError(
      `${processorName} configuration error: Missing ${missingField}`,
      {
        processor: processorName,
        missing: missingField,
        type: 'configuration',
      }
    );
  }
}

module.exports = ProcessorError;