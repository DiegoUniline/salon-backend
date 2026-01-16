const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const auth = require('../middleware/auth');

// Listar servicios (por cuenta)
router.get('/', auth, async (req, res) => {
  try {
    const { category, active } = req.query;
    let query = 'SELECT * FROM services WHERE account_id = ?';
    const params = [req.user.account_id];

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

// Obtener categorías (por cuenta)
router.get('/categories', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT DISTINCT category FROM services WHERE account_id = ? AND category IS NOT NULL ORDER BY category',
      [req.user.account_id]
    );
    res.json(rows.map(r => r.category));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener un servicio (validar cuenta)
router.get('/:id', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM services WHERE id = ? AND account_id = ?',
      [req.params.id, req.user.account_id]
    );
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
      'INSERT INTO services (id, name, category, price, duration, commission, account_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, name, category, price, duration || 30, commission || 0, req.user.account_id]
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
        'INSERT INTO services (id, name, category, price, duration, commission, account_id) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [id, service.name, service.category, service.price, service.duration || 30, service.commission || 0, req.user.account_id]
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
      'UPDATE services SET name = ?, category = ?, price = ?, duration = ?, commission = ?, active = ? WHERE id = ? AND account_id = ?',
      [name, category, price, duration, commission, active ? 1 : 0, req.params.id, req.user.account_id]
    );

    res.json({ id: req.params.id, name, category, price, duration, commission, active });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar servicio
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query(
      'DELETE FROM services WHERE id = ? AND account_id = ?',
      [req.params.id, req.user.account_id]
    );
    res.json({ message: 'Servicio eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
