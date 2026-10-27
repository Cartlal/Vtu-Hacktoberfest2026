require('dotenv').config({ path: require('node:path').join(__dirname, '..', '.env'), quiet: true });
const db = require('./db');
const payments = require('./payments');

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  console.error('JWT_SECRET must be set in production.');
  process.exit(1);
}

(async () => {
  try {
    await db.connect();
  } catch (err) {
    console.error(`Could not connect to MongoDB: ${err.message}`);
    console.error('Check MONGODB_URI, the password, and that Atlas Network Access allows this IP.');
    process.exit(1);
  }
  const app = require('./app');
  const port = Number(process.env.PORT) || 4000;
  app.listen(port, () => {
    console.log(`Trick or Commit API on http://localhost:${port} (payments: ${payments.mode()})`);
  });
})();
