const { Queue, Worker } = require('bullmq');
const IORedis = require('ioredis');
const User = require('../models/userModel');
const { deleteChatFromSockets } = require('../utils/socket');
const { io } = require('../server');
const catchAsync = require('../utils/catchAsync');
const mongoose = require('mongoose');
const Chat = require('./../models/chatModel');
const cloudinary = require('cloudinary').v2;
const Event = require('./../models/eventModel');
// require('dotenv').config({ path: './config.env' });

// Redis connection
const connection = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
});

// Create a queue
const reviewQueue = new Queue('reviewQueue', { connection });

// // Scheduler (needed for delayed jobs!)
// new QueueScheduler('reviewQueue', { connection });   /////////////////// No More required foe newer versions > 5.0

const worker = new Worker(
  'reviewQueue',
  catchAsync(async (job) => {
    // console.log(`Processing job ${job.id}...`, job.data);

    const { userId, guide } = job.data;
    let session;
    try {
      session = await mongoose.startSession();
      session.startTransaction();
      await User.findByIdAndUpdate(
        userId,
        {
          // add pending reviews
          $addToSet: { pendingReviews: { userId, guide } },
        },
        { session },
      );
      await Chat.findByIdAndUpdate(
        guide.chatId,
        {
          status: 'ended',
        },
        { session },
      );
      await session.commitTransaction();
    } catch (err) {
      if (session) await session.abortTransaction();
      // console.log('Transaction aborted:', err);
      throw err;
    } finally {
      if (session) await session.endSession();
    }

    deleteChatFromSockets(guide.chatId, io);
  }),

  { connection },
);

/* here guide is: guide: {
      _id: guide._id,
      name: guide.name,
      photo: guide.photo,
    },
*/

// Create a queue
const eventQueue = new Queue('eventQueue', { connection });

const eventWorker = new Worker(
  'eventQueue',
  async (job) => {
    // console.log(`Processing event deletion job ${job.id}`);

    const { eventId } = job.data;

    const event = await Event.findById(eventId);
    // console.log('deleting event: ', event);
    // console.log(
    //   'PhotoIDs of this event are: ',
    //   event.photos.map((p) => p.photoID),
    // );

    if (!event) {
      // console.log('Event already deleted');
      return;
    }

    try {
      // delete images from cloudinary
      if (event.photos && event.photos.length > 0) {
        await cloudinary.api.delete_resources(
          event.photos.map((p) => p.photoID),
        );
      }

      // delete event from DB
      await Event.findByIdAndDelete(eventId);

      // console.log(`Event ${eventId} deleted successfully`);
    } catch (err) {
      // console.error('Event deletion failed:', err);
      throw err; // retry mechanism
    }
  },
  { connection },
);

module.exports = { reviewQueue, eventQueue };
