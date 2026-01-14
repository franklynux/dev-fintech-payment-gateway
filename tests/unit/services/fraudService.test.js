const FraudService = require('../../../src/services/fraudService');
const axios = require('axios');
const logger = require('../../../src/utils/logger')();

jest.mock('axios');

describe('FraudService', () => {
  let fraudService;
  let config;

  beforeEach(() => {
    config = {
      fraudServiceUrl: 'https://fraud-service.example.com',
      apiKey: 'test-api-key',
      threshold: 0.7,
      enabled: true,
    };
    
    fraudService = new FraudService(config);
    
    // Mock logger
    logger.debug = jest.fn();
    logger.warn = jest.fn();
    logger.error = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('scoreTransaction', () => {
    it('should return fraud score when service is available', async () => {
      const transactionData = {
        id: 'txn_123',
        amount: 100.50,
        currency: 'USD',
        customerId: 'cust_123',
        email: 'test@example.com',
        ipAddress: '192.168.1.1',
      };

      const mockResponse = {
        data: {
          score: 0.85,
          reasons: ['high_risk_country', 'unusual_time'],
          recommendedAction: 'decline',
        },
      };

      axios.post.mockResolvedValue(mockResponse);

      const result = await fraudService.scoreTransaction(transactionData);

      expect(axios.post).toHaveBeenCalledWith(
        'https://fraud-service.example.com/score',
        expect.objectContaining({
          transaction: expect.objectContaining({
            id: 'txn_123',
            amount: 100.50,
            currency: 'USD',
          }),
        }),
        expect.objectContaining({
          headers: {
            'Authorization': 'Bearer test-api-key',
            'Content-Type': 'application/json',
          },
          timeout: 5000,
        })
      );

      expect(result).toEqual({
        score: 0.85,
        isFraudulent: true, // Above threshold of 0.7
        reasons: ['high_risk_country', 'unusual_time'],
        recommendedAction: 'decline',
      });
    });

    it('should mark as fraudulent when score exceeds threshold', async () => {
      const transactionData = {
        id: 'txn_123',
        amount: 100.50,
        currency: 'USD',
      };

      axios.post.mockResolvedValue({
        data: {
          score: 0.8, // Above 0.7 threshold
          reasons: [],
          recommendedAction: 'review',
        },
      });

      const result = await fraudService.scoreTransaction(transactionData);

      expect(result.isFraudulent).toBe(true);
    });

    it('should not mark as fraudulent when score is below threshold', async () => {
      const transactionData = {
        id: 'txn_123',
        amount: 100.50,
        currency: 'USD',
      };

      axios.post.mockResolvedValue({
        data: {
          score: 0.5, // Below 0.7 threshold
          reasons: [],
          recommendedAction: 'proceed',
        },
      });

      const result = await fraudService.scoreTransaction(transactionData);

      expect(result.isFraudulent).toBe(false);
    });

    it('should handle service timeout gracefully', async () => {
      const transactionData = {
        id: 'txn_123',
        amount: 100.50,
        currency: 'USD',
      };

      axios.post.mockRejectedValue(new Error('timeout of 5000ms exceeded'));

      const result = await fraudService.scoreTransaction(transactionData);

      expect(result).toEqual({
        score: 0,
        isFraudulent: false,
        reasons: ['fraud_service_unavailable'],
        recommendedAction: 'review',
      });

      expect(logger.error).toHaveBeenCalledWith(
        'Fraud service error:',
        'timeout of 5000ms exceeded'
      );
    });

    it('should handle network errors gracefully', async () => {
      const transactionData = {
        id: 'txn_123',
        amount: 100.50,
        currency: 'USD',
      };

      axios.post.mockRejectedValue(new Error('Network Error'));

      const result = await fraudService.scoreTransaction(transactionData);

      expect(result.isFraudulent).toBe(false);
      expect(result.reasons).toContain('fraud_service_unavailable');
    });

    it('should return default values when service is disabled', async () => {
      config.enabled = false;
      fraudService = new FraudService(config);

      const transactionData = {
        id: 'txn_123',
        amount: 100.50,
        currency: 'USD',
      };

      const result = await fraudService.scoreTransaction(transactionData);

      expect(axios.post).not.toHaveBeenCalled();
      expect(result).toEqual({
        score: 0,
        isFraudulent: false,
        reasons: [],
        recommendedAction: 'proceed',
      });

      expect(logger.debug).toHaveBeenCalledWith(
        'Fraud service disabled, skipping check'
      );
    });

    it('should prepare fraud payload correctly', async () => {
      const transactionData = {
        id: 'txn_123',
        amount: 100.50,
        currency: 'USD',
        customerId: 'cust_123',
        email: 'test@example.com',
        ipAddress: '192.168.1.1',
        deviceFingerprint: 'fingerprint_123',
        billingAddress: {
          line1: '123 Main St',
          city: 'New York',
          country: 'US',
        },
        shippingAddress: {
          line1: '456 Second St',
          city: 'New York',
          country: 'US',
        },
        items: [
          { id: 'item_1', name: 'Product 1', price: 50 },
          { id: 'item_2', name: 'Product 2', price: 50.50 },
        ],
        metadata: {
          orderId: 'order_123',
          userId: 'user_123',
        },
      };

      await fraudService.scoreTransaction(transactionData);

      expect(axios.post).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          transaction: {
            id: 'txn_123',
            amount: 100.50,
            currency: 'USD',
            customer: {
              id: 'cust_123',
              email: 'test@example.com',
              ip: '192.168.1.1',
              deviceFingerprint: 'fingerprint_123',
            },
            billing: {
              line1: '123 Main St',
              city: 'New York',
              country: 'US',
            },
            shipping: {
              line1: '456 Second St',
              city: 'New York',
              country: 'US',
            },
            items: [
              { id: 'item_1', name: 'Product 1', price: 50 },
              { id: 'item_2', name: 'Product 2', price: 50.50 },
            ],
            metadata: {
              orderId: 'order_123',
              userId: 'user_123',
            },
          },
        }),
        expect.any(Object)
      );
    });
  });

  describe('edge cases', () => {
    it('should handle missing optional fields', async () => {
      const transactionData = {
        id: 'txn_123',
        amount: 100.50,
        currency: 'USD',
        // Missing optional fields
      };

      axios.post.mockResolvedValue({
        data: {
          score: 0.1,
          reasons: [],
          recommendedAction: 'proceed',
        },
      });

      const result = await fraudService.scoreTransaction(transactionData);

      expect(result).toBeDefined();
      expect(axios.post).toHaveBeenCalled();
    });

    it('should handle invalid response from fraud service', async () => {
      const transactionData = {
        id: 'txn_123',
        amount: 100.50,
        currency: 'USD',
      };

      // Response missing required fields
      axios.post.mockResolvedValue({
        data: {
          // Missing score
          reasons: ['test'],
        },
      });

      await expect(fraudService.scoreTransaction(transactionData)).rejects.toThrow();
    });

    it('should use custom threshold when provided', async () => {
      config.threshold = 0.5;
      fraudService = new FraudService(config);

      const transactionData = {
        id: 'txn_123',
        amount: 100.50,
        currency: 'USD',
      };

      axios.post.mockResolvedValue({
        data: {
          score: 0.6, // Above 0.5 threshold
          reasons: [],
          recommendedAction: 'review',
        },
      });

      const result = await fraudService.scoreTransaction(transactionData);

      expect(result.isFraudulent).toBe(true);
    });
  });
});