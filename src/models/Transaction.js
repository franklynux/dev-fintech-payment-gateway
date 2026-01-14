const { v4: uuidv4 } = require('uuid');

module.exports = (sequelize, DataTypes) => {
  const Transaction = sequelize.define('Transaction', {
    id: {
      type: DataTypes.UUID,
      defaultValue: DataTypes.UUIDV4,
      primaryKey: true,
      allowNull: false,
    },
    merchantId: {
      type: DataTypes.UUID,
      allowNull: false,
      field: 'merchant_id',
      references: {
        model: 'merchants',
        key: 'id',
      },
    },
    shortId: {
      type: DataTypes.STRING,
      allowNull: false,
      field: 'short_id',
      index: true,
    },
    customerId: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'customer_id',
      index: true,
    },
    externalId: {
      type: DataTypes.STRING,
      allowNull: true,
      field: 'external_id',
      comment: 'Processor transaction ID (e.g., Stripe charge ID)',
    },
    processor: {
      type: DataTypes.STRING,
      allowNull: false,
      validate: {
        isIn: [['stripe', 'paypal', 'adyen', 'square', 'braintree']],
      },
    },
    amount: {
      type: DataTypes.DECIMAL(15, 4),
      allowNull: false,
      validate: {
        min: 0.01,
      },
    },
    currency: {
      type: DataTypes.STRING(3),
      allowNull: false,
      validate: {
        isUppercase: true,
        len: [3, 3],
      },
    },
    status: {
      type: DataTypes.ENUM(
        'pending',
        'processing',
        'succeeded',
        'failed',
        'refunded',
        'partially_refunded',
        'disputed',
        'charged_back',
        'voided'
      ),
      defaultValue: 'pending',
      allowNull: false,
    },
    paymentMethod: {
      type: DataTypes.ENUM('card', 'bank', 'wallet', 'crypto', 'other'),
      allowNull: false,
      field: 'payment_method',
    },
    paymentToken: {
      type: DataTypes.STRING(255),
      allowNull: true,
      field: 'payment_token',
      comment: 'Tokenized payment data',
    },
    description: {
      type: DataTypes.TEXT,
      allowNull: true,
    },
    metadata: {
      type: DataTypes.JSONB,
      allowNull: true,
      defaultValue: {},
    },
    fraudScore: {
      type: DataTypes.DECIMAL(3, 2),
      allowNull: true,
      field: 'fraud_score',
      validate: {
        min: 0,
        max: 1,
      },
    },
    fraudCheckPassed: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      field: 'fraud_check_passed',
      defaultValue: true,
    },
    fraudReasons: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: 'fraud_reasons',
      defaultValue: [],
    },
    routingDecision: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: 'routing_decision',
      comment: 'Details about why processor was selected',
    },
    processorResponse: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: 'processor_response',
      comment: 'Raw response from payment processor',
    },
    errorCode: {
      type: DataTypes.STRING(100),
      allowNull: true,
      field: 'error_code',
    },
    errorMessage: {
      type: DataTypes.TEXT,
      allowNull: true,
      field: 'error_message',
    },
    refundedAmount: {
      type: DataTypes.DECIMAL(15, 4),
      allowNull: false,
      field: 'refunded_amount',
      defaultValue: 0,
    },
    refundIds: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: 'refund_ids',
      defaultValue: [],
    },
    capturedAmount: {
      type: DataTypes.DECIMAL(15, 4),
      allowNull: false,
      field: 'captured_amount',
      defaultValue: 0,
    },
    captureIds: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: 'capture_ids',
      defaultValue: [],
    },
    settledAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'settled_at',
    },
    refundedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'refunded_at',
    },
    webhookEvents: {
      type: DataTypes.JSONB,
      allowNull: true,
      field: 'webhook_events',
      defaultValue: [],
    },
    createdAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'created_at',
      defaultValue: DataTypes.NOW,
    },
    updatedAt: {
      type: DataTypes.DATE,
      allowNull: false,
      field: 'updated_at',
      defaultValue: DataTypes.NOW,
    },
    deletedAt: {
      type: DataTypes.DATE,
      allowNull: true,
      field: 'deleted_at',
    },
  }, {
    tableName: 'transactions',
    paranoid: true, // Soft deletes
    timestamps: true,
    underscored: true,
    indexes: [
      {
        fields: ['merchant_id', 'created_at'],
      },
      {
        fields: ['status', 'created_at'],
      },
      {
        fields: ['customer_id'],
      },
      {
        fields: ['external_id'],
        unique: true,
      },
      {
        fields: ['payment_token'],
      },
    ],
  });

  // Class Methods
  Transaction.findByMerchant = async function(merchantId, options = {}) {
    const { limit = 100, offset = 0, status, startDate, endDate } = options;
    
    const where = { merchantId: merchantId };
    if (status) where.status = status;
    if (startDate || endDate) {
      where.createdAt = {};
      if (startDate) where.createdAt[sequelize.Op.gte] = startDate;
      if (endDate) where.createdAt[sequelize.Op.lte] = endDate;
    }
    
    return this.findAndCountAll({
      where,
      limit,
      offset,
      order: [['created_at', 'DESC']],
    });
  };

  Transaction.prototype.markAsSucceeded = async function(processorResponse) {
    this.status = 'succeeded';
    this.processorResponse = processorResponse;
    this.settledAt = new Date();
    return this.save();
  };

  Transaction.prototype.markAsFailed = async function(errorCode, errorMessage) {
    this.status = 'failed';
    this.errorCode = errorCode;
    this.errorMessage = errorMessage;
    return this.save();
  };

  Transaction.prototype.addRefund = async function(refundId, amount) {
    const refundedAmount = parseFloat(this.refundedAmount) + parseFloat(amount);
    this.refundedAmount = refundedAmount;
    
    this.refundIds = [...(this.refundIds || []), refundId];
    
    if (refundedAmount >= this.amount) {
      this.status = 'refunded';
      this.refundedAt = new Date();
    } else if (refundedAmount > 0) {
      this.status = 'partially_refunded';
    }
    
    return this.save();
  };

  Transaction.prototype.addCapture = async function(captureId, amount) {
    const capturedAmount = parseFloat(this.capturedAmount) + parseFloat(amount);
    this.capturedAmount = capturedAmount;
    this.captureIds = [...(this.captureIds || []), captureId];
    return this.save();
  };

  Transaction.prototype.addWebhookEvent = async function(event) {
    this.webhookEvents = [...(this.webhookEvents || []), {
      id: uuidv4(),
      type: event.type,
      source: event.source,
      timestamp: new Date().toISOString(),
      data: event.data,
    }];
    return this.save();
  };

  // Hooks
  Transaction.beforeCreate(async (transaction) => {
    // Generate a short reference ID for customer-facing use
    if (!transaction.shortId) {
      transaction.shortId = `txn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
  });

  Transaction.afterUpdate(async (transaction) => {
    // Audit log for status changes
    if (transaction.changed('status')) {
      const AuditLog = sequelize.models.AuditLog;
      await AuditLog.create({
        entityType: 'transaction',
        entityId: transaction.id,
        action: 'status_change',
        oldValue: transaction.previous('status'),
        newValue: transaction.status,
        userId: transaction.updatedBy || 'system',
        metadata: {
          reason: transaction.statusChangeReason,
        },
      });
    }
  });

  // Instance Methods
  Transaction.prototype.toJSON = function() {
    const values = Object.assign({}, this.get());
    
    // Remove sensitive data
    delete values.paymentToken;
    delete values.processorResponse?.raw;
    delete values.metadata?.internal;
    
    // Add computed fields
    values.availableForRefund = parseFloat(values.amount) - parseFloat(values.refundedAmount);
    values.availableForCapture = parseFloat(values.amount) - parseFloat(values.capturedAmount);
    values.isFullyRefunded = parseFloat(values.refundedAmount) >= parseFloat(values.amount);
    values.isFullyCaptured = parseFloat(values.capturedAmount) >= parseFloat(values.amount);
    
    return values;
  };

  return Transaction;
};