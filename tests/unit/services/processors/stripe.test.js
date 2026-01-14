const StripeProcessor = require('../../../src/services/processors/stripe');
const logger = require('../../../src/utils/logger')();

describe('StripeProcessor', () => {
  let stripeProcessor;
  let mockStripe;

  beforeEach(() => {
    // Clear all mocks
    jest.clearAllMocks();
    
    // Create processor instance
    stripeProcessor = new StripeProcessor();
    
    // Get the mocked stripe instance
    mockStripe = stripeProcessor.stripe;
    
    // Mock logger
    logger.info = jest.fn();
    logger.error = jest.fn();
  });

  describe('processPayment', () => {
    it('should process payment successfully', async () => {
      const paymentData = {
        amount: 100.50,
        currency: 'USD',
        description: 'Test payment',
        customerId: 'cust_test_123',
      };

      const mockPaymentIntent = {
        id: 'pi_test_123',
        status: 'succeeded',
        client_secret: 'pi_test_secret',
        amount: 10050,
        currency: 'usd',
      };

      mockStripe.paymentIntents.create.mockResolvedValue(mockPaymentIntent);

      const result = await stripeProcessor.processPayment(paymentData);

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith({
        amount: 10050,
        currency: 'usd',
        description: 'Test payment',
        metadata: {},
        capture_method: 'automatic',
        confirm: true,
        customer: 'cust_test_123',
      });

      expect(result).toEqual({
        processor: 'stripe',
        transactionId: 'pi_test_123',
        status: 'succeeded',
        rawResponse: mockPaymentIntent,
        requiresAction: false,
        clientSecret: 'pi_test_secret',
        nextAction: undefined,
      });

      expect(logger.info).toHaveBeenCalledWith(
        'Stripe payment processed',
        expect.objectContaining({
          paymentIntentId: 'pi_test_123',
          amount: 100.50,
          currency: 'USD',
        })
      );
    });

    it('should handle payment failure', async () => {
      const paymentData = {
        amount: 100.50,
        currency: 'USD',
      };

      const mockError = new Error('Card declined');
      mockError.code = 'card_declined';
      mockError.type = 'card_error';

      mockStripe.paymentIntents.create.mockRejectedValue(mockError);

      await expect(stripeProcessor.processPayment(paymentData)).rejects.toThrow();

      expect(logger.error).toHaveBeenCalledWith(
        'Stripe payment failed',
        expect.objectContaining({
          error: 'Card declined',
          code: 'card_declined',
          amount: 100.50,
          currency: 'USD',
        })
      );
    });

    it('should convert amount to smallest currency unit', async () => {
      const paymentData = {
        amount: 100.50,
        currency: 'USD',
      };

      mockStripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_test_123',
        status: 'succeeded',
      });

      await stripeProcessor.processPayment(paymentData);

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 10050, // cents
        })
      );
    });

    it('should handle zero-decimal currencies correctly', async () => {
      const paymentData = {
        amount: 1000,
        currency: 'JPY', // Zero-decimal currency
      };

      mockStripe.paymentIntents.create.mockResolvedValue({
        id: 'pi_test_123',
        status: 'succeeded',
      });

      await stripeProcessor.processPayment(paymentData);

      expect(mockStripe.paymentIntents.create).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: 1000, // unchanged
        })
      );
    });
  });

  describe('capturePayment', () => {
    it('should capture payment successfully', async () => {
      const paymentIntentId = 'pi_test_123';
      const amount = 50.25;

      mockStripe.paymentIntents.capture.mockResolvedValue({
        id: paymentIntentId,
        status: 'succeeded',
      });

      const result = await stripeProcessor.capturePayment(paymentIntentId, amount);

      expect(mockStripe.paymentIntents.capture).toHaveBeenCalledWith(
        paymentIntentId,
        { amount_to_capture: 5025 }
      );

      expect(result.id).toBe(paymentIntentId);
    });
  });

  describe('refundPayment', () => {
    it('should refund payment successfully', async () => {
      const paymentIntentId = 'pi_test_123';
      const amount = 50.25;
      const reason = 'duplicate';

      mockStripe.refunds.create.mockResolvedValue({
        id: 're_test_123',
        status: 'succeeded',
      });

      const result = await stripeProcessor.refundPayment(paymentIntentId, amount, reason);

      expect(mockStripe.refunds.create).toHaveBeenCalledWith({
        payment_intent: paymentIntentId,
        amount: 5025,
        reason,
      });

      expect(result.id).toBe('re_test_123');
    });
  });

  describe('healthCheck', () => {
    it('should return healthy when stripe is accessible', async () => {
      mockStripe.balance.retrieve.mockResolvedValue({});

      const result = await stripeProcessor.healthCheck();

      expect(result).toEqual({
        healthy: true,
        processor: 'stripe',
        timestamp: expect.any(String),
      });
    });

    it('should return unhealthy when stripe is inaccessible', async () => {
      mockStripe.balance.retrieve.mockRejectedValue(new Error('API error'));

      const result = await stripeProcessor.healthCheck();

      expect(result).toEqual({
        healthy: false,
        processor: 'stripe',
        error: 'API error',
        timestamp: expect.any(String),
      });
    });
  });

  describe('convertToSmallestUnit', () => {
    it('should convert USD to cents', () => {
      const amount = 100.50;
      const currency = 'USD';
      const result = stripeProcessor.convertToSmallestUnit(amount, currency);
      expect(result).toBe(10050);
    });

    it('should not convert JPY (zero-decimal)', () => {
      const amount = 1000;
      const currency = 'JPY';
      const result = stripeProcessor.convertToSmallestUnit(amount, currency);
      expect(result).toBe(1000);
    });

    it('should round fractional amounts', () => {
      const amount = 100.555;
      const currency = 'USD';
      const result = stripeProcessor.convertToSmallestUnit(amount, currency);
      expect(result).toBe(10056); // rounded up
    });
  });

  describe('mapStatus', () => {
    it('should map stripe status to internal status', () => {
      expect(stripeProcessor.mapStatus('succeeded')).toBe('succeeded');
      expect(stripeProcessor.mapStatus('requires_action')).toBe('pending');
      expect(stripeProcessor.mapStatus('canceled')).toBe('voided');
      expect(stripeProcessor.mapStatus('processing')).toBe('processing');
      expect(stripeProcessor.mapStatus('unknown_status')).toBe('unknown_status');
    });
  });

  describe('calculateFee', () => {
    it('should calculate fee for USD transaction', async () => {
      const amount = 100;
      const currency = 'USD';
      
      const fee = await stripeProcessor.calculateFee(amount, currency);
      
      // 2.9% of 100 = 2.9 + 0.30 = 3.20
      expect(fee).toBeCloseTo(3.20, 2);
    });

    it('should handle non-USD currencies', async () => {
      const amount = 100;
      const currency = 'EUR';
      
      const fee = await stripeProcessor.calculateFee(amount, currency);
      
      // Should convert EUR to USD first (using mock conversion rate)
      expect(typeof fee).toBe('number');
      expect(fee).toBeGreaterThan(0);
    });
  });
});