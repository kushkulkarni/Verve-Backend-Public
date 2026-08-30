const multer = require('multer');
const { Readable } = require('stream');
const cloudinary = require('cloudinary').v2;

// -------------------------------
// 1️⃣ Multer middleware: populate req.file + req.body
// -------------------------------
const storage = multer.memoryStorage(); // store in memory for now
const upload = multer({ storage });

/////////////////////////////////// PARSE THE FORM DATA AND SEND REQ.FILE AND REQ.BODY TO NEXT MIDDLEWARE ///////////////////////////////////

exports.parseFormData = (req, res, next) => {
  // console.log('\n\nEntered uploadTempFile\n\n');
  const uploadSingle = upload.single('photo');
  uploadSingle(req, res, function (err) {
    if (err) {
      console.error('❌ Multer upload error:', err);
      return res
        .status(400)
        .json({ message: 'File upload failed', error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ message: 'No file uploaded' });
    }

    // console.log('✅ Multer stored file in memory:', req.file.originalname);
    next();
  });
};

exports.uploadStream = async (
  file,
  folder = 'verve_uploads/event_photos',
  transformation = [],
) => {
  return new Promise((resolve, reject) => {
    const uploadStream = cloudinary.uploader.upload_stream(
      { folder, transformation },
      (error, result) => {
        if (error) return reject(error);

        resolve({
          photoID: result.public_id,
          photoURL: result.secure_url,
          photoWidth: result.width,
          photoHeight: result.height,
        });
      },
    );

    Readable.from(file.buffer).pipe(uploadStream);
  });
};

exports.uploadSimple = async (file) => {
  const result = await cloudinary.uploader.upload(file.path, {
    folder: 'verve_uploads/event_photos',
  });

  return {
    photoID: result.public_id,
    photoURL: result.secure_url,
    photoWidth: result.width,
    photoHeight: result.height,
  };
};

exports.deleteManyFromCloud = async (ids) => {
  const photoIds = Array.isArray(ids) ? ids : [ids];
  try {
    await cloudinary.api.delete_resources(photoIds);
  } catch (error) {}
};
