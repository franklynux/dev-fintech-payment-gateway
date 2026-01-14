const BaseError = require('./BaseError');

/**
 * Error for rate limiting
 */
class RateLimitError extends BaseError {
  constructor(message = 'Rate limit exceeded', details = null) {
    super('RateLimitError', message, 429, true, details);
    
    // Ensure the prototype chain is correct
    Object.setPrototypeOf(this, RateLimitError.prototype);
  }
  
  /**
   * Create rate limit error with retry information
   */
  static withRetryAfter(retryAfter) {
    const details = {
      retryAfter,
      retryAfterSeconds: Math.ceil(retryAfter / 1000),
    };
    
    const error = new RateLimitError(
      'Rate limit exceeded. Please try again later.',
      details
    );
    
    // Set retry headers
    error.retryAfter = retryAfter;
    
    return error;
  }
  
  /**
   * Create rate limit error for specific endpoint
   */
  static forEndpoint(endpoint, limit, window) {
    return new RateLimitError(
      `Rate limit exceeded for ${endpoint}. Limit: ${limit} requests per ${window}`
    );
  }
}

module.exports = RateLimitError;