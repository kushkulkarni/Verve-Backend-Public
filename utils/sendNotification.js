const client = require('../redisClient');
const Notification = require('./../models/notifications');
const admin = require('firebase-admin');

const sendNotification = async (details, statusCode, message, res) => {
  const users = Array.isArray(details.to) ? details.to : [details.to];

  const pipeline = client.multi();

  users.forEach((userId) => {
    pipeline.del(`notifications:${userId}`);
  });

  await pipeline.exec();

  const notifications = users.map((userId) => ({
    from: details.from,
    heading: details.heading,
    body: details.body,
    postedOn: Date.now(),
    to: userId,
  }));

  await Notification.insertMany(notifications);

  try {
    //   Promise.all(
    //     notifications.map(async (notification) => {
    //       notification.topic = details.topic;
    //       const response = await admin.messaging().send(notification);
    //       console.log('RESPONSE FROM FIREBASE: ', response);
    //     }),
    //   );
    // const test = {
    //   title: 'New quiz available!',
    //   body: 'Hey everyone, join us, come fast!!!',
    //   topic: 'all_users',
    // };

    // const response = await admin.messaging().send(test);

    res.status(statusCode).json({
      status: 'success',
      data: {
        message,
      },
    });
  } catch (error) {
    // console.log('ERROR FROM FIREBASE!', error);
    res.status(500).json({
      status: 'failure',
      data: {
        message: 'Failed to upload new notification fon firebase!',
      },
    });
  }
};

module.exports = sendNotification;
