const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const auth = require('../middleware/auth');

// Listar movimientos
router.get('/movements', async (req, res) => {
  try {
    const { branch_id, product_id, type, start_date, end_date } = req.query;
    let query = `
      SELECT im.*, p.name as product_name, u.name as user_name 
      FROM inventory_movements im 
      LEFT JOIN products p ON im.product_id = p.id 
      LEFT JOIN users u ON im.user_id = u.id 
      WHERE 1=1
    `;
    const params = [];

    if (branch_id) {
      query += ' AND im.branch_id = ?';
      params.push(branch_id);
    }
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

// Stock actual
router.get('/stock', async (req, res) => {
  try {
    const { branch_id, low_stock } = req.query;
    let query = 'SELECT id, name, category, sku, stock, min_stock, price, cost FROM products WHERE active = 1';
    const params = [];

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

// Valor total del inventario
router.get('/value', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT 
        SUM(stock * cost) as total_cost,
        SUM(stock * price) as total_price,
        COUNT(*) as total_products,
        SUM(stock) as total_units
      FROM products WHERE active = 1
    `);
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

    const { branch_id, product_id, quantity, reason, user_id } = req.body;

    await connection.query(
      'UPDATE products SET stock = stock + ? WHERE id = ?',
      [quantity, product_id]
    );

    await connection.query(
      `INSERT INTO inventory_movements (id, branch_id, product_id, type, quantity, reason, user_id) 
       VALUES (UUID(), ?, ?, 'in', ?, ?, ?)`,
      [branch_id, product_id, quantity, reason || 'Entrada manual', user_id]
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

    const { branch_id, product_id, quantity, reason, user_id } = req.body;

    await connection.query(
      'UPDATE products SET stock = stock - ? WHERE id = ?',
      [quantity, product_id]
    );

    await connection.query(
      `INSERT INTO inventory_movements (id, branch_id, product_id, type, quantity, reason, user_id) 
       VALUES (UUID(), ?, ?, 'out', ?, ?, ?)`,
      [branch_id, product_id, -quantity, reason || 'Salida manual', user_id]
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

    const { branch_id, product_id, new_stock, reason, user_id } = req.body;

    // Obtener stock actual
    const [product] = await connection.query('SELECT stock FROM products WHERE id = ?', [product_id]);
    const currentStock = product[0]?.stock || 0;
    const difference = new_stock - currentStock;

    await connection.query(
      'UPDATE products SET stock = ? WHERE id = ?',
      [new_stock, product_id]
    );

    await connection.query(
      `INSERT INTO inventory_movements (id, branch_id, product_id, type, quantity, reason, user_id) 
       VALUES (UUID(), ?, ?, 'adjustment', ?, ?, ?)`,
      [branch_id, product_id, difference, reason || 'Ajuste de inventario', user_id]
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
