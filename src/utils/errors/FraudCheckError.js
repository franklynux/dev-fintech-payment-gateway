const BaseError = require('./BaseError');

/**
 * Error for fraud check failures
 */
class FraudCheckError extends BaseError {
  constructor(message = 'Fraud check failed', details = null) {
    super('FraudCheckError', message, 400, true, details);
    
    // Ensure the prototype chain is correct
    Object.setPrototypeOf(this, FraudCheckError.prototype);
  }
  
  /**
   * Create fraud check error for high risk transaction
   */
  static highRisk(score, reasons = []) {
    return new FraudCheckError(
      'Transaction flagged as high risk',
      {
        score,
        reasons,
        threshold: 0.7, // Default threshold
        decision: 'decline',
      }
    );
  }
  
  /**
   * Create fraud check error for manual review required
   */
  static manualReviewRequired(score, reasons = []) {
    return new FraudCheckError(
      'Transaction requires manual review',
      {
        score,
        reasons,
        decision: 'review',
      }
    );
  }
  
  /**
   * Create fraud check error for fraud service unavailable
   */
  static serviceUnavailable() {
    return new FraudCheckError(
      'Fraud service temporarily unavailable',
      {
        decision: 'proceed_with_caution',
        reason: 'fraud_service_unavailable',
      }
    );
  }
}

module.exports = FraudCheckError;