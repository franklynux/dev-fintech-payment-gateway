const BaseError = require('./BaseError');

/**
 * Error for tokenization failures
 */
class TokenizationError extends BaseError {
  constructor(message = 'Tokenization failed', details = null) {
    super('TokenizationError', message, 400, true, details);
    
    // Ensure the prototype chain is correct
    Object.setPrototypeOf(this, TokenizationError.prototype);
  }
  
  /**
   * Create tokenization error for invalid card data
   */
  static invalidCardData(error) {
    return new TokenizationError(
      'Invalid card data',
      {
        originalError: error.message,
        type: 'card_validation',
      }
    );
  }
  
  /**
   * Create tokenization error for invalid bank data
   */
  static invalidBankData(error) {
    return new TokenizationError(
      'Invalid bank account data',
      {
        originalError: error.message,
        type: 'bank_validation',
      }
    );
  }
  
  /**
   * Create tokenization error for encryption failure
   */
  static encryptionFailed() {
    return new TokenizationError(
      'Failed to encrypt sensitive data',
      {
        type: 'encryption',
      }
    );
  }
  
  /**
   * Create tokenization error for missing token
   */
  static tokenNotFound(token) {
    return new TokenizationError(
      'Token not found or has expired',
      {
        token,
        type: 'token_not_found',
      }
    );
  }
  
  /**
   * Create tokenization error for token reuse
   */
  static tokenReuse(token) {
    return new TokenizationError(
      'Token has already been used',
      {
        token,
        type: 'token_reuse',
      }
    );
  }
}

module.exports = TokenizationError;