const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const R2StorageProvider = require('./r2StorageProvider');

// Abstraction for different providers (Local, S3, Cloudinary)
class LocalStorageProvider {
  constructor() {
    this.uploadDir = process.env.UPLOAD_DIR || path.join(__dirname, '../../public/uploads');
    if (!fs.existsSync(this.uploadDir)) {
      fs.mkdirSync(this.uploadDir, { recursive: true });
    }
  }

  async initializeUpload(assetId, ownerId, assetType, fileName, mimeType, size) {
    const ext = path.extname(fileName) || '.bin';
    const randomHex = crypto.randomBytes(8).toString('hex');
    const storageKey = `uploads/${ownerId}/${assetType}/${assetId}_${randomHex}${ext}`;
    
    // Direct upload URL pointing to our backend upload handler
    const uploadUrl = `/api/v1/media/uploads/direct`;

    return {
      uploadUrl,
      uploadMethod: 'POST',
      fields: { assetId, storageKey },
      storageKey,
      storageProvider: 'local'
    };
  }

  async verifyObject(storageKey) {
    const filePath = path.join(this.uploadDir, '../', storageKey);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Object not found at key: ${storageKey}`);
    }
    const stat = fs.statSync(filePath);
    return {
      exists: true,
      size: stat.size,
      filePath
    };
  }

  async getSignedAccessUrl(storageKey) {
    // For local files, we just point to a media retrieval route
    return `/api/v1/media/file/${encodeURIComponent(storageKey)}`;
  }

  async deleteObject(storageKey) {
    const filePath = path.join(this.uploadDir, '../', storageKey);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    return true;
  }

  async getObjectStream(storageKey) {
    const verifyResult = await this.verifyObject(storageKey);
    return fs.createReadStream(verifyResult.filePath);
  }

  async putObject(storageKey, buffer, mimeType) {
    const filePath = path.join(this.uploadDir, '../', storageKey);
    const folder = path.dirname(filePath);
    if (!fs.existsSync(folder)) {
      fs.mkdirSync(folder, { recursive: true });
    }
    fs.writeFileSync(filePath, buffer);
    return true;
  }
}

// Setup the active provider based on environment config
const config = require('../config/environment');

let localProviderInstance = null;
let r2ProviderInstance = null;

const getProvider = () => {
  const providerType = config.STORAGE_PROVIDER || 'local';
  if (providerType === 'r2') {
    if (!r2ProviderInstance) {
      r2ProviderInstance = new R2StorageProvider();
    }
    return r2ProviderInstance;
  } else {
    if (!localProviderInstance) {
      localProviderInstance = new LocalStorageProvider();
    }
    return localProviderInstance;
  }
};

module.exports = {
  initializeUpload: (...args) => getProvider().initializeUpload(...args),
  verifyObject: (...args) => getProvider().verifyObject(...args),
  getSignedAccessUrl: (...args) => getProvider().getSignedAccessUrl(...args),
  deleteObject: (...args) => getProvider().deleteObject(...args),
  getObjectStream: (...args) => getProvider().getObjectStream(...args),
  putObject: (...args) => getProvider().putObject(...args)
};
