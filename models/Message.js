const validator = require('validator');
const mongoose = require('mongoose');
const { Schema } = mongoose;
const crypto = require('crypto');

const ALGORITHM = process.env.ENCRYPTION_ALGO;

const SECRET_KEY = crypto
  .createHash('sha256')
  .update(process.env.MESSAGE_SECRET)
  .digest();

function encrypt(text) {
  if (!text) return;
  // 1. Generate random initialization vector
  const IV = crypto.randomBytes(16);

  // 2. Create cipher
  const cipher = crypto.createCipheriv(ALGORITHM, SECRET_KEY, IV);

  // 3. Encrypt the actual text
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  // 4. Return IV + encrypted text
  return IV.toString('hex') + ':' + encrypted;
}

function decrypt(data) {
  try {
    if (!data) return data;

    // 1. Split IV and encrypted text
    const parts = data.split(':');
    if (parts.length !== 2) return data; // already plain or corrupted

    const IV = Buffer.from(parts[0], 'hex');
    const encryptedText = parts[1];

    // 2. Create decipher
    const decipher = crypto.createDecipheriv(ALGORITHM, SECRET_KEY, IV);

    // 3. Decrypt
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  } catch (err) {
    console.error('Decryption failed:', err.message);
    return null; // or return original data if you prefer
  }
}

const MessageSchema = new mongoose.Schema(
  {
    chat: {
      type: Schema.Types.ObjectId,
      ref: 'Chat',
      required: true,
    },
    sender: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    recipient: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    text: { type: String },
    // attachments: [{ type: Schema.Types.ObjectId, ref: 'Attachment' }], // new
    // deletedFor: [
    //   {
    //     type: Schema.Types.ObjectId,
    //     ref: 'User',
    //   },
    // ],
    // deletedForEveryone: {
    //   type: Boolean,
    //   default: false,
    // },
    deleted: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: ['sent', 'delivered', 'read'],
      default: 'sent',
    },
    deliveredAt: { type: Date },
    readAt: { type: Date },
    replyTo: {
      messageId: {
        type: Schema.Types.ObjectId,
        ref: 'Message',
      },
      text: String,
      sender: {
        type: Schema.Types.ObjectId,
        ref: 'User',
      },
    },

    // createdAt: {
    //   type: Date,
    //   default: Date.now,
    // },
  },
  { timestamps: true },
);

MessageSchema.pre('save', function (next) {
  if (this.isModified('text') && this.text) {
    this.text = encrypt(this.text);
  }

  if (this.isModified('replyTo.text') && this.replyTo?.text) {
    this.replyTo.text = encrypt(this.replyTo.text);
  }

  next();
});

MessageSchema.index({ chat: 1, createdAt: 1 });
// Fast pagination for messages
MessageSchema.index({ chat: 1, _id: -1 });

// Fast unread / status queries later
MessageSchema.index({ chat: 1, status: 1 });

// Optional (useful for deletion filters)
MessageSchema.index({ chat: 1, deletedForEveryone: 1 });

const Message = mongoose.model('Message', MessageSchema);
module.exports = { Message, encrypt, decrypt };
