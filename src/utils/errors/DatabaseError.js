const BaseError = require('./BaseError');

/**
 * Error for database operations
 */
class DatabaseError extends BaseError {
  constructor(message = 'Database error', details = null) {
    super('DatabaseError', message, 500, true, details);
    
    // Ensure the prototype chain is correct
    Object.setPrototypeOf(this, DatabaseError.prototype);
  }
  
  /**
   * Create database error for connection failure
   */
  static connectionFailed(error) {
    return new DatabaseError(
      'Database connection failed',
      {
        originalError: error.message,
        type: 'connection',
      }
    );
  }
  
  /**
   * Create database error for query failure
   */
  static queryFailed(error, query = null) {
    const details = {
      originalError: error.message,
      type: 'query',
    };
    
    if (query) {
      details.query = query;
    }
    
    return new DatabaseError(
      'Database query failed',
      details
    );
  }
  
  /**
   * Create database error for constraint violation
   */
  static constraintViolation(constraint, value = null) {
    return new DatabaseError(
      `Database constraint violation: ${constraint}`,
      {
        constraint,
        value,
        type: 'constraint',
      }
    );
  }
  
  /**
   * Create database error for transaction failure
   */
  static transactionFailed(error) {
    return new DatabaseError(
      'Database transaction failed',
      {
        originalError: error.message,
        type: 'transaction',
      }
    );
  }
}

module.exports = DatabaseError;