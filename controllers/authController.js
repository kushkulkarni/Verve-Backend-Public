const crypto = require('crypto');
const { promisify } = require('util');
const jwt = require('jsonwebtoken');
const User = require('./../models/userModel');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/appError');
const sendEmail = require('./../utils/email');
const { token } = require('morgan');
const client = require('../redisClient');
const cloudinary = require('cloudinary').v2;
const mongoose = require('mongoose');
const { default: isEmail } = require('validator/lib/isEmail');
const { userSocketMap } = require('../utils/socketTracker');
const { getIO } = require('../utils/socketInstance');
const Achievements = require('../models/achievementsModel');
const { sendMail } = require('../utils/sendMail');
const uuidv4 = require('uuid').v4;

// user enters email and clicks send OTP -> user recieves OTP and enters it -> user goes to signup page;
// user enters email and presses send OTP. -> he recieves OTP and enters the OTP along with all other details and clicks signup
// user enters otp and berifies it. -> OTP:email (redis), marked as verified -> signup page -> after signup, the email will be checked in the redis if it is verified

const signToken = (payload) => {
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN,
  });
};

const createSendToken = async (user, statusCode, res, req) => {
  // if user on other device logged in, and online, force logout that user through sockets.
  const existingSocketId = userSocketMap.get(String(user._id));
  // console.log('MAP KEYS:', [...userSocketMap.keys()]);
  // console.log('LOOKING FOR:', user._id, typeof user._id);
  // console.log('EXISTING SOCKET ID FOUND: ', existingSocketId);
  const io = getIO();

  if (existingSocketId) {
    // console.log(' Existing session found → forcing logout');

    io.to(existingSocketId).emit('forceLogout', {
      reason: 'Logged in on another device',
    });
  }

  const sessionId = uuidv4();

  await User.findByIdAndUpdate(user._id, { fcmTokens: [] });

  // store session in Redis
  await client.set(`session:${String(user._id)}`, sessionId, {
    EX: 90 * 24 * 60 * 60, // 90 days
  });

  const token = signToken({ id: user._id, sessionId });
  const cookieOptions = {
    expires: new Date(
      Date.now() + process.env.JWT_COOKIE_EXPIRES_IN * 24 * 60 * 60 * 1000,
    ),
    httpOnly: true,
    secure: false,
    sameSite: 'lax',
  };
  if (process.env.NODE_ENV === 'production') {
    cookieOptions.secure = true;
    cookieOptions.sameSite = 'none';
  }

  // if (req.headers['user-agent']?.includes('Mozilla')) {
  res.cookie('jwt', token, cookieOptions);
  // console.log('Cookie sent for web');
  // }

  user.password = undefined;

  res.status(statusCode).json({
    status: 'success',
    token,
    data: {
      user,
    },
  });
};

exports.sendVerificationMail = catchAsync(async (req, res, next) => {
  // console.log(req.body.verificationEmail);
  const currVerificationEmail = req.body.verificationEmail;
  if (!currVerificationEmail) {
    return next(
      new AppError('Please provide your student email for verification!', 400),
    );
  }

  if (!/^[a-zA-Z0-9._%+-]+@vit\.edu$/.test(currVerificationEmail))
    return next(new AppError('Use a valid @vit.edu email', 400));

  const sentOTP = Math.floor(100000 + Math.random() * 900000); // 6 digit
  await sendMail({
    recipient: currVerificationEmail,
    subject: `Your OTP verify token (valid for 15 min)`,
    name: 'User',
    message: `Your OTP is ${sentOTP}`,
  });

  const cacheData = {
    email: currVerificationEmail,
    OTP: `${sentOTP}`,
    savedAt: Date.now(),
  };

  const cached = await client.setEx(
    `otp:${currVerificationEmail}`,
    900,
    JSON.stringify(cacheData),
  );

  // console.log('OTP sent. OTP is ', sentOTP);

  res.status(200).json({
    status: 'success',
    data: {
      message: 'OTP Sent!',
    },
  });
});

exports.verifyStudentEmail = catchAsync(async (req, res, next) => {
  // console.log('🔍 req.headers["content-type"]:', req.headers['content-type']);
  // console.log('🔍 req.body before multer:', req.body);
  // console.log('req.file: ', req.file);

  const currOTP = req.body.verifyStudentOTP;
  const currVerificationEmail = req.body.verificationEmail;

  if (!currOTP || !currVerificationEmail) {
    return next(
      new AppError('Please provide the OTP and the verification email!', 400),
    );
  }

  const cacheData = await client.get(`otp:${currVerificationEmail}`);
  let cachedOTP;
  if (cacheData) cachedOTP = JSON.parse(cacheData).OTP;
  // console.log('Cached OTP is: ', cachedOTP);

  if (!cachedOTP || cachedOTP !== currOTP) {
    return next(new AppError('Wrong OTP! Please check your OTP again!', 401));
  }
  // console.log('OTP: ', currOTP, ' Email: ', currVerificationEmail);
  // req.body.verifiedEmail = currVerificationEmail;
  await client.set(`${currVerificationEmail}:verified`, true.toString());

  // req.fileForCloud = req.file; // keep reference
  res.status(200).json({
    status: 'success',
    data: {
      currVerificationEmail,
    },
  });
  // res.status(200).json({
  //   status: 'success',
  //   data: {
  //     verfiedEmail: currVerificationEmail,
  //   },
  // });
});

exports.signup = catchAsync(async (req, res, next) => {
  // console.log('entered signup endpoint!!!');
  const { name, email, username, verifiedEmail, password, passwordConfirm } =
    req.body;

  const isEmailVerified = await client.get(
    `${req.body.verifiedEmail}:verified`,
  );
  if (!isEmailVerified) {
    return next(new AppError('Please verify your email first!', 401));
  }
  let highDefUrl = '';
  let highDefId = '';
  let lowDefUrl = '';
  let lowDefId = '';

  if (typeof req.body.skills === 'string') {
    try {
      req.body.skills = JSON.parse(req.body.skills);
    } catch (e) {
      req.body.skills = [req.body.skills];
    }
  }
  // console.log('req.body:', req.body);
  // console.log('req.file:', req.file);

  // 1) Create user first (validators run here)

  const newUser = await User.create({
    name: req.body.name,
    email: req.body.email,
    username: req.body.username,
    password: req.body.password,
    passwordConfirm: req.body.passwordConfirm,
    verificationEmail: req.body.verifiedEmail,
    skills: req.body.skills,
    profilePicture_HighRes: highDefUrl,
    profilePictureId_HighRes: highDefId,
    profilePicture_LowRes: lowDefUrl,
    profilePictureId_LowRes: lowDefId,
  });

  // 2) Upload images only after user creation
  if (req.file) {
    const base64String = `data:${
      req.file.mimetype
    };base64,${req.file.buffer.toString('base64')}`;

    // Upload high-res
    const highRes = await cloudinary.uploader.upload(base64String, {
      folder: 'verve_uploads/profile_photos/highres',
      transformation: [{ width: 800, height: 800, crop: 'limit' }],
    });

    // Upload low-res
    const lowRes = await cloudinary.uploader.upload(base64String, {
      folder: 'verve_uploads/profile_photos/lowres',
      transformation: [
        { width: 100, height: 100, crop: 'fill', quality: 'auto:low' },
      ],
    });

    highDefUrl = highRes.secure_url;
    highDefId = highRes.public_id;
    lowDefUrl = lowRes.secure_url;
    lowDefId = lowRes.public_id;

    // 3) Update the instance and save
    newUser.profilePicture_HighRes = highDefUrl;
    newUser.profilePictureId_HighRes = highDefId;
    newUser.profilePicture_LowRes = lowDefUrl;
    newUser.profilePictureId_LowRes = lowDefId;

    await newUser.save({ validateBeforeSave: false }); // validation already done on create
  }

  // cache in redis
  if (highDefUrl && lowDefUrl) {
    await client.hSet(`userpfp-highDef:${newUser._id}`, {
      pfpUrl: highDefUrl,
      pfpId: highDefId,
    });
    await client.hSet(`userpfp-lowDef:${newUser._id}`, {
      pfpUrl: lowDefUrl,
      pfpId: lowDefId,
    });

    await client.expire(`userpfp-highDef:${newUser._id}`, 2 * 24 * 60 * 60);
    await client.expire(`userpfp-lowDef:${newUser._id}`, 2 * 24 * 60 * 60);
  }

  // Delete the cached verified email:
  await client.del(`${req.body.verifiedEmail}:verified`);

  await createSendToken(newUser, 201, res);
});

exports.adminLogin = catchAsync(async (req, res, next) => {
  //console.log()
  const { email, password } = req.body;

  // 1) Check if email and password exist
  if (!email || !password) {
    return next(new AppError('Please provide email and password', 400));
  }

  // 2) Check if the user exists && password is correct
  const user = await User.findOne({ email, role: 'admin' }).select('+password');

  if (!user || !(await user.correctPassword(password, user.password))) {
    return next(new AppError('Incorrect email or password', 401));
  }
  ////////////////////////////// !!! UPDATE !!! POPULATED club_position in login too to avoid problems in frontend!!! VERY VERY IMP!!!
  await User.populate(user, { path: 'club_position.club', select: 'clubName' });
  // 3) If everything ok, send token to client
  await createSendToken(user, 200, res, req);
});

exports.login = catchAsync(async (req, res, next) => {
  //console.log()
  const { email, password } = req.body;
  // 1) Check if email and password exist
  if (!email || !password) {
    return next(new AppError('Please provide email and password', 400));
  }

  // 2) Check if the user exists && password is correct
  const user = await User.findOne({ email, role: 'student' }).select(
    '+password',
  );

  if (!user || !(await user.correctPassword(password, user.password))) {
    return next(new AppError('Incorrect email or password', 401));
  }
  ////////////////////////////// !!! UPDATE !!! POPULATED club_position in login too to avoid problems in frontend!!! VERY VERY IMP!!!
  await User.populate(user, { path: 'club_position.club', select: 'clubName' });
  // 3) If everything ok, send token to client
  await createSendToken(user, 200, res, req);
});

////////////////////// !!! UPDATE !!! ADDED THIS NEW ENDPOINT TO STORE FCM TOKEN IN USER DOCUMENT
exports.storeFcmToken = catchAsync(async (req, res) => {
  try {
    const userId = req.user.id; // from auth middleware
    const { token } = req.body;

    if (!token) {
      return res.status(400).json({ message: 'FCM token required' });
    }

    await User.findByIdAndUpdate(
      userId,
      { $addToSet: { fcmTokens: token } }, // prevents duplicates
      { new: true },
    );

    res.status(200).json({ message: 'FCM token stored' });
  } catch (err) {
    console.error('FCM token store error:', err);
    res.status(500).json({ message: 'Server error' });
  }
});

exports.logout = catchAsync(async (req, res, next) => {
  // console.log('server recieved logout request');

  // clear jwt
  res.clearCookie('jwt', { header: true, sameSite: true, secure: true });

  // Remove session
  await client.del(`session:${req.user.id}`);

  // remove socket ID if user is connected to socket (OFC CONNECTED BUT EDGE CASES)
  const socketId = userSocketMap.get(String(req.user.id));

  const io = getIO();
  if (socketId) {
    io.to(socketId).disconnectSockets(true); // force disconnect
    userSocketMap.delete(String(req.user.id));
  }

  // remove all fcm tokens
  const user = await User.findByIdAndUpdate(req.user.id, {
    fcmTokens: [],
  });

  res.status(200).json({
    status: 'success',
  });
});

exports.protect = catchAsync(async function (req, res, next) {
  // 1) Getting token and check if it's there
  let token;
  // console.log('entered protect');

  // 1) Get token from HEADER (mobile) OR COOKIE (web)
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    token = req.headers.authorization.split(' ')[1];
    // console.log('Token from header');
  } else if (req.cookies && req.cookies.jwt) {
    token = req.cookies.jwt;
    // console.log('Token from cookie');
  }
  // console.log(token);
  if (!token) {
    return next(
      new AppError('You are not logged in! Please log in to get access.', 401),
    );
  }
  // 2) Verification token
  const decoded = await promisify(jwt.verify)(token, process.env.JWT_SECRET);
  const storedSession = await client.get(`session:${decoded.id}`);

  if (!storedSession || storedSession !== decoded.sessionId) {
    return next(new AppError('Session expired. Please login again.', 401));
  }

  // console.log(decoded);

  // 3) Check if user still exists
  const currentUser = await User.findById(decoded.id);
  if (!currentUser) {
    return next(
      new AppError(
        'The user belonging to this token does no longer exist.',
        401,
      ),
    );
  }

  // 4) Check if User changed password after JWT toke was issued
  if (currentUser.changedPasswordAfter(decoded.iat)) {
    return next(
      new AppError('User recently changed password! Please log in again.', 401),
    );
  }

  req.user = currentUser;
  // Grant access to protected route:
  next();
});

exports.restrictTo = (roles = [], clubPositions = []) => {
  return (req, res, next) => {
    // console.log('entered retrict to route!');
    // console.log('\n\nUser role is: ', req.user.role, '\n\n');
    const clubId = req.params.clubId;

    // console.log(req.user.club_position);
    const clubData = req.user.club_position.find(
      (position) => position.club.toString() === clubId,
    );
    const club_position = clubData?.position;
    // console.log('\n\nclub_position is: ', club_position);
    // console.log(
    //   'Access(1 granted, 0 rejected): ',
    //   !roles.includes(req.user.role),
    //   '\n\n',
    // );
    // const { role, club_position } = req.user;
    // roles is an array: ['admin', 'lead-guide']
    if (roles.length > 0 && !roles.includes(req.user.role)) {
      return next(
        new AppError(
          `Users with role '${req.user.role}' do not have access to perform this action!`,
          403,
        ),
      );
    }

    // console.log('clubId is: ', clubId);

    if (clubId && mongoose.Types.ObjectId.isValid(clubId)) {
      if (clubPositions.length > 0 && !clubPositions.includes(club_position)) {
        return next(
          new AppError(
            `Users with club position ${club_position}s do not have access to perform this action!`,
            403,
          ),
        );
      }
      next();
    } else if (
      !clubId &&
      clubPositions.length > 0 &&
      !mongoose.Types.ObjectId.isValid(clubId)
    ) {
      return next(new AppError('Please provide clubId for this route!', 400));
    } else next();
  };
};

exports.forgotPassword = catchAsync(async (req, res, next) => {
  // 1) Get user based on posted email
  const user = await User.findOne({ email: req.body.email });
  if (!user) {
    return next(new AppError('There is no user with that email address', 404));
  }
  // 2) Generate the random reset token
  const resetToken = user.createPasswordResetToken();
  await user.save({ validateBeforeSave: false });
  // 3) Send it to user's email
  const resetURL = `${req.protocol}://${req.get(
    'host',
  )}/api/v1//users/resetPassword/${resetToken}`;

  const message = `Fogeot your pasword? Submit a PATCH request with your new password and passwordConfirm to: ${resetURL}.\nIf you didn't forget your password, please ignore this email!`;

  try {
    await sendMail({
      recipient: user.email,
      subject: 'Your password reset token (valid for 10 min)',
      name: `${user.name}`,
      message,
    });

    res.status(200).json({
      status: 'success',
      message: 'Token sent to email!',
    });
  } catch (err) {
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save({ validateBeforeSave: false });
    // console.log(err);
    return next(
      new AppError('There was an error sending an email. Try again later', 500),
    );
  }
});

exports.resetPassword = catchAsync(async (req, res, next) => {
  // 1) Get user based on the token
  const hashedToken = crypto
    .createHash('sha256')
    .update(req.params.token)
    .digest('hex');

  const user = await User.findOne({
    passwordResetToken: hashedToken,
    passwordResetExpires: { $gt: Date.now() },
  });

  // 2) If token has not expired and there is a user, set new password
  if (!user) {
    return next(new AppError('Token is invalid or has expired', 400));
  }
  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  user.passwordResetToken = undefined;
  user.passwordResetExpires = undefined;
  await user.save();

  // 3) Update changedPasswordAt property for the user

  // 4) Log the user in, send JWT to client
  await createSendToken(user, 200, res);
});

exports.updatePassword = catchAsync(async (req, res, next) => {
  // 1) Get user from collection
  const user = await User.findById(req.user.id).select('+password');

  // 2) Check if the password is correct
  if (!(await user.correctPassword(req.body.passwordCurrent, user.password))) {
    return next(new AppError('Your current password is incorrect.', 401));
  }

  // 3)
  user.password = req.body.password;
  user.passwordConfirm = req.body.passwordConfirm;
  await user.save();

  // 4) Log the user in, send JWT
  await createSendToken(user, 200, res);
});

exports.verifyUserByPassword = catchAsync(async (req, res, next) => {
  // console.log('entered verifyUserByPassword');
  const password = req.body.password;

  // Check if user has entered the password
  if (!password) {
    return next(new AppError('Please provide your password.', 400));
  }

  const user = await User.findById(req.user.id).select('+password');

  // console.log('USER FOUND CHECKING PASSOWRD');

  // Check the entered password with user's actual stored password
  if (!(await user.correctPassword(password, user.password))) {
    return next(new AppError('Incorrect password!', 401));
  }
  // console.log('PASSWORD CORRECT');
  // Grant access to the extra protected route
  next();
});

// GET /users/check-username/:username
exports.checkUsername = catchAsync(async (req, res, next) => {
  const user = await User.findOne({ username: req.params.username });

  res.status(200).json({
    status: 'success',
    available: !user,
  });
});

exports.sendEmailChangeOTP = catchAsync(async (req, res, next) => {
  const currentEmail = req.user.email;

  if (!currentEmail) {
    return next(new AppError('User email not found', 400));
  }

  const sentOTP = Math.floor(100000 + Math.random() * 900000);

  await sendMail({
    recipient: req.user,
    subject: `Here is your OTP to change your email. (Valid for 10 mins)`,
    name: req.user.name,
    message: `Your OTP is ${sentOTP}`,
  });

  const cacheData = {
    OTP: `${sentOTP}`,
    savedAt: Date.now(),
  };

  await client.setEx(
    `emailChangeOTP:${req.user.id}`,
    600, // 10 min
    JSON.stringify(cacheData),
  );

  res.status(200).json({
    status: 'success',
    message: 'OTP sent to your current email',
  });
});

exports.verifyAndUpdateEmail = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const currentEmail = req.user.email;

  const { otp, newEmail } = req.body;

  // VALIDATION
  if (!otp || !newEmail) {
    return next(new AppError('Please provide OTP and new email', 400));
  }

  if (newEmail === currentEmail) {
    return next(new AppError('New email cannot be same as current email', 400));
  }

  // FETCH OTP FROM REDIS
  const cached = await client.get(`emailChangeOTP:${userId}`);

  if (!cached) {
    return next(new AppError('OTP expired or not found', 400));
  }

  const parsed = JSON.parse(cached);

  if (parsed.OTP !== otp) {
    return next(new AppError('Invalid OTP', 400));
  }

  // UPDATE EMAIL
  const updatedUser = await User.findByIdAndUpdate(
    userId,
    { email: newEmail },
    { new: true },
  );

  if (!updatedUser) {
    return next(new AppError('User not found', 404));
  }

  // DELETE OTP (IMPORTANT)
  await client.del(`emailChangeOTP:${userId}`);

  // POPULATE REQUIRED DATA
  await User.populate(updatedUser, {
    path: 'club_position.club',
    select: 'clubName',
  });

  // const achievements = await Achievements.find({ user: userId });

  // RESPONSE
  res.status(200).json({
    status: 'success',
    data: {
      user: updatedUser,
      // achievements,
    },
  });
});
