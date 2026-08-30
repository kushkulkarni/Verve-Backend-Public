const initSocketServer = require('../socketServer');

let io;

module.exports = {
  init: async function (server, app) {
    io = await initSocketServer(server, app);
    return io;
  },
  getIO: () => {
    if (!io) throw new Error('Socket.io not initialized');
    return io;
  },
};
