const IdempotencyService = require('../../../src/utils/idempotency');
const crypto = require('crypto');

describe('IdempotencyService', () => {
  let idempotencyService;
  let mockRedis;

  beforeEach(() => {
    mockRedis = {
      get: jest.fn(),
      setex: jest.fn(),
      del: jest.fn(),
      set: jest.fn(),
    };

    idempotencyService = new IdempotencyService(mockRedis);

    // Mock crypto for consistent testing
    jest.spyOn(crypto, 'createHash').mockImplementation(() => ({
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue('hashed_key_123'),
    }));
  });

  afterEach(() => {
    jest.clearAllMocks();
    jest.restoreAllMocks();
  });

  describe('generateKey', () => {
    it('should generate consistent hash for same input', () => {
      const requestData = { amount: 100, currency: 'USD' };
      const merchantId = 'merchant_123';
      const endpoint = '/payments/process';

      const key1 = idempotencyService.generateKey(requestData, merchantId, endpoint);
      const key2 = idempotencyService.generateKey(requestData, merchantId, endpoint);

      expect(key1).toBe(key2);
      expect(typeof key1).toBe('string');
      expect(key1.length).toBe(64); // SHA256 hex length
    });

    it('should generate different keys for different data', () => {
      const requestData1 = { amount: 100 };
      const requestData2 = { amount: 200 };
      const merchantId = 'merchant_123';
      const endpoint = '/payments/process';

      const key1 = idempotencyService.generateKey(requestData1, merchantId, endpoint);
      const key2 = idempotencyService.generateKey(requestData2, merchantId, endpoint);

      expect(key1).not.toBe(key2);
    });

    it('should include timestamp window in hash', () => {
      const requestData = { amount: 100 };
      const merchantId = 'merchant_123';
      const endpoint = '/payments/process';

      const now = Date.now();
      const timestamp1 = Math.floor(now / 1000 / 300); // 5-minute window
      
      const key1 = idempotencyService.generateKey(requestData, merchantId, endpoint);
      
      // Mock different time window
      const originalDateNow = Date.now;
      Date.now = jest.fn(() => now + 6 * 60 * 1000); // 6 minutes later (different window)
      
      const key2 = idempotencyService.generateKey(requestData, merchantId, endpoint);
      
      Date.now = originalDateNow;

      expect(key1).not.toBe(key2);
    });
  });

  describe('check', () => {
    it('should return cached response if exists', async () => {
      const key = 'test_key_123';
      const cachedResponse = { transactionId: 'txn_123', status: 'success' };

      mockRedis.get.mockResolvedValue(JSON.stringify(cachedResponse));

      const operation = jest.fn();
      const result = await idempotencyService.check(key, operation);

      expect(mockRedis.get).toHaveBeenCalledWith('payment:idempotency:test_key_123');
      expect(operation).not.toHaveBeenCalled(); // Should not execute operation
      expect(result).toEqual(cachedResponse);
    });

    it('should execute operation and cache result if no cache', async () => {
      const key = 'test_key_123';
      const operationResult = { transactionId: 'txn_123', status: 'success' };
      const operation = jest.fn().mockResolvedValue(operationResult);

      mockRedis.get.mockResolvedValue(null); // No cache
      mockRedis.set.mockResolvedValue('OK'); // Lock acquired
      mockRedis.setex.mockResolvedValue('OK'); // Cache set

      const result = await idempotencyService.check(key, operation);

      expect(mockRedis.get).toHaveBeenCalledWith('payment:idempotency:test_key_123');
      expect(operation).toHaveBeenCalled();
      expect(mockRedis.setex).toHaveBeenCalledWith(
        'payment:idempotency:test_key_123',
        86400,
        JSON.stringify(operationResult)
      );
      expect(result).toEqual(operationResult);
    });

    it('should handle invalid JSON in cache', async () => {
      const key = 'test_key_123';
      const operationResult = { transactionId: 'txn_123', status: 'success' };
      const operation = jest.fn().mockResolvedValue(operationResult);

      mockRedis.get.mockResolvedValue('invalid json'); // Invalid JSON
      mockRedis.del.mockResolvedValue(1); // Delete invalid cache
      mockRedis.set.mockResolvedValue('OK'); // Lock acquired
      mockRedis.setex.mockResolvedValue('OK'); // Cache set

      const result = await idempotencyService.check(key, operation);

      expect(mockRedis.del).toHaveBeenCalledWith('payment:idempotency:test_key_123');
      expect(operation).toHaveBeenCalled();
      expect(result).toEqual(operationResult);
    });

    it('should handle lock acquisition failure', async () => {
      const key = 'test_key_123';
      const operationResult = { transactionId: 'txn_123', status: 'success' };
      const operation = jest.fn();

      mockRedis.get.mockResolvedValue(null); // No cache
      mockRedis.set.mockResolvedValue(null); // Lock acquisition failed

      // Mock waitAndRetry to return result
      idempotencyService.waitAndRetry = jest.fn().mockResolvedValue(operationResult);

      const result = await idempotencyService.check(key, operation);

      expect(idempotencyService.waitAndRetry).toHaveBeenCalledWith(
        'test_key_123',
        10,
        100
      );
      expect(result).toEqual(operationResult);
    });

    it('should release lock after operation', async () => {
      const key = 'test_key_123';
      const operationResult = { transactionId: 'txn_123', status: 'success' };
      const operation = jest.fn().mockResolvedValue(operationResult);

      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue('OK'); // Lock acquired
      mockRedis.setex.mockResolvedValue('OK');
      mockRedis.del.mockResolvedValue(1); // Lock released

      await idempotencyService.check(key, operation);

      expect(mockRedis.del).toHaveBeenCalledWith('payment:idempotency:test_key_123:lock');
    });

    it('should release lock even if operation fails', async () => {
      const key = 'test_key_123';
      const operationError = new Error('Operation failed');
      const operation = jest.fn().mockRejectedValue(operationError);

      mockRedis.get.mockResolvedValue(null);
      mockRedis.set.mockResolvedValue('OK'); // Lock acquired
      mockRedis.del.mockResolvedValue(1); // Lock released

      await expect(idempotencyService.check(key, operation)).rejects.toThrow('Operation failed');

      expect(mockRedis.del).toHaveBeenCalledWith('payment:idempotency:test_key_123:lock');
    });
  });

  describe('acquireLock', () => {
    it('should acquire lock successfully', async () => {
      const lockKey = 'test_lock';
      mockRedis.set.mockResolvedValue('OK');

      const result = await idempotencyService.acquireLock(lockKey);

      expect(mockRedis.set).toHaveBeenCalledWith(
        lockKey,
        expect.any(String),
        'NX',
        'PX',
        5000
      );
      expect(result).toBe(true);
    });

    it('should fail to acquire lock if already locked', async () => {
      const lockKey = 'test_lock';
      mockRedis.set.mockResolvedValue(null); // Lock already exists

      const result = await idempotencyService.acquireLock(lockKey);

      expect(result).toBe(false);
    });
  });

  describe('waitAndRetry', () => {
    it('should wait for result to appear in cache', async () => {
      const key = 'test_key_123';
      const cachedResult = { transactionId: 'txn_123', status: 'success' };

      // First two calls return null, third returns result
      mockRedis.get
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(JSON.stringify(cachedResult));

      const result = await idempotencyService.waitAndRetry(key, 3, 10);

      expect(mockRedis.get).toHaveBeenCalledTimes(3);
      expect(result).toEqual(cachedResult);
    });

    it('should throw error after max attempts', async () => {
      const key = 'test_key_123';
      mockRedis.get.mockResolvedValue(null); // Never cached

      await expect(idempotencyService.waitAndRetry(key, 3, 1)).rejects.toThrow(
        'Operation timeout - please retry the request'
      );

      expect(mockRedis.get).toHaveBeenCalledTimes(3);
    });

    it('should handle invalid JSON during retry', async () => {
      const key = 'test_key_123';
      const cachedResult = { transactionId: 'txn_123', status: 'success' };

      mockRedis.get
        .mockResolvedValueOnce('invalid json')
        .mockResolvedValueOnce(JSON.stringify(cachedResult));

      const result = await idempotencyService.waitAndRetry(key, 2, 1);

      expect(result).toEqual(cachedResult);
    });
  });

  describe('store and retrieve', () => {
    it('should store response in cache', async () => {
      const key = 'test_key_123';
      const response = { transactionId: 'txn_123', status: 'success' };

      mockRedis.setex.mockResolvedValue('OK');

      await idempotencyService.store(key, response, 3600);

      expect(mockRedis.setex).toHaveBeenCalledWith(
        'payment:idempotency:test_key_123',
        3600,
        JSON.stringify(response)
      );
    });

    it('should retrieve response from cache', async () => {
      const key = 'test_key_123';
      const cachedResponse = { transactionId: 'txn_123', status: 'success' };

      mockRedis.get.mockResolvedValue(JSON.stringify(cachedResponse));

      const result = await idempotencyService.retrieve(key);

      expect(result).toEqual(cachedResponse);
    });

    it('should return null for non-existent key', async () => {
      const key = 'test_key_123';
      mockRedis.get.mockResolvedValue(null);

      const result = await idempotencyService.retrieve(key);

      expect(result).toBeNull();
    });

    it('should delete invalid JSON from cache', async () => {
      const key = 'test_key_123';
      mockRedis.get.mockResolvedValue('invalid json');
      mockRedis.del.mockResolvedValue(1);

      const result = await idempotencyService.retrieve(key);

      expect(mockRedis.del).toHaveBeenCalledWith('payment:idempotency:test_key_123');
      expect(result).toBeNull();
    });
  });

  describe('invalidate', () => {
    it('should delete key from cache', async () => {
      const key = 'test_key_123';
      mockRedis.del.mockResolvedValue(1);

      await idempotencyService.invalidate(key);

      expect(mockRedis.del).toHaveBeenCalledWith('payment:idempotency:test_key_123');
    });
  });

  describe('generateClientKey', () => {
    it('should generate client-readable key', () => {
      const key = idempotencyService.generateClientKey('payment');
      
      expect(key).toMatch(/^payment_\d+_[0-9a-f]{16}$/);
    });

    it('should use custom prefix', () => {
      const key = idempotencyService.generateClientKey('refund');
      
      expect(key).toMatch(/^refund_/);
    });
  });

  describe('validateKey', () => {
    it('should validate hex string keys', () => {
      expect(idempotencyService.validateKey('123abc')).toBe(true);
      expect(idempotencyService.validateKey('ABC123')).toBe(true);
      expect(idempotencyService.validateKey('123-456')).toBe(false); // Contains dash
    });

    it('should validate custom format keys', () => {
      expect(idempotencyService.validateKey('idempotency_123_abc')).toBe(true);
      expect(idempotencyService.validateKey('test-key-123')).toBe(true);
      expect(idempotencyService.validateKey('test.key.123')).toBe(false); // Contains dot
    });

    it('should reject empty or non-string keys', () => {
      expect(idempotencyService.validateKey('')).toBe(false);
      expect(idempotencyService.validateKey(null)).toBe(false);
      expect(idempotencyService.validateKey(undefined)).toBe(false);
      expect(idempotencyService.validateKey(123)).toBe(false);
    });
  });
});