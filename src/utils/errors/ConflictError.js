const BaseError = require('./BaseError');

/**
 * Error for resource conflicts
 */
class ConflictError extends BaseError {
  constructor(message = 'Resource conflict', details = null) {
    super('ConflictError', message, 409, true, details);
    
    // Ensure the prototype chain is correct
    Object.setPrototypeOf(this, ConflictError.prototype);
  }
  
  /**
   * Create conflict error for duplicate resource
   */
  static duplicate(field, value) {
    return new ConflictError(
      `${field} '${value}' already exists`
    );
  }
  
  /**
   * Create conflict error for concurrent modification
   */
  static concurrentModification() {
    return new ConflictError(
      'Resource was modified concurrently. Please retry.'
    );
  }
  
  /**
   * Create conflict error for invalid state transition
   */
  static invalidStateTransition(currentState, targetState) {
    return new ConflictError(
      `Cannot transition from ${currentState} to ${targetState}`
    );
  }
}

module.exports = ConflictError;