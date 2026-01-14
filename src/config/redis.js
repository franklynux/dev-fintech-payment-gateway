const Redis = require('redis');
const config = require('./index');

const redis = Redis.createClient({
  url: config.redis.url,
});

redis.on('error', (err) => {
  console.error('Redis Client Error:', err);
});

redis.on('connect', () => {
  console.log('Redis connected successfully');
});

redis.connect();

module.exports = redis;