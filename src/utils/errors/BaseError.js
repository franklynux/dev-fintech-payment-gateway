/**
 * Base error class for all application errors
 */
class BaseError extends Error {
  constructor(name, message, statusCode, isOperational = true, details = null) {
    super(message);
    
    this.name = name;
    this.statusCode = statusCode;
    this.isOperational = isOperational; // Distinguishes operational errors from programmer errors
    this.details = details;
    this.timestamp = new Date().toISOString();
    
    // Capture stack trace
    Error.captureStackTrace(this, this.constructor);
    
    // Ensure the prototype chain is correct
    Object.setPrototypeOf(this, BaseError.prototype);
  }
  
  /**
   * Serialize error for API response
   */
  toJSON() {
    return {
      error: this.name,
      message: this.message,
      statusCode: this.statusCode,
      timestamp: this.timestamp,
      ...(this.details && { details: this.details }),
    };
  }
  
  /**
   * Create error from existing error
   */
  static fromError(error, name, statusCode) {
    const baseError = new BaseError(
      name,
      error.message,
      statusCode,
      true,
      error.details || null
    );
    
    // Preserve original stack
    baseError.stack = error.stack;
    baseError.originalError = error;
    
    return baseError;
  }
}

module.exports = BaseError;