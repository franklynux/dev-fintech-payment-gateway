const express = require('express');
const router = express.Router();
const { body, param, header, query } = require('express-validator');
const WebhookController = require('../controllers/webhookController');
const middleware = require('../middleware');

// Initialize dependencies
const { webhookService, eventProcessor } = require('../services');
const webhookController = new WebhookController({ webhookService, eventProcessor });

// Middleware for raw body (required by Stripe)
const rawBodyMiddleware = (req, res, next) => {
  const rawBody = [];
  
  req.on('data', (chunk) => {
    rawBody.push(chunk);
  });
  
  req.on('end', () => {
    req.rawBody = Buffer.concat(rawBody);
    
    // Also parse as JSON for convenience (except for Stripe)
    try {
      req.body = JSON.parse(req.rawBody.toString());
    } catch (e) {
      req.body = {};
    }
    
    next();
  });
};

// Validation schemas
const stripeWebhookValidation = [
  header('stripe-signature')
    .notEmpty()
    .withMessage('Stripe signature is required'),
];

const paypalWebhookValidation = [
  header('paypal-transmission-sig')
    .notEmpty()
    .withMessage('PayPal transmission signature is required'),
  header('paypal-transmission-id')
    .notEmpty()
    .withMessage('PayPal transmission ID is required'),
  header('paypal-transmission-time')
    .notEmpty()
    .withMessage('PayPal transmission time is required'),
  body('event_type')
    .notEmpty()
    .withMessage('Event type is required'),
  body('resource')
    .notEmpty()
    .withMessage('Resource data is required'),
];

const internalWebhookValidation = [
  header('x-internal-token')
    .notEmpty()
    .withMessage('Internal token is required'),
  body('event')
    .notEmpty()
    .isIn(['fraud_update', 'transaction_update', 'merchant_update'])
    .withMessage('Valid event type is required'),
  body('data')
    .notEmpty()
    .isObject()
    .withMessage('Event data is required'),
];

// Routes
router.post(
  '/stripe',
  rawBodyMiddleware, // Get raw body for signature verification
  middleware.rateLimiter.webhookProcessing,
  stripeWebhookValidation,
  webhookController.handleStripeWebhook.bind(webhookController)
);

router.post(
  '/paypal',
  express.json(),
  middleware.rateLimiter.webhookProcessing,
  paypalWebhookValidation,
  webhookController.handlePayPalWebhook.bind(webhookController)
);

router.post(
  '/:processor',
  express.json(),
  middleware.rateLimiter.webhookProcessing,
  validateProcessorParam,
  webhookController.handleGenericWebhook.bind(webhookController)
);

router.post(
  '/internal',
  express.json(),
  middleware.auth.authenticateInternal,
  internalWebhookValidation,
  webhookController.handleInternalWebhook.bind(webhookController)
);

// Webhook status and management endpoints
router.get(
  '/status/:webhookId',
  middleware.auth.authenticateMerchant,
  validate([
    param('webhookId')
      .isString()
      .notEmpty()
      .withMessage('Webhook ID is required'),
  ]),
  async (req, res, next) => {
    try {
      const status = await webhookService.getWebhookStatus(req.params.webhookId);
      res.status(200).json(status);
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/events/:transactionId',
  middleware.auth.authenticateMerchant,
  validate([
    param('transactionId')
      .isUUID()
      .withMessage('Valid transaction ID is required'),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ]),
  async (req, res, next) => {
    try {
      const events = await webhookService.getTransactionEvents(
        req.params.transactionId,
        req.query.limit || 50
      );
      res.status(200).json(events);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/retry/:webhookId',
  middleware.auth.authenticateInternal,
  validate([
    param('webhookId')
      .isString()
      .notEmpty()
      .withMessage('Webhook ID is required'),
  ]),
  async (req, res, next) => {
    try {
      const result = await webhookService.retryWebhook(req.params.webhookId);
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Webhook test endpoint (development only)
if (process.env.NODE_ENV !== 'production') {
  router.post(
    '/test/:processor',
    express.json(),
    middleware.auth.authenticateInternal,
    validate([
      param('processor')
        .isIn(['stripe', 'paypal'])
        .withMessage('Valid processor is required'),
      body('eventType')
        .notEmpty()
        .withMessage('Event type is required'),
      body('testData')
        .optional()
        .isObject(),
    ]),
    async (req, res, next) => {
      try {
        const testEvent = await webhookService.createTestEvent(
          req.params.processor,
          req.body.eventType,
          req.body.testData || {}
        );
        res.status(200).json(testEvent);
      } catch (error) {
        next(error);
      }
    }
  );
}

// Webhook configuration endpoint
router.get(
  '/config/:merchantId',
  middleware.auth.authenticateMerchant,
  middleware.auth.authorize('manage_webhooks'),
  validate([
    param('merchantId')
      .isString()
      .notEmpty()
      .withMessage('Merchant ID is required'),
  ]),
  async (req, res, next) => {
    try {
      const config = await webhookService.getMerchantWebhookConfig(
        req.params.merchantId
      );
      res.status(200).json(config);
    } catch (error) {
      next(error);
    }
  }
);

router.put(
  '/config/:merchantId',
  middleware.auth.authenticateMerchant,
  middleware.auth.authorize('manage_webhooks'),
  validate([
    param('merchantId')
      .isString()
      .notEmpty()
      .withMessage('Merchant ID is required'),
    body('webhooks')
      .isArray()
      .withMessage('Webhooks must be an array'),
    body('webhooks.*.url')
      .notEmpty()
      .isURL()
      .withMessage('Valid webhook URL is required'),
    body('webhooks.*.events')
      .isArray()
      .withMessage('Events must be an array'),
    body('webhooks.*.events.*')
      .isString()
      .notEmpty()
      .withMessage('Event type must be a string'),
    body('webhooks.*.secret')
      .optional()
      .isString()
      .withMessage('Secret must be a string'),
  ]),
  async (req, res, next) => {
    try {
      const config = await webhookService.updateMerchantWebhookConfig(
        req.params.merchantId,
        req.body.webhooks
      );
      res.status(200).json(config);
    } catch (error) {
      next(error);
    }
  }
);

// Helper middleware
function validateProcessorParam(req, res, next) {
  const { processor } = req.params;
  const validProcessors = ['stripe', 'paypal', 'adyen', 'square', 'braintree'];
  
  if (!validProcessors.includes(processor)) {
    return res.status(400).json({
      error: 'InvalidProcessor',
      message: `Processor must be one of: ${validProcessors.join(', ')}`,
      received: processor,
    });
  }
  
  next();
}

// Validation middleware
function validate(validations) {
  return async (req, res, next) => {
    await Promise.all(validations.map(validation => validation.run(req)));
    
    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }
    
    res.status(400).json({
      error: 'Validation failed',
      details: errors.array(),
    });
  };
}

// Error handling for webhook routes
router.use((err, req, res, next) => {
  // Special handling for webhook verification errors
  if (err.name === 'WebhookVerificationError') {
    return res.status(401).json({
      error: 'WebhookVerificationError',
      message: 'Webhook signature verification failed',
      timestamp: new Date().toISOString(),
    });
  }

  // General error handling
  const statusCode = err.statusCode || 500;
  
  const response = {
    error: err.name || 'InternalServerError',
    message: err.message || 'An unexpected error occurred',
    timestamp: new Date().toISOString(),
  };

  if (process.env.NODE_ENV !== 'production') {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
});

module.exports = router;