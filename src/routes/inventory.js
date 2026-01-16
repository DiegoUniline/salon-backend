const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const auth = require('../middleware/auth');

// Listar movimientos (por sucursal)
router.get('/movements', auth, async (req, res) => {
  try {
    const { product_id, type, start_date, end_date } = req.query;
    let query = `
      SELECT im.*, p.name as product_name, u.name as user_name 
      FROM inventory_movements im 
      LEFT JOIN products p ON im.product_id = p.id 
      LEFT JOIN users u ON im.user_id = u.id 
      WHERE im.branch_id = ?
    `;
    const params = [req.user.branch_id];

    if (product_id) {
      query += ' AND im.product_id = ?';
      params.push(product_id);
    }
    if (type) {
      query += ' AND im.type = ?';
      params.push(type);
    }
    if (start_date && end_date) {
      query += ' AND DATE(im.created_at) BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    query += ' ORDER BY im.created_at DESC';
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Stock actual (productos por cuenta)
router.get('/stock', auth, async (req, res) => {
  try {
    const { low_stock } = req.query;
    let query = 'SELECT id, name, category, sku, stock, min_stock, price, cost FROM products WHERE active = 1 AND account_id = ?';
    const params = [req.user.account_id];

    if (low_stock === 'true') {
      query += ' AND stock <= min_stock';
    }

    query += ' ORDER BY category, name';
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Valor total del inventario (por cuenta)
router.get('/value', auth, async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        SUM(stock * cost) as total_cost,
        SUM(stock * price) as total_price,
        COUNT(*) as total_products,
        SUM(stock) as total_units
      FROM products WHERE active = 1 AND account_id = ?
    `, [req.user.account_id]);
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Entrada de inventario
router.post('/in', auth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { product_id, quantity, reason } = req.body;

    // Validar que el producto pertenece a la cuenta
    const [product] = await connection.query(
      'SELECT id FROM products WHERE id = ? AND account_id = ?',
      [product_id, req.user.account_id]
    );

    if (product.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    await connection.query(
      'UPDATE products SET stock = stock + ? WHERE id = ?',
      [quantity, product_id]
    );

    await connection.query(
      `INSERT INTO inventory_movements (id, branch_id, product_id, type, quantity, reason, user_id) 
       VALUES (UUID(), ?, ?, 'in', ?, ?, ?)`,
      [req.user.branch_id, product_id, quantity, reason || 'Entrada manual', req.user.user_id]
    );

    await connection.commit();
    res.status(201).json({ message: 'Entrada registrada' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Salida de inventario
router.post('/out', auth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { product_id, quantity, reason } = req.body;

    // Validar que el producto pertenece a la cuenta
    const [product] = await connection.query(
      'SELECT id FROM products WHERE id = ? AND account_id = ?',
      [product_id, req.user.account_id]
    );

    if (product.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    await connection.query(
      'UPDATE products SET stock = stock - ? WHERE id = ?',
      [quantity, product_id]
    );

    await connection.query(
      `INSERT INTO inventory_movements (id, branch_id, product_id, type, quantity, reason, user_id) 
       VALUES (UUID(), ?, ?, 'out', ?, ?, ?)`,
      [req.user.branch_id, product_id, -quantity, reason || 'Salida manual', req.user.user_id]
    );

    await connection.commit();
    res.status(201).json({ message: 'Salida registrada' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Ajuste de inventario
router.post('/adjustment', auth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { product_id, new_stock, reason } = req.body;

    // Validar que el producto pertenece a la cuenta
    const [product] = await connection.query(
      'SELECT id, stock FROM products WHERE id = ? AND account_id = ?',
      [product_id, req.user.account_id]
    );

    if (product.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Producto no encontrado' });
    }

    const currentStock = product[0].stock || 0;
    const difference = new_stock - currentStock;

    await connection.query(
      'UPDATE products SET stock = ? WHERE id = ?',
      [new_stock, product_id]
    );

    await connection.query(
      `INSERT INTO inventory_movements (id, branch_id, product_id, type, quantity, reason, user_id) 
       VALUES (UUID(), ?, ?, 'adjustment', ?, ?, ?)`,
      [req.user.branch_id, product_id, difference, reason || 'Ajuste de inventario', req.user.user_id]
    );

    await connection.commit();
    res.status(201).json({ message: 'Ajuste registrado', difference });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

module.exports = router;
