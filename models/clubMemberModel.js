const mongoose = require('mongoose');
const Club = require('./clubModel');

const clubMemberSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  club: { type: mongoose.Schema.Types.ObjectId, ref: 'Club' },
  position: {
    type: String,
    enum: [
      'club_volunteer',
      'club_coordinator',
      'club_secretary',
      'club_chairperson',
      'club_vice_president',
      'club_president',
    ],
    required: true,
  },
  joinedOn: { type: Date, default: Date.now },
  leftOn: Date,
  exitReason: String,
  status: { type: String, enum: ['active', 'inactive'], default: 'active' },
});

const ClubMember = mongoose.model('ClubMember', clubMemberSchema);
module.exports = ClubMember;
