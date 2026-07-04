const ASSIGNMENT_REASONS = Object.freeze({
  NO_ASSIGNMENT_RULE: 'NO_ASSIGNMENT_RULE',
  NO_ACTIVE_PRESENCE: 'NO_ACTIVE_PRESENCE',
  NO_ELIGIBLE_TECHNICIAN: 'NO_ELIGIBLE_TECHNICIAN',
});

function assignmentReason({ ruleCount = 0, activePresenceCount = 0, eligibleCount = 0 }) {
  if (Number(ruleCount) === 0) return ASSIGNMENT_REASONS.NO_ASSIGNMENT_RULE;
  if (Number(activePresenceCount) === 0) return ASSIGNMENT_REASONS.NO_ACTIVE_PRESENCE;
  if (Number(eligibleCount) === 0) return ASSIGNMENT_REASONS.NO_ELIGIBLE_TECHNICIAN;
  return null;
}

module.exports = { ASSIGNMENT_REASONS, assignmentReason };
