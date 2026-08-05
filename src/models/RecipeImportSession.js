const mongoose = require('mongoose');

const recipeImportSessionSchema = new mongoose.Schema({
  sessionId: { type: String, required: true, unique: true, index: true },
  ownerId: { type: String, required: true, index: true },
  draftId: { type: String, index: true },
  status: { 
    type: String, 
    enum: [
      'created',
      'uploading',
      'uploaded',
      'preprocessing',
      'ocr_processing',
      'ocr_review_required',
      'ai_structuring',
      'recipe_review_required',
      'approved',
      'saved_to_draft',
      'failed',
      'cancelled'
    ], 
    default: 'created' 
  },
  pages: [{
    pageNumber: { type: Number, required: true },
    assetId: { type: String }, // links to MediaAsset assetId
    originalUrl: { type: String }, // private file storage link
    status: { type: String, default: 'pending' },
    rawOCR: { type: String, default: '' },
    correctedText: { type: String, default: '' },
    confidence: { type: Number, default: 1.0 },
    detectedLanguages: { type: [String], default: [] },
    detectedScripts: { type: [String], default: [] },
    uncertainSegments: { type: mongoose.Schema.Types.Mixed, default: [] },
    qualityLevel: { type: String, default: 'good' },
    qualityWarnings: { type: [String], default: [] }
  }],
  ocrLanguage: { type: String, default: 'en' },
  ocrScript: { type: String, default: 'Latin' },
  rawOCRTextCombined: { type: String, default: '' },
  correctedOCRTextCombined: { type: String, default: '' },
  structuredExtraction: { type: mongoose.Schema.Types.Mixed, default: null },
  aiSuggestions: [{
    id: { type: String, required: true },
    field: { type: String, required: true },
    suggestedValue: { type: String, default: '' },
    confidence: { type: String, default: 'high' }, // 'high' | 'medium' | 'low'
    reason: { type: String, default: '' },
    evidence: { type: String, default: '' },
    requiresUserApproval: { type: Boolean, default: true },
    decision: { type: String, enum: ['pending', 'accepted', 'rejected'], default: 'pending' }
  }],
  errorDetails: { type: String, default: '' },
  retryCount: { type: Number, default: 0 },
  providerInfo: {
    ocrProvider: { type: String, default: 'gemini' },
    aiProvider: { type: String, default: 'gemini' },
    modelName: { type: String, default: 'gemini-3.5-flash' }
  }
}, { timestamps: true });

module.exports = mongoose.model('RecipeImportSession', recipeImportSessionSchema);
