const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const auth = require('../middleware/auth');

// Listar turnos (por sucursal)
router.get('/', auth, async (req, res) => {
  try {
    const { status, date, start_date, end_date } = req.query;
    let query = `
      SELECT s.*, u.name as user_name 
      FROM shifts s 
      LEFT JOIN users u ON s.user_id = u.id 
      WHERE s.branch_id = ?
    `;
    const params = [req.user.branch_id];

    if (status) {
      query += ' AND s.status = ?';
      params.push(status);
    }
    if (date) {
      query += ' AND s.date = ?';
      params.push(date);
    }
    if (start_date && end_date) {
      query += ' AND s.date BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    query += ' ORDER BY s.date DESC, s.start_time DESC';
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener turno abierto (por sucursal)
router.get('/open', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT s.*, u.name as user_name 
       FROM shifts s 
       LEFT JOIN users u ON s.user_id = u.id 
       WHERE s.branch_id = ? AND s.status = 'open' 
       ORDER BY s.created_at DESC LIMIT 1`,
      [req.user.branch_id]
    );
    
    if (rows.length === 0) {
      return res.json(null);
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener un turno (validar sucursal)
router.get('/:id', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT s.*, u.name as user_name 
       FROM shifts s 
       LEFT JOIN users u ON s.user_id = u.id 
       WHERE s.id = ? AND s.branch_id = ?`,
      [req.params.id, req.user.branch_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Turno no encontrado' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Abrir turno
router.post('/open', auth, async (req, res) => {
  try {
    const { initial_cash } = req.body;
    const branch_id = req.user.branch_id;

    const [existing] = await db.query(
      "SELECT id FROM shifts WHERE branch_id = ? AND status = 'open'",
      [branch_id]
    );

    if (existing.length > 0) {
      return res.status(400).json({ error: 'Ya existe un turno abierto en esta sucursal' });
    }

    const id = uuidv4();
    const date = new Date().toISOString().split('T')[0];
    const time = new Date().toTimeString().split(' ')[0];

    await db.query(
      `INSERT INTO shifts (id, branch_id, user_id, date, start_time, initial_cash, status) 
       VALUES (?, ?, ?, ?, ?, ?, 'open')`,
      [id, branch_id, req.user.user_id, date, time, initial_cash]
    );

    res.status(201).json({ id, branch_id, user_id: req.user.user_id, date, start_time: time, initial_cash, status: 'open' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cerrar turno
router.post('/:id/close', auth, async (req, res) => {
  try {
    const { final_cash } = req.body;

    const [existing] = await db.query(
      "SELECT id FROM shifts WHERE id = ? AND branch_id = ?",
      [req.params.id, req.user.branch_id]
    );

    if (existing.length === 0) {
      return res.status(404).json({ error: 'Turno no encontrado' });
    }

    const time = new Date().toTimeString().split(' ')[0];

    await db.query(
      "UPDATE shifts SET end_time = ?, final_cash = ?, status = 'closed' WHERE id = ? AND branch_id = ?",
      [time, final_cash, req.params.id, req.user.branch_id]
    );

    res.json({ message: 'Turno cerrado exitosamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Resumen del turno
router.get('/:id/summary', auth, async (req, res) => {
  try {
    const [shift] = await db.query(
      'SELECT * FROM shifts WHERE id = ? AND branch_id = ?',
      [req.params.id, req.user.branch_id]
    );
    
    if (shift.length === 0) {
      return res.status(404).json({ error: 'Turno no encontrado' });
    }

    const { branch_id, date } = shift[0];

    const [salesByMethod] = await db.query(`
      SELECT p.method, SUM(p.amount) as total 
      FROM payments p 
      JOIN sales s ON p.reference_id = s.id AND p.reference_type = 'sale'
      WHERE s.branch_id = ? AND s.date = ?
      GROUP BY p.method
    `, [branch_id, date]);

    const [appointmentsByMethod] = await db.query(`
      SELECT p.method, SUM(p.amount) as total 
      FROM payments p 
      JOIN appointments a ON p.reference_id = a.id AND p.reference_type = 'appointment'
      WHERE a.branch_id = ? AND a.date = ? AND a.status = 'completed'
      GROUP BY p.method
    `, [branch_id, date]);

    const [expensesByMethod] = await db.query(`
      SELECT payment_method as method, SUM(amount) as total 
      FROM expenses 
      WHERE branch_id = ? AND date = ?
      GROUP BY payment_method
    `, [branch_id, date]);

    const [purchasesByMethod] = await db.query(`
      SELECT p.method, SUM(p.amount) as total 
      FROM payments p 
      JOIN purchases pu ON p.reference_id = pu.id AND p.reference_type = 'purchase'
      WHERE pu.branch_id = ? AND pu.date = ?
      GROUP BY p.method
    `, [branch_id, date]);

    const [totals] = await db.query(`
      SELECT 
        (SELECT COALESCE(SUM(total), 0) FROM sales WHERE branch_id = ? AND date = ?) +
        (SELECT COALESCE(SUM(total), 0) FROM appointments WHERE branch_id = ? AND date = ? AND status = 'completed') as total_sales,
        (SELECT COALESCE(SUM(amount), 0) FROM expenses WHERE branch_id = ? AND date = ?) as total_expenses,
        (SELECT COALESCE(SUM(total), 0) FROM purchases WHERE branch_id = ? AND date = ?) as total_purchases,
        (SELECT COUNT(*) FROM appointments WHERE branch_id = ? AND date = ? AND status = 'completed') as completed_appointments
    `, [branch_id, date, branch_id, date, branch_id, date, branch_id, date, branch_id, date]);

    const combinedSales = {};
    [...salesByMethod, ...appointmentsByMethod].forEach(item => {
      combinedSales[item.method] = (combinedSales[item.method] || 0) + parseFloat(item.total);
    });

    const expensesObj = {};
    expensesByMethod.forEach(item => {
      expensesObj[item.method] = parseFloat(item.total);
    });

    const purchasesObj = {};
    purchasesByMethod.forEach(item => {
      purchasesObj[item.method] = parseFloat(item.total);
    });

    const expectedByMethod = {};
    ['cash', 'card', 'transfer'].forEach(method => {
      const sales = combinedSales[method] || 0;
      const expenses = expensesObj[method] || 0;
      const purchases = purchasesObj[method] || 0;
      expectedByMethod[method] = sales - expenses - purchases;
    });

    expectedByMethod.cash = (expectedByMethod.cash || 0) + parseFloat(shift[0].initial_cash || 0);

    res.json({
      shift: shift[0],
      totals: totals[0],
      salesByMethod: combinedSales,
      expensesByMethod: expensesObj,
      purchasesByMethod: purchasesObj,
      expectedByMethod
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
