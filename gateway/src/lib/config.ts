import 'dotenv/config';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function requiredList(name: string): string[] {
  const items = required(name)
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  if (items.length === 0) {
    throw new Error(`Environment variable ${name} must contain at least one value`);
  }
  return items;
}

export const config = {
  geminiApiKey: required('GEMINI_API_KEY'),
  metricsBaseUrl: required('METRICS_BASE_URL'),
  allowedOrigins: requiredList('ALLOWED_ORIGINS'),
  port: Number(process.env.PORT ?? 3000),
};
