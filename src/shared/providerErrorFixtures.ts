/**
 * Provider error cases shared by the classifier tests.
 *
 * SYNTHETIC: these are not recorded answers from Lara or Google. Each case is built from what the
 * current classifiers in providerErrors.ts are written to handle, and the expected
 * result is what they return today. Lara does not publish the status or type for an exhausted
 * quota, so its quota cases in particular are guesses and stay unverified until a real answer is
 * recorded. Replace a case with a recorded answer when one is available.
 */

export interface LaraErrorCase {
  name: string;
  input: { statusCode: number; type: string; message: string };
  expected: 'invalid-key' | 'quota-or-limit' | null;
}

export interface GeminiErrorCase {
  name: string;
  status: number;
  message: string;
  expected: 'expired-key' | 'invalid-key' | 'quota-exhausted' | null;
}

const lara = (statusCode: number, type: string, message: string) => ({ statusCode, type, message });

export const LARA_ERROR_CASES: LaraErrorCase[] = [
  { name: '401 is an invalid key', input: lara(401, 'Unauthorized', 'no'), expected: 'invalid-key' },
  { name: '403 without quota wording is an invalid key', input: lara(403, 'Forbidden', 'denied'), expected: 'invalid-key' },
  { name: '400 with auth wording is an invalid key', input: lara(400, 'AuthenticationError', 'bad credentials'), expected: 'invalid-key' },
  { name: '402 is quota or limit', input: lara(402, 'PaymentRequired', 'x'), expected: 'quota-or-limit' },
  { name: '429 is quota or limit', input: lara(429, 'TooManyRequests', 'slow down'), expected: 'quota-or-limit' },
  { name: '400 with monthly usage wording is quota or limit', input: lara(400, 'QuotaExceeded', 'monthly characters used up'), expected: 'quota-or-limit' },
  { name: '403 with quota wording is quota, not an invalid key', input: lara(403, 'X', 'Usage limit exceeded'), expected: 'quota-or-limit' },
  { name: '400 insufficient credit wording is quota or limit', input: lara(400, 'X', 'Insufficient credit balance'), expected: 'quota-or-limit' },
  { name: '401 with quota wording is still an invalid key (status is checked first)', input: lara(401, 'QuotaExceeded', 'Usage limit exceeded'), expected: 'invalid-key' },
  { name: '400 with both auth and quota wording is quota or limit (quota wording wins)', input: lara(400, 'AuthenticationError', 'invalid credentials, quota exceeded'), expected: 'quota-or-limit' },
  { name: '399 is below the 4xx range, so never a key problem', input: lara(399, 'Unauthorized', 'quota exceeded'), expected: null },
  { name: '499 with quota wording is quota or limit (top of the 4xx range)', input: lara(499, 'X', 'quota exceeded'), expected: 'quota-or-limit' },
  { name: '499 with auth wording is an invalid key (top of the 4xx range)', input: lara(499, 'X', 'unauthorized'), expected: 'invalid-key' },
  { name: '499 with no wording is not a key problem', input: lara(499, 'X', 'plain'), expected: null },
  { name: '400 validation error is not a key problem', input: lara(400, 'ValidationError', 'bad target language'), expected: null },
  { name: '404 is not a key problem', input: lara(404, 'NotFound', 'no such resource'), expected: null },
  { name: '500 is not a key problem', input: lara(500, 'InternalError', 'x'), expected: null },
  { name: '503 with limit wording is not a key problem (only 4xx counts)', input: lara(503, 'Unavailable', 'rate limit reached'), expected: null },
];

export const GEMINI_ERROR_CASES: GeminiErrorCase[] = [
  { name: '401 is an invalid key', status: 401, message: 'API key not valid', expected: 'invalid-key' },
  { name: '400 API_KEY_INVALID is an invalid key', status: 400, message: 'API key not valid. Please pass a valid API key.', expected: 'invalid-key' },
  { name: '403 about a leaked key is an invalid key', status: 403, message: 'Your API key was reported as leaked.', expected: 'invalid-key' },
  { name: '403 about a restricted key is an invalid key', status: 403, message: 'Requests from referer are blocked for this key.', expected: 'invalid-key' },
  { name: '403 saying the API is disabled is an invalid key', status: 403, message: 'Generative Language API has not been used in project 123 before or it is disabled.', expected: 'invalid-key' },
  { name: '403 saying the caller has no permission is an invalid key', status: 403, message: 'The caller does not have permission', expected: 'invalid-key' },
  { name: '403 about an expired key is an expired key', status: 403, message: 'API key expired. Please renew the API key.', expected: 'expired-key' },
  { name: '403 saying the model is not available to new users is not a key problem', status: 403, message: 'This model is no longer available to new users.', expected: null },
  { name: '404 model not found is not a key problem', status: 404, message: 'models/x is not found', expected: null },
  { name: '429 daily project quota blames the key', status: 429, message: 'Quota exceeded for metric: generate_requests_per_project_per_day', expected: 'quota-exhausted' },
  { name: '429 account quota blames the key', status: 429, message: 'Quota exceeded for metric: requests_per_account', expected: 'quota-exhausted' },
  { name: '429 per-minute limit that names the project is not a key problem', status: 429, message: 'Quota exceeded for metric: generativelanguage.googleapis.com/generate_requests_per_minute_per_project', expected: null },
  { name: '429 per minute written with spaces next to a per_project id is not a key problem', status: 429, message: "Quota exceeded for quota metric 'requests per minute' (generativelanguage.googleapis.com/generate_requests_per_project)", expected: null },
  { name: '429 daily project quota with no per-minute wording still blames the key', status: 429, message: 'Quota exceeded for metric: generate_requests_per_project_per_day, limit: 1500. Daily quota; resets at midnight Pacific.', expected: 'quota-exhausted' },
  { name: '429 per-minute limit with a CamelCase metric id is not a key problem', status: 429, message: 'Quota exceeded for quota metric GenerateRequestsPerMinutePerProjectPerModel', expected: null },
  { name: '429 per-minute limit with a per-model free-tier metric is not a key problem', status: 429, message: 'Quota exceeded for metric: generate_content_free_tier_requests_per_minute_per_project_per_model, limit: 5, model: gemini-2.5-flash', expected: null },
  { name: '429 per-minute rate limit is not a key problem', status: 429, message: 'Quota exceeded for metric: generate_requests_per_model_per_minute', expected: null },
  { name: '429 limit 0 on one model is not a key problem', status: 429, message: 'Quota exceeded for metric: generate_requests_per_model_per_day, limit: 0, model: gemini-3.1-pro', expected: null },
  { name: '429 with a positive per-model daily limit is not a key problem', status: 429, message: 'Quota exceeded for metric: generate_requests_per_model_per_day, limit: 20, model: gemini-3-flash', expected: null },
  { name: '429 with generic plan and billing wording is not a key problem', status: 429, message: 'You exceeded your current quota, please check your plan and billing details', expected: null },
  { name: '429 with no detail is not a key problem', status: 429, message: 'Resource has been exhausted', expected: null },
  { name: '500 is not a key problem', status: 500, message: 'internal', expected: null },
];
