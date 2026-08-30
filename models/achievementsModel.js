const mongoose = require('mongoose');
const validator = require('validator');

const achievementsSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
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
  //// STORING LIKES COUNT IN REDIS
  // likes: {
  //   type: Number,
  //   min: [0, 'Likes must be non-negative'],
  //   default: 0,
  // },
  postedOn: {
    type: Date,
    default: () => new Date().toISOString(),
  },
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

achievementsSchema.pre('validate', function (next) {
  const hasPhoto = !!this.photo?.trim();
  const hasMessage = !!this.message?.trim();
  if (!hasPhoto && !hasMessage) {
    this.invalidate('photo', 'Either photo or message is required.');
    this.invalidate('message', 'Either photo or message is required.');
  }
  next();
});

const Achievements = mongoose.model('Achievements', achievementsSchema);
module.exports = Achievements;
