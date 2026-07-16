const sendSuccess = (res, message, data = {}, statusCode = 200) => {
  return res.status(statusCode).json({
    success: true,
    message,
    data,
  });
};

const sendError = (res, message, statusCode = 500, details = null) => {
  return res.status(statusCode).json({
    success: false,
    message,
    error: details,
  });
};

module.exports = { sendSuccess, sendError };
