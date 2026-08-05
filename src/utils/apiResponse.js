const sendSuccess = (res, message, data = {}, statusCode = 200, meta = null) => res.status(statusCode).json({
  success: true,
  message,
  data,
  meta,
});

const sendError = (res, { message, statusCode = 500, code = 'INTERNAL_ERROR', errors = null, requestId }) => res.status(statusCode).json({
  success: false,
  message,
  code,
  errors,
  requestId,
});

module.exports = { sendSuccess, sendError };
