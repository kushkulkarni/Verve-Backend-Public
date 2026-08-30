const User = require('../models/userModel');
const { admin } = require('./../firebaseInitialise');

exports.sendPushNotification = async (tokens, payload, receiverId) => {
  if (!tokens || tokens.length === 0) return;
  try {
    console.log('SENDING PUSH The tokens are: ', tokens);
    const response = await admin.messaging().sendEachForMulticast({
      tokens,
      // notification: {
      //   title: payload.title,
      //   body: payload.body,
      // },
      data: payload.data || {},
      android: {
        priority: 'high', //  REQUIRED for background/killed delivery
      },
      apns: {
        headers: {
          'apns-push-type': 'background',
          'apns-priority': '5',
          'apns-topic': 'com.kk.verveapp',
        },
        payload: {
          aps: {
            contentAvailable: true,
          },
        },
      },
    });
    const invalidTokens = [];

    response.responses.forEach((resp, idx) => {
      if (!resp.success) {
        const err = resp.error.code;

        if (
          err === 'messaging/registration-token-not-registered' ||
          err === 'messaging/invalid-registration-token'
        ) {
          invalidTokens.push(tokens[idx]);
        }
      }
    });

    console.log('FCM multicast result:', {
      successCount: response.successCount,
      failureCount: response.failureCount,
      responses: response.responses.map((r) => ({
        success: r.success,
        error: r.error?.code,
        message: r.error?.message,
      })),
    });

    if (invalidTokens.length) {
      await User.updateOne(
        { _id: receiverId },
        { $pull: { fcmTokens: { $in: invalidTokens } } },
      );
    }
    // console.log('response of push notification: ', response.responses);
    return {
      successCount: response.successCount,
      failureCount: response.failureCount,
    };
  } catch (err) {
    console.log('ERROR FROM FIREBASE FCM', err);
  }
};
