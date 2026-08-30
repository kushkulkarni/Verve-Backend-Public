const mongoose = require('mongoose');
const validator = require('validator');

const likesSchema = new mongoose.Schema({
  post: {
    type: mongoose.Schema.Types.ObjectId,
    refPath: 'postModel',
  },
  postModel: {
    type: String,
    required: true,
    enum: ['Achievements', 'Anonymous'],
  },
  likedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
});

likesSchema.index({ likedBy: 1, post: 1 }, { unique: true });
likesSchema.index({ post: 1 });

const Like = mongoose.model('Like', likesSchema);
module.exports = Like;
