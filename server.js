const { startServer } = require('./src/app.js');

async function bootstrap() {
  try {
    console.log('🚀 Booting Payment Gateway Proxy...');
    await startServer();
  } catch (error) {
    console.error('Failed to bootstrap application:', error);
    process.exit(1);
  }
}

// Only run if this is the main module
if (require.main === module) {
  bootstrap();
}

module.exports = bootstrap;