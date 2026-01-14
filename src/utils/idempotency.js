const crypto = require('crypto');
const config = require('../config');

class IdempotencyService {
  constructor(redisClient) {
    this.redis = redisClient;
    this.prefix = config.redis.prefix || 'payment:idempotency:';
    this.defaultTtl = config.redis.ttl.idempotency || 86400; // 24 hours
  }

  /**
   * Generate an idempotency key from request data
   */
  generateKey(requestData, merchantId, endpoint) {
    const stringToHash = JSON.stringify({
      merchantId,
      endpoint,
      data: requestData,
      timestamp: Math.floor(Date.now() / 1000 / 300), // 5-minute window
    });

    return crypto
      .createHash('sha256')
      .update(stringToHash)
      .digest('hex');
  }

  /**
   * Check if request is idempotent and return cached response if exists
   */
  async check(key, operation) {
    const cacheKey = `${this.prefix}${key}`;
    
    // Check for existing response
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      try {
        return JSON.parse(cached);
      } catch (error) {
        // Invalid JSON in cache, delete it
        await this.redis.del(cacheKey);
      }
    }

    // Check if operation is in progress (to prevent concurrent duplicate requests)
    const lockKey = `${cacheKey}:lock`;
    const lockAcquired = await this.acquireLock(lockKey);
    
    if (!lockAcquired) {
      // Another request is processing, wait and retry
      return this.waitAndRetry(key);
    }

    try {
      // Execute the operation
      const result = await operation();
      
      // Cache the result
      await this.redis.setex(
        cacheKey,
        this.defaultTtl,
        JSON.stringify(result)
      );
      
      return result;
    } finally {
      // Release the lock
      await this.releaseLock(lockKey);
    }
  }

  /**
   * Acquire a lock to prevent concurrent processing
   */
  async acquireLock(lockKey, timeout = 5000) {
    const lockValue = crypto.randomBytes(16).toString('hex');
    const acquired = await this.redis.set(
      lockKey,
      lockValue,
      'NX',
      'PX',
      timeout
    );
    
    return acquired === 'OK';
  }

  /**
   * Release a lock
   */
  async releaseLock(lockKey) {
    await this.redis.del(lockKey);
  }

  /**
   * Wait for a request in progress and return its result
   */
  async waitAndRetry(key, maxAttempts = 10, delay = 100) {
    const cacheKey = `${this.prefix}${key}`;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, delay));
      
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        try {
          return JSON.parse(cached);
        } catch (error) {
          // Continue waiting if JSON is invalid
        }
      }
      
      // Exponential backoff
      delay = Math.min(delay * 1.5, 1000);
    }
    
    throw new Error('Operation timeout - please retry the request');
  }

  /**
   * Store a response for idempotency
   */
  async store(key, response, ttl = null) {
    const cacheKey = `${this.prefix}${key}`;
    await this.redis.setex(
      cacheKey,
      ttl || this.defaultTtl,
      JSON.stringify(response)
    );
  }

  /**
   * Retrieve a cached response
   */
  async retrieve(key) {
    const cacheKey = `${this.prefix}${key}`;
    const cached = await this.redis.get(cacheKey);
    
    if (!cached) return null;
    
    try {
      return JSON.parse(cached);
    } catch (error) {
      await this.redis.del(cacheKey);
      return null;
    }
  }

  /**
   * Invalidate an idempotency key (e.g., for testing)
   */
  async invalidate(key) {
    const cacheKey = `${this.prefix}${key}`;
    await this.redis.del(cacheKey);
  }

  /**
   * Clean up expired idempotency keys
   */
  async cleanup(olderThan = 86400) {
    // This would typically be done with Redis TTL
    // In production, use Redis SCAN for large datasets
    console.log('Idempotency cleanup would run here');
  }

  /**
   * Generate client-readable idempotency key
   */
  generateClientKey(prefix = 'idempotency') {
    return `${prefix}_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  /**
   * Validate idempotency key format
   */
  validateKey(key) {
    if (!key || typeof key !== 'string') return false;
    
    // Basic validation: should be hex string or have expected format
    const hexRegex = /^[0-9a-f]+$/i;
    const customRegex = /^[a-zA-Z0-9_-]+$/;
    
    return hexRegex.test(key) || customRegex.test(key);
  }
}

module.exports = IdempotencyService;