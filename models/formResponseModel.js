const mongoose = require('mongoose');
const Form = require('./formModel');

const formResponseSchema = new mongoose.Schema({
  club: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Club',
    required: true,
  },
  recruitmentCycle: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RecruitmentCycle',
  },

  form: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Form',
    required: true,
  },
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },
  answers: [
    {
      questionId: {
        type: mongoose.Schema.Types.ObjectId,
        required: true,
      },
      answer: mongoose.Schema.Types.Mixed,
    },
  ],
  // shortlisted: {
  //   type: Boolean, //////////////////////// updated this with better version ahead! ////////////////////////
  //   default: false,
  // },
  submittedAt: {
    type: Date,
    default: Date.now,
  },
  isLocked: { type: Boolean, default: false },
  stage: {
    type: String,
    enum: ['applied', 'exam', 'interview', 'finalized'], ////////////// update this after every round //////////////////
    default: 'applied',
  },
  status: {
    type: String,
    enum: ['pending', 'shortlisted', 'rejected', 'selected'], ////////////// update this after every round //////////////////
    default: 'pending',
  },
  remarks: String, ////////////////////////////// for server side working, if any remarks are required for any student who has been selected. (student wont fill this! Not on frontend for student form fill!) ////////////////////////////////
});

formResponseSchema.index({ form: 1 });

const FormResponse = mongoose.model('FormResponse', formResponseSchema);
module.exports = FormResponse;
