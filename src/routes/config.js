const express = require('express');
const router = express.Router();
const db = require('../config/database');
const auth = require('../middleware/auth');

// Obtener configuración
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM business_config LIMIT 1');
    if (rows.length === 0) {
      return res.json({
        type: 'salon',
        name: '',
        phone: '',
        address: '',
        ticket_fields: []
      });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Actualizar configuración
router.put('/', auth, async (req, res) => {
  try {
    const { type, name, phone, address, ticket_fields } = req.body;

    const [existing] = await db.query('SELECT id FROM business_config LIMIT 1');

    if (existing.length > 0) {
      await db.query(
        'UPDATE business_config SET type = ?, name = ?, phone = ?, address = ?, ticket_fields = ? WHERE id = ?',
        [type, name, phone, address, JSON.stringify(ticket_fields || []), existing[0].id]
      );
    } else {
      await db.query(
        'INSERT INTO business_config (id, type, name, phone, address, ticket_fields) VALUES (UUID(), ?, ?, ?, ?, ?)',
        [type, name, phone, address, JSON.stringify(ticket_fields || [])]
      );
    }

    res.json({ message: 'Configuración actualizada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
