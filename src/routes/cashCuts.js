const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const auth = require('../middleware/auth');

// Listar cortes (por sucursal)
router.get('/', auth, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    let query = `
      SELECT cc.*, u.name as user_name 
      FROM cash_cuts cc 
      LEFT JOIN users u ON cc.user_id = u.id 
      WHERE cc.branch_id = ?
    `;
    const params = [req.user.branch_id];

    if (start_date && end_date) {
      query += ' AND cc.date BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    query += ' ORDER BY cc.date DESC, cc.created_at DESC';
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener un corte (validar sucursal)
router.get('/:id', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT cc.*, u.name as user_name 
       FROM cash_cuts cc 
       LEFT JOIN users u ON cc.user_id = u.id 
       WHERE cc.id = ? AND cc.branch_id = ?`,
      [req.params.id, req.user.branch_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Corte no encontrado' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear corte de caja
router.post('/', auth, async (req, res) => {
  try {
    const {
      shift_id,
      user_id,
      date,
      total_sales,
      total_expenses,
      total_purchases,
      completed_appointments,
      sales_by_method,
      expenses_by_method,
      purchases_by_method,
      expected_by_method,
      real_by_method,
      difference_by_method,
      expected,
      real_amount,
      difference,
      initial_cash,
      final_cash
    } = req.body;

    const id = uuidv4();
    const branch_id = req.user.branch_id;

    await db.query(
      `INSERT INTO cash_cuts (
        id, shift_id, branch_id, user_id, date, total_sales, total_expenses, 
        total_purchases, completed_appointments, sales_by_method, expenses_by_method,
        purchases_by_method, expected_by_method, real_by_method, difference_by_method,
        expected, real_amount, difference, initial_cash, final_cash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id, shift_id, branch_id, user_id || req.user.user_id, date, total_sales, total_expenses,
        total_purchases, completed_appointments, 
        JSON.stringify(sales_by_method), JSON.stringify(expenses_by_method),
        JSON.stringify(purchases_by_method), JSON.stringify(expected_by_method),
        JSON.stringify(real_by_method), JSON.stringify(difference_by_method),
        expected, real_amount, difference, initial_cash, final_cash
      ]
    );

    res.status(201).json({ id, message: 'Corte de caja creado exitosamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar corte
router.delete('/:id', auth, async (req, res) => {
  try {
    const [result] = await db.query(
      'DELETE FROM cash_cuts WHERE id = ? AND branch_id = ?',
      [req.params.id, req.user.branch_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: 'Corte no encontrado' });
    }

    res.json({ message: 'Corte eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
