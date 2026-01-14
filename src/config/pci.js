const crypto = require('crypto');

module.exports = {
  // PCI DSS Compliance Settings
  enabled: process.env.PCI_COMPLIANCE === 'true',

  // Sensitive Data Handling
  sensitiveDataFields: [
    'cardNumber',
    'cvv',
    'expirationDate',
    'pin',
    'trackData',
    'cardholderName',
    'billingAddress',
    'socialSecurityNumber',
  ],

  // Encryption Configuration
  encryption: {
    algorithm: 'aes-256-gcm',
    keyLength: 32,
    ivLength: 16,
    authTagLength: 16,
  },

  // Tokenization Settings
  tokenization: {
    format: 'tok_%s', // token format
    algorithm: 'sha256',
    salt: process.env.TOKENIZATION_SALT || crypto.randomBytes(16).toString('hex'),
  },

  // Logging Restrictions
  logging: {
    maskPatterns: [
      /\b(?:\d[ -]*?){13,16}\b/g, // Credit card numbers
      /\b\d{3,4}\b/g, // CVV
      /^\d{3}-\d{2}-\d{4}$/g, // SSN
      /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g, // Email (partial mask)
    ],
    allowedFields: [
      'transactionId',
      'merchantId',
      'amount',
      'currency',
      'status',
      'processor',
      'timestamp',
      'fraudScore',
    ],
  },

  // Network Security
  network: {
    isolatedSubnet: process.env.PCI_ISOLATED_SUBNET,
    allowedCidrs: process.env.PCI_ALLOWED_CIDRS ? 
      process.env.PCI_ALLOWED_CIDRS.split(',') : [],
    requireVpn: process.env.PCI_REQUIRE_VPN === 'true',
  },

  // Access Control
  access: {
    multiFactorAuth: process.env.PCI_MFA_REQUIRED === 'true',
    sessionTimeout: parseInt(process.env.PCI_SESSION_TIMEOUT) || 900, // 15 minutes
    maxLoginAttempts: parseInt(process.env.PCI_MAX_LOGIN_ATTEMPTS) || 3,
  },

  // Regular Compliance Tasks
  complianceTasks: {
    dailyLogReview: true,
    weeklyVulnerabilityScan: true,
    quarterlyAudit: true,
    annualPciAssessment: true,
  },

  // Helper Methods
  isSensitiveField(fieldName) {
    return this.sensitiveDataFields.includes(fieldName);
  },

  maskSensitiveData(data) {
    const masked = { ...data };
    
    this.sensitiveDataFields.forEach(field => {
      if (masked[field]) {
        if (field === 'cardNumber' && masked[field].length > 4) {
          // Keep last 4 digits
          masked[field] = `****-****-****-${masked[field].slice(-4)}`;
        } else if (field === 'cvv') {
          masked[field] = '***';
        } else if (field === 'expirationDate') {
          masked[field] = '**/**';
        } else {
          masked[field] = '[REDACTED]';
        }
      }
    });

    return masked;
  },

  validateNoSensitiveData(logObject) {
    const found = [];
    
    const checkObject = (obj, path = '') => {
      if (!obj || typeof obj !== 'object') return;
      
      Object.entries(obj).forEach(([key, value]) => {
        const currentPath = path ? `${path}.${key}` : key;
        
        if (this.isSensitiveField(key)) {
          found.push({
            path: currentPath,
            value: typeof value === 'string' ? value.substring(0, 50) + '...' : value,
          });
        }
        
        if (typeof value === 'object' && value !== null) {
          checkObject(value, currentPath);
        }
      });
    };
    
    checkObject(logObject);
    return found;
  },
};