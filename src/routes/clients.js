const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const auth = require('../middleware/auth');

// Listar clientes
router.get('/', async (req, res) => {
  try {
    const { search } = req.query;
    let query = 'SELECT * FROM clients';
    const params = [];

    if (search) {
      query += ' WHERE name LIKE ? OR phone LIKE ? OR email LIKE ?';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    query += ' ORDER BY name';
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener un cliente
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM clients WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Cliente no encontrado' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Historial de citas del cliente
router.get('/:id/appointments', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT a.*, u.name as stylist_name 
       FROM appointments a 
       LEFT JOIN users u ON a.stylist_id = u.id 
       WHERE a.client_id = ? 
       ORDER BY a.date DESC, a.time DESC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear cliente
router.post('/', async (req, res) => {
  try {
    const { name, phone, email, notes } = req.body;
    const id = uuidv4();

    await db.query(
      'INSERT INTO clients (id, name, phone, email, notes) VALUES (?, ?, ?, ?, ?)',
      [id, name, phone, email, notes]
    );

    res.status(201).json({ id, name, phone, email, notes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Actualizar cliente
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, phone, email, notes } = req.body;

    await db.query(
      'UPDATE clients SET name = ?, phone = ?, email = ?, notes = ? WHERE id = ?',
      [name, phone, email, notes, req.params.id]
    );

    res.json({ id: req.params.id, name, phone, email, notes });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar cliente
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM clients WHERE id = ?', [req.params.id]);
    res.json({ message: 'Cliente eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
