const redis = require('redis');

// const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
// console.log('Connecting to Redis at:', redisUrl);

const client = redis.createClient({
  url: process.env.REDIS_URL,
  // url: 'redis://redis:6379',
  // url: 'redis://localhost:6379',
});

client.on('connect', () => console.log('Connected to Redis'));
client.on('error', (err) => console.error('Redis error:', err));

(async () => {
  try {
    await client.connect();
    // console.log('Connected to Redis');
  } catch (err) {
    console.error('Redis connection failed, retrying in 3s...', err);
    setTimeout(connectRedis, 3000);
  }
})();

module.exports = client;
