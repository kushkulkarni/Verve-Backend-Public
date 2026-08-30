const { decrypt, encrypt } = require('../models/Message');

module.exports = {
  encrypt,
  decrypt,

  encryptMessagePayload(msg) {
    if (msg.text) msg.text = encrypt(msg.text);
    if (msg.replyTo?.text) msg.replyTo.text = encrypt(msg.replyTo.text);
    return msg;
  },

  decryptMessagePayload(msg) {
    const obj = msg.toObject ? msg.toObject() : { ...msg };

    if (obj.text) obj.text = decrypt(obj.text);
    if (obj.replyTo?.text) obj.replyTo.text = decrypt(obj.replyTo.text);

    return obj;
  },
};
