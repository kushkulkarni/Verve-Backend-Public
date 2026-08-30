const Message = require('./../models/Message');
const { decryptMessagePayload, decrypt } = require('./crypto');

async function getMessages(chatId) {
  const messages = await Message.find({ chat: chatId })
    .sort({ _id: -1 })
    .limit(50);

  return messages.map(decryptMessagePayload);
}

function decryptChatPayload(chat) {
  const obj = { ...chat };

  if (obj.lastMessage?.text) {
    obj.lastMessage.text = decrypt(obj.lastMessage.text);
  }

  return obj;
}

module.exports = { decryptChatPayload };
