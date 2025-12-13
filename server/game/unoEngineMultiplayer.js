// ====== Configuración de cartas ======

const COLORS = ['red', 'green', 'blue', 'yellow'];
const VALUES = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];

// Especiales con color
const SPECIAL_COLOR_VALUES = ['skip', '+2', 'reverse'];

// Especiales sin color (comodines)
const COLORLESS_VALUES = ['wild', '+4']; // wild = cambio de color, +4 = roba cuatro

const ACTION_TYPES = {
  PLAY_CARD: 'PLAY_CARD',
  DRAW_CARD: 'DRAW_CARD',
  CALL_UNO: 'CALL_UNO',
};

// ====== Utilidades de cartas/mazo ======

function createCard(color, value) {
  return {
    id: `${color}-${value}-${Math.random().toString(36).slice(2)}`,
    color, // 'red' | 'green' | 'blue' | 'yellow' | 'wild'
    value, // '0'-'9', 'skip', '+2', 'reverse', 'wild', '+4'
  };
}

function createDeck() {
  const deck = [];

  // Cartas numéricas + especiales con color
  for (const color of COLORS) {
    // números: 1x 0, 2x 1..9
    for (const v of VALUES) {
      deck.push(createCard(color, v));
      if (v !== '0') deck.push(createCard(color, v));
    }
    // especiales de color: 2 de cada
    for (const sv of SPECIAL_COLOR_VALUES) {
      deck.push(createCard(color, sv));
      deck.push(createCard(color, sv));
    }
  }

  // Comodines sin color: 4 wild y 4 +4
  for (const cv of COLORLESS_VALUES) {
    for (let i = 0; i < 4; i++) {
      deck.push(createCard('wild', cv));
    }
  }

  return shuffle(deck);
}

function shuffle(array) {
  const a = [...array];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ====== Reglas básicas ======

function canPlayCard(card, topCard) {
  if (!card || !topCard) return false;
  // comodines (wild y +4) siempre se pueden jugar
  if (card.color === 'wild') return true;
  // resto: coincide color o valor
  return card.color === topCard.color || card.value === topCard.value;
}

// ====== Estado inicial ======

function createInitialState({ numPlayers = 2, names = [] } = {}) {
  if (numPlayers < 2) {
    throw new Error('UNO necesita al menos 2 jugadores.');
  }

  let deck = createDeck();

  const players = [];
  const CARDS_PER_PLAYER = 7;

  for (let i = 0; i < numPlayers; i++) {
    const hand = deck.slice(i * CARDS_PER_PLAYER, (i + 1) * CARDS_PER_PLAYER);
    players.push({
      id: i,
      name: names[i] ?? `Jugador ${i + 1}`,
      hand,
      hasCalledUno: false,
    });
  }

  let drawPile = deck.slice(numPlayers * CARDS_PER_PLAYER);

  // Primera carta en mesa: intentamos que no sea comodín
  let firstCard = drawPile.shift();
  let safety = 0;
  while (
    firstCard.color === 'wild' &&
    drawPile.length > 0 &&
    safety < 10
  ) {
    drawPile.push(firstCard);
    firstCard = drawPile.shift();
    safety++;
  }

  const discardPile = [firstCard];

  return {
    players,
    drawPile,
    discardPile,
    currentPlayerIndex: 0,
    direction: 1,
    status: 'playing', // 'playing' | 'finished'
    winnerIndex: null,
    lastAction: null,
  };
}

// ====== Utilidades de estado ======

function cloneState(state) {
  return {
    ...state,
    players: state.players.map((p) => ({
      ...p,
      hand: [...p.hand],
    })),
    drawPile: [...state.drawPile],
    discardPile: [...state.discardPile],
    lastAction: state.lastAction ? { ...state.lastAction } : null,
  };
}

function getTopCard(state) {
  return state.discardPile[state.discardPile.length - 1] ?? null;
}

function getNextPlayerIndex(state, fromIndex = state.currentPlayerIndex, steps = 1) {
  const n = state.players.length;
  let idx = fromIndex;
  for (let i = 0; i < steps; i++) {
    idx = (idx + state.direction + n) % n;
  }
  return idx;
}

// ====== Acciones ======

function applyAction(state, action) {
  if (state.status !== 'playing') {
    return state;
  }

  switch (action.type) {
    case ACTION_TYPES.PLAY_CARD:
      return applyPlayCard(state, action);
    case ACTION_TYPES.DRAW_CARD:
      return applyDrawCard(state, action);
    case ACTION_TYPES.CALL_UNO:
      return applyCallUno(state, action);
    default:
      throw new Error(`Acción desconocida: ${action.type}`);
  }
}

// --- PLAY_CARD ---

function applyPlayCard(state, action) {
  const { playerIndex, cardId, chosenColor } = action;
  if (playerIndex !== state.currentPlayerIndex) {
    return state;
  }

  const s = cloneState(state);
  const player = s.players[playerIndex];
  const top = getTopCard(s);

  const cardIdx = player.hand.findIndex((c) => c.id === cardId);
  if (cardIdx === -1) return state;

  const card = player.hand[cardIdx];

  if (!canPlayCard(card, top)) return state;

  const isWildType = card.color === 'wild'; // wild o +4
  if (isWildType && !chosenColor) {
    // si es comodín, necesitamos color elegido
    return state;
  }

  // carta que va a la pila de descarte (comodines cambian el color visible)
  const cardForDiscard = isWildType
    ? { ...card, color: chosenColor }
    : card;

  // quitar de la mano y descartar
  player.hand.splice(cardIdx, 1);
  s.discardPile.push(cardForDiscard);

  // reset de UNO si ya no tiene 1 carta
  if (player.hand.length !== 1) {
    player.hasCalledUno = false;
  }

  s.lastAction = {
    type: ACTION_TYPES.PLAY_CARD,
    playerIndex,
    card: cardForDiscard,
  };

  // ¿ha ganado?
  if (player.hand.length === 0) {
    s.status = 'finished';
    s.winnerIndex = playerIndex;
    return s;
  }

  // Efectos especiales según valor
  if (card.value === '+2') {
    const victimIndex = getNextPlayerIndex(s, playerIndex, 1);
    const victim = s.players[victimIndex];
    for (let i = 0; i < 2 && s.drawPile.length > 0; i++) {
      victim.hand.push(s.drawPile.shift());
    }
    s.currentPlayerIndex = getNextPlayerIndex(s, victimIndex, 1);
  } else if (card.value === 'skip') {
    s.currentPlayerIndex = getNextPlayerIndex(s, playerIndex, 2);
  } else if (card.value === 'reverse') {
    s.direction = -s.direction;
    s.currentPlayerIndex = getNextPlayerIndex(s, playerIndex, 1);
  } else if (card.value === '+4') {
    const victimIndex = getNextPlayerIndex(s, playerIndex, 1);
    const victim = s.players[victimIndex];
    for (let i = 0; i < 4 && s.drawPile.length > 0; i++) {
      victim.hand.push(s.drawPile.shift());
    }
    s.currentPlayerIndex = getNextPlayerIndex(s, victimIndex, 1);
  } else if (card.value === 'wild') {
    s.currentPlayerIndex = getNextPlayerIndex(s, playerIndex, 1);
  } else {
    // carta normal
    s.currentPlayerIndex = getNextPlayerIndex(s, playerIndex, 1);
  }

  return s;
}

// --- DRAW_CARD ---

function applyDrawCard(state, action) {
  const { playerIndex } = action;
  if (playerIndex !== state.currentPlayerIndex) {
    return state;
  }

  const s = cloneState(state);
  const player = s.players[playerIndex];

  if (s.drawPile.length === 0) {
    s.lastAction = {
      type: ACTION_TYPES.DRAW_CARD,
      playerIndex,
      card: null,
    };
    return s;
  }

  const card = s.drawPile.shift();
  player.hand.push(card);

  s.lastAction = {
    type: ACTION_TYPES.DRAW_CARD,
    playerIndex,
    card,
  };

  return s;
}

// --- CALL_UNO ---

function applyCallUno(state, action) {
  const { playerIndex } = action;
  const s = cloneState(state);
  const player = s.players[playerIndex];

  if (player.hand.length === 1) {
    player.hasCalledUno = true;
  }

  s.lastAction = {
    type: ACTION_TYPES.CALL_UNO,
    playerIndex,
  };

  return s;
}

// ====== Helpers para UI / IA ======

function getPlayableCards(state, playerIndex) {
  if (playerIndex !== state.currentPlayerIndex) return [];
  const player = state.players[playerIndex];
  const top = getTopCard(state);
  return player.hand.filter((c) => canPlayCard(c, top));
}

function getTurnInfo(state) {
  module.exports = {
    COLORS,
    VALUES,
    ACTION_TYPES,
    canPlayCard,
    createInitialState,
    getTopCard,
    getNextPlayerIndex,
    applyAction,
    getPlayableCards,
    getTurnInfo,
  };
  const playerIndex = state.currentPlayerIndex;
  const player = state.players[playerIndex];
  const playableCards = getPlayableCards(state, playerIndex);

  return {
    playerIndex,
    player,
    playableCards,
    canDraw: state.drawPile.length > 0,
    mustCallUno: player.hand.length === 1 && !player.hasCalledUno,
  };
}
