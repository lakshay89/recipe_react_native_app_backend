const express = require('express');
const { sendSuccess } = require('../utils/apiResponse');
const recipeParserRoute = require('./recipeParserRoute');
const authRoutes = require('../modules/auth/auth.routes');
const userRoutes = require('../modules/users/user.routes');
const submissionRoutes = require('./submission.routes');
const mediaRoutes = require('./media.routes');
const recipeImportRoutes = require('./recipeImport.routes');

const router = express.Router();

router.get('/health', (req, res) => {
  sendSuccess(res, 'Edible India Backend is healthy.', {
    uptime: process.uptime(),
    timestamp: new Date(),
  });
});

router.use('/auth', authRoutes);
router.use('/users', userRoutes);
router.use('/recipes', recipeParserRoute);
router.use('/', submissionRoutes);
router.use('/', mediaRoutes);
router.use('/', recipeImportRoutes);

module.exports = router;
