function netResolutionSeconds(capturedAt, resolvedAt, pauses = []) {
  if (!capturedAt || !resolvedAt) return null;
  const gross = new Date(resolvedAt).getTime() - new Date(capturedAt).getTime();
  const paused = pauses.reduce((sum, pause) => {
    const end = new Date(pause.t_pausa_fin || resolvedAt).getTime();
    return sum + Math.max(0, end - new Date(pause.t_pausa_inicio).getTime());
  }, 0);
  return Math.max(0, Math.round((gross - paused) / 1000));
}

module.exports = { netResolutionSeconds };
