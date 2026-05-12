import {
  OPPOSITE, DELTAS, FEATURE_KEY, CONNECTOR_EDGE, CONNECTOR_OPPOSITE,
  CITY_TOUCH_CONNECTORS, TOTAL_MEEPLES, TILE_DEFS, START_DEF,
} from "./constants.js";
import { mulberry32, shuffleInPlace } from "./rng.js";

export function key(x, y) {
  return `${x},${y}`;
}

export function parseKey(coordKey) {
  const [x, y] = coordKey.split(",").map(Number);
  return { x, y };
}

export function rotateEdge(edge, rotation) {
  return (edge + rotation + 4) % 4;
}

export function rotateConnector(connector, rotation) {
  return (connector + rotation * 2 + 8) % 8;
}

function sortNumbers(values) {
  return [...values].sort((a, b) => a - b);
}

export function orientTile(tileDef, rotation) {
  const tileEdges = Array(4);
  tileDef.edges.forEach((edge, index) => {
    tileEdges[rotateEdge(index, rotation)] = edge;
  });

  return {
    defId: tileDef.id,
    title: tileDef.title,
    rotation,
    edges: tileEdges,
    roads: tileDef.roads.map((group) => sortNumbers(group.map((edge) => rotateEdge(edge, rotation)))),
    cities: tileDef.cities.map((group) => sortNumbers(group.map((edge) => rotateEdge(edge, rotation)))),
    fields: tileDef.fields.map((group) => sortNumbers(group.map((connector) => rotateConnector(connector, rotation)))),
    monastery: Boolean(tileDef.monastery),
    shield: Boolean(tileDef.shield),
    meeple: null,
  };
}

export function clonePlacedTile(tile) {
  return {
    ...tile,
    edges: [...tile.edges],
    roads: tile.roads.map((group) => [...group]),
    cities: tile.cities.map((group) => [...group]),
    fields: tile.fields.map((group) => [...group]),
    meeple: tile.meeple ? { ...tile.meeple } : null,
  };
}

export function createDeck(rng) {
  const deck = [];
  TILE_DEFS.forEach((tileDef) => {
    for (let i = 0; i < tileDef.count; i += 1) {
      deck.push(tileDef);
    }
  });
  return shuffleInPlace(deck, rng);
}

export function freshHeadlessState(options = {}) {
  const rng = mulberry32(options.deckSeed ?? 1);
  return {
    board: new Map([[key(0, 0), orientTile(START_DEF, 0)]]),
    deck: createDeck(rng),
    players: [
      { name: "A", score: 0, meeples: TOTAL_MEEPLES },
      { name: "B", score: 0, meeples: TOTAL_MEEPLES },
    ],
    currentPlayer: options.startingPlayer ?? 0,
    currentDef: null,
    gameOver: false,
    turns: 0,
    discardedTiles: 0,
  };
}

export function getTileAtInState(game, x, y) {
  return game.board.get(key(x, y));
}

export function canPlaceInState(game, orientedTile, x, y) {
  if (getTileAtInState(game, x, y)) return false;
  let hasNeighbor = false;

  for (let edge = 0; edge < 4; edge += 1) {
    const delta = DELTAS[edge];
    const neighbor = getTileAtInState(game, x + delta.x, y + delta.y);
    if (!neighbor) continue;
    hasNeighbor = true;
    if (orientedTile.edges[edge] !== neighbor.edges[OPPOSITE[edge]]) return false;
  }

  return hasNeighbor;
}

export function candidateEmptyCellsInState(game) {
  const cells = new Set();
  game.board.forEach((_, coordKey) => {
    const { x, y } = parseKey(coordKey);
    DELTAS.forEach((delta) => {
      const candidate = key(x + delta.x, y + delta.y);
      if (!game.board.has(candidate)) cells.add(candidate);
    });
  });
  return [...cells].map(parseKey);
}

export function validPlacementsForState(game, tileDef, rotation) {
  const oriented = orientTile(tileDef, rotation);
  return candidateEmptyCellsInState(game)
    .filter(({ x, y }) => canPlaceInState(game, oriented, x, y))
    .map(({ x, y }) => ({ x, y, rotation, tile: oriented }));
}

export function allValidPlacementsForState(game, tileDef) {
  const seen = new Set();
  const placements = [];

  for (let rotation = 0; rotation < 4; rotation += 1) {
    validPlacementsForState(game, tileDef, rotation).forEach((placement) => {
      const placementKey = `${placement.x},${placement.y},${placement.rotation}`;
      if (!seen.has(placementKey)) {
        seen.add(placementKey);
        placements.push(placement);
      }
    });
  }

  return placements;
}

export function drawPlayableTileInState(game) {
  while (game.deck.length) {
    const next = game.deck.pop();
    if (allValidPlacementsForState(game, next).length) {
      return next;
    }
    game.discardedTiles += 1;
  }
  return null;
}

export function groupIndexAtEdge(tile, type, edge) {
  const groups = tile[FEATURE_KEY[type]];
  return groups.findIndex((group) => group.includes(edge));
}

export function groupIndexAtConnector(tile, connector) {
  return tile.fields.findIndex((group) => group.includes(connector));
}

function featurePartKey(x, y, groupIndex) {
  return `${x},${y},${groupIndex}`;
}

export function getFeatureInState(game, x, y, type, groupIndex) {
  const stack = [{ x, y, groupIndex }];
  const visited = new Set();
  const parts = [];
  const tiles = new Set();
  let openEdges = 0;

  while (stack.length) {
    const part = stack.pop();
    const partKey = featurePartKey(part.x, part.y, part.groupIndex);
    if (visited.has(partKey)) continue;
    visited.add(partKey);

    const tile = getTileAtInState(game, part.x, part.y);
    if (!tile) continue;

    const groups = tile[FEATURE_KEY[type]];
    const group = groups[part.groupIndex];
    if (!group) continue;

    parts.push({ x: part.x, y: part.y, groupIndex: part.groupIndex });
    tiles.add(key(part.x, part.y));

    if (type === "field") {
      group.forEach((connector) => {
        const edge = CONNECTOR_EDGE[connector];
        const delta = DELTAS[edge];
        const neighbor = getTileAtInState(game, part.x + delta.x, part.y + delta.y);
        if (!neighbor) return;

        const oppositeConnector = CONNECTOR_OPPOSITE[connector];
        const neighborGroup = groupIndexAtConnector(neighbor, oppositeConnector);
        if (neighborGroup >= 0) {
          stack.push({ x: part.x + delta.x, y: part.y + delta.y, groupIndex: neighborGroup });
        }
      });
      continue;
    }

    group.forEach((edge) => {
      const delta = DELTAS[edge];
      const nx = part.x + delta.x;
      const ny = part.y + delta.y;
      const neighbor = getTileAtInState(game, nx, ny);

      if (!neighbor) {
        openEdges += 1;
        return;
      }

      if (neighbor.edges[OPPOSITE[edge]] !== type) {
        openEdges += 1;
        return;
      }

      const neighborGroup = groupIndexAtEdge(neighbor, type, OPPOSITE[edge]);
      if (neighborGroup >= 0) {
        stack.push({ x: nx, y: ny, groupIndex: neighborGroup });
      }
    });
  }

  return {
    type,
    parts,
    tiles,
    openEdges,
    complete: type !== "field" && openEdges === 0,
    signature: `${type}:${[...visited].sort().join("|")}`,
  };
}

export function featureMeeplesInState(game, feature, type) {
  const meeples = [];

  feature.parts.forEach((part) => {
    const tile = getTileAtInState(game, part.x, part.y);
    if (
      tile &&
      tile.meeple &&
      tile.meeple.type === type &&
      tile.meeple.groupIndex === part.groupIndex
    ) {
      meeples.push({ x: part.x, y: part.y, player: tile.meeple.player });
    }
  });

  return meeples;
}

export function removeFeatureMeeplesInState(game, feature, type) {
  feature.parts.forEach((part) => {
    const tile = getTileAtInState(game, part.x, part.y);
    if (
      tile &&
      tile.meeple &&
      tile.meeple.type === type &&
      tile.meeple.groupIndex === part.groupIndex
    ) {
      game.players[tile.meeple.player].meeples += 1;
      tile.meeple = null;
    }
  });
}

export function scoreFeatureInState(game, feature, type, complete) {
  if (type === "road") return feature.tiles.size;

  let shields = 0;
  feature.tiles.forEach((coordKey) => {
    const tile = game.board.get(coordKey);
    if (tile && tile.shield) shields += 1;
  });

  return feature.tiles.size * (complete ? 2 : 1) + shields * (complete ? 2 : 1);
}

export function majorityWinners(meeples) {
  const counts = [0, 0];
  meeples.forEach((meeple) => {
    counts[meeple.player] += 1;
  });

  const max = Math.max(...counts);
  return counts
    .map((count, player) => ({ count, player }))
    .filter((entry) => entry.count === max && entry.count > 0)
    .map((entry) => entry.player);
}

export function awardFeatureInState(game, feature, type, complete) {
  const meeples = featureMeeplesInState(game, feature, type);
  if (!meeples.length) return null;

  const winners = majorityWinners(meeples);
  const points = scoreFeatureInState(game, feature, type, complete);
  winners.forEach((player) => {
    game.players[player].score += points;
  });

  removeFeatureMeeplesInState(game, feature, type);
  return points;
}

export function monasteryScoreAtInState(game, x, y) {
  let count = 1;
  for (let dy = -1; dy <= 1; dy += 1) {
    for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      if (getTileAtInState(game, x + dx, y + dy)) count += 1;
    }
  }
  return count;
}

export function scoreCompletedMonasteriesInState(game) {
  game.board.forEach((tile, coordKey) => {
    if (!tile.monastery || !tile.meeple || tile.meeple.type !== "monastery") return;
    const { x, y } = parseKey(coordKey);
    if (monasteryScoreAtInState(game, x, y) !== 9) return;

    const player = tile.meeple.player;
    game.players[player].score += 9;
    game.players[player].meeples += 1;
    tile.meeple = null;
  });
}

export function scoreCompletedFeaturesAtInState(game, x, y) {
  const tile = getTileAtInState(game, x, y);
  if (!tile) return;

  const seen = new Set();

  ["road", "city"].forEach((type) => {
    tile[FEATURE_KEY[type]].forEach((_, groupIndex) => {
      const feature = getFeatureInState(game, x, y, type, groupIndex);
      if (seen.has(feature.signature)) return;
      seen.add(feature.signature);
      if (!feature.complete) return;
      awardFeatureInState(game, feature, type, true);
    });
  });

  scoreCompletedMonasteriesInState(game);
}

function cityFeatureForEdgeInState(game, x, y, cityIndex) {
  return getFeatureInState(game, x, y, "city", cityIndex);
}

export function fieldAdjacentCompletedCitiesInState(game, field) {
  const cities = new Map();

  field.parts.forEach((part) => {
    const tile = getTileAtInState(game, part.x, part.y);
    const connectors = tile.fields[part.groupIndex];
    if (!connectors) return;

    tile.cities.forEach((cityGroup, cityIndex) => {
      const touches = cityGroup.some((edge) =>
        CITY_TOUCH_CONNECTORS[edge].some((connector) => connectors.includes(connector)),
      );
      if (!touches) return;

      const city = cityFeatureForEdgeInState(game, part.x, part.y, cityIndex);
      if (city.complete) cities.set(city.signature, city);
    });
  });

  return cities;
}

export function scoreFinalFieldsInState(game) {
  const seen = new Set();

  game.board.forEach((tile, coordKey) => {
    const { x, y } = parseKey(coordKey);
    tile.fields.forEach((_, groupIndex) => {
      const field = getFeatureInState(game, x, y, "field", groupIndex);
      if (seen.has(field.signature)) return;
      seen.add(field.signature);

      const meeples = featureMeeplesInState(game, field, "field");
      if (!meeples.length) return;

      const completedCities = fieldAdjacentCompletedCitiesInState(game, field);
      const points = completedCities.size * 3;
      const winners = majorityWinners(meeples);

      winners.forEach((player) => {
        game.players[player].score += points;
      });
      removeFeatureMeeplesInState(game, field, "field");
    });
  });
}

export function scoreFinalFeaturesInState(game) {
  const seen = new Set();

  game.board.forEach((tile, coordKey) => {
    const { x, y } = parseKey(coordKey);

    ["road", "city"].forEach((type) => {
      tile[FEATURE_KEY[type]].forEach((_, groupIndex) => {
        const feature = getFeatureInState(game, x, y, type, groupIndex);
        if (seen.has(feature.signature)) return;
        seen.add(feature.signature);
        awardFeatureInState(game, feature, type, false);
      });
    });

    if (tile.monastery && tile.meeple && tile.meeple.type === "monastery") {
      const points = monasteryScoreAtInState(game, x, y);
      const player = tile.meeple.player;
      game.players[player].score += points;
      game.players[player].meeples += 1;
      tile.meeple = null;
    }
  });

  scoreFinalFieldsInState(game);
}

function edgeDirectionLabel(group) {
  const single = ["ao norte", "a leste", "ao sul", "a oeste"];
  const names = ["norte", "leste", "sul", "oeste"];
  if (group.length === 1) return single[group[0]];
  if (group.length === 4) return "no cruzamento";
  if (group.length === 3) return "em três saídas";
  return group.map((edge) => names[edge]).join("-");
}

function fieldDirectionLabel(connectors) {
  if (connectors.length === 8) return "aberto";
  const edgesInField = [...new Set(connectors.map((connector) => CONNECTOR_EDGE[connector]))].sort((a, b) => a - b);
  if (edgesInField.length === 1) return edgeDirectionLabel(edgesInField);
  return edgesInField.map((edge) => ["norte", "leste", "sul", "oeste"][edge]).join("-");
}

export function meepleOptionsForState(game, x, y, player) {
  const tile = getTileAtInState(game, x, y);
  if (!tile || game.players[player].meeples <= 0 || tile.meeple) return [];

  const options = [];

  tile.roads.forEach((group, groupIndex) => {
    const feature = getFeatureInState(game, x, y, "road", groupIndex);
    if (!featureMeeplesInState(game, feature, "road").length) {
      options.push({
        type: "road",
        groupIndex,
        label: `Estrada ${edgeDirectionLabel(group)}`,
        value: scoreFeatureInState(game, feature, "road", feature.complete),
        complete: feature.complete,
      });
    }
  });

  tile.cities.forEach((group, groupIndex) => {
    const feature = getFeatureInState(game, x, y, "city", groupIndex);
    if (!featureMeeplesInState(game, feature, "city").length) {
      options.push({
        type: "city",
        groupIndex,
        label: `Cidade ${edgeDirectionLabel(group)}`,
        value: scoreFeatureInState(game, feature, "city", feature.complete),
        complete: feature.complete,
      });
    }
  });

  if (tile.monastery) {
    options.push({
      type: "monastery",
      groupIndex: null,
      label: "Mosteiro",
      value: monasteryScoreAtInState(game, x, y),
      complete: monasteryScoreAtInState(game, x, y) === 9,
    });
  }

  tile.fields.forEach((group, groupIndex) => {
    const feature = getFeatureInState(game, x, y, "field", groupIndex);
    if (!featureMeeplesInState(game, feature, "field").length) {
      options.push({
        type: "field",
        groupIndex,
        label: `Campo ${groupIndex + 1} (${fieldDirectionLabel(group)})`,
        value: fieldAdjacentCompletedCitiesInState(game, feature).size * 3,
        complete: false,
        finalOnly: true,
      });
    }
  });

  return options;
}

export function placeMeepleInState(game, x, y, player, option) {
  const tile = getTileAtInState(game, x, y);
  if (!tile || tile.meeple || game.players[player].meeples <= 0) return false;

  tile.meeple = {
    player,
    type: option.type,
    groupIndex: option.groupIndex,
  };
  game.players[player].meeples -= 1;
  return true;
}

export function cloneStateForSimulation(source) {
  return {
    board: new Map(
      [...source.board.entries()].map(([coordKey, tile]) => [
        coordKey,
        clonePlacedTile(tile),
      ]),
    ),
    deck: [...source.deck],
    players: source.players.map((player) => ({ ...player })),
    currentPlayer: source.currentPlayer,
    currentDef: source.currentDef,
    gameOver: source.gameOver,
    turns: source.turns,
    discardedTiles: source.discardedTiles,
  };
}

export function applyMoveToState(game, move) {
  const tile = clonePlacedTile(move.tile);
  game.board.set(key(move.x, move.y), tile);

  if (move.meepleOption) {
    placeMeepleInState(game, move.x, move.y, move.player, move.meepleOption);
  }

  scoreCompletedFeaturesAtInState(game, move.x, move.y);
  game.currentPlayer = move.player === 0 ? 1 : 0;
  game.turns += 1;
  return game;
}

export function generateAllMoves(game, tileDef, player) {
  const moves = [];
  const placements = allValidPlacementsForState(game, tileDef);

  placements.forEach((placement) => {
    const baseMove = {
      player,
      x: placement.x,
      y: placement.y,
      rotation: placement.rotation,
      tile: clonePlacedTile(placement.tile),
      meepleOption: null,
    };
    moves.push(baseMove);

    const sim = cloneStateForSimulation(game);
    sim.board.set(key(placement.x, placement.y), clonePlacedTile(placement.tile));
    meepleOptionsForState(sim, placement.x, placement.y, player).forEach((option) => {
      moves.push({
        ...baseMove,
        tile: clonePlacedTile(placement.tile),
        meepleOption: { ...option },
      });
    });
  });

  return moves;
}
