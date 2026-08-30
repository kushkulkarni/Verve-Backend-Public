// // ============ FIREBASE START =========================

// const admin = require('firebase-admin');

// const path = require('path');
// var serviceAccount = require(
//   path.join(
//     __dirname,
//     'assets',
//     'verve-519cc-firebase-adminsdk-fbsvc-5ba08d8205.json',
//   ),
// );

// admin.initializeApp({
//   credential: admin.credential.cert(serviceAccount),
// });

// const firebaseDB = admin.firestore();

// // ============ FIREBASE END  =========================

const admin = require('firebase-admin');
const path = require('path');
require('dotenv').config({ path: './config.env' });

// const serviceAccount = require(
//   path.join(
//     __dirname,
//     './assets/verve-519cc-firebase-adminsdk-fbsvc-5ba08d8205.json',
//   ),
// );

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

admin.initializeApp({
  credential: admin.credential.cert({
     ...serviceAccount,
    private_key: serviceAccount.private_key.replace(/\\n/g, '\n'),
  }),
});

// const firebaseDB = admin.firestore();

module.exports = { admin };
