const BaseError = require('./BaseError');

/**
 * Error for service unavailability
 */
class ServiceUnavailableError extends BaseError {
  constructor(message = 'Service temporarily unavailable', details = null) {
    super('ServiceUnavailableError', message, 503, true, details);
    
    // Ensure the prototype chain is correct
    Object.setPrototypeOf(this, ServiceUnavailableError.prototype);
  }
  
  /**
   * Create service unavailable error for processor
   */
  static processor(processorName, estimatedRecovery = null) {
    const details = estimatedRecovery ? {
      processor: processorName,
      estimatedRecovery: estimatedRecovery.toISOString(),
    } : { processor: processorName };
    
    return new ServiceUnavailableError(
      `Payment processor ${processorName} is temporarily unavailable`,
      details
    );
  }
  
  /**
   * Create service unavailable error for external service
   */
  static externalService(serviceName) {
    return new ServiceUnavailableError(
      `${serviceName} is temporarily unavailable. Please try again later.`
    );
  }
  
  /**
   * Create service unavailable error with retry information
   */
  static withRetryInfo(retryAfter) {
    const details = {
      retryAfter,
      retryAfterSeconds: Math.ceil(retryAfter / 1000),
    };
    
    return new ServiceUnavailableError(
      'Service temporarily unavailable. Please retry.',
      details
    );
  }
}

module.exports = ServiceUnavailableError;