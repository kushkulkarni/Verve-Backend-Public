const mongoose = require('mongoose');
const validator = require('validator');

const newsSchema = new mongoose.Schema(
  {
    newsHeading: {
      type: String,
      maxlength: [50, 'The Heading must be less than 50 characters'],
      minlength: [5, 'The Heading must have greater than 5 characters'],
      trim: true,
      required: [true, 'The event news must have a heading'],
    },

    newsBody: {
      type: String,
      maxlength: [700, 'The Heading must be less than 700 characters'],
      minlength: [10, 'The Heading must have greater than 10 characters'],
      trim: true,
      required: [true, 'The event news must have body'],
    },

    photos: {
      type: [
        {
          photoID: {
            type: String,
            trim: true,
          },
          photoURL: {
            type: String,
            trim: true,
          },
        },
      ],

      validate: {
        validator: function (val) {
          return val.length <= 3;
        },
        message: 'Maximum 3 photos allowed per event',
      },
    },

    newsDate: {
      type: Date,
      required: [true, 'news date must be specified in yyyy-mm-dd format'],
    },

    clubID: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Club',
      required: true,
    },
  },
  { timestamps: true },
);

newsSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 }); // 24 hrs = 86400 seconds.

const News = mongoose.model('News', newsSchema);
module.exports = News;
