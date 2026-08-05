const mongoose = require('mongoose');
const dns = require('node:dns');

const config = require('./environment');
const logger = require('./logger');
// Prefer IPv4 when both IPv4 and IPv6 results are available.
dns.setDefaultResultOrder('ipv4first');

const connectDB = async () => {
  const mongoUri =
    config.MONGODB_URI ||
    process.env.MONGODB_URI ||
    process.env.MONGO_URI;

  if (!mongoUri) {
    throw new Error('MONGODB_URI is missing in the .env file');
  }

  try {
    const connection = await mongoose.connect(mongoUri.trim(), {
      autoIndex: config.NODE_ENV !== 'production',
      serverSelectionTimeoutMS: 5000,
    });

    logger.info(
      {
        host: connection.connection.host,
        database: connection.connection.name,
      },
      'MongoDB connected using default DNS resolver'
    );

    return connection;
  } catch (err) {
    logger.warn(`Initial MongoDB connection failed: ${err.message}. Retrying with Google DNS fallback...`);

    try {
      dns.setServers([
        '8.8.8.8',
        '8.8.4.4',
      ]);
      const connection = await mongoose.connect(mongoUri.trim(), {
        autoIndex: config.NODE_ENV !== 'production',
        serverSelectionTimeoutMS: 5000,
      });

      logger.info(
        {
          host: connection.connection.host,
          database: connection.connection.name,
        },
        'MongoDB connected using Google DNS workaround'
      );

      return connection;
    } catch (fallbackErr) {
      logger.fatal(`MongoDB connection completely failed: ${fallbackErr.message}`);
      throw fallbackErr;
    }
  }
};

const disconnectDB = async () => {
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
};

module.exports = {
  connectDB,
  disconnectDB,
};