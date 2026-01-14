const express = require('express');
const router = express.Router();
const { body, param, query, validationResult } = require('express-validator');
const PaymentController = require('../controllers/paymentController');
const middleware = require('../middleware');

// Initialize dependencies (in a real app, use dependency injection)
const {
  routingService,
  fraudService,
  tokenService,
  idempotencyService,
  retryManager,
  paymentProcessorFactory,
} = require('../services');

const paymentController = new PaymentController({
  routingService,
  fraudService,
  tokenService,
  idempotencyService,
  retryManager,
  paymentProcessorFactory,
});

// Validation schemas
const paymentValidation = [
  body('merchantId').optional().isString().trim(),
  body('amount')
    .isFloat({ min: 0.01, max: 1000000 })
    .withMessage('Amount must be between 0.01 and 1,000,000'),
  body('currency')
    .isString()
    .isLength({ min: 3, max: 3 })
    .isUppercase()
    .withMessage('Currency must be a 3-letter uppercase code'),
  body('description').optional().isString().trim().isLength({ max: 500 }),
  body('metadata').optional().isObject(),
  body('customerId').optional().isString().trim(),
  body('region').optional().isString().trim(),
  
  // Card payment validation
  body('cardNumber')
    .if(body('paymentMethod').equals('card'))
    .isCreditCard()
    .withMessage('Valid card number is required'),
  body('cvv')
    .if(body('paymentMethod').equals('card'))
    .isString()
    .isLength({ min: 3, max: 4 })
    .withMessage('CVV must be 3-4 digits'),
  body('expirationMonth')
    .if(body('paymentMethod').equals('card'))
    .isInt({ min: 1, max: 12 })
    .withMessage('Expiration month must be between 1 and 12'),
  body('expirationYear')
    .if(body('paymentMethod').equals('card'))
    .isInt({ min: new Date().getFullYear(), max: new Date().getFullYear() + 10 })
    .withMessage('Expiration year is invalid'),
  body('cardholderName')
    .if(body('paymentMethod').equals('card'))
    .isString()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Cardholder name is required'),
  
  // Bank payment validation
  body('accountNumber')
    .if(body('paymentMethod').equals('bank'))
    .isString()
    .isLength({ min: 4, max: 17 })
    .withMessage('Valid account number is required'),
  body('routingNumber')
    .if(body('paymentMethod').equals('bank'))
    .isString()
    .isLength({ min: 9, max: 9 })
    .withMessage('Valid routing number is required'),
  body('accountType')
    .if(body('paymentMethod').equals('bank'))
    .isIn(['checking', 'savings'])
    .withMessage('Account type must be checking or savings'),
];

const refundValidation = [
  body('originalTransactionId')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Original transaction ID is required'),
  body('amount')
    .optional()
    .isFloat({ min: 0.01 })
    .withMessage('Amount must be greater than 0'),
  body('reason')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 255 })
    .withMessage('Reason must be less than 255 characters'),
];

// Validation middleware
const validate = (validations) => {
  return async (req, res, next) => {
    await Promise.all(validations.map(validation => validation.run(req)));
    
    const errors = validationResult(req);
    if (errors.isEmpty()) {
      return next();
    }
    
    const formattedErrors = errors.array().map(err => ({
      field: err.path,
      message: err.msg,
      value: err.value,
    }));
    
    res.status(400).json({
      error: 'Validation failed',
      details: formattedErrors,
    });
  };
};

// Routes
router.post(
  '/process',
  middleware.auth.authenticateMerchant, // Merchant authentication
  middleware.auth.authorize('process_payment'), // Permission check
  middleware.rateLimiter.paymentProcessing, // Rate limiting
  middleware.logging.requestLogger, // Request logging
  validate(paymentValidation),
  paymentController.processPayment.bind(paymentController)
);

router.get(
  '/status/:transactionId',
  middleware.auth.authenticateMerchant,
  middleware.auth.authorize('view_payment'),
  validate([
    param('transactionId')
      .isUUID()
      .withMessage('Valid transaction ID is required'),
  ]),
  paymentController.getPaymentStatus.bind(paymentController)
);

router.post(
  '/refund',
  middleware.auth.authenticateMerchant,
  middleware.auth.authorize('process_refund'),
  middleware.rateLimiter.refundProcessing,
  validate(refundValidation),
  paymentController.refundPayment.bind(paymentController)
);

router.get(
  '/history',
  middleware.auth.authenticateMerchant,
  middleware.auth.authorize('view_history'),
  validate([
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('page').optional().isInt({ min: 1 }),
    query('status').optional().isIn(['pending', 'completed', 'failed', 'refunded']),
  ]),
  async (req, res, next) => {
    try {
      // This would be implemented in the controller
      const history = await paymentController.getPaymentHistory(
        req.merchant.id,
        req.query
      );
      res.status(200).json(history);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/capture/:transactionId',
  middleware.auth.authenticateMerchant,
  middleware.auth.authorize('capture_payment'),
  validate([
    param('transactionId').isUUID(),
    body('amount').optional().isFloat({ min: 0.01 }),
  ]),
  async (req, res, next) => {
    try {
      const result = await paymentController.capturePayment(
        req.params.transactionId,
        req.body.amount
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

router.post(
  '/void/:transactionId',
  middleware.auth.authenticateMerchant,
  middleware.auth.authorize('void_payment'),
  validate([
    param('transactionId').isUUID(),
  ]),
  async (req, res, next) => {
    try {
      const result = await paymentController.voidPayment(
        req.params.transactionId
      );
      res.status(200).json(result);
    } catch (error) {
      next(error);
    }
  }
);

// Health check endpoint for payments service
router.get('/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    service: 'payment-processing',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
});

// Error handling middleware specific to payment routes
router.use((err, req, res, next) => {
  // Log error
  req.log.error('Payment route error', {
    error: err.message,
    stack: err.stack,
    merchantId: req.merchant?.id,
    path: req.path,
  });

  // Determine status code
  const statusCode = err.statusCode || 
    (err.name === 'ValidationError' ? 400 : 
     err.name === 'AuthenticationError' ? 401 : 
     err.name === 'AuthorizationError' ? 403 : 500);

  // Construct response
  const response = {
    error: err.name || 'InternalServerError',
    message: err.message || 'An unexpected error occurred',
    timestamp: new Date().toISOString(),
    transactionId: req.transactionId,
  };

  // Add details for validation errors
  if (err.details) {
    response.details = err.details;
  }

  // Do not expose stack traces in production
  if (process.env.NODE_ENV !== 'production') {
    response.stack = err.stack;
  }

  res.status(statusCode).json(response);
});

module.exports = router;