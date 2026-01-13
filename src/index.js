require('dotenv').config();
const express = require('express');
const cors = require('cors');

const db = require('./config/database');

// Rutas
const authRoutes = require('./routes/auth');
const branchesRoutes = require('./routes/branches');
const usersRoutes = require('./routes/users');
const clientsRoutes = require('./routes/clients');
const servicesRoutes = require('./routes/services');
const productsRoutes = require('./routes/products');
const appointmentsRoutes = require('./routes/appointments');
const salesRoutes = require('./routes/sales');
const expensesRoutes = require('./routes/expenses');
const purchasesRoutes = require('./routes/purchases');
const inventoryRoutes = require('./routes/inventory');
const shiftsRoutes = require('./routes/shifts');
const cashCutsRoutes = require('./routes/cashCuts');
const rolesRoutes = require('./routes/roles');
const schedulesRoutes = require('./routes/schedules');
const configRoutes = require('./routes/config');
const dashboardRoutes = require('./routes/dashboard');

const app = express();

app.use(cors());
app.use(express.json());

// Health check
app.get('/', (req, res) => {
  res.json({ status: 'API Salon running', version: '1.0.0' });
});

// Rutas de la API
app.use('/api/auth', authRoutes);
app.use('/api/branches', branchesRoutes);
app.use('/api/users', usersRoutes);
app.use('/api/clients', clientsRoutes);
app.use('/api/services', servicesRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/appointments', appointmentsRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/expenses', expensesRoutes);
app.use('/api/purchases', purchasesRoutes);
app.use('/api/inventory', inventoryRoutes);
app.use('/api/shifts', shiftsRoutes);
app.use('/api/cash-cuts', cashCutsRoutes);
app.use('/api/roles', rolesRoutes);
app.use('/api/schedules', schedulesRoutes);
app.use('/api/config', configRoutes);
app.use('/api/dashboard', dashboardRoutes);

const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
