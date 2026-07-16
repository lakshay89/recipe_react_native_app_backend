const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const logger = require('./config/logger');
const requestId = require('./middlewares/requestId');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');
const routes = require('./routes');

const app = express();

// Security headers
app.use(helmet());

// CORS configuration
app.use(cors());

// Parse requests
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Trace ID setup
app.use(requestId);

// Pino HTTP logger logging request details
app.use(pinoHttp({
  logger,
  genReqId: (req) => req.id,
  customLogLevel: (req, res, err) => {
    if (res.statusCode >= 500 || err) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
}));

// API Routes
app.use('/api/v1', routes);

// Route not found handling
app.use(notFound);

// Global Error Handler
app.use(errorHandler);

module.exports = app;
