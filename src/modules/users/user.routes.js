const express = require('express');
const authenticate = require('../../middlewares/authenticate');
const validate = require('../../middlewares/validate');
const controller = require('./user.controller');
const validation = require('./user.validation');

const router = express.Router();
router.use(authenticate);
router.get('/', controller.me);
router.patch('/profile', validate(validation.updateProfile), controller.updateProfile);
router.patch('/password', validate(validation.changePassword), controller.changePassword);
module.exports = router;
