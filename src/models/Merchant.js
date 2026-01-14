const crypto = require('crypto');

module.exports = (sequelize, DataTypes) => {
  const Merchant = sequelize.define('Merchant', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    name: {
      type: DataTypes.STRING(255),
      allowNull: false,
    },
    email: {
      type: DataTypes.STRING(255),
      allowNull: false,
      unique: true,
      validate: {
        isEmail: true,
      },
    },
    apiKey: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'api_key',
      unique: true,
      comment: 'Hashed API key for authentication',
    },
    apiKeySalt: {
      type: DataTypes.STRING(255),
      allowNull: false,
      field: 'api_key_salt'
    },
    webhookUrl: {
      type: DataTypes.STRING(500),
      allowNull: true,
      field: 'webhook_url',
      validate: {
        isUrl: true,
      },
    },
    webhookSecret: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'webhook_secret'
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      field: 'is_active',
      defaultValue: true,
    },
    isPciCompliant: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      field: 'is_pci_compliant',
      defaultValue: false,
    },
    region: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'US',
    },
    timezone: {
      type: DataTypes.STRING(50),
      allowNull: false,
      defaultValue: 'UTC',
    },
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      defaultValue: 'USD',
      validate: {
        isUppercase: true,
        len: [3, 3],
      },
    },
    maxTransactionAmount: {
      type: DataTypes.DECIMAL(15, 4),
      allowNull: false,
      field: 'max_transaction_amount',
      defaultValue: 1000000,
    },
    minTransactionAmount: {
      type: DataTypes.DECIMAL(15, 4),
      allowNull: false,
      field: 'min_transaction_amount',
      defaultValue: 0.01,
    },
    allowedCurrencies: {
      type: DataTypes.JSONB,
      allowNull: false,
      field: 'allowed_currencies',
      defaultValue: ['USD', 'EUR', 'GBP'],
    },
    supportedProcessors: {
      type: DataTypes.JSONB,
      allowNull: false,
      field: 'supported_processors',
      defaultValue: ['stripe', 'paypal'],
    },
    processorConfig: {
      type: DataTypes.JSONB,
      allowNull: false,
      field: 'processor_config',
      defaultValue: {},
      comment: 'Processor-specific configuration (API keys, etc.)',
    },
    routingRules: {
      type: DataTypes.JSONB,
      allowNull: false,
      field: 'routing_rules',
      defaultValue: {
        strategy: 'cost',
        priority: ['stripe', 'paypal'],
        regionalRouting: {},
        costPreferences: {
          maxFeePercentage: 3,
          preferLocalCurrency: true,
        },
      },
    },
    fraudSettings: {
      type: DataTypes.JSONB,
      allowNull: false,
      field: 'fraud_settings',
      defaultValue: {
        enabled: true,
        threshold: 0.7,
        autoDecline: false,
        reviewThreshold: 0.5,
      },
    },
    notificationSettings: {
      type: DataTypes.JSONB,
      allowNull: false,
      field: 'notification_settings',
      defaultValue: {
        email: true,
        webhook: true,
        slack: false,
        failedPayments: true,
        successfulPayments: false,
        refunds: true,
        disputes: true,
      },
    },
    billingSettings: {
      type: DataTypes.JSONB,
      allowNull: false,
      field: 'billing_settings',
      defaultValue: {
        feeStructure: 'percentage',
        percentageFee: 2.9,
        fixedFee: 0.3,
        currency: 'USD',
        billingCycle: 'monthly',
      },
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {},
    },
    createdBy: {
      type: DataTypes.UUID,
      field: 'created_by',
      allowNull: true,
    },
    updatedBy: {
      type: DataTypes.UUID,
      field: 'updated_by',
      allowNull: true,
    },
    deletedAt: {
      type: DataTypes.DATE,
      field: 'deleted_at',
      allowNull: true,
    },
  }, {
    tableName: 'merchants',
    paranoid: true,
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['email'],
        unique: true,
      },
      {
        fields: ['api_key'],
        unique: true,
      },
      {
        fields: ['is_active'],
      },
      {
        fields: ['region'],
      },
    ],
  });

  // Class Methods
  Merchant.findByApiKey = async function(apiKey) {  
    const merchants = await this.findAll({
      where: { isActive: true },
    });
    
    for (const merchant of merchants) {
      const hash = crypto
        .createHmac('sha256', merchant.apiKeySalt)
        .update(apiKey)
        .digest('hex');
      
      if (hash === merchant.apiKey) {
        return merchant;
      }
    }
    
    return null;
  };

  // Merchant.prototype.validateTransaction = function(transactionData) {
  //   const { amount, currency } = transactionData;
    
  //   const errors = [];
    
  //   // Check amount limits
  //   if (amount < this.minTransactionAmount) {
  //     errors.push(`Amount must be at least ${this.minTransactionAmount}`);
  //   }
    
  //   if (amount > this.maxTransactionAmount) {
  //     errors.push(`Amount must not exceed ${this.maxTransactionAmount}`);
  //   }
    
  //   // Check allowed currencies
  //   if (!this.allowedCurrencies.includes(currency)) {
  //     errors.push(`Currency ${currency} is not supported. Supported: ${this.allowedCurrencies.join(', ')}`);
  //   }
    
  //   return errors;
  // };

  // Merchant.prototype.getProcessorConfig = function(processor) {
  //   return this.processorConfig[processor] || {};
  // };

  // Merchant.prototype.updateProcessorConfig = async function(processor, config) {
  //   this.processorConfig = {
  //     ...this.processorConfig,
  //     [processor]: config,
  //   };
  //   return this.save();
  // };

  // Merchant.prototype.generateWebhookSecret = async function() {
  //   const crypto = require('crypto');
  //   this.webhookSecret = crypto.randomBytes(32).toString('hex');
  //   return this.save();
  // };

  // Merchant.prototype.verifyWebhookSignature = function(payload, signature) {
  //   if (!this.webhookSecret) return false;
    
  //   const crypto = require('crypto');
  //   const hmac = crypto.createHmac('sha256', this.webhookSecret);
  //   const computedSignature = `sha256=${hmac.update(JSON.stringify(payload)).digest('hex')}`;
    
  //   return crypto.timingSafeEqual(
  //     Buffer.from(signature),
  //     Buffer.from(computedSignature)
  //   );
  // };

  // // Hooks
  // Merchant.beforeCreate(async (merchant) => {
  //   // Generate API key salt and hash
  //   const crypto = require('crypto');
    
  //   if (!merchant.apiKey) {
  //     merchant.apiKey = crypto.randomBytes(32).toString('hex');
  //   }
    
  //   merchant.apiKeySalt = crypto.randomBytes(16).toString('hex');
  //   const hash = crypto
  //     .createHmac('sha256', merchant.apiKeySalt)
  //     .update(merchant.apiKey)
  //     .digest('hex');
    
  //   merchant.apiKey = hash;
  // });

  // Merchant.beforeUpdate(async (merchant) => {
  //   // Update metadata
  //   if (merchant.changed()) {
  //     merchant.metadata = {
  //       ...merchant.metadata,
  //       lastUpdated: new Date().toISOString(),
  //       updatedFields: Object.keys(merchant._changed),
  //     };
  //   }
  // });

  // Instance Methods
  Merchant.prototype.toJSON = function() {
    const values = Object.assign({}, this.get());
    
    // Remove sensitive data
    delete values.apiKey;
    delete values.apiKeySalt;
    delete values.webhookSecret;
    delete values.processorConfig;
    delete values.metadata?.internal;
    
    return values;
  };

  Merchant.prototype.toInternalJSON = function() {
    const values = Object.assign({}, this.get());
    
    // Still remove sensitive data but keep configuration
    delete values.apiKey;
    delete values.apiKeySalt;
    delete values.webhookSecret;
    
    return values;
  };

  return Merchant;
};