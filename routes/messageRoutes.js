const express = require('express');
const messageController = require('../controllers/messageController');
const router = express.Router();
const { protect } = require('../controllers/authController');

router.use(protect);
router.get('/status-sync', messageController.getMessageStatusSync);

router.post('/mark-delivered', messageController.markAsDelivered);

router.get('/my-doubts', messageController.getYourDoubtChats);
router.get('/requested-doubts', messageController.getOthersDoubtChats);

router.get('/:conversationId', messageController.getMessagesByConversation);
router.get(
  '/getSpecificChat/:conversationId',
  messageController.getSpecificChat,
);

// router.post('/sendMessage', protect, messageController.sendMessage);
// router.patch('/:id/status', protect, messageController.updateStatus);
router.delete('/:MessageId/deleteForMe', messageController.deleteMessageForMe);
router.delete(
  '/:MessageId/deleteForEveryone',
  messageController.deleteMessageForEveryone,
);

module.exports = router;
