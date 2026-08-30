const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
dotenv.config({ path: './config.env' });

const redis = require('redis');
const cookie = require('cookie');
const app = require('./app');
const Chat = require('./models/chatModel');
const socket = require('./utils/socketInstance');
const cors = require('cors');
// const initSocketServer = require('./socketServer');

process.on('uncaughtException', (err) => {
  console.log('UNCAUGHT EXCEPTION!  Shutting down...');
  console.log(err);
  console.log(err.name, err.message);
  process.exit(1);
});

// app.options('/*', cors());

// origin: 'http://0.0.0.0', // your frontend

mongoose.connect(process.env.MONGO_URL_ATLAS).then(() => {
  console.log('Connected to mongoDB');
});

const PORT = process.env.PORT || 5000;
const HOST = process.env.HOST || 'localhost';
const REDIS_PORT = process.env.REDIS_PORT || 6379;

// START the SERVER //
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`app running on port ${PORT}`);
});

socket.init(server, app);

// Handle unknown errors gracefully:-
process.on('unhandledRejection', (err) => {
  console.log('UNHANDLED REJECTION!  Shutting down...');

  console.log(err.name, err.message);
  server.close(() => {
    process.exit(1);
  });
});
