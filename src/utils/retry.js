const config = require('../config');

class RetryManager {
  constructor(options = {}) {
    this.maxAttempts = options.maxAttempts || config.retry.maxAttempts || 3;
    this.initialDelay = options.initialDelay || config.retry.initialDelay || 1000;
    this.maxDelay = options.maxDelay || config.retry.maxDelay || 10000;
    this.backoffFactor = options.backoffFactor || config.retry.backoffFactor || 2;
    this.jitter = options.jitter !== false;
    this.logger = options.logger || console;
  }

  /**
   * Execute an operation with retry logic
   */
  async execute(operation, options = {}) {
    const {
      maxAttempts = this.maxAttempts,
      operationName = 'operation',
      context = {},
      shouldRetry = this.defaultShouldRetry,
      onRetry = this.defaultOnRetry,
    } = options;

    let lastError;
    let attempt = 0;

    while (attempt < maxAttempts) {
      attempt++;
      
      try {
        const result = await operation();
        this.logger.debug(`${operationName} succeeded on attempt ${attempt}`, {
          attempt,
          operationName,
          ...context,
        });
        return result;
      } catch (error) {
        lastError = error;
        
        // Check if we should retry
        if (attempt >= maxAttempts || !shouldRetry(error)) {
          this.logger.error(`${operationName} failed after ${attempt} attempts`, {
            attempt,
            operationName,
            error: error.message,
            ...context,
          });
          throw this.enhanceError(error, attempt);
        }

        // Calculate delay with exponential backoff and optional jitter
        const delay = this.calculateDelay(attempt);
        
        // Call onRetry callback
        await onRetry(error, attempt, delay, context);
        
        this.logger.warn(`${operationName} failed, retrying in ${delay}ms`, {
          attempt,
          operationName,
          error: error.message,
          nextAttemptInMs: delay,
          ...context,
        });

        // Wait before retrying
        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Default retry condition
   */
  defaultShouldRetry(error) {
    // Retry on network errors, timeouts, and 5xx errors
    if (error.code) {
      const retryableCodes = [
        'ECONNRESET',
        'ECONNREFUSED',
        'ETIMEDOUT',
        'ENOTFOUND',
        'EAI_AGAIN',
      ];
      if (retryableCodes.includes(error.code)) {
        return true;
      }
    }

    // Retry on certain HTTP status codes
    if (error.response && error.response.status) {
      const retryableStatusCodes = [408, 429, 500, 502, 503, 504];
      return retryableStatusCodes.includes(error.response.status);
    }

    // Retry on timeout
    if (error.message && error.message.includes('timeout')) {
      return true;
    }

    // Don't retry on client errors (4xx except 429)
    if (error.response && error.response.status >= 400 && error.response.status < 500) {
      return false;
    }

    // Default to retrying (fail-open)
    return true;
  }

  /**
   * Default retry callback
   */
  defaultOnRetry(error, attempt, delay, context) {
    // Can be overridden for metrics, logging, etc.
    return Promise.resolve();
  }

  /**
   * Calculate delay with exponential backoff and jitter
   */
  calculateDelay(attempt) {
    let delay = this.initialDelay * Math.pow(this.backoffFactor, attempt - 1);
    delay = Math.min(delay, this.maxDelay);
    
    if (this.jitter) {
      // Add ±10% jitter to avoid thundering herd
      const jitter = delay * 0.1;
      delay = delay - jitter + (Math.random() * 2 * jitter);
    }
    
    return Math.floor(delay);
  }

  /**
   * Sleep for specified milliseconds
   */
  sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Enhance error with retry information
   */
  enhanceError(error, attempt) {
    if (!error.retryInfo) {
      error.retryInfo = {
        attempts: attempt,
        retryable: true,
      };
    }
    return error;
  }

  /**
   * Execute multiple operations in parallel with retry
   */
  async executeAll(operations, options = {}) {
    const {
      maxConcurrent = 5,
      ...retryOptions
    } = options;

    const results = [];
    const errors = [];
    
    // Process operations in batches
    for (let i = 0; i < operations.length; i += maxConcurrent) {
      const batch = operations.slice(i, i + maxConcurrent);
      
      const batchPromises = batch.map((operation, index) =>
        this.execute(operation, {
          ...retryOptions,
          operationName: `batch_${i + index}`,
        }).catch(error => error)
      );
      
      const batchResults = await Promise.all(batchPromises);
      
      batchResults.forEach((result, index) => {
        if (result instanceof Error) {
          errors.push({
            operation: i + index,
            error: result,
          });
        } else {
          results.push(result);
        }
      });
      
      // Optional delay between batches
      if (options.batchDelay) {
        await this.sleep(options.batchDelay);
      }
    }
    
    return {
      results,
      errors,
      total: operations.length,
      successful: results.length,
      failed: errors.length,
    };
  }

  /**
   * Create a retryable HTTP request wrapper
   */
  createHttpRetry(axiosInstance, options = {}) {
    const retryManager = new RetryManager(options);
    
    const retryableRequest = async (config) => {
      return retryManager.execute(
        () => axiosInstance(config),
        {
          operationName: `http_${config.method}_${config.url}`,
          context: {
            url: config.url,
            method: config.method,
          },
          ...options,
        }
      );
    };
    
    // Add convenience methods
    retryableRequest.get = (url, config) =>
      retryableRequest({ ...config, method: 'GET', url });
    
    retryableRequest.post = (url, data, config) =>
      retryableRequest({ ...config, method: 'POST', url, data });
    
    retryableRequest.put = (url, data, config) =>
      retryableRequest({ ...config, method: 'PUT', url, data });
    
    retryableRequest.delete = (url, config) =>
      retryableRequest({ ...config, method: 'DELETE', url });
    
    return retryableRequest;
  }
}

module.exports = RetryManager;