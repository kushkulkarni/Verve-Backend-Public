const mongoose = require('mongoose');
const validator = require('validator');

const eventSchema = new mongoose.Schema(
  {
    eventHeading: {
      type: String,
      maxlength: [50, 'The Heading must be less than 50 characters'],
      minlength: [5, 'The Heading must have greater than 5 characters'],
      trim: true,
      required: [true, 'The event announcement must have a heading'],
    },

    eventBody: {
      type: String,
      maxlength: [700, 'The Heading must be less than 700 characters'],
      minlength: [10, 'The Heading must have greater than 10 characters'],
      trim: true,
      required: [true, 'The event announcement must have body'],
    },

    eventLink: {
      type: String,
      trim: true,
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
          photoWidth: {
            type: Number,
          },
          photoHeight: {
            type: Number,
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

    eventDate: {
      type: Date,
      required: [true, 'event date must be specified in yyyy-mm-dd format'],
      // index: { expires: 86400 }, // 24 hrs = 86400 seconds
    },

    clubId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Club',
      required: true,
    },

    eventType: {
      type: String,
      lowercase: true,
      enum: ['internal', 'external'],
      required: [
        true,
        "The type of event must be specified whether it is 'external' or 'internal' ",
      ],
    },
  },
  { timestamps: true },
);

const Event = mongoose.model('Event', eventSchema);
module.exports = Event;
