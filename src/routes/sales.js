const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const auth = require('../middleware/auth');

// Listar ventas
router.get('/', async (req, res) => {
  try {
    const { branch_id, date, start_date, end_date } = req.query;
    let query = `
      SELECT s.*, u.name as stylist_name 
      FROM sales s 
      LEFT JOIN users u ON s.stylist_id = u.id 
      WHERE 1=1
    `;
    const params = [];

    if (branch_id) {
      query += ' AND s.branch_id = ?';
      params.push(branch_id);
    }
    if (date) {
      query += ' AND s.date = ?';
      params.push(date);
    }
    if (start_date && end_date) {
      query += ' AND s.date BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    query += ' ORDER BY s.date DESC, s.time DESC';
    const [rows] = await db.query(query, params);

    // Obtener items y pagos de cada venta
    for (const sale of rows) {
      const [items] = await db.query('SELECT * FROM sale_items WHERE sale_id = ?', [sale.id]);
      const [payments] = await db.query(
        "SELECT * FROM payments WHERE reference_type = 'sale' AND reference_id = ?",
        [sale.id]
      );
      sale.items = items;
      sale.payments = payments;
    }

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener una venta
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT s.*, u.name as stylist_name 
       FROM sales s 
       LEFT JOIN users u ON s.stylist_id = u.id 
       WHERE s.id = ?`,
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Venta no encontrada' });
    }

    const sale = rows[0];
    const [items] = await db.query('SELECT * FROM sale_items WHERE sale_id = ?', [sale.id]);
    const [payments] = await db.query(
      "SELECT * FROM payments WHERE reference_type = 'sale' AND reference_id = ?",
      [sale.id]
    );
    
    sale.items = items;
    sale.payments = payments;

    res.json(sale);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear venta
router.post('/', auth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { 
      branch_id, stylist_id, client_name, client_phone,
      date, time, items, payments, subtotal, discount, total, notes
    } = req.body;

    const id = uuidv4();

    await connection.query(
      `INSERT INTO sales (id, branch_id, stylist_id, client_name, client_phone, 
       date, time, subtotal, discount, total, notes) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, branch_id, stylist_id, client_name, client_phone, date, time, subtotal, discount, total, notes]
    );

    // Insertar items
    for (const item of items) {
      await connection.query(
        `INSERT INTO sale_items (id, sale_id, item_type, item_id, name, quantity, price, discount, subtotal) 
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, item.item_type, item.item_id, item.name, item.quantity, item.price, item.discount || 0, item.subtotal]
      );

      // Descontar inventario si es producto
      if (item.item_type === 'product') {
        await connection.query(
          'UPDATE products SET stock = stock - ? WHERE id = ?',
          [item.quantity, item.item_id]
        );
        
        // Registrar movimiento
        await connection.query(
          `INSERT INTO inventory_movements (id, branch_id, product_id, type, quantity, reason) 
           VALUES (UUID(), ?, ?, 'out', ?, 'Venta directa')`,
          [branch_id, item.item_id, -item.quantity]
        );
      }
    }

    // Insertar pagos
    for (const payment of payments) {
      await connection.query(
        'INSERT INTO payments (id, reference_type, reference_id, method, amount) VALUES (UUID(), ?, ?, ?, ?)',
        ['sale', id, payment.method, payment.amount]
      );
    }

    await connection.commit();
    res.status(201).json({ id, message: 'Venta creada exitosamente' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Eliminar venta
router.delete('/:id', auth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Restaurar inventario
    const [items] = await connection.query(
      "SELECT * FROM sale_items WHERE sale_id = ? AND item_type = 'product'",
      [req.params.id]
    );

    const [sale] = await connection.query('SELECT branch_id FROM sales WHERE id = ?', [req.params.id]);

    for (const item of items) {
      await connection.query(
        'UPDATE products SET stock = stock + ? WHERE id = ?',
        [item.quantity, item.item_id]
      );
      
      await connection.query(
        `INSERT INTO inventory_movements (id, branch_id, product_id, type, quantity, reason) 
         VALUES (UUID(), ?, ?, 'in', ?, 'Cancelación de venta')`,
        [sale[0]?.branch_id, item.item_id, item.quantity]
      );
    }

    await connection.query('DELETE FROM sales WHERE id = ?', [req.params.id]);

    await connection.commit();
    res.json({ message: 'Venta eliminada' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

module.exports = router;
