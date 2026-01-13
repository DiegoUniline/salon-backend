const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const auth = require('../middleware/auth');

// Listar compras
router.get('/', async (req, res) => {
  try {
    const { branch_id, date, start_date, end_date } = req.query;
    let query = 'SELECT * FROM purchases WHERE 1=1';
    const params = [];

    if (branch_id) {
      query += ' AND branch_id = ?';
      params.push(branch_id);
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

    // Obtener líneas y pagos de cada compra
    for (const purchase of rows) {
      const [lines] = await db.query(
        `SELECT pl.*, p.name as product_name 
         FROM purchase_lines pl 
         LEFT JOIN products p ON pl.product_id = p.id 
         WHERE pl.purchase_id = ?`,
        [purchase.id]
      );
      const [payments] = await db.query(
        "SELECT * FROM payments WHERE reference_type = 'purchase' AND reference_id = ?",
        [purchase.id]
      );
      purchase.lines = lines;
      purchase.payments = payments;
    }

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener una compra
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM purchases WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Compra no encontrada' });
    }

    const purchase = rows[0];
    const [lines] = await db.query(
      `SELECT pl.*, p.name as product_name 
       FROM purchase_lines pl 
       LEFT JOIN products p ON pl.product_id = p.id 
       WHERE pl.purchase_id = ?`,
      [purchase.id]
    );
    const [payments] = await db.query(
      "SELECT * FROM payments WHERE reference_type = 'purchase' AND reference_id = ?",
      [purchase.id]
    );
    
    purchase.lines = lines;
    purchase.payments = payments;

    res.json(purchase);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear compra
router.post('/', auth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { branch_id, date, supplier, lines, payments, total, notes } = req.body;
    const id = uuidv4();

    await connection.query(
      'INSERT INTO purchases (id, branch_id, date, supplier, total, notes) VALUES (?, ?, ?, ?, ?, ?)',
      [id, branch_id, date, supplier, total, notes]
    );

    // Insertar líneas y actualizar inventario
    for (const line of lines) {
      await connection.query(
        'INSERT INTO purchase_lines (id, purchase_id, product_id, quantity, unit_cost, subtotal) VALUES (UUID(), ?, ?, ?, ?, ?)',
        [id, line.product_id, line.quantity, line.unit_cost, line.subtotal]
      );

      // Actualizar stock
      await connection.query(
        'UPDATE products SET stock = stock + ?, cost = ? WHERE id = ?',
        [line.quantity, line.unit_cost, line.product_id]
      );

      // Registrar movimiento
      await connection.query(
        `INSERT INTO inventory_movements (id, branch_id, product_id, type, quantity, reason) 
         VALUES (UUID(), ?, ?, 'in', ?, 'Compra de inventario')`,
        [branch_id, line.product_id, line.quantity]
      );
    }

    // Insertar pagos
    for (const payment of payments) {
      await connection.query(
        'INSERT INTO payments (id, reference_type, reference_id, method, amount) VALUES (UUID(), ?, ?, ?, ?)',
        ['purchase', id, payment.method, payment.amount]
      );
    }

    await connection.commit();
    res.status(201).json({ id, message: 'Compra creada exitosamente' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Eliminar compra
router.delete('/:id', auth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Revertir inventario
    const [lines] = await connection.query('SELECT * FROM purchase_lines WHERE purchase_id = ?', [req.params.id]);
    const [purchase] = await connection.query('SELECT branch_id FROM purchases WHERE id = ?', [req.params.id]);

    for (const line of lines) {
      await connection.query(
        'UPDATE products SET stock = stock - ? WHERE id = ?',
        [line.quantity, line.product_id]
      );

      await connection.query(
        `INSERT INTO inventory_movements (id, branch_id, product_id, type, quantity, reason) 
         VALUES (UUID(), ?, ?, 'out', ?, 'Cancelación de compra')`,
        [purchase[0]?.branch_id, line.product_id, -line.quantity]
      );
    }

    await connection.query('DELETE FROM purchases WHERE id = ?', [req.params.id]);

    await connection.commit();
    res.json({ message: 'Compra eliminada' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

module.exports = router;
