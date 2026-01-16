const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const auth = require('../middleware/auth');

// Listar productos (por cuenta)
router.get('/', auth, async (req, res) => {
  try {
    const { category, active, low_stock } = req.query;
    let query = 'SELECT * FROM products WHERE account_id = ?';
    const params = [req.user.account_id];

    if (category) {
      query += ' AND category = ?';
      params.push(category);
    }
    if (active !== undefined) {
      query += ' AND active = ?';
      params.push(active === 'true' ? 1 : 0);
    }
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

// Obtener categorías (por cuenta)
router.get('/categories', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT DISTINCT category FROM products WHERE account_id = ? AND category IS NOT NULL ORDER BY category',
      [req.user.account_id]
    );
    res.json(rows.map(r => r.category));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener un producto (validar cuenta)
router.get('/:id', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM products WHERE id = ? AND account_id = ?',
      [req.params.id, req.user.account_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Producto no encontrado' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear producto
router.post('/', auth, async (req, res) => {
  try {
    const { name, category, sku, price, cost, stock, min_stock } = req.body;
    const id = uuidv4();

    await db.query(
      'INSERT INTO products (id, name, category, sku, price, cost, stock, min_stock, account_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [id, name, category, sku, price, cost || 0, stock || 0, min_stock || 5, req.user.account_id]
    );

    res.status(201).json({ id, name, category, sku, price, cost: cost || 0, stock: stock || 0, min_stock: min_stock || 5, active: true });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'El SKU ya existe' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Actualizar producto
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, category, sku, price, cost, stock, min_stock, active } = req.body;

    await db.query(
      `UPDATE products SET name = ?, category = ?, sku = ?, price = ?, cost = ?, 
       stock = ?, min_stock = ?, active = ? WHERE id = ? AND account_id = ?`,
      [name, category, sku, price, cost, stock, min_stock, active ? 1 : 0, req.params.id, req.user.account_id]
    );

    res.json({ id: req.params.id, name, category, sku, price, cost, stock, min_stock, active });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Actualizar solo stock
router.patch('/:id/stock', auth, async (req, res) => {
  try {
    const { stock } = req.body;
    await db.query(
      'UPDATE products SET stock = ? WHERE id = ? AND account_id = ?',
      [stock, req.params.id, req.user.account_id]
    );
    res.json({ id: req.params.id, stock });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar producto
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query(
      'DELETE FROM products WHERE id = ? AND account_id = ?',
      [req.params.id, req.user.account_id]
    );
    res.json({ message: 'Producto eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
