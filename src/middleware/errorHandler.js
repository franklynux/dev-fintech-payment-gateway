const logger = require('../utils/logger')();
const config = require('../config');
const errors = require('../utils/errors');

class ErrorHandlerMiddleware {
  /**
   * Global error handler
   */
  handler() {
    return (err, req, res, next) => {
      // Log the error
      this.logError(err, req);
      
      // Determine status code
      const statusCode = this.getStatusCode(err);
      
      // Build error response
      const errorResponse = this.buildErrorResponse(err, req);
      
      // Send response
      res.status(statusCode).json(errorResponse);
    };
  }
  
  /**
   * 404 Not Found handler
   */
  notFound() {
    return (req, res, next) => {
      const error = new errors.NotFoundError(`${req.method} ${req.url}`);
      next(error);
    };
  }
  
  /**
   * Log error with context
   */
  logError(err, req) {
    const errorContext = {
      requestId: req.requestId,
      correlationId: req.correlationId,
      merchantId: req.merchant?.id,
      userId: req.user?.id,
      path: req.path,
      method: req.method,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      error: err.message,
      stack: err.stack,
      name: err.name,
      statusCode: err.statusCode,
      code: err.code,
      details: err.details,
      validationErrors: err.validationErrors,
      timestamp: new Date().toISOString(),
    };
    
    // Log with appropriate level
    if (this.isOperationalError(err)) {
      logger.warn('Operational error', errorContext);
    } else {
      logger.error('Programmer error', errorContext);
      
      // For programmer errors in production, also alert
      if (config.server.env === 'production') {
        this.alertDevelopmentTeam(err, errorContext);
      }
    }
  }
  
  /**
   * Determine HTTP status code from error
   */
  getStatusCode(err) {
    // Check for known status codes
    if (err.statusCode) return err.statusCode;
    if (err.status) return err.status;
    
    // Map error types to status codes
    const errorMap = {
      ValidationError: 400,
      AuthenticationError: 401,
      AuthorizationError: 403,
      NotFoundError: 404,
      ConflictError: 409,
      RateLimitError: 429,
      ServiceUnavailableError: 503,
      PaymentError: 400,
      FraudCheckError: 400,
      ProcessorError: 502,
      WebhookVerificationError: 401,
      PciValidationError: 400,
      DatabaseError: 500,
      IdempotencyError: 400,
      TokenizationError: 400,
    };
    
    return errorMap[err.name] || 500;
  }
  
  /**
   * Build error response
   */
  buildErrorResponse(err, req) {
    const isProduction = config.server.env === 'production';
    const statusCode = this.getStatusCode(err);
    
    // Use error.toJSON() if available (from BaseError class)
    if (err.toJSON && typeof err.toJSON === 'function') {
      const response = err.toJSON();
      
      // Add request context
      response.requestId = req.requestId;
      response.correlationId = req.correlationId;
      response.timestamp = response.timestamp || new Date().toISOString();
      
      // Add stack trace in development
      if (!isProduction && err.stack) {
        response.stack = err.stack;
      }
      
      // Don't expose internal errors in production
      if (isProduction && statusCode >= 500) {
        response.message = 'Internal server error';
        if (response.details) {
          delete response.details;
        }
      }
      
      // PCI compliance: Ensure no sensitive data
      this.sanitizeErrorResponse(response);
      
      return response;
    }
    
    // Fallback for non-BaseError errors
    const response = {
      error: err.name || 'InternalServerError',
      message: err.message || 'An unexpected error occurred',
      statusCode,
      timestamp: new Date().toISOString(),
      requestId: req.requestId,
      correlationId: req.correlationId,
    };
    
    // Add details for validation errors
    if (err.details) {
      response.details = err.details;
    }
    
    if (err.validationErrors) {
      response.validationErrors = err.validationErrors;
    }
    
    // Add error code if present
    if (err.code) {
      response.code = err.code;
    }
    
    // Add stack trace in development
    if (!isProduction && err.stack) {
      response.stack = err.stack;
    }
    
    // Don't expose internal errors in production
    if (isProduction && statusCode >= 500) {
      response.message = 'Internal server error';
      delete response.details;
    }
    
    // PCI compliance: Ensure no sensitive data
    this.sanitizeErrorResponse(response);
    
    return response;
  }
  
  /**
   * Check if error is operational (expected)
   */
  isOperationalError(err) {
    const operationalErrors = [
      'ValidationError',
      'AuthenticationError',
      'AuthorizationError',
      'NotFoundError',
      'ConflictError',
      'RateLimitError',
      'ServiceUnavailableError',
      'PaymentError',
      'FraudCheckError',
      'ProcessorError',
      'WebhookVerificationError',
      'PciValidationError',
      'DatabaseError',
      'IdempotencyError',
      'TokenizationError',
    ];
    
    // Check if error is an instance of BaseError (has isOperational property)
    if (typeof err.isOperational !== 'undefined') {
      return err.isOperational;
    }
    
    return operationalErrors.includes(err.name) || 
           (err.statusCode && err.statusCode < 500);
  }
  
  /**
   * Sanitize error response for PCI compliance
   */
  sanitizeErrorResponse(response) {
    const sensitivePatterns = [
      /\b(?:\d[ -]*?){13,16}\b/g, // Credit card numbers
      /\b\d{3,4}\b/g, // CVV
      /^\d{3}-\d{2}-\d{4}$/g, // SSN
    ];
    
    const sanitizeString = (str) => {
      if (typeof str !== 'string') return str;
      
      let sanitized = str;
      sensitivePatterns.forEach(pattern => {
        sanitized = sanitized.replace(pattern, '[REDACTED]');
      });
      
      return sanitized;
    };
    
    // Sanitize message
    if (response.message) {
      response.message = sanitizeString(response.message);
    }
    
    // Sanitize details (if it's an array)
    if (response.details && Array.isArray(response.details)) {
      response.details = response.details.map(detail => {
        if (detail.message) {
          detail.message = sanitizeString(detail.message);
        }
        if (detail.value && typeof detail.value === 'string') {
          detail.value = sanitizeString(detail.value);
        }
        return detail;
      });
    }
    
    // Sanitize details (if it's an object)
    if (response.details && typeof response.details === 'object' && !Array.isArray(response.details)) {
      const sanitizedDetails = {};
      for (const [key, value] of Object.entries(response.details)) {
        if (typeof value === 'string') {
          sanitizedDetails[key] = sanitizeString(value);
        } else {
          sanitizedDetails[key] = value;
        }
      }
      response.details = sanitizedDetails;
    }
    
    // Remove stack trace in production
    if (config.server.env === 'production') {
      delete response.stack;
    }
  }
  
  /**
   * Alert development team for critical errors
   */
  alertDevelopmentTeam(err, context) {
    const alertData = {
      severity: 'CRITICAL',
      error: err.message,
      name: err.name,
      stack: err.stack,
      context: {
        path: context.path,
        method: context.method,
        merchantId: context.merchantId,
        timestamp: new Date().toISOString(),
      },
    };
    
    logger.error('CRITICAL ERROR ALERT', alertData);
    
    // Example integration with alerting services
    this.sendToAlertingSystem(alertData);
  }
  
  /**
   * Send alert to external alerting system
   */
  sendToAlertingSystem(alertData) {
    // Implement integration with your alerting system (PagerDuty, Slack, etc.)
    // This is a placeholder implementation
    
    const alertPayload = {
      title: `[${alertData.severity}] ${alertData.name} in Payment Gateway`,
      description: alertData.error,
      source: 'payment-gateway-proxy',
      severity: alertData.severity.toLowerCase(),
      timestamp: new Date().toISOString(),
      details: {
        stack: alertData.stack,
        context: alertData.context,
      },
    };
    
    // Example: Send to Slack
    if (process.env.SLACK_WEBHOOK_URL) {
      this.sendSlackAlert(alertPayload);
    }
    
    // Example: Send to PagerDuty
    if (process.env.PAGERDUTY_API_KEY) {
      this.sendPagerDutyAlert(alertPayload);
    }
  }
  
  /**
   * Send alert to Slack
   */
  sendSlackAlert(alertPayload) {
    // Implementation for Slack webhook
    const slackMessage = {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: `🚨 ${alertPayload.title}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Description:* ${alertPayload.description}\n*Severity:* ${alertPayload.severity}\n*Time:* ${alertPayload.timestamp}`,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Context:*\n\`\`\`${JSON.stringify(alertPayload.context, null, 2)}\`\`\``,
          },
        },
      ],
    };
    
    // In a real implementation, you would send this to Slack
    // fetch(process.env.SLACK_WEBHOOK_URL, {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(slackMessage),
    // });
    
    logger.info('Slack alert would be sent', slackMessage);
  }
  
  /**
   * Send alert to PagerDuty
   */
  sendPagerDutyAlert(alertPayload) {
    // Implementation for PagerDuty
    const pagerDutyPayload = {
      routing_key: process.env.PAGERDUTY_API_KEY,
      event_action: 'trigger',
      dedup_key: `payment-gateway-${alertPayload.timestamp}`,
      payload: {
        summary: alertPayload.title,
        source: alertPayload.source,
        severity: alertPayload.severity,
        timestamp: alertPayload.timestamp,
        custom_details: alertPayload.details,
      },
    };
    
    // In a real implementation:
    // fetch('https://events.pagerduty.com/v2/enqueue', {
    //   method: 'POST',
    //   headers: { 'Content-Type': 'application/json' },
    //   body: JSON.stringify(pagerDutyPayload),
    // });
    
    logger.info('PagerDuty alert would be sent', pagerDutyPayload);
  }
  
  /**
   * Catch async errors
   */
  catchAsync(fn) {
    return (req, res, next) => {
      Promise.resolve(fn(req, res, next)).catch(next);
    };
  }
  
  /**
   * Handle uncaught exceptions
   */
  handleUncaughtExceptions() {
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught Exception', {
        error: error.message,
        stack: error.stack,
        timestamp: new Date().toISOString(),
      });
      
      // Graceful shutdown in production
      if (config.server.env === 'production') {
        setTimeout(() => {
          logger.error('Forcing shutdown due to uncaught exception');
          process.exit(1);
        }, 1000);
      }
    });
  }
  
  /**
   * Handle unhandled promise rejections
   */
  handleUnhandledRejections() {
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled Rejection', {
        reason: reason.message || reason,
        stack: reason.stack,
        timestamp: new Date().toISOString(),
      });
      
      // In production, consider shutting down
      if (config.server.env === 'production') {
        this.alertDevelopmentTeam(reason, {
          type: 'unhandled_rejection',
          timestamp: new Date().toISOString(),
        });
      }
    });
  }
  
  /**
   * Graceful shutdown handler
   */
  gracefulShutdown(server) {
    return (signal) => {
      logger.info(`Received ${signal}, starting graceful shutdown`);
      
      // Close HTTP server
      server.close(() => {
        logger.info('HTTP server closed');
        
        // Close database connections
        this.closeDatabaseConnections();
        
        // Close Redis connections
        this.closeRedisConnections();
        
        // Close other connections
        this.closeOtherConnections();
        
        logger.info('Graceful shutdown completed');
        process.exit(0);
      });
      
      // Force shutdown after timeout
      setTimeout(() => {
        logger.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
      }, 10000);
    };
  }
  
  /**
   * Close database connections
   */
  async closeDatabaseConnections() {
    try {
      const { sequelize } = require('../config/database');
      if (sequelize) {
        await sequelize.close();
        logger.info('Database connections closed');
      }
    } catch (error) {
      logger.error('Error closing database connections', {
        error: error.message,
      });
    }
  }
  
  /**
   * Close Redis connections
   */
  async closeRedisConnections() {
    try {
      const redis = require('../config/redis');
      if (redis) {
        await redis.quit();
        logger.info('Redis connections closed');
      }
    } catch (error) {
      logger.error('Error closing Redis connections', {
        error: error.message,
      });
    }
  }
  
  /**
   * Close other connections
   */
  async closeOtherConnections() {
    // Close any other connections (AMQP, WebSocket, etc.)
    try {
      // Example: Close Bull queue connections
      const queues = require('../services/webhookService').webhookQueue;
      if (queues) {
        await queues.close();
        logger.info('Queue connections closed');
      }
    } catch (error) {
      logger.error('Error closing other connections', {
        error: error.message,
      });
    }
  }
  
  /**
   * Generate error from existing error
   */
  createErrorFromExisting(error, ErrorClass, message) {
    if (error instanceof ErrorClass) {
      return error;
    }
    
    return new ErrorClass(message || error.message, {
      originalError: error.message,
      stack: error.stack,
    });
  }
}

// Export singleton instance
const errorHandler = new ErrorHandlerMiddleware();

// Also export error classes for convenience (backward compatibility)
Object.assign(errorHandler, errors);

module.exports = errorHandler;