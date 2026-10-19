"""SimFire adapter: one fire request as JSON on stdin, times of arrival as JSON on stdout.

Runs inside the atalaia/simfire image (see Dockerfile), next to SimFire 2.0.1 and numpy; run.sh
starts it. The request and the result are described in ../CONTRACT.md.

SimFire spreads fire from each burning cell to its 8 neighbours with Rothermel's surface model, in
feet and minutes, for the original 13 fuel models with their 1-hour dead fuel only. On top of it,
this adapter:
- maps Scott & Burgan fuel codes to SimFire's fuel models (FUELS);
- turns the 10 m wind into SimFire's midflame wind, blowing towards a direction (midflame_ft_min);
- gives SimFire the ground upside down, because SimFire 2.0.1 has the sign of the slope backwards
  (fire_inputs);
- picks a time step short enough that the fastest fire takes several steps to cross a cell, since
  SimFire moves the fire at most one cell per step (time_steps);
- runs SimFire's spread loop on whole arrays (Spread), because SimFire's own loop is plain Python,
  one burning cell at a time. SIMFIRE_STOCK=1 runs SimFire's own loop instead (StockSpread), and
  test.sh checks that both give the same arrival times.

SimFire has a single dead fuel moisture and no crown fire, so the 10 h, 100 h and live moistures
and the canopy layers are ignored. It takes the slope from elevation_m, so slope_deg and aspect_deg
are ignored too. Its slope factor turns negative downhill and the spread rate stops at 0, so on a
steep slope with little wind the fire does not back down at all.
"""

import json
import math
import os
import sys
import time
import warnings

import numpy as np

# SimFire, pygame and matplotlib print to stdout. Keep the real stdout for the result only and send
# everything else that is printed to stderr.
RESULT = os.fdopen(os.dup(1), 'w')
os.dup2(2, 1)

with warnings.catch_warnings():
    warnings.simplefilter('ignore')  # pydantic and pkg_resources deprecation notices, on every run
    from simfire.enums import BurnStatus
    from simfire.game.managers.fire import RothermelFireManager
    from simfire.game.sprites import Fire, Terrain
    from simfire.utils.layers import FuelLayer, TopographyLayer
    from simfire.world import presets
    from simfire.world.parameters import Environment, FuelParticle
    from simfire.world.rothermel import compute_rate_of_spread

FT = 0.3048  # metres in a foot
KMH_TO_FT_MIN = 1000 / FT / 60
# The wind at 20 ft is 0.87 of the wind at 10 m (1/1.15), the usual factor between the two heights
# and the one ELMFIRE's adapter uses.
WIND_20FT_PER_10M = 0.87
# SimFire moves the fire at most one cell per step, and a cell only catches fire at the end of the
# step in which the fire got through it, which costs up to one step per cell. With this many steps
# for the fastest fire to cross a cell, that stays under a tenth of the time it takes.
STEPS_PER_CELL = 10

# Scott & Burgan fuel code -> SimFire fuel model, one of the original 13 (Anderson 1982). Taken from
# the crosswalk in Scott & Burgan 2005 (RMRS-GTR-153, pp. 12-15): of the original models it lists for
# each new one, the one with the closest spread rate, then the closest flame length, then the first.
# GR1 is in SimFire as it is. GS3 and GS4 are not in the crosswalk: they get 7, like the humid
# climate shrubs that are (SH3, SH8, SH9). Codes 91 to 99 do not burn.
FUELS = {
    91: 'NBUrban',  # NB1
    92: 'NBSnowIce',  # NB2
    93: 'NBAgriculture',  # NB3
    98: 'NBWater',  # NB8
    99: 'NBBarren',  # NB9
    101: 'ShortSparseDryClimateGrass',  # GR1
    102: 'GrassTimberShrubOverstory',  # GR2 -> 2, comparable spread rate
    103: 'TallGrass',  # GR3 -> 3
    104: 'ShortGrass',  # GR4 -> 1, slightly lower spread rate
    105: 'TallGrass',  # GR5 -> 3
    106: 'TallGrass',  # GR6 -> 3
    107: 'TallGrass',  # GR7 -> 3, comparable spread rate and slightly higher flame length
    108: 'TallGrass',  # GR8 -> 3
    109: 'TallGrass',  # GR9 -> 3
    121: 'GrassTimberShrubOverstory',  # GS1 -> 2
    122: 'Brush',  # GS2 -> 5, comparable spread rate
    123: 'SouthernRough',  # GS3 -> 7, not in the crosswalk
    124: 'SouthernRough',  # GS4 -> 7, not in the crosswalk
    141: 'Brush',  # SH1 -> 5
    142: 'Brush',  # SH2 -> 5, slightly lower flame length
    143: 'SouthernRough',  # SH3 -> 7
    144: 'SouthernRough',  # SH4 -> 7, comparable spread rate
    145: 'Chaparral',  # SH5 -> 4, slightly lower spread rate
    146: 'DormantBrushHardwoodSlash',  # SH6 -> 6
    147: 'Chaparral',  # SH7 -> 4, slightly lower flame length
    148: 'SouthernRough',  # SH8 -> 7
    149: 'SouthernRough',  # SH9 -> 7
    161: 'ClosedShortNeedleTimberLitter',  # TU1 -> 8
    162: 'TimberLitterUnderstory',  # TU2 -> 10
    163: 'TimberLitterUnderstory',  # TU3 -> 10
    164: 'TimberLitterUnderstory',  # TU4 -> 10
    165: 'TimberLitterUnderstory',  # TU5 -> 10, comparable spread rate
    181: 'ClosedShortNeedleTimberLitter',  # TL1 -> 8
    182: 'HardwoodLongNeedlePineTimber',  # TL2 -> 9
    183: 'ClosedShortNeedleTimberLitter',  # TL3 -> 8
    184: 'ClosedShortNeedleTimberLitter',  # TL4 -> 8
    185: 'LightLoggingSlash',  # TL5 -> 11, slightly lower spread rate
    186: 'HardwoodLongNeedlePineTimber',  # TL6 -> 9
    187: 'ClosedShortNeedleTimberLitter',  # TL7 -> 8
    188: 'HardwoodLongNeedlePineTimber',  # TL8 -> 9
    189: 'HardwoodLongNeedlePineTimber',  # TL9 -> 9
    201: 'LightLoggingSlash',  # SB1 -> 11, comparable spread rate
    202: 'MediumLoggingSlash',  # SB2 -> 12, comparable spread rate
    203: 'HeavyLoggingSlash',  # SB3 -> 13, higher spread rate
    204: 'HeavyLoggingSlash',  # SB4 -> 13
}
NONBURNABLE = 'NBNoData'  # the other codes from 91 to 99

# The 8 neighbours of a cell as (dx, dy), x east and y south, in the order SimFire visits them.
NEIGHBOURS = ((1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1), (1, -1))
# Inputs to compute_rate_of_spread that vary from cell to cell, all taken at the cell being reached.
CELL_INPUTS = ('w_0', 'delta', 'M_x', 'sigma', 'M_f', 'U', 'U_dir', 'slope_mag', 'slope_dir')


class Grid:
    """The request's raster grid: `rows` x `cols` square cells, row 0 along the north edge."""

    def __init__(self, g: dict):
        self.cols, self.rows = int(g['cols']), int(g['rows'])
        self.cellsize = float(g['cellsize'])
        self.xmin, self.ymin = float(g['xmin']), float(g['ymin'])

    def array(self, name: str, value) -> np.ndarray:
        """A request value as a full grid: one number for the whole grid, or one per cell."""
        a = np.asarray(value, dtype=float)
        if a.ndim == 0:
            return np.full((self.rows, self.cols), float(a))
        if a.shape != (self.rows, self.cols):
            raise ValueError(f'{name}: {a.shape[0]}x{a.shape[1]} cells, grid is {self.rows}x{self.cols}')
        return a

    def cell(self, x: float, y: float) -> int:
        """The cell a point falls in, as its index in the grid read row by row from the north."""
        col = math.floor((x - self.xmin) / self.cellsize)
        row = self.rows - 1 - math.floor((y - self.ymin) / self.cellsize)
        if not (0 <= col < self.cols and 0 <= row < self.rows):
            raise ValueError(f'ignição fora da grade: ({x}, {y})')
        return row * self.cols + col


def fuel_models(codes: np.ndarray) -> np.ndarray:
    """SimFire's Fuel for each cell, from the Scott & Burgan codes."""
    fuels = np.empty(codes.shape, dtype=object)
    for code in np.unique(codes):
        if code in FUELS:
            name = FUELS[code]
        elif 91 <= code <= 99:
            name = NONBURNABLE
        else:
            raise ValueError(f'fuel: código Scott & Burgan desconhecido: {code:g}')
        fuels[codes == code] = getattr(presets, name)
    return fuels


def midflame_ft_min(wind_kmh: np.ndarray, depth_ft: np.ndarray) -> np.ndarray:
    """SimFire's wind: at midflame height, in ft/min, from the 10 m wind in km/h.

    The wind adjustment factor from 20 ft to midflame is Albini & Baughman's (1979) for fuels not
    sheltered by a canopy, as in BehavePlus: 1.83 / ln((20 + 0.36 H) / (0.13 H)), with H the fuel bed
    depth in feet. It is 0.36 for short grass (1 ft).
    """
    waf = 1.83 / np.log((20 + 0.36 * depth_ft) / (0.13 * depth_ft))
    return wind_kmh * KMH_TO_FT_MIN * WIND_20FT_PER_10M * waf


def fire_inputs(grid: Grid, req: dict, pixel_ft: float) -> dict:
    """SimFire's inputs for every cell, as grids, in its units."""
    layers, weather = req['layers'], req['weather']
    fuels = fuel_models(grid.array('fuel', layers['fuel']))
    cells = {name: np.array([getattr(f, name) for f in fuels.flat]).reshape(fuels.shape)
             for name in ('w_0', 'delta', 'M_x', 'sigma')}
    cells['M_f'] = grid.array('dead_1h_pct', weather['dead_1h_pct']) / 100
    cells['U'] = midflame_ft_min(grid.array('wind_kmh', weather['wind_kmh']), cells['delta'])
    # SimFire's wind direction is where the wind blows to, clockwise from north.
    cells['U_dir'] = (grid.array('wind_from_deg', weather['wind_from_deg']) + 180) % 360
    # SimFire 2.0.1 slows the fire uphill and speeds it downhill, on both axes. The ground upside
    # down puts that right. Its slope is the gradient of the elevation over the cell size, so in feet.
    ground = -grid.array('elevation_m', layers.get('elevation_m', 0)) / FT
    # The same slope SimFire computes from the ground (RothermelFireManager._compute_slopes).
    grad_y, grad_x = np.gradient(ground, pixel_ft)
    cells['slope_mag'] = np.sqrt(grad_x**2 + grad_y**2)
    cells['slope_dir'] = np.arctan2(grad_y, grad_x + 0.000001)
    return {'fuels': fuels, 'ground': ground, 'cells': cells}


def rate_of_spread(x, y, new_x, new_y, cells: dict, at) -> np.ndarray:
    """SimFire's rate of spread in ft/min from (x, y) to (new_x, new_y), with the inputs of the
    cells `at`, all cast to float32 as SimFire does before it computes it."""
    particle = FuelParticle()
    n = len(at)
    f32 = lambda a: np.asarray(a, dtype=np.float32)  # noqa: E731
    p = {name: f32(cells[name].flat[at]) for name in CELL_INPUTS}
    return compute_rate_of_spread(
        f32(x), f32(y), f32(new_x), f32(new_y),
        p['w_0'], p['delta'], p['M_x'], p['sigma'],
        *(np.full(n, v, dtype=np.float32) for v in (particle.h, particle.S_T, particle.S_e, particle.p_p)),
        p['M_f'], p['U'], p['U_dir'], p['slope_mag'], p['slope_dir'],
    )


def time_steps(cells: dict, pixel_ft: float, duration: float):
    """How many SimFire steps, and their length in minutes: at most 1, and short enough that the
    fastest spread anywhere, in any of the 8 directions, takes STEPS_PER_CELL steps to cross a cell."""
    at = np.flatnonzero(cells['w_0'] > 0)
    origin = np.zeros(len(at))
    fastest = max(rate_of_spread(origin, origin, origin + dx, origin + dy, cells, at).max(initial=0)
                  for dx, dy in NEIGHBOURS)
    dt = min(1.0, pixel_ft / (STEPS_PER_CELL * fastest)) if fastest > 0 else 1.0
    steps = math.ceil(duration / dt)
    return steps, duration / steps


class Spread:
    """SimFire's RothermelFireManager.update on whole arrays instead of one burning cell at a time.

    It reaches the same cells in the same order, feeds compute_rate_of_spread the same float32
    inputs and adds up the spread in the same float64 sums, so cells catch fire at the same steps.
    Burning cells never go out, as in the adapter's use of SimFire.
    """

    def __init__(self, inputs: dict, pixel_ft: float, dt: float):
        self.cells = inputs['cells']
        self.rows, self.cols = self.cells['w_0'].shape
        self.pixel_ft, self.dt = pixel_ft, dt
        # Cells that can still catch fire. Fuel that cannot burn never does in SimFire either.
        self.open = (self.cells['w_0'] > 0).ravel()
        self.crossed = np.zeros(self.rows * self.cols)  # SimFire's burn_amounts, in feet
        # Burning cells that still have neighbours to spread to, in SimFire's order of its sprites.
        self.front = np.empty(0, dtype=np.int64)

    def ignite(self, cell: int):
        self.open[cell] = False
        self.front = np.append(self.front, cell)

    def step(self) -> np.ndarray:
        """One SimFire update. Returns the cells that caught fire, in the order SimFire adds them."""
        x, y = self.front % self.cols, self.front // self.cols
        dx, dy = np.array(NEIGHBOURS).T
        new_x, new_y = x[:, None] + dx, y[:, None] + dy
        inside = (new_x >= 0) & (new_x < self.cols) & (new_y >= 0) & (new_y < self.rows)
        to = np.where(inside, new_y * self.cols + new_x, 0)
        reach = inside & self.open[to]
        self.front = self.front[reach.any(axis=1)]
        if not len(self.front):
            return np.empty(0, dtype=np.int64)
        # One row per burning cell and neighbour, burning cell by burning cell (row-major order).
        src = np.broadcast_to(np.arange(len(x))[:, None], reach.shape)[reach]
        to = to[reach]
        rate = rate_of_spread(x[src], y[src], new_x[reach], new_y[reach], self.cells, to)
        rate *= self.dt
        # Where several burning cells reach the same cell in one step, SimFire keeps the last one.
        cells, last = np.unique(to[::-1], return_index=True)
        self.crossed[cells] += rate[len(to) - 1 - last]
        lit = cells[self.crossed[cells] > self.pixel_ft]
        self.open[lit] = False
        self.front = np.concatenate([self.front, lit])
        return lit


class StockSpread:
    """SimFire's own RothermelFireManager, with the same interface as Spread. Much slower: test.sh
    runs it on a small grid to check Spread against it."""

    def __init__(self, inputs: dict, pixel_ft: float, dt: float, steps: int):
        cells = inputs['cells']
        if np.ptp(cells['M_f']) > 0:
            raise ValueError('SIMFIRE_STOCK: o SimFire só aceita uma humidade dead_1h_pct para a grade toda')
        shape = cells['w_0'].shape
        fuel_layer, topo_layer = FuelLayer(), TopographyLayer()
        fuel_layer.data = inputs['fuels'][..., None]
        topo_layer.data = inputs['ground'][..., None]
        self.manager = RothermelFireManager(
            init_pos=(0, 0),
            fire_size=1,
            max_fire_duration=steps + 1,  # cells burn to the end, as in Spread
            pixel_scale=pixel_ft,
            update_rate=dt,
            fuel_particle=FuelParticle(),
            terrain=Terrain(fuel_layer, topo_layer, shape, headless=True),
            environment=Environment(M_f=float(cells['M_f'].flat[0]), U=cells['U'], U_dir=cells['U_dir']),
            headless=True,
        )
        # Ignitions come through ignite(), the one at init_pos too.
        self.manager.sprites, self.manager.durations = [], []
        self.fire_map = np.full(shape, BurnStatus.UNBURNED, dtype=int)
        self.cols = shape[1]

    def ignite(self, cell: int):
        y, x = divmod(cell, self.cols)
        self.manager.sprites.append(Fire((x, y), 1, headless=True))
        self.manager.durations.append(0)
        self.fire_map[y, x] = BurnStatus.BURNING

    def step(self) -> np.ndarray:
        before = self.fire_map == BurnStatus.BURNING
        self.fire_map, _ = self.manager.update(self.fire_map)
        return np.flatnonzero((self.fire_map == BurnStatus.BURNING) & ~before)


def simulate(grid: Grid, req: dict) -> np.ndarray:
    """Time of arrival in minutes for each cell, row by row from the north; NaN where the fire did
    not reach."""
    pixel_ft = grid.cellsize / FT
    inputs = fire_inputs(grid, req, pixel_ft)
    duration = float(req['duration_min'])
    if not duration > 0:
        raise ValueError(f'duration_min tem de ser positivo: {duration:g}')
    steps, dt = time_steps(inputs['cells'], pixel_ft, duration)
    if os.environ.get('SIMFIRE_STOCK'):
        fire = StockSpread(inputs, pixel_ft, dt, steps)
    else:
        fire = Spread(inputs, pixel_ft, dt)

    # Each ignition starts burning at the step nearest its time, if its fuel can burn.
    burnable = (inputs['cells']['w_0'] > 0).ravel()
    starts = {}
    for p in req['ignitions']:
        t = float(p.get('t_min', 0))
        cell = grid.cell(float(p['x']), float(p['y']))
        if 0 <= t <= duration and burnable[cell]:
            starts.setdefault(round(t / dt), []).append((cell, t))

    arrival = np.full(grid.rows * grid.cols, np.nan)
    for i in range(steps + 1):
        for cell, t in starts.get(i, []):
            if np.isnan(arrival[cell]):
                fire.ignite(cell)
                arrival[cell] = t
        if i == steps:
            break
        # A cell catches fire at the end of the step in which the fire gets through it.
        arrival[fire.step()] = (i + 1) * dt
    return arrival.reshape(grid.rows, grid.cols)


def main():
    req = json.load(sys.stdin)
    started = time.monotonic()
    grid = Grid(req['grid'])
    arrival = simulate(grid, req)

    burned = np.isfinite(arrival)
    minutes = np.round(arrival, 1)
    json.dump(
        {
            'engine': 'simfire',
            'version': os.environ.get('SIMFIRE_VERSION', ''),
            'grid': req['grid'],
            'arrival_min': [[float(v) if ok else None for v, ok in zip(row, oks)] for row, oks in zip(minutes, burned)],
            'burned_ha': round(float(burned.sum()) * grid.cellsize**2 / 1e4, 2),
            'runtime_s': round(time.monotonic() - started, 2),
        },
        RESULT,
        separators=(',', ':'),
    )
    RESULT.flush()


if __name__ == '__main__':
    main()
