const pino = require('pino');
const config = require('./environment');

const options = {
  level: config.LOG_LEVEL,
  redact: {
    paths: ['req.headers.authorization', 'password', 'passwordHash', 'refreshToken', 'otp', '*.password', '*.refreshToken', '*.otp'],
    censor: '[REDACTED]',
  },
};

if (config.NODE_ENV === 'development') {
  options.transport = {
    target: 'pino-pretty',
    options: { colorize: true, ignore: 'pid,hostname', translateTime: 'SYS:yyyy-mm-dd HH:MM:ss' },
  };
}

module.exports = pino(options);
