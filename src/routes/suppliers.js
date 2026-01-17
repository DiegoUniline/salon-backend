const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const auth = require('../middleware/auth');

// Listar proveedores
router.get('/', auth, async (req, res) => {
  try {
    const { active, search } = req.query;
    let query = 'SELECT * FROM suppliers WHERE 1=1';
    const params = [];

    if (active !== undefined) {
      query += ' AND active = ?';
      params.push(active === 'true' ? 1 : 0);
    }

    if (search) {
      query += ' AND (name LIKE ? OR contact_name LIKE ? OR phone LIKE ? OR email LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm, searchTerm);
    }

    query += ' ORDER BY name ASC';
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Error listing suppliers:', error);
    res.status(500).json({ error: error.message });
  }
});

// Obtener proveedor por ID
router.get('/:id', auth, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM suppliers WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }

    const supplier = rows[0];

    // Obtener compras del proveedor
    const [purchases] = await db.query(
      `SELECT id, date, total, status, balance, payment_type 
       FROM purchases 
       WHERE supplier_id = ? 
       ORDER BY date DESC 
       LIMIT 10`,
      [req.params.id]
    );
    supplier.recent_purchases = purchases;

    res.json(supplier);
  } catch (error) {
    console.error('Error getting supplier:', error);
    res.status(500).json({ error: error.message });
  }
});

// Crear proveedor
router.post('/', auth, async (req, res) => {
  try {
    const {
      name,
      contact_name,
      phone,
      email,
      address,
      rfc,
      credit_days,
      credit_limit,
      notes
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'El nombre es requerido' });
    }

    const id = uuidv4();
    await db.query(
      `INSERT INTO suppliers (id, name, contact_name, phone, email, address, rfc, credit_days, credit_limit, notes) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, contact_name || null, phone || null, email || null, address || null, rfc || null, credit_days || 0, credit_limit || 0, notes || null]
    );

    res.status(201).json({ id, message: 'Proveedor creado' });
  } catch (error) {
    console.error('Error creating supplier:', error);
    res.status(500).json({ error: error.message });
  }
});

// Actualizar proveedor
router.put('/:id', auth, async (req, res) => {
  try {
    const {
      name,
      contact_name,
      phone,
      email,
      address,
      rfc,
      credit_days,
      credit_limit,
      notes,
      active
    } = req.body;

    const [existing] = await db.query('SELECT id FROM suppliers WHERE id = ?', [req.params.id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }

    await db.query(
      `UPDATE suppliers SET 
        name = COALESCE(?, name),
        contact_name = ?,
        phone = ?,
        email = ?,
        address = ?,
        rfc = ?,
        credit_days = COALESCE(?, credit_days),
        credit_limit = COALESCE(?, credit_limit),
        notes = ?,
        active = COALESCE(?, active)
       WHERE id = ?`,
      [name, contact_name, phone, email, address, rfc, credit_days, credit_limit, notes, active, req.params.id]
    );

    res.json({ message: 'Proveedor actualizado' });
  } catch (error) {
    console.error('Error updating supplier:', error);
    res.status(500).json({ error: error.message });
  }
});

// Eliminar proveedor (soft delete)
router.delete('/:id', auth, async (req, res) => {
  try {
    const [existing] = await db.query('SELECT id FROM suppliers WHERE id = ?', [req.params.id]);
    if (existing.length === 0) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }

    // Verificar si tiene compras pendientes
    const [pending] = await db.query(
      "SELECT COUNT(*) as count FROM purchases WHERE supplier_id = ? AND status IN ('pending', 'partial')",
      [req.params.id]
    );

    if (pending[0].count > 0) {
      return res.status(400).json({ error: 'No se puede eliminar, tiene compras pendientes de pago' });
    }

    // Soft delete
    await db.query('UPDATE suppliers SET active = 0 WHERE id = ?', [req.params.id]);
    res.json({ message: 'Proveedor desactivado' });
  } catch (error) {
    console.error('Error deleting supplier:', error);
    res.status(500).json({ error: error.message });
  }
});

// Obtener balance/estado de cuenta del proveedor
router.get('/:id/statement', auth, async (req, res) => {
  try {
    const { start_date, end_date } = req.query;
    
    const [supplier] = await db.query('SELECT * FROM suppliers WHERE id = ?', [req.params.id]);
    if (supplier.length === 0) {
      return res.status(404).json({ error: 'Proveedor no encontrado' });
    }

    let purchasesQuery = `
      SELECT p.id, p.date, p.total, p.paid_amount, p.balance, p.status, p.payment_type, p.due_date
      FROM purchases p
      WHERE p.supplier_id = ?
    `;
    const params = [req.params.id];

    if (start_date && end_date) {
      purchasesQuery += ' AND p.date BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }

    purchasesQuery += ' ORDER BY p.date DESC';

    const [purchases] = await db.query(purchasesQuery, params);

    // Obtener pagos
    const [payments] = await db.query(
      `SELECT pp.*, p.date as purchase_date
       FROM purchase_payments pp
       INNER JOIN purchases p ON pp.purchase_id = p.id
       WHERE p.supplier_id = ?
       ORDER BY pp.created_at DESC`,
      [req.params.id]
    );

    // Totales
    const [totals] = await db.query(
      `SELECT 
        SUM(total) as total_purchases,
        SUM(paid_amount) as total_paid,
        SUM(balance) as total_balance,
        COUNT(*) as purchase_count,
        SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) as pending_count,
        SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END) as partial_count
       FROM purchases 
       WHERE supplier_id = ? AND status != 'cancelled'`,
      [req.params.id]
    );

    res.json({
      supplier: supplier[0],
      purchases,
      payments,
      summary: totals[0]
    });
  } catch (error) {
    console.error('Error getting supplier statement:', error);
    res.status(500).json({ error: error.message });
  }
});

// Compras pendientes de un proveedor
router.get('/:id/pending', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.*, 
        DATEDIFF(CURDATE(), p.due_date) as days_overdue
       FROM purchases p
       WHERE p.supplier_id = ? AND p.status IN ('pending', 'partial')
       ORDER BY p.due_date ASC`,
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    console.error('Error getting pending purchases:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
