const axios = require('axios');
const FormData = require('form-data');

exports.generateEmbedding = async (fileBuffer, text) => {
  const form = new FormData();

  if (fileBuffer) {
    form.append('image', fileBuffer, {
      filename: 'image.jpg',
      contentType: 'image/jpeg',
    });
  }

  // IMPORTANT: send text as string explicitly
  form.append('text', String(text || ''));

  const res = await axios.post(
    'https://captainkush-verve.hf.space/embed',
    form,
    {
      headers: {
        ...form.getHeaders(), // 🔥 this sets boundary
        Authorization: `Bearer ${process.env.HF_TOKEN}`,
      },
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      timeout: 120000,
    },
  );

  // console.log('HF returned:', res.data);

  return res.data;
};
