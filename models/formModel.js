const mongoose = require('mongoose');

const formSchema = new mongoose.Schema(
  {
    title: String,
    description: String,
    club: { type: mongoose.Schema.Types.ObjectId, ref: 'Club' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    questions: [
      {
        questionText: String,
        questionType: {
          type: String,
          enum: [
            'shortText',
            'paragraph',
            'mcq',
            'checkbox',
            'dropdown',
            'file',
          ],
          default: 'shortText',
        },
        options: [String],
        required: Boolean,
      },
    ],
    deadline: { type: Date, required: false },
    isLocked: { type: Boolean, default: false },
    createdAt: { type: Date, default: Date.now },
    isArchived: { type: Boolean, default: false },

    formType: {
      type: String,
      enum: ['recruitment', 'feedback', 'event'],
      default: 'recruitment',
    },
  },

  { timestamps: true }
);

const Form = mongoose.model('Form', formSchema);
module.exports = Form;
