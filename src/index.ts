import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { transactionRoutes } from './routes/transactions';
import { errorHandler } from './middleware/errorHandler';
import { connectRedis } from './config/redis';
import { globalTimeout, haltOnTimedout, timeoutErrorHandler } from './middleware/timeout';
import { responseTime } from './middleware/responseTime';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3000;

// Rate limiter
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
});

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(limiter);

// Global timeout configuration
app.use(responseTime);
app.use(globalTimeout);
app.use(haltOnTimedout);

// Basic health check
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use('/api/transactions', transactionRoutes);

// Timeout error handler (must be before general error handler)
app.use(timeoutErrorHandler);
app.use(errorHandler);

// Init Redis
connectRedis()
  .then(() => {
    console.log("Redis initialized");
  })
  .catch((err) => {
    console.error("Failed to connect to Redis:", err);
    console.warn("Distributed locks will not be available");
  });

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});