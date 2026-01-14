# Fintech-Payment-Gateway-Proxy

## Specification

[Tech Spec](SPEC.md)

## Project Structure

### Directory Structure

```text
Fintech-Payment-Gateway-Proxy/
├── src/
│   ├── config/
│   │   ├── database.js       # Database configuration
│   │   ├── index.js           # Configuration management
│   │   ├── redis.js          # Redis configuration
│   │   └── pci.js            # PCI compliance config
│   ├── middleware/
│   │   ├── auth.js           # Authentication/Authorization
│   │   ├── index.js          # Export all middleware
│   │   ├── validation.js     # Request validation
│   │   ├── logging.js        # Structured logging
│   │   └── errorHandler.js   # Error handling
│   ├── services/
│   │   ├── processors/
│   │   │   ├── stripe.js     # Stripe integration
│   │   │   ├── paypal.js     # PayPal integration
│   │   │   └── processorFactory.js
│   │   ├── index.js          # Export all services
│   │   ├── eventProcessor.js # Event processing
│   │   ├── fraudService.js   # Fraud scoring
│   │   ├── routingService.js # Intelligent routing
│   │   ├── tokenService.js   # Tokenization
│   │   └── webhookService.js # Webhook processing
│   ├── controllers/
│   │   ├── paymentController.js
│   │   └── webhookController.js
│   ├── routes/
│   │   ├── index.js
│   │   ├── payments.js       # Payment endpoints
│   │   └── webhooks.js       # Webhook endpoints
│   ├── models/
│   │   ├── Transaction.js
│   │   └── Merchant.js
│   ├── utils/
│   │   ├── errors/
│   │   ├── idempotency.js    # Idempotency keys
│   │   ├── retry.js          # Retry logic
│   │   ├── logger.js         # Structured logging
│   │   ├── encryption.js     # Secure data handling
│   │   └── metrics.js        # Prometheus metrics
│   └── app.js               # Main application
├── tests/
│   ├── unit/
|   │   ├── services/
│   │   │   ├── processors/
│   │   │   │   ├── stripe.test.js
│   │   │   │   └── paypal.test.js
│   │   │   ├── fraudService.test.js
│   │   │   ├── routingService.test.js
│   │   │   ├── tokenService.test.js
│   │   │   └── webhookService.test.js
│   │   ├── controllers/
│   │   │   ├── paymentController.test.js
│   │   │   └── webhookController.test.js
│   │   ├── middleware/
│   │   │   ├── auth.test.js
│   │   │   ├── validation.test.js
│   │   │   ├── logging.test.js
│   │   │   └── errorHandler.test.js
│   │   ├── utils/
│   │   │   ├── idempotency.test.js
│   │   │   ├── retry.test.js
│   │   │   ├── logger.test.js
│   │   │   ├── encryption.test.js
│   │   │   └── metrics.test.js
│   ├── integration/
│   │   ├── api/
│   │   │   ├── payment.test.js
│   │   │   └── webhook.test.js
│   │   ├── services/
│   │   │   ├── paymentFlow.test.js
│   │   │   └── webhookFlow.test.js
│   ├── fixtures/
│   │   ├── stripeWebhook.json
│   │   └── paypalWebhook.json
│   ├── performance/
│   │   └── loadTest.js
│   ├── jest.config.js
│   └── test-setup.js 
├── .dockerignore
├── .env.example
├── .gitignore
├── .trivy-config.yaml
├── .trivyignore
├── .github/
│   └── workflows/
│       └── trivy-scans.yml
├── docker-compose.yml
├── Dockerfile
├── package-lock.json
├── package.json
├── README.md
├── server.js
├── SPEC.md
└── trivy-secret.yaml
```

### How to Run

1. **Clone the Repository**  
   ```bash
   git clone
   cd Fintech-Payment-Gateway-Proxy
   ```
2. **Install Dependencies**  
   ```bash
   npm install
   ```
3. **Setup environment variables**
   - Create `.env` file based on `.env.example`
4. **Start the Application**  
   ```bash
   # Development
   npm run dev

   # Production
   npm start
   ```
5. Check `health` and `ready` endpoints.
   ```bash
   # Basic health endpoint
   http :8888/health

   # All dependencies readiness endpoint
   http :8888/ready
   ```
6. Run tests
   ```bash
   # Install test dependencies
   npm install --save-dev jest supertest autocannon coveralls
   
   # Create test database
   createdb payment_gateway_test
   
   # Start Redis on test port
   redis-server --port 6380
   
   # Run all tests
   npm test

   # With coverage
   npm test -- --coverage
   
   # Watch mode
   npm run test:watch

   # Run Unit tests only
   npm run test:unit
   
   # Run Integration tests only
   npm run test:integration

   # Run Performance tests only
   npm run test:performance
   ```

## Security Scans Workflow (Trivy)

### Workflow Overview

This project includes a GitHub Actions workflow for automated security scanning using **Trivy**. The workflow is triggered automatically on every **push** and **pull request** to any branch. The workflow performs multiple types of security scans to ensure the repository and its configuration are safe from vulnerabilities and misconfigurations. The main steps are:

1. **Checkout Repository**  
   The workflow starts by checking out the repository code using `actions/checkout@v4`.

2. **Install Trivy**  
   Trivy is installed on the runner using the official Aquasecurity repository. Required dependencies (`wget`, `apt-transport-https`, etc.) are installed to enable Trivy installation.

3. **Cache Trivy Database**  
   Trivy downloads a vulnerability database to detect security issues. The workflow caches this database (`~/.cache/trivy`) between runs to speed up subsequent scans.

4. **Secret Scanning**  
   Trivy scans the filesystem (`trivy fs`) for **secrets** such as API keys or credentials, focusing on **high** and **critical** severity. If any issues are found, the workflow fails with `--exit-code 1`.

5. **Vulnerability Scanning**  
   The workflow scans for **high and critical vulnerabilities** in dependencies, container images, and configuration files. Detected issues will fail the workflow, ensuring that vulnerabilities are caught early.

6. **Misconfiguration (PCI) Scanning**  
   Trivy also checks for **misconfigurations** in Dockerfiles, Kubernetes manifests, Terraform scripts, CloudFormation templates, YAML, and JSON files. Custom policies from the `./policies` directory are applied, with medium and higher severity issues causing the workflow to fail.

### Environment

- Runs on `ubuntu-latest` GitHub Actions runner.
- Uses `TRIVY_CACHE_DIR` to store the vulnerability database locally.

### Outcome

- If any secrets, vulnerabilities, or misconfigurations are detected at the configured severity levels, the workflow fails and prevents merging until issues are addressed.
- This ensures that code merged into the repository meets security standards and reduces the risk of introducing vulnerabilities.

