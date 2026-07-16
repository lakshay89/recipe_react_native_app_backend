const mongoose = require('mongoose');
const dns = require('dns');
const logger = require('./logger');
const config = require('./environment');

if (process.env.NODE_ENV !== 'production') {
  dns.setServers(['8.8.8.8', '8.8.4.4']);
}

dns.setDefaultResultOrder('ipv4first');

const connectDB = async () => {
  try {
    const mongoUri = config.MONGODB_URI || process.env.MONGODB_URI || process.env.MONGO_URI;

    if (!mongoUri) {
      throw new Error('MONGODB_URI is missing in .env');
    }

    const connection = await mongoose.connect(mongoUri.trim(), {
      autoIndex: process.env.NODE_ENV !== 'production',
    });

    logger.info(`🔌 Database Connected: ${connection.connection.host}/${connection.connection.name}`);
    console.log('db connect succesfully')
  } catch (error) {
    logger.fatal(`❌ Database Connection Failed: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
