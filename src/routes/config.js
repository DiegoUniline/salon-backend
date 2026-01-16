const express = require('express');
const router = express.Router();
const db = require('../config/database');
const auth = require('../middleware/auth');

// Obtener configuración (por cuenta)
router.get('/', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM business_config WHERE account_id = ?',
      [req.user.account_id]
    );

    if (rows.length === 0) {
      return res.json({
        type: 'salon',
        name: '',
        phone: '',
        address: '',
        ticket_fields: []
      });
    }

    const config = rows[0];
    config.ticket_fields = typeof config.ticket_fields === 'string' 
      ? JSON.parse(config.ticket_fields) 
      : config.ticket_fields;

    res.json(config);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Actualizar configuración
router.put('/', auth, async (req, res) => {
  try {
    const { type, name, phone, address, ticket_fields } = req.body;

    const [existing] = await db.query(
      'SELECT id FROM business_config WHERE account_id = ?',
      [req.user.account_id]
    );

    if (existing.length > 0) {
      await db.query(
        'UPDATE business_config SET type = ?, name = ?, phone = ?, address = ?, ticket_fields = ? WHERE account_id = ?',
        [type, name, phone, address, JSON.stringify(ticket_fields || []), req.user.account_id]
      );
    } else {
      await db.query(
        'INSERT INTO business_config (id, account_id, type, name, phone, address, ticket_fields) VALUES (UUID(), ?, ?, ?, ?, ?, ?)',
        [req.user.account_id, type, name, phone, address, JSON.stringify(ticket_fields || [])]
      );
    }

    res.json({ message: 'Configuración actualizada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
