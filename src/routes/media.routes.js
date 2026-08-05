const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const sharp = require('sharp');
const authenticate = require('../middlewares/authenticate');
const MediaAsset = require('../models/MediaAsset');
const RecipeDraft = require('../models/RecipeDraft');
const RecipeSubmission = require('../models/RecipeSubmission');
const storageService = require('../services/storageService');
const { sendSuccess, sendError } = require('../utils/apiResponse');
const { AssetValidator } = require('../utils/assetValidator');
const MediaService = require('../services/mediaService');

const router = express.Router();

// Define allowed mime types and size limits
const LIMITS = {
  avatar: { maxBytes: 2 * 1024 * 1024, mimeTypes: ['image/jpeg', 'image/png'] },
  recipe_hero: { maxBytes: 4 * 1024 * 1024, mimeTypes: ['image/jpeg', 'image/png'] },
  recipe_gallery: { maxBytes: 4 * 1024 * 1024, mimeTypes: ['image/jpeg', 'image/png'] },
  oral_history: { maxBytes: 15 * 1024 * 1024, mimeTypes: ['audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-m4a'] },
  consent_doc: { maxBytes: 5 * 1024 * 1024, mimeTypes: ['application/pdf', 'image/jpeg', 'image/png'] }
};

// Initiate upload
router.post('/media/uploads/initiate', authenticate, async (req, res, next) => {
  try {
    const { assetType, originalFileName, mimeType, size, draftId } = req.body;
    const ownerId = req.user.id;

    // Validate properties via AssetValidator
    AssetValidator.validateInitiation(assetType, mimeType, size);

    // Verify draft ownership if draftId is supplied
    if (draftId) {
      const draft = await RecipeDraft.findOne({ draftId });
      if (!draft || draft.userId !== ownerId) {
        return sendError(res, {
          message: 'Associated draft not found or access denied.',
          statusCode: 404,
          code: 'DRAFT_NOT_FOUND',
          requestId: req.id
        });
      }
    }

    const assetId = `asset-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    
    // Initialize upload with configured storage provider
    const uploadInstructions = await storageService.initializeUpload(
      assetId,
      ownerId,
      assetType,
      originalFileName,
      mimeType,
      size
    );

    const asset = await MediaAsset.create({
      assetId,
      ownerId,
      draftId: draftId || null,
      assetType,
      originalFileName,
      storageProvider: uploadInstructions.storageProvider,
      storageKey: uploadInstructions.storageKey,
      mimeType,
      size: Number(size),
      uploadStatus: 'pending'
    });

    return sendSuccess(res, 'Upload initiated successfully.', {
      asset,
      uploadInstructions
    }, 201, { requestId: req.id });
  } catch (error) {
    next(error);
  }
});

// Direct file upload handler via multer
const uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../public/uploads');
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const randomHex = crypto.randomBytes(8).toString('hex');
    cb(null, `temp_${randomHex}_${file.originalname}`);
  }
});

const upload = multer({ storage });

router.post('/media/uploads/direct', upload.single('file'), async (req, res, next) => {
  try {
    const { assetId } = req.body;
    const file = req.file;

    if (!assetId || !file) {
      return sendError(res, {
        message: 'assetId and file are required.',
        statusCode: 400,
        code: 'UPLOAD_FAILED',
        requestId: req.id
      });
    }

    const asset = await MediaAsset.findOne({ assetId });
    if (!asset) {
      // Clean up temp file
      if (file.path && fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      return sendError(res, {
        message: 'Media asset record not found.',
        statusCode: 404,
        code: 'ASSET_NOT_FOUND',
        requestId: req.id
      });
    }

    // Move file to its final storageKey destination
    const destPath = path.join(uploadDir, '../', asset.storageKey);
    const destFolder = path.dirname(destPath);
    if (!fs.existsSync(destFolder)) {
      fs.mkdirSync(destFolder, { recursive: true });
    }

    fs.renameSync(file.path, destPath);

    asset.uploadStatus = 'uploaded';
    await asset.save();

    return sendSuccess(res, 'File uploaded successfully.', asset, 200, { requestId: req.id });
  } catch (error) {
    next(error);
  }
});

// Complete upload
router.post('/media/uploads/:assetId/complete', authenticate, async (req, res, next) => {
  try {
    const { assetId } = req.params;
    const ownerId = req.user.id;

    const asset = await MediaAsset.findOne({ assetId });
    if (!asset || asset.ownerId !== ownerId) {
      return sendError(res, {
        message: 'Media asset not found or access denied.',
        statusCode: 404,
        code: 'ASSET_NOT_FOUND',
        requestId: req.id
      });
    }

    // Check if completion is idempotent
    if (asset.uploadStatus === 'ready' || asset.uploadStatus === 'verified') {
      return sendSuccess(res, 'Asset already verified.', asset, 200, { requestId: req.id });
    }

    // Verify object existence, validate contents, process image/thumbnails and complete upload
    const updatedAsset = await MediaService.completeAssetUpload(asset);

    return sendSuccess(res, 'Upload verification complete.', updatedAsset, 200, { requestId: req.id });
  } catch (error) {
    next(error);
  }
});

// Retrieve Asset Metadata
router.get('/media/:assetId', authenticate, async (req, res, next) => {
  try {
    const { assetId } = req.params;
    const ownerId = req.user.id;

    const asset = await MediaAsset.findOne({ assetId });
    if (!asset) {
      return sendError(res, {
        message: 'Media asset not found.',
        statusCode: 404,
        code: 'ASSET_NOT_FOUND',
        requestId: req.id
      });
    }

    // Check private status
    if (asset.ownerId !== ownerId && req.user.role !== 'curator' && req.user.role !== 'admin') {
      // Check if attached to a published submission
      if (asset.submissionId) {
        const sub = await RecipeSubmission.findOne({ submissionId: asset.submissionId });
        if (sub && sub.status === 'published') {
          // Public visibility allowed for published recipe media
        } else {
          return sendError(res, {
            message: 'Access denied.',
            statusCode: 403,
            code: 'UNAUTHORIZED_ACCESS',
            requestId: req.id
          });
        }
      } else {
        return sendError(res, {
          message: 'Access denied.',
          statusCode: 403,
          code: 'UNAUTHORIZED_ACCESS',
          requestId: req.id
        });
      }
    }

    const accessUrl = await storageService.getSignedAccessUrl(asset.storageKey);

    return sendSuccess(res, 'Media asset retrieved successfully.', {
      ...asset.toObject(),
      accessUrl
    }, 200, { requestId: req.id });
  } catch (error) {
    next(error);
  }
});

// Delete Asset
router.delete('/media/:assetId', authenticate, async (req, res, next) => {
  try {
    const { assetId } = req.params;
    const ownerId = req.user.id;

    const asset = await MediaAsset.findOne({ assetId });
    if (!asset || asset.ownerId !== ownerId) {
      return sendError(res, {
        message: 'Media asset not found.',
        statusCode: 404,
        code: 'ASSET_NOT_FOUND',
        requestId: req.id
      });
    }

    // Block deletion of assets referenced by active review submissions
    if (asset.submissionId) {
      const activeSub = await RecipeSubmission.findOne({
        submissionId: asset.submissionId,
        status: { $in: ['submitted', 'under_review', 'changes_requested', 'resubmitted', 'approved', 'published'] }
      });
      if (activeSub) {
        return sendError(res, {
          message: 'Cannot delete media asset referenced by active submission reviews.',
          statusCode: 403,
          code: 'DELETE_LOCKED',
          requestId: req.id
        });
      }
    }

    await storageService.deleteObject(asset.storageKey);
    asset.uploadStatus = 'deleted';
    asset.deletedAt = new Date();
    await asset.save();

    return sendSuccess(res, 'Media asset deleted successfully.', { assetId }, 200, { requestId: req.id });
  } catch (error) {
    next(error);
  }
});

// Serve Local files directly with security access checks
router.get('/media/file/:ownerId/:assetType/:filename', authenticate, async (req, res, next) => {
  try {
    const { ownerId, assetType, filename } = req.params;
    const userId = req.user.id;

    const storageKey = `uploads/${ownerId}/${assetType}/${filename}`;
    
    const asset = await MediaAsset.findOne({ storageKey });
    if (!asset) {
      return res.status(404).json({ success: false, message: 'File not found.' });
    }

    // Enforce privacy access control check
    if (asset.ownerId !== userId && req.user.role !== 'curator' && req.user.role !== 'admin') {
      return res.status(403).json({ success: false, message: 'Access denied.' });
    }

    const filePath = path.join(uploadDir, '../', storageKey);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ success: false, message: 'Physical file not found.' });
    }

    res.setHeader('Content-Type', asset.mimeType);
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    next(error);
  }
});

module.exports = router;
