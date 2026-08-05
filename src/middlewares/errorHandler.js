const config = require('../config/environment');
const logger = require('../config/logger');
const { sendError } = require('../utils/apiResponse');

const errorHandler = (err, req, res, next) => { // eslint-disable-line no-unused-vars
  let statusCode = err.statusCode || 500;
  let code = err.code || 'INTERNAL_ERROR';
  let message = err.message || 'An unexpected error occurred';
  let errors = err.errors || null;

  if (err.name === 'ValidationError') {
    statusCode = 422;
    code = 'VALIDATION_ERROR';
    message = 'Validation failed';
    errors = Object.values(err.errors).map((value) => ({ field: value.path, message: value.message }));
  } else if (err.code === 'LIMIT_FILE_COUNT') {
    statusCode = 400;
    code = 'TOO_MANY_IMAGES';
    message = 'Cannot upload more than 5 images per scan.';
  } else if (err.code === 'LIMIT_FILE_SIZE') {
    statusCode = 400;
    code = 'IMAGE_TOO_LARGE';
    message = 'Image exceeds the 8MB size limit.';
  } else if (err.name === 'MulterError') {
    statusCode = 400;
    code = 'INVALID_SCAN_REQUEST';
    message = err.message;
  } else if (err.name === 'CastError') {
    statusCode = 400;
    code = 'INVALID_ID';
    message = `Invalid ${err.path}`;
  } else if (err.code === 11000) {
    statusCode = 409;
    code = 'DUPLICATE_RESOURCE';
    message = 'A record with that value already exists';
    errors = Object.keys(err.keyPattern || {}).map((field) => ({ field, message: `${field} already exists` }));
  }

  logger[statusCode >= 500 ? 'error' : 'warn']({ err, requestId: req.id, method: req.method, url: req.originalUrl }, message);
  if (statusCode >= 500 && config.NODE_ENV === 'production') message = 'An unexpected error occurred';
  return sendError(res, { message, statusCode, code, errors, requestId: req.id });
};

module.exports = errorHandler;
