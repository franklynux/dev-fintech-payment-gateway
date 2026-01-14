const BaseError = require('./BaseError');

/**
 * Error for resource not found
 */
class NotFoundError extends BaseError {
  constructor(resource = 'Resource', details = null) {
    const message = `${resource} not found`;
    super('NotFoundError', message, 404, true, details);
    
    // Ensure the prototype chain is correct
    Object.setPrototypeOf(this, NotFoundError.prototype);
  }
  
  /**
   * Create not found error for transaction
   */
  static transaction(transactionId) {
    return new NotFoundError(`Transaction ${transactionId}`);
  }
  
  /**
   * Create not found error for merchant
   */
  static merchant(merchantId) {
    return new NotFoundError(`Merchant ${merchantId}`);
  }
  
  /**
   * Create not found error for processor
   */
  static processor(processorName) {
    return new NotFoundError(`Processor ${processorName}`);
  }
}

module.exports = NotFoundError;