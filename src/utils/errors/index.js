// Export all error classes
module.exports = {
  ValidationError: require('./ValidationError'),
  AuthenticationError: require('./AuthenticationError'),
  AuthorizationError: require('./AuthorizationError'),
  NotFoundError: require('./NotFoundError'),
  ConflictError: require('./ConflictError'),
  RateLimitError: require('./RateLimitError'),
  ServiceUnavailableError: require('./ServiceUnavailableError'),
  PaymentError: require('./PaymentError'),
  FraudCheckError: require('./FraudCheckError'),
  ProcessorError: require('./ProcessorError'),
  WebhookVerificationError: require('./WebhookVerificationError'),
  PciValidationError: require('./PciValidationError'),
  DatabaseError: require('./DatabaseError'),
  IdempotencyError: require('./IdempotencyError'),
  TokenizationError: require('./TokenizationError'),
};