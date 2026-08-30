const catchAsync = require('../utils/catchAsync');
const sendNotification = require('./../utils/sendNotification');
const { admin } = require('../firebaseInitialise');

exports.sendTestNotification = catchAsync(async (req, res, next) => {
  //   const notification = {
  //     from: req.user.id,
  //     to: req.body.to,
  //     body: req.body.message,
  //     notify: req.body.notify,
  //   };
  //   sendNotification(notification, 200, 'Sent', res);
  try {
    //   Promise.all(
    //     notifications.map(async (notification) => {
    //       notification.topic = details.topic;
    //       const response = await admin.messaging().send(notification);
    //       console.log('RESPONSE FROM FIREBASE: ', response);
    //     }),
    //   );
    const test = {
      notification: {
        title: 'New quiz available!',
        body: 'Hey everyone, join us, come fast!!!',
      },
      topic: 'all_users',
    };

    // const notificationData = {
    //   title: 'New quiz available!',
    //   body: 'Hey everyone, join us, come fast!!!',
    //   topic: 'all_users',
    //   sentAt: admin.firestore.FieldValue.serverTimestamp(),
    // };
    const response = await admin.messaging().send(test);

    // const docRef = await firebaseDB
    //   .collection('notification')
    //   .add(notificationData);
    // console.log('Notofocation saved to firestore with id : ', docRef.id);

    res.status(200).json({
      status: 'success',
      response,
      // firestoreId: docRef.id,
    });
  } catch (error) {
    console.log('ERROR FROM FIREBASE!', error);
    res.status(500).json({
      status: 'failure',
      data: {
        message: 'Failed to upload new notification fon firebase!',
      },
    });
  }
});

exports.backgroundNotificationHandler = async (heading, body, topic, image) => {
  try {
    const appNotification = {
      notification: {
        title: heading,
        body,
        image,
      },
      topic,
    };
    const response = await admin.messaging().send(test);
  } catch (error) {
    console.log('ERROR FROM FIREBASE!', error);
  }
};
