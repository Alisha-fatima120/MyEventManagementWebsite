const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const client = require('prom-client');

const app = express();
app.use(cors());
app.use(express.json());

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'eventuser',
  password: process.env.DB_PASSWORD || 'eventpass',
  database: process.env.DB_NAME || 'eventsdb',
});

// ---- Prometheus metrics (/metrics) ----
client.collectDefaultMetrics();
const httpCounter = new client.Counter({
  name: 'http_requests_total',
  help: 'Total HTTP requests',
  labelNames: ['method', 'route', 'status'],
});
app.use((req, res, next) => {
  res.on('finish', () => {
    httpCounter.inc({
      method: req.method,
      route: req.route ? req.route.path : 'unmatched',
      status: res.statusCode,
    });
  });
  next();
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- DB init with retry (DB pod may start after backend) ----
async function initDb() {
  for (let i = 1; i <= 30; i++) {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        event_date DATE,
        venue TEXT
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS registrations (
        id SERIAL PRIMARY KEY,
        event_id INT REFERENCES events(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )`);
      const { rows } = await pool.query('SELECT COUNT(*)::int AS c FROM events');
      if (rows[0].c === 0) {
        await pool.query(
          `INSERT INTO events (name, description, event_date, venue) VALUES
           ('Nescon', 'Annual national tech convention with competitions and talks.', '2026-11-20', 'Main Auditorium'),
           ('Execup', 'Inter-university executive and business competition.', '2026-11-27', 'Seminar Hall'),
           ('VisioSpark', 'Creative design, media and innovation showcase.', '2026-12-04', 'Art Block'),
           ('ACM Hackathon', '24-hour coding hackathon organised by ACM.', '2026-12-12', 'CS Department Lab')`
        );
      }
      console.log('Database ready');
      return;
    } catch (err) {
      console.log(`DB not ready (attempt ${i}/30): ${err.message}`);
      await sleep(3000);
    }
  }
  console.error('Could not connect to database');
  process.exit(1);
}

// ---- Health ----
app.get('/health', (req, res) => res.json({ status: 'ok' }));
app.get('/ready', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ status: 'ready' });
  } catch (e) {
    res.status(503).json({ status: 'db not ready' });
  }
});
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

// ---- API ----
app.get('/api/events', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT e.id, e.name, e.description, to_char(e.event_date, 'YYYY-MM-DD') AS event_date,
              e.venue, COUNT(r.id)::int AS registrations
       FROM events e LEFT JOIN registrations r ON r.event_id = e.id
       GROUP BY e.id ORDER BY e.event_date`
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/events', async (req, res) => {
  const { name, description, event_date, venue } = req.body;
  if (!name) return res.status(400).json({ error: 'name is required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO events (name, description, event_date, venue) VALUES ($1,$2,$3,$4) RETURNING *',
      [name, description || '', event_date || null, venue || '']
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/events/:id', async (req, res) => {
  try {
    await pool.query('DELETE FROM events WHERE id = $1', [req.params.id]);
    res.json({ deleted: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/events/:id/register', async (req, res) => {
  const { name, email } = req.body;
  if (!name || !email) return res.status(400).json({ error: 'name and email are required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO registrations (event_id, name, email) VALUES ($1,$2,$3) RETURNING *',
      [req.params.id, name, email]
    );
    res.status(201).json(rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/events/:id/registrations', async (req, res) => {
  try {
    const { rows } = await pool.query(
      'SELECT id, name, email, created_at FROM registrations WHERE event_id = $1 ORDER BY created_at DESC',
      [req.params.id]
    );
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

const PORT = process.env.PORT || 3000;
initDb().then(() => app.listen(PORT, () => console.log(`Backend listening on ${PORT}`)));
