const mongoose = require('mongoose');
const validator = require('validator');

const notificationSchema = new mongoose.Schema({
  from: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'There must be a sender for a notification!'],
  },
  heading: {
    type: String,
    trim: true,
    required: [true, 'Notification should have a heading.'],
  },
  body: {
    type: String,
    trim: true,
    minLength: 20,
    maxLength: 500,
    required: [true, 'Notification has to have a body.'],
  },
  postedOn: {
    type: Date,
    default: Date.now,
  },
  to: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'There must be a reciever for a notification!'],
  },
  action: {
    type: Object,
    default: {},
  },
});

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = Notification;
// (icon) Heading
//        Notification
