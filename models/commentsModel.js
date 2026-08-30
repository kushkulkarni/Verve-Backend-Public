const mongoose = require('mongoose');
const validator = require('validator');

const commentsSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  comment: {
    type: String,
    required: [true, 'A comment cannot be blank!'],
    trim: true,
  },
  post: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
    refPath: 'postModel',
  },
  postModel: {
    type: String,
    required: true,
    enum: ['Achievements', 'Anonymous'],
  },
  postedOn: {
    type: Date,
    default: () => new Date().toISOString(),
  },
});

const Comments = mongoose.model('Comments', commentsSchema);
module.exports = Comments;
