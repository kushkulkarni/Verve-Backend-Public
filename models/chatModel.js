const mongoose = require('mongoose');

const conversationSchema = new mongoose.Schema(
  {
    guide: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    doubtUser: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
    lastMessage: {
      text: String,
      sender: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      status: {
        type: String,
        enum: ['sent', 'delivered', 'read'],
      },
      createdAt: Date,
      deleted: {
        type: Boolean,
        default: false,
      },
    },

    unreadCounts: {
      guide: { type: Number, default: 0 },
      doubtUser: { type: Number, default: 0 },
    },
    status: {
      type: String,
      enum: ['started', 'ended'],
      default: 'started',
    },
    token: String,
  },
  { timestamps: true },
);

conversationSchema.pre('save', function (next) {
  if (this.isModified('lastMessage.text') && this.lastMessage?.text) {
    this.lastMessage.text = encrypt(this.lastMessage.text);
  }
  next();
});

conversationSchema.index({ doubtUser: 1, updatedAt: -1 });
conversationSchema.index({ guide: 1, updatedAt: -1 });

module.exports = mongoose.model('Chat', conversationSchema);
