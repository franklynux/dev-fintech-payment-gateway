const axios = require('axios');

class FraudService {
  constructor(config) {
    this.fraudServiceUrl = config.fraudServiceUrl;
    this.apiKey = config.apiKey;
    this.threshold = config.threshold || 0.7;
  }

  async scoreTransaction(transactionData) {
    try {
      const response = await axios.post(
        `${this.fraudServiceUrl}/score`,
        this.prepareFraudPayload(transactionData),
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 5000, // 5 second timeout
        }
      );

      const { score, reasons, recommendedAction } = response.data;

      return {
        score,
        isFraudulent: score >= this.threshold,
        reasons: reasons || [],
        recommendedAction: recommendedAction || 'review',
      };
    } catch (error) {
      // Fail-open strategy: if fraud service is down, allow transaction
      // but log for review
      console.error('Fraud service error:', error.message);
      return {
        score: 0,
        isFraudulent: false,
        reasons: ['fraud_service_unavailable'],
        recommendedAction: 'review',
      };
    }
  }

  prepareFraudPayload(transactionData) {
    return {
      transaction: {
        id: transactionData.id,
        amount: transactionData.amount,
        currency: transactionData.currency,
        customer: {
          id: transactionData.customerId,
          email: transactionData.email,
          ip: transactionData.ipAddress,
          deviceFingerprint: transactionData.deviceFingerprint,
        },
        billing: transactionData.billingAddress,
        shipping: transactionData.shippingAddress,
        items: transactionData.items,
        metadata: transactionData.metadata,
      },
      timestamp: new Date().toISOString(),
    };
  }
}

module.exports = FraudService;