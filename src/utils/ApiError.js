class ApiError extends Error {
  constructor(statusCode, message, code = 'INTERNAL_ERROR', errors = null, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.errors = errors;
    this.isOperational = isOperational;
    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = ApiError;
