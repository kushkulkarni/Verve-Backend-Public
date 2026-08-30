const mongoose = require('mongoose');
const { type } = require('os');
const validator = require('validator');

const anonymousSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    select: false,
    required: [true, 'A post must have a hosting user!'],
  },
  photo: {
    type: String,
    trim: true,
  },
  photoId: {
    type: String,
    trim: true,
  },
  photoWidth: {
    type: Number,
  },
  photoHeight: {
    type: Number,
  },
  message: {
    type: String,
    trim: true,
    maxlength: 5000,
    required: [true, 'Message cannot be empty!'],
  },
  postedOn: {
    type: Date,
    default: () => new Date().toISOString(),
  },
  //// STORING LIKES COUNT IN REDIS
  // likes: {
  //   type: Number,
  //   default: 0,
  // },
  image_embedding: {
    type: [Number], // array of floats
    default: null,
  },
  text_embedding: {
    type: [Number], // array of floats
    default: null,
  },
  comments: {
    type: Number,
    min: [0, 'Comments must be non-negative'],
    default: 0,
  },
});

anonymousSchema.pre('validate', function (next) {
  const hasPhoto = !!this.photo?.trim();
  const hasMessage = !!this.message?.trim();
  if (!hasPhoto && !hasMessage) {
    this.invalidate('photo', 'Either photo or message is required.');
    this.invalidate('message', 'Either photo or message is required.');
  }
  next();
});

const Anonymous = mongoose.model('Anonymous', anonymousSchema);
module.exports = Anonymous;
