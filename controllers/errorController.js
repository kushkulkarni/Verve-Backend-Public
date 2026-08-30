const AppError = require('./../utils/appError');

const handleCastErrorDB = (err) => {
  const message = `Invalid ${err.path}: ${err.value}.`;
  return new AppError(message, 400);
};

const handleDuplicateFieldsDB = (err) => {
  const value = err.keyValue.email;
  // err.keyValue?.email || err.error?.keyValue?.email || 'Unknown email';
  // console.log('value: ', value);
  const message = `Duplicate field value: '${value}'. Please use another value`;
  return new AppError(message, 400);
};

const handleValidatorErrorDB = (err) => {
  // console.log('message:', err.message);
  const errors = Object.values(err.errors).map((el) => el.message);

  const message = `Invalid input data. ${errors.join('. ')}`;
  return new AppError(message, 400);
};

const handleWrongLogin = (err) => {
  const message = err.message;
  return new AppError(message, 401);
};

const handleJWTErr = () =>
  new AppError('Invalid token, Please log in again!', 401);

const handleJWTExpiredError = () =>
  new AppError('Your token has expired! Please log in again', 401);

const sendErrorDev = (err, res) => {
  res.status(err.statusCode).json({
    status: err.status,
    error: err,
    message: err.message,
    stack: err.stack,
  });
};

const sendErrorProd = (err, res) => {
  if (err.isOperational) {
    console.log('message:', err.message);
    res.status(err.statusCode).json({
      status: err.status,
      message: err.message,
    });
  }
  //Programming or other unknown error: dont leak error details
  else {
    // 1) Log error
    console.error('ERROR', err);

    // 2) Send generic message
    res.status(500).json({
      status: 'error',
      message: 'Something went very wrong',
    });
  }
};

module.exports = (err, req, res, next) => {
  // console.log(err.stack);
  err.statusCode = err.statusCode || 500;
  err.status = err.status || 'error';

  if (process.env.NODE_ENV === 'development') {
    sendErrorDev(err, res);
  } else if (process.env.NODE_ENV === 'production') {
    // let error = Object.assign(Object.create(Object.getPrototypeOf(err)), err);
    let error = Object.create(
      Object.getPrototypeOf(err),
      Object.getOwnPropertyDescriptors(err),
    );
    // let error = { ...err };
    // console.log('Error name is: ', error.name);
    if (error.name === 'CastError') error = handleCastErrorDB(error);
    if (err.code === 11000) error = handleDuplicateFieldsDB(error);
    if (
      error.errors &&
      error.errors.name &&
      error.errors.name.name === 'ValidatorError'
    )
      error = handleValidatorErrorDB(error);
    if (error.message === 'Incorrect email or password')
      error = handleWrongLogin(error);
    if (error && error.name === 'JsonWebTokenError')
      error = handleJWTErr(error);
    if (error.name === 'TokenExpiredError') error = handleJWTExpiredError();
    sendErrorProd(error, res);
  }
};
