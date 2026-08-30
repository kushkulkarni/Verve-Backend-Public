const express = require('express');
const morgan = require('morgan');
const AppError = require('./utils/appError');
const globalErrorHandler = require('./controllers/errorController');
const userRouter = require('./routes/userRoutes');
const guideRouter = require('./routes/guideRoutes');
const clubRouter = require('./routes/clubRoutes');
const cookieParser = require('cookie-parser');
const superAdminRouter = require('./routes/superAdminRoutes');
const adminRouter = require('./routes/adminRoutes');
const messageRoutes = require('./routes/messageRoutes');
const { sendTestNotification } = require('./controllers/testControllerFB');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const mongoSanitize = require('./utils/sanitize');
const compression = require('compression');

const allowedOrigins = ['http://localhost:5500', 'http://192.168.1.9:5500'];

const app = express();

// Security HTTP headers
app.use(helmet());

//allow proxy in PROD
app.set('trust proxy', 1);

// Rate limiting
const limiter = rateLimit({
  max: 100, // 100 requests
  windowMs: 15 * 60 * 1000, // per 15 minutes
  message: 'Too many requests from this IP, please try again later.',
});

app.use('/api', limiter);

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
}

app.use(
  cors({
    origin: function (origin, callback) {
      // allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);

      if (
        process.env.NODE_ENV === 'development' ||
        allowedOrigins.includes(origin)
      ) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    credentials: true,
  }),
);
// Body Parser, reading data from body into req.body
app.use(express.json({ limit: '10kb' })); //{ limit: '10kb' }

app.use(mongoSanitize);

app.use(compression());

app.use(cookieParser());

//// serving static files
// app.use(express.static(`${__dirname}/public`));

////testing middleware
app.use((req, res, next) => {
  // console.log('Hello from the server!');
  // console.log('CLOUDINARY VARS:', {
  //   name: process.env.CLOUDINARY_CLOUD_NAME,
  //   key: process.env.CLOUDINARY_API_KEY,
  //   secret: process.env.CLOUDINARY_API_SECRET,
  // });
  next();
});

app.use((req, res, next) => {
  req.requestTime = new Date().toISOString();
  // console.log(req.headers);
  next();
});

// ROUTES
// '/api/v1/guides', guideRoutes
// console.log('entering /api/upload');

app.post('/api/v1/firebase-test', sendTestNotification);
app.use('/api/v1/message', messageRoutes);
app.use('/api/v1/admin', adminRouter);
app.use('/api/v1/super-admin', superAdminRouter);
app.use('/api/v1/users', userRouter);
app.use('/api/v1/guide', guideRouter);
app.use('/api/v1/club', clubRouter);
//
// wrong route handler
app.use((req, res, next) => {
  next(new AppError(`Can't find ${req.originalUrl} on this server`, 404));
});

app.use(globalErrorHandler);

module.exports = app;
