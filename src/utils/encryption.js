const crypto = require('crypto');
const config = require('../config').pci.encryption;

class EncryptionService {
  constructor() {
    this.algorithm = config.algorithm || 'aes-256-gcm';
    this.keyLength = config.keyLength || 32; // 256 bits
    this.ivLength = config.ivLength || 16; // 128 bits
    this.authTagLength = config.authTagLength || 16; // 128 bits
  }

  /**
   * Generate a new encryption key
   */
  generateKey() {
    return crypto.randomBytes(this.keyLength).toString('hex');
  }

  /**
   * Generate a key from a passphrase
   */
  generateKeyFromPassphrase(passphrase, salt = null) {
    const saltBytes = salt ? Buffer.from(salt, 'hex') : crypto.randomBytes(16);
    const key = crypto.pbkdf2Sync(
      passphrase,
      saltBytes,
      100000, // iterations
      this.keyLength,
      'sha256'
    );
    
    return {
      key: key.toString('hex'),
      salt: saltBytes.toString('hex'),
    };
  }

  /**
   * Encrypt data with optional associated data
   */
  encrypt(plaintext, key, associatedData = null) {
    if (!plaintext) throw new Error('Plaintext is required');
    if (!key) throw new Error('Encryption key is required');
    
    const keyBuffer = Buffer.from(key, 'hex');
    const iv = crypto.randomBytes(this.ivLength);
    
    const cipher = crypto.createCipheriv(this.algorithm, keyBuffer, iv);
    
    // Add associated data for authentication (if provided)
    if (associatedData) {
      cipher.setAAD(Buffer.from(associatedData));
    }
    
    let encrypted = cipher.update(plaintext, 'utf8');
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    
    const authTag = cipher.getAuthTag();
    
    return {
      ciphertext: encrypted.toString('hex'),
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      algorithm: this.algorithm,
    };
  }

  /**
   * Decrypt data with optional associated data
   */
  decrypt(encryptedData, key, associatedData = null) {
    const { ciphertext, iv, authTag, algorithm } = encryptedData;
    
    if (algorithm !== this.algorithm) {
      throw new Error(`Unsupported algorithm: ${algorithm}`);
    }
    
    const keyBuffer = Buffer.from(key, 'hex');
    const ivBuffer = Buffer.from(iv, 'hex');
    const ciphertextBuffer = Buffer.from(ciphertext, 'hex');
    const authTagBuffer = Buffer.from(authTag, 'hex');
    
    const decipher = crypto.createDecipheriv(algorithm, keyBuffer, ivBuffer);
    decipher.setAuthTag(authTagBuffer);
    
    // Add associated data for authentication (if provided)
    if (associatedData) {
      decipher.setAAD(Buffer.from(associatedData));
    }
    
    let decrypted = decipher.update(ciphertextBuffer);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString('utf8');
  }

  /**
   * Generate a secure random token
   */
  generateToken(length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Generate a secure random number for OTP
   */
  generateOTP(length = 6) {
    const max = Math.pow(10, length);
    const random = crypto.randomInt(0, max);
    return random.toString().padStart(length, '0');
  }

  /**
   * Hash data (non-reversible)
   */
  hash(data, algorithm = 'sha256', salt = null) {
    const hash = crypto.createHash(algorithm);
    
    if (salt) {
      hash.update(salt);
    }
    
    hash.update(data);
    return hash.digest('hex');
  }

  /**
   * HMAC (Hash-based Message Authentication Code)
   */
  hmac(data, key, algorithm = 'sha256') {
    const hmac = crypto.createHmac(algorithm, key);
    hmac.update(data);
    return hmac.digest('hex');
  }

  /**
   * Verify HMAC
   */
  verifyHmac(data, key, signature, algorithm = 'sha256') {
    const expectedSignature = this.hmac(data, key, algorithm);
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  /**
   * Encrypt sensitive fields in an object
   */
  encryptObject(obj, key, sensitiveFields) {
    const encrypted = { ...obj };
    
    for (const field of sensitiveFields) {
      if (obj[field] !== undefined && obj[field] !== null) {
        const encryptedData = this.encrypt(
          JSON.stringify(obj[field]),
          key,
          JSON.stringify({ field, objectId: obj.id })
        );
        encrypted[field] = encryptedData;
      }
    }
    
    return encrypted;
  }

  /**
   * Decrypt sensitive fields in an object
   */
  decryptObject(obj, key, sensitiveFields) {
    const decrypted = { ...obj };
    
    for (const field of sensitiveFields) {
      if (obj[field] && typeof obj[field] === 'object') {
        try {
          const decryptedData = JSON.parse(
            this.decrypt(
              obj[field],
              key,
              JSON.stringify({ field, objectId: obj.id })
            )
          );
          decrypted[field] = decryptedData;
        } catch (error) {
          console.warn(`Failed to decrypt field ${field}:`, error.message);
          // Keep encrypted data
        }
      }
    }
    
    return decrypted;
  }

  /**
   * Generate a key pair for asymmetric encryption
   */
  generateKeyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: {
        type: 'spki',
        format: 'pem',
      },
      privateKeyEncoding: {
        type: 'pkcs8',
        format: 'pem',
      },
    });
    
    return { publicKey, privateKey };
  }

  /**
   * RSA encrypt (for small data like symmetric keys)
   */
  rsaEncrypt(data, publicKey) {
    const buffer = Buffer.from(data, 'utf8');
    const encrypted = crypto.publicEncrypt(publicKey, buffer);
    return encrypted.toString('base64');
  }

  /**
   * RSA decrypt
   */
  rsaDecrypt(encryptedData, privateKey) {
    const buffer = Buffer.from(encryptedData, 'base64');
    const decrypted = crypto.privateDecrypt(privateKey, buffer);
    return decrypted.toString('utf8');
  }

  /**
   * Verify data integrity
   */
  verifyIntegrity(data, expectedHash, algorithm = 'sha256') {
    const actualHash = this.hash(data, algorithm);
    return crypto.timingSafeEqual(
      Buffer.from(actualHash),
      Buffer.from(expectedHash)
    );
  }

  /**
   * Generate a secure password hash
   */
  hashPassword(password, salt = null) {
    const saltBytes = salt ? Buffer.from(salt, 'hex') : crypto.randomBytes(16);
    const hash = crypto.pbkdf2Sync(
      password,
      saltBytes,
      100000, // iterations
      64, // key length
      'sha512'
    );
    
    return {
      hash: hash.toString('hex'),
      salt: saltBytes.toString('hex'),
      algorithm: 'pbkdf2-sha512',
      iterations: 100000,
    };
  }

  /**
   * Verify a password against a hash
   */
  verifyPassword(password, passwordHash) {
    const { hash, salt, algorithm, iterations } = passwordHash;
    
    if (algorithm !== 'pbkdf2-sha512') {
      throw new Error('Unsupported password hash algorithm');
    }
    
    const derivedHash = crypto.pbkdf2Sync(
      password,
      Buffer.from(salt, 'hex'),
      iterations,
      64,
      'sha512'
    );
    
    return crypto.timingSafeEqual(
      Buffer.from(hash),
      derivedHash
    );
  }
}

module.exports = EncryptionService;