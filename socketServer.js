const { Server } = require('socket.io');

require('./utils/socket').deleteChatFromSockets; // ensure export loaded
const chatSocketHandler = require('./utils/socket').chatSocketHandler;
const { userSocketMap, chatSocketMap } = require('./utils/socketTracker');
const jwt = require('jsonwebtoken');
const User = require('./models/userModel');
const AppError = require('./utils/appError');
const { Message } = require('./models/Message');
const Chat = require('./models/chatModel');
const { sendPushNotification } = require('./utils/notificationPush');
const client = require('./redisClient');
const { decryptMessagePayload } = require('./utils/crypto');

async function verifySocketToken(token, next) {
  if (!token) throw new Error('No token provided');
  // Use same secret you use for HTTP JWTs
  const secret = process.env.JWT_SECRET || 'your_jwt_secret';
  const decoded = jwt.verify(token, secret);

  const storedSession = await client.get(`session:${decoded.id}`);

  if (!storedSession || storedSession !== decoded.sessionId) {
    throw new Error('Invalid session');
  }

  return decoded;
}

function initSocketServer(server, app) {
  const io = new Server(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST', 'PATCH', 'DELETE'],
      credentials: true,
    },
  });

  // socket authentication middleware (optional but recommended)
  io.use(async (socket, next) => {
    try {
      // console.log('Entered socket auth');
      // debug: show raw cookie header
      // console.log(
      //     'socket handshake cookies header:',
      //     socket.handshake.headers.cookie,
      //   );

      // 1) Try token from handshake.auth first (if client sent it)
      let token = socket.handshake.auth && socket.handshake.auth.token;
      // 2) If not present there, try parsing cookie header (common when server sets httpOnly cookie)
      if (
        !token &&
        socket.handshake.headers &&
        socket.handshake.headers.cookie
      ) {
        // const parsed = cookie.parse(socket.handshake.headers.cookie || '');
        // token = parsed.jwt; // use the cookie name your login sets (here: 'jwt')
        token = socket.handshake.headers.cookie.split(' ')[1];
      }
      // console.log('TOKEN:', token);

      // 3) verify and attach
      const payload = await verifySocketToken(token, next); // will throw if missing/invalid
      // console.log('✅ TOKEN VERIFIED:', payload);
      socket.user = { id: payload.id };
      // console.log('socket.user, socket.user.id: ', socket.user, socket.user.id);
      return next();
    } catch (err) {
      // console.log('❌ SOCKET AUTH FAILED:', err.message);
      console.error('Socket auth error:', err.message);
      return next(new Error(`Authentication error: ` + err.message));
    }
  });

  // SOCKET HANDLERS
  io.on('connection', async (socket) => {
    const userId = socket.user.id;
    // console.log('ENTERED SOCKET CONNECTION');
    // console.log(`Socket connected: ${socket.id} for user ${userId}`);

    userSocketMap.set(userId, socket.id);

    const user = await User.findById(userId);
    const clubIds = user.club_position.map((club) =>
      socket.join(`club_${club.club.toString()}`),
    );

    /// MARK ALL MESSEGES OF USERS TO DELIVERED
    const sentMessages = await Message.find({
      recipient: userId,
      status: 'sent',
    });
    const decryptedMessages = sentMessages.map(decryptMessagePayload);
    // console.log('SENT MESSAGES TO USER: ', sentMessages);
    if (decryptedMessages.length > 0) {
      const perUserMessages = new Map();
      decryptedMessages.forEach((message) => {
        if (!perUserMessages.has(String(message.chat))) {
          perUserMessages.set(String(message.chat), []);
        }
        perUserMessages
          .get(String(message.chat))
          .push({ _id: String(message._id), sender: String(message.sender) });
      });

      if (perUserMessages.size > 0) {
        perUserMessages.forEach(async (_, chatId) => {
          // set the chat preview:
          await Chat.findByIdAndUpdate(chatId, {
            $set: { 'lastMessage.status': 'delivered' },
          });
          const perMessages = perUserMessages.get(chatId);
          const senderId = perMessages[0].sender;
          const senderSocketId = userSocketMap.get(senderId);
          if (senderSocketId) {
            perMessages.forEach((message) => {
              io.to(senderSocketId).emit('messageDelivered', {
                messageId: message._id,
                chatId: message.chat,
              });
            });
          } else {
            // console.log(
            //   'Sender is offline, sending fcm push to userId: ',
            //   senderId,
            // );
            const sender = await User.findById(senderId).select('fcmTokens');
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
      await Promise.all(
        sentMessages.map(async (message) => {
          message.status = 'delivered';
          const savedMessage = await message.save();
          // console.log('savedMessage: ', savedMessage);
          return savedMessage;
        }),
      );

      // sentMessages.forEach((message) => {
      //   const socketId = userSocketMap.get(String(message.sender));
      // console.log(
      //     'INSIDE io.on("connection"), sender is online, emitting sender as msg delivered... senderSocketId:',
      //     socketId,
      //   );
      //   if (socketId)
      //     io.to(socketId).emit('messageDelivered', { messageId: message._id });
      //   else {
      //     // send fcm!
      // console.log('INSIDE io.on("connection"), sender is OFFLINE, FCM PUSHING sender as msg delivered... senderSocketId:')
      //   }
      // });
    }

    chatSocketHandler(socket, io);
  });

  // Make delete function accessible globally
  app.set('deleteChatSocket', chatSocketHandler.deleteChatFromSockets);

  // make socket available in controllers
  app.use((req, res, next) => {
    req.io = io;
    next();
  });

  // expose io globally
  app.set('io', io);

  // middleware to access io in controllers
  app.use((req, res, next) => {
    req.io = io;
    next();
  });

  return io;
}
module.exports = initSocketServer;
