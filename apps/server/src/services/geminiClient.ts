import { GoogleGenAI } from '@google/genai';

let cachedClient: GoogleGenAI | null = null;

/**
 * 공식 @google/genai SDK 싱글톤 클라이언트 제공자
 */
export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) return null;

  if (!cachedClient) {
    cachedClient = new GoogleGenAI({ apiKey });
  }
  return cachedClient;
}
