const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const db = require('../config/database');
const auth = require('../middleware/auth');

// Obtener suscripción actual
router.get('/current', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT s.*, p.name as plan_name, p.price_monthly, p.price_yearly, p.features,
              a.name as account_name
       FROM subscriptions s
       JOIN plans p ON s.plan_id = p.id
       JOIN accounts a ON s.account_id = a.id
       WHERE s.account_id = ? AND s.status IN ('trial', 'active', 'past_due')
       ORDER BY s.created_at DESC LIMIT 1`,
      [req.user.account_id]
    );

    if (rows.length === 0) {
      return res.status(404).json({ error: 'No hay suscripción activa' });
    }

    const subscription = rows[0];
    subscription.features = typeof subscription.features === 'string' 
      ? JSON.parse(subscription.features) 
      : subscription.features;

    // Calcular días restantes
    if (subscription.status === 'trial') {
      const trialEnd = new Date(subscription.trial_ends_at);
      const today = new Date();
      subscription.days_remaining = Math.ceil((trialEnd - today) / (1000 * 60 * 60 * 24));
    } else if (subscription.ends_at) {
      const end = new Date(subscription.ends_at);
      const today = new Date();
      subscription.days_remaining = Math.ceil((end - today) / (1000 * 60 * 60 * 24));
    }

    res.json(subscription);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Historial de suscripciones
router.get('/history', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT s.*, p.name as plan_name
       FROM subscriptions s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.account_id = ?
       ORDER BY s.created_at DESC`,
      [req.user.account_id]
    );

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Cambiar plan
router.post('/change-plan', auth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { plan_id, billing_cycle } = req.body;

    // Obtener nuevo plan
    const [plan] = await connection.query('SELECT * FROM plans WHERE id = ? AND active = 1', [plan_id]);
    if (plan.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'Plan no válido' });
    }

    // Obtener suscripción actual
    const [currentSub] = await connection.query(
      "SELECT * FROM subscriptions WHERE account_id = ? AND status IN ('trial', 'active')",
      [req.user.account_id]
    );

    if (currentSub.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'No hay suscripción activa' });
    }

    // Verificar que no exceda límites del nuevo plan
    if (currentSub[0].current_users > plan[0].max_users) {
      await connection.rollback();
      return res.status(400).json({ 
        error: `El plan ${plan[0].name} permite máximo ${plan[0].max_users} usuarios. Tienes ${currentSub[0].current_users}.` 
      });
    }

    if (currentSub[0].current_branches > plan[0].max_branches) {
      await connection.rollback();
      return res.status(400).json({ 
        error: `El plan ${plan[0].name} permite máximo ${plan[0].max_branches} sucursales. Tienes ${currentSub[0].current_branches}.` 
      });
    }

    // Actualizar suscripción
    await connection.query(
      `UPDATE subscriptions SET 
        plan_id = ?, 
        billing_cycle = ?,
        max_users = ?, 
        max_branches = ?,
        updated_at = NOW()
       WHERE id = ?`,
      [plan_id, billing_cycle || 'monthly', plan[0].max_users, plan[0].max_branches, currentSub[0].id]
    );

    await connection.commit();

    res.json({ 
      message: 'Plan actualizado exitosamente',
      plan: plan[0].name,
      max_users: plan[0].max_users,
      max_branches: plan[0].max_branches
    });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Activar suscripción (después de pago)
router.post('/activate', auth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { billing_cycle, payment_reference } = req.body;

    // Obtener suscripción actual
    const [currentSub] = await connection.query(
      "SELECT s.*, p.price_monthly, p.price_yearly FROM subscriptions s JOIN plans p ON s.plan_id = p.id WHERE s.account_id = ? AND s.status IN ('trial', 'active', 'past_due')",
      [req.user.account_id]
    );

    if (currentSub.length === 0) {
      await connection.rollback();
      return res.status(400).json({ error: 'No hay suscripción para activar' });
    }

    const sub = currentSub[0];
    const cycle = billing_cycle || sub.billing_cycle || 'monthly';
    const amount = cycle === 'yearly' ? sub.price_yearly : sub.price_monthly;

    // Calcular fecha de fin
    const startsAt = new Date();
    const endsAt = new Date();
    if (cycle === 'yearly') {
      endsAt.setFullYear(endsAt.getFullYear() + 1);
    } else {
      endsAt.setMonth(endsAt.getMonth() + 1);
    }

    // Actualizar suscripción
    await connection.query(
      `UPDATE subscriptions SET 
        status = 'active',
        billing_cycle = ?,
        starts_at = ?,
        ends_at = ?,
        updated_at = NOW()
       WHERE id = ?`,
      [cycle, startsAt, endsAt, sub.id]
    );

    // Registrar pago
    await connection.query(
      `INSERT INTO subscription_payments 
        (id, subscription_id, account_id, amount, currency, payment_method, status, reference, paid_at, period_start, period_end)
       VALUES (UUID(), ?, ?, ?, 'MXN', 'card', 'completed', ?, NOW(), ?, ?)`,
      [sub.id, req.user.account_id, amount, payment_reference, startsAt, endsAt]
    );

    await connection.commit();

    res.json({ 
      message: 'Suscripción activada exitosamente',
      status: 'active',
      ends_at: endsAt
    });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// Cancelar suscripción
router.post('/cancel', auth, async (req, res) => {
  try {
    const { reason } = req.body;

    const [result] = await db.query(
      `UPDATE subscriptions SET 
        status = 'cancelled',
        cancelled_at = NOW(),
        updated_at = NOW()
       WHERE account_id = ? AND status IN ('trial', 'active')`,
      [req.user.account_id]
    );

    if (result.affectedRows === 0) {
      return res.status(400).json({ error: 'No hay suscripción activa para cancelar' });
    }

    res.json({ message: 'Suscripción cancelada. Tendrás acceso hasta el fin del periodo pagado.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============ PAGOS ============

// Historial de pagos
router.get('/payments', auth, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT sp.*, p.name as plan_name
       FROM subscription_payments sp
       JOIN subscriptions s ON sp.subscription_id = s.id
       JOIN plans p ON s.plan_id = p.id
       WHERE sp.account_id = ?
       ORDER BY sp.created_at DESC`,
      [req.user.account_id]
    );

    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Registrar pago manual (admin)
router.post('/payments', auth, async (req, res) => {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const { amount, payment_method, reference, notes, period_months } = req.body;

    // Obtener suscripción
    const [sub] = await connection.query(
      "SELECT * FROM subscriptions WHERE account_id = ?",
      [req.user.account_id]
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
      [paymentId, sub[0].id, req.user.account_id, amount, payment_method, reference, notes, periodStart, periodEnd]
    );

    // Actualizar suscripción
    await connection.query(
      `UPDATE subscriptions SET 
        status = 'active',
        ends_at = ?,
        updated_at = NOW()
       WHERE id = ?`,
      [periodEnd, sub[0].id]
    );

    await connection.commit();

    res.status(201).json({ 
      id: paymentId,
      message: 'Pago registrado',
      period_end: periodEnd
    });
  } catch (error) {
    await connection.rollback();
    res.status(500).json({ error: error.message });
  } finally {
    connection.release();
  }
});

// ============ LÍMITES Y USO ============

// Obtener uso actual
router.get('/usage', auth, async (req, res) => {
  try {
    const [sub] = await db.query(
      `SELECT s.max_users, s.max_branches, s.current_users, s.current_branches,
              p.name as plan_name, p.features
       FROM subscriptions s
       JOIN plans p ON s.plan_id = p.id
       WHERE s.account_id = ? AND s.status IN ('trial', 'active')`,
      [req.user.account_id]
    );

    if (sub.length === 0) {
      return res.status(404).json({ error: 'No hay suscripción activa' });
    }

    const usage = sub[0];
    usage.features = typeof usage.features === 'string' ? JSON.parse(usage.features) : usage.features;
    usage.users_percentage = Math.round((usage.current_users / usage.max_users) * 100);
    usage.branches_percentage = Math.round((usage.current_branches / usage.max_branches) * 100);

    res.json(usage);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
