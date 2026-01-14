const request = require('supertest');
const { app } = require('../../../src/app');
const { sequelize } = require('../../../src/config/database');
const { redis } = require('../../../src/config/redis');
const Merchant = require('../../../src/models/Merchant');
const Transaction = require('../../../src/models/Transaction');

describe('Payments API Integration', () => {
  let testMerchant;
  let apiKey;
  let testTransaction;

  beforeAll(async () => {
    // Sync database
    await sequelize.sync({ force: true });
    
    // Create test merchant
    testMerchant = await Merchant.create({
      name: 'Integration Test Merchant',
      email: 'integration@test.com',
      apiKey: 'test-api-key',
      apiKeySalt: 'test-salt',
      isActive: true,
      isPciCompliant: true,
      region: 'US',
      currency: 'USD',
      maxTransactionAmount: 1000000,
      allowedCurrencies: ['USD', 'EUR'],
      supportedProcessors: ['stripe', 'paypal'],
    });

    apiKey = 'test-api-key';

    // Create test transaction
    testTransaction = await Transaction.create({
      merchantId: testMerchant.id,
      processor: 'stripe',
      amount: 100.50,
      currency: 'USD',
      status: 'succeeded',
      paymentMethod: 'card',
      paymentToken: 'tok_test_123',
    });
  });

  afterAll(async () => {
    // Cleanup
    await Transaction.destroy({ where: {} });
    await Merchant.destroy({ where: {} });
    await redis.flushall();
    await sequelize.close();
  });

  beforeEach(async () => {
    // Clear Redis before each test
    await redis.flushall();
  });

  describe('POST /api/v1/payments/process', () => {
    it('should process payment successfully', async () => {
      const paymentData = {
        amount: 100.50,
        currency: 'USD',
        description: 'Integration test payment',
        paymentMethod: {
          type: 'card',
          card: {
            number: '4242424242424242',
            expMonth: 12,
            expYear: 2025,
            cvc: '123',
            name: 'Test Customer',
          },
        },
        metadata: {
          orderId: 'order_123',
          userId: 'user_123',
        },
      };

      const response = await request(app)
        .post('/api/v1/payments/process')
        .set('x-api-key', apiKey)
        .set('idempotency-key', 'test-idempotency-key-1')
        .send(paymentData);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('transactionId');
      expect(response.body).toHaveProperty('status', 'success');
      expect(response.body).toHaveProperty('processor');
      expect(response.body).toHaveProperty('fraudScore');
      expect(response.body).toHaveProperty('timestamp');

      // Verify transaction was created in database
      const transaction = await Transaction.findOne({
        where: { id: response.body.transactionId },
      });
      expect(transaction).toBeTruthy();
      expect(transaction.merchantId).toBe(testMerchant.id);
      expect(transaction.amount).toBe(100.50);
      expect(transaction.currency).toBe('USD');
    });

    it('should return idempotent response for duplicate request', async () => {
      const paymentData = {
        amount: 200.00,
        currency: 'USD',
        description: 'Idempotent test payment',
      };

      const idempotencyKey = 'test-idempotency-key-2';

      // First request
      const firstResponse = await request(app)
        .post('/api/v1/payments/process')
        .set('x-api-key', apiKey)
        .set('idempotency-key', idempotencyKey)
        .send(paymentData);

      expect(firstResponse.status).toBe(200);
      const firstTransactionId = firstResponse.body.transactionId;

      // Second request with same idempotency key
      const secondResponse = await request(app)
        .post('/api/v1/payments/process')
        .set('x-api-key', apiKey)
        .set('idempotency-key', idempotencyKey)
        .send(paymentData);

      expect(secondResponse.status).toBe(200);
      expect(secondResponse.body.transactionId).toBe(firstTransactionId);
    });

    it('should validate payment amount', async () => {
      const paymentData = {
        amount: 0, // Invalid amount
        currency: 'USD',
      };

      const response = await request(app)
        .post('/api/v1/payments/process')
        .set('x-api-key', apiKey)
        .send(paymentData);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'ValidationError');
      expect(response.body.details[0].field).toBe('amount');
    });

    it('should validate currency', async () => {
      const paymentData = {
        amount: 100.50,
        currency: 'INVALID', // Invalid currency
      };

      const response = await request(app)
        .post('/api/v1/payments/process')
        .set('x-api-key', apiKey)
        .send(paymentData);

      expect(response.status).toBe(400);
      expect(response.body.details[0].field).toBe('currency');
    });

    it('should require authentication', async () => {
      const paymentData = {
        amount: 100.50,
        currency: 'USD',
      };

      const response = await request(app)
        .post('/api/v1/payments/process')
        .send(paymentData);

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Unauthorized');
    });

    it('should handle invalid API key', async () => {
      const paymentData = {
        amount: 100.50,
        currency: 'USD',
      };

      const response = await request(app)
        .post('/api/v1/payments/process')
        .set('x-api-key', 'invalid-api-key')
        .send(paymentData);

      expect(response.status).toBe(401);
      expect(response.body).toHaveProperty('error', 'Unauthorized');
    });

    it('should handle inactive merchant', async () => {
      // Create inactive merchant
      const inactiveMerchant = await Merchant.create({
        name: 'Inactive Merchant',
        email: 'inactive@test.com',
        apiKey: 'inactive-key',
        apiKeySalt: 'inactive-salt',
        isActive: false,
        isPciCompliant: true,
      });

      const paymentData = {
        amount: 100.50,
        currency: 'USD',
      };

      const response = await request(app)
        .post('/api/v1/payments/process')
        .set('x-api-key', 'inactive-key')
        .send(paymentData);

      expect(response.status).toBe(403);
      expect(response.body).toHaveProperty('error', 'Forbidden');

      // Cleanup
      await Merchant.destroy({ where: { id: inactiveMerchant.id } });
    });
  });

  describe('GET /api/v1/payments/status/:transactionId', () => {
    it('should return payment status', async () => {
      const response = await request(app)
        .get(`/api/v1/payments/status/${testTransaction.id}`)
        .set('x-api-key', apiKey);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('transactionId', testTransaction.id);
      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should return 404 for non-existent transaction', async () => {
      const response = await request(app)
        .get('/api/v1/payments/status/non-existent-id')
        .set('x-api-key', apiKey);

      expect(response.status).toBe(404);
    });
  });

  describe('POST /api/v1/payments/refund', () => {
    it('should process refund successfully', async () => {
      const refundData = {
        originalTransactionId: testTransaction.id,
        amount: 50.25,
        reason: 'customer_return',
      };

      const response = await request(app)
        .post('/api/v1/payments/refund')
        .set('x-api-key', apiKey)
        .send(refundData);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('refundId');
      expect(response.body).toHaveProperty('transactionId', testTransaction.id);
      expect(response.body).toHaveProperty('status', 'refunded');
      expect(response.body).toHaveProperty('amount', 50.25);
    });

    it('should validate refund request', async () => {
      const refundData = {
        // Missing originalTransactionId
        amount: 50.25,
      };

      const response = await request(app)
        .post('/api/v1/payments/refund')
        .set('x-api-key', apiKey)
        .send(refundData);

      expect(response.status).toBe(400);
      expect(response.body).toHaveProperty('error', 'ValidationError');
    });
  });

  describe('GET /api/v1/payments/history', () => {
    it('should return payment history', async () => {
      // Create multiple test transactions
      const transactions = await Promise.all([
        Transaction.create({
          merchantId: testMerchant.id,
          processor: 'stripe',
          amount: 100,
          currency: 'USD',
          status: 'succeeded',
          paymentMethod: 'card',
        }),
        Transaction.create({
          merchantId: testMerchant.id,
          processor: 'paypal',
          amount: 200,
          currency: 'EUR',
          status: 'succeeded',
          paymentMethod: 'card',
        }),
      ]);

      const response = await request(app)
        .get('/api/v1/payments/history')
        .query({ limit: 10, page: 1 })
        .set('x-api-key', apiKey);

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('data');
      expect(response.body).toHaveProperty('pagination');
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.data.length).toBeGreaterThan(0);

      // Cleanup
      await Transaction.destroy({ where: { id: transactions.map(t => t.id) } });
    });

    it('should filter by date range', async () => {
      const startDate = new Date('2024-01-01').toISOString();
      const endDate = new Date('2024-12-31').toISOString();

      const response = await request(app)
        .get('/api/v1/payments/history')
        .query({ startDate, endDate })
        .set('x-api-key', apiKey);

      expect(response.status).toBe(200);
    });
  });

  describe('POST /api/v1/payments/capture/:transactionId', () => {
    it('should capture authorized payment', async () => {
      // Create an authorized transaction
      const authorizedTransaction = await Transaction.create({
        merchantId: testMerchant.id,
        processor: 'stripe',
        amount: 100.50,
        currency: 'USD',
        status: 'authorized',
        paymentMethod: 'card',
      });

      const response = await request(app)
        .post(`/api/v1/payments/capture/${authorizedTransaction.id}`)
        .set('x-api-key', apiKey)
        .send({ amount: 100.50 });

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'captured');

      // Cleanup
      await Transaction.destroy({ where: { id: authorizedTransaction.id } });
    });
  });

  describe('Health endpoints', () => {
    it('should return health status', async () => {
      const response = await request(app)
        .get('/api/v1/payments/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'healthy');
      expect(response.body).toHaveProperty('service', 'payment-processing');
    });

    it('should return API health status', async () => {
      const response = await request(app)
        .get('/api/v1/health');

      expect(response.status).toBe(200);
      expect(response.body).toHaveProperty('status', 'healthy');
    });
  });

  describe('Rate limiting', () => {
    it('should enforce rate limits', async () => {
      const paymentData = {
        amount: 100.50,
        currency: 'USD',
      };

      // Make multiple requests quickly
      const promises = [];
      for (let i = 0; i < 15; i++) {
        promises.push(
          request(app)
            .post('/api/v1/payments/process')
            .set('x-api-key', apiKey)
            .send(paymentData)
        );
      }

      const responses = await Promise.all(promises);
      
      // Some requests should be rate limited (429)
      const rateLimitedResponses = responses.filter(r => r.status === 429);
      expect(rateLimitedResponses.length).toBeGreaterThan(0);
    });
  });
});