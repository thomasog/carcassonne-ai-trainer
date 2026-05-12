export function mulberry32(seed) {
  let s = seed >>> 0;

  return function random() {
    s += 0x6D2B79F5;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomInt(rng, maxExclusive) {
  return Math.floor(rng() * maxExclusive);
}

export function randomFloat(rng, min, max) {
  return min + rng() * (max - min);
}

export function randomChoice(rng, array) {
  return array[randomInt(rng, array.length)];
}

export function shuffleInPlace(array, rng) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = randomInt(rng, i + 1);
    [array[i], array[j]] = [array[j], array[i]];
  }

  return array;
}

export function hashSeed(...parts) {
  const text = parts.join(":");
  let h = 2166136261;

  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }

  return h >>> 0;
}
