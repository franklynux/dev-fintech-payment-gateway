const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger')();
const Merchant = require('../models/Merchant');

class AuthMiddleware {
  /**
   * Authenticate merchant by API key
   */
  async authenticateMerchant(req, res, next) {
    try {
      const apiKey = this.extractApiKey(req);
      
      if (!apiKey) {
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'API key is required',
        });
      }

      const merchant = await Merchant.findByApiKey(apiKey);
      
      if (!merchant) {
        logger.warn('Invalid API key attempt', {
          ip: req.ip,
          userAgent: req.get('User-Agent'),
        });
        
        return res.status(401).json({
          error: 'Unauthorized',
          message: 'Invalid API key',
        });
      }

      if (!merchant.isActive) {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Merchant account is inactive',
        });
      }

      // Attach merchant to request
      req.merchant = merchant.toInternalJSON();
      req.merchantId = merchant.id;
      
      // Add to request logger
      req.log = logger.child({ merchantId: merchant.id });
      
      next();
    } catch (error) {
      logger.error('Merchant authentication failed', {
        error: error.message,
        stack: error.stack,
      });
      
      res.status(500).json({
        error: 'AuthenticationError',
        message: 'Failed to authenticate merchant',
      });
    }
  }

  /**
   * Authenticate internal services
   */
  authenticateInternal(req, res, next) {
    const token = req.headers['x-internal-token'];
    
    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Internal token required',
      });
    }

    const validToken = process.env.INTERNAL_SERVICE_TOKEN;
    
    if (!validToken || token !== validToken) {
      logger.warn('Invalid internal token attempt', {
        ip: req.ip,
        path: req.path,
      });
      
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid internal token',
      });
    }

    req.isInternal = true;
    next();
  }

  /**
   * Authorize based on permissions
   */
  authorize(permission) {
    return async (req, res, next) => {
      try {
        if (req.isInternal) {
          // Internal requests have full access
          return next();
        }

        const merchant = req.merchant;
        
        if (!merchant) {
          return res.status(401).json({
            error: 'Unauthorized',
            message: 'Merchant authentication required',
          });
        }

        // Check if merchant has the required permission
        const hasPermission = await this.checkPermission(merchant.id, permission);
        
        if (!hasPermission) {
          logger.warn('Unauthorized access attempt', {
            merchantId: merchant.id,
            permission,
            path: req.path,
            method: req.method,
          });
          
          return res.status(403).json({
            error: 'Forbidden',
            message: `Insufficient permissions: ${permission}`,
          });
        }

        next();
      } catch (error) {
        logger.error('Authorization failed', {
          error: error.message,
          permission,
          merchantId: req.merchant?.id,
        });
        
        res.status(500).json({
          error: 'AuthorizationError',
          message: 'Failed to authorize request',
        });
      }
    };
  }

  /**
   * Generate JWT for user authentication
   */
  generateToken(user, expiresIn = '24h') {
    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      permissions: user.permissions || [],
    };

    return jwt.sign(payload, config.security.jwtSecret, { expiresIn });
  }

  /**
   * Verify JWT token
   */
  verifyToken(token) {
    try {
      return jwt.verify(token, config.security.jwtSecret);
    } catch (error) {
      throw new Error('Invalid token');
    }
  }

  /**
   * Middleware to verify JWT
   */
  verifyJWT(req, res, next) {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Bearer token required',
      });
    }

    const token = authHeader.substring(7);
    
    try {
      const decoded = this.verifyToken(token);
      req.user = decoded;
      next();
    } catch (error) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or expired token',
      });
    }
  }

  /**
   * Check rate limiting by merchant
   */
  rateLimitByMerchant() {
    const rateLimit = require('express-rate-limit');
    const RedisStore = require('rate-limit-redis');
    const redis = require('../config/redis');
    
    return rateLimit({
      store: new RedisStore({
        client: redis,
        prefix: 'rate_limit:merchant:',
      }),
      windowMs: config.security.rateLimitWindow,
      max: (req) => {
        // Different limits based on merchant tier
        const merchant = req.merchant;
        if (!merchant) return 100; // Default limit
        
        const tier = merchant.metadata?.tier || 'standard';
        const limits = {
          basic: 100,
          standard: 1000,
          premium: 10000,
          enterprise: 100000,
        };
        
        return limits[tier] || 100;
      },
      keyGenerator: (req) => {
        return req.merchant?.id || req.ip;
      },
      handler: (req, res) => {
        logger.warn('Rate limit exceeded', {
          merchantId: req.merchant?.id,
          ip: req.ip,
          path: req.path,
        });
        
        res.status(429).json({
          error: 'TooManyRequests',
          message: 'Rate limit exceeded',
          retryAfter: req.rateLimit.resetTime,
        });
      },
    });
  }

  /**
   * Generate API key for merchant
   */
  async generateApiKey(merchantId) {
    const crypto = require('crypto');
    
    // Generate random API key
    const apiKey = crypto.randomBytes(32).toString('hex');
    const apiKeyHash = crypto
      .createHash('sha256')
      .update(apiKey)
      .digest('hex');
    
    // Store hash in database (we don't store the actual key)
    await Merchant.update(
      { apiKey: apiKeyHash },
      { where: { id: merchantId } }
    );
    
    return {
      apiKey,
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
    };
  }

  /**
   * Revoke API key
   */
  async revokeApiKey(merchantId) {
    await Merchant.update(
      { apiKey: null },
      { where: { id: merchantId } }
    );
    
    logger.info('API key revoked', { merchantId });
  }

  /**
   * Extract API key from request
   */
  extractApiKey(req) {
    // Check headers first
    const apiKey = req.headers[config.security.apiKeyHeader] ||
                   req.headers['authorization']?.replace('Bearer ', '') ||
                   req.query.api_key;
    
    return apiKey;
  }

  /**
   * Check permission for merchant
   */
  async checkPermission(merchantId, permission) {
    // This would typically query a permissions database
    // For now, return true for all permissions (implement properly in production)
    
    const permissionMap = {
      'process_payment': ['basic', 'standard', 'premium', 'enterprise'],
      'process_refund': ['standard', 'premium', 'enterprise'],
      'view_payment': ['basic', 'standard', 'premium', 'enterprise'],
      'view_history': ['standard', 'premium', 'enterprise'],
      'capture_payment': ['premium', 'enterprise'],
      'void_payment': ['premium', 'enterprise'],
      'manage_webhooks': ['standard', 'premium', 'enterprise'],
      'view_reports': ['premium', 'enterprise'],
    };
    
    // Get merchant tier
    const merchant = await Merchant.findByPk(merchantId);
    const tier = merchant?.metadata?.tier || 'standard';
    
    const allowedTiers = permissionMap[permission] || [];
    return allowedTiers.includes(tier);
  }

  /**
   * Require PCI compliance for certain endpoints
   */
  requirePciCompliance(req, res, next) {
    if (!config.pci.enabled) {
      return next();
    }

    const merchant = req.merchant;
    
    if (!merchant?.isPciCompliant) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'PCI DSS compliance required for this operation',
        required: true,
        merchantCompliant: false,
      });
    }

    // Additional PCI checks
    this.validatePciRequirements(req);
    next();
  }

  /**
   * Validate PCI requirements
   */
  validatePciRequirements(req) {
    const violations = [];
    
    // Check for proper encryption
    if (!req.secure && process.env.NODE_ENV === 'production') {
      violations.push('Request must use HTTPS');
    }
    
    // Check for sensitive data in query params
    if (req.query && Object.keys(req.query).some(key => 
      config.pci.isSensitiveField(key))) {
      violations.push('Sensitive data in query parameters');
    }
    
    // Check for proper headers
    const requiredHeaders = [
      'User-Agent',
      'X-Request-ID',
    ];
    
    requiredHeaders.forEach(header => {
      if (!req.headers[header.toLowerCase()]) {
        violations.push(`Missing required header: ${header}`);
      }
    });
    
    if (violations.length > 0) {
      logger.error('PCI requirement violations', {
        violations,
        merchantId: req.merchant?.id,
        path: req.path,
      });
      
      // Don't block, but log for security monitoring
    }
  }
}

module.exports = new AuthMiddleware();