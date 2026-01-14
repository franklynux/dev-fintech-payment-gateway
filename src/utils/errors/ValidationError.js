const BaseError = require('./BaseError');

/**
 * Error for validation failures
 */
class ValidationError extends BaseError {
  constructor(message = 'Validation failed', details = null) {
    super('ValidationError', message, 400, true, details);
    
    // Set validation errors if provided
    if (details && Array.isArray(details)) {
      this.validationErrors = details;
    }
    
    // Ensure the prototype chain is correct
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
  
  /**
   * Create validation error from Joi validation result
   */
  static fromJoi(validationResult) {
    const details = validationResult.error ? 
      validationResult.error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message,
        type: detail.type,
        value: detail.context?.value,
      })) : [];
    
    return new ValidationError(
      'Request validation failed',
      details
    );
  }
  
  /**
   * Create validation error for specific field
   */
  static forField(field, message, value = null) {
    return new ValidationError(message, [
      { field, message, value }
    ]);
  }
  
  /**
   * Check if error is a ValidationError
   */
  static isValidationError(error) {
    return error instanceof ValidationError || error.name === 'ValidationError';
  }
}

module.exports = ValidationError;