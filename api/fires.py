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


def simard_emc(temp_c: float, rh: float) -> float:
    """Equilibrium moisture content of fine dead fuel (%), Simard (1968)."""
    t_f = temp_c * 1.8 + 32.0
    h = max(1.0, min(100.0, float(rh)))
    if h < 10.0:
        emc = 0.03229 + 0.281073 * h - 0.000578 * h * t_f
    elif h <= 50.0:
        emc = 2.22749 + 0.160107 * h - 0.014784 * t_f
    else:
        emc = 21.0606 + 0.005565 * (h ** 2) - 0.00035 * h * t_f - 0.483199 * h
    return max(1.5, min(30.0, emc))


def index() -> list[dict]:
    return json.loads((FIRES / 'index.json').read_text(encoding='utf-8'))


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
        self.meta = json.loads((self.folder / 'fire.json').read_text(encoding='utf-8'))
        self.steps = self.meta['steps']
        grid = json.loads((self.folder / 'grid.json').read_text(encoding='utf-8'))
        self.grid = {key: grid[key] for key in GRID_KEYS}
        self.rows, self.cols, self.cellsize = grid['rows'], grid['cols'], grid['cellsize']
        self.to_grid = Transformer.from_crs('EPSG:4326', grid['srs'], always_xy=True)

    def file_hashes(self) -> dict:
        return {name: hashlib.sha256((self.folder / name).read_bytes()).hexdigest() for name in FILES}

    def read(self, name: str, dtype: str) -> np.ndarray:
        """One value per cell, row 0 along the northern edge."""
        return np.fromfile(self.folder / name, dtype=dtype).reshape(self.rows, self.cols)

    def canopy_layers(self, legend: list, fuel_idx: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
        """Canopy cover (%), height (m), base height (m) and bulk density (kg/m3) for crown fire."""
        npz_paths = [
            ROOT / 'hindcast' / 'fires' / self.id / 'canopy.npz',
            self.folder / 'canopy.npz',
        ]
        for p in npz_paths:
            if p.exists():
                c = np.load(p)
                cover = c['cover_pct'].astype(np.float32)
                height = c['height_dm'].astype(np.float32) / 10.0
                base = c['base_dm'].astype(np.float32) / 10.0
                bulk = c['bulk_cg_m3'].astype(np.float32) / 100.0
                return cover, height, base, bulk

        # Physical estimation from Portuguese forest types (COS2015/2018 + DGT)
        cov_list, h_list, b_list, blk_list = [], [], [], []
        for item in legend:
            cos = str(item.get('cos', ''))
            sb = int(item.get('scottBurgan', 0))
            if sb <= 99:  # Non-burnable
                cov_list.append(0.0)
                h_list.append(0.0)
                b_list.append(0.0)
                blk_list.append(0.0)
            elif cos.startswith('5.1.2'):  # Pinhal-bravo (Pinus pinaster)
                cov_list.append(70.0)
                h_list.append(15.0)
                b_list.append(2.5)
                blk_list.append(0.14)
            elif cos in ('5.1.1.5', '5.1.1.6'):  # Eucaliptal (Eucalyptus globulus)
                cov_list.append(75.0)
                h_list.append(18.0)
                b_list.append(3.5)
                blk_list.append(0.12)
            elif cos.startswith('5.1'):  # Carvalhais (Quercus) e outras folhosas
                cov_list.append(65.0)
                h_list.append(14.0)
                b_list.append(3.0)
                blk_list.append(0.08)
            else:  # Matos, pastagens, agricultura
                cov_list.append(0.0)
                h_list.append(0.0)
                b_list.append(0.0)
                blk_list.append(0.0)

        cover = np.array(cov_list, dtype=np.float32)[fuel_idx]
        height = np.array(h_list, dtype=np.float32)[fuel_idx]
        base = np.array(b_list, dtype=np.float32)[fuel_idx]
        bulk = np.array(blk_list, dtype=np.float32)[fuel_idx]
        return cover, height, base, bulk

    def layers(self) -> dict:
        """The engines' layers: fuel, relief, and 3D canopy for crown fire."""
        legend = json.loads((self.folder / 'fuel.json').read_text(encoding='utf-8'))['legend']
        fuel_idx = self.read('fuel.u8', 'u1')
        codes = np.array([entry['scottBurgan'] for entry in legend], dtype=np.int16)
        cc, ch, cbh, cbd = self.canopy_layers(legend, fuel_idx)
        return {
            'fuel': codes[fuel_idx],
            'elevation_m': self.read('elevation.f32', '<f4'),
            'slope_deg': self.read('slope.u8', 'u1'),
            'aspect_deg': self.read('aspect.u16', '<u2'),
            'canopy_cover_pct': cc,
            'canopy_height_m': ch,
            'canopy_base_m': cbh,
            'canopy_bulk_kgm3': cbd,
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
        features = json.loads((self.folder / 'progression.geojson').read_text(encoding='utf-8'))['features']
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
        """Wind at 10 m and dynamic dead fuel moisture at each of `minutes` after `start`,
        linear between the hours of weather.json (or weather_cerra.json)."""
        cerra = self.folder / 'weather_cerra.json'
        w_file = cerra if cerra.exists() else (self.folder / 'weather.json')
        w = json.loads(w_file.read_text(encoding='utf-8'))
        hours = np.array([(parse_time(t) - start).total_seconds() / 60 for t in w['time']])
        if min(minutes) < hours[0] or max(minutes) > hours[-1]:
            first, last = (format_time(start + timedelta(minutes=float(m))) for m in (hours[0], hours[-1]))
            raise ValueError(f'a meteo deste incêndio vai de {first} a {last}')
        speed = np.interp(minutes, hours, w['windKmh'])
        # Unwound, two hours never differ by more than 180°, so the line between them is the short way.
        wind_from = np.interp(minutes, hours, np.unwrap(np.radians(w['windFromDeg'])))
        direction = np.degrees(wind_from) % 360

        # Dynamic dead fuel moisture from Simard (1968) EMC
        temp = np.interp(minutes, hours, w['tempC']) if 'tempC' in w else np.full(len(minutes), 30.0)
        rh = np.interp(minutes, hours, w['rhPct']) if 'rhPct' in w else np.full(len(minutes), 25.0)
        dead_1h = [float(round(simard_emc(t, r), 1)) for t, r in zip(temp, rh)]
        dead_10h = [float(round(max(3.0, m * 1.25), 1)) for m in dead_1h]
        dead_100h = [float(round(max(5.0, m * 1.2), 1)) for m in dead_10h]

        return [
            {
                'wind_kmh': round(float(s), 2),
                'wind_from_deg': round(float(d), 1),
                'temp_c': round(float(t), 1),
                'rh_pct': round(float(r), 1),
                'dead_1h_pct': m1,
                'dead_10h_pct': m10,
                'dead_100h_pct': m100,
            }
            for s, d, t, r, m1, m10, m100 in zip(speed, direction, temp, rh, dead_1h, dead_10h, dead_100h)
        ]
