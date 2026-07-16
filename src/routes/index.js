const express = require('express');
const { sendSuccess } = require('../utils/apiResponse');
const router = express.Router();

router.get('/health', (req, res) => {
  sendSuccess(res, 'Edible India Backend is healthy.', {
    uptime: process.uptime(),
    timestamp: new Date(),
  });
});

module.exports = router;
