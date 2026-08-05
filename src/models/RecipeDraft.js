const mongoose = require('mongoose');

const recipeDraftSchema = new mongoose.Schema({
  draftId: { type: String, required: true, unique: true, index: true },
  recipeId: { type: String, unique: true, sparse: true, index: true },
  userId: { type: String, default: 'guest_user', index: true },
  
  // Standard text inputs
  title: { type: String, default: '', trim: true },
  localName: { type: String, default: '', trim: true },
  nativeScript: { type: String, default: '', trim: true },
  altNames: { type: String, default: '', trim: true },
  history: { type: String, default: '', trim: true },
  
  // Timings and servings
  serves: { type: String, default: '4' },
  prepTime: { type: String, default: '', trim: true },
  cookTime: { type: String, default: '', trim: true },
  totalTime: { type: String, default: '', trim: true },
  
  // Geography details
  state: { type: String, default: '', trim: true },
  district: { type: String, default: '', trim: true },
  region: { type: String, default: '', trim: true },
  tehsil: { type: String, default: '', trim: true },
  village: { type: String, default: '', trim: true },
  
  // Heritage metadata
  heritageSource: { type: String, default: '', trim: true },
  whoTaughtYou: { type: String, default: '', trim: true },
  numGenerations: { type: String, default: '', trim: true },
  approxAge: { type: String, default: '', trim: true },
  gpsCoords: { type: String, default: '', trim: true },
  isBorderRegion: { type: Boolean, default: false },
  cookingVessel: { type: String, default: '', trim: true },
  traditionalTips: { type: String, default: '', trim: true },

  // Nested structures (ingredients, steps)
  ingredientsList: { type: mongoose.Schema.Types.Mixed, default: [] },
  cookingStepsList: { type: mongoose.Schema.Types.Mixed, default: [] },
  instructions: { type: mongoose.Schema.Types.Mixed, default: [] },
  cultureDetails: { type: mongoose.Schema.Types.Mixed, default: {} },
  sourceTracking: { type: mongoose.Schema.Types.Mixed, default: {} },

  // Curation step tracking
  currentStep: { type: String, default: 'RecipeIdentity' },
  completionPercentage: { type: Number, default: 12.5 },
  status: { type: String, enum: ['draft', 'pending_review', 'submitted'], default: 'draft' },
  confidence: { type: Number, default: 1.0 },
  missingFields: { type: [String], default: [] },
  
  // Scan metadata
  scan: { type: mongoose.Schema.Types.Mixed, default: null },
  originalScanSourceMetadata: { type: mongoose.Schema.Types.Mixed, default: null },
  originalOCRText: { type: String, default: '' },
  correctedOCRText: { type: String, default: '' },
  acceptedAISuggestions: { type: mongoose.Schema.Types.Mixed, default: [] },
  aiDisclosure: { type: Boolean, default: false },
  
  // Phase 3 Versioning & Conflict Protection
  clientUpdatedAt: { type: Date, default: Date.now },
  version: { type: Number, default: 1 },

  // Phase 5 Media Assets integration
  archiveImages: { type: mongoose.Schema.Types.Mixed, default: [] },
  oralHistoryAudio: { type: mongoose.Schema.Types.Mixed, default: null },
  coverImage: { type: String, default: '' },
  audioUri: { type: String, default: '' },
  audioDuration: { type: Number, default: 0 },
  hasHero: { type: Boolean, default: false },
  hasDish: { type: Boolean, default: false },
  hasIngredients: { type: Boolean, default: false },
  hasGallery: { type: Boolean, default: false }

}, { timestamps: true });

module.exports = mongoose.model('RecipeDraft', recipeDraftSchema);
