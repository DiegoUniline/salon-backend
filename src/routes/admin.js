const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const db = require('../config/database');
const auth = require('../middleware/auth');
const superadmin = require('../middleware/superadmin');

// Todas las rutas requieren auth + superadmin
router.use(auth);
router.use(superadmin);

// ============ CUENTAS ============

// Listar todas las cuentas
router.get('/accounts', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT a.*, 
             s.id as subscription_id, s.plan_id, s.status as subscription_status,
             s.current_users, s.max_users, s.current_branches, s.max_branches,
             s.trial_ends_at, s.ends_at,
             p.name as plan_name, p.price_monthly,
             (SELECT COUNT(*) FROM users WHERE account_id = a.id) as total_users,
             (SELECT COUNT(*) FROM branches WHERE account_id = a.id) as total_branches
      FROM accounts a
      LEFT JOIN subscriptions s ON a.id = s.account_id AND s.status IN ('trial', 'active', 'past_due')
      LEFT JOIN plans p ON s.plan_id = p.id
      ORDER BY a.created_at DESC
    `);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Obtener una cuenta
router.get('/accounts/:id', async (req, res) => {
  try {
    const [accounts] = await db.query('SELECT * FROM accounts WHERE id = ?', [req.params.id]);
    
    if (accounts.length === 0) {
      return res.status(404).json({ error: 'Cuenta no encontrada' });
    }

    const [subscription] = await db.query(`
      SELECT s.*, p.name as plan_name, p.price_monthly, p.price_yearly
      FROM subscriptions s
      JOIN plans p ON s.plan_id = p.id
      WHERE s.account_id = ?
      ORDER BY s.created_at DESC LIMIT 1
    `, [req.params.id]);

    const [users] = await db.query(
      'SELECT id, name, email, role, active, created_at FROM users WHERE account_id = ?',
      [req.params.id]
    );

    const [branches] = await db.query(
      'SELECT id, name, address, phone FROM branches WHERE account_id = ?',
      [req.params.id]
    );

    res.json({
      ...accounts[0],
      subscription: subscription[0] || null,
      users,
      branches
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Crear cuenta (con suscripción y usuario admin)
router.post('/accounts', async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { 
      account_name, 
      admin_name, 
      admin_email, 
      admin_password,
      admin_phone,
      plan_id,
      trial_days
    } = req.body;

    // Validar email único
    const [existingUser] = await connection.query(
      'SELECT id FROM users WHERE email = ?',
      [admin_email]
    );

    if (existingUser.length > 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'El email ya está registrado' });
    }

    // 1. Crear cuenta
    const accountId = uuidv4();
    await connection.query(
      'INSERT INTO accounts (id, name, email, phone) VALUES (?, ?, ?, ?)',
      [accountId, account_name, admin_email, admin_phone]
    );

    // 2. Crear sucursal principal
    const branchId = uuidv4();
    await connection.query(
      'INSERT INTO branches (id, name, account_id) VALUES (?, ?, ?)',
      [branchId, 'Sucursal Principal', accountId]
    );

    // 3. Obtener plan
    const selectedPlanId = plan_id || 'plan-basic';
    const [plan] = await connection.query('SELECT * FROM plans WHERE id = ?', [selectedPlanId]);
    
    if (plan.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Plan no válido' });
    }

    // 4. Crear suscripción
    const subscriptionId = uuidv4();
    const trialEndsAt = new Date();
    trialEndsAt.setDate(trialEndsAt.getDate() + (trial_days || 14));

    await connection.query(
      `INSERT INTO subscriptions (id, account_id, plan_id, status, max_users, max_branches, current_users, current_branches, trial_ends_at, starts_at) 
       VALUES (?, ?, ?, 'trial', ?, ?, 1, 1, ?, CURDATE())`,
      [subscriptionId, accountId, selectedPlanId, plan[0].max_users, plan[0].max_branches, trialEndsAt]
    );

    // 5. Crear roles por defecto
    const defaultRoles = [
      { name: 'Administrador', color: '#dc2626', permissions: { dashboard: { view: true, create: true, edit: true, delete: true }, appointments: { view: true, create: true, edit: true, delete: true }, sales: { view: true, create: true, edit: true, delete: true }, clients: { view: true, create: true, edit: true, delete: true }, services: { view: true, create: true, edit: true, delete: true }, products: { view: true, create: true, edit: true, delete: true }, inventory: { view: true, create: true, edit: true, delete: true }, users: { view: true, create: true, edit: true, delete: true }, roles: { view: true, create: true, edit: true, delete: true }, reports: { view: true, create: true, edit: true, delete: true }, settings: { view: true, create: true, edit: true, delete: true }, expenses: { view: true, create: true, edit: true, delete: true }, purchases: { view: true, create: true, edit: true, delete: true }, cashcuts: { view: true, create: true, edit: true, delete: true } } },
      { name: 'Gerente', color: '#2563eb', permissions: { dashboard: { view: true }, appointments: { view: true, create: true, edit: true }, sales: { view: true, create: true }, clients: { view: true, create: true, edit: true }, services: { view: true }, products: { view: true }, reports: { view: true } } },
      { name: 'Recepcionista', color: '#16a34a', permissions: { dashboard: { view: true }, appointments: { view: true, create: true, edit: true }, clients: { view: true, create: true }, services: { view: true } } },
      { name: 'Estilista', color: '#9333ea', permissions: { dashboard: { view: true }, appointments: { view: true }, clients: { view: true }, services: { view: true } } }
    ];

    let adminRoleId = null;
    for (const role of defaultRoles) {
      const roleId = uuidv4();
      if (role.name === 'Administrador') adminRoleId = roleId;
      await connection.query(
        'INSERT INTO roles (id, name, color, permissions, account_id) VALUES (?, ?, ?, ?, ?)',
        [roleId, role.name, role.color, JSON.stringify(role.permissions), accountId]
      );
    }

    // 6. Crear usuario admin
    const userId = uuidv4();
    const passwordHash = await bcrypt.hash(admin_password || '123456', 10);

    await connection.query(
      `INSERT INTO users (id, name, email, phone, password_hash, role, branch_id, account_id, color) 
       VALUES (?, ?, ?, ?, ?, 'admin', ?, ?, '#3B82F6')`,
      [userId, admin_name, admin_email, admin_phone, passwordHash, branchId, accountId]
    );

    // 7. Asignar rol
    await connection.query(
      'INSERT INTO user_roles (id, user_id, role_id, branch_id) VALUES (UUID(), ?, ?, ?)',
      [userId, adminRoleId, branchId]
    );

    await connection.commit();

    res.status(201).json({
      message: 'Cuenta creada exitosamente',
      account_id: accountId,
      user_id: userId,
      subscription_id: subscriptionId
    });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Actualizar cuenta
router.put('/accounts/:id', async (req, res) => {
  try {
    const { name, email, phone, active } = req.body;

    await db.query(
      'UPDATE accounts SET name = ?, email = ?, phone = ?, active = ? WHERE id = ?',
      [name, email, phone, active ? 1 : 0, req.params.id]
    );

    res.json({ message: 'Cuenta actualizada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Eliminar cuenta (soft delete - desactiva)
router.delete('/accounts/:id', async (req, res) => {
  try {
    await db.query('UPDATE accounts SET active = 0 WHERE id = ?', [req.params.id]);
    await db.query(
      "UPDATE subscriptions SET status = 'cancelled', cancelled_at = NOW() WHERE account_id = ?",
      [req.params.id]
    );

    res.json({ message: 'Cuenta desactivada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ SUSCRIPCIONES ============

// Obtener suscripción de una cuenta
router.get('/accounts/:id/subscription', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT s.*, p.name as plan_name, p.price_monthly, p.price_yearly, p.max_users, p.max_branches
      FROM subscriptions s
      JOIN plans p ON s.plan_id = p.id
      WHERE s.account_id = ?
      ORDER BY s.created_at DESC LIMIT 1
    `, [req.params.id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: 'Suscripción no encontrada' });
    }

    res.json(rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Actualizar suscripción
router.put('/accounts/:id/subscription', async (req, res) => {
  try {
    const { plan_id, status, max_users, max_branches, ends_at, trial_ends_at } = req.body;

    // Obtener plan si se cambia
    let planMaxUsers = max_users;
    let planMaxBranches = max_branches;

    if (plan_id) {
      const [plan] = await db.query('SELECT * FROM plans WHERE id = ?', [plan_id]);
      if (plan.length > 0) {
        planMaxUsers = max_users || plan[0].max_users;
        planMaxBranches = max_branches || plan[0].max_branches;
      }
    }

    await db.query(`
      UPDATE subscriptions SET 
        plan_id = COALESCE(?, plan_id),
        status = COALESCE(?, status),
        max_users = COALESCE(?, max_users),
        max_branches = COALESCE(?, max_branches),
        ends_at = COALESCE(?, ends_at),
        trial_ends_at = COALESCE(?, trial_ends_at),
        updated_at = NOW()
      WHERE account_id = ? AND status IN ('trial', 'active', 'past_due')
    `, [plan_id, status, planMaxUsers, planMaxBranches, ends_at, trial_ends_at, req.params.id]);

    res.json({ message: 'Suscripción actualizada' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Extender trial
router.post('/accounts/:id/extend-trial', async (req, res) => {
  try {
    const { days } = req.body;
    const extendDays = days || 14;

    await db.query(`
      UPDATE subscriptions SET 
        trial_ends_at = DATE_ADD(COALESCE(trial_ends_at, CURDATE()), INTERVAL ? DAY),
        status = 'trial',
        updated_at = NOW()
      WHERE account_id = ?
    `, [extendDays, req.params.id]);

    res.json({ message: `Trial extendido ${extendDays} días` });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ PAGOS ============

// Listar pagos de una cuenta
router.get('/accounts/:id/payments', async (req, res) => {
  try {
    const [rows] = await db.query(`
      SELECT sp.*, p.name as plan_name
      FROM subscription_payments sp
      JOIN subscriptions s ON sp.subscription_id = s.id
      JOIN plans p ON s.plan_id = p.id
      WHERE sp.account_id = ?
      ORDER BY sp.created_at DESC
    `, [req.params.id]);

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Registrar pago manual
router.post('/accounts/:id/payments', async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { amount, payment_method, reference, notes, period_months } = req.body;

    // Obtener suscripción
    const [sub] = await connection.query(
      'SELECT * FROM subscriptions WHERE account_id = ?',
      [req.params.id]
    );

    if (sub.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'No hay suscripción' });
    }

    const months = period_months || 1;
    const periodStart = sub[0].ends_at ? new Date(sub[0].ends_at) : new Date();
    const periodEnd = new Date(periodStart);
    periodEnd.setMonth(periodEnd.getMonth() + months);

    // Registrar pago
    const paymentId = uuidv4();
    await connection.query(
      `INSERT INTO subscription_payments 
        (id, subscription_id, account_id, amount, currency, payment_method, status, reference, notes, paid_at, period_start, period_end)
       VALUES (?, ?, ?, ?, 'MXN', ?, 'completed', ?, ?, NOW(), ?, ?)`,
      [paymentId, sub[0].id, req.params.id, amount, payment_method || 'transfer', reference, notes, periodStart, periodEnd]
    );

    // Actualizar suscripción
    await connection.query(`
      UPDATE subscriptions SET 
        status = 'active',
        ends_at = ?,
        updated_at = NOW()
      WHERE id = ?
    `, [periodEnd, sub[0].id]);

    await connection.commit();

    res.status(201).json({ 
      id: paymentId,
      message: 'Pago registrado',
      period_start: periodStart,
      period_end: periodEnd
    });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// ============ ESTADÍSTICAS GLOBALES ============

router.get('/stats', async (req, res) => {
  try {
    const [accounts] = await db.query('SELECT COUNT(*) as total FROM accounts WHERE active = 1');
    const [trial] = await db.query("SELECT COUNT(*) as total FROM subscriptions WHERE status = 'trial'");
    const [active] = await db.query("SELECT COUNT(*) as total FROM subscriptions WHERE status = 'active'");
    const [expired] = await db.query("SELECT COUNT(*) as total FROM subscriptions WHERE status IN ('expired', 'cancelled')");
    const [users] = await db.query('SELECT COUNT(*) as total FROM users WHERE active = 1');
    const [revenue] = await db.query("SELECT COALESCE(SUM(amount), 0) as total FROM subscription_payments WHERE status = 'completed'");

    // Cuentas por plan
    const [byPlan] = await db.query(`
      SELECT p.name, COUNT(s.id) as total
      FROM plans p
      LEFT JOIN subscriptions s ON p.id = s.plan_id AND s.status IN ('trial', 'active')
      GROUP BY p.id, p.name
    `);

    // Ingresos últimos 6 meses
    const [revenueByMonth] = await db.query(`
      SELECT DATE_FORMAT(paid_at, '%Y-%m') as month, SUM(amount) as total
      FROM subscription_payments
      WHERE status = 'completed' AND paid_at >= DATE_SUB(CURDATE(), INTERVAL 6 MONTH)
      GROUP BY DATE_FORMAT(paid_at, '%Y-%m')
      ORDER BY month
    `);

    res.json({
      total_accounts: accounts[0].total,
      subscriptions: {
        trial: trial[0].total,
        active: active[0].total,
        expired: expired[0].total
      },
      total_users: users[0].total,
      total_revenue: revenue[0].total,
      accounts_by_plan: byPlan,
      revenue_by_month: revenueByMonth
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Listar todos los pagos
router.get('/payments', async (req, res) => {
  try {
    const { start_date, end_date, status } = req.query;
    let query = `
      SELECT sp.*, a.name as account_name, p.name as plan_name
      FROM subscription_payments sp
      JOIN accounts a ON sp.account_id = a.id
      JOIN subscriptions s ON sp.subscription_id = s.id
      JOIN plans p ON s.plan_id = p.id
      WHERE 1=1
    `;
    const params = [];

    if (start_date && end_date) {
      query += ' AND DATE(sp.paid_at) BETWEEN ? AND ?';
      params.push(start_date, end_date);
    }
    if (status) {
      query += ' AND sp.status = ?';
      params.push(status);
    }

    query += ' ORDER BY sp.created_at DESC';
    const [rows] = await db.query(query, params);

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
