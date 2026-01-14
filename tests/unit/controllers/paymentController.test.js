const { v4: uuidv4 } = require('uuid');
const PaymentController = require('../../../src/controllers/paymentController');
const ValidationError = require('../../../src/utils/errors/ValidationError');
const logger = require('../../../src/utils/logger')();

describe('PaymentController', () => {
  let paymentController;
  let mockServices;
  let req, res, next;

  beforeEach(() => {
    // Mock services
    mockServices = {
      routingService: {
        selectProcessor: jest.fn(),
      },
      fraudService: {
        scoreTransaction: jest.fn(),
      },
      tokenService: {
        tokenizeCard: jest.fn(),
        tokenizeBankAccount: jest.fn(),
      },
      idempotencyService: {
        get: jest.fn(),
        set: jest.fn(),
      },
      retryManager: {
        withRetry: jest.fn(),
      },
      paymentProcessorFactory: {
        getProcessor: jest.fn(),
      },
    };

    paymentController = new PaymentController(mockServices);

    // Mock request
    req = {
      merchant: {
        id: 'merchant_123',
        name: 'Test Merchant',
        region: 'US',
      },
      body: {
        amount: 100.50,
        currency: 'USD',
        description: 'Test payment',
        cardNumber: '4242424242424242',
        cvv: '123',
        expirationMonth: 12,
        expirationYear: 2025,
        cardholderName: 'Test Customer',
      },
      headers: {
        'idempotency-key': 'idemp_123',
      },
      path: '/api/v1/payments/process',
    };

    // Mock response
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    };

    // Mock next function
    next = jest.fn();

    // Mock logger
    logger.info = jest.fn();
    logger.error = jest.fn();
    logger.warn = jest.fn();
    logger.debug = jest.fn();

    // Mock metrics
    paymentController.recordMetrics = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('processPayment', () => {
    it('should process payment successfully', async () => {
      const transactionId = uuidv4();
      jest.spyOn(uuidv4, 'v4').mockReturnValue(transactionId);

      // Mock idempotency cache miss
      mockServices.idempotencyService.get.mockResolvedValue(null);

      // Mock tokenization
      mockServices.tokenService.tokenizeCard.mockResolvedValue({
        token: 'tok_123',
      });

      // Mock fraud check
      mockServices.fraudService.scoreTransaction.mockResolvedValue({
        score: 0.2,
        isFraudulent: false,
        reasons: [],
        recommendedAction: 'proceed',
      });

      // Mock routing
      const mockProcessor = {
        name: 'stripe',
        processPayment: jest.fn(),
      };
      mockServices.routingService.selectProcessor.mockResolvedValue(mockProcessor);

      // Mock payment processing
      mockServices.retryManager.withRetry.mockResolvedValue({
        status: 'succeeded',
        transactionId: 'pi_123',
        amount: 100.50,
        currency: 'USD',
      });

      // Mock processor response
      mockProcessor.processPayment.mockResolvedValue({
        status: 'succeeded',
        transactionId: 'pi_123',
      });

      await paymentController.processPayment(req, res, next);

      // Verify tokenization
      expect(mockServices.tokenService.tokenizeCard).toHaveBeenCalledWith({
        number: '4242424242424242',
        cvv: '123',
        expirationMonth: 12,
        expirationYear: 2025,
        cardholderName: 'Test Customer',
      });

      // Verify fraud check
      expect(mockServices.fraudService.scoreTransaction).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionId,
          merchantId: 'merchant_123',
        })
      );

      // Verify routing
      expect(mockServices.routingService.selectProcessor).toHaveBeenCalledWith({
        merchantId: 'merchant_123',
        amount: 100.50,
        currency: 'USD',
        region: 'US',
        transactionId,
      });

      // Verify payment processing
      expect(mockServices.retryManager.withRetry).toHaveBeenCalled();

      // Verify idempotency cache set
      expect(mockServices.idempotencyService.set).toHaveBeenCalledWith(
        'idemp_123',
        expect.objectContaining({
          transactionId,
          status: 'success',
          processor: 'stripe',
          fraudScore: 0.2,
          fraudCheckPassed: true,
        })
      );

      // Verify response
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionId,
          status: 'success',
          processor: 'stripe',
        })
      );

      // Verify metrics recorded
      expect(paymentController.recordMetrics).toHaveBeenCalled();
    });

    it('should return cached response for idempotent request', async () => {
      const cachedResponse = {
        transactionId: 'txn_123',
        status: 'success',
        timestamp: '2024-01-01T00:00:00Z',
      };

      mockServices.idempotencyService.get.mockResolvedValue(cachedResponse);

      await paymentController.processPayment(req, res, next);

      expect(mockServices.idempotencyService.get).toHaveBeenCalledWith('idemp_123');
      expect(logger.info).toHaveBeenCalledWith(
        'Idempotent request served from cache',
        expect.any(Object)
      );
      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(cachedResponse);

      // Should not process payment
      expect(mockServices.fraudService.scoreTransaction).not.toHaveBeenCalled();
      expect(mockServices.routingService.selectProcessor).not.toHaveBeenCalled();
    });

    it('should handle validation error', async () => {
      // Remove required amount
      req.body.amount = undefined;

      await paymentController.processPayment(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
      expect(paymentController.recordMetrics).toHaveBeenCalled();
    });

    it('should handle fraud check failure', async () => {
      mockServices.idempotencyService.get.mockResolvedValue(null);
      mockServices.tokenService.tokenizeCard.mockResolvedValue({
        token: 'tok_123',
      });

      // Mock fraud check failure
      mockServices.fraudService.scoreTransaction.mockResolvedValue({
        score: 0.9,
        isFraudulent: true,
        reasons: ['high_risk_country'],
        recommendedAction: 'decline',
      });

      await paymentController.processPayment(req, res, next);

      expect(res.status).toHaveBeenCalledWith(400); // Assuming 400 for fraud failure
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          error: 'FraudCheckError',
          message: 'Fraud check failed',
        })
      );
    });

    it('should handle payment processor error', async () => {
      mockServices.idempotencyService.get.mockResolvedValue(null);
      mockServices.tokenService.tokenizeCard.mockResolvedValue({
        token: 'tok_123',
      });
      mockServices.fraudService.scoreTransaction.mockResolvedValue({
        score: 0.2,
        isFraudulent: false,
        reasons: [],
        recommendedAction: 'proceed',
      });

      const mockProcessor = {
        name: 'stripe',
        processPayment: jest.fn(),
      };
      mockServices.routingService.selectProcessor.mockResolvedValue(mockProcessor);

      // Mock processor error
      const processorError = new Error('Card declined');
      processorError.name = 'ProcessorError';
      mockServices.retryManager.withRetry.mockRejectedValue(processorError);

      await paymentController.processPayment(req, res, next);

      expect(next).toHaveBeenCalledWith(processorError);
      expect(paymentController.recordMetrics).toHaveBeenCalled();
    });

    it('should handle missing merchant', async () => {
      req.merchant = null;

      await paymentController.processPayment(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    });

    it('should handle bank account payments', async () => {
      req.body = {
        amount: 100.50,
        currency: 'USD',
        accountNumber: '123456789',
        routingNumber: '021000021',
        accountType: 'checking',
      };

      mockServices.idempotencyService.get.mockResolvedValue(null);
      mockServices.tokenService.tokenizeBankAccount.mockResolvedValue('tok_bank_123');
      mockServices.fraudService.scoreTransaction.mockResolvedValue({
        score: 0.1,
        isFraudulent: false,
        reasons: [],
        recommendedAction: 'proceed',
      });

      const mockProcessor = {
        name: 'paypal',
        processPayment: jest.fn(),
      };
      mockServices.routingService.selectProcessor.mockResolvedValue(mockProcessor);
      mockServices.retryManager.withRetry.mockResolvedValue({
        status: 'succeeded',
      });

      await paymentController.processPayment(req, res, next);

      expect(mockServices.tokenService.tokenizeBankAccount).toHaveBeenCalledWith({
        accountNumber: '123456789',
        routingNumber: '021000021',
        accountType: 'checking',
      });
    });
  });

  describe('getPaymentStatus', () => {
    it('should return payment status', async () => {
      req.params = { transactionId: 'txn_123' };

      await paymentController.getPaymentStatus(req, res, next);

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          transactionId: 'txn_123',
          status: expect.any(String),
        })
      );
    });

    it('should handle missing transaction ID', async () => {
      req.params = {};

      await paymentController.getPaymentStatus(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    });
  });

  describe('refundPayment', () => {
    it('should process refund successfully', async () => {
      req.body = {
        originalTransactionId: 'txn_123',
        amount: 50.25,
        reason: 'customer_return',
      };

      // Mock transaction lookup
      paymentController.getTransaction = jest.fn().mockResolvedValue({
        transactionId: 'txn_123',
        processor: 'stripe',
        amount: 100.50,
        currency: 'USD',
        status: 'completed',
      });

      // Mock processor
      const mockProcessor = {
        refund: jest.fn(),
      };
      mockServices.paymentProcessorFactory.getProcessor.mockReturnValue(mockProcessor);
      mockProcessor.refund.mockResolvedValue({
        amount: 50.25,
        status: 'refunded',
      });

      await paymentController.refundPayment(req, res, next);

      expect(paymentController.getTransaction).toHaveBeenCalledWith('txn_123');
      expect(mockServices.paymentProcessorFactory.getProcessor).toHaveBeenCalledWith('stripe');
      expect(mockProcessor.refund).toHaveBeenCalledWith({
        originalTransactionId: 'txn_123',
        amount: 50.25,
        reason: 'customer_return',
      });

      expect(res.status).toHaveBeenCalledWith(200);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'refunded',
          amount: 50.25,
        })
      );
    });

    it('should validate refund request', async () => {
      req.body = {
        // Missing originalTransactionId
        amount: 50.25,
      };

      await paymentController.refundPayment(req, res, next);

      expect(next).toHaveBeenCalledWith(expect.any(ValidationError));
    });
  });

  describe('tokenizeSensitiveData', () => {
    it('should tokenize card data', async () => {
      const paymentData = {
        cardNumber: '4242424242424242',
        cvv: '123',
        expirationMonth: 12,
        expirationYear: 2025,
        cardholderName: 'Test Customer',
      };

      mockServices.tokenService.tokenizeCard.mockResolvedValue({
        token: 'tok_123',
        last4: '4242',
        brand: 'visa',
        expMonth: 12,
        expYear: 2025,
      });

      const result = await paymentController.tokenizeSensitiveData(paymentData);

      expect(mockServices.tokenService.tokenizeCard).toHaveBeenCalledWith(paymentData);
      expect(result.paymentToken).toBe('tok_123');
      expect(result.tokenType).toBe('card');
      expect(result.cardNumber).toBeUndefined(); // Should be removed
      expect(result.cvv).toBeUndefined(); // Should be removed
    });

    it('should tokenize bank account data', async () => {
      const paymentData = {
        accountNumber: '123456789',
        routingNumber: '021000021',
        accountType: 'checking',
      };

      mockServices.tokenService.tokenizeBankAccount.mockResolvedValue('tok_bank_123');

      const result = await paymentController.tokenizeSensitiveData(paymentData);

      expect(mockServices.tokenService.tokenizeBankAccount).toHaveBeenCalledWith({
        accountNumber: '123456789',
        routingNumber: '021000021',
        accountType: 'checking',
      });
      expect(result.paymentToken).toBe('tok_bank_123');
      expect(result.tokenType).toBe('bank');
      expect(result.accountNumber).toBeUndefined(); // Should be removed
    });

    it('should handle no sensitive data', async () => {
      const paymentData = {
        amount: 100.50,
        currency: 'USD',
        description: 'Test payment',
      };

      const result = await paymentController.tokenizeSensitiveData(paymentData);

      expect(result).toEqual(paymentData); // Should return unchanged
      expect(mockServices.tokenService.tokenizeCard).not.toHaveBeenCalled();
      expect(mockServices.tokenService.tokenizeBankAccount).not.toHaveBeenCalled();
    });
  });

  describe('performFraudCheck', () => {
    it('should perform fraud check when enabled', async () => {
      const transactionData = {
        transactionId: 'txn_123',
        amount: 100.50,
        currency: 'USD',
      };

      mockServices.fraudService.scoreTransaction.mockResolvedValue({
        score: 0.3,
        isFraudulent: false,
        reasons: [],
        recommendedAction: 'proceed',
      });

      const result = await paymentController.performFraudCheck(transactionData);

      expect(mockServices.fraudService.scoreTransaction).toHaveBeenCalledWith(transactionData);
      expect(result.score).toBe(0.3);
      expect(result.isFraudulent).toBe(false);
    });

    it('should handle fraud service unavailable', async () => {
      const transactionData = {
        transactionId: 'txn_123',
        amount: 100.50,
        currency: 'USD',
      };

      mockServices.fraudService.scoreTransaction.mockRejectedValue(
        new Error('Service unavailable')
      );

      const result = await paymentController.performFraudCheck(transactionData);

      expect(logger.warn).toHaveBeenCalledWith(
        'Fraud service unavailable, proceeding with transaction',
        expect.any(Object)
      );
      expect(result.score).toBe(0);
      expect(result.isFraudulent).toBe(false);
      expect(result.reasons).toContain('fraud_service_unavailable');
    });
  });
});