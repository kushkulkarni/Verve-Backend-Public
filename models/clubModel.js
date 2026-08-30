const mongoose = require('mongoose');

const clubSchema = new mongoose.Schema(
  {
    clubName: {
      type: String,
      trim: true,
      minLength: 3,
      maxLength: 50,
      required: [true, 'A club must have a name!'],
    },
    clubType: {
      type: String,
      enum: ['Technical', 'Cultural', 'Sports', 'Social', 'Other'],
      required: true,
    },
    clubDescription: {
      type: String,
      trim: true,
      minLength: 20,
      maxLength: 500,
      required: [true, 'Club must have a description!'],
    },
    collegeName: {
      type: String,
      enum: ['VIT', 'COEP', 'PICT', 'MIT', 'PCCOE', 'AISSMS', 'DYP'],
      required: [true, 'A club should belong to a college!'],
    },
    coreTeam: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'A Club must have a core team.'],
      },
    ],
    promotionProposals: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'PromotionProposal',
      },
    ],
    clubPresident: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'A Club must have a President.'],
      },
    ],
    clubFacultyCoordinator: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        // required: [true, 'A Club must have a faculty coordinator.'],
      },
    ],
    // recruitmentCycles: [
    //   { type: mongoose.Schema.Types.ObjectId, ref: 'RecruitmentCycle' },
    // ],
    currentMembers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    // pastMembers: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
  },
  {
    timestamps: true,
  },
);

clubSchema.index({ clubName: 1, collegeName: 1 }, { unique: true });

const Club = mongoose.model('Club', clubSchema);
module.exports = Club;
