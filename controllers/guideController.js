const User = require('./../models/userModel');
const crypto = require('crypto');
const Comments = require('./../models/commentsModel');
const Anonymous = require('./../models/anonymousModel');
const Achievements = require('./../models/achievementsModel');
const Likes = require('./../models/likesModel');
const Notification = require('./../models/notifications');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/appError');
const sendEmail = require('./../utils/email');
const Club = require('./../models/clubModel');
const Chat = require('./../models/chatModel');
const sendNotification = require('./../utils/sendNotification');
const reviewQueue = require('./jobsController');
const mongoose = require('mongoose');
const { userSocketMap, chatSocketMap } = require('../utils/socketTracker');

exports.openToAsGuide = catchAsync(async (req, res, next) => {
  // const user = req.user;

  const newUser = await User.findByIdAndUpdate(
    req.user.id,
    { openTo: true },
    { new: true },
  );

  res.status(200).json({
    status: 'success',
    data: {
      newUser,
    },
  });
});

exports.closeAsGuide = catchAsync(async (req, res, next) => {
  // const user = req.user;

  const newUser = await User.findByIdAndUpdate(
    req.user.id,
    { openTo: false, verifiedGuide: false },
    { new: true },
  );

  res.status(200).json({
    status: 'success',
    data: {
      newUser,
    },
  });
});

exports.getVerifiedGuideBatch = catchAsync(async (req, res, next) => {
  const user = req.user;

  if (!user.openTo) {
    // console.log('user is not a guide');
    return next(new AppError('You are not a guide', 403));
  }

  if (!(user.doubtsSolved > 30 && user.aura > 1000 && user.openTo)) {
    // console.log('user is not eligible');
    return next(
      new AppError(
        'You do not meet the criteria to get verified guide batch!',
        403,
      ),
    );
  }

  const newUser = await User.findByIdAndUpdate(
    req.user.id,
    { verifiedGuide: true },
    { new: true, runValidators: true },
  );

  res.status(200).json({
    status: 'success',
    data: {
      newUser,
    },
  });
});

exports.startDoubt = catchAsync(async (req, res, next) => {
  // get the user's ID and the guide's ID
  // console.log('entered startDoubt');
  const userID = req.user.id;
  const guideID = req.body.guideId;
  let chatId, newChat;

  if (!guideID) {
    return next(new AppError('Please provide the guideID.', 400));
  }
  if (guideID === userID) {
    return next(new AppError('You cannot start a doubt with yourself!', 400));
  }

  if (req.user.blockedUsers.includes(guideID)) {
    return next(new AppError('No such guide found', 404));
  }

  const chatExists = await Chat.findOne({
    guide: guideID,
    doubtUser: userID,
    status: 'started',
  });
  if (chatExists) {
    return next(
      new AppError(
        'You already have an ongoing doubt session with this guide! Please wait till this doubt session expires',
        403,
      ),
    );
  }
  const guide = await User.findOne({
    _id: guideID,
    blockedUsers: { $nin: [req.user.id] }, // ENFORCE BLOCKED ONES AT DB LEVEL
    active: true,
  });
  if (!guide) {
    return next(new AppError('No such guide found', 404));
  }
  // console.log('check 1');
  // set the expiry date of 2 days
  // const expiryOfChat = 2 * 24 * 60 * 60 * 1000; // 2 days in milliseconds

  // Generate the token and store it in user DB
  const token = crypto.randomBytes(32).toString('hex');
  const chatToken = crypto.createHash('sha256').update(token).digest('hex');

  // Create a new chat in chat DB.
  const endedChatExists = await Chat.findOne({
    guide: guideID,
    doubtUser: userID,
    status: 'ended',
  });
  if (!endedChatExists) {
    newChat = await Chat.create({
      guide: guideID,
      doubtUser: userID,
      status: 'started',
      token: chatToken,
    });
    chatId = newChat._id;
  } else {
    newChat = await Chat.findOneAndUpdate(
      {
        guide: guideID,
        doubtUser: userID,
        status: 'ended',
      },
      { status: 'started' },
    );

    chatId = newChat._id;
  }
  // console.log('check 2');
  await User.findByIdAndUpdate(guideID, { $inc: { doubtsSolved: 1 } });
  // update the user's and the guide's "startedDoubts" array by appending this new doubt.
  // chatSocketMap.get({ chatId: chatId });
  // const delay = 2 * 24 * 60 * 60 * 1000; //2 * 24 * 60 * 60 * 1000;
  // console.log('check 2.5');
  const delay = 2 * 60 * 1000; //2 * 60 * 1000 || 2 mins;
  await reviewQueue.add(
    'addPendingReview',
    {
      userId: userID,
      guide: {
        _id: guideID,
        chatId,
        name: guide.name,
        photo: guide.profilePicture_LowRes,
      },
      // IOinstance
    },
    {
      delay, // wait 2 days before processing
      attempts: 3, // retry if it fails
      removeOnComplete: true, // auto-remove from Redis when done
      removeOnFail: false, // keep if it fails (for debugging)
    },
  );
  // console.log('check 3, sending response...');
  res.status(200).json({
    status: 'success',
    data: {
      newChat,
    },
  });
});

exports.giveReview = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  const guide = await User.findById(req.body.guideId);

  if (!guide) {
    return next(
      new AppError('There is no such guide! Please verify the guide ID!', 400),
    );
  }
  let reviewStatus;

  // console.log('pending review is: ', req.user.pendingReviews);

  const exists = req.user.pendingReviews.find(
    (review) => review.guide._id.toString() === req.body.guideId.toString(),
  );

  if (req.body.guideId === req.user.id) {
    return next(new AppError('You cannot review yourself!', 400));
  } else if (!exists) {
    return next(
      new AppError(
        'You dont have a doubt started or ended with this Guide. Cannot submit a review!',
        400,
      ),
    );
  }

  if (!guide) {
    return next(new AppError('No such guide exists', 404));
  } else if (!guide.active && exists) {
    let session;
    try {
      session = await mongoose.startSession();
      session.startTransaction();
      await req.user.updateOne(
        // user whose pendingReviews you want to modify
        { $pull: { pendingReviews: { 'guide._id': req.body.guideId } } },
        { session },
      );

      await Chat.findByIdAndUpdate(
        { _id: exists.guide.ChatId },
        { status: 'ended' },
        { session },
      );

      await session.commitTransaction();
      reviewStatus =
        'Guide deleted his account recently, pending review removed';
    } catch (error) {
      await session.abortTransaction();
      // console.error('Transaction aborted:', error);
      reviewStatus = 'failed';
    } finally {
      await session.endSession();
    }

    return res.status(200).json({
      status: 'success',
      message: reviewStatus,
    });
  } else {
    const newAura = guide.aura + req.body.rating * 2; ////// YET TO DECIDE WHAT RATIO TO KEEP FOR AURA AND RATING

    // const newGuide = await guide.updateOne(req.body.guideID, { aura: newAura });

    // // remove pending reviews from user's DB
    // const updatedUser = await User.findByIdAndUpdate(
    //   userId,
    //   { $pull: { pendingReviews: { guide: req.body.guideId } } },
    //   { new: true }
    // );

    const bulkOps = [
      {
        updateOne: {
          filter: { _id: req.body.guideId },
          update: { $inc: { aura: newAura } },
        },
      },
      {
        updateOne: {
          filter: { _id: userId },
          update: {
            $pull: { pendingReviews: { 'guide._id': req.body.guideId } },
          },
        },
      },
    ];
    let session;
    try {
      session = await mongoose.startSession();
      session.startTransaction();

      await User.bulkWrite(bulkOps, { session });
      // console.log('Existing pending review data: ', exists.guide.chatId);
      await Chat.findByIdAndUpdate(
        { _id: exists.guide.chatId },
        { status: 'ended' },
        { session },
      );

      await session.commitTransaction();
      reviewStatus = 'success';
    } catch (error) {
      await session.abortTransaction();
      // console.error('Transaction aborted:', error);
      reviewStatus = 'failed';
    } finally {
      await session.endSession();
    }
  }

  res.status(200).json({
    status: 'success',
    message: reviewStatus,
  });
});

exports.checkForPendingReviews = catchAsync(async (req, res, next) => {
  const currUser = req.user;

  if (currUser.pendingReviews.length > 0) {
    return res.status(403).json({
      status: 'pendingReview',
      data: {
        pendingReview: currUser.pendingReviews[0],
      },
    });
  }

  next();
});

exports.searchGuides = catchAsync(async (req, res, next) => {
  const { name } = req.body;
  if (!name || name.length < 2) {
    //////////// ADDED SAFETY VALIDATION!
    return res.json({ status: 'success', data: { guides: [] } });
  }

  let guides = await User.find({
    _id: { $nin: req.user.blockedUsers },
    active: true,
    openTo: true,
    blockedUsers: { $ne: req.user.id },
    $or: [
      { name: { $regex: '^' + name, $options: 'i' } },
      { skills: { $regex: '^' + name, $options: 'i' } },
    ],
  }).limit(20);

  if (guides.length < 5) {
    guides = await User.find({
      _id: { $nin: req.user.blockedUsers },
      active: true,
      openTo: true,
      blockedUsers: { $ne: req.user.id },
      $or: [
        { name: { $regex: name, $options: 'i' } },
        { skills: { $regex: name, $options: 'i' } },
      ],
    }).limit(20);
  }

  const formattedGuides = guides.filter(
    (g) => !g.blockedUsers.includes(req.user.id),
  );

  res.status(200).json({
    status: 'success',
    data: {
      guides: guides,
    },
  });
});
