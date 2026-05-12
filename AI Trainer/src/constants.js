export const C = "city";
export const F = "field";
export const R = "road";

export const OPPOSITE = [2, 3, 0, 1];
export const DELTAS = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

export const FEATURE_KEY = {
  road: "roads",
  city: "cities",
  field: "fields",
};

export const CONNECTOR_EDGE = [0, 0, 1, 1, 2, 2, 3, 3];
export const CONNECTOR_OPPOSITE = [5, 4, 7, 6, 1, 0, 3, 2];
export const CITY_TOUCH_CONNECTORS = [
  [7, 2],
  [1, 4],
  [3, 6],
  [5, 0],
];

export const TOTAL_MEEPLES = 7;

function edges(code) {
  return [...code].map((char) => ({ C, F, R })[char]);
}

function def(id, title, count, code, roads, cities, fields, extra = {}) {
  return {
    id,
    title,
    count,
    edges: edges(code),
    roads,
    cities,
    fields,
    monastery: Boolean(extra.monastery),
    shield: Boolean(extra.shield),
  };
}

const ALL_FIELD = [0, 1, 2, 3, 4, 5, 6, 7];

export const TILE_DEFS = [
  def("city-complete", "Cidade fechada", 1, "CCCC", [], [[0, 1, 2, 3]], [], { shield: true }),
  def("city-three", "Cidade grande", 3, "CCCF", [], [[0, 1, 2]], [[6, 7]]),
  def("city-three-shield", "Cidade grande com brasao", 1, "CCCF", [], [[0, 1, 2]], [[6, 7]], { shield: true }),
  def("city-three-road", "Cidade grande com estrada", 1, "CCCR", [[3]], [[0, 1, 2]], [[6], [7]]),
  def("city-three-road-shield", "Cidade grande com estrada e brasao", 2, "CCCR", [[3]], [[0, 1, 2]], [[6], [7]], { shield: true }),
  def("city-corner", "Cidade curva", 3, "CCFF", [], [[0, 1]], [[4, 5, 6, 7]]),
  def("city-corner-shield", "Cidade curva com brasao", 2, "CCFF", [], [[0, 1]], [[4, 5, 6, 7]], { shield: true }),
  def("two-city-caps-adjacent", "Duas cidades vizinhas", 2, "CCFF", [], [[0], [1]], [[4, 5, 6, 7]]),
  def("city-corner-road", "Cidade curva com estrada", 3, "CCRR", [[2, 3]], [[0, 1]], [[4, 7], [5, 6]]),
  def("city-corner-road-shield", "Cidade curva com estrada e brasao", 2, "CCRR", [[2, 3]], [[0, 1]], [[4, 7], [5, 6]], { shield: true }),
  def("city-opposite-connected", "Cidade atravessando campo", 1, "CFCF", [], [[0, 2]], [[2, 3], [6, 7]]),
  def("city-opposite-connected-shield", "Cidade atravessando campo", 2, "CFCF", [], [[0, 2]], [[2, 3], [6, 7]], { shield: true }),
  def("two-city-caps-opposite", "Duas cidades opostas", 3, "CFCF", [], [[0], [2]], [[2, 3, 6, 7]]),
  def("city-cap", "Muralha", 5, "CFFF", [], [[0]], [[2, 3, 4, 5, 6, 7]]),
  def("city-road-curve-left", "Muralha e curva", 3, "CFRR", [[2, 3]], [[0]], [[2, 3, 4, 7], [5, 6]]),
  def("city-road-straight", "Muralha e estrada reta", 3, "CRFR", [[1, 3]], [[0]], [[2, 7], [3, 4, 5, 6]]),
  def("city-road-curve-right", "Muralha na curva", 3, "CRRF", [[1, 2]], [[0]], [[2, 5, 6, 7], [3, 4]]),
  def("city-road-junction", "Portao triplo", 3, "CRRR", [[1], [2], [3]], [[0]], [[2, 7], [3, 4], [5, 6]]),
  def("monastery", "Mosteiro", 4, "FFFF", [], [], [ALL_FIELD], { monastery: true }),
  def("monastery-road", "Mosteiro com estrada", 2, "FFFR", [[3]], [], [ALL_FIELD], { monastery: true }),
  def("road-curve", "Curva", 9, "FFRR", [[2, 3]], [], [[0, 1, 2, 3, 4, 7], [5, 6]]),
  def("road-straight", "Estrada reta", 8, "FRFR", [[1, 3]], [], [[0, 1, 2, 7], [3, 4, 5, 6]]),
  def("road-junction", "Encruzilhada", 4, "FRRR", [[1], [2], [3]], [], [[0, 1, 2, 7], [3, 4], [5, 6]]),
  def("road-cross", "Cruzamento", 1, "RRRR", [[0], [1], [2], [3]], [], [[0, 7], [1, 2], [3, 4], [5, 6]]),
];

export const START_DEF = def("start", "Peça inicial", 1, "CRFR", [[1, 3]], [[0]], [[2, 7], [3, 4, 5, 6]]);
