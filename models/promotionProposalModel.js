const mongoose = require('mongoose');

const promotionProposalSchema = new mongoose.Schema({
  club: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Club',
    required: true,
  },
  proposedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  proposedMembers: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  ],
  targetRole: {
    type: String,
    enum: ['club_secretary', 'club_coreMember', 'club_president'],
    required: true,
  },
  votes: [
    {
      votedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      vote: { type: String, enum: ['yes', 'no'] },
      votedAt: { type: Date, default: Date.now },
    },
  ],
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date }, // optional, for timeout
});

const PromotionProposal = mongoose.model(
  'PromotionProposal',
  promotionProposalSchema,
);

module.exports = PromotionProposal;
