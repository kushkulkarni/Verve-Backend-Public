const express = require('express');
const clubController = require('./../controllers/clubController');
const authController = require('./../controllers/authController');
const reportController = require('./../controllers/reportController');

const router = express.Router();

////////////////////// ADMIN ACCESSIBLE ROUTES //////////////////////
router.use(authController.protect);
router.use(authController.restrictTo((roles = ['admin'])));

router.get('/college-clubs', clubController.getAllClubsForAdmin);
// router.post('/:clubId/addClubCoreMembers', clubController.addToCoreMemberPanel);
router.get('/club-requests', clubController.getAllClubRequests);
router.post(
  '/approve-club-request/:requestId',
  clubController.approveClubRequest,
);
router.post(
  '/reject-club-request/:requestId',
  clubController.rejectClubRequest,
);

router.get('/getAllClubs-Admin', clubController.getAllClubsForAdmin);
router.post('/:clubId/addClubCoreMembers', clubController.addToCoreMemberPanel); ///////// const { userVerifiedEmails } = req.body; /////////

// ------------------- HM --------------------------------------------------------------------------//
// 1) to get all reported posts seperately by 2 models
// router.get("/getAllReportedAchievements",reportController.getAllReportedAchievements);
// router.get("/getAllReportedAnonymous",reportController.getAllReportedAnonymous);
// 2) to delete single reported post seperately by 2 models
router.delete(
  '/deleteReportedAchievement/:postId',
  reportController.deleteReportedAchievement,
);
router.delete(
  '/deleteReportedAnonymous/:postId',
  reportController.deleteReportedAnonymous,
);

// 3) to delete the reviewed posts from the report model and keep in 2 models as it is.
router.delete(
  '/reviewReportedAchievement/:postId',
  reportController.reviewReportedPostAchievement,
);
router.delete(
  '/reviewReportedAnonymous/:postId',
  reportController.reviewReportedPostAnonymous,
);

router.get('/reports', reportController.getReports);

//--------------------------------------------------------------------------------------------------//

module.exports = router;
