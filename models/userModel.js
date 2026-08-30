const mongoose = require('mongoose');
const validator = require('validator');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: {
    type: String,
    trim: true,
    required: [true, 'Name cannot be empty. User must have a name!'],
  },
  username: {
    type: String,
    required: [true, 'Username cannot be empty. User must have a username!'],
    trim: true,
    lowercase: true,
    minlength: 3,
    maxlength: 15,
  },
  skills: [
    {
      type: String,
    },
  ],
  openTo: {
    type: Boolean,
    default: false,
  },
  college: {
    type: String,
    required: false,
  },
  verifiedGuide: {
    type: Boolean,
    default: function () {
      return this.doubtsSolved > 30 && this.aura > 1000 && this.openTo;
    },
  },
  doubtsSolved: {
    type: Number,
    default: 0,
  },
  bio: {
    type: String,
    trim: true,
    // minLength: 10,
    maxlength: 200,
    default: undefined,
  },
  profilePicture_HighRes: {
    type: String,
    trim: true,
  },
  profilePictureId_HighRes: {
    type: String,
    trim: true,
  },
  profilePicture_LowRes: {
    type: String,
    trim: true,
  },
  profilePictureId_LowRes: {
    type: String,
    trim: true,
  },
  aura: {
    type: Number,
    default: function () {
      switch (this.post) {
        case 'club_volunteer':
          return 100;
        case 'club_coordinator':
          return 150;
        case 'club_secretary':
          return 200;
        case 'club_president':
          return 300;
        case 'none':
          return 50;
        default:
          return 50;
      }
    },
  },
  email: {
    type: String,
    required: [true, 'Email cannot be empty. User must have an email!'],
    trim: true,
    // unique: true,
    lowercase: true,
    validate: [validator.isEmail, 'Plaese provide a valid email'],
  },
  verificationEmail: {
    type: String,
    required: [true, 'User needs to verify Account before signUp!'],
    // unique: true,
    lowercase: true,
    validate: [validator.isEmail, 'Please provide a valid email!'],
  },

  role: {
    type: String,
    required: [true, 'User has to have a role.'],
    enum: ['student', 'admin', 'super-admin'],
    default: 'student',
  },
  club_position: [
    {
      club: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Club',
      },
      position: {
        type: String,
        enum: [
          'club_president',
          'club_coreMember',
          'club_chairperson',
          'club_secretary',
          'club_coordinator',
          'club_volunteer',
          'none',
        ],
        default: 'none',
        required: [true, 'A user must have a role'],
      },
    },
  ],
  password: {
    type: String,
    required: [true, 'Password cannot be empty. User must have a password!'],
    minLength: 8,
    select: false,
  },
  passwordConfirm: {
    type: String,
    required: [true, 'Please confirm your password'],
    validate: {
      validator: function (pass) {
        return pass === this.password;
      },
      message: 'Passwords are not the same',
    },
  },
  // likedAnonymousPosts: [
  //   {
  //     type: mongoose.Schema.Types.ObjectId,  ///////////////////// No need for this. To check if user has liked it, check chatgpt answer for this!
  //     ref: 'User',
  //   },
  // ],
  verifyStudentOTP: {
    type: Number,
  },
  userCreatedOn: {
    type: Date,
    default: Date.now(),
  },

  // startedDoubts: [
  //   {
  //     person: {
  //       type: mongoose.Schema.Types.ObjectId,
  //       ref: 'User',
  //     },
  //     chat: {
  //       type: mongoose.Schema.Types.ObjectId,
  //       ref: 'Chat',
  //     },
  //     chatToken: String,
  //     expiresOn: Date,
  //   },
  // ],
  pendingReviews: [
    {
      userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
      },
      guide: {
        _id: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'User',
        },
        chatId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: 'Chat',
        },
        name: String,
        photo: String,
      },
    },
  ],
  active: {
    type: Boolean,
    default: true,
  },
  ///////////////////// !!! UPDATE !!! UPDATED TO STORE FCM TOKENS OF DEVICES WHERE USER IS LOGGED IN!
  fcmTokens: {
    type: [String],
    default: [],
  },
  blockedUsers: {
    type: [mongoose.Schema.Types.ObjectId],
    ref: 'User',
    default: [],
  },
  passwordChangedAt: Date,
  passwordResetToken: String,
  passwordResetExpires: Date,
});

userSchema.pre('save', async function (next) {
  // Only run this function if the password was actually modified
  if (!this.isModified('password')) return next();

  //Hash the password with cost of 12
  this.password = await bcrypt.hash(this.password, 12);

  // Delet passwordConfirm field
  this.passwordConfirm = undefined;
  next();
});

userSchema.pre('save', function (next) {
  if (!this.isModified('password') || this.isNew) return next();

  this.passwordChangedAt = Date.now() - 1000;
  next();
});

userSchema.methods.correctPassword = async function (
  candidatePassword,
  userPassword,
) {
  return await bcrypt.compare(candidatePassword, userPassword);
};

userSchema.methods.changedPasswordAfter = function (JWTTimestamp) {
  if (this.passwordChangedAt) {
    const changedTimestamp = parseInt(
      this.passwordChangedAt.getTime() / 1000,
      10,
    );
    return JWTTimestamp < changedTimestamp;
  }

  return false;
};

userSchema.methods.createPasswordResetToken = function () {
  const resetToken = crypto.randomBytes(32).toString('hex');

  this.passwordResetToken = crypto
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  // console.log({ resetToken }, this.passwordResetToken);

  this.passwordResetExpires = Date.now() + 10 * 60 * 1000;

  return resetToken;
};

userSchema.index(
  { username: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);

userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);

userSchema.index(
  { verificationEmail: 1 },
  { unique: true, partialFilterExpression: { active: true } },
);

userSchema.index(
  { name: 'text', skills: 'text' },
  {
    weights: { name: 5, skills: 20 },
    partialFilterExpression: { active: true },
    background: true,
  },
);

/////////////////////////////// !!! UPDATE !!! ADDED TWO MORE INDEXES HERE FOR $regex: searching...
userSchema.index({ name: 1 });
userSchema.index({ skills: 1 });

const User = mongoose.model('User', userSchema);
module.exports = User;
