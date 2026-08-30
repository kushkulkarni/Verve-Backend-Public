const express = require('express');
const superAdminController = require('./../controllers/superAdminController');
const authController = require('./../controllers/authController');

const router = express.Router();

router.use(authController.protect);

router.use(authController.restrictTo((roles = ['super-admin'])));

router.post('/createAdmin', superAdminController.createAdminAccount);

router.delete('/deleteAdmin', superAdminController.deactivateOldAdminAccount);

module.exports = router;
