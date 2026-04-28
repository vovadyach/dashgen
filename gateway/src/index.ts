import express from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { config } from './lib/config.js';

const app = express();

app.use(cors({ origin: config.allowedOrigins }));

app.use(express.json());

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { error: 'rate limit exceeded, try again in a minute' },
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.post('/chat', chatLimiter, async (req, res) => {
  const message = req.body?.message;
  if (!message || typeof message !== 'string') {
    res.status(400).json({ error: 'message is required' });
    return;
  }
  res.status(501).json({ error: 'not implemented yet' });
});

app.listen(config.port, () => {
  console.log(`gateway listening on :${config.port}`);
  console.log(`metrics service: ${config.metricsBaseUrl}`);
});
