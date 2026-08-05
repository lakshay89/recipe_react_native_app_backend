const mongoose = require('mongoose');
require('dotenv').config();
const RecipeImportSession = require('./src/models/RecipeImportSession');
const MediaAsset = require('./src/models/MediaAsset');
const { connectDB, disconnectDB } = require('./src/config/database');

async function run() {
  await connectDB();
  try {
    const sessions = await RecipeImportSession.find().sort({ createdAt: -1 }).limit(5);
    console.log('Last 5 Import Sessions:', JSON.stringify(sessions, null, 2));

    const assets = await MediaAsset.find().sort({ createdAt: -1 }).limit(5);
    console.log('Last 5 Media Assets:', JSON.stringify(assets, null, 2));
  } catch (err) {
    console.error(err);
  } finally {
    await disconnectDB();
  }
}

run();
