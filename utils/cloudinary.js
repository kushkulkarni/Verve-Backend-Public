const cloudinary = require('cloudinary').v2;
const multer = require('multer');

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

// Use memory storage (file stays in RAM only)
const storage = multer.memoryStorage();

// console.log(storage);

const upload = multer({ storage });

module.exports = { upload, cloudinary };
