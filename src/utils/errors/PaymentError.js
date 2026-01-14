const BaseError = require('./BaseError');

/**
 * Error for payment processing failures
 */
class PaymentError extends BaseError {
  constructor(message = 'Payment processing failed', details = null) {
    super('PaymentError', message, 400, true, details);
    
    // Ensure the prototype chain is correct
    Object.setPrototypeOf(this, PaymentError.prototype);
  }
  
  /**
   * Create payment error for insufficient funds
   */
  static insufficientFunds() {
    return new PaymentError('Insufficient funds');
  }
  
  /**
   * Create payment error for card declined
   */
  static cardDeclined(reason = null) {
    const details = reason ? { declineReason: reason } : null;
    return new PaymentError('Card declined', details);
  }
  
  /**
   * Create payment error for expired card
   */
  static cardExpired() {
    return new PaymentError('Card has expired');
  }
  
  /**
   * Create payment error for invalid CVV
   */
  static invalidCvv() {
    return new PaymentError('Invalid CVV');
  }
  
  /**
   * Create payment error for invalid card number
   */
  static invalidCardNumber() {
    return new PaymentError('Invalid card number');
  }
  
  /**
   * Create payment error for amount limits
   */
  static amountLimit(min = null, max = null) {
    let message = 'Amount limit exceeded';
    const details = {};
    
    if (min !== null) {
      message = `Amount must be at least ${min}`;
      details.minAmount = min;
    }
    
    if (max !== null) {
      message = `Amount must not exceed ${max}`;
      details.maxAmount = max;
    }
    
    return new PaymentError(message, details);
  }
  
  /**
   * Create payment error for currency not supported
   */
  static currencyNotSupported(currency, supportedCurrencies = []) {
    return new PaymentError(
      `Currency ${currency} is not supported`,
      { supportedCurrencies }
    );
  }
  
  /**
   * Create payment error for 3DS authentication required
   */
  static threeDSRequired(redirectUrl = null) {
    const details = redirectUrl ? { redirectUrl } : null;
    return new PaymentError(
      '3D Secure authentication required',
      details
    );
  }
}

module.exports = PaymentError;