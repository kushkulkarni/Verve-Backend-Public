const mongoose = require('mongoose');

const recruitmentCycleSchema = new mongoose.Schema({
  club: { type: mongoose.Schema.Types.ObjectId, ref: 'Club' },
  academicYear: String,
  form: { type: mongoose.Schema.Types.ObjectId, ref: 'Form' },
  status: {
    type: String,
    enum: ['form_open', 'exam', 'interview', 'finalized'],
    default: 'form_open',
  },
  ////////////////////////////// !!! UPDATE !!! MADE CHANGE HERE BY VALIDATING EVERY ELEMENT IN THE ARRAY AND NOT WHOLE ARRAY!!!
  selectedStages: {
    type: [
      {
        type: String,
        enum: ['form_open', 'exam', 'interview', 'finalized'],
      },
    ],
    required: [true, 'A recruitment must have stages!'],
    validate: {
      validator: function (arr) {
        return arr.length === new Set(arr).size;
      },
      message: 'Stages must be unique',
    },
  },
  selectedMembers: [
    { type: mongoose.Schema.Types.ObjectId, ref: 'ClubMember' },
  ],
  createdAt: { type: Date, default: Date.now },
});

const RecruitmentCycle = mongoose.model(
  'RecruitmentCycle',
  recruitmentCycleSchema,
);
module.exports = RecruitmentCycle;
