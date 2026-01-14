const BaseError = require('./BaseError');

/**
 * Error for authentication failures
 */
class AuthenticationError extends BaseError {
  constructor(message = 'Authentication required', details = null) {
    super('AuthenticationError', message, 401, true, details);
    
    // Ensure the prototype chain is correct
    Object.setPrototypeOf(this, AuthenticationError.prototype);
  }
  
  /**
   * Create authentication error for invalid credentials
   */
  static invalidCredentials() {
    return new AuthenticationError('Invalid credentials');
  }
  
  /**
   * Create authentication error for expired token
   */
  static tokenExpired() {
    return new AuthenticationError('Token has expired');
  }
  
  /**
   * Create authentication error for missing token
   */
  static missingToken() {
    return new AuthenticationError('Authentication token is required');
  }
}

module.exports = AuthenticationError;