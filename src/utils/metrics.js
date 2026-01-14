const client = require('prom-client');
const responseTime = require('response-time');

class MetricsService {
  constructor(namespace = 'payment_gateway') {
    this.namespace = namespace;
    this.collectDefaultMetrics();
    this.initCustomMetrics();
  }

  /**
   * Collect default Node.js metrics
   */
  collectDefaultMetrics() {
    client.collectDefaultMetrics({
      prefix: `${this.namespace}_`,
      timeout: 5000,
    });
  }

  /**
   * Initialize custom metrics
   */
  initCustomMetrics() {
    // Transaction metrics
    this.transactionsTotal = new client.Counter({
      name: `${this.namespace}_transactions_total`,
      help: 'Total number of payment transactions',
      labelNames: ['processor', 'status', 'merchant_id', 'payment_method'],
    });

    this.transactionDuration = new client.Histogram({
      name: `${this.namespace}_transaction_duration_seconds`,
      help: 'Payment transaction duration in seconds',
      labelNames: ['processor', 'status'],
      buckets: [0.1, 0.5, 1, 2, 5, 10],
    });

    this.transactionAmount = new client.Histogram({
      name: `${this.namespace}_transaction_amount`,
      help: 'Transaction amount distribution',
      labelNames: ['processor', 'currency'],
      buckets: [10, 50, 100, 500, 1000, 5000, 10000],
    });

    // Fraud metrics
    this.fraudScore = new client.Histogram({
      name: `${this.namespace}_fraud_score`,
      help: 'Fraud score distribution',
      buckets: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0],
    });

    this.fraudDecisions = new client.Counter({
      name: `${this.namespace}_fraud_decisions_total`,
      help: 'Total number of fraud decisions',
      labelNames: ['decision', 'reason'],
    });

    // Processor metrics
    this.processorRequests = new client.Counter({
      name: `${this.namespace}_processor_requests_total`,
      help: 'Total number of processor API requests',
      labelNames: ['processor', 'endpoint', 'status'],
    });

    this.processorLatency = new client.Histogram({
      name: `${this.namespace}_processor_latency_seconds`,
      help: 'Processor API latency in seconds',
      labelNames: ['processor', 'endpoint'],
      buckets: [0.1, 0.5, 1, 2, 5, 10],
    });

    // Error metrics
    this.errorsTotal = new client.Counter({
      name: `${this.namespace}_errors_total`,
      help: 'Total number of errors',
      labelNames: ['type', 'processor', 'endpoint'],
    });

    this.httpErrors = new client.Counter({
      name: `${this.namespace}_http_errors_total`,
      help: 'Total number of HTTP errors',
      labelNames: ['status_code', 'path', 'method'],
    });

    // Business metrics
    this.revenueTotal = new client.Counter({
      name: `${this.namespace}_revenue_total`,
      help: 'Total revenue processed',
      labelNames: ['processor', 'currency'],
    });

    this.refundsTotal = new client.Counter({
      name: `${this.namespace}_refunds_total`,
      help: 'Total number of refunds',
      labelNames: ['processor', 'reason'],
    });

    this.refundAmount = new client.Counter({
      name: `${this.namespace}_refund_amount`,
      help: 'Total amount refunded',
      labelNames: ['processor', 'currency'],
    });

    // Routing metrics
    this.routingDecisions = new client.Counter({
      name: `${this.namespace}_routing_decisions_total`,
      help: 'Total number of routing decisions',
      labelNames: ['processor', 'strategy', 'reason'],
    });

    this.routingSuccess = new client.Gauge({
      name: `${this.namespace}_routing_success_rate`,
      help: 'Success rate by processor',
      labelNames: ['processor'],
    });

    // Queue and processing metrics
    this.queueSize = new client.Gauge({
      name: `${this.namespace}_queue_size`,
      help: 'Current queue size',
      labelNames: ['queue_name'],
    });

    this.processingTime = new client.Histogram({
      name: `${this.namespace}_processing_time_seconds`,
      help: 'Processing time for async jobs',
      labelNames: ['job_type'],
      buckets: [0.1, 1, 5, 10, 30, 60],
    });
  }

  /**
   * Middleware to track HTTP requests
   */
  middleware() {
    const httpRequestDuration = new client.Histogram({
      name: `${this.namespace}_http_request_duration_seconds`,
      help: 'Duration of HTTP requests in seconds',
      labelNames: ['method', 'route', 'status_code'],
      buckets: [0.1, 0.5, 1, 2, 5, 10],
    });

    const httpRequestsTotal = new client.Counter({
      name: `${this.namespace}_http_requests_total`,
      help: 'Total number of HTTP requests',
      labelNames: ['method', 'route', 'status_code'],
    });

    return responseTime((req, res, time) => {
      const route = req.route?.path || req.path;
      const statusCode = res.statusCode;
      const method = req.method;

      httpRequestDuration
        .labels(method, route, statusCode)
        .observe(time / 1000);

      httpRequestsTotal
        .labels(method, route, statusCode)
        .inc();
    });
  }

  /**
   * Handler for /metrics endpoint
   */
  async handler(req, res) {
    try {
      res.set('Content-Type', client.register.contentType);
      const metrics = await client.register.metrics();
      res.end(metrics);
    } catch (error) {
      res.status(500).end(error.message);
    }
  }

  /**
   * Record transaction metrics
   */
  recordTransaction(transaction) {
    const { processor, status, amount, currency, merchantId, paymentMethod } = transaction;
    
    this.transactionsTotal
      .labels(processor, status, merchantId, paymentMethod)
      .inc();

    if (amount && currency) {
      this.transactionAmount
        .labels(processor, currency)
        .observe(parseFloat(amount));

      if (status === 'succeeded') {
        this.revenueTotal
          .labels(processor, currency)
          .inc(parseFloat(amount));
      }
    }
  }

  /**
   * Record fraud decision
   */
  recordFraudDecision(score, decision, reason) {
    this.fraudScore.observe(parseFloat(score));
    this.fraudDecisions
      .labels(decision, reason)
      .inc();
  }

  /**
   * Record processor request
   */
  recordProcessorRequest(processor, endpoint, duration, success = true) {
    const status = success ? 'success' : 'error';
    
    this.processorRequests
      .labels(processor, endpoint, status)
      .inc();

    this.processorLatency
      .labels(processor, endpoint)
      .observe(duration);
  }

  /**
   * Record error
   */
  recordError(type, processor = null, endpoint = null) {
    this.errorsTotal
      .labels(type, processor || 'unknown', endpoint || 'unknown')
      .inc();
  }

  /**
   * Record routing decision
   */
  recordRoutingDecision(processor, strategy, reason) {
    this.routingDecisions
      .labels(processor, strategy, reason)
      .inc();
  }

  /**
   * Update routing success rate
   */
  updateRoutingSuccessRate(processor, successRate) {
    this.routingSuccess
      .labels(processor)
      .set(successRate);
  }

  /**
   * Record refund
   */
  recordRefund(processor, amount, currency, reason) {
    this.refundsTotal
      .labels(processor, reason)
      .inc();

    this.refundAmount
      .labels(processor, currency)
      .inc(parseFloat(amount));
  }

  /**
   * Set queue size
   */
  setQueueSize(queueName, size) {
    this.queueSize
      .labels(queueName)
      .set(size);
  }

  /**
   * Record processing time
   */
  recordProcessingTime(jobType, duration) {
    this.processingTime
      .labels(jobType)
      .observe(duration);
  }

  /**
   * Reset metrics (for testing)
   */
  reset() {
    client.register.resetMetrics();
  }

  /**
   * Get metrics as JSON
   */
  async getMetrics() {
    const metrics = await client.register.getMetricsAsJSON();
    return metrics;
  }

  /**
   * Get specific metric
   */
  async getMetric(name) {
    const metrics = await this.getMetrics();
    return metrics.find(metric => metric.name === name);
  }

  /**
   * Create a timer for measuring operation duration
   */
  startTimer(metric, labels = {}) {
    const end = this[metric].startTimer();
    return (additionalLabels = {}) => {
      const allLabels = { ...labels, ...additionalLabels };
      end(allLabels);
    };
  }
}

// Singleton instance
let instance = null;

function getMetricsService(namespace) {
  if (!instance) {
    instance = new MetricsService(namespace);
  }
  return instance;
}

module.exports = getMetricsService;