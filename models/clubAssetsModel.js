const mongoose = require('mongoose');

const assetsSchema = new mongoose.Schema(
  {
    ownerClubId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Club',
      required: [true, 'Asset initially must belong to club!'],
    },
    assetName: {
      type: String,
      required: [true, 'Asset must have a name'],
    },
    eventDraftVersionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'EventDraftVersion',
      required: [
        true,
        `Asset must belong to a draft to keep a track of asset's creation.`,
      ],
    },
    rentedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Club',
      required: false,
      default: null,
    },
    ownershipHistory: [
      {
        clubId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Club',
          required: [
            true,
            `Please provide club ID of club requested for asset rent.`,
          ],
        },
        rentedOn: Date,
        rentExpiresOn: {
          type: Date,
          required: [true, 'Asset rent expiration should be specified!'],
        },
      },
    ],
  },
  { timestamps: true },
);
