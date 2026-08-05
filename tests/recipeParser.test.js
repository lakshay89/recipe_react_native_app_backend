const request = require('supertest');
const app = require('../src/app');

const sharp = require('sharp');

describe('Recipe Parser Endpoints', () => {
  let originalFetch;
  let originalEnv;
  let mockPngBuffer;

  beforeAll(async () => {
    originalFetch = global.fetch;
    originalEnv = process.env.GEMINI_API_KEY;
    process.env.GEMINI_API_KEY = 'mock-api-key';

    // Dynamically generate a valid 50x50 PNG using sharp
    mockPngBuffer = await sharp({
      create: {
        width: 50,
        height: 50,
        channels: 3,
        background: { r: 255, g: 0, b: 0 }
      }
    }).png().toBuffer();
  });

  afterAll(() => {
    global.fetch = originalFetch;
    process.env.GEMINI_API_KEY = originalEnv;
  });

  beforeEach(() => {
    jest.resetModules();
  });

  describe('POST /api/v1/recipes/extract-images', () => {
    test('Successful single image scan transcription', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      text: 'Monsoon Kadhai Dal Recipe\nSoak dal for 8 hours.',
                      detectedLanguages: ['en'],
                      quality: { level: 'good', warnings: [] },
                      uncertainSegments: [],
                      containsRecipe: true
                    })
                  }
                ]
              }
            }
          ]
        })
      });

      const response = await request(app)
        .post('/api/v1/recipes/extract-images')
        .attach('images', mockPngBuffer, 'recipe.png');

      console.log('DEBUG TEST SINGLE IMAGE:', response.status, response.body);
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.containsRecipe).toBe(true);
      expect(response.body.data.pages[0].text).toContain('Monsoon Kadhai Dal');
    });

    test('Successful multiple image scan transcription in order', async () => {
      let callCount = 0;
      global.fetch = jest.fn().mockImplementation(async () => {
        callCount++;
        return {
          ok: true,
          json: async () => ({
            candidates: [
              {
                content: {
                  parts: [
                    {
                      text: JSON.stringify({
                        text: `Page ${callCount} content`,
                        detectedLanguages: ['en'],
                        quality: { level: 'good', warnings: [] },
                        uncertainSegments: [],
                        containsRecipe: true
                      })
                    }
                  ]
                }
              }
            ]
          })
        };
      });

      const response = await request(app)
        .post('/api/v1/recipes/extract-images')
        .attach('images', mockPngBuffer, 'page1.png')
        .attach('images', mockPngBuffer, 'page2.png');

      expect(response.status).toBe(200);
      expect(response.body.data.pages.length).toBe(2);
      expect(response.body.data.pages[0].pageNumber).toBe(1);
      expect(response.body.data.pages[0].text).toBe('Page 1 content');
      expect(response.body.data.pages[1].pageNumber).toBe(2);
      expect(response.body.data.pages[1].text).toBe('Page 2 content');
    });

    test('More than five images rejected', async () => {
      const response = await request(app)
        .post('/api/v1/recipes/extract-images')
        .attach('images', mockPngBuffer, '1.png')
        .attach('images', mockPngBuffer, '2.png')
        .attach('images', mockPngBuffer, '3.png')
        .attach('images', mockPngBuffer, '4.png')
        .attach('images', mockPngBuffer, '5.png')
        .attach('images', mockPngBuffer, '6.png');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('TOO_MANY_IMAGES');
    });

    test('Incorrect MIME type or non-image files rejected', async () => {
      const response = await request(app)
        .post('/api/v1/recipes/extract-images')
        .attach('images', Buffer.from('hello world'), 'recipe.txt');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('UNSUPPORTED_IMAGE_TYPE');
    });

    test('Corrupt image rejected by Sharp validation', async () => {
      const response = await request(app)
        .post('/api/v1/recipes/extract-images')
        .attach('images', Buffer.from([1, 2, 3, 4, 5]), 'corrupt.png');

      expect(response.status).toBe(400);
      expect(response.body.code).toBe('CORRUPT_IMAGE');
    });

    test('Non-recipe image returns 422 NO_RECIPE_TEXT_DETECTED', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      text: 'Selfie photo or document receipt.',
                      detectedLanguages: ['en'],
                      quality: { level: 'good', warnings: [] },
                      uncertainSegments: [],
                      containsRecipe: false
                    })
                  }
                ]
              }
            }
          ]
        })
      });

      const response = await request(app)
        .post('/api/v1/recipes/extract-images')
        .attach('images', mockPngBuffer, 'nonrecipe.png');

      expect(response.status).toBe(422);
      expect(response.body.code).toBe('NO_RECIPE_TEXT_DETECTED');
    });

    test('Empty Gemini transcription error handling', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: []
        })
      });

      const response = await request(app)
        .post('/api/v1/recipes/extract-images')
        .attach('images', mockPngBuffer, 'page1.png');

      expect(response.status).toBe(502);
      expect(response.body.code).toBe('AI_RESPONSE_INVALID');
    });

    test('Malformed Gemini JSON error handling', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: '{ malformed json... }'
                  }
                ]
              }
            }
          ]
        })
      });

      const response = await request(app)
        .post('/api/v1/recipes/extract-images')
        .attach('images', mockPngBuffer, 'page1.png');

      expect(response.status).toBe(502);
      expect(response.body.code).toBe('AI_RESPONSE_INVALID');
    });

    test('Gemini timeout error handling', async () => {
      global.fetch = jest.fn().mockImplementation(() => {
        const err = new Error('The operation was aborted due to timeout.');
        err.name = 'TimeoutError';
        return Promise.reject(err);
      });

      const response = await request(app)
        .post('/api/v1/recipes/extract-images')
        .attach('images', mockPngBuffer, 'page1.png');

      expect(response.status).toBe(504);
      expect(response.body.code).toBe('REQUEST_TIMEOUT');
    });

    test('Gemini rate limit error handling', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 429,
        text: async () => 'Rate limit exceeded'
      });

      const response = await request(app)
        .post('/api/v1/recipes/extract-images')
        .attach('images', mockPngBuffer, 'page1.png');

      expect(response.status).toBe(429);
      expect(response.body.code).toBe('AI_RATE_LIMITED');
    });
  });

  describe('POST /api/v1/recipes/parse (backward compatibility & scan struct)', () => {
    test('Original backward compatible plain-text parsing', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      title: 'Plain Text Kheer',
                      localName: 'Kheer',
                      nativeScript: 'Devanagari',
                      altNames: '',
                      history: '',
                      region: '',
                      state: '',
                      prepTime: '10 mins',
                      cookTime: '30 mins',
                      serves: '4',
                      ingredients: [],
                      cookingStepsList: []
                    })
                  }
                ]
              }
            }
          ]
        })
      });

      const response = await request(app)
        .post('/api/v1/recipes/parse')
        .send({ text: 'Some unstructured plain text recipe' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.title).toBe('Plain Text Kheer');
    });

    test('Structured scanning parse with provenance metadata validation', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      title: { value: 'Saffron Kheer', provenance: 'extracted', confidence: 'high' },
                      localName: { value: 'केसर खीर', provenance: 'extracted', confidence: 'high' },
                      nativeScript: { value: 'Devanagari', provenance: 'extracted', confidence: 'high' },
                      detectedLanguage: 'hi',
                      pronunciation: { value: 'Kesar Kheer', provenance: 'suggested', confidence: 'medium' },
                      description: { value: 'Traditional dessert', provenance: 'extracted', confidence: 'high' },
                      ingredients: [
                        {
                          name: { value: 'Milk', provenance: 'extracted', confidence: 'high' },
                          quantity: { value: '1', provenance: 'extracted', confidence: 'high' },
                          unit: { value: 'Litre (l)', provenance: 'normalized', confidence: 'high' },
                          preparation: { value: 'boiled', provenance: 'extracted', confidence: 'high' }
                        }
                      ],
                      cookingSteps: [
                        {
                          stepText: { value: 'Boil cow milk.', provenance: 'extracted', confidence: 'high' },
                          stepNumber: 1
                        }
                      ],
                      prepTime: { value: '10 mins', provenance: 'extracted', confidence: 'high' },
                      cookTime: { value: '35 mins', provenance: 'extracted', confidence: 'high' },
                      restingTime: { value: '0 mins', provenance: 'missing', confidence: 'high' },
                      servings: { value: '6', provenance: 'suggested', confidence: 'medium' },
                      traditionalCookware: { value: 'Pattila', provenance: 'suggested', confidence: 'low' },
                      state: { value: 'Uttar Pradesh', provenance: 'extracted', confidence: 'high' },
                      district: { value: 'Varanasi', provenance: 'extracted', confidence: 'high' },
                      village: { value: '', provenance: 'missing', confidence: 'high' },
                      heritageSource: { value: 'Grandmother', provenance: 'extracted', confidence: 'high' },
                      sourcePerson: { value: 'Devi Prasad', provenance: 'extracted', confidence: 'high' },
                      sourceType: { value: 'oral_transmission', provenance: 'extracted', confidence: 'high' },
                      culturalAssociation: { value: 'Diwali', provenance: 'extracted', confidence: 'high' },
                      notes: { value: '', provenance: 'missing', confidence: 'high' },
                      missingFields: [],
                      clarificationQuestions: [],
                      aiSuggestions: [
                        { id: 'sug-1', field: 'servings', suggestedValue: '6', reason: 'Common serving size for dessert' }
                      ],
                      warnings: []
                    })
                  }
                ]
              }
            }
          ]
        })
      });

      const response = await request(app)
        .post('/api/v1/recipes/parse')
        .send({
          source: 'image_scan',
          text: 'Corrected recipe transcription text'
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.title.value).toBe('Saffron Kheer');
      expect(response.body.data.ingredients[0].name.provenance).toBe('extracted');
    });
  });
});
