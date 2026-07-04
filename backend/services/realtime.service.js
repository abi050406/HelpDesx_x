let io;

function setIO(instance) { io = instance; }
function getIO() { return io; }
function emitToUser(userId, event, payload) { io?.to(`user:${userId}`).emit(event, payload); }
function emitToRole(role, event, payload) { io?.to(`role:${role}`).emit(event, payload); }
function emitAll(event, payload) { io?.emit(event, payload); }

module.exports = { setIO, getIO, emitToUser, emitToRole, emitAll };
