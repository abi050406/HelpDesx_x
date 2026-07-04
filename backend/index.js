const express = require('express');
const ticketsRoutes = require('./routes/tickets.routes');
const authRoutes = require('./routes/auth.routes');
const technicianRoutes = require('./routes/technician.routes');
const presenceRoutes = require('./routes/presence.routes');
const adminRoutes = require('./routes/admin.routes');
const reportsRoutes = require('./routes/reports.v2.routes');
const pushRoutes = require('./routes/push.routes');
const wikiRoutes = require('./routes/wiki.routes');
const notificationsRoutes = require('./routes/notifications.routes');
const chatRoutes = require('./routes/chat.routes');
const { initializeDatabase } = require('./database');
const { connectRedis } = require('./redis');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
const { getSession } = require('./routes/auth.routes');
const { setIO } = require('./services/realtime.service');
const { touchTechnician, setTechnicianPresence, PRESENCE_KEY } = require('./services/presence.service');
const { client } = require('./redis');

const app = express();
const port = Number(process.env.PORT || 5000);
// Las credenciales VAPID se cargan desde .env al iniciar el proceso.

app.use(cors());
app.use(express.json());

// 🔐 Autenticación real contra PostgreSQL
app.use('/api/auth', authRoutes);

// 🚦 Le decimos a Express que use nuestras rutas separadas
app.use('/api/tickets', ticketsRoutes);

// 🧑‍💻 Workflow técnico: iniciar, esperar, planificar y resolver tickets
app.use('/api/technician', technicianRoutes);
app.use('/api/presence', presenceRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/push', pushRoutes);
app.use('/api/wiki', wikiRoutes);
app.use('/api/notifications', notificationsRoutes);
app.use('/api/chat', chatRoutes);

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST','PUT','DELETE'] } });
setIO(io);
io.use(async (socket, next) => {
  const session = await getSession(socket.handshake.auth?.token);
  if (!session) return next(new Error('Sesión inválida.'));
  socket.user = session.user; next();
});
io.on('connection', (socket) => {
  socket.join(`user:${socket.user.id}`); socket.join(`role:${socket.user.role}`);
  if (socket.user.role === 'tech') touchTechnician(socket.user.id).catch(() => {});
  socket.on('heartbeat', () => socket.user.role === 'tech' && touchTechnician(socket.user.id).catch(() => {}));
});

setInterval(async () => {
  const values = await client.hGetAll(PRESENCE_KEY);
  const threshold = Date.now() - 180000;
  for (const [id, raw] of Object.entries(values)) {
    const state = JSON.parse(raw);
    if (state.estado !== 'Fuera de Servicio' && new Date(state.ultima_actividad).getTime() < threshold) {
      await setTechnicianPresence(Number(id), 'Fuera de Servicio', 'Heartbeat perdido por 3 minutos');
    }
  }
}, 60000).unref();

async function start() {
  try {
    await initializeDatabase();
    await connectRedis();
    server.listen(port, () => {
      console.log(`\n==================================================`);
      console.log(`🔥 Servidor activo en: http://localhost:${port}`);
      console.log(`PostgreSQL y Redis inicializados correctamente.`);
      console.log(`==================================================\n`);
    });
  } catch (error) {
    console.error('No se pudo iniciar la infraestructura:', error);
    process.exit(1);
  }
}

start();
