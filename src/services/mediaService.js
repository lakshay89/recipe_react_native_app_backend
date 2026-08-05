const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const crypto = require('crypto');
const config = require('../config/environment');
const storageService = require('./storageService');
const { AssetValidator } = require('../utils/assetValidator');
const MediaAsset = require('../models/MediaAsset');
const ApiError = require('../utils/ApiError');

class MediaService {
  /**
   * Complete the upload of an asset (validates content, optimizes images, generates thumbnails, uploads to R2)
   */
  static async completeAssetUpload(asset) {
    // 1. Get object details/location from storage provider
    const isR2 = asset.storageProvider === 'r2';
    let localFilePath = '';
    let cleanupNeeded = false;

    try {
      if (isR2) {
        // Download R2 object to a temp local file for validation and image processing
        const tempDir = path.join(__dirname, '../../public/uploads/temp');
        if (!fs.existsSync(tempDir)) {
          fs.mkdirSync(tempDir, { recursive: true });
        }
        
        localFilePath = path.join(tempDir, `${asset.assetId}_temp`);
        const stream = await storageService.getObjectStream(asset.storageKey);
        
        const writeStream = fs.createWriteStream(localFilePath);
        for await (const chunk of stream) {
          writeStream.write(chunk);
        }
        writeStream.end();
        await new Promise((resolve, reject) => {
          writeStream.on('finish', resolve);
          writeStream.on('error', reject);
        });

        cleanupNeeded = true;
      } else {
        // Local storage: file path is resolved directly
        const verifyResult = await storageService.verifyObject(asset.storageKey);
        localFilePath = verifyResult.filePath;
      }

      // 2. Validate file content (executables, scripting tags, compute checksum, duplicate uploads)
      const { checksum, size } = await AssetValidator.validateContent(localFilePath, asset.mimeType);

      let thumbnailKey = null;
      let finalBuffer = null;

      // 3. Process image assets with Sharp (EXIF stripping, compression, auto-rotation)
      if (asset.mimeType.startsWith('image/') && !asset.mimeType.includes('svg')) {
        const processedPath = localFilePath + '_processed';
        
        // Strip EXIF/GPS, auto-rotate, compress to standard quality (jpeg quality 85)
        await sharp(localFilePath)
          .rotate() // uses EXIF orientation to correct rotation
          .jpeg({ quality: 85, force: false })
          .png({ compressionLevel: 8, force: false })
          .toFile(processedPath);

        // Generate 180x180 covered thumbnail
        const thumbnailPath = localFilePath + '_thumb';
        await sharp(processedPath)
          .resize(180, 180, { fit: 'cover' })
          .toFile(thumbnailPath);

        // Read optimized buffers
        finalBuffer = fs.readFileSync(processedPath);
        const thumbBuffer = fs.readFileSync(thumbnailPath);

        // Clean up temporary sharp files
        if (fs.existsSync(processedPath)) fs.unlinkSync(processedPath);
        if (fs.existsSync(thumbnailPath)) fs.unlinkSync(thumbnailPath);

        if (isR2) {
          // Upload optimized image back to R2 and store thumbnail in R2
          thumbnailKey = `${asset.storageKey}_thumb`;
          await storageService.putObject(asset.storageKey, finalBuffer, asset.mimeType);
          await storageService.putObject(thumbnailKey, thumbBuffer, asset.mimeType);
        } else {
          // Local storage: overwrite original file, write thumbnail file
          fs.writeFileSync(localFilePath, finalBuffer);
          
          const localThumbPath = localFilePath + '_thumb';
          fs.writeFileSync(localThumbPath, thumbBuffer);
          thumbnailKey = `${asset.storageKey}_thumb`;
        }
      } else {
        // Non-image files: read content buffer to update R2 if we want, or do nothing for local
        if (isR2) {
          finalBuffer = fs.readFileSync(localFilePath);
        }
      }

      // 4. Update MediaAsset document with checksum, bucket, and thumbnail metadata
      asset.checksum = checksum;
      asset.size = finalBuffer ? finalBuffer.length : size;
      asset.bucket = isR2 ? config.R2_BUCKET_NAME : 'local_storage';
      asset.thumbnailKey = thumbnailKey;
      asset.uploadStatus = 'ready';
      asset.verifiedAt = new Date();
      await asset.save();

      return asset;
    } finally {
      // Clean up temp files downloaded from R2
      if (cleanupNeeded && localFilePath && fs.existsSync(localFilePath)) {
        fs.unlinkSync(localFilePath);
      }
    }
  }
}

module.exports = MediaService;
