/////////////////////// !!! <---- TELL HM TO INSTALL SHARP AND MULTER ----> !!! ///////////////////////

const multer = require('multer');
const sharp = require('sharp');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');

const multerStorage = multer.memoryStorage();

const multerFilter = (req, file, cb) => {
  const allowedExt = /\.(jpg|jpeg|png|webp|jfif)$/i;
  // console.log('Entered multer filter');
  if (file.mimetype.startsWith('image') || allowedExt.test(file.originalname)) {
    cb(null, true);
  } else {
    cb(new AppError('Not an image! Please upload only images.', 400), false);
  }
  // console.log('EXITING multer filter');
};

const upload = multer({
  storage: multerStorage,
  fileFilter: multerFilter,
});

const checkRatio = async (files) => {
  let allFiles = [];
  if (!Array.isArray(files)) {
    allFiles = [files];
  } else {
    allFiles = files;
  }

  for (const file of allFiles) {
    const image = await sharp(file.buffer);
    const metadata = await image.metadata();

    const { width, height } = metadata;
    if (!width || !height) {
      return {
        errMsg: 'Provide valid image dimensions',
        errStatus: 400,
      };
    }

    const ratio = width / height;
    // console.log('ratio: ', ratio);

    const MIN_RATIO = 0.8; // ~4:5
    const MAX_RATIO = 1.91; // ~16:9

    if (ratio < MIN_RATIO || ratio > MAX_RATIO) {
      return {
        errMsg:
          'Image aspect ratio not allowed. Please upload a balanced image',
        errStatus: 400,
      };
    }
  }
  return null;
};

exports.uploadClubAnnouncements = upload.fields([
  { name: 'images', maxCount: 3 },
]);

exports.resizeClubAnnouncements = catchAsync(async (req, res, next) => {
  // console.log('Entered resizeClubAnnouncements');
  // If no Images, go to next middlware
  // console.log(req.files);
  if (!req.files || !req.files?.images) return next();

  // resize the images using sharp [DO NOT STORE toFile!]
  req.files.images = await Promise.all(
    req.files.images.map(async (file, i) => {
      file.buffer = await sharp(file.buffer)
        .toFormat('jpeg')
        .jpeg({ quality: 80 })
        .toBuffer();

      file.mimetype = 'image/jpeg';

      return file;
    }),
  );
  // console.log('EXITING resizeClubAnnouncements');
  next();
});

exports.uploadProfile = upload.single('photo');

exports.resizeProfilePhoto = catchAsync(async (req, res, next) => {
  if (!req.file) return next();

  // resize the single file
  req.file.buffer = await sharp(req.file.buffer)
    .toFormat('jpeg')
    .jpeg({ quality: 90 })
    .toBuffer();

  req.file.mimetype = 'image/jpeg';

  next();
});

exports.uploadPost = upload.single('photo');

exports.resizePostPhoto = catchAsync(async (req, res, next) => {
  if (!req.file) return next();

  const imageValid = await checkRatio(req.file);
  // console.log(imageValid);
  if (imageValid)
    return next(new AppError(imageValid.errMsg, imageValid.errStatus));

  req.file.buffer = await sharp(req.file.buffer)
    .toFormat('jpeg')
    .jpeg({ quality: 90 })
    .toBuffer();

  req.file.mimetype = 'image/jpeg';

  next();
});
