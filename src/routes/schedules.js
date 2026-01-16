const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const auth = require('../middleware/auth');

// ============ BRANCH SCHEDULES ============

// Obtener horario de sucursal
router.get('/branch/:branch_id', auth, async (req, res) => {
  try {
    // Validar que la sucursal pertenece a la cuenta
    const [branch] = await db.query(
      'SELECT id FROM branches WHERE id = ? AND account_id = ?',
      [req.params.branch_id, req.user.account_id]
    );

    if (branch.length === 0) {
      return res.status(404).json({ error: 'Sucursal no encontrada' });
    }

    const [rows] = await db.query('SELECT * FROM branch_schedules WHERE branch_id = ?', [req.params.branch_id]);
    if (rows.length === 0) {
      return res.json({
        branch_id: req.params.branch_id,
        schedule: {
          monday: { enabled: true, openTime: '09:00', closeTime: '19:00' },
          tuesday: { enabled: true, openTime: '09:00', closeTime: '19:00' },
          wednesday: { enabled: true, openTime: '09:00', closeTime: '19:00' },
          thursday: { enabled: true, openTime: '09:00', closeTime: '19:00' },
          friday: { enabled: true, openTime: '09:00', closeTime: '19:00' },
          saturday: { enabled: true, openTime: '09:00', closeTime: '14:00' },
          sunday: { enabled: false, openTime: '09:00', closeTime: '14:00' }
        }
      });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Guardar/actualizar horario de sucursal
router.put('/branch/:branch_id', auth, async (req, res) => {
  try {
    // Validar que la sucursal pertenece a la cuenta
    const [branch] = await db.query(
      'SELECT id FROM branches WHERE id = ? AND account_id = ?',
      [req.params.branch_id, req.user.account_id]
    );

    if (branch.length === 0) {
      return res.status(404).json({ error: 'Sucursal no encontrada' });
    }

    const { schedule } = req.body;

    const [existing] = await db.query('SELECT id FROM branch_schedules WHERE branch_id = ?', [req.params.branch_id]);

    if (existing.length > 0) {
      await db.query(
        'UPDATE branch_schedules SET schedule = ? WHERE branch_id = ?',
        [JSON.stringify(schedule), req.params.branch_id]
      );
    } else {
      await db.query(
        'INSERT INTO branch_schedules (id, branch_id, schedule) VALUES (UUID(), ?, ?)',
        [req.params.branch_id, JSON.stringify(schedule)]
      );
    }

    res.json({ message: 'Horario actualizado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ STYLIST SCHEDULES ============

// Obtener horario de profesional
router.get('/stylist/:stylist_id', auth, async (req, res) => {
  try {
    // Validar que el estilista pertenece a la cuenta
    const [stylist] = await db.query(
      'SELECT id FROM users WHERE id = ? AND account_id = ?',
      [req.params.stylist_id, req.user.account_id]
    );

    if (stylist.length === 0) {
      return res.status(404).json({ error: 'Profesional no encontrado' });
    }

    const { branch_id } = req.query;
    let query = 'SELECT * FROM stylist_schedules WHERE stylist_id = ?';
    const params = [req.params.stylist_id];

    if (branch_id) {
      query += ' AND branch_id = ?';
      params.push(branch_id);
    }

    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Guardar/actualizar horario de profesional
router.put('/stylist/:stylist_id', auth, async (req, res) => {
  try {
    // Validar que el estilista pertenece a la cuenta
    const [stylist] = await db.query(
      'SELECT id FROM users WHERE id = ? AND account_id = ?',
      [req.params.stylist_id, req.user.account_id]
    );

    if (stylist.length === 0) {
      return res.status(404).json({ error: 'Profesional no encontrado' });
    }

    const { branch_id, schedule } = req.body;

    const [existing] = await db.query(
      'SELECT id FROM stylist_schedules WHERE stylist_id = ? AND branch_id = ?',
      [req.params.stylist_id, branch_id || req.user.branch_id]
    );

    if (existing.length > 0) {
      await db.query(
        'UPDATE stylist_schedules SET schedule = ? WHERE stylist_id = ? AND branch_id = ?',
        [JSON.stringify(schedule), req.params.stylist_id, branch_id || req.user.branch_id]
      );
    } else {
      await db.query(
        'INSERT INTO stylist_schedules (id, stylist_id, branch_id, schedule) VALUES (UUID(), ?, ?, ?)',
        [req.params.stylist_id, branch_id || req.user.branch_id, JSON.stringify(schedule)]
      );
    }

    res.json({ message: 'Horario actualizado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ BLOCKED DAYS ============

// Listar días bloqueados (por cuenta)
router.get('/blocked', auth, async (req, res) => {
  try {
    const { type, target_id, start_date, end_date } = req.query;
    let query = `
      SELECT bd.* FROM blocked_days bd
      LEFT JOIN branches b ON bd.type = 'branch' AND bd.target_id = b.id
      LEFT JOIN users u ON bd.type = 'stylist' AND bd.target_id = u.id
      WHERE (b.account_id = ? OR u.account_id = ?)
    `;
    const params = [req.user.account_id, req.user.account_id];

    if (type) {
      query += ' AND bd.type = ?';
      params.push(type);
    }
    if (target_id) {
      query += ' AND bd.target_id = ?';
      params.push(target_id);
    }
    if (start_date && end_date) {
      query += ' AND ((bd.start_date BETWEEN ? AND ?) OR (bd.end_date BETWEEN ? AND ?))';
      params.push(start_date, end_date, start_date, end_date);
    }

    query += ' ORDER BY bd.start_date';
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear día bloqueado
router.post('/blocked', auth, async (req, res) => {
  try {
    const { type, target_id, start_date, end_date, reason } = req.body;

    // Validar que el target pertenece a la cuenta
    if (type === 'branch') {
      const [branch] = await db.query(
        'SELECT id FROM branches WHERE id = ? AND account_id = ?',
        [target_id, req.user.account_id]
      );
      if (branch.length === 0) {
        return res.status(400).json({ error: 'Sucursal inválida' });
      }
    } else if (type === 'stylist') {
      const [stylist] = await db.query(
        'SELECT id FROM users WHERE id = ? AND account_id = ?',
        [target_id, req.user.account_id]
      );
      if (stylist.length === 0) {
        return res.status(400).json({ error: 'Profesional inválido' });
      }
    }

    const id = uuidv4();

    await db.query(
      'INSERT INTO blocked_days (id, type, target_id, start_date, end_date, reason) VALUES (?, ?, ?, ?, ?, ?)',
      [id, type, target_id, start_date, end_date, reason]
    );

    res.status(201).json({ id, type, target_id, start_date, end_date, reason });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Actualizar día bloqueado
router.put('/blocked/:id', auth, async (req, res) => {
  try {
    const { type, target_id, start_date, end_date, reason } = req.body;

    await db.query(
      'UPDATE blocked_days SET type = ?, target_id = ?, start_date = ?, end_date = ?, reason = ? WHERE id = ?',
      [type, target_id, start_date, end_date, reason, req.params.id]
    );

    res.json({ id: req.params.id, type, target_id, start_date, end_date, reason });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar día bloqueado
router.delete('/blocked/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM blocked_days WHERE id = ?', [req.params.id]);
    res.json({ message: 'Día bloqueado eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
