import { GoogleGenAI } from '@google/genai';
import { state } from './state.js';

let cachedKey = null;
let cachedClient = null;

export function getGenAI() {
  if (!state.apiKey) {
    throw new Error('Missing API key. Please set your Gemini API key first.');
  }
  if (cachedClient && cachedKey === state.apiKey) return cachedClient;
  cachedKey = state.apiKey;
  cachedClient = new GoogleGenAI({ apiKey: state.apiKey });
  return cachedClient;
}

