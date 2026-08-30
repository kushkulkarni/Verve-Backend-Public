const express = require('express');
const authController = require('./../controllers/authController');
const clubController = require('./../controllers/clubController');
const guideController = require('./../controllers/guideController');
const multerController = require('./../controllers/multerController');

const router = express.Router();

//  Protect all routes after this middleware, Also check for any pending reviews.
router.use(authController.protect);
router.use(guideController.checkForPendingReviews);

router.get('/clubs', clubController.getAllClubs);
router.get('/my-clubs', clubController.getMyClubs);
router.post('/:clubId/submit-form/:formId', clubController.submitForm);
router.post('/request-club-formation', clubController.requestClubCreation);
router.get('/club-formation-requests', clubController.getYourClubRequests);
router.post('/:clubId/leave-club', clubController.leaveClub);
///////////////////////////////// !!! UPDATE !!! CHANGED FROM get-all-forms -> get-all-recruitments ALSO ALLOWED ACCESS TO EVERYONE TO GET THE RECRUITMENT CYCLE

/////////////////////// MADE BY HM ////////////////////////////////////////////// MADE BY HM ////////////////////////////////////////////// MADE BY HM ///////////////////////

//1) rout to create Event ->
router.post(
  '/:clubId/create-event',
  authController.restrictTo(
    ['student'],
    ['club_president', 'club_secretary', 'club_coreMember', 'club_chairperson'],
  ),
  multerController.uploadClubAnnouncements,
  multerController.resizeClubAnnouncements,
  clubController.createEvent,
);
//2) rout to delete Event ->
router.delete(
  '/:clubId/delete-event',
  authController.restrictTo(
    ['student'],
    ['club_president', 'club_secretary', 'club_coreMember', 'club_chairperson'],
  ),
  clubController.deleteEvent,
);
// 3) rout to create news ->
router.post(
  '/:clubId/create-news',
  authController.restrictTo(
    ['student'],
    ['club_president', 'club_secretary', 'club_coreMember', 'club_chairperson'],
  ),
  multerController.uploadClubAnnouncements,
  multerController.resizeClubAnnouncements,
  clubController.createNews,
);

// 4) rout to delete news ->
router.post(
  '/:clubId/delete-news',
  authController.restrictTo(
    ['student'],
    ['club_president', 'club_secretary', 'club_coreMember', 'club_chairperson'],
  ),
  clubController.deleteNews,
);

/////////////////////// MADE BY HM ////////////////////////////////////////////// MADE BY HM ////////////////////////////////////////////// MADE BY HM ///////////////////////

router.get(
  '/:clubId/get-all-recruitments',
  clubController.getAllRecruitmentCycles,
);
router.get(
  '/:clubId/get-recruitment-form/:formId',
  clubController.getRecruitmentForm,
);
///////////////////////////////// !!! UPDATE !!! ADDED THIS NEW ROUTE SO USER CAN SEE SPECIFIC RECRUITMENT PROCESS HE HAS ENROLLED IN ONLY!
router.get(
  '/:clubId/get-user-form-responses',
  clubController.getUserFormResponses,
);
///////////////////////////////// !!! UPDATE !!! ADDED THIS NEW ROUTE SO USER CAN SEE SPECIFIC RECRUITMENT STAGE PROCESS IF HE HAS ENROLLED FOR THAT CYCLE!
///////////////////////////////// !!! UPDATE !!! MADE IT A POST ROUTE!
// show frontend the requested recruitment stage and its details: 'applied' ||'exam' ||'interview' ||'final'
router.post(
  '/:clubId/get-recruitmentStage-data/:formId',
  clubController.getRecruitmentStageData,
);

// 5) rout to get all events news ->
// router.get("/get-all-events", clubController.getAllEvents);

// 6) rout to get all news news ->
router.get('/get-all-news', clubController.getAllNews);

// 7) rout te get all events for a specific club ->
router.get('/:clubId/getEventsByClub', clubController.getEventsByClub);
////////////////////////////////////////////////////////////////////////////////////////////////////////////////////

router.post(
  '/:clubId/create-promotion-proposal',
  clubController.createPromotionProposal,
); //////// In-built restrictTo() validation

router.get(
  '/:clubId/get-club-proposals',
  authController.restrictTo(['student'], ['club_coreMember', 'club_president']),
  clubController.getClubProposals,
);

router.get(
  '/:clubId/get-proposal/:proposalId',
  authController.restrictTo(['student'], ['club_coreMember', 'club_president']),
  clubController.getSpecificClubProposal,
);
router.post(
  '/:clubId/voteOnProposal/:proposalId',
  clubController.voteOnProposal,
); //////// In-built restrictTo() validation

router.post(
  '/:clubId/selectForNextStage',
  authController.restrictTo(
    ['student'],
    ['club_president', 'club_secretary', 'club_coordinator'],
  ),
  clubController.selectForNextStage,
);

router.get(
  '/:clubId/clubMembers',
  authController.restrictTo(
    ['student'],
    [
      'club_president',
      'club_secretary',
      'club_coordinator',
      'club_volunteer',
      'club_coreMember',
      'club_chairperson',
    ],
  ),
  clubController.getClubMembers,
);

// After this middleware, only people with post of President, secretary and Core member can perform operations.
router.use(
  '/:clubId',
  authController.restrictTo(
    ['student'],
    ['club_president', 'club_secretary', 'club_coreMember'],
  ),
);

router.post('/:clubId/remove-members', clubController.removeFromClub);
// first, feed the frontend all the created forms by presdient

// After this middleware, only people with post of President and secretary can perform operations.
router.use(
  '/:clubId',
  authController.restrictTo(['student'], ['club_president', 'club_secretary']),
);

router.post('/:clubId/lock-form/:formId', clubController.lockForm);
router.post(
  '/:clubId/promote-to-coordinator',
  clubController.promoteToCoordinator,
);

// president creates a new recruitment form
router.post(
  '/:clubId/create-form',
  authController.restrictTo(['student'], ['club_president']),
  clubController.createRecruitmentForm,
);

// Feed the frontend will all the responses for the specific form created by presdient
router.get('/:clubId/form-responses/:formId', clubController.getFormResponses);

// Explicitly set a route only accessible to prrsident and the secretary if any
// volunteer by bymistake left to get added in the club during recruitment process
router.patch('/:clubId/recruit', clubController.addNewClubVolunteer);

module.exports = router;
