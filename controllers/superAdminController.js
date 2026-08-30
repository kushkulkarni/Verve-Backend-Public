const User = require('./../models/userModel');
// const crypto = require('crypto');
// const Comments = require('./../models/commentsModel');
// const Anonymous = require('./../models/anonymousModel');
// const Achievements = require('./../models/achievementsModel');
// const Likes = require('./../models/likesModel');
const Notification = require('./../models/notifications');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/appError');
const sendEmail = require('./../utils/email');
const Club = require('./../models/clubModel');
const sendNotification = require('./../utils/sendNotification');
const Form = require('./../models/formModel');
const FormResponse = require('./../models/formResponseModel');
const RecruitmentCycle = require('./../models/recruitmentCycleModel');
const PromotionProposal = require('./../models/promotionProposalModel');
const ClubCreationRequest = require('./../models/clubCreationRequestModel');

exports.createAdminAccount = catchAsync(async (req, res, next) => {
  if (!req.body.email || !req.body.password) {
    return next(
      new AppError('Please provide email and password for super-admin.', 400)
    );
  }
  const newAdminAccount = await User.create({
    name: req.body.name,
    email: req.body.email,
    password: req.body.password,
    passwordConfirm: req.body.passwordConfirm,
    role: 'admin',
    aura: undefined,
    verificationEmail: req.body.verificationEmail,
    college: 'VIT',
  });

  res.status(201).json({
    status: 'success',
    data: {
      newAdminAccount,
    },
  });
});

exports.deactivateOldAdminAccount = catchAsync(async (req, res, next) => {
  const { adminEmail } = req.body;
  const admin = await User.updateOne({ email: adminEmail }, { active: false });

  res.status(200).json({
    status: 'success',
    data: null,
  });
});
