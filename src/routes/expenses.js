const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const auth = require('../middleware/auth');

// Listar gastos
router.get('/', async (req, res) => {
  try {
    const { branch_id, category, date, start_date, end_date } = req.query;
    let query = 'SELECT * FROM expenses WHERE 1=1';
    const params = [];

    if (branch_id) {
      query += ' AND branch_id = ?';
      params.push(branch_id);
    }
    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }
    if (date) {
      query += ' AND date = ?';
      params.push(date);
    }
    if (start_date && end_date) {
      query += ' AND date BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    query += ' ORDER BY date DESC, created_at DESC';
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener categorías
router.get('/categories', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT DISTINCT category FROM expenses WHERE category IS NOT NULL ORDER BY category');
    res.json(rows.map(r => r.category));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Resumen por categoría
router.get('/summary', async (req, res) => {
  try {
    const { branch_id, start_date, end_date } = req.query;
    let query = 'SELECT category, SUM(amount) as total FROM expenses WHERE 1=1';
    const params = [];

    if (branch_id) {
      query += ' AND branch_id = ?';
      params.push(branch_id);
    }
    if (start_date && end_date) {
      query += ' AND date BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    query += ' GROUP BY category ORDER BY total DESC';
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener un gasto
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM expenses WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Gasto no encontrado' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear gasto
router.post('/', auth, async (req, res) => {
  try {
    const { branch_id, date, category, description, amount, payment_method, supplier, notes } = req.body;
    const id = uuidv4();

    await db.query(
      `INSERT INTO expenses (id, branch_id, date, category, description, amount, payment_method, supplier, notes) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, branch_id, date, category, description, amount, payment_method, supplier, notes]
    );

    res.status(201).json({ id, branch_id, date, category, description, amount, payment_method, supplier, notes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Actualizar gasto
router.put('/:id', auth, async (req, res) => {
  try {
    const { date, category, description, amount, payment_method, supplier, notes } = req.body;

    await db.query(
      `UPDATE expenses SET date = ?, category = ?, description = ?, amount = ?, 
       payment_method = ?, supplier = ?, notes = ? WHERE id = ?`,
      [date, category, description, amount, payment_method, supplier, notes, req.params.id]
    );

    res.json({ id: req.params.id, date, category, description, amount, payment_method, supplier, notes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar gasto
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM expenses WHERE id = ?', [req.params.id]);
    res.json({ message: 'Gasto eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
