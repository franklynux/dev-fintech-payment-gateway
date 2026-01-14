const logger = require('../utils/logger')();
const { v4: uuidv4 } = require('uuid');

class LoggingMiddleware {
  /**
   * Request logger middleware
   */
  requestLogger() {
    return (req, res, next) => {
      const requestId = req.headers['x-request-id'] || uuidv4();
      const startTime = Date.now();
      
      // Add request ID to request and response
      req.requestId = requestId;
      res.setHeader('X-Request-ID', requestId);
      
      // Create request-specific logger
      req.log = logger.child({
        requestId,
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        merchantId: req.merchant?.id,
      });
      
      // Log request start
      req.log.info('Request started', {
        body: this.sanitizeBody(req.body),
        query: req.query,
        params: req.params,
      });
      
      // Capture original response methods
      const originalSend = res.send;
      const originalJson = res.json;
      const originalEnd = res.end;
      
      // Override response methods to log response
      res.send = function(body) {
        logResponse.call(this, body, 'send');
        return originalSend.call(this, body);
      };
      
      res.json = function(body) {
        logResponse.call(this, body, 'json');
        return originalJson.call(this, body);
      };
      
      res.end = function(chunk, encoding) {
        logResponse.call(this, chunk, 'end');
        return originalEnd.call(this, chunk, encoding);
      };
      
      function logResponse(body, method) {
        const duration = Date.now() - startTime;
        const responseSize = Buffer.byteLength(
          typeof body === 'string' ? body : JSON.stringify(body || ''),
          'utf8'
        );
        
        const logData = {
          statusCode: res.statusCode,
          duration,
          responseSize,
          contentType: res.get('Content-Type'),
        };
        
        // Log based on status code
        if (res.statusCode >= 400) {
          req.log.error('Request failed', logData);
        } else if (res.statusCode >= 300) {
          req.log.warn('Request redirected', logData);
        } else {
          req.log.info('Request completed', logData);
        }
        
        // Add to response headers
        res.setHeader('X-Response-Time', `${duration}ms`);
        res.setHeader('X-Response-Size', responseSize);
      }
      
      // Log uncaught errors
      res.on('finish', () => {
        // Already logged by overridden methods
      });
      
      next();
    };
  }
  
  /**
   * Audit logger for sensitive operations
   */
  auditLogger(category) {
    return (req, res, next) => {
      const oldBody = JSON.stringify(req.body);
      const oldParams = JSON.stringify(req.params);
      
      // Capture the response
      res.on('finish', () => {
        const auditData = {
          category,
          action: req.method,
          path: req.path,
          merchantId: req.merchant?.id,
          userId: req.user?.id,
          statusCode: res.statusCode,
          requestBody: this.sanitizeBody(JSON.parse(oldBody)),
          requestParams: JSON.parse(oldParams),
          responseTime: Date.now(),
          ipAddress: req.ip,
          userAgent: req.get('User-Agent'),
        };
        
        logger.audit(`${category}.${req.method}`, req.user, {
          type: 'request',
          id: req.requestId,
        }, auditData);
      });
      
      next();
    };
  }
  
  /**
   * Performance monitoring middleware
   */
  performanceMonitor() {
    return (req, res, next) => {
      const startTime = Date.now();
      const operationName = `${req.method}_${req.path.replace(/[^a-zA-Z0-9]/g, '_')}`;
      
      res.on('finish', () => {
        const duration = Date.now() - startTime;
        logger.performance(operationName, duration, {
          statusCode: res.statusCode,
          merchantId: req.merchant?.id,
        });
        
        // Log slow requests
        if (duration > 1000) {
          logger.warn('Slow request detected', {
            operation: operationName,
            duration,
            path: req.path,
            method: req.method,
          });
        }
      });
      
      next();
    };
  }
  
  /**
   * Business event logger
   */
  businessEventLogger(eventType, getEntity) {
    return (req, res, next) => {
      const oldSend = res.send;
      
      res.send = function(body) {
        try {
          if (res.statusCode < 400) {
            const entity = getEntity ? getEntity(req, JSON.parse(body)) : null;
            logger.businessEvent(eventType, entity, {
              requestId: req.requestId,
              merchantId: req.merchant?.id,
              userId: req.user?.id,
              metadata: req.body?.metadata,
            });
          }
        } catch (error) {
          logger.error('Failed to log business event', {
            eventType,
            error: error.message,
          });
        }
        
        return oldSend.call(this, body);
      };
      
      next();
    };
  }
  
  /**
   * Error logger middleware
   */
  errorLogger() {
    return (err, req, res, next) => {
      const errorData = {
        requestId: req.requestId,
        error: err.message,
        stack: err.stack,
        statusCode: err.statusCode || 500,
        name: err.name,
        merchantId: req.merchant?.id,
        userId: req.user?.id,
        path: req.path,
        method: req.method,
        body: this.sanitizeBody(req.body),
        query: req.query,
        params: req.params,
      };
      
      // Log error with appropriate level
      if (err.statusCode >= 500) {
        logger.error('Server error', errorData);
      } else if (err.statusCode >= 400) {
        logger.warn('Client error', errorData);
      } else {
        logger.info('Error', errorData);
      }
      
      next(err);
    };
  }
  
  /**
   * Security event logger
   */
  securityLogger() {
    return (req, res, next) => {
      // Check for suspicious patterns
      this.detectSuspiciousActivity(req);
      
      res.on('finish', () => {
        // Log authentication failures
        if (res.statusCode === 401 || res.statusCode === 403) {
          logger.warn('Authentication/Authorization failure', {
            path: req.path,
            method: req.method,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            statusCode: res.statusCode,
            merchantId: req.merchant?.id,
          });
        }
        
        // Log high-value transactions
        if (req.path.includes('/payments/process') && res.statusCode === 200) {
          const amount = req.body?.amount;
          if (amount && amount > 10000) {
            logger.info('High-value transaction', {
              amount,
              currency: req.body?.currency,
              merchantId: req.merchant?.id,
              transactionId: req.body?.transactionId,
            });
          }
        }
      });
      
      next();
    };
  }
  
  /**
   * Detect suspicious activity
   */
  detectSuspiciousActivity(req) {
    const suspiciousPatterns = [
      { pattern: /(\d\s*?){16,}/, type: 'possible_card_number' },
      { pattern: /(\d\s*?){3,4}/, type: 'possible_cvv' },
      { pattern: /(?:password|passwd|pwd|secret)=[^&\s]+/, type: 'password_in_url' },
      { pattern: /<script[^>]*>/, type: 'possible_xss' },
      { pattern: /(?:union.*select|select.*from)/i, type: 'possible_sql_injection' },
    ];
    
    const checkString = (str, context) => {
      if (!str) return;
      
      suspiciousPatterns.forEach(({ pattern, type }) => {
        if (pattern.test(str)) {
          logger.warn('Suspicious activity detected', {
            type,
            context,
            ip: req.ip,
            userAgent: req.get('User-Agent'),
            merchantId: req.merchant?.id,
            path: req.path,
          });
        }
      });
    };
    
    // Check query parameters
    Object.values(req.query).forEach(value => {
      if (typeof value === 'string') {
        checkString(value, 'query');
      }
    });
    
    // Check body
    if (req.body && typeof req.body === 'object') {
      const bodyStr = JSON.stringify(req.body);
      checkString(bodyStr, 'body');
    }
    
    // Check headers
    const headersStr = JSON.stringify(req.headers);
    checkString(headersStr, 'headers');
  }
  
  /**
   * Sanitize request body for logging
   */
  sanitizeBody(body) {
    if (!body || typeof body !== 'object') return body;
    
    const sensitiveFields = [
      'cardNumber', 'cvv', 'expiry', 'expiration',
      'password', 'secret', 'token', 'key',
      'accountNumber', 'routingNumber', 'ssn',
      'birthDate', 'phone', 'email',
    ];
    
    const sanitized = { ...body };
    
    sensitiveFields.forEach(field => {
      if (sanitized[field]) {
        if (field === 'cardNumber' && sanitized[field].length > 4) {
          sanitized[field] = `****-****-****-${sanitized[field].slice(-4)}`;
        } else {
          sanitized[field] = '[REDACTED]';
        }
      }
    });
    
    // Recursively sanitize nested objects
    Object.keys(sanitized).forEach(key => {
      if (sanitized[key] && typeof sanitized[key] === 'object') {
        sanitized[key] = this.sanitizeBody(sanitized[key]);
      }
    });
    
    return sanitized;
  }
  
  /**
   * Correlation ID middleware
   */
  correlationId() {
    return (req, res, next) => {
      const correlationId = req.headers['x-correlation-id'] || uuidv4();
      
      req.correlationId = correlationId;
      res.setHeader('X-Correlation-ID', correlationId);
      
      // Add to logger context
      if (req.log) {
        req.log = req.log.child({ correlationId });
      }
      
      next();
    };
  }
  
  /**
   * API usage logger
   */
  apiUsageLogger() {
    return (req, res, next) => {
      res.on('finish', () => {
        const usageData = {
          endpoint: req.path,
          method: req.method,
          merchantId: req.merchant?.id,
          statusCode: res.statusCode,
          timestamp: new Date().toISOString(),
          userAgent: req.get('User-Agent'),
          ip: req.ip,
        };
        
        logger.info('API usage', usageData);
      });
      
      next();
    };
  }
}

// Export singleton
module.exports = new LoggingMiddleware();