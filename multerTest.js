// // server.js
// const express = require('express');
// const multer = require('multer');
// const path = require('path');
// const fs = require('fs');
// const { CloudinaryStorage } = require('multer-storage-cloudinary');
// const cloudinary = require('cloudinary').v2;

// require('dotenv').config();

// const app = express();
// app.use(express.json());
// // --- Ensure temp folder exists ---
// if (!fs.existsSync('./temp_uploads')) fs.mkdirSync('./temp_uploads');

// // =======================
// // 1️⃣ Disk Storage Test
// // =======================
// const diskStorage = multer.diskStorage({
//   destination: (req, file, cb) => cb(null, './temp_uploads'),
//   filename: (req, file, cb) =>
//     cb(null, Date.now() + path.extname(file.originalname)),
// });

// const uploadDisk = multer({ storage: diskStorage });

// // Route to test local storage
// app.post(
//   '/upload-disk',
//   (req, res, next) => {
//     req.body = { monkey: 'hello!' };
//     next();
//   },
//   uploadDisk.single('photo'),
//   (req, res) => {
//     console.log('Reached /upload-disk');
//     console.log('req.file:', req.file);
//     console.log('req.body:', req.body.monkey);
//     res.json({ message: 'Disk upload done', file: req.file });
//   }
// );

// // =======================
// // 2️⃣ Cloudinary Storage Test
// // =======================
// cloudinary.config({
//   cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
//   api_key: process.env.CLOUDINARY_API_KEY,
//   api_secret: process.env.CLOUDINARY_API_SECRET,
// });

// const cloudStorage = new CloudinaryStorage({
//   cloudinary,
//   params: {
//     folder: 'verve_test',
//     allowed_formats: ['jpg', 'png', 'jpeg'],
//     // Remove transformation temporarily for testing
//     // transformation: [{ width: 800, height: 800, crop: 'limit' }],
//   },
// });

// const uploadCloud = multer({ storage: cloudStorage });

// // Route to test Cloudinary storage
// app.post('/upload-cloud', uploadCloud.single('photo'), (req, res) => {
//   console.log(process.env.CLOUDINARY_API_KEY);
//   console.log('Reached /upload-cloud');
//   console.log('req.file:', req.file);
//   console.log('req.body:', req.body);
//   res.json({ message: 'Cloudinary upload done', file: req.file });
// });

// // =======================
// // Start Server
// // =======================
// const PORT = 5000;
// app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const app = express();
const uploadDir = './temp_uploads';
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) =>
    cb(null, Date.now() + path.extname(file.originalname)),
});
const upload = multer({ storage });

app.post('/test', upload.single('photo'), (req, res) => {
  // console.log('req.file:', req.file);
  // console.log('req.body:', req.body);
  res.json({ file: req.file, body: req.body });
});

app.listen(5000, () => console.log('Running on 5000'));
