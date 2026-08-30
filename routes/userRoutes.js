const express = require('express');
const userController = require('./../controllers/userController');
const authController = require('./../controllers/authController');
const cloudinaryController = require('./../controllers/cloudinaryController');
const multer = require('multer');
const { upload } = require('../utils/cloudinary');
const guideController = require('./../controllers/guideController');
const multerController = require('./../controllers/multerController');
const reportController = require('./../controllers/reportController');
const clubController = require('./../controllers/clubController');
// const cloudinaryController = require('./../controllers/cloudinaryController');

const router = express.Router();

// router.post('/sendTempMail', clubController.checkMailTest);
router.post('/checkMailGentlemen', clubController.checkMail);
router.post(
  '/signup',
  // cloudinaryController.parseFormData,
  // cloudinaryController.uploadToCloudinary,
  multerController.uploadProfile,
  multerController.resizeProfilePhoto,
  // authController.verifyStudentEmail, ////// THIS WILL BE A NEW ENDPOINT FOR BETTER FRONTEND FLOW...
  authController.signup,
);
router.get('/check-username/:username', authController.checkUsername);
router.post('/login', authController.login);
router.post('/admin-login', authController.adminLogin);
router.post('/fcm-token', authController.protect, authController.storeFcmToken);
router.post('/sendOTP', authController.sendVerificationMail);
router.post('/verifyOTP', authController.verifyStudentEmail);
router.post('/forgotPassword', authController.forgotPassword);
router.patch('/resetPassword/:token', authController.resetPassword);

//  Protect all routes after this middleware, Also check for any pending reviews.
router.use(authController.protect);
router.post('/logout', authController.logout);
router.use(guideController.checkForPendingReviews);

router.post('/send-email-change-otp', authController.sendEmailChangeOTP);

router.patch('/update-email', authController.verifyAndUpdateEmail);

router.patch('/updateMyPassword', authController.updatePassword);

// router.get('/me', userController.getMe, userController.getUser); ///////////////////// Yet to make this ROUTE
router.patch(
  '/updateMe',
  cloudinaryController.parseFormData,
  userController.updateMe,
);
router.post(
  '/deleteMe',
  authController.verifyUserByPassword,
  userController.deleteMe,
);

router.get('/notifications', userController.getNotifications);

router.post(
  '/post-achievement',
  authController.restrictTo((roles = ['student'])),
  multerController.uploadPost,
  multerController.resizePostPhoto,
  userController.postAchievement,
);
router.post(
  '/post-anonymous',
  authController.restrictTo((roles = ['student'])),
  multerController.uploadPost,
  multerController.resizePostPhoto,
  userController.postAnonymous,
);
router.post(
  '/comment-achievement/:postId',
  // authController.restrictTo((roles = ['student'])),
  // cloudinaryController.parseFormData,
  userController.addAchievementPostComment,
);
router.post(
  '/comment-anonymous/:postId',
  authController.restrictTo((roles = ['student'])),
  // cloudinaryController.parseFormData,
  userController.addAnonymousPostComment,
);
router.post(
  '/like-achievement',
  authController.restrictTo((roles = ['student'])),
  userController.likeAchievement,
);
router.post(
  '/like-anonymous',
  authController.restrictTo((roles = ['student'])),
  userController.likeAnonymous,
);
router.delete(
  '/delete-achievement/:postId',
  authController.restrictTo((roles = ['student'])),
  userController.deleteAchievement,
);
router.delete(
  '/delete-comment/:commentId',
  authController.restrictTo((roles = ['student'])),
  userController.deleteComment,
);
router.patch(
  '/update-me',
  authController.restrictTo((roles = ['student'])),
  multerController.uploadProfile,
  multerController.resizeProfilePhoto,
  userController.updateMe,
);
router.delete(
  '/delete-me',
  authController.restrictTo((roles = ['student'])),
  userController.deleteMe,
);
router.get(
  '/profile',
  authController.restrictTo((roles = ['student'])),
  userController.getMyProfile,
);
router.get(
  '/other-profile/:userId',
  authController.restrictTo((roles = ['student'])),
  userController.getOtherProfile,
);
router.get(
  '/postComments/:postId',
  authController.restrictTo((roles = ['student'])),
  userController.getPostComments,
);
// router.get(
//   '/anonymousComments/:postId',
//   authController.restrictTo((roles = ['student'])),
//   userController.getAnonymousComments,
// );
router.post(
  '/achievements-posts',
  authController.restrictTo((roles = ['student'])),
  userController.getAchievementPosts,
);
router.post(
  '/anonymous-posts',
  authController.restrictTo((roles = ['student'])),
  userController.getAnonymousPosts,
);

////////////////////////////////// !!! UPDATE !!! ADDED NEW ROUTE TO SEARCH USERS!
router.post(
  '/search-users',
  authController.restrictTo((roles = ['student'])),
  userController.searchUsers,
);

// --- HM  (report routes) ---------------------------------------------------------//

router.post(
  '/reportAchievementPost/:postId',
  authController.restrictTo((roles = ['student'])),
  reportController.createAchievementsReport,
);

router.post(
  '/reportAnonymousPost/:postId',
  authController.restrictTo((roles = ['student'])),
  reportController.createAnonymousReport,
);
router.post(
  '/block-user/:userId',
  authController.restrictTo((roles = ['student'])),
  userController.blockUser,
);
router.post(
  '/unblock-user/:userId',
  authController.restrictTo((roles = ['student'])),
  userController.unblockUser,
);

// ---------------------------------------------------------------//

// Restrict all routes to admin only after this middleware
router.use('/admin', authController.restrictTo((roles = ['admin'])));

// router
//   .route('/')
//   .get(userController.getAllUsers)
//   .post(userController.createUser);

// router
//   .route('/:id')
//   .get(userController.getUser)
//   .patch(userController.updateUser)
//   .delete(userController.deleteUser);

module.exports = router;
