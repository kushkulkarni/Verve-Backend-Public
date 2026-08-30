const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema(
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

    performedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    subPerformer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },

    items: [
      {
        itemId: {
          type: mongoose.Schema.Types.ObjectId,
          required: true,
        },

        itemName: {
          type: String,
          required: true,
        },

        quantity: {
          type: Number,
          required: true,
          min: 1,
        },

        expectedUnitPrice: {
          type: Number,
          required: true,
          min: 0,
        },

        expectedAmount: {
          type: Number,
          required: true,
          min: 0,
        },
      },
    ],

    expectedTotal: {
      type: Number,
      required: true,
      min: 0,
    },

    paidTotal: {
      type: Number,
      required: true,
      min: 0,
    },

    receiptUrl: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

const Transactions = mongoose.model('Transactions', transactionSchema);

module.exports = Transactions;
