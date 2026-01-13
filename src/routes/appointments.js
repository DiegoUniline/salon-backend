const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const auth = require('../middleware/auth');

// Listar citas
router.get('/', async (req, res) => {
  try {
    const { branch_id, stylist_id, date, start_date, end_date, status } = req.query;
    let query = `
      SELECT a.*, u.name as stylist_name, u.color as stylist_color 
      FROM appointments a 
      LEFT JOIN users u ON a.stylist_id = u.id 
      WHERE 1=1
    `;
    const params = [];

    if (branch_id) {
      query += ' AND a.branch_id = ?';
      params.push(branch_id);
    }
    if (stylist_id) {
      query += ' AND a.stylist_id = ?';
      params.push(stylist_id);
    }
    if (date) {
      query += ' AND a.date = ?';
      params.push(date);
    }
    if (start_date && end_date) {
      query += ' AND a.date BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }
    if (status) {
      query += ' AND a.status = ?';
      params.push(status);
    }

    query += ' ORDER BY a.date, a.time';
    const [rows] = await db.query(query, params);

    // Obtener servicios y productos de cada cita
    for (const appointment of rows) {
      const [services] = await db.query(
        `SELECT aps.*, s.name, s.duration 
         FROM appointment_services aps 
         LEFT JOIN services s ON aps.service_id = s.id 
         WHERE aps.appointment_id = ?`,
        [appointment.id]
      );
      const [products] = await db.query(
        `SELECT app.*, p.name 
         FROM appointment_products app 
         LEFT JOIN products p ON app.product_id = p.id 
         WHERE app.appointment_id = ?`,
        [appointment.id]
      );
      const [payments] = await db.query(
        `SELECT * FROM payments WHERE reference_type = 'appointment' AND reference_id = ?`,
        [appointment.id]
      );
      appointment.services = services;
      appointment.products = products;
      appointment.payments = payments;
    }

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener una cita
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT a.*, u.name as stylist_name, u.color as stylist_color 
       FROM appointments a 
       LEFT JOIN users u ON a.stylist_id = u.id 
       WHERE a.id = ?`,
      [req.params.id]
    );
    
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Cita no encontrada' });
    }

    const appointment = rows[0];

    const [services] = await db.query(
      `SELECT aps.*, s.name, s.duration 
       FROM appointment_services aps 
       LEFT JOIN services s ON aps.service_id = s.id 
       WHERE aps.appointment_id = ?`,
      [appointment.id]
    );
    const [products] = await db.query(
      `SELECT app.*, p.name 
       FROM appointment_products app 
       LEFT JOIN products p ON app.product_id = p.id 
       WHERE app.appointment_id = ?`,
      [appointment.id]
    );
    const [payments] = await db.query(
      `SELECT * FROM payments WHERE reference_type = 'appointment' AND reference_id = ?`,
      [appointment.id]
    );

    appointment.services = services;
    appointment.products = products;
    appointment.payments = payments;

    res.json(appointment);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear cita
router.post('/', async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { 
      branch_id, client_id, client_name, client_phone, stylist_id,
      date, time, duration, services, products, payments,
      subtotal, discount, total, notes
    } = req.body;

    const id = uuidv4();

    await connection.query(
      `INSERT INTO appointments (id, branch_id, client_id, client_name, client_phone, 
       stylist_id, date, time, duration, subtotal, discount, total, notes) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, branch_id, client_id, client_name, client_phone, stylist_id, 
       date, time, duration, subtotal, discount, total, notes]
    );

    // Insertar servicios
    if (services && services.length > 0) {
      for (const service of services) {
        await connection.query(
          'INSERT INTO appointment_services (id, appointment_id, service_id, price, discount) VALUES (UUID(), ?, ?, ?, ?)',
          [id, service.service_id, service.price, service.discount || 0]
        );
      }
    }

    // Insertar productos
    if (products && products.length > 0) {
      for (const product of products) {
        await connection.query(
          'INSERT INTO appointment_products (id, appointment_id, product_id, quantity, price, discount) VALUES (UUID(), ?, ?, ?, ?, ?)',
          [id, product.product_id, product.quantity, product.price, product.discount || 0]
        );
      }
    }

    // Insertar pagos
    if (payments && payments.length > 0) {
      for (const payment of payments) {
        await connection.query(
          'INSERT INTO payments (id, reference_type, reference_id, method, amount) VALUES (UUID(), ?, ?, ?, ?)',
          ['appointment', id, payment.method, payment.amount]
        );
      }
    }

    await connection.commit();
    res.status(201).json({ id, message: 'Cita creada exitosamente' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Actualizar cita
router.put('/:id', auth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { 
      client_id, client_name, client_phone, stylist_id,
      date, time, duration, services, products, payments,
      subtotal, discount, total, status, notes
    } = req.body;

    await connection.query(
      `UPDATE appointments SET client_id = ?, client_name = ?, client_phone = ?, 
       stylist_id = ?, date = ?, time = ?, duration = ?, subtotal = ?, 
       discount = ?, total = ?, status = ?, notes = ? WHERE id = ?`,
      [client_id, client_name, client_phone, stylist_id, date, time, duration,
       subtotal, discount, total, status, notes, req.params.id]
    );

    // Actualizar servicios
    await connection.query('DELETE FROM appointment_services WHERE appointment_id = ?', [req.params.id]);
    if (services && services.length > 0) {
      for (const service of services) {
        await connection.query(
          'INSERT INTO appointment_services (id, appointment_id, service_id, price, discount) VALUES (UUID(), ?, ?, ?, ?)',
          [req.params.id, service.service_id, service.price, service.discount || 0]
        );
      }
    }

    // Actualizar productos
    await connection.query('DELETE FROM appointment_products WHERE appointment_id = ?', [req.params.id]);
    if (products && products.length > 0) {
      for (const product of products) {
        await connection.query(
          'INSERT INTO appointment_products (id, appointment_id, product_id, quantity, price, discount) VALUES (UUID(), ?, ?, ?, ?, ?)',
          [req.params.id, product.product_id, product.quantity, product.price, product.discount || 0]
        );
      }
    }

    // Actualizar pagos
    await connection.query("DELETE FROM payments WHERE reference_type = 'appointment' AND reference_id = ?", [req.params.id]);
    if (payments && payments.length > 0) {
      for (const payment of payments) {
        await connection.query(
          'INSERT INTO payments (id, reference_type, reference_id, method, amount) VALUES (UUID(), ?, ?, ?, ?)',
          ['appointment', req.params.id, payment.method, payment.amount]
        );
      }
    }

    await connection.commit();
    res.json({ message: 'Cita actualizada exitosamente' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Actualizar estado de cita
router.patch('/:id/status', auth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    
    const { status } = req.body;
    await connection.query('UPDATE appointments SET status = ? WHERE id = ?', [status, req.params.id]);

    // Si se completa, descontar inventario
    if (status === 'completed') {
      const [products] = await connection.query(
        'SELECT product_id, quantity FROM appointment_products WHERE appointment_id = ?',
        [req.params.id]
      );

      for (const item of products) {
        await connection.query(
          'UPDATE products SET stock = stock - ? WHERE id = ?',
          [item.quantity, item.product_id]
        );
        
        // Registrar movimiento
        const [appointment] = await connection.query('SELECT branch_id FROM appointments WHERE id = ?', [req.params.id]);
        await connection.query(
          `INSERT INTO inventory_movements (id, branch_id, product_id, type, quantity, reason) 
           VALUES (UUID(), ?, ?, 'out', ?, 'Venta en cita')`,
          [appointment[0].branch_id, item.product_id, -item.quantity]
        );
      }
    }

    await connection.commit();
    res.json({ message: 'Estado actualizado' });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Eliminar cita
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM appointments WHERE id = ?', [req.params.id]);
    res.json({ message: 'Cita eliminada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
