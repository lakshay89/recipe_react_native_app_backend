const crypto = require('crypto');
const fs = require('fs');
const MediaAsset = require('../models/MediaAsset');
const ApiError = require('./ApiError');

// Strict whitelist limits
const LIMITS = {
  avatar: { maxBytes: 2 * 1024 * 1024, mimeTypes: ['image/jpeg', 'image/png'] },
  recipe_hero: { maxBytes: 4 * 1024 * 1024, mimeTypes: ['image/jpeg', 'image/png'] },
  recipe_gallery: { maxBytes: 4 * 1024 * 1024, mimeTypes: ['image/jpeg', 'image/png'] },
  oral_history: { maxBytes: 15 * 1024 * 1024, mimeTypes: ['audio/mp4', 'audio/mpeg', 'audio/wav', 'audio/x-m4a'] },
  consent_doc: { maxBytes: 5 * 1024 * 1024, mimeTypes: ['application/pdf', 'image/jpeg', 'image/png'] }
};

// Executable signature magic numbers to reject
const BLOCKED_SIGNATURES = [
  { signature: Buffer.from([0x4d, 0x5a]), name: 'Windows Executable (PE)' }, // MZ
  { signature: Buffer.from([0x7f, 0x45, 0x4c, 0x46]), name: 'Linux Executable (ELF)' }, // \x7fELF
  { signature: Buffer.from([0xca, 0xfe, 0xba, 0xbe]), name: 'Java Class' }
];

const BLOCKED_PATTERNS = [
  /<\?php/i,
  /^#!\/(usr\/bin\/env|bin\/sh|bin\/bash)/i,
  /<script/i
];

class AssetValidator {
  /**
   * Validate asset type, size, and MIME type properties before upload initialization
   */
  static validateInitiation(assetType, mimeType, size) {
    const limits = LIMITS[assetType];
    if (!limits) {
      throw new ApiError(400, `Invalid asset type: ${assetType}`, 'INVALID_ASSET_TYPE');
    }

    if (Number(size) > limits.maxBytes) {
      throw new ApiError(400, `File size exceeds limits. Max allowed is ${limits.maxBytes / (1024 * 1024)}MB.`, 'FILE_TOO_LARGE');
    }

    if (!limits.mimeTypes.includes(mimeType)) {
      throw new ApiError(400, `Unsupported mimeType. Allowed: ${limits.mimeTypes.join(', ')}`, 'UNSUPPORTED_MIME_TYPE');
    }
  }

  /**
   * Validate content of the file buffer/stream after upload (signature, executable check, checksum verification)
   */
  static async validateContent(filePath, mimeType) {
    if (!fs.existsSync(filePath)) {
      throw new ApiError(400, 'File does not exist.', 'FILE_NOT_FOUND');
    }

    const stat = fs.statSync(filePath);
    const fd = fs.openSync(filePath, 'r');
    const headBuffer = Buffer.alloc(16);
    fs.readSync(fd, headBuffer, 0, 16, 0);
    fs.closeSync(fd);

    // 1. Check executable signatures
    for (const item of BLOCKED_SIGNATURES) {
      const isMatch = headBuffer.slice(0, item.signature.length).equals(item.signature);
      if (isMatch) {
        throw new ApiError(400, `Security Violation: Executable file signature detected (${item.name}).`, 'SECURITY_VIOLATION_EXECUTABLE');
      }
    }

    // 2. Read full file buffer for content pattern checks and checksum
    const fullBuffer = fs.readFileSync(filePath);
    const textContent = fullBuffer.toString('utf8', 0, Math.min(fullBuffer.length, 4096));

    for (const pattern of BLOCKED_PATTERNS) {
      if (pattern.test(textContent)) {
        throw new ApiError(400, 'Security Violation: Scripting tag or shell command pattern detected.', 'SECURITY_VIOLATION_SCRIPT');
      }
    }

    // 3. Compute Checksum
    const checksum = crypto.createHash('sha256').update(fullBuffer).digest('hex');

    // 4. Check for duplicate uploads
    const existing = await MediaAsset.findOne({
      checksum,
      uploadStatus: { $in: ['ready', 'verified'] }
    });

    if (existing) {
      throw new ApiError(409, 'Duplicate upload detected. This exact file has already been uploaded.', 'DUPLICATE_UPLOAD');
    }

    return { checksum, size: stat.size };
  }
}

module.exports = { AssetValidator, LIMITS };
