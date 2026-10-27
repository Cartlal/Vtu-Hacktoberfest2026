const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { HttpError } = require('./errors');
//
const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Render's proxy
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api', require('./routes/products'));
app.use('/api/auth', require('./routes/auth'));
app.use('/api/checkout', require('./routes/checkout').router);
app.use('/api/payments', require('./routes/payments'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api/admin', require('./routes/admin'));
app.use('/api/marketing', require('./routes/marketing'));
app.use('/api/tickets', require('./routes/tickets').router);
app.use('/api', (req, res, next) => next(new HttpError(404, 'Not found.')));

// In production the same service serves the built React app.
const dist = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'Malformed JSON.' });
  const status = err instanceof HttpError ? err.status : 500;
  if (status === 500) console.error(err);
  res.status(status).json({ error: status === 500 ? 'Something went wrong on our side.' : err.message });
});

module.exports = app;
