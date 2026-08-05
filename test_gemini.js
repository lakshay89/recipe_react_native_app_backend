const fs = require('fs');
const path = require('path');
require('dotenv').config();

async function testGemini(model) {
  const geminiKey = process.env.GEMINI_API_KEY;
  if (!geminiKey) return;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`;
  const promptText = "Hello! Tell me in 5 words what you are.";

  try {
    const start = Date.now();
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: promptText }] }]
      })
    });
    const duration = Date.now() - start;
    const body = await response.json().catch(() => ({}));
    console.log(`Model: ${model} -> Status: ${response.status} in ${duration}ms. Msg: ${body.error?.message || 'Success'}`);
  } catch (err) {
    console.error(`Error for ${model}:`, err.message);
  }
}

async function run() {
  const models = [
    'gemini-3.5-flash',
    'gemini-2.5-flash',
    'gemini-2.0-flash',
    'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-2.0-flash-exp'
  ];
  for (const m of models) {
    await testGemini(m);
  }
}

run();
