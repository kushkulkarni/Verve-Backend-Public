const mongoose = require('mongoose');

const eventDraftVersionSchema = new mongoose.Schema(
  {
    // Identifies the logical draft.
    // This is NOT a reference to an EventDraft collection.
    draftId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
    },

    // Version number of this draft.
    version: {
      type: Number,
      required: true,
      default: 1,
    },

    // User who created this version.
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    // Pipeline state of this version.
    status: {
      type: String,
      enum: ['pending', 'rejected', 'discussion', 'approved', 'granted'],
      required: true,
      default: 'pending',
    },

    // Complete draft at THIS version.
    items: [
      {
        itemId: {
          type: mongoose.Schema.Types.ObjectId,
          default: () => new mongoose.Types.ObjectId(),
        },

        itemName: {
          type: String,
          required: true,
        },

        itemQuantity: {
          type: Number,
          default: 1,
        },

        itemPrice: {
          type: Number,
          required: true,
        },

        asset: {
          type: Boolean,
          default: false,
        },
      },
    ],

    // Complete draft at the PREVIOUS version.
    // Null for Version 1.
    snapshot: {
      status: {
        type: String,
        enum: ['pending', 'rejected', 'discussion', 'approved'],
      },

      items: [
        {
          itemId: mongoose.Schema.Types.ObjectId,
          itemName: String,
          itemQuantity: Number,
          itemPrice: Number,
          asset: Boolean,
        },
      ],
    },
  },
  { timestamps: true },
);

// A logical draft cannot have duplicate version numbers.
eventDraftVersionSchema.index({ draftId: 1, version: 1 }, { unique: true });

// Check if the draft ID is provided, if not then assign the draft ID with the current _id only:
eventDraftVersionSchema.pre('validate', function (next) {
  if (!this.draftId) {
    this.draftId = this._id;
  }
  next();
});

const EventDraftVersion = mongoose.model(
  'EventDraftVersion',
  eventDraftVersionSchema,
);

module.exports = EventDraftVersion;
