const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const db = require("../config/database");
const auth = require("../middleware/auth");

// Listar citas (por sucursal)
router.get("/", auth, async (req, res) => {
  try {
    const { stylist_id, date, start_date, end_date, status } = req.query;
    let query = `
      SELECT a.*, u.name as stylist_name, u.color as stylist_color 
      FROM appointments a 
      LEFT JOIN users u ON a.stylist_id = u.id 
      WHERE a.branch_id = ?
    `;
    const params = [req.user.branch_id];

    if (stylist_id) {
      query += " AND a.stylist_id = ?";
      params.push(stylist_id);
    }
    if (date) {
      query += " AND a.date = ?";
      params.push(date);
    }
    if (start_date && end_date) {
      query += " AND a.date BETWEEN ? AND ?";
      params.push(start_date, end_date);
    }
    if (status) {
      query += " AND a.status = ?";
      params.push(status);
    }

    query += " ORDER BY a.date, a.time";
    const [rows] = await db.query(query, params);

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

// Obtener una cita (validar sucursal)
router.get("/:id", auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT a.*, u.name as stylist_name, u.color as stylist_color 
       FROM appointments a 
       LEFT JOIN users u ON a.stylist_id = u.id 
       WHERE a.id = ? AND a.branch_id = ?`,
      [req.params.id, req.user.branch_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: "Cita no encontrada" });
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
router.post("/", auth, async (req, res) => {
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    const {
      client_id,
      client_name,
      client_phone,
      stylist_id,
      date,
      time,
      duration,
      services = [],
      products = [],
      payments = [],
      subtotal,
      discount,
      discount_percent,
      total,
      notes,
    } = req.body;

    const branch_id = req.user.branch_id;

    if (!client_id || !stylist_id || !date || !time) {
      await connection.rollback();
      return res.status(400).json({
        error: "Faltan datos obligatorios para crear la cita",
      });
    }

    const status = "scheduled";
    const id = uuidv4();

    let finalClientName = client_name || null;
    let finalClientPhone = client_phone || null;

    const [clientRows] = await connection.query(
      "SELECT name, phone FROM clients WHERE id = ? AND account_id = ?",
      [client_id, req.user.account_id]
    );

    if (clientRows.length > 0) {
      finalClientName = clientRows[0].name;
      finalClientPhone = clientRows[0].phone;
    }

    finalClientName = finalClientName || "Cliente";
    finalClientPhone = finalClientPhone || null;

    await connection.query(
      `INSERT INTO appointments (
        id, branch_id, client_id, client_name, client_phone,
        stylist_id, date, time, duration,
        subtotal, discount, discount_percent, total, status, notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        branch_id,
        client_id,
        finalClientName,
        finalClientPhone,
        stylist_id,
        date,
        time,
        duration,
        subtotal,
        discount,
        discount_percent,
        total,
        status,
        notes,
      ]
    );

    for (const service of services) {
      await connection.query(
        `INSERT INTO appointment_services 
         (id, appointment_id, service_id, price, discount)
         VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), id, service.service_id, service.price, service.discount || 0]
      );
    }

    for (const product of products) {
      await connection.query(
        `INSERT INTO appointment_products
         (id, appointment_id, product_id, quantity, price, discount)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          uuidv4(),
          id,
          product.product_id,
          product.quantity,
          product.price,
          product.discount || 0,
        ]
      );
    }

    for (const payment of payments) {
      await connection.query(
        `INSERT INTO payments
         (id, reference_type, reference_id, method, amount)
         VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), "appointment", id, payment.method, payment.amount]
      );
    }

    await connection.commit();
    res.status(201).json({
      id,
      message: "Cita creada exitosamente",
    });
  } catch (error) {
    await connection.rollback();
    console.error("CREATE APPOINTMENT ERROR:", error);
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Actualizar cita
router.put("/:id", auth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Verificar que la cita pertenece a la sucursal
    const [existing] = await connection.query(
      "SELECT id FROM appointments WHERE id = ? AND branch_id = ?",
      [req.params.id, req.user.branch_id]
    );

    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Cita no encontrada" });
    }

    const {
      client_id,
      client_name,
      client_phone,
      stylist_id,
      date,
      time,
      duration,
      services,
      products,
      payments,
      subtotal,
      discount,
      discount_percent,
      total,
      notes,
    } = req.body;

    let finalClientName = client_name || null;
    let finalClientPhone = client_phone || null;

    const [clientRows] = await connection.query(
      "SELECT name, phone FROM clients WHERE id = ? AND account_id = ?",
      [client_id, req.user.account_id]
    );

    if (clientRows.length > 0) {
      finalClientName = clientRows[0].name;
      finalClientPhone = clientRows[0].phone;
    }

    await connection.query(
      `UPDATE appointments SET 
        client_id = ?, 
        client_name = ?, 
        client_phone = ?, 
        stylist_id = ?, 
        date = ?, 
        time = ?, 
        duration = ?, 
        subtotal = ?, 
        discount = ?, 
        discount_percent = ?,
        total = ?, 
        notes = ? 
       WHERE id = ? AND branch_id = ?`,
      [
        client_id,
        finalClientName,
        finalClientPhone,
        stylist_id,
        date,
        time,
        duration,
        subtotal,
        discount,
        discount_percent,
        total,
        notes,
        req.params.id,
        req.user.branch_id,
      ]
    );

    await connection.query(
      "DELETE FROM appointment_services WHERE appointment_id = ?",
      [req.params.id]
    );
    if (services && services.length > 0) {
      for (const service of services) {
        await connection.query(
          `INSERT INTO appointment_services 
           (id, appointment_id, service_id, price, discount)
           VALUES (?, ?, ?, ?, ?)`,
          [
            uuidv4(),
            req.params.id,
            service.service_id,
            service.price,
            service.discount || 0,
          ]
        );
      }
    }

    await connection.query(
      "DELETE FROM appointment_products WHERE appointment_id = ?",
      [req.params.id]
    );
    if (products && products.length > 0) {
      for (const product of products) {
        await connection.query(
          "INSERT INTO appointment_products (id, appointment_id, product_id, quantity, price, discount) VALUES (UUID(), ?, ?, ?, ?, ?)",
          [
            req.params.id,
            product.product_id,
            product.quantity,
            product.price,
            product.discount || 0,
          ]
        );
      }
    }

    await connection.query(
      "DELETE FROM payments WHERE reference_type = 'appointment' AND reference_id = ?",
      [req.params.id]
    );
    if (payments && payments.length > 0) {
      for (const payment of payments) {
        await connection.query(
          "INSERT INTO payments (id, reference_type, reference_id, method, amount) VALUES (UUID(), ?, ?, ?, ?)",
          ["appointment", req.params.id, payment.method, payment.amount]
        );
      }
    }

    await connection.commit();
    res.json({ message: "Cita actualizada exitosamente" });
  } catch (error) {
    console.log(error);
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Actualizar estado de cita
router.patch("/:id/status", auth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    // Verificar que la cita pertenece a la sucursal
    const [existing] = await connection.query(
      "SELECT id FROM appointments WHERE id = ? AND branch_id = ?",
      [req.params.id, req.user.branch_id]
    );

    if (existing.length === 0) {
      await connection.rollback();
      return res.status(404).json({ error: "Cita no encontrada" });
    }

    const { status } = req.body;
    await connection.query(
      "UPDATE appointments SET status = ? WHERE id = ? AND branch_id = ?",
      [status, req.params.id, req.user.branch_id]
    );

    if (status === "completed") {
      const [products] = await connection.query(
        "SELECT product_id, quantity FROM appointment_products WHERE appointment_id = ?",
        [req.params.id]
      );

      for (const item of products) {
        await connection.query(
          "UPDATE products SET stock = stock - ? WHERE id = ?",
          [item.quantity, item.product_id]
        );

        await connection.query(
          `INSERT INTO inventory_movements (id, branch_id, product_id, type, quantity, reason) 
           VALUES (UUID(), ?, ?, 'out', ?, 'Venta en cita')`,
          [req.user.branch_id, item.product_id, -item.quantity]
        );
      }
    }

    await connection.commit();
    res.json({ message: "Estado actualizado" });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Eliminar cita
router.delete("/:id", auth, async (req, res) => {
  try {
    const [result] = await db.query(
      "DELETE FROM appointments WHERE id = ? AND branch_id = ?",
      [req.params.id, req.user.branch_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Cita no encontrada" });
    }

    res.json({ message: "Cita eliminada" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
