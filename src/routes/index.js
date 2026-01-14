const express = require('express');
const router = express.Router();
const paymentRoutes = require('./payment');
const webhookRoutes = require('./webhook');

// Mount routes
router.use('/payments', paymentRoutes);
router.use('/webhooks', webhookRoutes);

// API documentation route
router.get('/docs', (req, res) => {
  res.json({
    name: 'Payment Gateway Proxy API',
    version: '1.0.0',
    endpoints: {
      payments: {
        process: 'POST /api/v1/payments/process',
        status: 'GET /api/v1/payments/status/:transactionId',
        refund: 'POST /api/v1/payments/refund',
        history: 'GET /api/v1/payments/history',
        capture: 'POST /api/v1/payments/capture/:transactionId',
        void: 'POST /api/v1/payments/void/:transactionId',
      },
      webhooks: {
        stripe: 'POST /api/v1/webhooks/stripe',
        paypal: 'POST /api/v1/webhooks/paypal',
        generic: 'POST /api/v1/webhooks/:processor',
        internal: 'POST /api/v1/webhooks/internal',
        status: 'GET /api/v1/webhooks/status/:webhookId',
        events: 'GET /api/v1/webhooks/events/:transactionId',
        config: 'GET /api/v1/webhooks/config/:merchantId',
      },
    },
    documentation: 'https://docs.example.com/payment-gateway',
    support: 'support@example.com',
  });
});

// API health check
router.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'payment-gateway-proxy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// API version information
router.get('/version', (req, res) => {
  res.json({
    api: 'payment-gateway-proxy',
    version: '1.0.0',
    build: process.env.BUILD_ID || 'local',
    commit: process.env.COMMIT_SHA || 'unknown',
    environment: process.env.NODE_ENV,
  });
});

module.exports = router;