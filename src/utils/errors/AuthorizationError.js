const BaseError = require('./BaseError');

/**
 * Error for authorization failures
 */
class AuthorizationError extends BaseError {
  constructor(message = 'Insufficient permissions', details = null) {
    super('AuthorizationError', message, 403, true, details);
    
    // Ensure the prototype chain is correct
    Object.setPrototypeOf(this, AuthorizationError.prototype);
  }
  
  /**
   * Create authorization error for insufficient permissions
   */
  static insufficientPermissions(requiredPermission) {
    return new AuthorizationError(
      `Insufficient permissions. Required: ${requiredPermission}`
    );
  }
  
  /**
   * Create authorization error for resource ownership
   */
  static notResourceOwner() {
    return new AuthorizationError('You do not own this resource');
  }
  
  /**
   * Create authorization error for merchant status
   */
  static merchantInactive() {
    return new AuthorizationError('Merchant account is inactive');
  }
  
  /**
   * Create authorization error for PCI compliance
   */
  static pciComplianceRequired() {
    return new AuthorizationError('PCI DSS compliance required for this operation');
  }
}

module.exports = AuthorizationError;