const BaseError = require('./BaseError');

/**
 * Error for idempotency key issues
 */
class IdempotencyError extends BaseError {
  constructor(message = 'Idempotency error', details = null) {
    super('IdempotencyError', message, 400, true, details);
    
    // Ensure the prototype chain is correct
    Object.setPrototypeOf(this, IdempotencyError.prototype);
  }
  
  /**
   * Create idempotency error for invalid key format
   */
  static invalidFormat() {
    return new IdempotencyError(
      'Invalid idempotency key format',
      {
        expectedFormat: 'Alphanumeric, dash, underscore, max 255 chars',
        violation: 'invalid_format',
      }
    );
  }
  
  /**
   * Create idempotency error for missing key
   */
  static missingKey() {
    return new IdempotencyError(
      'Idempotency key is required for this operation',
      { violation: 'missing_key' }
    );
  }
  
  /**
   * Create idempotency error for request in progress
   */
  static requestInProgress() {
    return new IdempotencyError(
      'Request with this idempotency key is already in progress',
      {
        violation: 'request_in_progress',
        retryAfter: 1000,
      }
    );
  }
  
  /**
   * Create idempotency error for stale key
   */
  static staleKey() {
    return new IdempotencyError(
      'Idempotency key has expired',
      {
        violation: 'stale_key',
        ttl: 86400, // 24 hours
      }
    );
  }
}

module.exports = IdempotencyError;