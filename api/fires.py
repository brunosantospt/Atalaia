"""A fire's folder, web/public/fires/<id>/ (scripts/build_*.py), read in the engines' terms: the grid
and its layers, the observed perimeters, the weather at any minute, and lines drawn on the map."""

import hashlib
import json
from datetime import datetime, timedelta
from pathlib import Path

import numpy as np
import shapely
from pyproj import Transformer

ROOT = Path(__file__).resolve().parents[1]
FIRES = ROOT / 'web/public/fires'
# The keys of grid.json that make the engines' grid (engines/CONTRACT.md); the rest is for the browser.
GRID_KEYS = ('cols', 'rows', 'cellsize', 'xmin', 'ymin', 'srs')
# Everything a run reads from the folder, so a change to any of them changes the cache key.
FILES = ('fire.json', 'grid.json', 'progression.geojson', 'weather.json', 'fuel.json', 'fuel.u8',
         'elevation.f32', 'slope.u8', 'aspect.u16')
TIME = '%Y-%m-%dT%H:%M'  # local time, as in fire.json and weather.json
NONBURNABLE = 91  # Scott & Burgan NB1


def index() -> list[dict]:
    return json.loads((FIRES / 'index.json').read_text())


def parse_time(text: str) -> datetime:
    return datetime.strptime(text, TIME)


def format_time(when: datetime) -> str:
    return when.strftime(TIME)


class Fire:
    def __init__(self, fire_id: str):
        if fire_id not in {f['id'] for f in index()}:
            raise KeyError(fire_id)
        self.id = fire_id
        self.folder = FIRES / fire_id
        self.meta = json.loads((self.folder / 'fire.json').read_text())
        self.steps = self.meta['steps']
        grid = json.loads((self.folder / 'grid.json').read_text())
        self.grid = {key: grid[key] for key in GRID_KEYS}
        self.rows, self.cols, self.cellsize = grid['rows'], grid['cols'], grid['cellsize']
        self.to_grid = Transformer.from_crs('EPSG:4326', grid['srs'], always_xy=True)

    def file_hashes(self) -> dict:
        return {name: hashlib.sha256((self.folder / name).read_bytes()).hexdigest() for name in FILES}

    def read(self, name: str, dtype: str) -> np.ndarray:
        """One value per cell, row 0 along the northern edge."""
        return np.fromfile(self.folder / name, dtype=dtype).reshape(self.rows, self.cols)

    def layers(self) -> dict:
        """The engines' layers: the Scott & Burgan code of each cell's fuel, and the relief."""
        legend = json.loads((self.folder / 'fuel.json').read_text())['legend']
        codes = np.array([entry['scottBurgan'] for entry in legend], dtype=np.int16)
        return {
            'fuel': codes[self.read('fuel.u8', 'u1')],
            'elevation_m': self.read('elevation.f32', '<f4'),
            'slope_deg': self.read('slope.u8', 'u1'),
            'aspect_deg': self.read('aspect.u16', '<u2'),
        }

    def project(self, geometry):
        """A shape in longitude and latitude, in the grid's metres."""
        return shapely.transform(geometry, lambda lonlat: np.column_stack(self.to_grid.transform(*lonlat.T)))

    def point(self, lon: float, lat: float) -> tuple[float, float]:
        return self.to_grid.transform(lon, lat)

    def centres(self) -> tuple[np.ndarray, np.ndarray]:
        xs = self.grid['xmin'] + (np.arange(self.cols) + 0.5) * self.cellsize
        ys = self.grid['ymin'] + (self.rows - np.arange(self.rows) - 0.5) * self.cellsize
        return np.meshgrid(xs, ys)

    def perimeter(self, step: int) -> np.ndarray:
        """The cells whose centre is inside the perimeter observed at a step."""
        features = json.loads((self.folder / 'progression.geojson').read_text())['features']
        found = [f for f in features if f['properties'].get('kind') == 'perimeter' and f['properties']['step'] == step]
        shape = self.project(shapely.from_geojson(json.dumps(found[0]['geometry'])))
        shapely.prepare(shape)
        return shapely.contains_xy(shape, *self.centres())

    def line(self, path: list, width_m: float) -> np.ndarray:
        """The cells a line on the map touches, [[lon, lat], ...], `width_m` wide. Every cell it
        touches counts, not just those whose centre it covers, so the cells always join edge to
        edge and a fire that spreads to the 8 neighbours cannot slip through a diagonal."""
        shape = self.project(shapely.LineString(path))
        if width_m > 0:
            shape = shape.buffer(width_m / 2, cap_style='flat')
        x0, y0, x1, y1 = shape.bounds
        cell, xmin, ymin = self.cellsize, self.grid['xmin'], self.grid['ymin']
        c0, c1 = max(int((x0 - xmin) // cell), 0), min(int((x1 - xmin) // cell), self.cols - 1)
        r0, r1 = max(int((ymin + self.rows * cell - y1) // cell), 0), min(int((ymin + self.rows * cell - y0) // cell), self.rows - 1)
        touched = np.zeros((self.rows, self.cols), dtype=bool)
        if c0 > c1 or r0 > r1:
            return touched  # off the grid
        cols, rows = np.meshgrid(np.arange(c0, c1 + 1), np.arange(r0, r1 + 1))
        west, north = xmin + cols * cell, ymin + (self.rows - rows) * cell
        boxes = shapely.box(west, north - cell, west + cell, north)
        touched[rows, cols] = shapely.intersects(shape, boxes)
        return touched

    def weather(self, start: datetime, minutes: list[float]) -> list[dict]:
        """Wind at 10 m at each of `minutes` after `start`, linear between the hours of
        weather.json, the direction turning the short way round."""
        w = json.loads((self.folder / 'weather.json').read_text())
        hours = np.array([(parse_time(t) - start).total_seconds() / 60 for t in w['time']])
        if min(minutes) < hours[0] or max(minutes) > hours[-1]:
            first, last = (format_time(start + timedelta(minutes=float(m))) for m in (hours[0], hours[-1]))
            raise ValueError(f'a meteo deste incêndio vai de {first} a {last}')
        speed = np.interp(minutes, hours, w['windKmh'])
        # Unwound, two hours never differ by more than 180°, so the line between them is the short way.
        wind_from = np.interp(minutes, hours, np.unwrap(np.radians(w['windFromDeg'])))
        direction = np.degrees(wind_from) % 360
        return [{'wind_kmh': round(float(s), 2), 'wind_from_deg': round(float(d), 1)} for s, d in zip(speed, direction)]
