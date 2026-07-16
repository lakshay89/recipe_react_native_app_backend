const app = require('./src/app');
const config = require('./src/config/environment');
const connectDB = require('./src/config/database');
const logger = require('./src/config/logger');

let server;

const boot = async () => {
  // Connect Database
  await connectDB();

  // Start HTTP Server
  server = app.listen(config.PORT, () => {
    logger.info(`🚀 Server running on port ${config.PORT} [${config.NODE_ENV}]`);
  });
};

boot();

// Handle termination signals for graceful shutdown
const shutdown = () => {
  logger.info('⚠️ Received shutdown signal. Closing active server handles...');
  if (server) {
    server.close(() => {
      logger.info('🛑 Express server closed.');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
};

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

process.on('uncaughtException', (error) => {
  logger.fatal({ error: error.message, stack: error.stack }, '❌ Uncaught Exception detected! Node shutting down...');
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, '❌ Unhandled Promise Rejection detected! Node shutting down...');
  process.exit(1);
});
