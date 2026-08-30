const User = require('./../models/userModel');
const Comments = require('./../models/commentsModel');
const Anonymous = require('./../models/anonymousModel');
const Achievements = require('./../models/achievementsModel');
const Likes = require('./../models/likesModel');
const catchAsync = require('./../utils/catchAsync');
const AppError = require('./../utils/appError');
const client = require('../redisClient');
const { timeStamp } = require('console');
const mongoose = require('mongoose');
const cloudinary = require('cloudinary').v2;
const Notification = require('./../models/notifications');
const sendNotification = require('./../utils/sendNotification');
const { generateEmbedding } = require('../utils/embedding');
const { computeUserEmbedding } = require('./../utils/userEmbeddings');
const { computePostScore } = require('./../utils/feedingScore');
const Chat = require('./../models/chatModel');
const Message = require('./../models/Message');
const { deleteManyFromCloud, uploadStream } = require('./cloudinaryController');

// 1
const handleLikedPostsLogic = (post, likedPosts) => {
  const likedSet = new Set(likedPosts.map((lp) => lp.post.toString()));
  const postsWithLikeStatus = post.map((p) => ({
    ...p,
    isLiked: likedSet.has(p._id.toString()),
  }));

  return postsWithLikeStatus;
};

const mergePostsWithCount = async (pageWithLikeState, likeCountMap) => {
  let finalPage;
  try {
    // check for suspicious posts
    const suspiciousPosts = pageWithLikeState.filter(
      (post) =>
        post.isLiked && (likeCountMap.get(post._id.toString()) || 0) === 0,
    );

    let dbCountMap = new Map();

    if (suspiciousPosts.length > 0) {
      const ids = suspiciousPosts.map((p) => p._id);

      const dbCounts = await Likes.aggregate([
        { $match: { post: { $in: ids } } },
        { $group: { _id: '$post', count: { $sum: 1 } } },
      ]);

      dbCountMap = new Map(
        dbCounts.map((item) => [item._id.toString(), item.count]),
      );

      //  batch Redis heal
      const pipeline = client.multi();

      dbCountMap.forEach((count, id) => {
        pipeline.set(`post:likes:${id}`, count);
      });

      await pipeline.exec();
    }

    const finalPage = pageWithLikeState.map((post) => {
      const id = post._id.toString();

      let count = likeCountMap.get(id) || 0;

      if (dbCountMap.has(id)) {
        count = dbCountMap.get(id);
      }

      return {
        ...post,
        likes: count,
      };
    });

    return finalPage;
  } catch (error) {
    // console.log('ERROR IN MERGING POSTS WITH COUNT: ', error);
    return pageWithLikeState.map((post) => ({
      ...post,
      likes: likeCountMap.get(post._id.toString()) || 0,
    }));
  }
};

const getLikeCounts = async (postIds) => {
  try {
    if (!postIds || postIds.length === 0) return new Map();

    // prepare keys for every postId:
    const likeKeys = postIds.map((id) => `post:likes:${id}`);

    // fetch from Redis
    const likeCounts = await client.mGet(likeKeys);

    const likeCountMap = new Map();
    const missingIds = [];

    // Separate cache hits and misses
    postIds.forEach((id, i) => {
      const count = likeCounts[i];

      if (count === null) {
        missingIds.push(id);
      } else {
        likeCountMap.set(id.toString(), parseInt(count));
      }
    });

    // DB fallback for missed cached hits
    if (missingIds.length > 0) {
      const dbCounts = await Likes.aggregate([
        { $match: { post: { $in: missingIds } } },
        { $group: { _id: '$post', count: { $sum: 1 } } },
      ]);

      const dbMap = new Map(
        dbCounts.map((item) => [item._id.toString(), item.count]),
      );

      // Fill missing + hydrate Redis
      const pipeline = client.multi(); //  batch Redis writes

      missingIds.forEach((id) => {
        const count = dbMap.get(id.toString()) || 0;

        likeCountMap.set(id.toString(), count);

        pipeline.set(`post:likes:${id}`, count);
      });

      await pipeline.exec(); // single roundtrip
    }
    return likeCountMap;
  } catch (error) {}
};

exports.postAchievement = catchAsync(async (req, res, next) => {
  // get user id who posted this (already extracted from protect route, just access it).
  const postedBy = req.user.id;
  const timestamp = new Date().toISOString();

  if (!req.file && !req.body.message) {
    return next(
      new AppError('You have to post something, a post cannot be empty!', 204),
    );
  }
  // let pfpUrl;
  // const userProfilePicture_LowRes = await client.hGet(
  //   `userpfp-lowDef:${req.user.id}`,
  //   pfpUrl
  // );

  // if (!userProfilePicture_LowRes) {
  userProfilePicture_LowRes = req.user.profilePicture_LowRes;
  // }
  // console.log('entered postAchievement with req.file: ', req.file);
  let photoUrl = '';
  let width = null,
    height = null;
  let photoId = '';
  if (req.file) {
    const result = await uploadStream(req.file, 'verve_uploads/posts');
    photoUrl = result.photoURL;
    width = result.photoWidth;
    height = result.photoHeight;
    photoId = result.photoID;
  }

  let embeddingData = null;

  if (req.file || req.body.message) {
    // const base64String = req.file
    //   ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`
    //   : null;

    embeddingData = await generateEmbedding(
      req.file.buffer,
      req.body.message || '',
    );
  }

  // create new achievement post.
  const newAchievement = await Achievements.create({
    user: postedBy,
    photo: photoUrl,
    photoId: photoId,
    photoWidth: width,
    photoHeight: height,
    message: req.body.message,
    postedOn: timestamp,
    image_embedding: embeddingData.image_embedding || null,
    text_embedding: embeddingData.text_embedding || null,
  });

  // cache the new post:
  await client.hSet(`achievement:${newAchievement._id}`, {
    _id: newAchievement._id.toString(),
    userId: postedBy.toString(),
    userPfp: userProfilePicture_LowRes || '',
    name: req.user.name,
    photo: photoUrl,
    message: req.body.message || '',
    postedOn: timestamp,
    likes: 0,
    isLiked: 'false', // will romove later
  });

  await client.expire(`achievement:${newAchievement._id}`, 3600);

  const listKey = 'achievements:list';
  const listExists = await client.exists(listKey);

  await client.lPush('achievements:list', `achievement:${newAchievement._id}`);

  if (!listExists) {
    await client.expire(listKey, 1800); // 30 min hard expiry
  }

  // To fetch all:
  ////////////////////////////// required during fetching all posts (saved for later) ////////////////////////////////
  // const postKeys = await client.lRange('achievements:list', 0, 9); // latest 10
  // const posts = await Promise.all(postKeys.map(k => client.hGetAll(k)));

  res.status(201).json({
    status: 'success',
    data: {
      newAchievement,
    },
  });
});

// 2

exports.postAnonymous = catchAsync(async (req, res, next) => {
  // get user id who posted this (already extracted from protect route, just access it).
  const postedBy = req.user.id;
  const timestamp = new Date().toISOString();
  if (!req.file && !req.body.message) {
    return next(
      new AppError('You have to post something, a post cannot be empty!', 204),
    );
  }

  if (req.body.message && req.body.message.length > 5000) {
    return next(new AppError('Caption too long', 400));
  }
  // let pfpUrl;
  // const userProfilePicture_LowRes = await client.hGet(
  //   `userpfp-lowDef:${req.user.id}`,
  //   pfpUrl
  // );

  // if (!userProfilePicture_LowRes) {
  userProfilePicture_LowRes = req.user.profilePicture_LowRes;
  // }

  let photoUrl = '';
  let width = null,
    height = null;
  let photoId = '';
  if (req.file) {
    // const base64String = `data:${
    //   req.file.mimetype
    // };base64,${req.file.buffer.toString('base64')}`;

    const result = await uploadStream(req.file, 'verve_uploads/posts');
    photoUrl = result.photoURL;
    width = result.photoWidth;
    height = result.photoHeight;
    photoId = result.photoID;
  }

  let embeddingData = null;

  if (req.file || req.body.message) {
    // const base64String = req.file
    //   ? `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`
    //   : null;

    embeddingData = await generateEmbedding(
      req.file.buffer,
      req.body.message || '',
    );
  }

  // create new achievement post.
  const newAnonymous = await Anonymous.create({
    user: postedBy,
    photo: photoUrl,
    photoId: photoId,
    photoWidth: width,
    photoHeight: height,
    message: req.body.message,
    postedOn: timestamp,
    image_embedding: embeddingData.image_embedding || null,
    text_embedding: embeddingData.text_embedding || null,
  });

  // cache the new post:
  await client.hSet(`anonymous:${newAnonymous._id}`, {
    _id: newAnonymous._id.toString(),
    userId: postedBy.toString(),
    userPfp: userProfilePicture_LowRes || '',
    name: req.user.name,
    photo: photoUrl,
    message: req.body.message || '',
    postedOn: timestamp,
    likes: 0,
    isLiked: 'false', // will romove later
  });

  await client.expire(`anonymous:${newAnonymous._id}`, 3600);

  const listKey = 'anonymous:list';
  const listExists = await client.exists(listKey);

  await client.lPush('anonymous:list', `anonymous:${newAnonymous._id}`);

  if (!listExists) {
    await client.expire(listKey, 1800); // 30 min hard expiry
  }

  // To fetch all:
  ////////////////////////////// required during fetching all posts (saved for later) ////////////////////////////////
  // const postKeys = await client.lRange('achievements:list', 0, 9); // latest 10
  // const posts = await Promise.all(postKeys.map(k => client.hGetAll(k)));

  res.status(201).json({
    status: 'success',
    data: {
      newAnonymous,
    },
  });
});

// 3

exports.addAchievementPostComment = catchAsync(async (req, res, next) => {
  const commentedBy = req.user.id;
  const postId = req.params.postId;
  const comment = req.body.comment;
  const timestamp = new Date().toISOString();
  // console.log('1');
  // try {
  if (!comment) {
    return next(new AppError('A Comment cannot be empty!', 400));
  }
  // console.log('2');
  const post = await Achievements.findById(postId);
  if (!post) {
    return next(
      new AppError(
        'There is no such post for adding a comment. Please check again!',
        404,
      ),
    );
  }

  // console.log('3');
  const userProfilePicture_LowRes = req.user.profilePicture_LowRes;

  const newAchievementComment = await Comments.create({
    user: commentedBy,
    postModel: 'Achievements',
    post: post,
    postedOn: timestamp,
    comment: comment,
  });

  // console.log('4');

  await client.hSet(`comment:${newAchievementComment._id}`, {
    userId: commentedBy.toString(),
    userPfp: userProfilePicture_LowRes || '',
    name: req.user.name,
    text: comment,
    postedOn: timestamp,
  });

  // console.log('5');

  await client.expire(`comment:${newAchievementComment._id}`, 3600);

  //  FIX: use postId (not post object)
  const listKey = `comments:achievement:${postId}`;

  const listExists = await client.exists(listKey);

  await client.lPush(listKey, `comment:${String(newAchievementComment._id)}`);

  //  FIX: ALWAYS set expiry (remove conditional logic)
  await client.expire(listKey, 1800); //  NEW

  //  NEW: CACHE INVALIDATION (main fix)
  await client.del(listKey);

  // const populatedComment = await Comments.findById(
  //   newAchievementComment._id,
  // ).populate('user', 'username profilePicture_LowRes blockedUsers');

  await Achievements.findOneAndUpdate(
    { _id: postId, comments: { $gt: 0 } }, // only if > 0
    { $inc: { comments: -1 } },
  );

  // console.log('6');
  const formatted = {
    _id: String(newAchievementComment._id),
    userId: String(req.user.id),
    username: req.user.username,
    userPfp: req.user.profilePicture_LowRes || '',
    text: comment,
    postedOn: newAchievementComment.postedOn.toISOString(),
  };
  // } catch (error) {
  //   return next(new AppError(error, 500));
  // }

  // console.log('7');
  res.status(200).json({
    status: 'success',
    data: {
      newComment: formatted,
    },
  });
});

// 4

// exports.addAnonymousPostComment = catchAsync(async (req, res, next) => {
//   const commentedBy = req.user.id;
//   const postId = req.params.postId;
//   const comment = req.body.comment;
//   const timestamp = new Date().toISOString();

//   if (!comment) {
//     return next(new AppError('A Comment cannot be empty!', 400));
//   }

//   const post = await Anonymous.findById(postId);
//   if (!post) {
//     return next(
//       new AppError(
//         'There is no such post for adding a comment. Please check again!',
//         404,
//       ),
//     );
//   }

//   let userProfilePicture_LowRes = await client.hGet(
//     `userpfp-lowDef:${req.user.id}`,
//     pfpUrl,
//   );

//   if (!userProfilePicture_LowRes) {
//     userProfilePicture_LowRes = req.user.profilePicture_LowRes;
//   }

//   const newAnonymousComment = await Comments.create({
//     user: commentedBy,
//     postModel: 'Anonymous',
//     post: post,
//     postedOn: timestamp,
//     comment: comment,
//   });

//   await client.hSet(`comment:${newAnonymousComment._id}`, {
//     userId: commentedBy.toString(),
//     userPfp: userProfilePicture_LowRes || '',
//     name: req.user.name,
//     text: comment,
//     postedOn: timestamp,
//   });

//   await client.expire(`comment:${newAnonymousComment._id}`, 3600);

//   const listKey = `comments:anonymous:${post}`; //////////////////////////////////////////////////////
//   const listExists = await client.exists(listKey);

//   await client.lPush(
//     `comments:anonymous:${postId}`,
//     `comment:${String(newAnonymousComment._id)}`,
//   );

//   if (!listExists) {
//     await client.expire(listKey, 1800); // 30 min hard expiry               //////////////////////////////////////////////////////
//   }

//   // const populatedComment = await Anonymous.findById(
//   //   newAnonymousComment._id,
//   // ).populate('user', 'username profilePicture_LowRes blockedUsers');

//   const finalComment = {
//     _id: newAnonymousComment._id,
//     userId: req.user.id,
//     username: req.user.username,
//     userPfp: req.user.profilePicture_LowRes,
//     text: comment,
//     postedOn: newAnonymousComment.postedOn.toISOString(),
//   };

//   res.status(200).json({
//     status: 'success',
//     data: {
//       newAnonymousComment: finalComment,
//     },
//   });
// });

exports.addAnonymousPostComment = catchAsync(async (req, res, next) => {
  const commentedBy = req.user.id;
  const postId = req.params.postId;
  const comment = req.body.comment;
  const timestamp = new Date().toISOString();

  if (!comment) {
    return next(new AppError('A Comment cannot be empty!', 400));
  }

  const post = await Anonymous.findById(postId);
  if (!post) {
    return next(
      new AppError(
        'There is no such post for adding a comment. Please check again!',
        404,
      ),
    );
  }

  let userProfilePicture_LowRes = await client.hGet(
    `userpfp-lowDef:${req.user.id}`,
    pfpUrl,
  );

  if (!userProfilePicture_LowRes) {
    userProfilePicture_LowRes = req.user.profilePicture_LowRes;
  }

  const newAnonymousComment = await Comments.create({
    user: commentedBy,
    postModel: 'Anonymous',
    post: post,
    postedOn: timestamp,
    comment: comment,
  });

  await client.hSet(`comment:${newAnonymousComment._id}`, {
    userId: commentedBy.toString(),
    userPfp: userProfilePicture_LowRes || '',
    name: req.user.name,
    text: comment,
    postedOn: timestamp,
  });

  await client.expire(`comment:${newAnonymousComment._id}`, 3600);

  //  FIX: use postId (not post object)
  const listKey = `comments:anonymous:${postId}`;

  const listExists = await client.exists(listKey);

  await client.lPush(listKey, `comment:${String(newAnonymousComment._id)}`);

  //  FIX: ALWAYS set expiry (remove conditional logic)
  await client.expire(listKey, 1800); //  NEW

  //  NEW: CACHE INVALIDATION (main fix)
  await client.del(listKey);

  const populatedComment = await Comments.findById(
    newAnonymousComment._id,
  ).populate('user', 'username profilePicture_LowRes blockedUsers');

  await Anonymous.findOneAndUpdate(
    { _id: postId, comments: { $gt: 0 } }, // only if > 0
    { $inc: { comments: -1 } },
  );

  const formatted = {
    _id: String(newAnonymousComment._id),
    userId: String(req.user.id),
    username: req.user.username,
    userPfp: req.user.profilePicture_LowRes || '',
    text: comment,
    postedOn: newAnonymousComment.postedOn.toISOString(),
  };

  res.status(200).json({
    status: 'success',
    data: {
      newComment: formatted,
    },
  });
});

// 5
/////////////////////////////// OLD LOGIC, NOT RECOMMENDED FOR SCALABILITY
// exports.likeAchievement = catchAsync(async (req, res, next) => {
//   const likedBy = req.user.id;
//   const postId = req.params.postId;
//   if (!postId) {
//     return next(new AppError('Please provide postId in the params!', 400));
//   }
//   const post = await Achievements.findOne({ _id: postId });
//   if (!post) {
//     return next(new AppError('Post does not exist!', 404));
//   }
//   const liked = await Likes.findOne({ post: postId, likedBy: likedBy });
// console.log(liked);
//   if (liked) {
//     await Likes.findByIdAndDelete(liked._id);
//     post.likes = Math.max(0, post.likes - 1);
//     await client.hIncrBy(`achievement:${postId}`, 'likes', -1);
//   } else {
//     await Likes.create({
//       likedBy,
//       postModel: 'Achievements',
//       post: postId,
//     });
//     post.likes += 1;
//     await client.hIncrBy(`achievement:${postId}`, 'likes', 1);
//   }

//   await post.save();
//   res.status(200).json({
//     status: 'success',
//   });
// }); ///////////////////////// OLD LOGIC, NOT RECOMMENDED FOR SCALABILITY

exports.likeAchievement = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const updates = req.body.updates;

  // console.log(`You have liked the achievements with IDs: `, updates);
  // console.log(
  //   `Recieved batch request for updating post like status: `,
  //   req.body,
  // );

  if (!updates || !Array.isArray(updates)) {
    return next(new AppError('Provide updates array', 400));
  }

  const postIds = updates.map((u) => u.postId);

  /* ////////////////////////////////////////////////////////////////
      Get existing likes in ONE query
     //////////////////////////////////////////////////////////////// */
  const existingLikes = await Likes.find({
    likedBy: userId,
    post: { $in: postIds },
  }).lean();

  const existingSet = new Set(existingLikes.map((l) => String(l.post)));

  const objectIds = postIds.map((id) => new mongoose.Types.ObjectId(id));
  const posts = await Achievements.find({ _id: { $in: objectIds } }).select(
    '_id',
  );

  /* ////////////////////////////////////////////////////////////////
      Build bulk ops for Likes collection
     //////////////////////////////////////////////////////////////// */
  const likeBulkOps = [];
  const incMap = new Map(); // postId → +1 / -1

  updates.forEach(({ postId, liked }) => {
    const postExists = posts.find((p) => String(p._id) === postId);
    if (!postExists) return;

    const alreadyLiked = existingSet.has(postId);
    // console.log('alreadyLiked: ', alreadyLiked);

    //  if should be liked but not yet liked → create
    if (liked && !alreadyLiked) {
      likeBulkOps.push({
        insertOne: {
          document: {
            likedBy: userId,
            postModel: 'Achievements',
            post: postId,
          },
        },
      });

      incMap.set(postId, (incMap.get(postId) || 0) + 1);
    }

    //  if should be unliked but exists → delete
    if (!liked && alreadyLiked) {
      likeBulkOps.push({
        deleteOne: {
          filter: {
            likedBy: userId,
            post: postId,
          },
        },
      });

      incMap.set(postId, (incMap.get(postId) || 0) - 1);
    }
  });

  /* ////////////////////////////////////////////////////////////////
      Execute Likes bulk write
     //////////////////////////////////////////////////////////////// */
  // console.log(likeBulkOps.map((op) => ({ ...op })));
  if (likeBulkOps.length > 0) {
    await Likes.bulkWrite(likeBulkOps);
  }

  /*////////////////////////////////////////////////////////////////
      Build increments for Achievements IN REDIS
     //////////////////////////////////////////////////////////////// */

  const redisPipeline = client.multi();

  incMap.forEach((inc, postId) => {
    const key = `post:likes:${postId}`;

    if (inc > 0) {
      redisPipeline.incrBy(key, inc);
    } else if (inc < 0) {
      redisPipeline.decrBy(key, Math.abs(inc));
    }
  });

  if (incMap.size > 0) {
    await redisPipeline.exec();
  }

  // const postBulkOps = [];

  // incMap.forEach((inc, postId) => {
  //   postBulkOps.push({
  //     updateOne: {
  //       filter: { _id: postId },
  //       update: [
  //         {
  //           $set: {
  //             likes: {
  //               $max: [{ $add: ['$likes', inc] }, 0],
  //             },
  //           },
  //         },
  //       ],
  //     },
  //   });
  // });

  // if (postBulkOps.length > 0) {
  //   await Achievements.bulkWrite(postBulkOps);
  // }

  // const redisOps = [];

  // incMap.forEach((inc, postId) => {
  //   redisOps.push(client.hIncrBy(`achievement:${postId}`, 'likes', inc));
  // });

  // if (redisOps.length) {
  //   await Promise.all(redisOps);
  // }

  res.status(200).json({
    status: 'success',
    updated: incMap.size,
  });
});

exports.likeAnonymous = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const updates = req.body.updates;

  // console.log(`You have liked the anonymous with IDs: `, updates);

  // console.log(
  //   `Recieved batch request for updating post like status: `,
  //   req.body,
  // );

  if (!updates || !Array.isArray(updates)) {
    return next(new AppError('Provide updates array', 400));
  }

  const postIds = updates.map((u) => u.postId);

  /* ////////////////////////////////////////////////////////////////
      Get existing likes in ONE query
     //////////////////////////////////////////////////////////////// */
  const existingLikes = await Likes.find({
    likedBy: userId,
    post: { $in: postIds },
  }).lean();

  const existingSet = new Set(existingLikes.map((l) => String(l.post)));

  const objectIds = postIds.map((id) => new mongoose.Types.ObjectId(id));
  const posts = await Anonymous.find({ _id: { $in: objectIds } }).select('_id');

  /* ////////////////////////////////////////////////////////////////
      Build bulk ops for Likes collection
     //////////////////////////////////////////////////////////////// */
  const likeBulkOps = [];
  const incMap = new Map(); // postId → +1 / -1

  updates.forEach(({ postId, liked }) => {
    const postExists = posts.find((p) => String(p._id) === postId);
    if (!postExists) return;

    const alreadyLiked = existingSet.has(postId);

    //  if should be liked but not yet liked → create
    if (liked && !alreadyLiked) {
      likeBulkOps.push({
        insertOne: {
          document: {
            likedBy: userId,
            postModel: 'Anonymous',
            post: postId,
          },
        },
      });

      incMap.set(postId, (incMap.get(postId) || 0) + 1);
    }

    //  if should be unliked but exists → delete
    if (!liked && alreadyLiked) {
      likeBulkOps.push({
        deleteOne: {
          filter: {
            likedBy: userId,
            post: postId,
          },
        },
      });

      incMap.set(postId, (incMap.get(postId) || 0) - 1);
    }
  });

  /* ////////////////////////////////////////////////////////////////
      Execute Likes bulk write
     //////////////////////////////////////////////////////////////// */
  if (likeBulkOps.length > 0) {
    await Likes.bulkWrite(likeBulkOps);
  }

  /*////////////////////////////////////////////////////////////////
      Build bulk increments for Achievements
     //////////////////////////////////////////////////////////////// */
  const redisPipeline = client.multi();

  incMap.forEach((inc, postId) => {
    const key = `post:likes:${postId}`;

    if (inc > 0) {
      redisPipeline.incrBy(key, inc);
    } else if (inc < 0) {
      redisPipeline.decrBy(key, Math.abs(inc));
    }
  });

  if (incMap.size > 0) {
    await redisPipeline.exec();
  }

  // const redisOps = [];

  // incMap.forEach((inc, postId) => {
  //   redisOps.push(client.hIncrBy(`achievement:${postId}`, 'likes', inc));
  // });

  // if (redisOps.length) {
  //   await Promise.all(redisOps);
  // }

  res.status(200).json({
    status: 'success',
    updated: incMap.size,
  });
});

// 6

exports.deleteAchievement = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const { postId } = req.params;
  const achievement = await Achievements.findById(postId);
  let statusCode, status;
  // console.log('\nStarting the session...');

  if (!achievement) {
    return next(
      new AppError('The post does not exist, please check again!', 400),
    );
  }

  if (achievement.user.toString() !== userId) {
    return next(
      new AppError('You can only delete your own achievements!', 401),
    );
  }

  await client.del(`achievement:${postId}`);
  await client.lRem(`achievements:list`, 0, `achievement:${postId}`);

  ////////// use multi document transaction here! /////////
  let session;
  try {
    // console.log('\nWill now try to start Mongoose session...');
    session = await mongoose.startSession();
    // console.log(
    //   'Mongoose connection ready state:',
    //   mongoose.connection.readyState,
    // );
    session.startTransaction();
    await Achievements.findByIdAndDelete(postId, { session });

    await Comments.deleteMany(
      {
        post: postId,
      },
      { session },
    );
    await Likes.deleteMany(
      {
        post: postId,
      },
      { session },
    );
    statusCode = 204;
    status = 'success';
    await session.commitTransaction();
    // await cloudinary.uploader.destroy(achievement.photoId);
    await deleteManyFromCloud([achievement.photoId]);
  } catch (error) {
    await session.abortTransaction();
    // console.log(
    //   'Could not delete the post, error in multi document transaction' + error,
    // );
    statusCode = 500;
    status = 'failed';
  } finally {
    await session.endSession();
  }

  res.status(204).json({
    status: 'success',
    data: {
      message: `Delete ${status}`,
    },
  });
});

// 7

exports.deleteComment = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  let listKey, hashKey;

  if (!req.params.commentId) {
    return next(
      new AppError('Please provide the comment id of the comment!', 400),
    );
  }

  const comment = await Comments.findById(req.params.commentId);
  if (!comment) {
    return next(new AppError('Comment not found', 404));
  }

  let post;
  if (comment.postModel === 'Achievements') {
    listKey = `comments:achievement:${comment.post.toString()}`;
    post = await Achievements.findById(comment.post);
  } else {
    listKey = `comments:anonymous:${comment.post.toString()}`;
    post = await Anonymous.findById(comment.post);
  }
  if (comment.user.toString() !== userId && String(post.user) !== userId) {
    return next(new AppError('You can only delete your own comments!', 401));
  }

  const cachedComments = await client.lRange(listKey, 0, -1);

  for (let c of cachedComments) {
    const parsed = JSON.parse(c);

    //  FIX: support BOTH old + new cache formats
    if (
      parsed.commentId === req.params.commentId || // old cache
      parsed._id === req.params.commentId // new cache
    ) {
      hashKey = c;
      break;
    }
  }

  // 🔧 SAFE GUARD (avoid removing undefined)
  if (hashKey) {
    await client.lRem(listKey, 0, hashKey);
  }

  //  NEW: CACHE INVALIDATION (MAIN FIX)
  await client.del(listKey);

  await Achievements.findByIdAndUpdate(comment.post, {
    $inc: {
      comments: -1,
    },
  });

  await Comments.findByIdAndDelete(req.params.commentId);

  res.status(204).json({
    status: 'success',
    data: {
      postId: String(comment.post),
      message: 'Comment Deleted',
    },
  });
});

////////////////////////////////// YOU ARE HERE!!! LAST EDITED DATE: 23/10/2025 //////////////////////////////////
////////////////////////////////// WHAT REMIANS IS TO UPDATE USER MODEL WITH LOW AND HIGH RES PFPs //////////////////////////////////
exports.updateMe = catchAsync(async (req, res, next) => {
  let highDefUrl, highDefId, lowDefUrl, lowDefId;
  // console.log('req.body is: ', req.body);

  // console.log('req.file is: ', req.file);
  if (
    req.body.bio &&
    (req.body.bio.length > 200 ||
      (req.body.bio.length > 0 && req.body.bio.length < 6))
  ) {
    return next(
      new AppError(
        'Profile Bio should be atleast 10 characters long and atmost 200 characters long!',
        400,
      ),
    );
  }

  const updatedData = {
    $set: {
      bio: req.body.bio ? req.body.bio : req.user.bio,
      name: req.body.name,
    },
  };

  try {
    if (req.file) {
      if (
        req.user.profilePictureId_HighRes ||
        req.user.profilePictureId_LowRes
      ) {
        // console.log('Deleteing previous image');
        await deleteManyFromCloud([
          req.user.profilePictureId_HighRes,
          req.user.profilePictureId_LowRes,
        ]); ///////////// find the image in cloudinary by passing the ID /////////////
      }

      /////////// upload new image (updated one) ///////////
      // const base64String = `data:${req.file.mimetype};base64,${req.file.buffer.toString('base64')}`;
      // console.log('Uploading new image');
      const highRes = await uploadStream(
        req.file,
        'verve_uploads/profile_photos/highres',
      );
      const lowRes = await uploadStream(
        req.file,
        'verve_uploads/profile_photos/lowres',
        [{ width: 100, height: 100, crop: 'fill', quality: 'auto:low' }],
      );

      // console.log(highRes);

      highDefUrl = highRes.photoURL;
      highDefId = highRes.photoID;
      lowDefUrl = lowRes.photoURL;
      lowDefId = lowRes.photoID;
    }

    if (req.body.removePhoto) {
      if (
        req.user.profilePictureId_HighRes ||
        req.user.profilePictureId_LowRes
      ) {
        await deleteManyFromCloud([
          req.user.profilePictureId_HighRes,
          req.user.profilePictureId_LowRes,
        ]); ///////////// find the image in cloudinary by passing the ID /////////////
      }

      await client.del(`userpfp-highDef:${req.user.id}`);
      await client.del(`userpfp-lowDef:${req.user.id}`);

      updatedData.profilePicture_HighRes = '';
      updatedData.profilePictureId_HighRes = '';
      updatedData.profilePicture_LowRes = '';
      updatedData.profilePictureId_LowRes = '';
    }

    if (req.file) {
      updatedData.profilePicture_HighRes = highDefUrl;
      updatedData.profilePictureId_HighRes = highDefId;
      updatedData.profilePicture_LowRes = lowDefUrl;
      updatedData.profilePictureId_LowRes = lowDefId;
    }
  } catch (err) {
    return next(new AppError('Failed to update profile', 400));
  }

  const updateQuery = {
    ...updatedData,
  };

  if (req.body.skills) {
    updateQuery.$addToSet = {
      skills: { $each: req.body.skills },
    };
  }

  const newUser = await User.findByIdAndUpdate(req.user.id, updateQuery, {
    new: true,
    runValidators: true,
  });

  if (req.file) {
    await client.hSet(`userpfp-highDef:${req.user.id}`, {
      pfpUrl: highDefUrl,
      pfpId: highDefId,
    });
    await client.hSet(`userpfp-lowDef:${req.user.id}`, {
      pfpUrl: lowDefUrl,
      pfpId: lowDefId,
    });
  }

  res.status(200).json({
    status: 'success',
    data: {
      newUser,
    },
  });
});

exports.deleteMe = catchAsync(async (req, res, next) => {
  // console.log('entered deleteMe');

  const userId = req.user.id;

  // PREP DATA (NO SESSION)

  const profileIds = [];
  if (req.user.profilePictureId_HighRes)
    profileIds.push(req.user.profilePictureId_HighRes);
  if (req.user.profilePictureId_LowRes)
    profileIds.push(req.user.profilePictureId_LowRes);

  const anonPosts = await Anonymous.find({ user: userId })
    .select('_id photoId')
    .lean();

  const anonPostIds = anonPosts.map((p) => p._id);
  const anonPhotoIds = anonPosts.map((p) => p.photoId).filter(Boolean);

  const allAchievements = await Achievements.find({ user: userId })
    .select('_id photoId')
    .lean();

  const allAchievementIds = allAchievements.map((a) => a._id);
  const allPhotoIds = allAchievements.map((a) => a.photoId).filter(Boolean);

  const photoIdsToDelete = [...profileIds, ...allPhotoIds, ...anonPhotoIds];

  let session;

  try {
    session = await mongoose.startSession();
    session.startTransaction();

    // DELETE ACHIEVEMENTS

    if (allAchievementIds.length) {
      await Achievements.deleteMany({
        _id: { $in: allAchievementIds },
      }).session(session);
    }

    if (anonPostIds.length) {
      await AnonymousPost.deleteMany({
        _id: { $in: anonPostIds },
      }).session(session);
    }

    // DELETE COMMENTS & LIKES

    await Comments.deleteMany({
      user: userId,
      post: { $in: [...allAchievementIds, ...anonPostIds] },
    }).session(session);
    await Likes.deleteMany({
      likedBy: userId,
      post: { $in: [...allAchievementIds, ...anonPostIds] },
    }).session(session);

    // DELETE MESSAGES

    await Message.deleteMany({
      $or: [{ sender: userId }, { recipient: userId }],
    }).session(session);

    // DELETE CHATS

    await Chat.deleteMany({
      $or: [{ guide: userId }, { doubtUser: userId }],
    }).session(session);

    // DELETE NOTIFICATIONS

    await Notification.deleteMany({
      $or: [{ from: userId }, { to: userId }],
    }).session(session);

    // DELETE USER

    const deletedUser = await User.findByIdAndDelete(userId).session(session);

    if (!deletedUser) {
      throw new AppError('User not found', 404);
    }

    await session.commitTransaction();
  } catch (error) {
    // console.error('Transaction failed:', error);
    if (session) await session.abortTransaction();
    return next(new AppError('Failed to delete user data. Try again.', 500));
  } finally {
    if (session) await session.endSession();
  }

  // AFTER COMMIT (SAFE ZONE)

  try {
    // REDIS CLEANUP
    const pipeline = client.multi();

    for (const A of allAchievementIds) {
      pipeline.del(`achievement:${A}`);
    }

    pipeline.del(`userpfp-highDef:${userId}`);
    pipeline.del(`userpfp-lowDef:${userId}`);

    await pipeline.exec();

    // CLOUDINARY CLEANUP
    if (photoIdsToDelete.length) {
      const chunkSize = 1000;

      for (let i = 0; i < photoIdsToDelete.length; i += chunkSize) {
        const chunk = photoIdsToDelete.slice(i, i + chunkSize);

        await deleteManyFromCloud(chunk);
      }
    }
  } catch (err) {
    // console.error('Post-delete cleanup failed:', err);
    //  Do NOT fail request — DB already consistent
  }

  // console.log('User deleted successfully');

  res.clearCookie('jwt', {
    httpOnly: true,
    sameSite: 'strict',
    secure: true,
  });

  res.status(200).json({
    status: 'success',
    data: null,
  });
});

exports.getMyProfile = catchAsync(async (req, res, next) => {
  const userAchievements = await Achievements.find({
    user: req.user.id,
  }).lean();
  const achievementIds = userAchievements.map((a) => a._id);
  const likedUserAchievements = await Likes.find({
    likedBy: req.user.id,
    post: { $in: achievementIds },
  });

  const formattedUserAchievements = handleLikedPostsLogic(
    userAchievements,
    likedUserAchievements,
  );

  const likeCountMap = await getLikeCounts(achievementIds);

  const finalUserAchievements = await mergePostsWithCount(
    formattedUserAchievements,
    likeCountMap,
  );

  const user = await User.findById(req.user.id)
    .populate({
      path: 'club_position.club',
      select: 'clubName',
    })
    .populate({
      path: 'blockedUsers',
      select: 'name username profilePicture_LowRes',
    });
  // console.log(`Clubs of user: ${user.club_position}`);
  const userData = {
    user,
    userAchievements: [...finalUserAchievements].reverse(),
  };

  res.status(200).json({
    status: 'success',
    data: {
      user: userData,
    },
  });
});

exports.getPostComments = catchAsync(async (req, res, next) => {
  const postId = req.params.postId;
  const cursorPostedOn = req.query.cursorPostedOn;
  const cursorId = req.query.cursorId;
  const modelType = req.query.type;

  let key;
  if (modelType === 'achievement') {
    key = `comments:achievement:${postId}`;
  } else if (modelType === 'anonymous') {
    key = `comments:anonymous:${postId}`;
  } else {
    return next(new AppError('Please provide valid comment type', 400));
  }

  let comments = await client.lRange(key, 0, 49);

  //  FIRST PAGE (NO CURSOR)
  if (!cursorPostedOn || !cursorId) {
    let cached = await client.lRange(key, 0, 49);

    if (cached.length > 0) {
      // console.log('Found cached!');

      const parsed = cached.map((c) => {
        const data = JSON.parse(c);

        return {
          _id: data._id || data.commentId, //  NEW (backward compatibility)
          userId: data.userId,
          username: data.username,
          userPfp: data.userPfp,
          text: data.text,
          postedOn: data.postedOn,
        };
      });

      const last = parsed[parsed.length - 1];

      //  NEW: ensure TTL always refreshed on read
      await client.expire(key, 1800);

      // console.log(parsed);

      return res.status(200).json({
        status: 'success',
        data: {
          comments: parsed,
          nextCursor: last ? { postedOn: last.postedOn, _id: last._id } : null,
          hasMore: true,
        },
      });
    }
    // console.log('Cache miss → querying DB');

    const commentsDB = await Comments.find({
      post: postId,
      user: { $nin: req.user.blockedUsers },
    })
      .populate({
        path: 'user',
        match: {
          blockedUsers: { $nin: [req.user.id] }, // FILTERED POPULATE!
        },
        select: 'username profilePicture_LowRes blockedUsers',
      })
      .sort({ postedOn: -1, _id: -1 })
      .limit(50)
      .lean();

    const formattedBlockedComments = commentsDB.filter(
      (c) => !c.user.blockedUsers.includes(req.user.id),
    );

    const formatted = formattedBlockedComments.map((c) => ({
      _id: String(c._id),
      userId: String(c.user._id),
      username: c.user.username,
      userPfp: c.user.profilePicture_LowRes || '',
      text: c.comment,
      postedOn: c.postedOn.toISOString(),
    }));

    const pipeline = client.multi();

    for (const c of formatted) {
      pipeline.rPush(key, JSON.stringify(c));
    }

    pipeline.lTrim(key, 0, 49);
    pipeline.expire(key, 1800);

    await pipeline.exec();

    const last = formatted[formatted.length - 1];

    // console.log(formatted);

    return res.status(200).json({
      status: 'success',
      data: {
        comments: formatted,
        nextCursor: last ? { postedOn: last.postedOn, _id: last._id } : null,
        hasMore: formatted.length === 50,
      },
    });
  }

  //  PAGINATION (WITH CURSOR)
  // console.log('Cursor pagination → DB');

  const commentsDB = await Comments.find({
    post: postId,
    user: { $nin: req.user.blockedUsers },
    $or: [
      { postedOn: { $lt: new Date(cursorPostedOn) } },
      {
        postedOn: new Date(cursorPostedOn),
        _id: { $lt: cursorId },
      },
    ],
  })
    .populate({
      path: 'user',
      match: {
        blockedUsers: { $nin: [req.user.id] }, // FILTERED POPULATE!
      },
      select: 'username profilePicture_LowRes blockedUsers',
    })
    .sort({ postedOn: -1, _id: -1 })
    .limit(50);

  const formattedBlockedComments = commentsDB.filter(
    ///// RUBBISH CODE!!!
    (c) => !c.user.blockedUsers.includes(req.user.id),
  );

  const formatted = formattedBlockedComments.map((c) => ({
    _id: String(c._id),
    userId: String(c.user._id),
    username: c.user.username,
    userPfp: c.user.profilePicture_LowRes || '',
    text: c.comment,
    postedOn: c.postedOn.toISOString(),
  }));

  const last = formatted[formatted.length - 1];

  return res.status(200).json({
    status: 'success',
    data: {
      comments: formatted,
      nextCursor: last ? { postedOn: last.postedOn, _id: last._id } : null,
      hasMore: formatted.length === 50,
    },
  });
});

// exports.getAnonymousComments = catchAsync(async (req, res, next) => {
//   const postId = req.params.postId;
//   const cursorPostedOn = req.query.cursorPostedOn;
//   const cursorId = req.query.cursorId;

//   const key = `comments:anonymous:${postId}`;

//   let comments = await client.lRange(`comments:anonymous:${postId}`, 0, 49);

//   //  FIRST PAGE (NO CURSOR)
//   if (!cursorPostedOn || !cursorId) {
//     let cached = await client.lRange(key, 0, 49);

//     if (cached.length > 0) {
//       console.log('Found cached!');

//       const parsed = cached.map((c) => JSON.parse(c));
//       const last = parsed[parsed.length - 1];

//       return res.status(200).json({
//         status: 'success',
//         data: {
//           comments: parsed,
//           nextCursor: last ? { postedOn: last.postedOn, _id: last._id } : null,
//           hasMore: true,
//         },
//       });
//     }
//     console.log('Cache miss → querying DB');

//     const commentsDB = await Comments.find({ post: postId })
//       .populate({ path: 'user', select: 'username profilePicture_LowRes' })
//       .sort({ postedOn: -1, _id: -1 })
//       .limit(50);

//     const formatted = commentsDB.map((c) => ({
//       _id: String(c._id),
//       userId: String(c.user._id),
//       username: c.user.username,
//       userPfp: c.user.profilePicture_LowRes || '',
//       text: c.comment,
//       postedOn: c.postedOn.toISOString(),
//     }));

//     const pipeline = client.multi();

//     for (const c of formatted) {
//       pipeline.lPush(key, JSON.stringify(c));
//     }

//     pipeline.lTrim(key, 0, 49);
//     pipeline.expire(key, 1800);

//     await pipeline.exec();

//     const last = formatted[formatted.length - 1];

//     return res.status(200).json({
//       status: 'success',
//       data: {
//         comments: formatted,
//         nextCursor: last ? { postedOn: last.postedOn, _id: last._id } : null,
//         hasMore: formatted.length === 50,
//       },
//     });
//   }

//   //  PAGINATION (WITH CURSOR)
//   console.log('Cursor pagination → DB');

//   const commentsDB = await Comments.find({
//     post: postId,
//     $or: [
//       { postedOn: { $lt: new Date(cursorPostedOn) } },
//       {
//         postedOn: new Date(cursorPostedOn),
//         _id: { $lt: cursorId },
//       },
//     ],
//   })
//     .populate({ path: 'user', select: 'username profilePicture_LowRes' })
//     .sort({ postedOn: -1, _id: -1 })
//     .limit(50);

//   const formatted = commentsDB.map((c) => ({
//     _id: String(c._id),
//     userId: String(c.user._id),
//     username: c.user.username,
//     userPfp: c.user.profilePicture_LowRes || '',
//     text: c.comment,
//     postedOn: c.postedOn.toISOString(),
//   }));

//   const last = formatted[formatted.length - 1];

//   return res.status(200).json({
//     status: 'success',
//     data: {
//       comments: formatted,
//       nextCursor: last ? { postedOn: last.postedOn, _id: last._id } : null,
//       hasMore: formatted.length === 50,
//     },
//   });
// });

exports.getAchievementPosts = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const feedKey = `feed:achievement:user:${userId}`;

  const cursor = parseInt(req.query.cursor || 0, 10);
  const PAGE_SIZE = 10;
  const MAX_POSTS = 50;
  const NEWEST_LIMIT = Math.floor(0.7 * MAX_POSTS);
  const OLDER_LIMIT = Math.floor(0.2 * MAX_POSTS);
  const RANDOM_LIMIT = MAX_POSTS - NEWEST_LIMIT - OLDER_LIMIT;
  const feedCacheExpiryTime = 100;
  /* ============================================================
     1 FAST PATH — USER FEED CACHE EXISTS (SCROLL / REVISIT)
     ============================================================ */
  const cachedFeedRaw = await client.get(feedKey);

  if (cachedFeedRaw) {
    let cachedFeed = JSON.parse(cachedFeedRaw);
    // console.log('cache found within length!');

    if (cursor < cachedFeed.length) {
      const page = cachedFeed.slice(cursor, cursor + PAGE_SIZE);

      /////// HANDLE ISLIKED STATE EVEN HERE BECAUSE NOW WE ARE NOT STORING ISLIKED IN FEED ///////
      const postIds = page.map((p) => p._id);

      // find the likes count
      const likeCountMap = await getLikeCounts(postIds);

      const likedPosts = await Likes.find({
        likedBy: userId,
        post: { $in: postIds },
      })
        .select('post')
        .lean();

      const pageWithLikeState = handleLikedPostsLogic(page, likedPosts);

      const finalPage = await mergePostsWithCount(
        pageWithLikeState,
        likeCountMap,
      );
      // console.log(finalPage);
      // console.log(
      //   `*THIS IS THE FAST PATH WITH CURSOR=${cursor} STILL IN LIMIT!*`, ///////////////////////////////DEBUGGING
      //   page.map((post) => post._id),
      // );
      // console.log(
      //   `nextCursor is: ${
      //     cursor + PAGE_SIZE < cachedFeed.length ///////////////////////////////DEBUGGING
      //       ? cursor + PAGE_SIZE
      //       : cachedFeed.length
      //   }`,
      // );

      return res.status(200).json({
        status: 'success',
        data: {
          achievements: finalPage,
          nextCursor:
            cursor + PAGE_SIZE < cachedFeed.length
              ? cursor + PAGE_SIZE
              : cachedFeed.length,
          hasMore: cursor + PAGE_SIZE < cachedFeed.length,
        },
      });
    }

    //  NEW: cursor reached end → extend feed with new candidates
    //  NOTE: we DO NOT delete old feed — we extend it

    /* ---------- 1.1 Get user embedding (still cached) ---------- */
    let userEmbedding = await client.get(`user:embedding:${userId}`);
    userEmbedding = JSON.parse(userEmbedding);

    // console.log('cache found out of length length!');
    /* ---------- 1.2 Fetch NEW candidate pool ---------- */

    //======= Convert cached post _id strings to mongoose object IDs for comparision ========//
    const cachedIds = cachedFeed.map(
      (post) => new mongoose.Types.ObjectId(post._id),
    );
    const excludeIds = new Set((cachedIds || []).map((id) => id));

    const newestPosts = await Achievements.find({
      _id: { $nin: Array.from(excludeIds) }, //  NEW avoid duplicates by using $nin
      user: { $nin: req.user.blockedUsers }, // DO NOT INCLUDE POSTS POSTED BY BLOCKED USERS BY US!
    })
      .sort({ postedOn: -1 })
      .limit(NEWEST_LIMIT)
      .lean();

    newestPosts.forEach((p) => excludeIds.add(p._id));

    const olderPosts = await Achievements.find({
      _id: { $nin: Array.from(excludeIds) }, //  NEW avoid duplicates by using $nin
      user: { $nin: req.user.blockedUsers }, // DO NOT INCLUDE POSTS POSTED BY BLOCKED USERS BY US!
    })
      .sort({ postedOn: -1 })
      .skip(NEWEST_LIMIT)
      .limit(OLDER_LIMIT)
      .lean();

    olderPosts.forEach((p) => excludeIds.add(p._id));
    const randomPosts = await Achievements.aggregate([
      {
        $match: {
          _id: { $nin: Array.from(excludeIds) },
          user: { $nin: req.user.blockedUsers }, // DO NOT INCLUDE POSTS POSTED BY BLOCKED USERS BY US!
        },
      },
      { $sample: { size: RANDOM_LIMIT } },
    ]);

    const candidatePosts = [...newestPosts, ...olderPosts, ...randomPosts];

    // const uniqueMap = new Map();

    // for (const post of candidatePosts) {
    //   uniqueMap.set(post._id.toString(), post);
    // }

    // const uniquePosts = Array.from(uniqueMap.values());
    // console.log(
    //   'IN FAST PATH, APPENDING NEW POSTS TO CACHE: ', ///////////////////////////////DEBUGGING
    //   uniquePosts.map((post) => post._id),
    // );

    if (candidatePosts.length === 0) {
      /////////////////////////// IMP IF USER HAS SEEN ALL POSTS EVER EXISTING, THAT IS THERE ARE NO MORE UNIQUE POSTS AVAILABLE
      return res.status(200).json({
        status: 'success',
        data: {
          achievements: [],
          nextCursor: cursor,
          hasMore: false,
        },
      });
    } //////// ###$IMP$### TO AVOID DUPLICATES CREATED DUE TO RANDOM POSTS WHICH MAY ALREADY INCLUDE THE NEWEST POSTS

    await Achievements.populate(candidatePosts, {
      path: 'user',
      match: {
        blockedUsers: { $nin: [req.user.id] }, // FILTERED POPULATE!
      },
      select:
        'profilePicture_LowRes openTo verifiedGuide aura username blockedUsers',
    });

    // REMOVE POSTS of users who have blocked the requesting user ->
    // we check the aray of blocked user for each post and if any array contains this user's ID, remove that post.
    // console.log('test log');
    // console.log(candidatePosts.map((p) => p.user.blockedUsers));
    // const formattedBlockedPosts = candidatePosts.filter(
    //   (p) => !p.user.blockedUsers.includes(req.user.id),
    // ); ////////////////////////////////////////////// DO NOT DO THIS RUBBISH!!!!
    const filteredPosts = candidatePosts.filter((p) => p.user !== null);

    const now = Date.now();

    filteredPosts.forEach((p) => {
      p.score =
        computePostScore({
          userEmbedding,
          post: p,
          now,
        }) +
        Math.random() * 0.01;
    });

    filteredPosts.sort((a, b) => b.score - a.score);

    /* ---------- 1.3 Remove heavy fields ---------- */
    const cleanedNewPosts = filteredPosts.map((p) => {
      const { image_embedding, text_embedding, score, ...rest } = p;
      return rest;
    });

    /* ---------- 1.5 Extend cached feed *WITHOUT ISLIKED STATE*---------- */
    cachedFeed = [...cachedFeed, ...cleanedNewPosts];

    //  CHANGE: overwrite cache with extended feed
    if (cleanedNewPosts.length !== 0) {
      await client.set(feedKey, JSON.stringify(cachedFeed), {
        EX: feedCacheExpiryTime,
      });
    }

    /* ---------- 1.4 Attach like state for response---------- */
    const page = cleanedNewPosts.slice(cursor, cursor + PAGE_SIZE);

    const postIds = page.map((p) => p._id);

    const likedPosts = await Likes.find({
      post: { $in: postIds },
      likedBy: userId,
    })
      .select('post')
      .lean();

    const newPageWithLike = handleLikedPostsLogic(page, likedPosts);

    const likeCountMap = await getLikeCounts(postIds);

    const finalPage = await mergePostsWithCount(newPageWithLike, likeCountMap);

    // console.log('//// FAST PATH //// newPostsWithLike: ', newPostsWithLike);

    // console.log(
    //   '*THIS IS THE FAST PATH WITH CURSOR REACHED END! THE FINAL CACHED FEED NOW IS*', ///////////////////////////////DEBUGGING
    //   cachedFeed.map((post) => post._id),
    // );
    // console.log(
    //   `nextCursor is ${
    //     cursor + PAGE_SIZE < cachedFeed.length ///////////////////////////////DEBUGGING
    //       ? cursor + PAGE_SIZE
    //       : cachedFeed.length
    //   }`,
    // );

    return res.status(200).json({
      status: 'success',
      data: {
        achievements: finalPage,
        nextCursor:
          cursor + PAGE_SIZE < cachedFeed.length
            ? cursor + PAGE_SIZE
            : cachedFeed.length,
        hasMore: cursor + PAGE_SIZE < cachedFeed.length,
      },
    });
  }

  /* ============================================================
     2 SLOW PATH — FEED REFRESH (RECOMMENDATION HAPPENS HERE)
     ============================================================ */
  // console.log('SLOW PATH START', Date.now());
  // console.log('cache NOT FOUND out of length length!');
  const seenPostIds = req.body.postIds;
  // console.log('The seen post IDs are: ', seenPostIds);
  let seenPostObjectIds = null;
  if (seenPostIds?.length < 50) {
    // console.log('YES THE POST IDs ARRAY is less than 50!');
    seenPostObjectIds = seenPostIds.map(
      (postId) => new mongoose.Types.ObjectId(postId),
    );
  }

  /* ---------- 2.1 Get or compute USER EMBEDDING ---------- */
  let userEmbedding = await client.get(`user:embedding:${userId}`);
  if (userEmbedding) {
    userEmbedding = JSON.parse(userEmbedding);
  }
  // console.log('userEmbeddings type: ', userEmbedding);
  if (!userEmbedding) {
    // cold start OR expired embedding
    // console.log('Entering if statement');
    userEmbedding = await computeUserEmbedding(
      userId,
      req.user.skills.join(' '),
    );
    const ttl = userEmbedding ? 3600 : 300;

    await client.set(
      `user:embedding:${userId}`,
      JSON.stringify(userEmbedding),
      { EX: ttl },
    );
  }
  /* ---------- 2.2 Fetch CANDIDATE POSTS ---------- */
  /* 70% of user recommended posts */

  // MAINTAIN A SET OF IDS YOU WILL EXCLUDE
  const excludeIds = new Set((seenPostObjectIds || []).map((id) => id));

  // console.log('EXLUDEIDS ARE: ', excludeIds);

  const newestPosts = await Achievements.find({
    _id: { $nin: Array.from(excludeIds) },
    user: { $nin: req.user.blockedUsers }, // DO NOT INCLUDE POSTS POSTED BY BLOCKED USERS BY US!
  })
    .sort({ postedOn: -1 })
    .limit(NEWEST_LIMIT) // 70% of MAX_POSTS
    .lean();

  /* 20% of slightly older posts */
  newestPosts.forEach((p) => excludeIds.add(p._id));
  const olderPosts = await Achievements.find({
    _id: { $nin: Array.from(excludeIds) },
    user: { $nin: req.user.blockedUsers }, // DO NOT INCLUDE POSTS POSTED BY BLOCKED USERS BY US!
  })
    .sort({ postedOn: -1 })
    .skip(NEWEST_LIMIT)
    .limit(OLDER_LIMIT) // 20%
    .lean();

  /* 10% of exploration posts */
  olderPosts.forEach((p) => excludeIds.add(p._id));
  const randomPosts = await Achievements.aggregate([
    {
      $match: {
        _id: { $nin: Array.from(excludeIds) },
        user: { $nin: req.user.blockedUsers }, // DO NOT INCLUDE POSTS POSTED BY BLOCKED USERS BY US!
      },
    },
    { $sample: { size: RANDOM_LIMIT } }, // 10%
  ]);

  const candidatePosts = [...newestPosts, ...olderPosts, ...randomPosts];
  // console.log('SO the final candidate posts are: ', candidatePosts);

  // const uniqueMap = new Map();

  // candidatePosts.forEach((post) => {
  //   uniqueMap.set(post._id.toString(), post);
  // });

  // const uniquePosts = Array.from(uniqueMap.values());

  if (candidatePosts.length === 0) {
    /////////////////////////// IMP IF USER HAS SEEN ALL POSTS EVER EXISTING, THAT IS THERE ARE NO MORE UNIQUE POSTS AVAILABLE
    return res.status(200).json({
      status: 'success',
      data: {
        achievements: [],
        nextCursor: cursor,
        hasMore: false,
      },
    });
  }

  await Achievements.populate(candidatePosts, {
    path: 'user',
    match: {
      blockedUsers: { $nin: [req.user.id] }, // FILTERED POPULATE!
    },
    select:
      'profilePicture_LowRes openTo verifiedGuide aura username blockedUsers',
  });

  // const formattedBlockedPosts = candidatePosts.filter( ///////////////////////// NO SUCH RUBBISH!!!!
  //   (p) => !p.user.blockedUsers.includes(req.user.id),
  // );

  const filteredPosts = candidatePosts.filter((p) => p.user !== null);
  /* ---------- 2.3 Rank posts by SEMANTIC SIMILARITY ---------- */
  const now = Date.now();

  filteredPosts.forEach((p) => {
    p.score =
      computePostScore({
        userEmbedding,
        post: p,
        now,
      }) +
      Math.random() * 0.01; // ensures feed never looks identical
  });

  filteredPosts.sort((a, b) => b.score - a.score);

  /* ---------- 2.4 Slice first page posts and send response with nextCursor ---------- */
  const firstPagePosts = filteredPosts.map((p) => {
    const { image_embedding, text_embedding, score, ...rest } = p;
    return rest;
  });
  // cache ALL 300 POSTS WITHOUT ISLIKED STATE!
  await client.set(
    feedKey,
    JSON.stringify(firstPagePosts),
    { EX: feedCacheExpiryTime }, // same TTL
  );

  /* ---------- 2.7 Return first page ---------- */
  let firstPage;
  if (seenPostObjectIds) firstPage = firstPagePosts.slice(cursor, PAGE_SIZE);
  else firstPage = firstPagePosts.slice(0, PAGE_SIZE);

  const postIds = firstPage.map((p) => p._id);

  const likedPosts = await Likes.find({
    post: { $in: postIds },
    likedBy: userId,
  })
    .select('post')
    .lean();

  const postsWithLikeState = handleLikedPostsLogic(firstPage, likedPosts);

  const likeCountMap = await getLikeCounts(postIds);

  const finalPage = await mergePostsWithCount(postsWithLikeState, likeCountMap);
  // console.log('//// SLOW PATH //// postsWithLikeState: ', postsWithLikeState);

  // if (cachedFeedRaw)
  //   console.log(
  //     '*THIS IS THE SLOW PATH! THE POSTS THAT ARE CACHED ALREADY*',
  //     cachedFeedRaw.map((post) => post._id), ///////////////////////////////DEBUGGING
  //   );
  // console.log(
  //   '*THIS IS THE SLOW PATH! THE POSTS THAT WILL BE CACHED ARE*',
  //   postsWithLikeState /*.map((post) => post._id),*/, ///////////////////////////////DEBUGGING
  // );

  // console.log(
  //   `nextCursor is ${Math.min(cursor + PAGE_SIZE, postsWithLikeState.length)}`,
  // );

  let freshFeed = true;
  if (seenPostObjectIds) {
    freshFeed = false;
  }

  return res.status(200).json({
    status: 'success',
    data: {
      achievements: finalPage,
      nextCursor: Math.min(cursor + PAGE_SIZE, postsWithLikeState.length),
      hasMore: PAGE_SIZE < postsWithLikeState.length,
      freshFeed,
      feedExpiresAt: Date.now() + feedCacheExpiryTime,
    },
  });
});

exports.getAnonymousPosts = catchAsync(async (req, res, next) => {
  const userId = req.user.id;
  const feedKey = `feed:anonymous:user:${userId}`;

  console.log('entered getAnonymousPosts');
  const cursor = parseInt(req.query.cursor || 0, 10);
  const PAGE_SIZE = 10;
  const MAX_POSTS = 50;
  const NEWEST_LIMIT = Math.floor(0.7 * MAX_POSTS);
  const OLDER_LIMIT = Math.floor(0.2 * MAX_POSTS);
  const RANDOM_LIMIT = MAX_POSTS - NEWEST_LIMIT - OLDER_LIMIT;
  const feedCacheExpiryTime = 100;
  /* ============================================================
     1 FAST PATH — USER FEED CACHE EXISTS (SCROLL / REVISIT)
     ============================================================ */
  const cachedFeedRaw = await client.get(feedKey);

  if (cachedFeedRaw) {
    let cachedFeed = JSON.parse(cachedFeedRaw);

    if (cursor < cachedFeed.length) {
      const page = cachedFeed.slice(cursor, cursor + PAGE_SIZE);

      /////// HANDLE ISLIKED STATE EVEN HERE BECAUSE NOW WE ARE NOT STORING ISLIKED IN FEED ///////
      const postIds = page.map((p) => p._id);

      const likeCountMap = await getLikeCounts(postIds);

      const likedPosts = await Likes.find({
        likedBy: userId,
        post: { $in: postIds },
      })
        .select('post')
        .lean();

      const pageWithLikeState = handleLikedPostsLogic(page, likedPosts);

      const finalPage = await mergePostsWithCount(
        pageWithLikeState,
        likeCountMap,
      );

      // console.log(
      //   `*THIS IS THE FAST PATH WITH CURSOR=${cursor} STILL IN LIMIT!*`, ///////////////////////////////DEBUGGING
      //   page.map((post) => post._id),
      // );
      // console.log(
      //   `nextCursor is: ${
      //     cursor + PAGE_SIZE < cachedFeed.length ///////////////////////////////DEBUGGING
      //       ? cursor + PAGE_SIZE
      //       : cachedFeed.length
      //   }`,
      // );

      return res.status(200).json({
        status: 'success',
        data: {
          anonymous: finalPage,
          nextCursor:
            cursor + PAGE_SIZE < cachedFeed.length
              ? cursor + PAGE_SIZE
              : cachedFeed.length,
          hasMore: cursor + PAGE_SIZE < cachedFeed.length,
        },
      });
    }

    //  NEW: cursor reached end → extend feed with new candidates
    //  NOTE: we DO NOT delete old feed — we extend it

    /* ---------- 1.1 Get user embedding (still cached) ---------- */
    let userEmbedding = await client.get(`user:embedding:${userId}`);
    userEmbedding = JSON.parse(userEmbedding);

    /* ---------- 1.2 Fetch NEW candidate pool ---------- */

    //======= Convert cached post _id strings to mongoose object IDs for comparision ========//
    const cachedIds = cachedFeed.map(
      (post) => new mongoose.Types.ObjectId(post._id),
    );
    const excludeIds = new Set((cachedIds || []).map((id) => id));

    const newestPosts = await Anonymous.find({
      _id: { $nin: Array.from(excludeIds) }, //  NEW avoid duplicates by using $nin
    })
      .sort({ postedOn: -1 })
      .limit(NEWEST_LIMIT)
      .lean();

    newestPosts.forEach((p) => excludeIds.add(p._id));

    const olderPosts = await Anonymous.find({
      _id: { $nin: Array.from(excludeIds) }, //  NEW avoid duplicates by using $nin
    })
      .sort({ postedOn: -1 })
      .skip(NEWEST_LIMIT)
      .limit(OLDER_LIMIT)
      .lean();

    olderPosts.forEach((p) => excludeIds.add(p._id));
    const randomPosts = await Anonymous.aggregate([
      {
        $match: {
          _id: { $nin: Array.from(excludeIds) },
        },
      },
      { $sample: { size: RANDOM_LIMIT } },
    ]);

    const candidatePosts = [...newestPosts, ...olderPosts, ...randomPosts];

    // const uniqueMap = new Map();

    // for (const post of candidatePosts) {
    //   uniqueMap.set(post._id.toString(), post);
    // }

    // const uniquePosts = Array.from(uniqueMap.values());
    // console.log(
    //   'IN FAST PATH, APPENDING NEW POSTS TO CACHE: ', ///////////////////////////////DEBUGGING
    //   uniquePosts.map((post) => post._id),
    // );

    if (candidatePosts.length === 0) {
      /////////////////////////// IMP IF USER HAS SEEN ALL POSTS EVER EXISTING, THAT IS THERE ARE NO MORE UNIQUE POSTS AVAILABLE
      return res.status(200).json({
        status: 'success',
        data: {
          anonymous: [],
          nextCursor: cursor,
          hasMore: false,
        },
      });
    } //////// ###$IMP$### TO AVOID DUPLICATES CREATED DUE TO RANDOM POSTS WHICH MAY ALREADY INCLUDE THE NEWEST POSTS

    await Anonymous.populate(candidatePosts, {
      path: 'user',
      select: 'profilePicture_LowRes openTo verifiedGuide aura username',
    });

    const now = Date.now();

    candidatePosts.forEach((p) => {
      p.score =
        computePostScore({
          userEmbedding,
          post: p,
          now,
        }) +
        Math.random() * 0.01;
    });

    candidatePosts.sort((a, b) => b.score - a.score);

    /* ---------- 1.3 Remove heavy fields ---------- */
    const cleanedNewPosts = candidatePosts.map((p) => {
      const { image_embedding, text_embedding, score, ...rest } = p;
      return rest;
    });

    /* ---------- 1.5 Extend cached feed *WITHOUT ISLIKED STATE*---------- */
    cachedFeed = [...cachedFeed, ...cleanedNewPosts];

    //  CHANGE: overwrite cache with extended feed
    if (cleanedNewPosts.length !== 0) {
      await client.set(feedKey, JSON.stringify(cachedFeed), {
        EX: feedCacheExpiryTime,
      });
    }

    /* ---------- 1.4 Attach like state for response---------- */
    const page = cleanedNewPosts.slice(cursor, cursor + PAGE_SIZE);

    const postIds = page.map((p) => p._id);

    const likeCountMap = await getLikeCounts(postIds);

    const likedPosts = await Likes.find({
      post: { $in: postIds },
      likedBy: userId,
    })
      .select('post')
      .lean();

    const newPageWithLike = handleLikedPostsLogic(page, likedPosts);

    const finalPage = await mergePostsWithCount(newPageWithLike, likeCountMap);

    // console.log('//// FAST PATH //// newPostsWithLike: ', newPostsWithLike);

    // console.log(
    //   '*THIS IS THE FAST PATH WITH CURSOR REACHED END! THE FINAL CACHED FEED NOW IS*', ///////////////////////////////DEBUGGING
    //   cachedFeed.map((post) => post._id),
    // );
    // console.log(
    //   `nextCursor is ${
    //     cursor + PAGE_SIZE < cachedFeed.length ///////////////////////////////DEBUGGING
    //       ? cursor + PAGE_SIZE
    //       : cachedFeed.length
    //   }`,
    // );

    return res.status(200).json({
      status: 'success',
      data: {
        anonymous: finalPage,
        nextCursor:
          cursor + PAGE_SIZE < cachedFeed.length
            ? cursor + PAGE_SIZE
            : cachedFeed.length,
        hasMore: cursor + PAGE_SIZE < cachedFeed.length,
      },
    });
  }

  /* ============================================================
     2 SLOW PATH — FEED REFRESH (RECOMMENDATION HAPPENS HERE)
     ============================================================ */
  // console.log('SLOW PATH START', Date.now());
  const seenPostIds = req.body.postIds;
  // console.log('The seen post IDs are: ', seenPostIds);
  let seenPostObjectIds = null;
  if (seenPostIds?.length < 50) {
    // console.log('YES THE POST IDs ARRAY is less than 50!');
    seenPostObjectIds = seenPostIds.map(
      (postId) => new mongoose.Types.ObjectId(postId),
    );
  }

  /* ---------- 2.1 Get or compute USER EMBEDDING ---------- */
  let userEmbedding = await client.get(`user:embedding:${userId}`);
  if (userEmbedding) {
    userEmbedding = JSON.parse(userEmbedding);
  }
  // console.log('userEmbeddings type: ', userEmbedding);
  if (!userEmbedding) {
    // cold start OR expired embedding
    // console.log('Entering if statement');
    userEmbedding = await computeUserEmbedding(
      userId,
      req.user.skills.join(' '),
    );
    const ttl = userEmbedding ? 3600 : 300;

    await client.set(
      `user:embedding:${userId}`,
      JSON.stringify(userEmbedding),
      { EX: ttl },
    );
  }
  /* ---------- 2.2 Fetch CANDIDATE POSTS ---------- */
  /* 70% of user recommended posts */

  // MAINTAIN A SET OF IDS YOU WILL EXCLUDE
  const excludeIds = new Set((seenPostObjectIds || []).map((id) => id));

  // console.log('EXLUDEIDS ARE: ', excludeIds);

  const newestPosts = await Anonymous.find({
    _id: { $nin: Array.from(excludeIds) },
  })
    .sort({ postedOn: -1 })
    .limit(NEWEST_LIMIT) // 70% of MAX_POSTS
    .lean();

  /* 20% of slightly older posts */
  newestPosts.forEach((p) => excludeIds.add(p._id));
  const olderPosts = await Anonymous.find({
    _id: { $nin: Array.from(excludeIds) },
  })
    .sort({ postedOn: -1 })
    .skip(NEWEST_LIMIT)
    .limit(OLDER_LIMIT) // 20%
    .lean();

  /* 10% of exploration posts */
  olderPosts.forEach((p) => excludeIds.add(p._id));
  const randomPosts = await Anonymous.aggregate([
    {
      $match: {
        _id: { $nin: Array.from(excludeIds) },
      },
    },
    { $sample: { size: RANDOM_LIMIT } }, // 10%
  ]);

  const candidatePosts = [...newestPosts, ...olderPosts, ...randomPosts];
  // console.log('SO the final candidate posts are: ', candidatePosts);

  // const uniqueMap = new Map();

  // candidatePosts.forEach((post) => {
  //   uniqueMap.set(post._id.toString(), post);
  // });

  // const uniquePosts = Array.from(uniqueMap.values());

  if (candidatePosts.length === 0) {
    /////////////////////////// IMP IF USER HAS SEEN ALL POSTS EVER EXISTING, THAT IS THERE ARE NO MORE UNIQUE POSTS AVAILABLE
    return res.status(200).json({
      status: 'success',
      data: {
        anonymous: [],
        nextCursor: cursor,
        hasMore: false,
      },
    });
  }

  await Anonymous.populate(candidatePosts, {
    path: 'user',
    select: 'profilePicture_LowRes openTo verifiedGuide aura username',
  });
  /* ---------- 2.3 Rank posts by SEMANTIC SIMILARITY ---------- */
  const now = Date.now();

  candidatePosts.forEach((p) => {
    p.score =
      computePostScore({
        userEmbedding,
        post: p,
        now,
      }) +
      Math.random() * 0.01; // ensures feed never looks identical
  });

  candidatePosts.sort((a, b) => b.score - a.score);

  /* ---------- 2.4 Slice first page posts and send response with nextCursor ---------- */
  const firstPagePosts = candidatePosts.map((p) => {
    const { image_embedding, text_embedding, score, ...rest } = p;
    return rest;
  });
  // cache ALL 300 POSTS WITHOUT ISLIKED STATE!
  await client.set(
    feedKey,
    JSON.stringify(firstPagePosts),
    { EX: feedCacheExpiryTime }, // same TTL
  );

  /* ---------- 2.7 Return first page ---------- */
  let firstPage;
  if (seenPostObjectIds) firstPage = firstPagePosts.slice(cursor, PAGE_SIZE);
  else firstPage = firstPagePosts.slice(0, PAGE_SIZE);

  const postIds = firstPage.map((p) => p._id);

  const likeCountMap = await getLikeCounts(postIds);

  const likedPosts = await Likes.find({
    post: { $in: postIds },
    likedBy: userId,
  })
    .select('post')
    .lean();

  const postsWithLikeState = handleLikedPostsLogic(firstPage, likedPosts);

  const finalPage = await mergePostsWithCount(postsWithLikeState, likeCountMap);
  // console.log('//// SLOW PATH //// postsWithLikeState: ', postsWithLikeState);

  // if (cachedFeedRaw)
  //   console.log(
  //     '*THIS IS THE SLOW PATH! THE POSTS THAT ARE CACHED ALREADY*',
  //     cachedFeedRaw.map((post) => post._id), ///////////////////////////////DEBUGGING
  //   );
  // console.log(
  //   '*THIS IS THE SLOW PATH! THE POSTS THAT WILL BE CACHED ARE*',
  //   postsWithLikeState /*.map((post) => post._id),*/, ///////////////////////////////DEBUGGING
  // );

  // console.log(
  //   `nextCursor is ${Math.min(cursor + PAGE_SIZE, postsWithLikeState.length)}`,
  // );

  let freshFeed = true;
  if (seenPostObjectIds) {
    freshFeed = false;
  }

  return res.status(200).json({
    status: 'success',
    data: {
      anonymous: finalPage,
      nextCursor: Math.min(cursor + PAGE_SIZE, postsWithLikeState.length),
      hasMore: PAGE_SIZE < postsWithLikeState.length,
      freshFeed,
      feedExpiresAt: Date.now() + feedCacheExpiryTime,
    },
  });
});

// exports.getAnonymousPosts = catchAsync(async (req, res, next) => {
//   let anonymous = await client.lRange('anonymous:list', 0, 100);
//   let likedPosts, statusCode, status;

//   if (anonymous.length > 0) {
//     console.log('cache found!');
//     ////////////////////////////////////////////////////////////////////////////////
//     // Handle the recommendation logic first!
//     ////////////////////////////////////////////////////////////////////////////////
//     const pipeline = client.multi();
//     for (const key of anonymous) pipeline.hGetAll(key);
//     let cachedAnonymous = await pipeline.exec();

//     const postIds = cachedAnonymous.map((a) => a._id);

//     console.log(postIds);

//     likedPosts = await Likes.find({
//       post: { $in: postIds },
//       likedBy: req.user.id,
//     }).select('post');

//     const recommendedAnonymous = handleLikedPostsLogic(
//       cachedAnonymous,
//       likedPosts,
//     );

//     res.status(200).json({
//       status: 'success',
//       data: {
//         recommendedAnonymous,
//       },
//     });
//   } else {
//     console.log('Querying the DB!');
//     let session;
//     try {
//       session = await mongoose.startSession();
//       session.startTransaction();
//       anonymous = await Anonymous.find()
//         .session(session)
//         .populate({ path: 'user', select: 'name profilePicture_LowRes' })
//         .sort({ postedOn: -1 })
//         .limit(100)
//         .lean();
//       const postIds = anonymous.map((p) => p._id);
//       likedPosts = await Likes.find({
//         post: { $in: postIds },
//         likedBy: req.user.id,
//       })
//         .session(session)
//         .select('post');
//       await session.commitTransaction();
//       ((statusCode = 200), (status = 'success'));
//     } catch (error) {
//       await session.abortTransaction();
//       console.error('Transaction aborted:', error);
//       ((statusCode = 500), (status = 'failed'));
//     } finally {
//       await session.endSession();
//     }

//     const recommendedAnonymous = handleLikedPostsLogic(anonymous, likedPosts);

//     ////////////////////////////////////////////////////////////////////////////////
//     // Handle the recommendation logic first!
//     ////////////////////////////////////////////////////////////////////////////////
//     const pipeline = client.multi();
//     for (const A of recommendedAnonymous) {
//       const hashKey = `anonymous:${A._id.toString()}`;
//       console.log('User Id here is: ', A.user);
//       pipeline.hSet(hashKey, {
//         _id: A._id.toString(),
//         userId: A.user._id.toString(),
//         name: A.user.name,
//         userPfp: A.user.profilePicture_LowRes || '',
//         photo: A.photo || '',
//         message: A.message || '',
//         postedOn: A.postedOn,
//         likes: A.likes,
//         // isLiked: A.isLiked.toString(), // NO NEED FOR THIS! THIS WILL ALSO BE WRONG TO STORE USER SPECIFIC LIKE IN GLOBAL POST CACHE
//       });
//       pipeline.expire(hashKey, 3600);
//       pipeline.lPush(`anonymous:list`, hashKey);
//     }
//     pipeline.expire(`anonymous:list`, 1800);
//     await pipeline.exec();

//     res.status(statusCode).json({
//       status,
//       data: {
//         recommendedAnonymous,
//       },
//     });
//   }
// });

// exports.getNotifications = catchAsync(async (req, res, next) => {
//   const allNotifications = await Notification.find({ to: req.user.id })
//     .populate({ path: 'from', select: 'name role profilePicture_LowRes ' })
//     .sort({ postedOn: -1 });

//   res.status(200).json({
//     status: 'success',
//     results: allNotifications.length,
//     data: {
//       allNotifications,
//     },
//   });
// });
exports.getNotifications = catchAsync(async (req, res, next) => {
  const userId = req.user.id;

  const cursorPostedOn = req.query.cursorPostedOn;
  const cursorId = req.query.cursorId;

  const key = `notifications:${userId}`;

  // =========================
  // FIRST PAGE
  // =========================
  if (!cursorPostedOn || !cursorId) {
    const cached = await client.lRange(key, 0, 49);

    if (cached.length > 0) {
      // console.log('Notifications → cache hit');

      const parsed = cached.map((n) => JSON.parse(n));
      const last = parsed[parsed.length - 1];

      return res.status(200).json({
        status: 'success',
        data: {
          notifications: parsed,
          nextCursor: last ? { postedOn: last.postedOn, _id: last._id } : null,
          hasMore: parsed.length === 50, // ✅ FIXED
        },
      });
    }

    // console.log('Notifications → cache miss → DB');

    const notificationsDB = await Notification.find({ to: userId })
      .populate({
        path: 'from',
        select: 'name role profilePicture_LowRes',
      })
      .sort({ postedOn: -1, _id: -1 })
      .limit(50);

    const formatted = notificationsDB.map((n) => ({
      _id: String(n._id),

      from: n.from
        ? {
            _id: String(n.from._id),
            name: n.from.name,
            role: n.from.role,
            profilePicture: n.from.profilePicture_LowRes || '',
          }
        : null,

      heading: n.heading,
      body: n.body,
      action: n.action || {},
      postedOn: n.postedOn.toISOString(),
    }));

    // ===== CACHE STORE (ORDER FIXED)
    const pipeline = client.multi();

    for (const n of formatted) {
      pipeline.rPush(key, JSON.stringify(n)); // ✅ FIXED
    }

    pipeline.lTrim(key, 0, 49);
    pipeline.expire(key, 1800);

    await pipeline.exec();

    const last = formatted[formatted.length - 1];

    return res.status(200).json({
      status: 'success',
      data: {
        notifications: formatted,
        nextCursor: last ? { postedOn: last.postedOn, _id: last._id } : null,
        hasMore: formatted.length === 50,
      },
    });
  }

  // =========================
  // PAGINATION
  // =========================
  const notificationsDB = await Notification.find({
    to: userId,
    $or: [
      { postedOn: { $lt: new Date(cursorPostedOn) } },
      {
        postedOn: new Date(cursorPostedOn),
        _id: { $lt: cursorId },
      },
    ],
  })
    .populate({
      path: 'from',
      select: 'name role profilePicture_LowRes',
    })
    .sort({ postedOn: -1, _id: -1 })
    .limit(50);

  const formatted = notificationsDB.map((n) => ({
    _id: String(n._id),

    from: n.from
      ? {
          _id: String(n.from._id),
          name: n.from.name,
          role: n.from.role,
          profilePicture: n.from.profilePicture_LowRes || '',
        }
      : null,

    heading: n.heading,
    body: n.body,
    action: n.action || {},
    postedOn: n.postedOn.toISOString(),
  }));

  const last = formatted[formatted.length - 1];

  return res.status(200).json({
    status: 'success',
    data: {
      notifications: formatted,
      nextCursor: last ? { postedOn: last.postedOn, _id: last._id } : null,
      hasMore: formatted.length === 50,
    },
  });
});

/////////////////////////// !!! UPDATE !!! UPDATED THE USER FINDING WAY WITH A BETTER FINDING METHOD!
exports.searchUsers = catchAsync(async (req, res, next) => {
  const { name } = req.body;
  // console.log('entered search users with name: ', name);
  if (!name || name.length < 2) {
    //////////// ADDED SAFETY VALIDATION!
    return res.json({ status: 'success', data: { users: [] } });
  }

  let users = await User.find({
    _id: { $nin: req.user.blockedUsers },
    active: true,
    blockedUsers: { $ne: req.user.id },
    $or: [
      { username: { $regex: '^' + name, $options: 'i' } },
      { name: { $regex: '^' + name, $options: 'i' } },
      // { skills: { $regex: '^' + name, $options: 'i' } },
    ],
  })
    .limit(20)
    .lean();

  if (users.length < 5) {
    users = await User.find({
      _id: { $nin: req.user.blockedUsers },
      active: true,
      blockedUsers: { $ne: req.user.id },
      $or: [
        { username: { $regex: '^' + name, $options: 'i' } },
        { name: { $regex: name, $options: 'i' } },
        // { skills: { $regex: name, $options: 'i' } },
      ],
    })
      .limit(20)
      .lean();
  }

  const formattedUsers = users.filter(
    (u) => !u.blockedUsers.includes(req.user.id),
  );

  res.status(200).json({
    status: 'success',
    data: {
      users: users,
    },
  });
});

exports.getOtherProfile = catchAsync(async (req, res, next) => {
  const { userId } = req.params;
  if (!userId) {
    return next(new AppError('Please provide userId', 400));
  }

  if (req.user.blockedUsers.includes(userId)) {
    return next(new AppError('User not found', 404));
  }

  const user = await User.findOne({
    _id: userId,
    blockedUsers: { $nin: [req.user.id] }, //  they should NOT have blocked me
    active: true,
  }).populate({
    path: 'club_position.club',
    select: 'clubName',
  });

  // if user has blocked this user or this user has blocked this user, send 404
  if (!user) {
    return next(new AppError('User not found', 404));
  }
  const userAchievements = await Achievements.find({
    user: userId,
  }).lean();
  const achievementIds = userAchievements.map((a) => a._id);
  const likedUserAchievements = await Likes.find({
    likedBy: req.user.id,
    post: { $in: achievementIds },
  });

  // console.log(likedUserAchievements);
  const formattedUserAchievements = handleLikedPostsLogic(
    userAchievements,
    likedUserAchievements,
  );

  const likeCountMap = await getLikeCounts(achievementIds);

  const finalUserAchievements = await mergePostsWithCount(
    formattedUserAchievements,
    likeCountMap,
  );

  // console.log(`Clubs of user: ${user.club_position}`);
  const userData = {
    user,
    userAchievements: [...finalUserAchievements].reverse(),
  };

  res.status(200).json({
    status: 'success',
    data: {
      user: userData,
    },
  });
});

exports.blockUser = catchAsync(async (req, res, next) => {
  const { userId } = req.params;

  if (!userId) {
    return next(new AppError('Provide user ID', 400));
  }

  if (userId.toString() === req.user.id.toString()) {
    return next(new AppError('You cannot block yourself', 400));
  }

  if (req.user.blockedUsers.includes(userId)) {
    return next(new AppError('You have already blocked this user', 400));
  }

  const user = await User.findById(userId);

  if (!user) return next(new AppError('No such user found', 404));

  await User.findByIdAndUpdate(req.user.id, {
    $addToSet: { blockedUsers: userId },
  });

  res.status(200).json({
    status: 'success',
  });
});

exports.unblockUser = catchAsync(async (req, res, next) => {
  const { userId } = req.params;

  if (!userId) {
    return next(new AppError('Provide user ID', 400));
  }

  if (userId.toString() === req.user.id.toString()) {
    return next(new AppError('You cannot unblock yourself', 400));
  }

  if (!req.user.blockedUsers.includes(userId)) {
    return next(new AppError('You have not blocked this user', 400));
  }

  const user = await User.findById(userId);

  if (!user) return next(new AppError('No such user found', 404));

  await User.findByIdAndUpdate(req.user.id, {
    $pull: { blockedUsers: userId },
  });

  res.status(200).json({
    status: 'success',
  });
});
