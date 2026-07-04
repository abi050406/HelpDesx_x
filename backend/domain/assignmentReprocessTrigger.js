const REPROCESS_ACTIONS = new Set(['matrix_saved', 'presence_active', 'ticket_resolved', 'ticket_closed', 'admin_reassign']);

function shouldReprocessAfter(action) {
  return REPROCESS_ACTIONS.has(action);
}

module.exports = { shouldReprocessAfter };
