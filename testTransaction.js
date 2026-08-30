// import mongoose from 'mongoose';
const mongoose = require('mongoose');

async function runTransaction() {
  await mongoose.connect('mongodb://localhost:27017/testdb?replicaSet=rs0', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
  });

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // Example: two inserts in a transaction
    await mongoose.connection
      .collection('txTest')
      .insertOne({ a: 1 }, { session });
    await mongoose.connection
      .collection('txTest')
      .insertOne({ b: 2 }, { session });

    await session.commitTransaction();
    console.log('Transaction committed ✅');
  } catch (err) {
    await session.abortTransaction();
    console.error('Transaction aborted ❌', err);
  } finally {
    session.endSession();
    mongoose.connection.close();
  }
}

runTransaction();
