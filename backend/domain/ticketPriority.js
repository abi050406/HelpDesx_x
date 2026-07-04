const CATEGORY_RULES = {
  Software: {
    slaMinutes: 60,
    tags: ['Aplicación caída', 'Error de acceso', 'Instalación', 'Rendimiento'],
    questions: { scope: [0, 2, 4], workaround: [0, 1, 3], business: [0, 2, 4] },
  },
  Hardware: {
    slaMinutes: 120,
    tags: ['Equipo no enciende', 'Impresora', 'Periférico', 'Daño físico'],
    questions: { scope: [0, 2, 4], replacement: [0, 1, 3], safety: [0, 2, 5] },
  },
  Redes: {
    slaMinutes: 45,
    tags: ['Sin Internet', 'VPN caída', 'Wi-Fi', 'Servidor inaccesible'],
    questions: { scope: [0, 3, 5], connectivity: [0, 2, 4], business: [0, 2, 4] },
  },
};

function calculatePriority(category, rawAnswers = {}) {
  const config = CATEGORY_RULES[category];
  if (!config) throw new Error('Categoría no válida.');

  const answers = {};
  let score = 0;

  for (const [questionId, allowedScores] of Object.entries(config.questions)) {
    const answer = Number(rawAnswers[questionId]);
    if (!allowedScores.includes(answer)) {
      throw new Error(`Respuesta inválida o ausente: ${questionId}.`);
    }
    answers[questionId] = answer;
    score += answer;
  }

  const priority = score >= 10 ? 'Crítica' : score >= 7 ? 'Alta' : score >= 3 ? 'Media' : 'Baja';
  return { priority, score, answers, slaMinutes: config.slaMinutes };
}

module.exports = { CATEGORY_RULES, calculatePriority };
