const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const auth = require('../middleware/auth');

// Listar servicios
router.get('/', async (req, res) => {
  try {
    const { category, active } = req.query;
    let query = 'SELECT * FROM services WHERE 1=1';
    const params = [];

    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }
    if (active !== undefined) {
      query += ' AND active = ?';
      params.push(active === 'true' ? 1 : 0);
    }

    query += ' ORDER BY category, name';
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener categorías
router.get('/categories', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT DISTINCT category FROM services WHERE category IS NOT NULL ORDER BY category');
    res.json(rows.map(r => r.category));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener un servicio
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM services WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Servicio no encontrado' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear servicio
router.post('/', auth, async (req, res) => {
  try {
    const { name, category, price, duration, commission } = req.body;
    const id = uuidv4();

    await db.query(
      'INSERT INTO services (id, name, category, price, duration, commission) VALUES (?, ?, ?, ?, ?, ?)',
      [id, name, category, price, duration || 30, commission || 0]
    );

    res.status(201).json({ id, name, category, price, duration: duration || 30, commission: commission || 0, active: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear servicios masivos
router.post('/bulk', auth, async (req, res) => {
  try {
    const { services } = req.body;
    const created = [];

    for (const service of services) {
      const id = uuidv4();
      await db.query(
        'INSERT INTO services (id, name, category, price, duration, commission) VALUES (?, ?, ?, ?, ?, ?)',
        [id, service.name, service.category, service.price, service.duration || 30, service.commission || 0]
      );
      created.push({ id, ...service });
    }

    res.status(201).json(created);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Actualizar servicio
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, category, price, duration, commission, active } = req.body;

    await db.query(
      'UPDATE services SET name = ?, category = ?, price = ?, duration = ?, commission = ?, active = ? WHERE id = ?',
      [name, category, price, duration, commission, active ? 1 : 0, req.params.id]
    );

    res.json({ id: req.params.id, name, category, price, duration, commission, active });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar servicio
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM services WHERE id = ?', [req.params.id]);
    res.json({ message: 'Servicio eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
