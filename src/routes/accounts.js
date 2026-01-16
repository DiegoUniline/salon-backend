const express = require('express');
const router = express.Router();
const db = require('../config/database');
const auth = require('../middleware/auth');

// Obtener datos de la cuenta
router.get('/current', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM accounts WHERE id = ?',
      [req.user.account_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Cuenta no encontrada' });
    }

    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Actualizar datos de la cuenta
router.put('/current', auth, async (req, res) => {
  try {
    const { name, email, phone } = req.body;

    await db.query(
      'UPDATE accounts SET name = ?, email = ?, phone = ? WHERE id = ?',
      [name, email, phone, req.user.account_id]
    );

    res.json({ message: 'Cuenta actualizada', name, email, phone });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Estadísticas generales de la cuenta
router.get('/stats', auth, async (req, res) => {
  try {
    const accountId = req.user.account_id;

    const [users] = await db.query(
      'SELECT COUNT(*) as total FROM users WHERE account_id = ? AND active = 1',
      [accountId]
    );

    const [branches] = await db.query(
      'SELECT COUNT(*) as total FROM branches WHERE account_id = ?',
      [accountId]
    );

    const [clients] = await db.query(
      'SELECT COUNT(*) as total FROM clients WHERE account_id = ?',
      [accountId]
    );

    const [products] = await db.query(
      'SELECT COUNT(*) as total FROM products WHERE account_id = ? AND active = 1',
      [accountId]
    );

    const [services] = await db.query(
      'SELECT COUNT(*) as total FROM services WHERE account_id = ? AND active = 1',
      [accountId]
    );

    res.json({
      users: users[0].total,
      branches: branches[0].total,
      clients: clients[0].total,
      products: products[0].total,
      services: services[0].total
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
