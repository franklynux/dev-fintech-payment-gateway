const BaseError = require('./BaseError');

/**
 * Error for PCI DSS compliance violations
 */
class PciValidationError extends BaseError {
  constructor(message = 'PCI DSS compliance violation', details = null) {
    super('PciValidationError', message, 400, true, details);
    
    // Ensure the prototype chain is correct
    Object.setPrototypeOf(this, PciValidationError.prototype);
  }
  
  /**
   * Create PCI error for sensitive data in request
   */
  static sensitiveDataFound(sensitiveFields = []) {
    return new PciValidationError(
      'Sensitive data found in request. Use tokenization instead.',
      {
        sensitiveFields,
        violation: 'sensitive_data_in_request',
      }
    );
  }
  
  /**
   * Create PCI error for logging sensitive data
   */
  static sensitiveDataInLogs(violations = []) {
    return new PciValidationError(
      'Sensitive data detected in logs',
      {
        violations,
        violation: 'sensitive_data_in_logs',
      }
    );
  }
  
  /**
   * Create PCI error for missing encryption
   */
  static missingEncryption() {
    return new PciValidationError(
      'Encryption required for sensitive data',
      {
        violation: 'missing_encryption',
      }
    );
  }
  
  /**
   * Create PCI error for insecure transmission
   */
  static insecureTransmission() {
    return new PciValidationError(
      'Secure transmission (HTTPS) required',
      {
        violation: 'insecure_transmission',
      }
    );
  }
  
  /**
   * Create PCI error for merchant non-compliance
   */
  static merchantNotPciCompliant(merchantId) {
    return new PciValidationError(
      'Merchant is not PCI DSS compliant',
      {
        merchantId,
        violation: 'merchant_not_pci_compliant',
      }
    );
  }
}

module.exports = PciValidationError;