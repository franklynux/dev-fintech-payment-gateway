const autocannon = require('autocannon');
const { createServer } = require('http');
const { app } = require('../../src/app');

// Performance test configuration
const performanceConfig = {
  warmupRequests: 100,
  testDuration: 30, // seconds
  concurrentConnections: 10,
  requestsPerSecond: 50,
  timeout: 30,
};

async function runLoadTest() {
  // Start the server
  const server = createServer(app);
  await new Promise((resolve) => {
    server.listen(0, 'localhost', resolve);
  });
  
  const port = server.address().port;
  const baseUrl = `http://localhost:${port}`;

  console.log('🚀 Starting performance tests...');
  console.log(`📡 Server running at ${baseUrl}`);

  // Test scenarios
  const scenarios = [
    {
      name: 'Payment Processing',
      path: '/api/v1/payments/process',
      method: 'POST',
      body: JSON.stringify({
        amount: 100.50,
        currency: 'USD',
        description: 'Load test payment',
        paymentMethod: {
          type: 'card',
          card: {
            number: '4242424242424242',
            expMonth: 12,
            expYear: 2025,
            cvc: '123',
            name: 'Load Test Customer',
          },
        },
        metadata: {
          test: true,
          loadTest: true,
        },
      }),
      headers: {
        'x-api-key': 'test-api-key',
        'idempotency-key': `load-test-${Date.now()}`,
        'content-type': 'application/json',
      },
    },
    {
      name: 'Payment Status Check',
      path: '/api/v1/payments/status/test-transaction',
      method: 'GET',
      headers: {
        'x-api-key': 'test-api-key',
      },
    },
    {
      name: 'Health Check',
      path: '/api/v1/health',
      method: 'GET',
    },
  ];

  const results = [];

  for (const scenario of scenarios) {
    console.log(`\n🔍 Testing: ${scenario.name}`);
    
    const result = await autocannon({
      url: `${baseUrl}${scenario.path}`,
      method: scenario.method,
      headers: scenario.headers,
      body: scenario.body,
      connections: performanceConfig.concurrentConnections,
      duration: performanceConfig.testDuration,
      pipelining: 1,
      timeout: performanceConfig.timeout,
      title: scenario.name,
    });

    results.push({
      scenario: scenario.name,
      requests: result.requests.total,
      latency: result.latency,
      throughput: result.throughput,
      errors: result.errors,
      '2xx': result['2xx'],
      '4xx': result['4xx'],
      '5xx': result['5xx'],
    });

    autocannon.printResult(result);
  }

  // Generate summary
  console.log('\n📊 Performance Test Summary');
  console.log('='.repeat(50));
  results.forEach((result, index) => {
    console.log(`\n${index + 1}. ${result.scenario}`);
    console.log(`   Requests: ${result.requests.toLocaleString()}`);
    console.log(`   Avg Latency: ${result.latency.average.toFixed(2)}ms`);
    console.log(`   P95 Latency: ${result.latency.p95.toFixed(2)}ms`);
    console.log(`   P99 Latency: ${result.latency.p99.toFixed(2)}ms`);
    console.log(`   Throughput: ${result.throughput.toFixed(2)} req/sec`);
    console.log(`   Success Rate: ${((result['2xx'] / result.requests) * 100).toFixed(2)}%`);
    console.log(`   Errors: ${result.errors}`);
  });

  // Calculate overall statistics
  const totalRequests = results.reduce((sum, r) => sum + r.requests, 0);
  const avgLatency = results.reduce((sum, r) => sum + r.latency.average, 0) / results.length;
  const successRate = results.reduce((sum, r) => sum + (r['2xx'] / r.requests), 0) / results.length * 100;

  console.log('\n📈 Overall Statistics');
  console.log('='.repeat(50));
  console.log(`Total Requests: ${totalRequests.toLocaleString()}`);
  console.log(`Average Latency: ${avgLatency.toFixed(2)}ms`);
  console.log(`Overall Success Rate: ${successRate.toFixed(2)}%`);

  // Performance thresholds
  const thresholds = {
    maxLatencyP95: 1000, // 1 second
    minSuccessRate: 99, // 99%
    maxErrorRate: 1, // 1%
  };

  console.log('\n⚡ Performance Thresholds');
  console.log('='.repeat(50));

  let allPassed = true;
  results.forEach(result => {
    const errorRate = ((result.errors + result['4xx'] + result['5xx']) / result.requests) * 100;
    const passed = 
      result.latency.p95 <= thresholds.maxLatencyP95 &&
      errorRate <= thresholds.maxErrorRate;
    
    if (!passed) allPassed = false;
    
    console.log(`${result.scenario}: ${passed ? '✅ PASS' : '❌ FAIL'}`);
    console.log(`  P95 Latency: ${result.latency.p95.toFixed(2)}ms (max: ${thresholds.maxLatencyP95}ms)`);
    console.log(`  Error Rate: ${errorRate.toFixed(2)}% (max: ${thresholds.maxErrorRate}%)`);
  });

  console.log(`\nOverall Result: ${allPassed ? '✅ ALL TESTS PASSED' : '❌ SOME TESTS FAILED'}`);

  // Close server
  server.close();

  // Exit with appropriate code
  process.exit(allPassed ? 0 : 1);
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled rejection:', error);
  process.exit(1);
});

// Run tests
if (require.main === module) {
  runLoadTest().catch((error) => {
    console.error('❌ Test failed:', error);
    process.exit(1);
  });
}

module.exports = { runLoadTest };