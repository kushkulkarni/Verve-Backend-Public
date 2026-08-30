const mongoose = require('mongoose');

const clubCreationRequestSchema = new mongoose.Schema({
  requestedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  clubName: {
    type: String,
    required: [true, 'A club must have a name'],
    unique: true,
    trim: true,
  },
  clubDescription: {
    type: String,
    required: [true, 'A club must have a description'],
  },
  clubType: {
    type: String,
    enum: ['Technical', 'Cultural', 'Sports', 'Social', 'Other'],
    required: true,
  },
  proposedPresident: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  proposedCoreTeam: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
    },
  ],
  reasonForCreation: {
    type: String,
    required: [true, 'A reason for creating the club is required'],
  },
  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending',
  },
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User', // Admin (Dean)
  },
  reviewedAt: Date,
  rejectionReason: String,
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

const ClubCreationRequest = mongoose.model(
  'ClubCreationRequest',
  clubCreationRequestSchema,
);

module.exports = ClubCreationRequest;
