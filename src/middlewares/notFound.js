const ApiError = require('../utils/ApiError');

module.exports = (req, res, next) => next(new ApiError(404, `Route ${req.method} ${req.originalUrl} not found`, 'ROUTE_NOT_FOUND'));
