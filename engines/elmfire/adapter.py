"""ELMFIRE adapter: one fire request as JSON on stdin, times of arrival as JSON on stdout.

Runs inside the atalaia/elmfire image (see Dockerfile), next to ELMFIRE, GDAL and numpy; run.sh
starts it. The request and the result are described in ../CONTRACT.md. ELMFIRE's own log only
comes out, on stderr, when a run fails, so stdout carries nothing but the result.
"""

import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import numpy as np
from osgeo import gdal, osr

gdal.UseExceptions()

NODATA = -9999

# ELMFIRE reads the wind at 20 ft in mph; forecasts give it at 10 m in km/h. This is the factor
# ELMFIRE itself uses between the two (1.609 km/h per mph, and the 20 ft wind is 0.87 of the 10 m one).
KMH_10M_PER_MPH_20FT = 1.609 / 0.87

# Request layer -> ELMFIRE raster and the factor to its units. All are 16-bit integers.
LAYERS = {
    'fuel': ('fbfm40', 1),  # Scott & Burgan fuel model code, e.g. 102 = GR2
    'elevation_m': ('dem', 1),
    'slope_deg': ('slp', 1),
    'aspect_deg': ('asp', 1),
    'canopy_cover_pct': ('cc', 1),
    'canopy_height_m': ('ch', 10),  # tenths of a metre
    'canopy_base_m': ('cbh', 10),  # tenths of a metre
    'canopy_bulk_kgm3': ('cbd', 100),  # hundredths of kg/m3
}
# Request weather field -> ELMFIRE raster and the factor to its units. All are 32-bit floats, with
# one band per weather time.
WEATHER = {
    'wind_kmh': ('ws', 1 / KMH_10M_PER_MPH_20FT),
    'wind_from_deg': ('wd', 1),
    'dead_1h_pct': ('m1', 1),
    'dead_10h_pct': ('m10', 1),
    'dead_100h_pct': ('m100', 1),
    'live_herb_pct': ('mlh', 1),
    'live_woody_pct': ('mlw', 1),
}
# Bare ground and no canopy unless the request says otherwise; fuel and weather have no default.
LAYER_DEFAULTS = {name: 0 for name in LAYERS if name != 'fuel'}


class Grid:
    """The request's raster grid: `rows` x `cols` square cells, row 0 along the north edge."""

    def __init__(self, g: dict):
        self.cols, self.rows = int(g['cols']), int(g['rows'])
        self.cellsize = float(g['cellsize'])
        self.xmin, self.ymin = float(g['xmin']), float(g['ymin'])
        self.srs = g['srs']
        ymax = self.ymin + self.rows * self.cellsize
        self.transform = (self.xmin, self.cellsize, 0.0, ymax, 0.0, -self.cellsize)
        ref = osr.SpatialReference()
        ref.SetFromUserInput(self.srs)
        self.wkt = ref.ExportToWkt()

    def array(self, name: str, value) -> np.ndarray:
        """A request value as a full grid: one number for the whole grid, or one per cell."""
        a = np.asarray(value, dtype=float)
        if a.ndim == 0:
            return np.full((self.rows, self.cols), float(a))
        if a.shape != (self.rows, self.cols):
            raise ValueError(f'{name}: {a.shape[0]}x{a.shape[1]} cells, grid is {self.rows}x{self.cols}')
        return a

    def write(self, path: Path, array: np.ndarray, dtype: int):
        """One band per grid in `array`, which is a grid or a stack of them."""
        bands = array if array.ndim == 3 else array[None]
        ds = gdal.GetDriverByName('GTiff').Create(str(path), self.cols, self.rows, len(bands), dtype)
        ds.SetGeoTransform(self.transform)
        ds.SetProjection(self.wkt)
        for i, values in enumerate(bands, 1):
            band = ds.GetRasterBand(i)
            band.SetNoDataValue(NODATA)
            band.WriteArray(values)
        ds = None  # closing the dataset writes it


def weather_times(req: dict) -> tuple[list[dict], float | None]:
    """The request's weather as a list of times, and the minutes between them (None for one)."""
    weather = req['weather']
    if isinstance(weather, dict):
        return [weather], None
    if not weather:
        raise ValueError('weather: a lista está vazia')
    times = [float(w['t_min']) for w in weather]
    every = times[1] - times[0] if len(times) > 1 else None
    if times[0] != 0 or (every is not None and not (every > 0 and np.allclose(times, np.arange(len(times)) * every))):
        raise ValueError(f'weather: os t_min têm de começar em 0 e ir de igual em igual: {times}')
    return weather, every


def wind_from_bands(wind_from: np.ndarray) -> np.ndarray:
    """The wind directions to write, one band per weather time, so that ELMFIRE turns the wind the
    short way round between two times.

    ELMFIRE interpolates the direction the wind blows to (wind_from + 180) linearly, and only brings
    it back into 0..360 when it is above 360 (INTERP_WD_RASTER in elmfire_subs.f90). From a wind from
    170° to one from 190°, it would turn the wind through north. Here each cell's directions are
    unwound, so that two times never differ by more than 180°, and shifted by whole turns until none
    blows to more than 360°: ELMFIRE then folds none of them, and only takes sines and cosines of
    what it interpolates.
    """
    to = np.unwrap((wind_from + 180) % 360, period=360, axis=0)
    to -= 360 * np.maximum(np.ceil((to.max(axis=0) - 360) / 360), 0)
    return to - 180


def burned_at_start(grid: Grid, req: dict) -> np.ndarray:
    return grid.array('burned', req.get('burned', 0)) > 0


def write_inputs(folder: Path, grid: Grid, req: dict):
    layers = {**LAYER_DEFAULTS, **req['layers']}
    for name, (raster, scale) in LAYERS.items():
        grid.write(folder / f'{raster}.tif', np.rint(grid.array(name, layers[name]) * scale), gdal.GDT_Int16)
    weather, _ = weather_times(req)
    for name, (raster, scale) in WEATHER.items():
        bands = np.stack([grid.array(name, w[name]) for w in weather]) * scale
        if name == 'wind_from_deg':
            bands = wind_from_bands(bands)
        grid.write(folder / f'{raster}.tif', bands, gdal.GDT_Float32)
    # No spread rate adjustment.
    grid.write(folder / 'adj.tif', grid.array('adj', 1.0), gdal.GDT_Float32)
    # phi <= 0 is burned at the start, with a time of arrival of 0; phi > 0 is not burned.
    grid.write(folder / 'phi.tif', np.where(burned_at_start(grid, req), -1.0, 1.0), gdal.GDT_Float32)


def namelist(grid: Grid, req: dict) -> str:
    tstop = float(req['duration_min']) * 60
    weather, every = weather_times(req)
    ignitions = req.get('ignitions', [])
    files = {raster: raster for raster, _ in [*LAYERS.values(), *WEATHER.values()]}
    files.update(adj='adj', phi='phi')
    names = {'fbfm40': 'FBFM', 'dem': 'DEM', 'slp': 'SLP', 'asp': 'ASP', 'cc': 'CC', 'ch': 'CH', 'cbh': 'CBH',
             'cbd': 'CBD', 'ws': 'WS', 'wd': 'WD', 'm1': 'M1', 'm10': 'M10', 'm100': 'M100', 'mlh': 'MLH',
             'mlw': 'MLW', 'adj': 'ADJ', 'phi': 'PHI'}
    lines = [
        '&INPUTS',
        "FUELS_AND_TOPOGRAPHY_DIRECTORY = './inputs'",
        "WEATHER_DIRECTORY = './inputs'",
        *[f"{names[r]}_FILENAME = '{f}'" for r, f in files.items()],
        # One band per weather time; ELMFIRE interpolates between them and holds the last one.
        f'DT_METEOROLOGY = {every * 60 if every else tstop}',
        # Live moistures from their rasters (in %), like the dead ones, rather than one constant.
        'USE_CONSTANT_LH = .FALSE.',
        'USE_CONSTANT_LW = .FALSE.',
        '/',
        '&OUTPUTS',
        "OUTPUTS_DIRECTORY = './outputs'",
        # A single dump at the end: the time of arrival is only written with the last one.
        f'DTDUMP = {tstop}',
        'DUMP_TIME_OF_ARRIVAL = .TRUE.',
        'CONVERT_TO_GEOTIFF = .FALSE.',
        '/',
        '&COMPUTATIONAL_DOMAIN',
        f"A_SRS = '{grid.srs}'",
        f'COMPUTATIONAL_DOMAIN_CELLSIZE = {grid.cellsize}',
        f'COMPUTATIONAL_DOMAIN_XLLCORNER = {grid.xmin}',
        f'COMPUTATIONAL_DOMAIN_YLLCORNER = {grid.ymin}',
        '/',
        '&TIME_CONTROL',
        'SIMULATION_DT = 30.0',
        f'SIMULATION_TSTOP = {tstop}',
        '/',
        '&SIMULATOR',
        # Anderson's length-to-breadth ratio takes the midflame wind in mph (ft/min * 60/5280), as in
        # FARSITE and ELMFIRE's tutorials; ELMFIRE's default feeds it m/s and draws much wider fires.
        f'WSMFEFF_LOW_MULT = {60 / 5280}',
        f'NUM_IGNITIONS = {len(ignitions)}',
        *[
            f"X_IGN({i}) = {float(p['x'])}\nY_IGN({i}) = {float(p['y'])}\nT_IGN({i}) = {float(p.get('t_min', 0)) * 60}"
            for i, p in enumerate(ignitions, 1)
        ],
        '/',
        '&MONTE_CARLO',
        f'NUM_METEOROLOGY_TIMES = {len(weather)}',
        '/',
        '&MISCELLANEOUS',
        "PATH_TO_GDAL = '/usr/bin'",
        "SCRATCH = './scratch'",
        '/',
    ]
    return '\n'.join(lines) + '\n'


def read_arrival(folder: Path, grid: Grid, tstop: float) -> np.ndarray:
    """Time of arrival in seconds, NaN where the fire did not reach by tstop. ELMFIRE's last time
    step can end a little after tstop, and the cells it reaches then are left out."""
    found = sorted(folder.glob('time_of_arrival_*.bil'))
    if not found:
        raise RuntimeError('ELMFIRE não escreveu o tempo de chegada')
    ds = gdal.Open(str(found[-1]))
    if (ds.RasterYSize, ds.RasterXSize) != (grid.rows, grid.cols):
        raise RuntimeError(f'tempo de chegada com {ds.RasterYSize}x{ds.RasterXSize} células')
    toa = ds.GetRasterBand(1).ReadAsArray().astype(float)
    toa[(toa < 0) | (toa > tstop)] = np.nan
    return toa


def main():
    req = json.load(sys.stdin)
    started = time.monotonic()
    grid = Grid(req['grid'])
    with tempfile.TemporaryDirectory(prefix='elmfire-') as tmp:
        case = Path(tmp)
        for sub in ('inputs', 'outputs', 'scratch'):
            (case / sub).mkdir()
        write_inputs(case / 'inputs', grid, req)
        (case / 'inputs' / 'elmfire.data').write_text(namelist(grid, req))
        run = subprocess.run(['elmfire', './inputs/elmfire.data'], cwd=case, capture_output=True, text=True)
        try:
            if run.returncode != 0:
                raise RuntimeError(f'ELMFIRE saiu com código {run.returncode}')
            toa = read_arrival(case / 'outputs', grid, float(req['duration_min']) * 60)
        except RuntimeError:
            sys.stderr.write('\n'.join((run.stdout + run.stderr).splitlines()[-40:]) + '\n')
            raise

    burned = np.isfinite(toa)
    minutes = np.round(toa / 60, 1)
    json.dump(
        {
            'engine': 'elmfire',
            'version': os.environ.get('ELMFIRE_VERSION', ''),
            'grid': req['grid'],
            'arrival_min': [[float(v) if ok else None for v, ok in zip(row, oks)] for row, oks in zip(minutes, burned)],
            'burned_ha': round(float(burned.sum()) * grid.cellsize**2 / 1e4, 2),
            'runtime_s': round(time.monotonic() - started, 2),
        },
        sys.stdout,
        separators=(',', ':'),
    )


if __name__ == '__main__':
    main()
