const express = require("express");
const router = express.Router();
const { v4: uuidv4 } = require("uuid");
const db = require("../config/database");
const auth = require("../middleware/auth");

// Listar sucursales
router.get("/", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM branches ORDER BY name");
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener una sucursal
router.get("/:id", async (req, res) => {
  try {
    const [rows] = await db.query("SELECT * FROM branches WHERE id = ?", [
      req.params.id,
    ]);
    if (rows.length === 0) {
      return res.status(404).json({ error: "Sucursal no encontrada" });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear sucursal
router.post("/", auth, async (req, res) => {
  try {
    const { name, address, phone } = req.body;
    const id = uuidv4();

    await db.query(
      "INSERT INTO branches (id, name, address, phone) VALUES (?, ?, ?, ?)",
      [id, name, address, phone]
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

    await db.query(
      "UPDATE branches SET name = ?, address = ?, phone = ? WHERE id = ?",
      [name, address, phone, req.params.id]
    );

    res.json({ id: req.params.id, name, address, phone });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar sucursal
router.delete("/:id", auth, async (req, res) => {
  try {
    await db.query("DELETE FROM branches WHERE id = ?", [req.params.id]);
    res.json({ message: "Sucursal eliminada" });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
