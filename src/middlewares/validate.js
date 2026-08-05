const ApiError = require('../utils/ApiError');

const validate = (schemas) => (req, res, next) => {
  const issues = [];
  for (const location of ['params', 'query', 'body']) {
    if (!schemas[location]) continue;
    const result = schemas[location].safeParse(req[location]);
    if (!result.success) {
      issues.push(...result.error.issues.map((issue) => ({
        field: [location, ...issue.path].join('.'),
        message: issue.message,
      })));
    } else {
      req[location] = result.data;
    }
  }
  if (issues.length) return next(new ApiError(422, 'Validation failed', 'VALIDATION_ERROR', issues));
  return next();
};

module.exports = validate;
