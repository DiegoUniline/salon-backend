const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const auth = require('../middleware/auth');

// Listar compras (por sucursal)
router.get('/', auth, async (req, res) => {
  try {
    const { branch_id, date, start_date, end_date, status, supplier_id } = req.query;
    const branchId = branch_id || req.user.branch_id;
    
    let query = `
      SELECT p.*, s.name as supplier_name, s.phone as supplier_phone
      FROM purchases p
      LEFT JOIN suppliers s ON p.supplier_id = s.id
      WHERE p.branch_id = ?
    `;
    const params = [branchId];

    if (date) {
      query += ' AND p.date = ?';
      params.push(date);
    }
    if (start_date && end_date) {
      query += ' AND p.date BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }
    if (status) {
      query += ' AND p.status = ?';
      params.push(status);
    }
    if (supplier_id) {
      query += ' AND p.supplier_id = ?';
      params.push(supplier_id);
    }

    query += ' ORDER BY p.date DESC, p.created_at DESC';
    const [rows] = await db.query(query, params);

    for (const purchase of rows) {
      const [lines] = await db.query(
        `SELECT pl.*, COALESCE(pl.product_name, pr.name) as product_name 
         FROM purchase_lines pl 
         LEFT JOIN products pr ON pl.product_id = pr.id 
         WHERE pl.purchase_id = ?`,
        [purchase.id]
      );
      const [payments] = await db.query(
        'SELECT * FROM purchase_payments WHERE purchase_id = ? ORDER BY created_at',
        [purchase.id]
      );
      purchase.items = lines;
      purchase.payments = payments;
    }

    res.json(rows);
  } catch (error) {
    console.error('Error listing purchases:', error);
    res.status(500).json({ error: error.message });
  }
});

// Obtener una compra
router.get('/:id', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT p.*, s.name as supplier_name, s.phone as supplier_phone, s.email as supplier_email
       FROM purchases p
       LEFT JOIN suppliers s ON p.supplier_id = s.id
       WHERE p.id = ? AND p.branch_id = ?`,
      [req.params.id, req.user.branch_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Compra no encontrada' });
    }

    const purchase = rows[0];
    const [lines] = await db.query(
      `SELECT pl.*, COALESCE(pl.product_name, pr.name) as product_name 
       FROM purchase_lines pl 
       LEFT JOIN products pr ON pl.product_id = pr.id 
       WHERE pl.purchase_id = ?`,
      [purchase.id]
    );
    const [payments] = await db.query(
      'SELECT * FROM purchase_payments WHERE purchase_id = ? ORDER BY created_at',
      [purchase.id]
    );
    
    purchase.items = lines;
    purchase.payments = payments;

    res.json(purchase);
  } catch (error) {
    console.error('Error getting purchase:', error);
    res.status(500).json({ error: error.message });
  }
});

// Crear compra
router.post('/', auth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { 
      date, 
      supplier,
      supplier_id,
      items,
      payments,
      payment_method,
      total, 
      notes,
      shift_id,
      payment_type = 'cash',
      due_date
    } = req.body;
    
    const id = uuidv4();
    const branch_id = req.body.branch_id || req.user.branch_id;
    
    // Calcular montos
    const totalAmount = parseFloat(total) || 0;
    const paymentsArray = Array.isArray(payments) ? payments : 
                          payment_method ? [{ method: payment_method, amount: totalAmount }] : [];
    const paidAmount = paymentsArray.reduce((sum, p) => sum + (parseFloat(p.amount) || 0), 0);
    const balance = totalAmount - paidAmount;
    
    // Determinar status
    let status = 'pending';
    if (payment_type === 'cash' || paidAmount >= totalAmount) {
      status = 'paid';
    } else if (paidAmount > 0) {
      status = 'partial';
    }

    // Insertar compra
    await connection.query(
      `INSERT INTO purchases 
       (id, branch_id, shift_id, supplier_id, date, supplier, total, payment_type, status, due_date, paid_amount, balance, notes) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, branch_id, shift_id || null, supplier_id || null, date, supplier, totalAmount, payment_type, status, due_date || null, paidAmount, balance, notes || null]
    );

    // Insertar líneas
    const lines = items || [];
    for (const line of lines) {
      if (!line.product_id) continue;
      
      const subtotal = (parseFloat(line.quantity) || 0) * (parseFloat(line.unit_cost) || 0);
      
      await connection.query(
        'INSERT INTO purchase_lines (id, purchase_id, product_id, product_name, quantity, unit_cost, subtotal) VALUES (UUID(), ?, ?, ?, ?, ?, ?)',
        [id, line.product_id, line.product_name || null, line.quantity, line.unit_cost, subtotal]
      );

      // Actualizar stock y costo del producto
      await connection.query(
        'UPDATE products SET stock = stock + ?, cost = ? WHERE id = ?',
        [line.quantity, line.unit_cost, line.product_id]
      );

      // Registrar movimiento de inventario
      await connection.query(
        `INSERT INTO inventory_movements (id, branch_id, product_id, type, quantity, reason, user_id) 
         VALUES (UUID(), ?, ?, 'in', ?, 'Compra de inventario', ?)`,
        [branch_id, line.product_id, line.quantity, req.user.user_id]
      );
    }

    // Insertar pagos
    for (const payment of paymentsArray) {
      if (!payment.amount || parseFloat(payment.amount) <= 0) continue;
      
      await connection.query(
        'INSERT INTO purchase_payments (id, purchase_id, shift_id, amount, payment_method, reference, created_by) VALUES (UUID(), ?, ?, ?, ?, ?, ?)',
        [id, shift_id || null, payment.amount, payment.method || 'cash', payment.reference || null, req.user.user_id]
      );
    }

    // Actualizar balance del proveedor si es crédito
    if (payment_type === 'credit' && supplier_id) {
      await connection.query(
        'UPDATE suppliers SET balance = balance + ? WHERE id = ?',
        [balance, supplier_id]
      );
    }

    await connection.commit();
    res.status(201).json({ id, message: 'Compra creada exitosamente' });
  } catch (error) {
    await connection.rollback();
    console.error('Error creating purchase:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Agregar pago a compra existente
router.post('/:id/payments', auth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { amount, payment_method, reference, shift_id } = req.body;
    const purchaseId = req.params.id;

    // Verificar compra
    const [purchase] = await connection.query(
      'SELECT * FROM purchases WHERE id = ? AND branch_id = ?',
      [purchaseId, req.user.branch_id]
    );

    if (purchase.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Compra no encontrada' });
    }

    const purch = purchase[0];
    if (purch.status === 'paid' || purch.status === 'cancelled') {
      await connection.rollback();
      return res.status(400).json({ error: 'No se puede agregar pago a esta compra' });
    }

    const paymentAmount = parseFloat(amount) || 0;
    const newPaidAmount = parseFloat(purch.paid_amount) + paymentAmount;
    const newBalance = parseFloat(purch.total) - newPaidAmount;
    const newStatus = newBalance <= 0 ? 'paid' : 'partial';

    // Insertar pago
    const paymentId = uuidv4();
    await connection.query(
      'INSERT INTO purchase_payments (id, purchase_id, shift_id, amount, payment_method, reference, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [paymentId, purchaseId, shift_id || null, paymentAmount, payment_method || 'cash', reference || null, req.user.user_id]
    );

    // Actualizar compra
    await connection.query(
      'UPDATE purchases SET paid_amount = ?, balance = ?, status = ? WHERE id = ?',
      [newPaidAmount, Math.max(0, newBalance), newStatus, purchaseId]
    );

    // Actualizar balance del proveedor
    if (purch.supplier_id) {
      await connection.query(
        'UPDATE suppliers SET balance = balance - ? WHERE id = ?',
        [paymentAmount, purch.supplier_id]
      );
    }

    await connection.commit();
    res.status(201).json({ id: paymentId, message: 'Pago registrado' });
  } catch (error) {
    await connection.rollback();
    console.error('Error adding payment:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Cancelar compra
router.patch('/:id/cancel', auth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [purchase] = await connection.query(
      'SELECT * FROM purchases WHERE id = ? AND branch_id = ?',
      [req.params.id, req.user.branch_id]
    );

    if (purchase.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Compra no encontrada' });
    }

    const purch = purchase[0];
    if (purch.status === 'cancelled') {
      await connection.rollback();
      return res.status(400).json({ error: 'La compra ya está cancelada' });
    }

    // Revertir stock
    const [lines] = await connection.query('SELECT * FROM purchase_lines WHERE purchase_id = ?', [req.params.id]);
    for (const line of lines) {
      await connection.query(
        'UPDATE products SET stock = stock - ? WHERE id = ?',
        [line.quantity, line.product_id]
      );

      await connection.query(
        `INSERT INTO inventory_movements (id, branch_id, product_id, type, quantity, reason, user_id) 
         VALUES (UUID(), ?, ?, 'out', ?, 'Cancelación de compra', ?)`,
        [req.user.branch_id, line.product_id, line.quantity, req.user.user_id]
      );
    }

    // Revertir balance del proveedor
    if (purch.supplier_id && purch.payment_type === 'credit') {
      await connection.query(
        'UPDATE suppliers SET balance = balance - ? WHERE id = ?',
        [purch.balance, purch.supplier_id]
      );
    }

    // Marcar como cancelada
    await connection.query(
      'UPDATE purchases SET status = ?, notes = CONCAT(COALESCE(notes, ""), ?) WHERE id = ?',
      ['cancelled', ' [CANCELADA]', req.params.id]
    );

    await connection.commit();
    res.json({ message: 'Compra cancelada' });
  } catch (error) {
    await connection.rollback();
    console.error('Error cancelling purchase:', error);
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

    const [purchase] = await connection.query(
      'SELECT * FROM purchases WHERE id = ? AND branch_id = ?',
      [req.params.id, req.user.branch_id]
    );

    if (purchase.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: 'Compra no encontrada' });
    }

    const purch = purchase[0];

    // Revertir stock
    const [lines] = await connection.query('SELECT * FROM purchase_lines WHERE purchase_id = ?', [req.params.id]);
    for (const line of lines) {
      await connection.query(
        'UPDATE products SET stock = stock - ? WHERE id = ?',
        [line.quantity, line.product_id]
      );

      await connection.query(
        `INSERT INTO inventory_movements (id, branch_id, product_id, type, quantity, reason, user_id) 
         VALUES (UUID(), ?, ?, 'out', ?, 'Eliminación de compra', ?)`,
        [req.user.branch_id, line.product_id, line.quantity, req.user.user_id]
      );
    }

    // Revertir balance del proveedor si aplica
    if (purch.supplier_id && purch.payment_type === 'credit') {
      await connection.query(
        'UPDATE suppliers SET balance = balance - ? WHERE id = ?',
        [purch.balance, purch.supplier_id]
      );
    }

    // Eliminar (cascade borra líneas y pagos)
    await connection.query('DELETE FROM purchases WHERE id = ?', [req.params.id]);

    await connection.commit();
    res.json({ message: 'Compra eliminada' });
  } catch (error) {
    await connection.rollback();
    console.error('Error deleting purchase:', error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

module.exports = router;
