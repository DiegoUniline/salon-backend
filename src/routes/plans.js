const express = require('express');
const router = express.Router();
const db = require('../config/database');

// Listar planes (público)
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM plans WHERE active = 1 ORDER BY price_monthly'
    );
    
    // Parsear features JSON
    const plans = rows.map(plan => ({
      ...plan,
      features: typeof plan.features === 'string' ? JSON.parse(plan.features) : plan.features
    }));

    res.json(plans);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener un plan
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM plans WHERE id = ?', [req.params.id]);
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Plan no encontrado' });
    }

    const plan = rows[0];
    plan.features = typeof plan.features === 'string' ? JSON.parse(plan.features) : plan.features;

    res.json(plan);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
