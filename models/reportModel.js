const mongoose = require('mongoose');

const reportSchema = new mongoose.Schema(
  {
    reportedPostId: {
      type: mongoose.Schema.ObjectId,
      ref: 'postModel',
      required: true,
    },

    postModel: {
      type: String,
      required: true,
      enum: ['Achievements', 'Anonymous'],
    },

    reportedBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User',
      required: true,
    },

    category: {
      type: String,
      enum: [
        'sexual harrasment',
        'voilence or hate',
        'false information',
        'harrasment',
        'spam',
        'trying to be someone else',
        'suicidal or self harm',
        'other',
      ],
      required: [true, 'category of the report must be specified'],
    },

    reportStatus: {
      type: String,
      enum: ['pending', 'reviewed'],
      default: 'pending',
      required: [true, 'status must be specifed'],
    },
  },
  { timestamps: true },
);

reportSchema.index(
  { reportedBy: 1, reportedPostId: 1, postModel: 1 },
  { unique: true },
);

const Report = mongoose.model('Report', reportSchema);
module.exports = Report;
