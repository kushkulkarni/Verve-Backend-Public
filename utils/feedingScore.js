// utils/feedScoring.js

/**
 * Cosine similarity between two vectors
 */
const cosineSimilarity = (a, b) => {
  if (!a || !b) return 0; // COLD START CASE WHERE WE MUST GIVE RECOMMENDATION WITHOUT cosineSimilarity...

  let sum = 0;
  for (let i = 0; i < a.length; i++) {
    sum += a[i] * b[i];
  }
  return sum;
};

/**
 * Normalize a value to range [0, 1]  *** THIS IS IMPORTANT TO KEEP A SPECIFIC SCORE IN RANGE ***
 */
const normalize = (value, max) => {
  if (!max || max <= 0) return 0;
  return Math.min(value / max, 1);
};

const combinePostEmbedding = (post) => {
  const img = post.imageEmbedding;
  const txt = post.textEmbedding;

  if (!img && !txt) return null;

  if (img && txt) {
    const combined = img.map((v, i) => 0.6 * img[i] + 0.4 * txt[i]);
    return combined;
  }

  return img || txt;
};

/**
 * Compute final ranking score for a post
 */
exports.computePostScore = ({ userEmbedding, post, now }) => {
  /* ===============================
      Semantic similarity (base)
     =============================== */
  // const semanticScore = cosineSimilarity(userEmbedding, post.embedding); // ~[-1, 1]
  let semanticScore = 0;

  if (userEmbedding) {
    const postVec = combinePostEmbedding(post);

    if (postVec) {
      semanticScore = cosineSimilarity(userEmbedding, postVec);
    }
  }

  /* ===============================
      Popularity (likes)
     =============================== */
  const likesScore = normalize(post.likes || 0, 100); // assumes 100 likes = strong signal

  /* ===============================
      Recency decay
     =============================== */
  const ageHours = (now - new Date(post.postedOn).getTime()) / (1000 * 60 * 60);

  const recencyScore = 1 / (1 + ageHours); // decays smoothly

  /* ===============================
      Engagement velocity
     =============================== */
  const engagementVelocity = ageHours > 0 ? (post.likes || 0) / ageHours : 0;

  const velocityScore = normalize(engagementVelocity, 10);

  /* ===============================
      Content length heuristic
     =============================== */
  const textLength = post.message ? post.message.length : 0;

  let contentQualityScore = 0.5; // neutral default
  if (textLength >= 30 && textLength <= 300) {
    contentQualityScore = 1;
  } else if (textLength < 10) {
    contentQualityScore = 0.2;
  }

  /* ===============================
      Final weighted score
     =============================== */
  const finalScore =
    0.55 * semanticScore +
    0.15 * likesScore +
    0.15 * recencyScore +
    0.1 * velocityScore +
    0.05 * contentQualityScore;

  return finalScore;
};
