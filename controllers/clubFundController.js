const User = require('./../models/userModel');
const Notification = require('./../models/notifications');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/appError');
const { sendMail } = require('./../utils/sendMail');
const Club = require('./../models/clubModel');
const sendNotification = require('./../utils/sendNotification');
const mongoose = require('mongoose');
const APIFeatures = require('./../utils/apiFeatures');
const notificationSocketHandler = require('./../utils/notificationSocket');
const { eventQueue } = require('./jobsController');
const EventDraftVersion = require('./../models/clubEventDraftVersionModel');
const _ = require('lodash');
const Transactions = require('../models/clubTransactionsModel');
const TransactionRequests = require('../models/transactionPermissionRequestModel');

exports.createFundDraft = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const clubId = req.body.clubId;
  const draftId = req.body.draftId;
  const items = req.body.items;

  if (!Array.isArray(items) || !items || !items.length) {
    return next(new AppError('Please provide items array', 400));
  }

  const existingDraft = draftId
    ? await EventDraftVersion.findOne({ draftId })
    : null;
  const existingDraftItems = existingDraft ? existingDraft.items : null;

  if (_.isEqual(items, existingDraftItems)) {
    return next(new AppError('Nothing was changed', 400));
  }

  const newDraft = await EventDraftVersion.create({
    draftId: existingDraft ? draftId : null,
    version: existingDraft ? existingDraft.version + 1 : 1,
    createdBy: userId,
    status: existingDraft ? existingDraft.status : 'pending',
    items: items,
    snapshot: {
      status: existingDraft.status,
      items: existingDraftItems,
    },
  });

  res.status(200).json({
    status: 'success',
    data: {
      newDraft,
    },
  });
});

exports.requestTransactionApproval = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const requestingAuthorityId = req.body.requestTo;
  const draftId = req.body.draftId;
  const itemIds = req.body.itemIds;
  const clubId = req.body.clubId;

  // Check if the draft and the requesting authority exists
  if (!requestingAuthorityId || !draftId) {
    return next(
      new AppError(
        'Please provide the ID of draft and whom you are requesting',
        400,
      ),
    );
  }
  const requestingAuthority = await User.findById(requestingAuthorityId);

  if (!requestingAuthority) {
    return next(new AppError('User you are requesting to was not found', 404));
  }

  // Check if the person being requested exists and is a treasurer or the president
  const authorityIsAuthorized = requestingAuthority.club_position.find(
    (c) =>
      c.club === clubId &&
      (c.position === 'club_treasurer' || c.position === 'club_president'),
  );

  if (!authorityIsAuthorized) {
    return next(
      new AppError(
        'Please ask an authorized treasurer or president of the club for transaction permission',
        401,
      ),
    );
  }

  // Check if the draft exists to ask for transaction for this draft
  const draft = await EventDraftVersion.findOne({ draftId }).sort({
    version: -1,
  });

  if (!draft) {
    return next(
      new AppError('Draft associated with this transaction was not found', 404),
    );
  }

  // Check if the provided item IDS exist in the draft
  if (
    !itemIds ||
    !itemIds.every((id) => draft.items.find((originalId) => id === originalId))
  ) {
    return next(
      new AppError('Some of the items does not exist in the draft', 404),
    );
  }

  // Check if the transaction for the xyz items is not already done
  const transactionsDoneForProvidedItems = await Transactions.find({
    draftId,
    version: draft.version,
    items: {
      $elemMatch: { itemId: { $in: itemIds } },
    },
  });

  if (transactionsDoneForProvidedItems.length) {
    return next(new AppError('Some of the items are already bought', 400));
  }
  // Check if request is not already been sent by this user
  const requestAlreadySent = await TransactionRequests.find({
    draftId,
    requestedBy: userId,
    $expr: {
      $setEquals: ['$items', itemIds],
    },
  });

  // Create request document
  const newTransactionRequest = await TransactionRequests.create({
    draftId,
    draftVersion: draft.version,
    requestedBy: userId,
    requestedTo: requestingAuthorityId,
    items: itemIds,
  });

  res.status(200).json({
    status: 'success',
    data: {
      newTransactionRequest,
    },
  });
});
