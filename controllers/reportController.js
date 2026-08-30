const mongoose = require('mongoose');
const Report = require('../models/reportModel');
const catchAsync = require('../utils/catchAsync');
const AppError = require('../utils/appError');
const Achievements = require('../models/achievementsModel');
const Anonymous = require('../models/anonymousModel');
const { cloudinary } = require('../utils/cloudinary');
const client = require('../redisClient');

/*

1) create report (achievements) - user
2) create report (anonymous) - user
3) get all reportedPosts (both) - admin
4) delete reported posts from both - admin
5) review posts and delete from both - admin
6) Infinite scroll for reports - admin

*/

//------------------FACTORY HANDLER (CREATE - user) ------------------------------------//
const createOne = (Model, modelName) =>
  catchAsync(async (req, res, next) => {
    const reportedPostId = req.params.postId;

    const post = await Model.findById(reportedPostId);

    if (!post) {
      return next(new AppError('Post with this ID do not exist', 404));
    }

    const alreadyReported = await Report.findOne({
      reportedBy: req.user.id,
      reportedPostId,
      postModel: modelName,
    });

    if (alreadyReported) {
      return next(new AppError('You have already reported for this post', 400));
    }

    const doc = await Report.create({
      reportedPostId,
      postModel: modelName,
      reportedBy: req.user.id,
      category: req.body.category,
      reportStatus: 'pending',
    });

    res.status(201).json({
      status: 'success',
      data: {
        doc,
      },
    });
  });

//------------------FACTORY HANDLER (GET - admin) ------------------------------------//

const getAll = (Model, whichModel) =>
  catchAsync(async (req, res, next) => {
    const docs = await Model.find({ postModel: whichModel });

    res.status(200).json({
      status: 'success',
      results: docs.length,
      data: {
        docs,
      },
    });
  });

// ---------------- FACTORY HANDLER (delete - admin) ----------------------------------------------------//
const deleteReportedPost = (Model) =>
  catchAsync(async (req, res, next) => {
    const post = await Model.findById(req.params.postId);
    // console.log('EVENT ID DELETE = ', post);

    if (!post) {
      return next(new AppError('No post with this ID found', 404));
    }

    const report = await Report.findOne({ reportedPostId: req.params.postId });

    if (!report) {
      return next(
        new AppError('This post exists, but not reported by anyone', 400),
      );
    }

    // Delete images from Cloudinary in parallel
    if (post.photos && post.photos.length > 0) {
      await Promise.all(
        post.photos.map((photo) => cloudinary.uploader.destroy(photo.photoID)),
      );
    }

    // deleting from post and report both
    await Model.findByIdAndDelete(req.params.postId);
    await Report.deleteMany({ reportedPostId: req.params.postId });

    res.status(204).json({
      status: 'success',
      data: null,
    });
  });

// ------------------------- REVIEW POST IF YES KEEP IN POST AND DELETE THE REPORT ----------------------------//
const reviewReport = (Model) =>
  catchAsync(async (req, res, next) => {
    const post = await Model.findById(req.params.postId);

    if (!post) {
      return next(new AppError('No post with this ID found', 404));
    }

    const report = await Report.findOne({ reportedPostId: req.params.postId });

    if (!report) {
      return next(
        new AppError('This post exists, but not reported by anyone', 400),
      );
    }

    await Report.deleteMany({ reportedPostId: req.params.postId });

    res.status(204).json({
      status: 'success',
      message: 'Reported post is not voilating verve policy',
      data: null,
    });
  });

// ------------------ GET ALL POSTS IN SCROLL (soujanya - KushBhai) ---------------------------------//
exports.getReports = catchAsync(async (req, res, next) => {
  const { cursorTime, cursorId, type } = req.query;

  const limit = parseInt(req.query.limit) || 50;

  // 🔹 Validate type
  if (!type || !['Achievements', 'Anonymous'].includes(type)) {
    return next(new AppError('Invalid report type, please use valid one', 400));
  }

  // 🔹 Redis Key
  const key = `reports:${type}`;

  // 🟢 FIRST PAGE (NO CURSOR)
  if (!cursorTime || !cursorId) {
    // 🔹 Try Redis
    const cached = await client.lRange(key, 0, limit - 1);

    if (cached.length > 0) {
      const parsed = cached.map((c) => JSON.parse(c));
      const last = parsed[parsed.length - 1];

      return res.status(200).json({
        status: 'success',
        data: {
          reports: parsed,
          nextCursor: last
            ? { cursorTime: last.createdAt, cursorId: last._id }
            : null,
          hasMore: true,
        },
      });
    }

    // 🔴 CACHE MISS → DB
    const reportsDB = await Report.find({ postModel: type })
      .populate({
        path: 'reportedBy',
        select: 'username',
      })
      .sort({ createdAt: -1, _id: -1 })
      .limit(limit);

    // 🔹 Format Data
    const formatted = reportsDB.map((r) => ({
      _id: String(r._id),
      reportedPostId: String(r.reportedPostId),
      postModel: r.postModel,
      reportedBy: {
        _id: String(r.reportedBy._id),
        username: r.reportedBy.username,
      },
      reason: r.category,
      createdAt: r.createdAt.toISOString(),
    }));

    // 🔹 Store in Redis
    const pipeline = client.multi();

    formatted.forEach((r) => {
      pipeline.lPush(key, JSON.stringify(r));
    });

    pipeline.lTrim(key, 0, limit - 1);
    pipeline.expire(key, 1800);

    await pipeline.exec();

    const last = formatted[formatted.length - 1];

    return res.status(200).json({
      status: 'success',
      data: {
        reports: formatted,
        nextCursor: last
          ? { cursorTime: last.createdAt, cursorId: last._id }
          : null,
        hasMore: formatted.length === limit,
      },
    });
  }

  // 🟡 PAGINATION (WITH CURSOR → DB ONLY)

  const reportsDB = await Report.find({
    postModel: type,
    $or: [
      { createdAt: { $lt: new Date(cursorTime) } },
      {
        createdAt: new Date(cursorTime),
        _id: { $lt: cursorId },
      },
    ],
  })
    .populate({
      path: 'reportedBy',
      select: 'username',
    })
    .sort({ createdAt: -1, _id: -1 })
    .limit(limit);

  // 🔹 Format Data
  const formatted = reportsDB.map((r) => ({
    _id: String(r._id),
    reportedPostId: String(r.reportedPostId),
    postModel: r.postModel,
    reportedBy: {
      _id: String(r.reportedBy._id),
      username: r.reportedBy.username,
    },
    reason: r.catgory,
    createdAt: r.createdAt.toISOString(),
  }));

  const last = formatted[formatted.length - 1];

  return res.status(200).json({
    status: 'success',
    data: {
      reports: formatted,
      nextCursor: last
        ? { cursorTime: last.createdAt, cursorId: last._id }
        : null,
      hasMore: formatted.length === limit,
    },
  });
});

// --------- CALLING FACTORY HANDLERS -----------------------------------------//

// 1) user activity
exports.createAchievementsReport = createOne(Achievements, 'Achievements');
exports.createAnonymousReport = createOne(Anonymous, 'Anonymous');

// 2) get all - admin
exports.getAllReportedAchievements = getAll(Report, 'Achievements');
exports.getAllReportedAnonymous = getAll(Report, 'Anonymous');

// 3) delete - admin
exports.deleteReportedAchievement = deleteReportedPost(Achievements);
exports.deleteReportedAnonymous = deleteReportedPost(Anonymous);

// 4) review - admin
exports.reviewReportedPostAchievement = reviewReport(Achievements);
exports.reviewReportedPostAnonymous = reviewReport(Anonymous);
