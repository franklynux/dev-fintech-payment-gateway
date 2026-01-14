const path = require('path');
const dotenv = require('dotenv');

// Load test environment variables
dotenv.config({ path: path.join(__dirname, '../.env.test') });

// Mock environment variables for testing
process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-jwt-secret';
process.env.DATABASE_URL = 'postgresql://postgres:postgres@localhost:5432/payment_gateway_test';
process.env.REDIS_URL = 'redis://localhost:6380';
process.env.STRIPE_SECRET_KEY = 'sk_test_mock_stripe_key';
process.env.PAYPAL_CLIENT_ID = 'mock_paypal_client_id';
process.env.PAYPAL_CLIENT_SECRET = 'mock_paypal_client_secret';

// Global test timeout
jest.setTimeout(30000);

// Global test setup
beforeAll(async () => {
  // Setup database connection
  const { sequelize } = require('../../src/config/database');
  await sequelize.authenticate();
  
  // Clear Redis
  const redis = require('../../src/config/redis');
  await redis.flushall();
});

// Global test teardown
afterAll(async () => {
  // Close database connection
  const { sequelize } = require('../../src/config/database');
  await sequelize.close();
  
  // Close Redis
  const redis = require('../../src/config/redis');
  await redis.quit();
  
  // Close any other connections
});

// Global mocks
global.console = {
  ...console,
  // Mock console methods for cleaner test output
  log: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

// Mock external APIs
jest.mock('stripe', () => {
  return jest.fn().mockImplementation(() => ({
    paymentIntents: {
      create: jest.fn(),
      retrieve: jest.fn(),
      capture: jest.fn(),
      cancel: jest.fn(),
    },
    customers: {
      create: jest.fn(),
      list: jest.fn(),
    },
    refunds: {
      create: jest.fn(),
    },
    webhooks: {
      constructEvent: jest.fn(),
    },
  }));
});

jest.mock('@paypal/checkout-server-sdk', () => ({
  core: {
    SandboxEnvironment: jest.fn(),
    LiveEnvironment: jest.fn(),
    PayPalHttpClient: jest.fn().mockImplementation(() => ({
      execute: jest.fn(),
    })),
  },
  orders: {
    OrdersCreateRequest: jest.fn(),
    OrdersCaptureRequest: jest.fn(),
    OrdersGetRequest: jest.fn(),
  },
  payments: {
    CapturesRefundRequest: jest.fn(),
    AuthorizationsVoidRequest: jest.fn(),
  },
}));

// Test utilities
global.createTestMerchant = () => ({
  id: 'test-merchant-123',
  name: 'Test Merchant',
  email: 'test@merchant.com',
  isActive: true,
  isPciCompliant: true,
  region: 'US',
  currency: 'USD',
  maxTransactionAmount: 1000000,
  allowedCurrencies: ['USD', 'EUR', 'GBP'],
  supportedProcessors: ['stripe', 'paypal'],
  routingRules: {
    strategy: 'cost',
    priority: ['stripe', 'paypal'],
  },
  fraudSettings: {
    enabled: true,
    threshold: 0.7,
    autoDecline: false,
  },
});

global.createTestPayment = () => ({
  amount: 100.50,
  currency: 'USD',
  description: 'Test payment',
  customerId: 'cust_test_123',
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
});

global.createTestWebhook = (source = 'stripe') => ({
  id: `wh_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
  type: 'payment_intent.succeeded',
  created: Math.floor(Date.now() / 1000),
  data: {
    object: {
      id: 'pi_test_123',
      amount: 10050,
      currency: 'usd',
      status: 'succeeded',
      customer: 'cus_test_123',
    },
  },
  livemode: false,
});