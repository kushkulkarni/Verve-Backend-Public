const { io } = require('../server');
const { error } = require('console');

const notificationSocketHandler = (io, reciever, event, data) => {
  io.to(reciever).emit(event, data);
};
