const mongoose = require('mongoose');
const { Message } = require('../models/Message');
const conversation = require('../models/chatModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const { userSocketMap } = require('./../utils/socketTracker');
const User = require('../models/userModel');
const { sendPushNotification } = require('../utils/notificationPush');
const { getIO } = require('./../utils/socketInstance');
const { decryptMessagePayload } = require('../utils/crypto');
const { decryptChatPayload } = require('./../utils/messageService');

exports.getMessageStatusSync = catchAsync(async (req, res, next) => {
  const since = req.query.since;
  const userId = req.user.id;
  // console.log('entered getMessageStatusSync with query: ', since);
  if (!since) {
    return next(new AppError('Missing "since" timestamp', 400));
  }

  const sinceDate = new Date(since);
  // console.log(sinceDate);
  // FIXED: include BOTH new messages AND updated messages
  const messages = (
    await Message.find({
      $or: [
        {
          recipient: userId,
          createdAt: { $gt: sinceDate }, // new incoming messages
        },
        {
          sender: userId,
          updatedAt: { $gt: sinceDate }, // status updates
        },
      ],
    })
      .select(
        '_id chat sender recipient text status replyTo createdAt updatedAt',
      )
      .lean()
  ).map(decryptMessagePayload);

  // console.log('The messages about to get synced: ', messages);

  // ALSO: Find the chats and update them on frontend!
  const chats = (
    await conversation
      .find({
        $and: [
          {
            $or: [{ guide: userId }, { doubtUser: userId }],
          },
          {
            $or: [
              { updatedAt: { $gt: sinceDate } }, // updates + new chats
              { createdAt: { $gt: sinceDate } }, // extra safety
            ],
          },
        ],
      })
      .populate('guide', '_id name profilePicture_LowRes')
      .populate('doubtUser', '_id name profilePicture_LowRes')
      .lean()
  ).map(decryptChatPayload);

  res.status(200).json({
    status: 'success',
    data: {
      messages,
      chats,
      userId: req.user.id,
      latestSyncAt: new Date(),
    },
  });
});

exports.markAsDelivered = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const foundMessages = await Message.find({
    recipient: userId,
    status: 'sent',
  });

  // console.log('foundMessages: ', foundMessages);
  await Message.updateMany(
    { _id: { $in: foundMessages.map((m) => m._id) } },
    { status: 'delivered' },
  );

  const perUserMessages = new Map();
  foundMessages.forEach((message) => {
    if (!perUserMessages.has(String(message.chat))) {
      perUserMessages.set(String(message.chat), []);
    }
    perUserMessages
      .get(String(message.chat))
      .push({ _id: String(message._id), sender: String(message.sender) });
  });
  // console.log('perUserMessages: ', perUserMessages);
  const io = getIO();
  // console.log('io is: ', io);
  if (perUserMessages.size > 0) {
    perUserMessages.forEach(async (_, chatId) => {
      // set the chat preview:
      await conversation.findByIdAndUpdate(chatId, {
        $set: { 'lastMessage.status': 'delivered' },
      });
      const perMessages = perUserMessages.get(chatId);
      // console.log('messages: ', perMessages);
      const senderId = perMessages[0].sender;
      // console.log('Sending emit("messageDelivered") to id: ', senderId);
      const senderSocketId = userSocketMap.get(senderId);
      /// notify the sender via socket or fcm
      if (senderSocketId) {
        //// if user socket available, user is online, tell him his messages were delivered ->
        // console.log(
        //   'Sender is online, sending emit to userId: ',
        //   senderId,
        //   ' userSocketId: ',
        //   senderSocketId,
        // );
        perMessages.forEach((message) => {
          io.to(senderSocketId).emit('messageDelivered', {
            messageId: message._id,
            chatId: chatId,
          });
        });
      } else {
        //// if user socket not available, user is offline, push BULK fcm to sender to tell his messages were delivered
        // we have to inform the sender that the messages in this chatId were delivered to reciever:
        // console.log(
        //   'Sender is offline, sending fcm push to userId: ',
        //   senderId,
        // );
        const sender = await User.findById(senderId).select('fcmTokens');
        // console.log('senderFcmTokens: ', sender.fcmTokens);
        const payload = {
          data: {
            chatId: String(chatId),
            userId: String(senderId),
            event: 'delivered', // Set event so background handler knows if messages were delivered or read by reciever.
          },
        };
        await sendPushNotification(sender.fcmTokens, payload, senderId);
      }
    });
  }

  res.status(200).json({
    status: 'success',
    data: {
      message: 'Messages updated successfully',
    },
  });
});

/////////////////// !!! UPDATE !!! POPUATED PFP!
exports.getYourDoubtChats = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const chats = (
    await conversation
      .find({ doubtUser: userId })
      .populate({ path: 'guide', select: 'name profilePicture_LowRes' })
      .lean()
  ).map(decryptChatPayload);
  // .sort({ updatedAt: -1 });
  res.status(200).json({
    status: 'success',
    data: {
      chats,
    },
  });
});

/////////////////// !!! UPDATE !!! POPUATED PFP!
exports.getOthersDoubtChats = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const chats = (
    await conversation
      .find({ guide: userId })
      .populate({
        path: 'guide doubtUser',
        select: 'name profilePicture_LowRes',
      })
      .lean()
  ).map(decryptChatPayload);
  // .sort({ updatedAt: -1 });
  res.status(200).json({
    status: 'success',
    data: {
      chats,
    },
  });
});

exports.getSpecificChat = catchAsync(async (req, res, next) => {
  const { conversationId } = req.params;
  if (!conversationId) {
    return next(new AppError('Provide chat id', 400));
  }
  const chat = decryptChatPayload(
    await conversation
      .findById(conversationId)
      .populate({
        path: 'guide doubtUser',
        match: {
          _id: { $ne: req.user.id },
        },
        select: 'name profilePicture_LowRes',
      })
      .lean(),
  );

  if (!chat) {
    return next(new AppError('Chat not found', 404));
  }

  const otherUserId = chat.guide?._id ? chat.guide?._id : chat.doubtUser?._id;
  const otherUserName = chat.guide?.name
    ? chat.guide?.name
    : chat.doubtUser?.name;
  const otherUserAvatar = chat.guide?.profilePicture_LowRes
    ? chat.guide?.profilePicture_LowRes
    : chat.doubtUser?.profilePicture_LowRes;
  const userIsGuide = chat.guide?._id ? false : true;

  const chatStructure = {
    _id: String(chat._id),
    otherUserId: String(otherUserId),
    otherUserName,
    otherUserAvatar,
    guideId: chat.guide._id ? String(chat.guide._id) : String(chat.guide),

    lastMessageText: chat.lastMessage.text,
    lastMessageSender: chat.lastMessage.sender
      ? String(chat.lastMessage.sender)
      : null,
    lastMessageStatus: chat.lastMessage.status,
    lastMessageAt: chat.lastMessage.createdAt
      ? chat.lastMessage.createdAt.toISOString()
      : chat.lastMessage.createdAt,

    unreadCount: userIsGuide
      ? chat.unreadCounts.guide
      : chat.unreadCounts.doubtUser,
    status: chat.status,
    updatedAt: chat.updatedAt ? chat.updatedAt.toISOString() : chat.updatedAt,
  };

  res.status(200).json({
    status: 'success',
    data: {
      chat: chatStructure,
    },
  });
});

////////////////////// !!! UPDATE !!! UPDATED THIS ENDPOINT COMPLETELY!
exports.getMessagesByConversation = catchAsync(async (req, res, next) => {
  // console.log('Entered getMessagesByConversation: ');
  const conversationId = req.params.conversationId;
  const cursor = req.query.cursor;
  const limit = parseInt(req.query.limit) || 30;

  const userId = (
    req.user &&
    (req.user.id || req.user._id || req.user.ID)
  )?.toString();

  if (!userId) {
    return next(new AppError('Missing user id', 400));
  }

  if (!mongoose.Types.ObjectId.isValid(conversationId)) {
    return next(new AppError('Invalid conversationId', 400));
  }

  const query = {
    chat: conversationId,
    deletedFor: {
      $nin: [userId, new mongoose.Types.ObjectId(userId)],
    },
    deletedForEveryone: { $ne: true },
  };

  if (cursor && mongoose.Types.ObjectId.isValid(cursor)) {
    query._id = { $lt: cursor };
  }

  const msgs = await Message.find(query)
    .sort({ _id: -1 })
    .limit(limit)
    .populate('sender', 'name _id')
    .lean();

  const messages = msgs.reverse().map(decryptMessagePayload);

  const annotated = messages.map((m) => ({
    ...m,
    fromMe:
      (m.sender && m.sender._id
        ? m.sender._id.toString()
        : m.sender.toString()) === userId,
  }));

  res.status(200).json({
    status: 'success',
    data: {
      messages: annotated,
      nextCursor: annotated.length > 0 ? annotated[0]._id : null,
      hasMore: annotated.length === limit,
    },
  });
});

exports.deleteMessageForMe = catchAsync(async (req, res, next) => {
  const MessageId = req.params.MessageId;
  const userId = (
    req.user &&
    (req.user.id || req.user._id || req.user.ID)
  )?.toString();

  const message = await Message.findById(MessageId);
  if (!message) return res.status(404).json({ error: 'Message not found' });

  const userObjectId = new mongoose.Types.ObjectId(userId);

  //  Added null-safe check here
  const alreadyDeleted = message.deletedFor.some(
    (id) => id && id.toString() === userObjectId.toString(),
  );

  if (!alreadyDeleted) {
    message.deletedFor.push(userObjectId);
    await message.save();
  }

  res.status(200).json({
    status: 'success',
    data: {
      message: 'Message deleted for you only',
    },
  });
});

exports.deleteMessageForEveryone = catchAsync(async (req, res, next) => {
  const MessageId = req.params.MessageId;
  const userId = (
    req.user &&
    (req.user.id || req.user._id || req.user.ID)
  )?.toString();

  const message = await Message.findById(MessageId);
  if (!message) return res.status(404).json({ error: 'Message not found' });

  if (message.sender.toString() !== userId) {
    return res
      .status(403)
      .json({ error: 'Not authorized to delete this message' });
  }

  message.deletedForEveryone = true;
  message.body = '[Message deleted]';
  await message.save();

  res.status(200).json({
    status: 'success',
    data: {
      message: 'Message deleted for everyone',
    },
  });
});
