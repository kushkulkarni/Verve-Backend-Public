const express = require('express');
const userController = require('./../controllers/userController');
const authController = require('./../controllers/authController');
const guideController = require('./../controllers/guideController');

const router = express.Router();

//  Protect all routes after this middleware
router.use(authController.protect);
router.use(authController.restrictTo(['student']));

router.post('/give-review', guideController.giveReview);

// Make sure user has no pending reviews and then allow for other actions.
router.use(guideController.checkForPendingReviews);

router.patch('/open-to', guideController.openToAsGuide);
router.patch('/close-to', guideController.closeAsGuide);

router.post('/get-verified', guideController.getVerifiedGuideBatch);
router.post('/start-doubt', guideController.startDoubt);
router.post(
  '/search-guides',
  authController.restrictTo((roles = ['student'])),
  guideController.searchGuides,
);

module.exports = router;
