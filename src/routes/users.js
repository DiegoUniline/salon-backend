const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const auth = require('../middleware/auth');

// Listar usuarios
router.get('/', async (req, res) => {
  try {
    const { branch_id, role, active } = req.query;
    let query = 'SELECT id, branch_id, name, email, phone, role, color, avatar_url, active, created_at FROM users WHERE 1=1';
    const params = [];

    if (branch_id) {
      query += ' AND branch_id = ?';
      params.push(branch_id);
    }
    if (role) {
      query += ' AND role = ?';
      params.push(role);
    }
    if (active !== undefined) {
      query += ' AND active = ?';
      params.push(active === 'true' ? 1 : 0);
    }

    query += ' ORDER BY name';
    const [rows] = await db.query(query, params);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener un usuario
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, branch_id, name, email, phone, role, color, avatar_url, active, created_at FROM users WHERE id = ?',
      [req.params.id]
    );
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear usuario
router.post('/', auth, async (req, res) => {
  try {
    const { name, email, phone, password, role, branch_id, color } = req.body;
    const id = uuidv4();
    const passwordHash = password ? await bcrypt.hash(password, 10) : null;

    await db.query(
      `INSERT INTO users (id, name, email, phone, password_hash, role, branch_id, color) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, name, email, phone, passwordHash, role || 'stylist', branch_id, color || '#3B82F6']
    );

    res.status(201).json({ id, name, email, phone, role: role || 'stylist', branch_id, color: color || '#3B82F6' });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'El email ya existe' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Actualizar usuario
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, email, phone, role, branch_id, color, avatar_url, active } = req.body;

    await db.query(
      `UPDATE users SET name = ?, email = ?, phone = ?, role = ?, branch_id = ?, 
       color = ?, avatar_url = ?, active = ? WHERE id = ?`,
      [name, email, phone, role, branch_id, color, avatar_url, active ? 1 : 0, req.params.id]
    );

    res.json({ id: req.params.id, name, email, phone, role, branch_id, color, avatar_url, active });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cambiar contraseña
router.put('/:id/password', auth, async (req, res) => {
  try {
    const { password } = req.body;
    const passwordHash = await bcrypt.hash(password, 10);

    await db.query('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, req.params.id]);
    res.json({ message: 'Contraseña actualizada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar usuario
router.delete('/:id', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    res.json({ message: 'Usuario eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
