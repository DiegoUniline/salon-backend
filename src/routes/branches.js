const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const db = require("../config/database");
const auth = require("../middleware/auth");

// Listar sucursales (por cuenta)
router.get("/", auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM branches WHERE account_id = ? ORDER BY name",
      [req.user.account_id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener una sucursal (validar cuenta)
router.get("/:id", auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM branches WHERE id = ? AND account_id = ?",
      [req.params.id, req.user.account_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Sucursal no encontrada" });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear sucursal (validar límite de suscripción)
router.post("/", auth, async (req, res) => {
  try {
    // Verificar límite de sucursales
    if (req.user.current_branches >= req.user.max_branches) {
      return res.status(403).json({ 
        error: `Límite de sucursales alcanzado (${req.user.max_branches}). Actualiza tu plan para agregar más sucursales.` 
      });
    }

    const { name, address, phone } = req.body;
    const id = uuidv4();

    await db.query(
      "INSERT INTO branches (id, name, address, phone, account_id) VALUES (?, ?, ?, ?, ?)",
      [id, name, address, phone, req.user.account_id]
    );

    // Actualizar contador de sucursales en suscripción
    await db.query(
      'UPDATE subscriptions SET current_branches = current_branches + 1 WHERE account_id = ? AND status IN ("trial", "active")',
      [req.user.account_id]
    );

    res.status(201).json({ id, name, address, phone });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Actualizar sucursal
router.put("/:id", auth, async (req, res) => {
  try {
    const { name, address, phone } = req.body;

    const [result] = await db.query(
      "UPDATE branches SET name = ?, address = ?, phone = ? WHERE id = ? AND account_id = ?",
      [name, address, phone, req.params.id, req.user.account_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Sucursal no encontrada" });
    }

    res.json({ id: req.params.id, name, address, phone });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar sucursal
router.delete("/:id", auth, async (req, res) => {
  try {
    // No permitir eliminar la sucursal actual del usuario
    if (req.params.id === req.user.branch_id) {
      return res.status(400).json({ error: "No puedes eliminar tu sucursal actual" });
    }

    // Verificar que no tenga usuarios asignados
    const [users] = await db.query(
      "SELECT COUNT(*) as count FROM users WHERE branch_id = ?",
      [req.params.id]
    );

    if (users[0].count > 0) {
      return res.status(400).json({ 
        error: `No se puede eliminar: ${users[0].count} usuario(s) asignados a esta sucursal` 
      });
    }

    const [result] = await db.query(
      "DELETE FROM branches WHERE id = ? AND account_id = ?",
      [req.params.id, req.user.account_id]
    );

    if (result.affectedRows === 0) {
      return res.status(404).json({ error: "Sucursal no encontrada" });
    }

    // Actualizar contador de sucursales en suscripción
    await db.query(
      'UPDATE subscriptions SET current_branches = current_branches - 1 WHERE account_id = ? AND status IN ("trial", "active")',
      [req.user.account_id]
    );

    res.json({ message: "Sucursal eliminada" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
