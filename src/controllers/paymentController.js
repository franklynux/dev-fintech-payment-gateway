const { v4: uuidv4 } = require('uuid');
const config = require('../config');
const metrics = require('../utils/metrics');
const logger = require('../utils/logger');
const {
  ValidationError,
  PaymentError,
  FraudCheckError,
  ProcessorError,
  AuthenticationError,
  AuthorizationError } = require('../utils/errors');

class PaymentController {
  constructor({
    routingService,
    fraudService,
    tokenService,
    idempotencyService,
    retryManager,
    paymentProcessorFactory,
  }) {
    this.routingService = routingService;
    this.fraudService = fraudService;
    this.tokenService = tokenService;
    this.idempotencyService = idempotencyService;
    this.retryManager = retryManager;
    this.processorFactory = paymentProcessorFactory;
  }

  async processPayment(req, res, next) {
    const transactionId = uuidv4();
    const startTime = Date.now();
    const idempotencyKey = req.headers['idempotency-key'] || uuidv4();

    // Log request (with PCI masking)
    const safeRequest = config.pci.maskSensitiveData(req.body);
    logger.info('Payment processing request', {
      transactionId,
      merchantId: req.merchant?.id,
      endpoint: req.path,
      safeRequest,
      idempotencyKey,
    });

    try {
      // Step 1: Check idempotency
      const cachedResponse = await this.idempotencyService.get(idempotencyKey);
      if (cachedResponse) {
        logger.info('Idempotent request served from cache', { transactionId });
        return res.status(200).json(cachedResponse);
      }

      // Step 2: Validate merchant and request
      await this.validateRequest(req);

      // Step 3: Tokenize sensitive data
      const tokenizedData = await this.tokenizeSensitiveData(req.body);
      
      // Step 4: Fraud check
      const fraudResult = await this.performFraudCheck({
        transactionId,
        ...tokenizedData,
        merchantId: req.merchant.id,
      });

      // Step 5: Route to appropriate processor
      const processor = await this.routingService.selectProcessor({
        merchantId: req.merchant.id,
        amount: req.body.amount,
        currency: req.body.currency,
        region: req.body.region || req.merchant.region,
        transactionId,
      });

      // Step 6: Process payment with retry logic
      const paymentResult = await this.processPaymentWithRetry(
        processor,
        tokenizedData,
        transactionId,
        idempotencyKey
      );

      // Step 7: Combine results
      const finalResult = {
        transactionId,
        status: 'success',
        processor: processor.name,
        fraudScore: fraudResult.score,
        fraudCheckPassed: !fraudResult.isFraudulent,
        timestamp: new Date().toISOString(),
        ...paymentResult,
      };

      // Step 8: Cache for idempotency
      await this.idempotencyService.set(idempotencyKey, finalResult);

      // Step 9: Record metrics
      this.recordMetrics({
        transactionId,
        processor: processor.name,
        amount: req.body.amount,
        duration: Date.now() - startTime,
        fraudScore: fraudResult.score,
        success: true,
      });

      // Step 10: Send response
      logger.info('Payment processed successfully', {
        transactionId,
        processor: processor.name,
        amount: req.body.amount,
        duration: Date.now() - startTime,
      });

      res.status(200).json(finalResult);

    } catch (error) {
      this.handlePaymentError(error, {
        transactionId,
        startTime,
        idempotencyKey,
        merchantId: req.merchant?.id,
      });
      next(error);
    }
  }

  async getPaymentStatus(req, res, next) {
    const { transactionId } = req.params;
    
    try {
      // In production, this would query a database or processor
      const status = {
        transactionId,
        status: 'completed', // This would be dynamic
        timestamp: new Date().toISOString(),
        amount: 100.00, // Example
        currency: 'USD',
      };

      res.status(200).json(status);
    } catch (error) {
      next(error);
    }
  }

  async refundPayment(req, res, next) {
    const transactionId = uuidv4();
    
    try {
      const { originalTransactionId, amount, reason } = req.body;
      
      // Validate refund request
      if (!originalTransactionId) {
        throw new ValidationError('Original transaction ID is required');
      }

      // Get original transaction details
      const originalTransaction = await this.getTransaction(originalTransactionId);
      
      // Process refund through original processor
      const processor = this.processorFactory.getProcessor(originalTransaction.processor);
      const refundResult = await processor.refund({
        originalTransactionId,
        amount: amount || originalTransaction.amount,
        reason,
      });

      const response = {
        refundId: uuidv4(),
        transactionId: originalTransactionId,
        status: 'refunded',
        amount: refundResult.amount,
        timestamp: new Date().toISOString(),
      };

      res.status(200).json(response);
    } catch (error) {
      next(error);
    }
  }

  // Helper Methods
  async validateRequest(req) {
    // Merchant authentication is handled by middleware
    if (!req.merchant || !req.merchant.id) {
      throw new ValidationError('Merchant authentication required');
    }

    // Basic validation
    const { amount, currency } = req.body;
    if (!amount || amount <= 0) {
      throw new ValidationError('Valid amount is required');
    }
    if (!currency || currency.length !== 3) {
      throw new ValidationError('Valid 3-letter currency code is required');
    }

    // Additional merchant-specific validation
    const merchantConfig = await this.getMerchantConfig(req.merchant.id);
    if (amount > merchantConfig.maxTransactionAmount) {
      throw new ValidationError(`Amount exceeds maximum of ${merchantConfig.maxTransactionAmount}`);
    }
  }

  async tokenizeSensitiveData(paymentData) {
    const tokenized = { ...paymentData };

    // Tokenize card data if present
    if (paymentData.cardNumber) {
      const tokenResult = await this.tokenService.tokenizeCard({
        number: paymentData.cardNumber,
        cvv: paymentData.cvv,
        expirationMonth: paymentData.expirationMonth,
        expirationYear: paymentData.expirationYear,
        cardholderName: paymentData.cardholderName,
      });

      tokenized.paymentToken = tokenResult.token;
      tokenized.tokenType = 'card';

      // Remove sensitive data
      delete tokenized.cardNumber;
      delete tokenized.cvv;
      delete tokenized.expirationMonth;
      delete tokenized.expirationYear;
      delete tokenized.cardholderName;
    }

    // Tokenize bank account if present
    if (paymentData.accountNumber) {
      const bankToken = await this.tokenService.tokenizeBankAccount({
        accountNumber: paymentData.accountNumber,
        routingNumber: paymentData.routingNumber,
        accountType: paymentData.accountType,
      });

      tokenized.paymentToken = bankToken;
      tokenized.tokenType = 'bank';
    }

    return tokenized;
  }

  async performFraudCheck(transactionData) {
    if (!config.fraudService.enabled) {
      logger.debug('Fraud service disabled, skipping check');
      return {
        score: 0,
        isFraudulent: false,
        reasons: [],
        recommendedAction: 'proceed',
      };
    }

    try {
      return await this.fraudService.scoreTransaction(transactionData);
    } catch (error) {
      // Fail-open: if fraud service is unavailable, proceed with warning
      logger.warn('Fraud service unavailable, proceeding with transaction', {
        transactionId: transactionData.transactionId,
        error: error.message,
      });

      return {
        score: 0,
        isFraudulent: false,
        reasons: ['fraud_service_unavailable'],
        recommendedAction: 'proceed_with_caution',
      };
    }
  }

  async processPaymentWithRetry(processor, data, transactionId, idempotencyKey) {
    return this.retryManager.withRetry(
      async () => {
        const start = Date.now();
        const result = await processor.processPayment(data);
        const duration = Date.now() - start;

        logger.debug('Payment processor response', {
          processor: processor.name,
          transactionId,
          duration,
          status: result.status,
        });

        return result;
      },
      {
        idempotencyKey,
        operationName: 'process_payment',
        context: { transactionId, processor: processor.name },
      }
    );
  }

  recordMetrics(data) {
    metrics.transactionsTotal.inc({
      processor: data.processor,
      status: data.success ? 'success' : 'failed',
      merchantId: data.merchantId,
    });

    metrics.transactionDuration.observe(
      { processor: data.processor },
      data.duration / 1000
    );

    if (data.fraudScore !== undefined) {
      metrics.fraudScore.observe(data.fraudScore);
    }

    if (data.amount) {
      metrics.transactionAmount.observe(
        { processor: data.processor, currency: data.currency },
        data.amount
      );
    }
  }

  handlePaymentError(error, context) {
    const { transactionId, startTime, idempotencyKey, merchantId } = context;
    const duration = Date.now() - startTime;

    logger.error('Payment processing failed', {
      transactionId,
      merchantId,
      idempotencyKey,
      duration,
      error: error.message,
      stack: error.stack,
      errorType: error.constructor.name,
    });

    metrics.transactionsTotal.inc({
      processor: 'unknown',
      status: 'error',
      merchantId,
      errorType: error.constructor.name,
    });

    metrics.errorCounter.inc({
      type: 'payment_error',
      processor: error.processor || 'unknown',
    });
  }

  async getMerchantConfig(merchantId) {
    // This would typically fetch from database or cache
    return {
      maxTransactionAmount: 1000000,
      allowedCurrencies: ['USD', 'EUR', 'GBP'],
      supportedProcessors: ['stripe', 'paypal'],
      region: 'US',
    };
  }

  async getTransaction(transactionId) {
    // This would fetch from database
    return {
      transactionId,
      processor: 'stripe',
      amount: 100.00,
      currency: 'USD',
      status: 'completed',
    };
  }
}

module.exports = PaymentController;