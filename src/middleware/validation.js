const Joi = require('joi');
const logger = require('../utils/logger')();
const config = require('../config');

class ValidationMiddleware {
  /**
   * Validate request body against schema
   */
  validateBody(schema) {
    return (req, res, next) => {
      const { error, value } = schema.validate(req.body, {
        abortEarly: false,
        stripUnknown: true,
        context: { req }, // Pass request for context-aware validation
      });

      if (error) {
        const errors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          type: detail.type,
        }));

        logger.warn('Request validation failed', {
          errors,
          path: req.path,
          merchantId: req.merchant?.id,
        });

        return res.status(400).json({
          error: 'ValidationError',
          message: 'Request validation failed',
          details: errors,
        });
      }

      // Replace body with validated and sanitized data
      req.body = value;
      next();
    };
  }

  /**
   * Validate request query parameters
   */
  validateQuery(schema) {
    return (req, res, next) => {
      const { error, value } = schema.validate(req.query, {
        abortEarly: false,
        stripUnknown: true,
      });

      if (error) {
        const errors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          type: detail.type,
        }));

        return res.status(400).json({
          error: 'ValidationError',
          message: 'Query validation failed',
          details: errors,
        });
      }

      req.query = value;
      next();
    };
  }

  /**
   * Validate request parameters
   */
  validateParams(schema) {
    return (req, res, next) => {
      const { error, value } = schema.validate(req.params, {
        abortEarly: false,
        stripUnknown: true,
      });

      if (error) {
        const errors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          type: detail.type,
        }));

        return res.status(400).json({
          error: 'ValidationError',
          message: 'Path parameter validation failed',
          details: errors,
        });
      }

      req.params = value;
      next();
    };
  }

  /**
   * Validate headers
   */
  validateHeaders(schema) {
    return (req, res, next) => {
      const { error } = schema.validate(req.headers, {
        abortEarly: false,
        stripUnknown: true,
        allowUnknown: true, // Allow other headers
      });

      if (error) {
        const errors = error.details.map(detail => ({
          field: detail.path.join('.'),
          message: detail.message,
          type: detail.type,
        }));

        return res.status(400).json({
          error: 'ValidationError',
          message: 'Header validation failed',
          details: errors,
        });
      }

      next();
    };
  }

  /**
   * PCI-compliant validation for sensitive data
   */
  validatePciData(req, res, next) {
    if (!config.pci.enabled) {
      return next();
    }

    const sensitiveFields = config.pci.sensitiveDataFields;
    const foundSensitive = [];
    
    // Check body
    this.findSensitiveFields(req.body, '', sensitiveFields, foundSensitive);
    
    // Check query
    this.findSensitiveFields(req.query, 'query.', sensitiveFields, foundSensitive);
    
    // Check params
    this.findSensitiveFields(req.params, 'params.', sensitiveFields, foundSensitive);

    if (foundSensitive.length > 0) {
      logger.error('PCI sensitive data validation failed', {
        sensitiveFields: foundSensitive,
        merchantId: req.merchant?.id,
        path: req.path,
      });

      return res.status(400).json({
        error: 'PciValidationError',
        message: 'Sensitive data found in request. Use tokenization instead.',
        sensitiveFields: foundSensitive,
      });
    }

    next();
  }

  /**
   * Recursively find sensitive fields
   */
  findSensitiveFields(obj, path, sensitiveFields, found) {
    if (!obj || typeof obj !== 'object') return;
    
    Object.keys(obj).forEach(key => {
      const currentPath = path + key;
      
      // Check if field name is sensitive
      if (sensitiveFields.includes(key)) {
        found.push({
          path: currentPath,
          value: typeof obj[key] === 'string' ? 
            obj[key].substring(0, 50) + '...' : 
            obj[key],
        });
      }
      
      // Recursively check nested objects
      if (obj[key] && typeof obj[key] === 'object') {
        this.findSensitiveFields(obj[key], `${currentPath}.`, sensitiveFields, found);
      }
    });
  }

  /**
   * Validate idempotency key
   */
  validateIdempotencyKey(req, res, next) {
    const idempotencyKey = req.headers['idempotency-key'];
    
    if (!idempotencyKey) {
      return next(); // Not required for all endpoints
    }

    // Validate format
    const keyRegex = /^[a-zA-Z0-9_-]{1,255}$/;
    if (!keyRegex.test(idempotencyKey)) {
      return res.status(400).json({
        error: 'ValidationError',
        message: 'Invalid idempotency key format',
        expectedFormat: 'Alphanumeric, dash, underscore, max 255 chars',
      });
    }

    next();
  }

  /**
   * Validate webhook signature
   */
  validateWebhookSignature(processor) {
    return async (req, res, next) => {
      try {
        let isValid = false;
        
        switch (processor) {
          case 'stripe':
            isValid = await this.validateStripeWebhook(req);
            break;
          case 'paypal':
            isValid = await this.validatePayPalWebhook(req);
            break;
          default:
            // For generic webhooks, check merchant signature
            isValid = await this.validateGenericWebhook(req, processor);
        }

        if (!isValid) {
          logger.warn('Invalid webhook signature', {
            processor,
            ip: req.ip,
            headers: req.headers,
          });

          return res.status(401).json({
            error: 'Unauthorized',
            message: 'Invalid webhook signature',
          });
        }

        next();
      } catch (error) {
        logger.error('Webhook validation error', {
          processor,
          error: error.message,
        });

        res.status(500).json({
          error: 'ValidationError',
          message: 'Failed to validate webhook',
        });
      }
    };
  }

  /**
   * Validate Stripe webhook
   */
  async validateStripeWebhook(req) {
    const stripe = require('stripe')(config.processors.stripe.secretKey);
    const signature = req.headers['stripe-signature'];
    
    if (!signature) return false;

    try {
      const event = stripe.webhooks.constructEvent(
        req.rawBody || req.body,
        signature,
        config.processors.stripe.webhookSecret
      );
      
      req.webhookEvent = event;
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Validate PayPal webhook
   */
  async validatePayPalWebhook(req) {
    const paypal = require('@paypal/checkout-server-sdk');
    
    const environment = config.processors.paypal.environment === 'live' ?
      new paypal.core.LiveEnvironment(
        config.processors.paypal.clientId,
        config.processors.paypal.clientSecret
      ) :
      new paypal.core.SandboxEnvironment(
        config.processors.paypal.clientId,
        config.processors.paypal.clientSecret
      );
    
    const client = new paypal.core.PayPalHttpClient(environment);
    
    // PayPal webhook validation requires additional API call
    // This is simplified - in production, implement full validation
    const transmissionId = req.headers['paypal-transmission-id'];
    const transmissionSig = req.headers['paypal-transmission-sig'];
    const transmissionTime = req.headers['paypal-transmission-time'];
    
    return !!transmissionId && !!transmissionSig && !!transmissionTime;
  }

  /**
   * Validate generic webhook
   */
  async validateGenericWebhook(req, processor) {
    const merchant = req.merchant;
    
    if (!merchant?.webhookSecret) {
      logger.warn('No webhook secret configured', { merchantId: merchant?.id });
      return false;
    }

    const signature = req.headers['x-webhook-signature'];
    if (!signature) return false;

    const crypto = require('crypto');
    const hmac = crypto.createHmac('sha256', merchant.webhookSecret);
    const computedSignature = hmac
      .update(JSON.stringify(req.body))
      .digest('hex');
    
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(computedSignature)
    );
  }

  /**
   * Common validation schemas
   */
  schemas = {
    // Payment processing
    payment: Joi.object({
      amount: Joi.number().positive().required()
        .custom((value, helpers) => {
          // Check for excessive precision
          if (value.toString().split('.')[1]?.length > 4) {
            return helpers.error('number.precision', { limit: 4 });
          }
          return value;
        }),
      currency: Joi.string().length(3).uppercase().required(),
      description: Joi.string().max(500),
      metadata: Joi.object(),
      customerId: Joi.string().max(100),
      billingAddress: Joi.object({
        line1: Joi.string().required(),
        line2: Joi.string(),
        city: Joi.string().required(),
        state: Joi.string(),
        postalCode: Joi.string().required(),
        country: Joi.string().length(2).uppercase().required(),
      }),
      shippingAddress: Joi.object({
        line1: Joi.string().required(),
        line2: Joi.string(),
        city: Joi.string().required(),
        state: Joi.string(),
        postalCode: Joi.string().required(),
        country: Joi.string().length(2).uppercase().required(),
      }),
      items: Joi.array().items(
        Joi.object({
          id: Joi.string().required(),
          name: Joi.string().required(),
          quantity: Joi.number().integer().positive().required(),
          price: Joi.number().positive().required(),
          currency: Joi.string().length(3).uppercase(),
        })
      ),
      paymentMethod: Joi.object().when('paymentToken', {
        is: Joi.exist(),
        then: Joi.forbidden(),
        otherwise: Joi.object({
          type: Joi.string().valid('card', 'bank').required(),
          card: Joi.object({
            number: Joi.string().creditCard().required(),
            expMonth: Joi.number().integer().min(1).max(12).required(),
            expYear: Joi.number().integer().min(new Date().getFullYear()).required(),
            cvc: Joi.string().length(3).required(),
            name: Joi.string().required(),
          }).when('type', {
            is: 'card',
            then: Joi.required(),
            otherwise: Joi.forbidden(),
          }),
          bank: Joi.object({
            accountNumber: Joi.string().required(),
            routingNumber: Joi.string().required(),
            accountType: Joi.string().valid('checking', 'savings').required(),
            name: Joi.string().required(),
          }).when('type', {
            is: 'bank',
            then: Joi.required(),
            otherwise: Joi.forbidden(),
          }),
        }).required(),
      }),
      paymentToken: Joi.string().max(255),
    }),

    // Refund
    refund: Joi.object({
      transactionId: Joi.string().uuid().required(),
      amount: Joi.number().positive(),
      reason: Joi.string().max(255),
      metadata: Joi.object(),
    }),

    // Webhook
    webhook: Joi.object({
      id: Joi.string().required(),
      type: Joi.string().required(),
      data: Joi.object().required(),
      created: Joi.date().iso(),
      livemode: Joi.boolean(),
    }),

    // Merchant configuration
    merchantConfig: Joi.object({
      name: Joi.string().min(2).max(255).required(),
      email: Joi.string().email().required(),
      region: Joi.string().valid('US', 'EU', 'UK', 'AU', 'CA', 'OTHER'),
      currency: Joi.string().length(3).uppercase(),
      allowedCurrencies: Joi.array().items(Joi.string().length(3).uppercase()),
      maxTransactionAmount: Joi.number().positive(),
      routingRules: Joi.object({
        strategy: Joi.string().valid('cost', 'region', 'success_rate', 'manual'),
        priority: Joi.array().items(Joi.string()),
        regionalRouting: Joi.object(),
      }),
      fraudSettings: Joi.object({
        enabled: Joi.boolean(),
        threshold: Joi.number().min(0).max(1),
        autoDecline: Joi.boolean(),
      }),
    }),

    // Pagination
    pagination: Joi.object({
      page: Joi.number().integer().min(1).default(1),
      limit: Joi.number().integer().min(1).max(100).default(20),
      sortBy: Joi.string().valid('createdAt', 'amount', 'status'),
      sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
      startDate: Joi.date().iso(),
      endDate: Joi.date().iso(),
    }),
  };

  /**
   * Custom validators
   */
  customValidators = {
    // Validate card expiry
    cardExpiry: (value, helpers) => {
      const [month, year] = value.split('/');
      const expiryDate = new Date(parseInt(`20${year}`), month - 1);
      const today = new Date();
      
      if (expiryDate < today) {
        return helpers.error('date.expired');
      }
      
      return value;
    },

    // Validate currency against merchant's allowed currencies
    allowedCurrency: (value, helpers) => {
      const merchant = helpers.state.ancestors[0];
      if (merchant?.allowedCurrencies && !merchant.allowedCurrencies.includes(value)) {
        return helpers.error('currency.notAllowed', { value });
      }
      return value;
    },

    // Validate amount against merchant limits
    amountWithinLimits: (value, helpers) => {
      const merchant = helpers.state.ancestors[0];
      if (merchant) {
        if (value < merchant.minTransactionAmount) {
          return helpers.error('amount.tooLow', { min: merchant.minTransactionAmount });
        }
        if (value > merchant.maxTransactionAmount) {
          return helpers.error('amount.tooHigh', { max: merchant.maxTransactionAmount });
        }
      }
      return value;
    },

    // Validate no HTML/script tags
    noHtml: (value, helpers) => {
      const htmlRegex = /<[^>]*>/;
      if (htmlRegex.test(value)) {
        return helpers.error('string.noHtml');
      }
      return value;
    },
  };
}

// Export singleton
module.exports = new ValidationMiddleware();