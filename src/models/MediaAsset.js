const mongoose = require('mongoose');

const mediaAssetSchema = new mongoose.Schema({
  assetId: { type: String, required: true, unique: true, index: true },
  ownerId: { type: String, required: true, index: true },
  draftId: { type: String, index: true, default: null },
  submissionId: { type: String, index: true, default: null },
  assetType: {
    type: String,
    enum: ['avatar', 'recipe_hero', 'recipe_gallery', 'oral_history', 'consent_doc'],
    required: true
  },
  originalFileName: { type: String, required: true },
  storageProvider: { type: String, required: true },
  storageKey: { type: String, required: true },
  bucket: { type: String, default: null },
  checksum: { type: String, default: null },
  thumbnailKey: { type: String, default: null },
  mimeType: { type: String, required: true },
  size: { type: Number, required: true },
  uploadStatus: {
    type: String,
    enum: [
      'pending',
      'uploaded',
      'verified',
      'processing',
      'ready',
      'failed',
      'quarantined',
      'deleted',
      'abandoned'
    ],
    default: 'pending',
    index: true
  },
  verifiedAt: { type: Date, default: null },
  deletedAt: { type: Date, default: null }
}, { timestamps: true });

module.exports = mongoose.model('MediaAsset', mediaAssetSchema);
