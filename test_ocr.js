const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
require('dotenv').config();

const { connectDB, disconnectDB } = require('./src/config/database');
const RecipeImportSession = require('./src/models/RecipeImportSession');
const MediaAsset = require('./src/models/MediaAsset');
const storageService = require('./src/services/storageService');

async function callGemini(promptText, imageBuffer = null, mimeType = null) {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) {
    throw new Error('GEMINI_API_KEY is not defined in backend env.');
  }

  const parts = [{ text: promptText }];
  if (imageBuffer) {
    parts.push({
      inlineData: {
        mimeType: mimeType || 'image/jpeg',
        data: imageBuffer.toString('base64')
      }
    });
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash:generateContent?key=${geminiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts }],
      generationConfig: {
        responseMimeType: 'application/json'
      }
    }),
    signal: AbortSignal.timeout(30000)
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Gemini Provider Error (${response.status}): ${errorText}`);
  }

  const resJson = await response.json();
  const rawResponseText = resJson.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!rawResponseText) {
    throw new Error('Empty Gemini response content');
  }

  return JSON.parse(rawResponseText.trim());
}

async function run() {
  await connectDB();
  try {
    // Find the latest session that has pages
    const session = await RecipeImportSession.findOne({ "pages.0": { $exists: true } }).sort({ createdAt: -1 });
    if (!session) {
      console.log('No session with pages found.');
      return;
    }
    console.log(`Testing OCR for Session: ${session.sessionId}, Status: ${session.status}, Pages count: ${session.pages.length}`);

    for (let i = 0; i < session.pages.length; i++) {
      const page = session.pages[i];
      const asset = await MediaAsset.findOne({ assetId: page.assetId });
      if (!asset) {
        console.log(`Asset ${page.assetId} not found in DB.`);
        continue;
      }
      console.log(`Page ${page.pageNumber}: Asset ID: ${page.assetId}, Storage Key: ${asset.storageKey}`);

      try {
        const verifyResult = await storageService.verifyObject(asset.storageKey);
        console.log(`File exists on disk: ${verifyResult.filePath}, size: ${verifyResult.size} bytes`);
        const imageBuffer = fs.readFileSync(verifyResult.filePath);

        console.log('Preprocessing image with Sharp...');
        const startSharp = Date.now();
        const processedBuffer = await sharp(imageBuffer)
          .rotate()
          .resize({ width: 2200, height: 2200, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 85 })
          .toBuffer();
        console.log(`Sharp completed in ${Date.now() - startSharp}ms. Processed buffer size: ${processedBuffer.length} bytes`);

        const ocrPrompt = `
You are an expert archiver. Transcribe all written text (handwritten or printed) from this recipe image.
If the recipe has content in multiple Indian languages/scripts or mix of Hindi/English, transcribe it faithfully.
Return ONLY a valid JSON object matching the JSON schema below. Do not include markdown wraps or anything else.

JSON Schema structure:
{
  "text": "string (Exact transcription of the page. If entirely unreadable, write [unreadable])",
  "detectedLanguages": ["string"],
  "detectedScripts": ["string"],
  "quality": { "level": "string", "warnings": [] },
  "uncertainSegments": [],
  "containsRecipe": "boolean"
}
`;

        console.log('Calling Gemini...');
        const startGemini = Date.now();
        const ocrResult = await callGemini(ocrPrompt, processedBuffer, 'image/jpeg');
        console.log(`Gemini completed in ${Date.now() - startGemini}ms.`);
        console.log('OCR Result:', JSON.stringify(ocrResult, null, 2));

      } catch (err) {
        console.error(`Page ${page.pageNumber} OCR Failed:`, err);
      }
    }
  } catch (err) {
    console.error('Run failed:', err);
  } finally {
    await disconnectDB();
  }
}

run();
