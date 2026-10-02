export function normalizeShortAnswer(value, config = {}) {
  let normalized = String(value ?? '');
  if (config.normalizeUnicode !== false && normalized.normalize) normalized = normalized.normalize('NFC');
  if (config.trimWhitespace !== false) normalized = normalized.trim();
  if (!config.caseSensitive) normalized = normalized.toLowerCase();
  return normalized;
}

function responseMap(response) {
  return response && typeof response === 'object' && !Array.isArray(response) ? { ...response } : {};
}

export function assignMatchingPair(response, leftId, rightId) {
  const next = responseMap(response);
  if (!leftId) return next;
  if (!rightId) {
    delete next[leftId];
    return next;
  }
  for (const [otherLeftId, assignedRightId] of Object.entries(next)) {
    if (otherLeftId !== leftId && assignedRightId === rightId) delete next[otherLeftId];
  }
  next[leftId] = rightId;
  return next;
}

export function assignDragDropToken(response, tokenId, targetId) {
  const next = responseMap(response);
  if (!tokenId) return next;
  if (targetId) next[tokenId] = targetId;
  else delete next[tokenId];
  return next;
}

export function gradeQuestionResponse(question, response) {
  const config = question?.answerConfig || {};
  if (question?.type === 'SINGLE_CHOICE') return response != null && response === (config.correctIds || [])[0];
  if (question?.type === 'MULTIPLE_CHOICE') {
    const given = new Set(Array.isArray(response) ? response : []);
    const correct = new Set(config.correctIds || []);
    return given.size === correct.size && [...given].every(id => correct.has(id));
  }
  if (question?.type === 'TRUE_FALSE') return typeof response === 'boolean' && response === config.correctAnswer;
  if (question?.type === 'SHORT_ANSWER') {
    const given = normalizeShortAnswer(response, config);
    return given.length > 0 && (config.acceptedAnswers || []).some(answer => normalizeShortAnswer(answer, config) === given);
  }
  if (question?.type === 'ORDERING') {
    const expected = config.correctOrder || (config.items || []).map(item => item.id);
    return Array.isArray(response) && response.length === expected.length && response.every((id, index) => id === expected[index]);
  }
  if (question?.type === 'MATCHING') {
    return !!response && typeof response === 'object' && !Array.isArray(response)
      && (config.pairs || []).every(pair => response[pair.leftId] === pair.rightId);
  }
  if (question?.type === 'DRAG_DROP') {
    return !!response && typeof response === 'object' && !Array.isArray(response)
      && (config.tokens || []).every(token => token.targetId
        ? response[token.id] === token.targetId
        : response[token.id] == null || response[token.id] === '');
  }
  return false;
}
