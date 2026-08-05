const http = require('http');
const mongoose = require('mongoose');

const app = require('./src/app');
const config = require('./src/config/environment');
const logger = require('./src/config/logger');
const {
  connectDB,
  disconnectDB,
} = require('./src/config/database');

const server = http.createServer(app);

const startServer = async () => {
  try {
    await connectDB();

    server.listen(config.PORT, () => {
      logger.info(
        {
          port: config.PORT,
          environment: config.NODE_ENV,
        },
        'Edible India backend started'
      );
    });
  } catch (error) {
    logger.fatal(
      {
        error: error.message,
      },
      'Backend startup failed'
    );

    process.exit(1);
  }
};

let isShuttingDown = false;

const shutdown = async (signal) => {
  if (isShuttingDown) {
    return;
  }

  isShuttingDown = true;

  logger.info({ signal }, 'Shutting down backend');

  server.close(async (error) => {
    if (error) {
      logger.error(
        {
          error: error.message,
        },
        'HTTP server could not close cleanly'
      );
    }

    try {
      await disconnectDB();

      logger.info('Database connection closed');
      process.exit(error ? 1 : 0);
    } catch (databaseError) {
      logger.error(
        {
          error: databaseError.message,
        },
        'Database connection could not close cleanly'
      );

      process.exit(1);
    }
  });

  setTimeout(() => {
    logger.fatal('Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('uncaughtException', (error) => {
  logger.fatal(
    {
      error: error.message,
      stack: error.stack,
    },
    'Uncaught exception'
  );

  shutdown('uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  logger.fatal(
    {
      reason,
    },
    'Unhandled promise rejection'
  );

  shutdown('unhandledRejection');
});

startServer();