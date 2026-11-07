import { GoogleGenAI } from '@google/genai';

/** Server-only credentials: local API key or production Vertex identity, never an Android key. */
export function createGenAi() {
  if (process.env.GEMINI_PROVIDER === 'api-key') {
    if (!process.env.GEMINI_API_KEY) throw new Error('Gemini API key is not configured.');
    return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return new GoogleGenAI({ vertexai: true, project: process.env.GCLOUD_PROJECT ?? process.env.GOOGLE_CLOUD_PROJECT,
    location: process.env.VERTEX_LOCATION ?? 'asia-south1' });
}

export const geminiSecrets = process.env.GEMINI_PROVIDER === 'api-key' ? ['GEMINI_API_KEY'] : [];
