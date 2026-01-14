const winston = require('winston');
const { combine, timestamp, printf, colorize, json } = winston.format;
const config = require('../config');

class LoggerService {
  constructor() {
    this.logLevel = config.logging.level || 'info';
    this.isProduction = process.env.NODE_ENV === 'production';
    this.pci = config.pci;
    
    this.formats = {
      development: combine(
        colorize(),
        timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
        printf(({ level, message, timestamp, ...meta }) => {
          const metaString = Object.keys(meta).length ? 
            ` ${JSON.stringify(meta, null, 2)}` : '';
          return `${timestamp} ${level}: ${message}${metaString}`;
        })
      ),
      production: combine(
        timestamp(),
        json()
      ),
    };

    this.transports = this.createTransports();
    this.logger = this.createLogger();
  }

  createTransports() {
    const transports = [
      new winston.transports.Console({
        level: this.logLevel,
        format: this.isProduction ? 
          this.formats.production : 
          this.formats.development,
      }),
    ];

    // Add file transport in production
    if (this.isProduction && config.logging.directory) {
      const fs = require('fs');
      const path = require('path');
      
      const logDir = config.logging.directory;
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      transports.push(
        new winston.transports.File({
          filename: path.join(logDir, 'error.log'),
          level: 'error',
          format: this.formats.production,
          maxsize: 5242880, // 5MB
          maxFiles: 10,
        }),
        new winston.transports.File({
          filename: path.join(logDir, 'combined.log'),
          format: this.formats.production,
          maxsize: 5242880,
          maxFiles: 10,
        })
      );
    }

    return transports;
  }

  createLogger() {
    return winston.createLogger({
      level: this.logLevel,
      transports: this.transports,
      exitOnError: false,
      defaultMeta: {
        service: config.server.name,
        environment: config.server.env,
      },
    });
  }

  /**
   * Mask sensitive data from log objects
   */
  maskSensitiveData(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    
    const masked = { ...obj };
    const sensitivePatterns = this.pci.logging.maskPatterns || [];
    
    const maskObject = (currentObj, path = '') => {
      if (!currentObj || typeof currentObj !== 'object') return;
      
      Object.keys(currentObj).forEach(key => {
        const currentPath = path ? `${path}.${key}` : key;
        const value = currentObj[key];
        
        // Check if field is sensitive
        if (this.pci.isSensitiveField(key)) {
          if (key === 'cardNumber' && typeof value === 'string' && value.length > 4) {
            currentObj[key] = `****-****-****-${value.slice(-4)}`;
          } else if (key === 'cvv') {
            currentObj[key] = '***';
          } else {
            currentObj[key] = '[REDACTED]';
          }
        }
        
        // Apply regex patterns
        if (typeof value === 'string') {
          let maskedValue = value;
          sensitivePatterns.forEach(pattern => {
            maskedValue = maskedValue.replace(pattern, '[REDACTED]');
          });
          if (maskedValue !== value) {
            currentObj[key] = maskedValue;
          }
        }
        
        // Recursively check nested objects
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          maskObject(value, currentPath);
        }
      });
    };
    
    maskObject(masked);
    return masked;
  }

  /**
   * Validate that no sensitive data is being logged
   */
  validateLogObject(obj) {
    const violations = this.pci.validateNoSensitiveData(obj);
    if (violations.length > 0) {
      // In production, this would alert security team
      console.error('PCI DSS VIOLATION - Sensitive data in logs:', violations);
      
      // Remove sensitive data
      violations.forEach(violation => {
        const pathParts = violation.path.split('.');
        let current = obj;
        for (let i = 0; i < pathParts.length - 1; i++) {
          current = current[pathParts[i]];
          if (!current) break;
        }
        if (current && current[pathParts[pathParts.length - 1]]) {
          current[pathParts[pathParts.length - 1]] = '[REDACTED]';
        }
      });
    }
    return obj;
  }

  /**
   * Log methods with PCI compliance
   */
  log(level, message, meta = {}) {
    const safeMeta = this.maskSensitiveData(meta);
    this.validateLogObject(safeMeta);
    this.logger.log(level, message, safeMeta);
  }

  error(message, meta = {}) {
    this.log('error', message, meta);
  }

  warn(message, meta = {}) {
    this.log('warn', message, meta);
  }

  info(message, meta = {}) {
    this.log('info', message, meta);
  }

  http(message, meta = {}) {
    this.log('http', message, meta);
  }

  verbose(message, meta = {}) {
    this.log('verbose', message, meta);
  }

  debug(message, meta = {}) {
    this.log('debug', message, meta);
  }

  silly(message, meta = {}) {
    this.log('silly', message, meta);
  }

  /**
   * Create a child logger with additional metadata
   */
  child(additionalMeta = {}) {
    const childLogger = this.logger.child(additionalMeta);
    
    return {
      error: (message, meta) => childLogger.error(message, meta),
      warn: (message, meta) => childLogger.warn(message, meta),
      info: (message, meta) => childLogger.info(message, meta),
      http: (message, meta) => childLogger.http(message, meta),
      verbose: (message, meta) => childLogger.verbose(message, meta),
      debug: (message, meta) => childLogger.debug(message, meta),
      silly: (message, meta) => childLogger.silly(message, meta),
      log: (level, message, meta) => childLogger.log(level, message, meta),
      child: (moreMeta) => this.child({ ...additionalMeta, ...moreMeta }),
    };
  }

  /**
   * Audit logging for security events
   */
  audit(event, user, resource, details = {}) {
    const auditMeta = {
      audit: true,
      event,
      userId: user?.id || 'system',
      userEmail: user?.email,
      resourceType: resource?.type,
      resourceId: resource?.id,
      timestamp: new Date().toISOString(),
      ipAddress: details.ipAddress,
      userAgent: details.userAgent,
      action: details.action,
      changes: details.changes,
      metadata: details.metadata,
    };

    this.info(`AUDIT: ${event}`, auditMeta);
  }

  /**
   * Performance logging
   */
  performance(operation, duration, meta = {}) {
    const performanceMeta = {
      performance: true,
      operation,
      durationMs: duration,
      ...meta,
    };

    if (duration > 1000) {
      this.warn(`Slow operation: ${operation} took ${duration}ms`, performanceMeta);
    } else {
      this.debug(`Performance: ${operation}`, performanceMeta);
    }
  }

  /**
   * Business event logging
   */
  businessEvent(event, entity, details = {}) {
    const businessMeta = {
      businessEvent: true,
      event,
      entityType: entity?.type,
      entityId: entity?.id,
      ...details,
    };

    this.info(`BUSINESS: ${event}`, businessMeta);
  }
}

// Singleton instance
let instance = null;

function getLogger() {
  if (!instance) {
    instance = new LoggerService();
  }
  return instance;
}

module.exports = getLogger;