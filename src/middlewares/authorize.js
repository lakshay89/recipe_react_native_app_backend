const ApiError = require('../utils/ApiError');
module.exports = (...roles) => (req, res, next) => roles.includes(req.user.role) ? next() : next(new ApiError(403, 'You do not have permission for this action', 'FORBIDDEN'));
