// utils/userEmbedding.js

const Achievements = require('../models/achievementsModel');
const Likes = require('../models/likesModel');
const { generateEmbedding } = require('./embedding');

/**
 * Normalize vector to unit length
 */
const normalize = (vec) => {
  const norm = Math.sqrt(vec.reduce((s, v) => s + v * v, 0));
  if (!norm) return vec;
  return vec.map((v) => v / norm);
};

/**
 * Combine image + text embedding into single post vector
 */
const combinePostEmbedding = (post) => {
  const img = post.imageEmbedding;
  const txt = post.textEmbedding;

  if (img && txt) {
    return img.map((v, i) => 0.7 * img[i] + 0.3 * txt[i]);
  }
  if (img) return img;
  if (txt) return txt;
  return null;
};

/**
 * Compute user embedding
 */
exports.computeUserEmbedding = async (userId, skillsText) => {
  /* ===============================
     1. Fetch liked posts
     =============================== */
  const likes = await Likes.find({ likedBy: userId })
    .select('post createdAt')
    .lean();

  /* ===============================
     2. If user has liked posts
     =============================== */
  if (likes.length > 0) {
    const posts = await Achievements.find({
      _id: { $in: likes.map((l) => l.post) },
    })
      .select('imageEmbedding textEmbedding')
      .lean();

    const validVectors = posts.map(combinePostEmbedding).filter(Boolean);

    if (validVectors.length > 0) {
      const dim = validVectors[0].length;
      const avg = new Array(dim).fill(0);

      // weight recent likes slightly higher
      validVectors.forEach((vec) => {
        vec.forEach((v, i) => (avg[i] += v));
      });

      let userVec = avg.map((v) => v / validVectors.length);

      /* ===============================
         3. Blend with skills if provided
         =============================== */
      if (skillsText && skillsText.trim()) {
        const skillEmb = await generateEmbedding(null, skillsText);

        if (skillEmb?.textEmbedding) {
          userVec = userVec.map(
            (v, i) => 0.8 * v + 0.2 * skillEmb.textEmbedding[i],
          );
        }
      }

      return normalize(userVec);
    }
  }

  /* ===============================
     4. Cold start with skills
     =============================== */
  if (skillsText && skillsText.trim()) {
    const skillEmb = await generateEmbedding(null, skillsText);

    if (skillEmb?.textEmbedding) {
      return normalize(skillEmb.textEmbedding);
    }
  }

  /* ===============================
     5. True cold start fallback
     Use neutral vector (all zeros)
     =============================== */
  return null;
};
