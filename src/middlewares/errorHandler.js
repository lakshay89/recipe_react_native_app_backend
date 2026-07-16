const config = require('../config/environment');
const logger = require('../config/logger');
const { sendError } = require('../utils/apiResponse');

const errorHandler = (err, req, res, next) => {
  let { statusCode = 500, message } = err;

  // Handle mongoose schema validation or cast errors
  if (err.name === 'ValidationError') {
    statusCode = 400;
    message = Object.values(err.errors).map((val) => val.message).join(', ');
  } else if (err.name === 'CastError') {
    statusCode = 400;
    message = `Invalid field: ${err.path}`;
  }

  // Log error using pino logger
  logger.error({
    requestId: req.id,
    method: req.method,
    url: req.originalUrl,
    message: err.message,
    stack: err.stack,
  });

  const responseError = config.NODE_ENV === 'development' ? {
    stack: err.stack,
    isOperational: err.isOperational,
  } : null;

  sendError(res, message, statusCode, responseError);
};

module.exports = errorHandler;
