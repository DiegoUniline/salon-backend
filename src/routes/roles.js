const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const auth = require('../middleware/auth');

// Listar roles
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM roles ORDER BY is_system DESC, name');
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener un rol
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM roles WHERE id = ?', [req.params.id]);
    if (rows.length === 0) {
      return res.status(404).json({ error: 'Rol no encontrado' });
    }
    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear rol
router.post('/', auth, async (req, res) => {
  try {
    const { name, description, color, permissions } = req.body;
    const id = uuidv4();

    await db.query(
      'INSERT INTO roles (id, name, description, color, permissions) VALUES (?, ?, ?, ?, ?)',
      [id, name, description, color || '#3B82F6', JSON.stringify(permissions)]
    );

    res.status(201).json({ id, name, description, color: color || '#3B82F6', permissions, is_system: false });
  } catch (error) {
    if (error.code === 'ER_DUP_ENTRY') {
      return res.status(400).json({ error: 'El nombre del rol ya existe' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Actualizar rol
router.put('/:id', auth, async (req, res) => {
  try {
    const { name, description, color, permissions } = req.body;

    // No permitir editar roles del sistema
    const [role] = await db.query('SELECT is_system FROM roles WHERE id = ?', [req.params.id]);
    if (role[0]?.is_system) {
      return res.status(403).json({ error: 'No se puede editar un rol del sistema' });
    }

    await db.query(
      'UPDATE roles SET name = ?, description = ?, color = ?, permissions = ? WHERE id = ?',
      [name, description, color, JSON.stringify(permissions), req.params.id]
    );

    res.json({ id: req.params.id, name, description, color, permissions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Duplicar rol
router.post('/:id/duplicate', auth, async (req, res) => {
  try {
    const [role] = await db.query('SELECT * FROM roles WHERE id = ?', [req.params.id]);
    if (role.length === 0) {
      return res.status(404).json({ error: 'Rol no encontrado' });
    }

    const id = uuidv4();
    const newName = `${role[0].name} (copia)`;

    await db.query(
      'INSERT INTO roles (id, name, description, color, permissions) VALUES (?, ?, ?, ?, ?)',
      [id, newName, role[0].description, role[0].color, role[0].permissions]
    );

    res.status(201).json({ id, name: newName, description: role[0].description, color: role[0].color, permissions: role[0].permissions });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar rol
router.delete('/:id', auth, async (req, res) => {
  try {
    // No permitir eliminar roles del sistema
    const [role] = await db.query('SELECT is_system FROM roles WHERE id = ?', [req.params.id]);
    if (role[0]?.is_system) {
      return res.status(403).json({ error: 'No se puede eliminar un rol del sistema' });
    }

    // Verificar si tiene usuarios asignados
    const [users] = await db.query('SELECT COUNT(*) as count FROM user_roles WHERE role_id = ?', [req.params.id]);
    if (users[0].count > 0) {
      return res.status(400).json({ error: 'No se puede eliminar un rol con usuarios asignados' });
    }

    await db.query('DELETE FROM roles WHERE id = ?', [req.params.id]);
    res.json({ message: 'Rol eliminado' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ USER ROLES ============

// Listar usuarios con roles
router.get('/users/list', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT u.id, u.name, u.email, u.active, ur.role_id, r.name as role_name, r.color as role_color, ur.branch_id
      FROM users u
      LEFT JOIN user_roles ur ON u.id = ur.user_id
      LEFT JOIN roles r ON ur.role_id = r.id
      ORDER BY u.name
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Asignar rol a usuario
router.post('/users/assign', auth, async (req, res) => {
  try {
    const { user_id, role_id, branch_id } = req.body;

    // Eliminar rol anterior
    await db.query('DELETE FROM user_roles WHERE user_id = ?', [user_id]);

    // Asignar nuevo rol
    await db.query(
      'INSERT INTO user_roles (id, user_id, role_id, branch_id) VALUES (UUID(), ?, ?, ?)',
      [user_id, role_id, branch_id]
    );

    res.json({ message: 'Rol asignado exitosamente' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Quitar rol a usuario
router.delete('/users/:user_id/role', auth, async (req, res) => {
  try {
    await db.query('DELETE FROM user_roles WHERE user_id = ?', [req.params.user_id]);
    res.json({ message: 'Rol removido' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
