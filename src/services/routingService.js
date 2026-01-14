class RoutingService {
  constructor(merchantConfig, processors) {
    this.merchantConfig = merchantConfig;
    this.processors = processors;
  }

  async selectProcessor(transactionData) {
    const { merchantId, amount, currency, region } = transactionData;
    
    // Get merchant configuration
    const merchantConfig = await this.getMerchantConfig(merchantId);
    
    // Rule-based routing
    const rules = [
      this.routeByMerchantPreference,
      this.routeByRegion,
      this.routeByCost,
      this.routeBySuccessRate,
    ];

    for (const rule of rules) {
      const processor = await rule.call(this, merchantConfig, transactionData);
      if (processor && this.processors[processor]) {
        return this.processors[processor];
      }
    }

    // Default to first available processor
    return Object.values(this.processors)[0];
  }

  routeByMerchantPreference(merchantConfig) {
    return merchantConfig.preferredProcessor;
  }

  routeByRegion(merchantConfig, transactionData) {
    const { region } = transactionData;
    const regionalProcessor = merchantConfig.regionalRouting[region];
    return regionalProcessor || null;
  }

  async routeByCost(merchantConfig, transactionData) {
    const { amount, currency } = transactionData;
    
    // Calculate costs for available processors
    const processorCosts = await Promise.all(
      Object.entries(this.processors).map(async ([name, processor]) => ({
        name,
        cost: await processor.calculateFee(amount, currency),
      }))
    );

    return processorCosts.sort((a, b) => a.cost - b.cost)[0]?.name;
  }

  async routeBySuccessRate(merchantConfig, transactionData) {
    // Get historical success rates from monitoring
    const successRates = await this.getProcessorSuccessRates();
    
    return Object.entries(successRates)
      .sort(([, rateA], [, rateB]) => rateB - rateA)[0]?.[0];
  }

  async getMerchantConfig(merchantId) {
    // Implement merchant configuration fetching
    // Could be from database, Redis, or config service
    return this.merchantConfig[merchantId] || {};
  }

  async getProcessorSuccessRates() {
    // Implement success rate monitoring
    // Could be from Prometheus metrics
    return {};
  }
}

module.exports = RoutingService;