const { userSocketMap, chatSocketMap } = require('./socketTracker');
const Chat = require('../models/chatModel');
const User = require('../models/userModel');
const { error } = require('console');
const { Message } = require('../models/Message');
const { sendPushNotification } = require('./notificationPush');
const { default: mongoose } = require('mongoose');
const { decryptMessagePayload } = require('./crypto');

exports.chatSocketHandler = (socket, io) => {
  /**
   * Event: joinChat
   * payload: { chatId }
   * Purpose: client asks to join a particular conversation
   * Server checks:
   *  - chat exists
   *  - chat.status === 'started'
   *  - the connected user is either doubtUser or guide
   * If OK: register this socket in chatSocketMap so messages can be routed.
   */
  const userId = socket.user.id;
  socket.on('joinChat', async ({ chatId }) => {
    try {
      if (!chatId) {
        socket.emit('joinError', { message: 'chatId is required' });
        return;
      }

      const chat = await Chat.findById(chatId).lean();
      if (!chat) {
        socket.emit('joinError', { message: 'Chat Not found' });
        return;
      }

      if (chat.status !== 'started') {
        socket.emit('joinError', { message: 'Chat is not active' });
        return;
      }

      // Ensure that this specific user is allowed to join the chat

      const isParticipant =
        String(chat.doubtUser) === String(userId) ||
        String(chat.guide) === String(userId);

      if (!isParticipant) {
        socket.emit('joinError', {
          message: 'Not A participant of this chat!',
        });
        return;
      }

      // Put socket Id into chatSocketMap
      let mapping = chatSocketMap.get(String(chatId)) || {};
      mapping[String(userId)] = socket.id;
      chatSocketMap.set(String(chatId), mapping);

      socket.join(String(chatId));
      socket.emit('joinedChat', {
        chatId,
        message: 'Joined Chat successfully!',
      });

      // optionally inform other paryicipants that this user is online in this specific chat
      // find other useIds

      const otherUserId =
        String(chat.doubtUser) === String(userId)
          ? String(chat.guide)
          : String(chat.doubtUser);

      const otherSocketId =
        mapping[otherUserId] || userSocketMap.get(otherUserId);

      if (otherUserId) {
        io.to(otherSocketId).emit('participantOnline', { chatId, userId });
      }
    } catch (err) {
      console.error('joinChat error: ', err);
      socket.emit('joinError', { message: 'Server Error joining the chat' });
    }
  });

  /**
   * Event: sendMessage
   * payload: { chatId, text }
   * Purpose: send a message to the other participant after validating chat and participants.
   * Server responsibilities:
   *  - Verify chat exists & status
   *  - Verify sender is participant
   *  - Save the message to DB
   *  - Emit the message to the other participant if connected
   *  - Ack sender with saved message or error
   */
  socket.on('sendMessage', async (payload, ack) => {
    try {
      // console.log('Entered sendMessage with payload: ', payload);
      // console.log('sendMessage log 1');
      const { chatId, text, tempId, replyTo } = payload || {};
      if (!chatId || typeof text !== 'string' || text.trim() === '') {
        const errResponse = {
          success: false,
          message: 'chatId and text are required',
        };
        if (typeof ack == 'function') ack(errResponse);
        else socket.emit('sendError', errResponse);
        return;
      }
      // console.log('sendMessage log 2');
      const chat = await Chat.findById(chatId).lean();
      if (!chat || chat.status !== 'started') {
        const errResp = {
          success: false,
          message: 'Chat not active or not found',
        };
        if (typeof ack === 'function') ack(errResp);
        else socket.emit('sendError', errResp);
        return;
      }

      // console.log('sendMessage log 3');
      const isParticipant =
        String(chat.doubtUser) === String(userId) ||
        String(chat.guide) === String(userId);

      if (!isParticipant) {
        const errResp = { success: false, message: 'Not a chat participant' };
        if (typeof ack === 'function') ack(errResp);
        else socket.emit('sendError', errResp);
        return;
      }
      // console.log('sendMessage log 4');
      // Send to the other participant if online
      const mapping = chatSocketMap.get(String(chatId)) || {};
      const otherUserId =
        String(chat.doubtUser) === String(userId)
          ? String(chat.guide)
          : String(chat.doubtUser);
      const otherSocketId = userSocketMap.get(otherUserId);

      const users = await User.find({
        _id: { $in: [otherUserId, userId] },
        blockedUsers: { $nin: [userId, otherUserId] },
      }).lean();
      // console.log('sendMessage log 5');
      if (users.length < 2) {
        const faskeMsgPayload = {
          _id: 'blockedMessage',
          chat: chatId,
          sender: userId,
          recipient: otherUserId,
          text: text.trim(),
          replyTo: {
            messageId: replyTo?.messageId ? String(replyTo?.messageId) : null,
            text: replyTo?.text,
            sender: replyTo?.senderId ? String(replyTo?.senderId) : null,
          },
          createdAt: new Date(),
          tempId,
        };
        socket.emit('messageSent', { success: true, message: faskeMsgPayload });
        return;
      }
      // console.log('sendMessage log 6');
      // Persist message
      // '' => objectId
      /// reply.messageId === undefined
      const messageDoc = await Message.create({
        chat: chatId,
        sender: userId,
        recipient: otherUserId,
        text: text.trim(),
        replyTo: {
          messageId: replyTo?.messageId
            ? new mongoose.Types.ObjectId(String(replyTo?.messageId))
            : null,
          text: replyTo?.text,
          sender: replyTo?.senderId
            ? new mongoose.Types.ObjectId(String(replyTo?.senderId))
            : null,
        },
        createdAt: new Date(),
        // seen/sent/notSent fields will be handled later in Step 3
      });

      // Decrypt the message: VERY IMPORTANT!
      const safeMessage = decryptMessagePayload(messageDoc);

      // console.log('sendMessage log 7');
      // Prepare payload to emit
      const msgPayload = {
        _id: messageDoc._id,
        chat: chatId,
        sender: userId,
        text: safeMessage.text,
        createdAt: messageDoc.createdAt,
        replyTo: {
          messageId: replyTo?.messageId ? String(replyTo?.messageId) : null,
          text: safeMessage?.replyTo?.text,
          sender: replyTo?.senderId ? String(replyTo?.senderId) : null,
        },
        tempId,
      };
      // console.log('sendMessage log 8');
      // Update lastMessage in Chat model. This is needed for AllChats page preview
      // also increment unread count for that specific user in chat
      const unreadCounts = {
        doubtUser:
          String(chat.guide) === String(userId)
            ? chat.unreadCounts.doubtUser + 1
            : chat.unreadCounts.doubtUser,
        guide:
          String(chat.doubtUser) === String(userId)
            ? chat.unreadCounts.guide + 1
            : chat.unreadCounts.guide,
      };
      const newChat = await Chat.findByIdAndUpdate(
        chatId,
        {
          lastMessage: {
            text: messageDoc.text,
            sender: userId,
            createdAt: messageDoc.createdAt,
            status: 'sent',
          },
          unreadCounts,
          updatedAt: new Date(), // helps sorting chats by latest activity
        },
        { new: true },
      );
      // console.log('sendMessage log 9');
      // Acknowledge sender with saved message
      if (typeof ack === 'function')
        ack({ success: true, message: msgPayload });
      else socket.emit('messageSent', { success: true, message: msgPayload });

      // console.log('other socketId', otherSocketId);
      const senderSocketId = userSocketMap.get(String(userId));
      // console.log('sender socket ID: ', senderSocketId);

      // console.log('otherUserId: ', otherUserId);

      // console.log('sendMessage log 10');
      if (!otherSocketId) {
        console.log('USER OFFLINE, SENDING PUSH...');
        const receiver =
          await User.findById(otherUserId).select('fcmTokens name');
        // console.log('receiver: ', receiver);
        const sender = await User.findById(userId).select('name');
        const payload = {
          data: {
            chatId: String(chatId),
            userId: String(userId),
            otherUserId: String(userId),
            text: String(text),
            messageId: String(messageDoc._id),
            createdAt: String(messageDoc.createdAt),
            title: String(sender.name),
            body: String(text),
            replyTo: JSON.stringify({
              messageId: replyTo?.messageId ? String(replyTo?.messageId) : null,
              text: replyTo?.text ? String(replyTo?.text) : null,
              sender: replyTo?.senderId ? String(replyTo?.senderId) : null,
            }),
          },
        };
        await sendPushNotification(receiver.fcmTokens, payload, receiver._id);
        return;
      }

      console.log(`USER ONLINE, SENDING EMIT TO ${otherUserId}...`);
      // io.to(otherSocketId).emit('newMessage', msgPayload);
      io.to(otherSocketId)
        .timeout(1500)
        .emit('newMessage', msgPayload, async (err) => {
          try {
            if (err) {
              console.log('USER TOKEN FOUND BUT WAS OFFLINE, SENDING PUSH...');
              const receiver =
                await User.findById(otherUserId).select('fcmTokens name');
              // console.log('receiver: ', receiver);
              const sender = await User.findById(userId).select('name');
              const payload = {
                data: {
                  chatId: String(chatId),
                  userId: String(userId),
                  otherUserId: String(userId),
                  text: String(text),
                  messageId: String(messageDoc._id),
                  createdAt: String(messageDoc.createdAt),
                  title: String(sender.name),
                  body: String(text),
                  replyTo: JSON.stringify({
                    messageId: replyTo?.messageId
                      ? String(replyTo?.messageId)
                      : null,
                    text: replyTo?.text ? String(replyTo?.text) : null,
                    sender: replyTo?.senderId
                      ? String(replyTo?.senderId)
                      : null,
                  }),
                },
              };
              await sendPushNotification(
                receiver.fcmTokens,
                payload,
                receiver._id,
              );
              return;
            }

            // await Message.findByIdAndUpdate(msgPayload._id, {
            //   status: 'delivered',
            // });
          } catch (error) {
            console.log(error);
          }
        });
      if (otherSocketId) {
        // other participant is connected somewhere: emit message
        /////////// DO NOT TELL THE SENDER THAT MESSAGE WAS DELIVERED HERE! LET THE SENDER EMIT AS MESSAGE DELIVERED! ///////////
        // io.to(senderSocketId).emit('messageDelivered', {
        //   messageId: msgPayload._id,
        //   chatId: chat._id,
        // });
        // console.log('SETTING SENT MESSAGES AS DELIVERED IN DB...');
        // await Message.findByIdAndUpdate(msgPayload._id, {
        //   status: 'delivered',
        // });
      } else {
        // other participant offline: you might queue push notifications here
        // console.log('USER OFFLINE, SENDING PUSH...');
        // // console.log('otherUserId: ', otherUserId);
        // const receiver =
        //   await User.findById(otherUserId).select('fcmTokens name');
        // // console.log('receiver: ', receiver);
        // const sender = await User.findById(userId).select('name');
        // const payload = {
        //   data: {
        //     chatId: String(chatId),
        //     userId: String(userId),
        //     otherUserId: String(userId),
        //     text: String(text),
        //     messageId: String(messageDoc._id),
        //     createdAt: String(messageDoc.createdAt),
        //     title: String(sender.name),
        //     body: String(text),
        //     replyTo: JSON.stringify({
        //       messageId: replyTo?.messageId ? String(replyTo?.messageId) : null,
        //       text: replyTo?.text ? String(replyTo?.text) : null,
        //       sender: replyTo?.senderId ? String(replyTo?.senderId) : null,
        //     }),
        //   },
        // };
        // const result =
        // await sendPushNotification(receiver.fcmTokens, payload, receiver._id);
        // console.log('message sent by sender with ID: ', userId);
      }

      // ADDED PART 2 — Emit chatUpdated event. This updates the AllChats screen preview

      // io.to(senderSocketId).emit('chatUpdated', {
      //   chatId: messageDoc.chat,
      //   text: messageDoc.text,
      //   sender: true,
      //   status: 'sent',
      //   createdAt: messageDoc.createdAt,
      // });

      // if (otherSocketId) {
      //   io.to(otherSocketId).emit('chatUpdated', {
      //     chatId: messageDoc.chat,
      //     text: messageDoc.text,
      //     sender: false,
      //     createdAt: messageDoc.createdAt,
      //   });
      // }
    } catch (err) {
      console.error('sendMessage error', err);
      if (typeof ack === 'function')
        ack({ success: false, message: 'Internal error' });
      else
        socket.emit('sendError', { success: false, message: 'Internal error' });
    }
  });

  socket.on('messageDelivered', async ({ messageId }) => {
    try {
      const message = await Message.findById(messageId);
      if (!message) return;

      message.status = 'delivered';
      await message.save();
      const chat = await Chat.findById(message.chat);
      await Chat.findByIdAndUpdate(message.chat, {
        $set: { 'lastMessage.status': 'delivered' },
      });
      // console.log('chat preview changed! chat: ', chat);
      const otherUserId =
        String(chat.doubtUser) === String(socket.user.id)
          ? String(chat.guide)
          : String(chat.doubtUser);

      // console.log(`messageDelivered started for ${userId} -> ${otherUserId}`);
      const otherSocketId = userSocketMap.get(otherUserId);

      if (!otherSocketId) {
        const user = await User.findById(otherUserId).select('fcmTokens');
        const payload = {
          data: {
            chatId: message.chat,
            userId: otherUserId,
            event: 'delivered',
          },
        };
        await sendPushNotification(user.fcmTokens, payload, otherUserId);
        return;
      }

      // const senderSocketId = userSocketMap.get(String(userId));
      // if (senderSocketId) {
      //   io.to(senderSocketId).emit('messageDelivered', {
      //     messageId: String(message._id),
      //     chatId: String(chat._id),
      //   });
      // }

      io.to(otherSocketId)
        .timeout(1500)
        .emit(
          'messageDelivered',
          {
            messageId,
            chatId: String(message.chat),
          },
          async (err) => {
            try {
              if (err) {
                const user =
                  await User.findById(otherUserId).select('fcmTokens');
                const payload = {
                  data: {
                    chatId: message.chat,
                    userId: otherUserId,
                    event: 'delivered',
                  },
                };
                await sendPushNotification(
                  user.fcmTokens,
                  payload,
                  otherUserId,
                );
              }
            } catch (error) {
              console.log(error);
            }
          },
        );

      /// tell the sender that his/her msg was delivered
      if (otherSocketId) {
        //// check if sender is online, if yes send via socket
        // const senderSocketId = userSocketMap.get(String(userId));
        // if (senderSocketId) {
        //   io.to(senderSocketId).emit('messageDelivered', {
        //     messageId: String(message._id),
        //     chatId: String(chat._id),
        //   });
        // }
        // io.to(otherSocketId).emit('messageDelivered', {
        //   messageId,
        //   chatId: String(message.chat),
        // });
      } else {
        //// if no socketId, send via silent fcm push:
        // const user = await User.findById(otherUserId).select('fcmTokens');
        // const payload = {
        //   data: {
        //     chatId: message.chat,
        //     userId: otherUserId,
        //     event: 'delivered',
        //   },
        // };
        /// later handle debounce to send only one fcm so frontend marks all msgs as delivered at once instead of one fcm per message...
        /// WARNING!: DEBOUNCE ONLY FOR SIMILAR CHATIDs!!!
        // await sendPushNotification(user.fcmTokens, payload, senderId);
      }
      // console.log(`messageDelivered ended for ${userId}`);
    } catch (err) {
      // console.error('messageDelivered error', err);
    }
  });

  // Typing started indicator implemet debouncing on frontend...
  socket.on('typing', async ({ chatId }) => {
    // console.log('typing');
    if (!chatId) return;

    const chat = await Chat.findById(chatId);
    if (!chat) return;

    const otherUserId =
      String(chat.doubtUser) === String(userId)
        ? String(chat.guide)
        : String(chat.doubtUser);

    const receiverSocketId = userSocketMap.get(otherUserId);

    if (receiverSocketId) {
      io.to(String(receiverSocketId)).emit('typing', {
        chatId,
        userId,
      });
    }
  });
  // Typing ended indicator implemet debouncing on frontend...
  socket.on('stopTyping', async ({ chatId }) => {
    // console.log('stopTyping');
    if (!chatId) return;

    const chat = await Chat.findById(chatId);
    if (!chat) return;

    const otherUserId =
      String(chat.doubtUser) === String(userId)
        ? String(chat.guide)
        : String(chat.doubtUser);

    const receiverSocketId = userSocketMap.get(otherUserId);

    if (receiverSocketId) {
      io.to(String(receiverSocketId)).emit('stopTyping', {
        chatId,
        userId,
      });
    }
  });

  // Message read event:
  socket.on('messagesRead', async ({ chatId, lastReadMessageId }) => {
    try {
      // console.log('entered messages read');
      // console.log('messagesRead started');
      const lastMsg = await Message.findById(lastReadMessageId);
      if (lastMsg && lastMsg.status === 'read') {
        // console.log('messagesRead ended WITH LATEST MSG ALREADY READ FOUND');
        return;
      }
      const chat = await Chat.findById(chatId);
      if (!chat) return;

      const otherUserId =
        String(chat.doubtUser) === String(userId)
          ? String(chat.guide)
          : String(chat.doubtUser);

      const users = await User.find({
        _id: { $in: [otherUserId, userId] },
        blockedUsers: { $nin: [userId, otherUserId] },
      }).lean();

      if (users.length < 2) {
        ack(errResp);
        return;
      }

      // Mark messages as read
      const result = await Message.updateMany(
        {
          chat: chatId,
          sender: otherUserId,
          status: { $ne: 'read' },
        },
        {
          status: 'read',
          readAt: new Date(),
        },
      );

      if (result.modifiedCount === 0) {
        // console.log('messagesRead ended WITH NO UPDATES');
        return; //  nothing changed → stop everything
      }

      chat.lastMessage.status = 'read';

      // Reset unread counter
      if (String(chat.doubtUser) === String(userId)) {
        chat.unreadCounts.doubtUser = 0;
      } else {
        chat.unreadCounts.guide = 0;
      }

      await chat.save();

      // Inform the other participant

      const senderSocketId = userSocketMap.get(otherUserId);

      if (!senderSocketId) {
        const user = await User.findById(otherUserId).select('fcmTokens');

        const payload = {
          data: {
            chatId,
            userId: otherUserId,
            event: 'read',
          },
        };
        await sendPushNotification(user.fcmTokens, payload, otherUserId);
        return;
      }

      io.to(String(senderSocketId))
        .timeout(1500)
        .emit(
          'messagesRead',
          {
            chatId,
            readBy: userId,
          },
          async (err) => {
            try {
              if (err) {
                const user =
                  await User.findById(otherUserId).select('fcmTokens');

                const payload = {
                  data: {
                    chatId,
                    userId: otherUserId,
                    event: 'read',
                  },
                };
                await sendPushNotification(
                  user.fcmTokens,
                  payload,
                  otherUserId,
                );
              }
            } catch (error) {
              console.log(error);
            }
          },
        );

      if (senderSocketId) {
        //// check if sender is online, if yes send via socket
        // io.to(String(senderSocketId)).emit('messagesRead', {
        //   chatId,
        //   readBy: userId,
        // });
      } else {
        //// if no socketId, send via silent fcm push:
        // const user = await User.findById(otherUserId).select('fcmTokens');
        // const payload = {
        //   data: {
        //     chatId,
        //     userId: otherUserId,
        //     event: 'read',
        //   },
        // };
        // ////// WARNING!: DO NOT HANDLE DEBOUNCE HERE AT ANY COST!!!
        // await sendPushNotification(user.fcmTokens, payload, otherUserId);
      }

      // console.log('messagesRead ended');
    } catch (err) {
      // console.error('messagesRead error:', err);
    }
  });

  socket.on('deleteMessage', async ({ messageId, chatId }, ackSender) => {
    // console.log('deleteMessage emit recieved');
    try {
      if (!messageId || !chatId) {
        ackSender?.({ success: false });
        return;
      }

      const msg = await Message.findById(messageId);
      if (!msg) {
        ackSender?.({ success: false });
        return;
      }

      // idempotent
      if (!msg.deleted) {
        msg.deleted = true;
        msg.text = '';
        await msg.save();
      }

      const chat = await Chat.findById(chatId);
      if (!chat) {
        ackSender?.({ success: false });
        return;
      }

      if (String(chat.lastMessage.createdAt) === String(msg.createdAt)) {
        chat.lastMessage.text = '';
        chat.lastMessage.deleted = true;
        await chat.save();
      }

      const otherUserId =
        String(chat.doubtUser) === String(userId)
          ? String(chat.guide)
          : String(chat.doubtUser);

      const receiverSocketId = userSocketMap.get(otherUserId);

      if (!receiverSocketId) {
        // ❌ no socket → directly FCM
        // TODO: send FCM here
        // console.log('USER OFFLINE, FCM PUSH FOR DELETE MESSAGE');
        const user = await User.findById(otherUserId).select('fcmTokens');
        const payload = {
          data: {
            chatId,
            messageId,
            userId: otherUserId,
            event: 'deleted',
          },
        };
        ////// WARNING!: DO NOT HANDLE DEBOUNCE HERE AT ANY COST!!!
        await sendPushNotification(user.fcmTokens, payload, otherUserId);

        ackSender?.({ success: true, delivered: false });
        return;
      }

      let ackReceived = false;

      // ⏱ timeout fallback
      const timeout = setTimeout(async () => {
        if (!ackReceived) {
          // ACK NOT RECEIVED → FCM
          // TODO: send FCM here

          ackSender?.({ success: true, delivered: false });
        }
      }, 1500); // 1.5s window

      // 🔥 EMIT WITH ACK CALLBACK
      io.to(receiverSocketId).emit(
        'messageDeleted',
        { messageId: String(messageId), chatId: String(chatId) },
        () => {
          ackReceived = true;
          clearTimeout(timeout);

          // ✅ delivered successfully
          ackSender?.({ success: true, delivered: true });
        },
      );
    } catch (err) {
      // console.error('deleteMessage error:', err);
      ackSender?.({ success: false });
    }
  });
  // socket.on("join", (roomId) => {
  //   if (roomId) socket.join(roomId);
  //   console.log(`Socket ${socket.id} joined room ${roomId}`);
  // });

  // handle disconnect: cleanup maps
  socket.on('disconnect', (reason) => {
    // console.log(`Socket disconnected: ${socket.id} (${reason})`);
    // Remove from userSocketMap
    userSocketMap.forEach((sid, uid) => {
      if (sid === socket.id) userSocketMap.delete(uid);
    });

    // Remove this socket from any chatSocketMap entries
    for (const [chatId, mapping] of chatSocketMap.entries()) {
      for (const [uid, sid] of Object.entries(mapping)) {
        if (sid === socket.id) {
          delete mapping[uid];
          // if mapping is empty, remove it altogether
          if (Object.keys(mapping).length === 0) chatSocketMap.delete(chatId);
          else chatSocketMap.set(chatId, mapping);
          break;
        }
      }
    }
  });
};

// STEP 2 — Add this inside chatSocketHandler.js
exports.deleteChatFromSockets = async (chatId, io) => {
  try {
    const mapping = chatSocketMap.get(String(chatId));
    if (!mapping) return; // No sockets to clean

    // Notify both participants that chat expired
    Object.values(mapping).forEach((socketId) => {
      io.to(socketId).emit('chatExpired', {
        chatId,
        message: 'This chat session has expired.',
      });

      // Optionally remove them from socket room
      const socket = io.sockets.sockets.get(socketId);
      if (socket) socket.leave(String(chatId));
    });

    // Remove from chatSocketMap
    chatSocketMap.delete(String(chatId));
  } catch (err) {
    // console.error('delete chats from sockets error: ', err);
  }
};
