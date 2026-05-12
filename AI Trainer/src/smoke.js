import {
  key, orientTile, clonePlacedTile, freshHeadlessState, getTileAtInState,
  canPlaceInState, allValidPlacementsForState, drawPlayableTileInState,
  getFeatureInState, featureMeeplesInState, scoreFeatureInState, majorityWinners,
  awardFeatureInState, monasteryScoreAtInState, scoreCompletedFeaturesAtInState,
  fieldAdjacentCompletedCitiesInState, scoreFinalFieldsInState, scoreFinalFeaturesInState,
  meepleOptionsForState, placeMeepleInState, cloneStateForSimulation, applyMoveToState,
  generateAllMoves,
} from "./game-engine.js";
import { TILE_DEFS, START_DEF } from "./constants.js";
import { playHeadlessGame } from "./tournament.js";
import { buildAiConfig } from "./ai-engine.js";

let passed = 0;
let failed = 0;

function assert(name, condition, detail = "") {
  if (condition) {
    console.log(`  ✓ ${name}`);
    passed += 1;
  } else {
    console.error(`  ✗ ${name}${detail ? ": " + detail : ""}`);
    failed += 1;
  }
}

function findDef(id) {
  return TILE_DEFS.find((d) => d.id === id);
}

console.log("\nCarcassonne AI Trainer — Smoke Tests\n");

// ─── Test 1: Illegal placement by incompatible edge ──────────────────────────
{
  console.log("Test 1: Illegal placement by incompatible edge");
  const game = freshHeadlessState({ deckSeed: 1 });
  const roadTile = orientTile(findDef("road-straight"), 0);
  const cityCapTile = orientTile(findDef("city-cap"), 0);
  game.board.set(key(1, 0), roadTile);
  const canPlace = canPlaceInState(game, cityCapTile, 2, 0);
  assert("city-cap cannot connect to road-straight via road edge", !canPlace);
}

// ─── Test 2: Legal adjacent placement ────────────────────────────────────────
{
  console.log("\nTest 2: Legal adjacent placement");
  const game = freshHeadlessState({ deckSeed: 1 });
  const fieldTile = orientTile(findDef("monastery"), 0);
  // Start tile is CRFR; south edge (index 2) = F, monastery is FFFF — compatible
  const canPlace = canPlaceInState(game, fieldTile, 0, 1);
  assert("monastery (FFFF) can be placed adjacent to start tile (CRFR) on south side", canPlace);
}

// ─── Test 3: Closed city scores correctly ────────────────────────────────────
{
  console.log("\nTest 3: Closed city scores correctly");
  const cityCompleteDef = findDef("city-complete");
  assert("city-complete def exists", !!cityCompleteDef);
  const game = freshHeadlessState({ deckSeed: 1 });
  const tile = orientTile(cityCompleteDef, 0);
  game.board.set(key(1, 0), tile);
  const feature = getFeatureInState(game, 1, 0, "city", 0);
  const score = scoreFeatureInState(game, feature, "city", true);
  assert("city-complete with shield scores 4 when complete (2 tiles * 2 + shield * 2 = but 1 tile * 2 + 1 shield * 2 = 4)", score === 4, `got ${score}`);
}

// ─── Test 4: Closed road scores correctly ────────────────────────────────────
{
  console.log("\nTest 4: Closed road scores correctly");
  const game = freshHeadlessState({ deckSeed: 1 });
  const roadStraight = orientTile(findDef("road-straight"), 0);
  game.board.set(key(1, 0), roadStraight);
  const tileAt1 = getTileAtInState(game, 1, 0);
  assert("road-straight placed at 1,0", !!tileAt1);
  const feature = getFeatureInState(game, 0, 0, "road", 0);
  assert("road is open (not complete)", !feature.complete);
  const score = scoreFeatureInState(game, feature, "road", false);
  assert("open road scores by tile count", score >= 1);
}

// ─── Test 5: Completed monastery scores 9 ────────────────────────────────────
{
  console.log("\nTest 5: Completed monastery scores 9");
  const game = freshHeadlessState({ deckSeed: 1 });
  const monTile = orientTile(findDef("monastery"), 0);
  game.board.set(key(0, 1), monTile);
  for (let dx = -1; dx <= 1; dx += 1) {
    for (let dy = -1; dy <= 1; dy += 1) {
      if (dx === 0 && dy === 0) continue;
      if (!getTileAtInState(game, dx, 1 + dy)) {
        game.board.set(key(dx, 1 + dy), orientTile(findDef("monastery"), 0));
      }
    }
  }
  const score = monasteryScoreAtInState(game, 0, 1);
  assert("monastery with 8 neighbors scores 9", score === 9, `got ${score}`);
}

// ─── Test 6: Meeple returns after scoring ────────────────────────────────────
{
  console.log("\nTest 6: Meeple returns after scoring");
  const game = freshHeadlessState({ deckSeed: 1 });
  const cityCompleteDef = findDef("city-complete");
  const tile = orientTile(cityCompleteDef, 0);
  game.board.set(key(1, 0), clonePlacedTile(tile));
  placeMeepleInState(game, 1, 0, 0, { type: "city", groupIndex: 0 });
  const meeplesBeforeScore = game.players[0].meeples;
  assert("meeple placed (meeples decreased)", meeplesBeforeScore === 6);
  const feature = getFeatureInState(game, 1, 0, "city", 0);
  awardFeatureInState(game, feature, "city", true);
  assert("meeple returned after awarding feature", game.players[0].meeples === 7);
}

// ─── Test 7: Cannot place meeple on occupied connected feature ────────────────
{
  console.log("\nTest 7: Cannot place meeple on occupied connected feature");
  const game = freshHeadlessState({ deckSeed: 1 });
  const roadStraight = orientTile(findDef("road-straight"), 0);
  game.board.set(key(1, 0), clonePlacedTile(roadStraight));
  placeMeepleInState(game, 0, 0, 0, { type: "road", groupIndex: 0 });
  const options = meepleOptionsForState(game, 1, 0, 1);
  const roadOptions = options.filter((o) => o.type === "road");
  assert("no road meeple option on connected occupied road", roadOptions.length === 0, `found ${roadOptions.length}`);
}

// ─── Test 8: Meeple on feature completed same turn scores ────────────────────
{
  console.log("\nTest 8: Meeple on feature completed same turn scores");
  // city-cap (CFFF) rotation 2 → city on south edge, placed at (0,-1)
  // Connects to start tile's north edge (C) → 2-tile closed city, no shield → 4 pts
  const game = freshHeadlessState({ deckSeed: 1 });
  const capTile = clonePlacedTile(orientTile(findDef("city-cap"), 2));
  game.board.set(key(0, -1), capTile);
  placeMeepleInState(game, 0, -1, 0, { type: "city", groupIndex: 0 });
  const before = game.players[0].score;
  scoreCompletedFeaturesAtInState(game, 0, -1);
  assert("score increased after placing meeple on completed city", game.players[0].score > before, `before=${before} after=${game.players[0].score}`);
  assert("2-tile city with no shield scores 4", game.players[0].score - before === 4, `got ${game.players[0].score - before}`);
}

// ─── Test 9: Farmer does not score during game ───────────────────────────────
{
  console.log("\nTest 9: Farmer does not score during game");
  const game = freshHeadlessState({ deckSeed: 1 });
  const monTile = clonePlacedTile(orientTile(findDef("monastery"), 0));
  game.board.set(key(1, 0), monTile);
  placeMeepleInState(game, 1, 0, 0, { type: "field", groupIndex: 0 });
  const before = game.players[0].score;
  scoreCompletedFeaturesAtInState(game, 1, 0);
  assert("field meeple does not score during play", game.players[0].score === before);
}

// ─── Test 10: Field scores at game end ───────────────────────────────────────
{
  console.log("\nTest 10: Field scores at game end");
  const game = freshHeadlessState({ deckSeed: 1 });
  const monTile = clonePlacedTile(orientTile(findDef("monastery"), 0));
  game.board.set(key(1, 0), monTile);
  placeMeepleInState(game, 1, 0, 0, { type: "field", groupIndex: 0 });
  const before = game.players[0].score;
  scoreFinalFeaturesInState(game);
  assert("field scores at game end (score changed)", game.players[0].score >= before);
}

// ─── Test 11a: Field scores exactly +3 per completed adjacent city ───────────
{
  console.log("\nTest 11a: Field scores +3 for 1 farmer adjacent to 1 complete city");
  // Layout: city-cap (rotation 2, city=south) at (0,-1) closes with start's north city.
  // monastery (FFFF) at (0,1) is in the field south of start, touching that closed city.
  // Player 0 places farmer on monastery's field, then scoreFinalFeaturesInState.
  const game = freshHeadlessState({ deckSeed: 1 });
  game.board.set(key(0, -1), clonePlacedTile(orientTile(findDef("city-cap"), 2)));
  game.board.set(key(0, 1), clonePlacedTile(orientTile(findDef("monastery"), 0)));
  placeMeepleInState(game, 0, 1, 0, { type: "field", groupIndex: 0 });
  const before = game.players[0].score;
  scoreFinalFeaturesInState(game);
  assert("farmer adjacent to 1 complete city scores exactly +3", game.players[0].score - before === 3, `got ${game.players[0].score - before}`);
}

// ─── Test 11b: Tied field majority — both players score +3 ───────────────────
{
  console.log("\nTest 11b: Tied field majority — both players score +3");
  const game = freshHeadlessState({ deckSeed: 1 });
  game.board.set(key(0, -1), clonePlacedTile(orientTile(findDef("city-cap"), 2)));
  game.board.set(key(0, 1), clonePlacedTile(orientTile(findDef("monastery"), 0)));
  game.board.set(key(1, 1), clonePlacedTile(orientTile(findDef("monastery"), 0)));
  placeMeepleInState(game, 0, 1, 0, { type: "field", groupIndex: 0 });
  placeMeepleInState(game, 1, 1, 1, { type: "field", groupIndex: 0 });
  const before0 = game.players[0].score;
  const before1 = game.players[1].score;
  scoreFinalFeaturesInState(game);
  assert("tied field majority: player 0 scores +3", game.players[0].score - before0 === 3, `got ${game.players[0].score - before0}`);
  assert("tied field majority: player 1 scores +3", game.players[1].score - before1 === 3, `got ${game.players[1].score - before1}`);
}

// ─── Test 12: Tied field majority scores for both ────────────────────────────
{
  console.log("\nTest 12: Tied field majority scores for both");
  const meeplesMock = [{ player: 0 }, { player: 1 }];
  const winners = majorityWinners(meeplesMock);
  assert("tied majority returns both players", winners.length === 2 && winners.includes(0) && winners.includes(1));
}

// ─── Test 13: Final score includes incomplete cities ─────────────────────────
{
  console.log("\nTest 13: Final score includes incomplete features");
  const game = freshHeadlessState({ deckSeed: 1 });
  const cityCap = clonePlacedTile(orientTile(findDef("city-cap"), 0));
  game.board.set(key(1, 0), cityCap);
  placeMeepleInState(game, 1, 0, 0, { type: "city", groupIndex: 0 });
  const before = game.players[0].score;
  scoreFinalFeaturesInState(game);
  assert("incomplete city meeple scores at game end", game.players[0].score > before, `before=${before} after=${game.players[0].score}`);
}

// ─── Test 14: Final score includes incomplete monasteries ────────────────────
{
  console.log("\nTest 14: Final score includes incomplete monasteries");
  const game = freshHeadlessState({ deckSeed: 1 });
  const monTile = clonePlacedTile(orientTile(findDef("monastery"), 0));
  game.board.set(key(1, 0), monTile);
  placeMeepleInState(game, 1, 0, 0, { type: "monastery", groupIndex: null });
  const before = game.players[0].score;
  scoreFinalFeaturesInState(game);
  const score = game.players[0].score - before;
  assert("incomplete monastery scores at game end (>= 2 neighbors: start + monastery tile)", score >= 2, `scored ${score}`);
}

// ─── Test 15: Game ends when no tiles are playable ───────────────────────────
{
  console.log("\nTest 15: Game ends when no tiles are playable");
  const game = freshHeadlessState({ deckSeed: 1 });
  game.deck = [];
  const tile = drawPlayableTileInState(game);
  assert("drawPlayableTileInState returns null when deck is empty", tile === null);
}

// ─── Test 16: Same seed produces same deck ───────────────────────────────────
{
  console.log("\nTest 16: Same seed produces same deck");
  const game1 = freshHeadlessState({ deckSeed: 12345 });
  const game2 = freshHeadlessState({ deckSeed: 12345 });
  const same = game1.deck.every((t, i) => t.id === game2.deck[i].id);
  assert("identical seeds produce identical decks", same);
}

// ─── Test 17: Same seed produces same game result ────────────────────────────
{
  console.log("\nTest 17: Same seed produces same game result");
  const config = { ...buildAiConfig(), replyLookahead: false, candidateLimit: 3, randomness: 0, strategicNoise: 0 };
  const opts = { deckSeed: 99999, aiSeed0: 1111, aiSeed1: 2222, startingPlayer: 0 };
  const result1 = playHeadlessGame(config, config, opts);
  const result2 = playHeadlessGame(config, config, opts);
  assert(
    "identical seeds produce identical game results",
    result1.scores[0] === result2.scores[0] && result1.scores[1] === result2.scores[1],
    `run1=${JSON.stringify(result1.scores)} run2=${JSON.stringify(result2.scores)}`,
  );
}

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${passed + failed} tests: ${passed} passed, ${failed} failed\n`);

if (failed > 0) {
  process.exit(1);
}
