const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const crypto = require('crypto');
const path = require('path');
const config = require('../config/environment');

class R2StorageProvider {
  constructor() {
    this.client = new S3Client({
      region: 'auto',
      endpoint: `https://${config.CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.R2_ACCESS_KEY_ID,
        secretAccessKey: config.R2_SECRET_ACCESS_KEY
      }
    });
    this.bucket = config.R2_BUCKET_NAME;
  }

  async initializeUpload(assetId, ownerId, assetType, fileName, mimeType, size) {
    const ext = path.extname(fileName) || '.bin';
    const randomHex = crypto.randomBytes(8).toString('hex');
    const storageKey = `uploads/${ownerId}/${assetType}/${assetId}_${randomHex}${ext}`;

    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      ContentType: mimeType
    });

    const uploadUrl = await getSignedUrl(this.client, command, { expiresIn: 3600 }); // 1 hour expiration

    return {
      uploadUrl,
      uploadMethod: 'PUT',
      fields: {},
      storageKey,
      storageProvider: 'r2',
      bucket: this.bucket
    };
  }

  async verifyObject(storageKey) {
    const command = new HeadObjectCommand({
      Bucket: this.bucket,
      Key: storageKey
    });

    try {
      const response = await this.client.send(command);
      return {
        exists: true,
        size: response.ContentLength,
        metadata: response.Metadata
      };
    } catch (err) {
      if (err.name === 'NotFound' || err.$metadata?.httpStatusCode === 404) {
        throw new Error(`Object not found in bucket for key: ${storageKey}`);
      }
      throw err;
    }
  }

  async getSignedAccessUrl(storageKey) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: storageKey
    });

    // Generate signed download URL valid for 24 hours
    return await getSignedUrl(this.client, command, { expiresIn: 86400 });
  }

  async getObjectStream(storageKey) {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: storageKey
    });
    const response = await this.client.send(command);
    return response.Body;
  }

  async putObject(storageKey, buffer, mimeType) {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
      Body: buffer,
      ContentType: mimeType
    });
    await this.client.send(command);
    return true;
  }

  async deleteObject(storageKey) {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: storageKey
    });

    await this.client.send(command);
    return true;
  }
}

module.exports = R2StorageProvider;
