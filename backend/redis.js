const { createClient } = require('redis');

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const client = createClient({ url: redisUrl });

client.on('error', (error) => console.error('Error de Redis:', error.message));

async function connectRedis() {
  if (!client.isOpen) await client.connect();
  return client;
}

module.exports = { client, connectRedis };
