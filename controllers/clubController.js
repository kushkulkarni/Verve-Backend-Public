const User = require('./../models/userModel');
// const crypto = require('crypto');
// const Comments = require('./../models/commentsModel');
// const Anonymous = require('./../models/anonymousModel');
// const Achievements = require('./../models/achievementsModel');
// const Likes = require('./../models/likesModel');
const Notification = require('./../models/notifications');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/appError');
// const { sendEmail } = require('./../utils/htmlContain');
const { sendMail } = require('./../utils/sendMail');
const Club = require('./../models/clubModel');
const sendNotification = require('./../utils/sendNotification');
const Form = require('./../models/formModel');
const FormResponse = require('./../models/formResponseModel');
const RecruitmentCycle = require('./../models/recruitmentCycleModel');
const PromotionProposal = require('./../models/promotionProposalModel');
const ClubCreationRequest = require('./../models/clubCreationRequestModel');
const mongoose = require('mongoose');
const { appendFile } = require('fs');
const cloudinary = require('cloudinary').v2;
const News = require('./../models/newsModel');
const Event = require('./../models/eventModel');
const APIFeatures = require('./../utils/apiFeatures');
const notificationSocketHandler = require('./../utils/notificationSocket');
const { eventQueue } = require('./jobsController');
const { deleteManyFromCloud, uploadStream } = require('./cloudinaryController');

exports.requestClubCreation = catchAsync(async (req, res, next) => {
  const {
    clubName,
    clubDescription,
    clubType,
    proposedPresidentEmail,
    proposedCoreTeamEmails,
    reasonForCreation,
  } = req.body;

  // console.log(proposedCoreTeamEmails);

  let proposedPresident = await User.findOne({
    email: proposedPresidentEmail,
  }).select('_id role email verificationEmail');

  // console.log('president Id is: ', proposedPresident._id);

  let proposedCoreTeam = await User.find({
    email: { $in: proposedCoreTeamEmails },
  }).select('_id role email verificationEmail');

  proposedCoreTeam = Array.isArray(proposedCoreTeam)
    ? proposedCoreTeam
    : [proposedCoreTeam];

  if (!proposedPresident) {
    return next(new AppError('No such user exists!', 400));
  }

  for (const A of proposedCoreTeam) {
    if (!A._id || A._id.toString() === proposedPresident._id.toString()) {
      return next(
        new AppError(
          'Please provide valid core team members which exists! The president should not be a part of core team too!',
          400,
        ),
      );
    } else if (
      A.role === 'admin' ||
      A.role === 'super-admin' ||
      proposedPresident.role === 'admin' ||
      proposedPresident.role === 'super-admin'
    ) {
      return next(
        new AppError(
          'The president and any core team member cannot be the admin, nor the super admin!',
          400,
        ),
      );
    }
  }

  const proposedCoreTeamIds = proposedCoreTeam.map((A) => A._id);
  const proposedPresidentId = proposedPresident._id;
  // console.log('President Id: ', proposedPresident);

  const existingRequest = await ClubCreationRequest.findOne({
    requestedBy: req.user.id,
  });
  if (existingRequest)
    return next(
      new AppError(
        'You already have a pending request, wait till it gets reviewed',
        400,
      ),
    );

  const newRequest = await ClubCreationRequest.create({
    requestedBy: req.user.id,
    clubName,
    clubDescription,
    clubType,
    proposedPresident: proposedPresidentId,
    proposedCoreTeam: proposedCoreTeamIds,
    reasonForCreation,
  });

  const admin = await User.findOne({ role: 'admin' }).select('role email');
  const adminMessage =
    'Club creation request has been introduced. Please check Admin dashboard for more details.';
  const nonAdminMessage =
    'Your club creation request has been sent succesfully.\n\n We will let you know once the admin reviews your request. You may check the request status and progress in your verve app -> profile -> settings -> club requests. [NOTE: If you have not requested for this club formation, report corresponding faculty]';

  try {
    const allUsers = [proposedPresident, admin, req.user];
    await Promise.allSettled(
      allUsers.map((user) => {
        sendMail({
          recipient: user,
          subject: `Request for new Club Creation (${clubName})`,
          name: `${user.role === 'admin' ? 'Admin' : user.name}`,
          message: `${user.role === 'admin' ? adminMessage : nonAdminMessage}`,
        });
      }),
    );
  } catch (error) {
    console.log('Email failed but club created successfully');
  }

  res.status(201).json({
    status: 'success',
    message: 'Club creation request submitted successfully',
    data: newRequest,
  });
});

// MAIL TEST // --------------------------//

exports.checkMail = async (req, res) => {
  try {
    const users = ['kushkkulkarni@gmail.com', 'harshmane1947@gmail.com'];
    // const recipients = users.map((email) => ({
    //   email,
    //   name: 'PARA SF',
    // }));

    // subject = 'Dhurandhar 3';
    // message = 'Ghar ki yaad nhi ayi Jassi';

    // 3. Send emails
    const result = await Promise.allSettled(
      users.map((user) => {
        return sendMail({
          recipient: user,
          subject: `Request for new Club Creation (Monkey)`,
          name: `${user.startsWith('kush') ? 'Admin' : 'Commando'}`,
          message: `${user.startsWith('kush') ? 'Club creation request has been introduced. Please check Admin dashboard for more details.' : 'Your club creation request has been sent succesfully.\n\n We will let you know once the admin reviews your request.'}`,
        });
      }),
    );

    res.status(200).json({
      status: 'success',
      result,
    });
  } catch (err) {
    res.status(500).json({
      status: 'error',
      message: err.message,
    });
  }
};
///////////////////////////////////////////////////////////////

exports.getYourClubRequests = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  const userRequests = await ClubCreationRequest.find({
    requestedBy: userId,
  }).populate(
    'proposedPresident proposedCoreTeam',
    'name username profilePicture_LowRes',
  );

  res.status(200).json({
    status: 'success',
    data: {
      clubRequests: userRequests,
    },
  });
});

////////////// ADMIN ONLY //////////////
exports.getAllClubsForAdmin = catchAsync(async (req, res, next) => {
  const college = req.user.college;
  const clubs = await Club.find({ collegeName: college }).populate(
    'clubPresident coreTeam',
    'name email verificationEmail profilePicture_HighRes username bio skills aura',
  );

  res.status(200).json({
    status: 'success',
    data: {
      clubs,
    },
  });
});

////////////////////////////////////////////////////// !!!UNDER MAINTAINANCE!!! //////////////////////////////////////////////////////
////////////// ADMIN ONLY //////////////
exports.addToCoreMemberPanel = catchAsync(async (req, res, next) => {
  const { clubId } = req.params;
  const { userVerifiedEmails } = req.body;

  // console.log('Entered addToCoreMemberPanel.');
  // console.log(userVerifiedEmails);

  if (!userVerifiedEmails.length) {
    return next(
      new AppError(
        `Please provide verified emails of users you want to add to the club's core team!`,
        400,
      ),
    );
  }

  const users = await User.find({
    active: true,
    verificationEmail: { $in: userVerifiedEmails },
  }).select('_id');

  // console.log(users);
  ////////////////// check if all provided users exists with active accounts //////////////////
  if (users.length !== userVerifiedEmails.length) {
    return next(
      new AppError(
        'Please provide valid email Ids of existing users only!',
        404,
      ),
    );
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    ////////////////// Update the club currentMembers array //////////////////
    const updatedClub = await Club.findByIdAndUpdate(
      clubId,
      {
        $addToSet: {
          coreTeam: { $each: users },
          currentMembers: { $each: users },
        },
      },
      { new: true, session },
    );

    ////////////////// Update the user's club_position //////////////////
    const bulkOps = users.map((user) => ({
      updateOne: {
        filter: {
          _id: user._id,
          'club_position.club': updatedClub._id,
        },
        update: {
          $set: { 'club_position.$.position': 'club_coreMember' },
        },
        upsert: false,
      },
    }));

    // First pass: update existing club_position entries
    await User.bulkWrite(bulkOps, { session });

    ////////////////// Second pass: Add the user to the club with that direct post //////////////////
    await User.updateMany(
      {
        _id: { $in: users.map((u) => u._id) },
        'club_position.club': { $ne: updatedClub._id },
      },
      {
        $addToSet: {
          club_position: { club: updatedClub._id, position: 'club_coreMember' },
        },
      },
      { session },
    );

    await session.commitTransaction();

    res.status(200).json({
      status: 'success',
      data: {
        updatedClub,
      },
    });
  } catch (err) {
    await session.abortTransaction();
    return next(
      new AppError(`Transaction aborted due to this error: ${err}`, 500),
    );
  } finally {
    await session.endSession();
  }
});
////////////////////////////////////////////////////// !!!UNDER MAINTAINANCE!!! //////////////////////////////////////////////////////

////////////// ADMIN ONLY //////////////
exports.getAllClubRequests = catchAsync(async (req, res, next) => {
  const requests = await ClubCreationRequest.find({ status: 'pending' })
    .populate('requestedBy', 'name email')
    .populate('proposedPresident', 'name email')
    .populate('proposedCoreTeam', 'name email');

  res.status(200).json({
    status: 'success',
    results: requests.length,
    data: requests,
  });
});

////////////// ADMIN ONLY //////////////
exports.approveClubRequest = catchAsync(async (req, res, next) => {
  const request = await ClubCreationRequest.findById(req.params.requestId);
  if (!request) return next(new AppError('Club request not found', 404));

  if (request.status !== 'pending')
    return next(new AppError('This request has already been reviewed', 400));

  /////////////////// Used spread operator here, change was made!!! The below .push() was the previous logic!
  let currentClubMembers = [
    ...request.proposedPresident.map(String),
    ...request.proposedCoreTeam.map(String),
  ];
  // currentClubMembers.push(request.proposedPresident, request.proposedCoreTeam);
  // console.log(
  //   '\n\n\nThe club members array is: ',
  //   currentClubMembers,
  //   '\n\n\n',
  // );

  // Create club

  const newClub = await Club.create({
    clubName: request.clubName,
    collegeName: 'VIT', //////////////////////////////////////////// HARDCODED VIT FOR NOW, LATER do IT DYNAMICALLY ////////////////////////////////////////////
    clubDescription: request.clubDescription,
    clubType: request.clubType,
    clubPresident: [request.proposedPresident],
    coreTeam: request.proposedCoreTeam,
    currentMembers: currentClubMembers,
  });

  // Update request status
  request.status = 'approved';
  request.reviewedBy = req.user.id;
  request.reviewedAt = Date.now();
  await request.save();

  await User.findByIdAndUpdate(request.proposedPresident, {
    $addToSet: {
      club_position: { club: newClub._id, position: 'club_president' },
    },
  });

  // Update core team
  if (request.proposedCoreTeam && request.proposedCoreTeam.length > 0) {
    await User.updateMany(
      { _id: { $in: request.proposedCoreTeam } },
      {
        $addToSet: {
          club_position: { club: newClub._id, position: 'club_coreMember' },
        },
      },
    );
  }

  const newNotification = {
    from: req.user.id,
    heading: `Your request to create the club ${newClub.clubName} has been ACCEPTED by the moderator. Go club ${newClub.clubName}!`,
    body: `Congratulations on being accpeted for creating the club ${newClub.clubName}`,
    to: request.requestedBy,
  };

  const users = await User.find({
    _id: { $in: [request.requestedBy, request.proposedPresident] },
  }).select('email verificationEmail name');
  await Promise.allSettled(
    users.map((u) => {
      sendMail({
        recipient: u,
        subject: 'Club creation request status',
        message: `Congratulations! Your club creation request for ${newClub.clubType} club (${newClub.clubName}) has been APPROVED by the admin. You may check your club in the clubs section of the verve app. [NOTE: If its not you, contact the higher ups or any college faculty on urgent basis!]`,
      });
    }),
  );

  await Notification.create(newNotification);

  res.status(200).json({
    status: 'success',
    message: 'Club approved and created successfully',
    data: { request, newClub },
  });
});

////////////// ADMIN ONLY //////////////
exports.rejectClubRequest = catchAsync(async (req, res, next) => {
  const { rejectionReason } = req.body;
  const request = await ClubCreationRequest.findById(req.params.requestId);
  if (!request) return next(new AppError('Club request not found', 404));

  if (request.status !== 'pending')
    return next(new AppError('This request has already been reviewed', 400));

  request.status = 'rejected';
  request.reviewedBy = req.user.id;
  request.reviewedAt = Date.now();
  request.rejectionReason = rejectionReason || 'Not specified';
  await request.save();

  const newNotification = {
    from: req.user.id,
    heading: `Club creation request response.`,
    body: `Your request to create the club ${req.body.requestedClubName} has been REJECTED by the Admin!`,
    to: req.body.requester,
  };

  const users = await User.find({
    _id: { $in: [request.requestedBy, request.proposedPresident] },
  }).select('email verificationEmail name');
  console.log(users);
  const responseFromEmail = await Promise.allSettled(
    users.map((u) => {
      sendMail({
        recipient: u,
        subject: 'Club creation request status',
        message: `Apologies, your club creation request for ${request.clubType} club (${request.clubName}) has been REJECTED by the admin. You may check rejection reason (if presented by admin) in -> profile -> settings -> club requests section of the verve app. [NOTE: If its not you, contact the higher ups or any college faculty on urgent basis!]`,
      });
    }),
  );
  console.log(responseFromEmail);
  res.status(200).json({
    status: 'success',
    message: 'Club request rejected',
    data: request,
    responseFromEmail,
  });
});

exports.addNewClubVolunteer = catchAsync(async (req, res, next) => {
  const { clubId } = req.params;
  const { allMemberIDs } = req.body;

  const club = await Club.findById(clubId);

  const presidentId = club.clubPresident;
  const facultyCoordinator = club.clubFacultyCoordinator;

  if (!presidentId || !allMemberIDs) {
    return next(
      new AppError(
        'Sorry we could not add the member, seems like you did not provide necessary users to add or your club president is inactive!.',
        400,
      ),
    );
  }

  const users = await User.find({
    _id: { $in: allMemberIDs },
    club_position: { $not: { $elemMatch: { club: clubId } } },
    active: true,
  });

  if (users.some((user) => user === undefined)) {
    return next(new AppError('Please provide correct existing user Ids', 404));
  }

  const updatedClub = await Club.findByIdAndUpdate(clubId, {
    $addToSet: { currentMembers: { $each: allMemberIDs } },
  });

  await User.updateMany(
    {
      _id: { $in: users.map((u) => u._id) },
      'club_position.club': { $ne: clubId },
    },
    {
      $push: {
        club_position: {
          position: 'club_volunteer',
          club: clubId,
        },
      },
    },
  );

  const newNotification = {
    from: req.user.id,
    heading: `${club.clubName} Club Notice.`,
    body: `You were added to the club ${club.clubName} by ${req.user.name}. If you were already a member, please ignore this notification.`,
    to: [...users.map((user) => user._id.toString())],
  };

  sendNotification(
    newNotification,
    200,
    'Welcome the new club volunteers!',
    res,
  );
});

// exports.promoteToCoordinator = catchAsync(async (req, res, next) => {
//   const volunteerID = req.body.volunteerID;
//   const volunteer = await User.findByIdAndUpdate(volunteerID, )
// })

exports.getMyClubs = catchAsync(async (req, res, next) => {
  const currUser = req.user;
  const myClubIds = req.user.club_position.map((clubId) => clubId.club);
  const myClubs = await currUser.populate({
    path: 'club_position.club',
    select: 'clubName',
  });
  res.status(200).json({
    status: 'success',
    data: {
      allClubs: myClubs.club_position,
    },
  });
});

exports.createRecruitmentForm = catchAsync(async (req, res, next) => {
  const { title, description, questions, deadline, allStages } = req.body;

  const clubId = req.params.clubId;

  if (!title || !questions || !description) {
    return next(
      new AppError('Please fill all required details to create a form!', 400),
    );
  }

  const recruitmentInProcess = await RecruitmentCycle.findOne({
    club: clubId,
    status: { $ne: 'finalized' },
  });

  if (recruitmentInProcess) {
    return next(
      new AppError(
        'A recruitment is already in process, finish it to start a new one.',
        400,
      ),
    );
  }

  // Ensure user is a club president (you can handle role check here)
  const createdBy = req.user._id;
  if (!allStages || !allStages.length) {
    return next(new AppError('Please select stages for recruitment!'));
  }

  const newForm = await Form.create({
    title,
    description,
    club: clubId,
    createdBy,
    questions,
    deadline,
    formType: req.body.formType,
  });

  const newRecruitmentCycle = await RecruitmentCycle.create({
    club: clubId,
    form: newForm._id,
    selectedStages: allStages,
  });

  // await Club.findByIdAndUpdate(
  //   clubId,
  //   {
  //     $addToSet: { recruitmentCycles: newRecruitmentCycle },
  //   },
  //   { new: true },
  // );

  res.status(201).json({
    status: 'success',
    message: 'Form created successfully.',
    newForm,
  });
});

exports.submitForm = catchAsync(async (req, res, next) => {
  const { formId, clubId } = req.params;
  const { answers } = req.body;
  const userId = req.user._id;

  const isClubMember = req.user.club_position.find(
    (thisClub) => thisClub.club.toString() === clubId.toString(),
  );

  if (isClubMember) {
    return next(
      new AppError(
        'You are already a part of this club, you cannot apply for the recruitment form!',
        400,
      ),
    );
  }

  const form = await Form.findById(formId);
  if (!form) return res.status(404).json({ message: 'Form not found.' });

  //  Check if form is locked or deadline passed
  if (
    form.isLocked ||
    (form.deadline && new Date() > new Date(form.deadline))
  ) {
    return res.status(400).json({ message: 'Form is closed for submissions.' });
  }

  // Check if user already submitted
  const existing = await FormResponse.findOne({ form: formId, user: userId });
  if (existing)
    return next(new AppError('You have already submitted this form.', 400));

  const recruitmentCycle = await RecruitmentCycle.findOne({
    club: clubId,
    status: 'form_open',
  });

  const response = await FormResponse.create({
    recruitmentCycle,
    club: clubId,
    form: formId,
    user: userId,
    answers,
  });

  res.status(201).json({
    status: 'success',
    message: 'Form submitted successfully.',
    response,
  });
});

exports.getAllRecruitmentCycles = catchAsync(async (req, res, next) => {
  const { clubId } = req.params;
  // console.log('clubId: ', clubId);
  if (!clubId) {
    return next(new AppError('Please provide your club ID!', 400));
  }

  const allRecruitmentCycles = await RecruitmentCycle.find({
    club: clubId,
  })
    .populate('form')
    .sort({ createdAt: -1 });
  // const allForms = await Form.find({ club: clubId }).populate({
  //   path: 'createdBy',
  //   select: 'name, photo, post',
  // });
  // const allForms = allRecruitmentCycles.map((cycle) => cycle.form);
  // if (!allRecruitmentCycles.length) {
  //   return next(
  //     new AppError('There is no recruitment taken place for your club.', 404),
  //   );
  // }
  res.status(200).json({
    status: 'success',
    results: allRecruitmentCycles.length,
    data: {
      allRecruitmentCycles,
      // formData: allForms,
    },
  });
});

exports.getRecruitmentForm = catchAsync(async (req, res, next) => {
  const { clubId, formId } = req.params;
  if (!clubId || !formId) {
    return next(new AppError('Please provide the club and form IDs.', 400));
  }
  const form = await Form.findById(formId);
  if (!form) {
    return next(new AppError('This form no longer exists.', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      form,
    },
  });
});

exports.getUserFormResponses = catchAsync(async (req, res, next) => {
  const { clubId } = req.params;
  const userId = req.user.id;

  if (!clubId) {
    return next(new AppError('Please provide club ID', 400));
  }

  const userFormResponses = await FormResponse.find({
    club: clubId,
    user: userId,
  });

  res.status(200).json({
    status: 'success',
    data: {
      userFormResponses,
    },
  });
});

exports.getFormResponses = catchAsync(async (req, res, next) => {
  /////////////////// this endpoint may not be required . (yet to decide!)
  const { formId } = req.params;

  const formResponses = await FormResponse.find({
    form: formId,
  }).populate({ path: 'user', select: 'name photo aura' });

  if (!formResponses.length) {
    return next(new AppError('There are no responses for this form yet.', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      formResponses,
    },
  });
});

exports.getRecruitmentStageData = catchAsync(async (req, res, next) => {
  const formId = req.params.formId;
  const clubId = req.params.clubId;
  const recruitmentStage = req.body.stage;
  // console.log(recruitmentStage);
  if (!formId) {
    return next(new AppError('Please provide the formId!', 400));
  }

  const userHasEnrolled = await FormResponse.findOne({
    form: formId,
    user: req.user.id,
  });

  // console.log(req.user.club_position);
  const userIsAuthorized = req.user.club_position.find(
    (club) => club.club.toString() === clubId,
  );

  if (!userHasEnrolled && !userIsAuthorized) {
    return next(
      new AppError('You have not enrolled for this recruitment', 403),
    );
  }

  const validStages = ['applied', 'exam', 'interview', 'finalized'];
  if (
    !recruitmentStage ||
    !validStages.includes(recruitmentStage)
    // recruitmentStage != 'applied' ||
    // recruitmentStage != 'exam' ||
    // recruitmentStage != 'interview' ||
    // recruitmentStage != 'final'
  ) {
    return next(
      new AppError('Please select an appropriate stage for recruitment!', 400),
    );
  }

  const studentsSelectedForThisStage = await FormResponse.find({
    form: formId,
    stage: recruitmentStage,
  }).populate('user', 'name profilePicture_LowRes aura');

  res.status(200).json({
    status: 'success',
    results: studentsSelectedForThisStage.length,
    data: {
      studentsSelectedForThisStage,
    },
  });
});

exports.selectForNextStage = catchAsync(async (req, res, next) => {
  // check if userId and formId exists.
  const { userIds, formId, responseIds, recruitmentCycleId } = req.body;

  let finalSelectedUsers = [];
  let statusCode = 200;
  let selectionStatus,
    applicantStatus = 'shortlisted',
    session,
    allStages,
    selectedApplicants,
    rejectedApplicants,
    newRecruitmentCycle;

  const recruitmentCycle = await RecruitmentCycle.findById(
    recruitmentCycleId,
  ).populate({
    path: 'club',
    select: 'clubName coreTeam president clubFacultyCoordinator',
  });
  allStages = recruitmentCycle.selectedStages;
  const indexOfCurrentStage = allStages.indexOf(recruitmentCycle.status);

  if (allStages[indexOfCurrentStage] === 'finalized') {
    return next(
      new AppError(
        'The recruitment cycle has ended, cannot recruit any more students!',
        403,
      ),
    );
  }

  const nextStage =
    indexOfCurrentStage === allStages.length - 1
      ? allStages[indexOfCurrentStage]
      : allStages[indexOfCurrentStage + 1];

  if (!userIds) {
    return next(
      new AppError(
        'Please provide the users you want to select for the interview round!',
        400,
      ),
    );
  }
  if (!formId) {
    return next(
      new AppError(
        'Please provide the formId for which you want to select the users for interview round',
        400,
      ),
    );
  }

  //////////////////////////// Handle MULTI DOCUMENT TRANSACTION here!!! ////////////////////////////

  try {
    session = await mongoose.startSession();
    session.startTransaction();

    if (nextStage === 'finalized') {
      applicantStatus = 'selected';
      finalSelectedUsers = userIds;
      clubPosition = {
        club: recruitmentCycle.club._id,
        position: 'club_volunteer',
      };
      const finalUsers = await User.updateMany(
        { _id: { $in: userIds } },
        { $push: { club_position: clubPosition } },
        { session, new: true },
      );
      await Club.findByIdAndUpdate(
        recruitmentCycle.club._id,
        { $push: { currentMembers: finalSelectedUsers } },
        { session, new: true },
      );
    }

    // update all filled forms with requested current stage and for passed students (mark status as selected)
    selectedApplicants = await FormResponse.updateMany(
      {
        _id: { $in: responseIds },
      },
      {
        $set: {
          stage: nextStage,
          status: applicantStatus,
        },
      },
      { session, runValidators: true },
    );

    // update all filled forms with requested current stage and for failed students (mark status as rejected)
    rejectedApplicants = await FormResponse.updateMany(
      {
        _id: { $nin: responseIds },
      },
      {
        $set: {
          isLocked: true,
          status: 'rejected',
        },
      },
      { session, runValidators: true },
    );

    newRecruitmentCycle = await RecruitmentCycle.findByIdAndUpdate(
      recruitmentCycleId,
      { status: nextStage, selectedMembers: finalSelectedUsers },
      { session, new: true, runValidators: true },
    );

    let notifyTo = [];
    notifyTo.push(
      recruitmentCycle.club.coreTeam,
      recruitmentCycle.club.president,
      recruitmentCycle.club.clubFacultyCoordinator,
    );

    const allUsers = await User.find({ _id: { $in: userIds } })
      .select(' name email ')
      .session(session);

    // const users = Array.isArray(details.to) ? details.to : [details.to];

    const newNotification = allUsers.map((userId) => ({
      from: req.user.id,
      heading: `Notice about new recruited volunteers.`,
      body: `You have been selected for the ${nextStage} for ${recruitmentCycle.club.clubName}'s recruitement`,
      postedOn: Date.now(),
      to: userId,
    }));

    await Notification.insertMany(newNotification, { session });

    await session.commitTransaction();
    selectionStatus = 'success';
    statusCode = 200;
  } catch (error) {
    await session.abortTransaction();
    console.error('Transaction aborted:', error);
    selectionStatus = 'failed';
    statusCode = 501;
  } finally {
    await session.endSession();
  }

  // update

  res.status(statusCode).json({
    status: selectionStatus,
    data: {
      rejectedApplicants,
      recruitmentCycle,
    },
  });
});

exports.lockForm = catchAsync(async (req, res, next) => {
  const { formId } = req.params;
  if (!formId)
    return next(new AppError('Please Provide form Id to lock the form!', 400));
  await Form.findByIdAndUpdate(formId, { isLocked: true });

  res.status(200).json({
    status: 'success',
    message:
      'The form has been locked and will not recieve any further responses',
  });
});

exports.promoteToCoordinator = catchAsync(async (req, res, next) => {
  const { clubId } = req.params;
  const { userIds } = req.body;
  const users = await User.find({ _id: { $in: userIds } });

  const checkIfUsersAreVolunteersOnly = (user) => {
    const userIsVolunteer = user?.club_position.find(
      (club) => club.club === clubId && club.position !== 'club_volunteer',
    );
    return userIsVolunteer;
  };

  if (users.some((user) => checkIfUsersAreVolunteersOnly(user))) {
    return next(
      new AppError('Select only volunteers for promotion to coordinator', 400),
    );
  }

  const club = await Club.findById(clubId);
  const everyoneIsClubMember = userIds.every((element) =>
    club.currentMembers.includes(element),
  );
  if (!club) {
    return next(
      new AppError(
        'No such club exists! Please check your club ID again!',
        404,
      ),
    );
  }
  if (everyoneIsClubMember === false) {
    return next(
      new AppError(
        'The selected user members are not a part of the club! To promote, they must be part of the club!',
        400,
      ),
    );
  }

  await User.updateMany(
    { _id: { $in: userIds } },
    { $set: { 'club_position.$[elem].position': 'club_coordinator' } },
    {
      arrayFilters: [{ 'elem.club': clubId }],
    },
  );

  await club.save();

  const body =
    users.length <= 3
      ? `Selected Members: ${users.map((u) => `${u.username}, `)} check recruitement cycle`
      : `Selected Members: ${users.slice(0, 3).map((u) => `${u.username}, and ${users.slice(3, users.length).length} Others.`)} Check recruitement cycle`;

  sendNotification(
    {
      from: req.user.id,
      heading: `Members promoted to coordinator (${club.clubName})`,
      body: `${body}`,
      to: club.clubPresident,
    },
    200,
    'Promoted volunteers to coordinator',
    res,
  );
});

exports.getClubMembers = catchAsync(async (req, res, next) => {
  const { clubId } = req.params;
  // console.log('Enteres getClubMembers endpoint... clubId: ', clubId);

  ////////////////////////////// UPDATED HERE //////////////////////////////
  const club = await Club.findById(clubId).populate({
    path: 'currentMembers',
    select: 'name aura club_position profilePicture_LowRes',
  });

  if (!club) {
    return next(
      new AppError('No such club exists! Please check the club ID!', 404),
    );
  }

  const currentClubMembers = club.currentMembers;

  res.status(200).json({
    status: 'success',
    results: currentClubMembers.length,
    data: {
      currentClubMembers,
    },
  });
});

exports.createPromotionProposal = catchAsync(async (req, res, next) => {
  const { proposedMembers, targetRole, expireAfter } = req.body;
  const { clubId } = req.params;

  const ongoingProposal = await PromotionProposal.findOne({
    club: clubId,
    status: 'pending',
  });
  if (ongoingProposal) {
    return next(new AppError('A proposal is already in process', 400));
  }

  const validRoles = ['club_secretary', 'club_president', 'club_coreMember'];
  if (!targetRole || !validRoles.includes(targetRole)) {
    return next(
      new AppError('Please select an appropriate stage for recruitment!', 400),
    );
  }

  const club = await Club.findById(clubId);
  if (!club) return next(new AppError('Club not found', 404));

  ////// Check if proposedMembers are actually a part of the club or not, if not then send an error //////
  const clubMemberIds = club.currentMembers.map((id) => id.toString());

  const invalidMembers = proposedMembers.filter(
    (memberId) => !clubMemberIds.includes(memberId.toString()),
  );

  if (invalidMembers.length > 0) {
    return next(
      new AppError(
        `These members are not part of the club: ${invalidMembers.join(', ')}`,
        400,
      ),
    );
  }

  // Check if user is in core team
  if (!club.coreTeam.includes(req.user.id))
    return next(new AppError('Only core members can create proposals', 403));

  const newProposal = await PromotionProposal.create({
    club: clubId,
    proposedBy: req.user.id,
    proposedMembers,
    targetRole,
    expiresAt: expireAfter ? expireAfter : Date.now() + 3 * 24 * 60 * 60 * 1000, /// default expiry of 3 days
  });

  // Attach to club for easy reference
  club.promotionProposals.push(newProposal._id);
  await club.save();

  res.status(201).json({
    status: 'success',
    data: newProposal,
  });
});

exports.voteOnProposal = catchAsync(async (req, res, next) => {
  const { vote } = req.body; // 'yes' or 'no'
  const { clubId, proposalId } = req.params;

  const validVoteOptions = ['yes', 'no'];

  if (!vote || !validVoteOptions.includes(vote)) {
    return next(new AppError('You must give a valid vote!', 400));
  }

  const proposal =
    await PromotionProposal.findById(proposalId).populate('club');

  if (!proposal) {
    return next(new AppError('Proposal not found', 404));
  }
  if (proposal.status !== 'pending') {
    return next(new AppError('Voting closed for this proposal', 400));
  }

  const club = proposal.club;
  const eligibleVoters = [
    ...club.coreTeam.map(String),
    ...club.clubPresident.map(String),
  ];

  if (!eligibleVoters.includes(req.user.id)) {
    return next(new AppError('You are not authorized to vote', 403));
  }

  // Prevent double vote
  if (proposal.votes.some((v) => v.votedBy.toString() === req.user.id)) {
    return next(new AppError('You already voted', 400));
  }

  currentDate = Date.now();
  if (proposal.expiresAt < currentDate) {
    if (proposal.status === 'pending') {
      proposal.status = 'rejected';
      proposal.save();
    }
    return next(
      new AppError('This proposal has been expired due to time limit.', 400),
    );
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    proposal.votes.push({ votedBy: req.user.id, vote });
    await proposal.save({ session });

    // Count votes
    const totalEligible = eligibleVoters.length;
    const yesVotes = proposal.votes.filter((v) => v.vote === 'yes').length;
    const noVotes = proposal.votes.filter((v) => v.vote === 'no').length;

    // Majority check
    if (yesVotes >= totalEligible / 2) {
      proposal.status = 'approved';
      await proposal.save({ session });

      await User.updateMany(
        {
          _id: { $in: proposal.proposedMembers },
          'club_position.club': clubId,
        },
        {
          $set: { 'club_position.$.position': proposal.targetRole },
        },
        { session },
      );
      if (proposal.targetRole === 'club_president') {
        const updatedClub = await Club.findByIdAndUpdate(
          clubId,
          {
            $addToSet: { clubPresident: { $each: proposal.proposedMembers } },
          },
          { new: true, session },
        );
        ////////////////////////////// UPDATED HERE //////////////////////////////
      } else if (proposal.targetRole === 'club_coreMember') {
        const updatedClub = await Club.findByIdAndUpdate(
          clubId,
          {
            $addToSet: { coreTeam: { $each: proposal.proposedMembers } },
          },
          { new: true, session },
        );
      }
    } else if (noVotes >= totalEligible / 2) {
      proposal.status = 'rejected';
      await proposal.save({ session });
    }
    await session.commitTransaction();
  } catch (err) {
    await session.abortTransaction();
    // console.log(err);
    res.status(503).json({
      status: 'failed',
      message: 'Mongoose Transaction failed',
      transactionError: err,
    });
  } finally {
    await session.endSession();
  }

  res.status(200).json({
    status: 'success',
    data: proposal,
  });
});

////// LAST CHANGED ON 28TH FEB
exports.getClubProposals = catchAsync(async (req, res, next) => {
  const { clubId } = req.params;

  ////////////////////////////// UPDATED HERE //////////////////////////////
  const proposals = await PromotionProposal.find({ club: clubId })
    .populate('proposedBy', 'name')
    .populate(
      'proposedMembers',
      'name aura profilePicture_LowRes club_position',
    )
    .sort({ createdAt: -1 });

  res.status(200).json({
    status: 'success',
    results: proposals.length,
    data: proposals,
  });
});

exports.getSpecificClubProposal = catchAsync(async (req, res, next) => {
  const { proposalId } = req.params;

  const proposals = await PromotionProposal.find({ club: proposalId })
    .populate('proposedMembers', 'name club_position')
    .populate('proposedBy', 'name');

  res.status(200).json({
    status: 'success',
    results: proposals.length,
    data: proposals,
  });
});

///// LAST UPDATED ON 8th MARCH 2026...
exports.leaveClub = catchAsync(async (req, res, next) => {
  const { clubId } = req.params;
  if (!clubId) {
    return next(new AppError('Please provide club ID', 400));
  }
  const userClubExists = req.user.club_position.find(
    (club) => club.club.toString() === clubId.toString(),
  );
  // console.log('userClubExists: ', userClubExists);
  if (!userClubExists) {
    return next(
      new AppError(
        'Cannot remove user from a club which user does not belong to!',
        400,
      ),
    );
  }

  const club = await Club.findById(clubId);
  if (
    userClubExists.position === 'club_president' &&
    club.clubPresident.map((id) => id.toString()).includes(req.user.id) &&
    club.clubPresident.length < 2
  ) {
    return next(
      new AppError(
        'You are the only president! Cannot leave unless another president handles the club.',
        400,
      ),
    );
  }

  const updatedUser = await User.findByIdAndUpdate(
    req.user.id,
    {
      $pull: { club_position: { club: clubId } },
    },
    { new: true },
  );
  const updatedClub = await Club.findByIdAndUpdate(
    clubId,
    {
      $pull: {
        currentMembers: req.user._id,
        coreTeam: req.user.id,
        clubPresident: req.user.id,
      },
      // $addToSet: { pastMembers: req.user._id },
    },
    { new: true },
  );
  res.status(200).json({
    status: 'success',
    message: 'You left the club.',
    data: {
      myClubs: updatedUser.club_position,
    },
  });
});

///// LAST UPDATED ON 10th MARCH 2026...
exports.removeFromClub = catchAsync(async (req, res, next) => {
  // verify userId and if user exists (active: true/false both okay unless user is there).
  const { clubId } = req.params;
  const { userIds } = req.body; //////// Array of user Ids

  if (!userIds) {
    return next(new AppError('Please provide the user Ids!', 400));
  }

  if (!clubId) {
    return next(new AppError('Please provide the club Id!', 400));
  }
  const session = await mongoose.startSession();

  try {
    session.startTransaction();
    // also check if club exists!
    const club = await Club.findById(clubId).session(session);

    if (!club) {
      return next(
        new AppError('Club does not exist, please verify clubId!', 400),
      );
    }

    const usersInClub = await User.find({
      _id: { $in: userIds },
      'club_position.club': clubId,
    })
      .select('_id name email')
      .session(session);

    ///// directly select only which are actually there in the club
    if (usersInClub.some((user) => user === undefined)) {
      return next(
        new AppError('Please provide correct user Ids of existing users!', 400),
      );
    }

    if (
      usersInClub.some((user) => user._id.toString() === req.user.id.toString())
    ) {
      return next(
        new AppError(
          'You cannot remove yourself from the club this way! Leave the club instead.',
          400,
        ),
      );
    }

    // pull from club currentMembers array and push in club pasMembers array.
    const updatedClub = await Club.findByIdAndUpdate(
      clubId,
      {
        $pull: {
          currentMembers: { $in: userIds },
          coreTeam: { $in: userIds },
          clubPresident: { $in: userIds },
        },
        // $addToSet: { pastMembers: { $each: userIds } },
      },
      { new: true, session },
    );

    // pull club and position from club_position array of user.
    const bulkOps = usersInClub.map((user) => ({
      updateOne: {
        filter: { _id: user._id },
        update: {
          $pull: { club_position: { club: clubId } },
        },
      },
    }));

    const updatedUsers = await User.bulkWrite(bulkOps, { session });

    await session.commitTransaction();

    // // send Notification to the user and the president for the removal of the club member.
    // sendNotification(
    //   {
    //     from: req.user.id,
    //     heading: 'Club Notice',
    //     body: `You were removed from ${club.clubName} by ${req.user.name}.`,
    //     to: [...updatedUsers.map((user) => user._id)],
    //   },
    //   204,
    //   'Removed the club members from club successfully.',
    //   res,
    // );

    const presidents = await User.find({
      _id: { $in: updatedClub.clubPresident },
    }).select('name email verificationEmail');

    const users = [...usersInClub, ...presidents];
    await Promise.allSettled(
      users.map((u) => {
        sendMail({
          recipient: u,
          subject: 'Club creation request status',
          message: `Congratulations! Your club creation request for ${newClub.clubType} club (${newClub.clubName}) has been APPROVED by the admin. You may check your club in the clubs section of the verve app. [NOTE: If its not you, contact the higher ups or any college faculty on urgent basis!]`,
        });
      }),
    );

    res.status(200).json({
      status: 'success',
    });
  } catch (error) {
    // console.log('TRANSACTION ERROR: ', error);
    await session.abortTransaction();
  } finally {
    session.endSession();
  }
});

//////////////////////////////////////////////////////////////////// DONE BY HM ////////////////////////////////////////////////////////////////////

//============ VERSION 1.0 START ==============>
exports.createEvent = catchAsync(async (req, res, next) => {
  // creating event without photos
  const { clubId } = req.params;

  if (!clubId) {
    return next(new AppError('Please provide Club ID', 400));
  }

  const club = await Club.findById(clubId);

  if (!club) {
    return next(new AppError('Club does not exist', 404));
  }

  const eventTime = new Date(req.body.eventDate).getTime();

  if (isNaN(eventTime)) {
    return next(new AppError('Invalid event date', 400));
  }

  // console.log('UPLOADING TO CLOUD...');

  let newEvent,
    uploadedPhotos = [],
    successfulUploads = [],
    failedUploads = []; //// REDIFINING CONST VARIABL AHEAD!! WRONG! USE let...

  try {
    // console.log(req.files.images);
    if (req.files.images && req.files?.images.length > 0) {
      // console.log('Uploading to cloud...');
      uploadedPhotos = await Promise.allSettled(
        // directly upload through stream
        req.files.images.map((file) => uploadStream(file)),
      );

      successfulUploads = uploadedPhotos
        .filter((r) => r.status === 'fulfilled')
        .map((r) => r.value);

      failedUploads = uploadedPhotos.filter((r) => r.status === 'rejected');

      if (failedUploads.length > 0) {
        if (successfulUploads.length > 0) {
          await deleteManyFromCloud(successfulUploads.map((p) => p.photoID));
        }

        // await Event.findByIdAndDelete(newEvent._id);

        return next(new AppError('Some images failed to upload', 500));
      }
      // console.log('PHOTOS UPLOADED SUCCESSFULLY');
    }
    // console.log('CREATING EVENT...');
    newEvent = await Event.create({
      eventHeading: req.body.eventHeading,
      eventBody: req.body.eventBody,
      eventDate: req.body.eventDate,
      eventType: req.body.eventType,
      clubId,
      photos: successfulUploads,
    });
  } catch (error) {
    // Also delete already uploaded images
    // console.log('ERROR UPLOADING TO CLOUDINARY: ', error);
    if (successfulUploads.length > 0)
      await deleteManyFromCloud(successfulUploads.map((p) => p.photoID));

    // If image upload fails then delete event
    if (newEvent && newEvent._id) {
      await Event.findByIdAndDelete(newEvent._id);
    }

    return next(new AppError(`Failed to upload images`, 500));
  }

  // // Socket part
  // const io = req.io; // WAS SET DURING SOCKER SERVER STARTED IN initSocket
  // if (newEvent.eventType === 'internal') {
  //   notificationSocketHandler(
  //     io,
  //     `club_${clubId}`,
  //     'newNotification',
  //     newEvent,
  //   );
  // } else if (newEvent.eventType === 'external') {
  //   io.emit('newExternalEvent', newEvent);
  // }

  const delay =
    new Date(newEvent.eventDate).getTime() +
    24 * 60 * 60 * 1000 - // +1 day
    Date.now();
  // const delay = 1 * 60 * 1000; // 1 min for testing

  await eventQueue.add(
    'deleteEvent',
    { eventId: newEvent._id },
    {
      jobId: `delete-${newEvent._id}`,
      delay: Math.max(delay, 0), // avoid negative delay
      attempts: 3, // retry if fails
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: true,
      removeOnFail: false,
    },
  );

  res.status(201).json({
    status: 'success',
    data: {
      newEvent,
    },
  });
});

// ============= VERSION 1 ================>
exports.deleteEvent = catchAsync(async (req, res, next) => {
  const event = await Event.findById(req.params.id);
  // console.log('EVENT ID DELETE = ', event);

  if (!event) {
    return next(new AppError('No event with this ID found', 404));
  }

  // Delete images from Cloudinary in parallel
  if (event.photos && event.photos.length > 0) {
    await Promise.all(
      event.photos.map((photo) => cloudinary.uploader.destroy(photo.photoID)),
    );
  }

  // Delete event from DB
  await Event.findByIdAndDelete(req.params.id);

  res.status(204).json({
    status: 'success',
    data: null,
  });

  //next();
});

// 3) create event news controller ------------------------->
exports.createNews = catchAsync(async (req, res, next) => {
  const newNews = await News.create({
    newsHeading: req.body.newsHeading,
    newsBody: req.body.newsBody,
    newsDate: req.body.newsDate,
    photos: [],
    clubID: req.params.clubId,
  });

  const uploadedPhotos = [];

  try {
    if (req.files && req.files.length > 0) {
      const cloudinaryPromises = req.files.map(async (file) => {
        const base64String = `data:${file.mimetype};base64,${file.buffer.toString('base64')}`;

        const result = await cloudinary.uploader.upload(base64String, {
          folder: `verve_uploads/event_photos/${newNews._id}`,
          // transformation: [{ width: 1200, height: 1200, crop: "limit" }],
        });

        return {
          photoID: result.public_id,
          photoURL: result.secure_url,
        };
      });

      uploadedPhotos = await Promise.all(cloudinaryPromises);

      newNews.photos = uploadedPhotos;
      await newNews.save();
    }
  } catch {
    await cloudinary.uploader.delete_resources(uploadedPhotos);
    if (newNews && newNews._id) {
      await Event.findByIdAndDelete(newNews._id);
    }
    return next(error);
  }

  res.status(201).json({
    status: 'success',
    data: {
      newNews,
    },
  });

  //next();
});

// 4) delete event news controller ---------------------------->
exports.deleteNews = catchAsync(async (req, res, next) => {
  const news = await News.findById(req.params.id);

  if (!news) {
    return next(new AppError('No news with this ID found', 404));
  }

  if (news.photos && news.photos.length > 0) {
    await Promise.all(
      news.photos.map((photo) => cloudinary.uploader.destroy(photo.photoID)),
    );
  }

  await News.findByIdAndDelete(req.params.id);

  res.status(204).json({
    status: 'success',
    data: null,
  });

  //next();
});

// 5) get all clgEvents announcements --------------------------->
exports.getAllEvents = catchAsync(async (req, res, next) => {
  // apply pagination -> Applied bu removed then

  const features = new APIFeatures(
    Event.find({ eventType: 'external' }),
    req.query,
  ).sort({ eventDate: -1 }); //.paginate();

  const events = await features.query;

  if (!events) {
    return next(new AppError('No events found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      events,
    },
  });
});

// 6) get all clgNews announcements ----------------------------->
exports.getAllNews = catchAsync(async (req, res, next) => {
  // apply pagination

  const features = new APIFeatures(News.find(), req.query).sort({
    eventDate: -1,
  }); //.paginate(); applied but removed then

  const news = await features.query;

  if (!news) {
    return next(new AppError('No news found', 404));
  }

  res.status(200).json({
    status: 'success',
    data: {
      news,
    },
  });
});

exports.getEventsByClub = catchAsync(async (req, res, next) => {
  const { clubId } = req.params;
  const { cursor, limit = 10 } = req.query;

  const club = await Club.findById(clubId);
  if (!club) {
    return next(new AppError('No club exist with this id', 404));
  }

  // Build query
  let query = { clubId: club._id };

  if (cursor) {
    query.createdAt = { $lt: new Date(cursor) };
  }

  const events = await Event.find(query)
    // .populate('clubId', 'clubName')
    .sort({ createdAt: -1 }) // newest first
    .limit(Number(limit));

  // console.log(events);
  // Calculate Next cursor for letting client know
  const nextCursor =
    events.length > 0 ? events[events.length - 1].createdAt : null;

  res.status(200).json({
    status: 'success',
    data: {
      events,
      nextCursor,
      hasMore: events.length === Number(limit),
    },
  });
});
exports.getAllClubs = catchAsync(async (req, res, next) => {
  const allClubs = await Club.find().lean();
  const clubRecruitements = await Form.find({
    isLocked: false,
    club: { $in: allClubs.map((club) => club._id) },
  }).lean();

  const filteredClubs = allClubs.map((club) => ({
    ...club,
    recruitmentStarted: clubRecruitements.includes(club._id),
  }));

  res.status(200).json({
    status: 'success',
    data: {
      allClubs: filteredClubs,
    },
  });
});
