const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger')();
const EncryptionService = require('../utils/encryption');

class TokenService {
  constructor() {
    this.encryption = new EncryptionService();
    this.tokenStorage = new Map(); // In production, use Redis or database
  }

  /**
   * Tokenize card data
   */
  async tokenizeCard(cardData) {
    const { number, cvv, expirationMonth, expirationYear, cardholderName } = cardData;
    
    // Validate card data
    this.validateCard(number, expirationMonth, expirationYear, cvv);
    
    // Create token
    const token = this.generateToken('card', {
      last4: number.slice(-4),
      brand: this.detectCardBrand(number),
      expMonth: expirationMonth,
      expYear: expirationYear,
      cardholderName,
    });
    
    // Encrypt and store sensitive data
    const encryptedData = this.encryption.encrypt(
      JSON.stringify({ number, cvv }),
      config.pci.encryption.key
    );
    
    // Store token mapping (in production, use secure storage)
    this.tokenStorage.set(token, {
      type: 'card',
      encryptedData,
      metadata: {
        last4: number.slice(-4),
        brand: this.detectCardBrand(number),
        expMonth: expirationMonth,
        expYear: expirationYear,
        tokenizedAt: new Date().toISOString(),
      },
    });
    
    logger.info('Card tokenized', {
      token,
      last4: number.slice(-4),
      brand: this.detectCardBrand(number),
    });
    
    return {
      token,
      type: 'card',
      last4: number.slice(-4),
      brand: this.detectCardBrand(number),
      expMonth: expirationMonth,
      expYear: expirationYear,
    };
  }

  /**
   * Tokenize bank account data
   */
  async tokenizeBankAccount(bankData) {
    const { accountNumber, routingNumber, accountType, accountHolderName } = bankData;
    
    // Validate bank data
    this.validateBankAccount(accountNumber, routingNumber);
    
    // Create token
    const token = this.generateToken('bank', {
      last4: accountNumber.slice(-4),
      routingNumber,
      accountType,
      accountHolderName,
    });
    
    // Encrypt and store sensitive data
    const encryptedData = this.encryption.encrypt(
      JSON.stringify({ accountNumber, routingNumber }),
      config.pci.encryption.key
    );
    
    // Store token mapping
    this.tokenStorage.set(token, {
      type: 'bank',
      encryptedData,
      metadata: {
        last4: accountNumber.slice(-4),
        routingNumber,
        accountType,
        tokenizedAt: new Date().toISOString(),
      },
    });
    
    logger.info('Bank account tokenized', {
      token,
      last4: accountNumber.slice(-4),
      accountType,
    });
    
    return {
      token,
      type: 'bank',
      last4: accountNumber.slice(-4),
      accountType,
    };
  }

  /**
   * Detokenize (get original data)
   */
  async detokenize(token, merchantId) {
    const tokenData = this.tokenStorage.get(token);
    
    if (!tokenData) {
      throw new Error('Invalid token');
    }
    
    // Verify merchant has permission to detokenize
    // This would check merchant-token association in production
    
    // Decrypt data
    const decrypted = JSON.parse(
      this.encryption.decrypt(
        tokenData.encryptedData,
        config.pci.encryption.key
      )
    );
    
    // Audit log
    logger.info('Token detokenized', {
      token,
      merchantId,
      type: tokenData.type,
      timestamp: new Date().toISOString(),
    });
    
    return {
      ...decrypted,
      type: tokenData.type,
      metadata: tokenData.metadata,
    };
  }

  /**
   * Validate token
   */
  async validateToken(token) {
    const tokenData = this.tokenStorage.get(token);
    
    if (!tokenData) {
      return { valid: false, reason: 'Token not found' };
    }
    
    // Check if token is expired (if it has expiry)
    if (tokenData.metadata.expiresAt && new Date(tokenData.metadata.expiresAt) < new Date()) {
      this.tokenStorage.delete(token);
      return { valid: false, reason: 'Token expired' };
    }
    
    return {
      valid: true,
      type: tokenData.type,
      metadata: tokenData.metadata,
    };
  }

  /**
   * Generate secure token
   */
  generateToken(type, metadata) {
    const random = crypto.randomBytes(16).toString('hex');
    const timestamp = Date.now().toString();
    
    const tokenString = `${type}_${timestamp}_${random}`;
    const hash = crypto
      .createHash('sha256')
      .update(tokenString)
      .digest('hex');
    
    return `tok_${hash.substring(0, 32)}`;
  }

  /**
   * Validate card data
   */
  validateCard(number, expMonth, expYear, cvv) {
    // Check card number using Luhn algorithm
    if (!this.isValidLuhn(number)) {
      throw new Error('Invalid card number');
    }
    
    // Check expiration
    const currentYear = new Date().getFullYear();
    const currentMonth = new Date().getMonth() + 1;
    
    if (expYear < currentYear || (expYear === currentYear && expMonth < currentMonth)) {
      throw new Error('Card has expired');
    }
    
    // Check CVV length
    if (cvv.length < 3 || cvv.length > 4) {
      throw new Error('Invalid CVV');
    }
    
    // Additional validation could include BIN checks, etc.
  }

  /**
   * Luhn algorithm validation
   */
  isValidLuhn(cardNumber) {
    const cleaned = cardNumber.replace(/\D/g, '');
    
    let sum = 0;
    let shouldDouble = false;
    
    for (let i = cleaned.length - 1; i >= 0; i--) {
      let digit = parseInt(cleaned.charAt(i), 10);
      
      if (shouldDouble) {
        digit *= 2;
        if (digit > 9) digit -= 9;
      }
      
      sum += digit;
      shouldDouble = !shouldDouble;
    }
    
    return sum % 10 === 0;
  }

  /**
   * Detect card brand
   */
  detectCardBrand(cardNumber) {
    const cleaned = cardNumber.replace(/\D/g, '');
    
    // Visa
    if (/^4/.test(cleaned)) return 'visa';
    
    // MasterCard
    if (/^5[1-5]/.test(cleaned) || /^2[2-7]/.test(cleaned)) return 'mastercard';
    
    // American Express
    if (/^3[47]/.test(cleaned)) return 'amex';
    
    // Discover
    if (/^6(?:011|5)/.test(cleaned)) return 'discover';
    
    // Diners Club
    if (/^3(?:0[0-5]|[68])/.test(cleaned)) return 'diners';
    
    // JCB
    if (/^35/.test(cleaned)) return 'jcb';
    
    return 'unknown';
  }

  /**
   * Validate bank account
   */
  validateBankAccount(accountNumber, routingNumber) {
    // Basic validation
    if (accountNumber.length < 4 || accountNumber.length > 17) {
      throw new Error('Invalid account number length');
    }
    
    if (routingNumber.length !== 9 || !/^\d+$/.test(routingNumber)) {
      throw new Error('Invalid routing number');
    }
    
    // Validate routing number using MOD 10 check
    if (!this.isValidRoutingNumber(routingNumber)) {
      throw new Error('Invalid routing number checksum');
    }
  }

  /**
   * Validate routing number (ABA number)
   */
  isValidRoutingNumber(routingNumber) {
    const digits = routingNumber.split('').map(Number);
    
    const sum = (3 * (digits[0] + digits[3] + digits[6])) +
                (7 * (digits[1] + digits[4] + digits[7])) +
                (1 * (digits[2] + digits[5] + digits[8]));
    
    return sum % 10 === 0;
  }

  /**
   * Create one-time token (for single use)
   */
  async createOneTimeToken(data, expiresIn = 300) { // 5 minutes default
    const token = this.generateToken('one_time', data);
    const expiresAt = new Date(Date.now() + expiresIn * 1000).toISOString();
    
    this.tokenStorage.set(token, {
      type: 'one_time',
      data,
      expiresAt,
      used: false,
    });
    
    // Schedule cleanup
    setTimeout(() => {
      this.tokenStorage.delete(token);
    }, expiresIn * 1000);
    
    return { token, expiresAt };
  }

  /**
   * Use one-time token
   */
  async useOneTimeToken(token) {
    const tokenData = this.tokenStorage.get(token);
    
    if (!tokenData || tokenData.type !== 'one_time') {
      throw new Error('Invalid one-time token');
    }
    
    if (tokenData.used) {
      throw new Error('Token already used');
    }
    
    if (tokenData.expiresAt && new Date(tokenData.expiresAt) < new Date()) {
      this.tokenStorage.delete(token);
      throw new Error('Token expired');
    }
    
    // Mark as used
    tokenData.used = true;
    this.tokenStorage.set(token, tokenData);
    
    return tokenData.data;
  }

  /**
   * Delete token
   */
  async deleteToken(token) {
    const deleted = this.tokenStorage.delete(token);
    
    if (deleted) {
      logger.info('Token deleted', { token });
    }
    
    return deleted;
  }

  /**
   * List tokens (for admin purposes)
   */
  async listTokens(filter = {}) {
    const tokens = [];
    
    for (const [token, data] of this.tokenStorage) {
      if (filter.type && data.type !== filter.type) continue;
      if (filter.merchantId && data.merchantId !== filter.merchantId) continue;
      
      tokens.push({
        token,
        type: data.type,
        metadata: data.metadata,
        created: data.metadata?.tokenizedAt,
      });
    }
    
    return tokens;
  }

  /**
   * Cleanup expired tokens
   */
  async cleanupExpiredTokens() {
    const now = new Date();
    let count = 0;
    
    for (const [token, data] of this.tokenStorage) {
      if (data.expiresAt && new Date(data.expiresAt) < now) {
        this.tokenStorage.delete(token);
        count++;
      }
    }
    
    if (count > 0) {
      logger.info('Expired tokens cleaned up', { count });
    }
    
    return count;
  }

  /**
   * Get token statistics
   */
  getTokenStats() {
    const stats = {
      total: this.tokenStorage.size,
      byType: {},
    };
    
    for (const [, data] of this.tokenStorage) {
      stats.byType[data.type] = (stats.byType[data.type] || 0) + 1;
    }
    
    return stats;
  }
}

// Singleton instance
let instance = null;

function getTokenService() {
  if (!instance) {
    instance = new TokenService();
  }
  return instance;
}

module.exports = getTokenService();