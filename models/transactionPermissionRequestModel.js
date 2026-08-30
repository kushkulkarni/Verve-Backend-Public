const mongoose = require('mongoose');

const requestTransactionSchema = new mongoose.Schema(
  {
    // This draft ID shall point only to the first version of this draft and not its subsequent previous one!
    draftId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    draftVersion: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'rejected', 'approved'],
      default: 'pending',
    },
    requestedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    requestedTo: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    items: [
      {
        item: mongoose.Schema.Types.ObjectId,
      },
    ],
  },
  {
    timestamps: true,
  },
);

const TransactionRequests = mongoose.model(
  'TransactionRequests',
  requestTransactionSchema,
);

module.exports = TransactionRequests;
