const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const db = require("../config/database");
const auth = require("../middleware/auth");

// Listar clientes (por cuenta)
router.get("/", auth, async (req, res) => {
  try {
    const { search } = req.query;
    let query = "SELECT * FROM clients WHERE account_id = ?";
    const params = [req.user.account_id];

    if (search) {
      query += " AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)";
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    query += " ORDER BY name";
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener un cliente (validar cuenta)
router.get("/:id", auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      "SELECT * FROM clients WHERE id = ? AND account_id = ?",
      [req.params.id, req.user.account_id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: "Cliente no encontrado" });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Historial de citas del cliente
router.get("/:id/appointments", auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT a.*, u.name as stylist_name 
       FROM appointments a 
       LEFT JOIN users u ON a.stylist_id = u.id 
       LEFT JOIN clients c ON a.client_id = c.id
       WHERE a.client_id = ? AND c.account_id = ?
       ORDER BY a.date DESC, a.time DESC`,
      [req.params.id, req.user.account_id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear cliente
router.post("/", auth, async (req, res) => {
  try {
    const { name, phone, email, notes } = req.body;
    const id = uuidv4();

    await db.query(
      "INSERT INTO clients (id, name, phone, email, notes, account_id) VALUES (?, ?, ?, ?, ?, ?)",
      [id, name, phone, email, notes, req.user.account_id]
    );

    res.status(201).json({ id, name, phone, email, notes });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: "El email ya está registrado",
      });
    }
    res.status(500).json({ error: error.message });
  }
});

// Actualizar cliente
router.put("/:id", auth, async (req, res) => {
  try {
    const { name, phone, email, notes } = req.body;

    await db.query(
      "UPDATE clients SET name = ?, phone = ?, email = ?, notes = ? WHERE id = ? AND account_id = ?",
      [name, phone, email, notes, req.params.id, req.user.account_id]
    );

    res.json({ id: req.params.id, name, phone, email, notes });
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") {
      return res.status(409).json({
        error: "El email ya está registrado por otro cliente",
      });
    }
    res.status(500).json({ error: error.message });
  }
});

// Eliminar cliente
router.delete("/:id", auth, async (req, res) => {
  try {
    await db.query(
      "DELETE FROM clients WHERE id = ? AND account_id = ?",
      [req.params.id, req.user.account_id]
    );
    res.json({ message: "Cliente eliminado" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
