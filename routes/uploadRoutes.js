const express = require('express');
const router = express.Router();
const { upload } = require('../utils/cloudinary');

router.post('/upload', upload.single('image'), (req, res) => {
  res.json({
    status: 'success',
    url: req.file.path, // Cloudinary URL
    public_id: req.file.filename,
  });
});

module.exports = router;
