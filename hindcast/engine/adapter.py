"""The ELMFIRE adapter of engines/elmfire/adapter.py (mounted as atalaia_adapter.py), with four
optional request fields it does not have yet. A request without them runs exactly as through engines/elmfire/run.sh.

  "fuel_models": rows added to ELMFIRE's fuel model table (fuel_models.csv), in ELMFIRE's own columns and units:
                 [code, name, dynamic, w0_1h, w0_10h, w0_100h, w0_live_herb, w0_live_woody (lb/ft2),
                  sav_1h, sav_live_herb, sav_live_woody (1/ft), depth (ft), dead moisture of extinction (%), heat (BTU/lb)]
                 Codes 1-303 that are not in the standard table (e.g. 211-237), so the fuel layer can use them.
  "layers": {"adj": ...}   ELMFIRE's spread rate adjustment factor, one number or a grid (Atalaia writes 1 everywhere).
  "spotting": {...}         ELMFIRE &SPOTTING settings (name -> value), e.g. {"ENABLE_SPOTTING": true, ...}.
  "seed": n                 the random seed ELMFIRE's spotting draws from (&MONTE_CARLO SEED).

Runs inside the atalaia/elmfire image, like the original; run.sh mounts both files.
"""

import sys
from pathlib import Path

from osgeo import gdal

sys.path.insert(0, '/engine')
import atalaia_adapter as base  # noqa: E402

DEFAULT_TABLE = Path('/engine/fuel_models_default.csv')


def fortran(v) -> str:
    if isinstance(v, bool):
        return '.TRUE.' if v else '.FALSE.'
    if isinstance(v, str):
        return f"'{v}'"
    return repr(float(v)) if isinstance(v, float) else str(v)


_write_inputs, _namelist = base.write_inputs, base.namelist


def write_inputs(folder: Path, grid, req: dict):
    _write_inputs(folder, grid, req)
    if 'adj' in req.get('layers', {}):
        grid.write(folder / 'adj.tif', grid.array('adj', req['layers']['adj']), gdal.GDT_Float32)
    if req.get('fuel_models'):
        rows = DEFAULT_TABLE.read_text().strip().splitlines()
        taken = {int(r.split(',')[0]) for r in rows}
        for m in req['fuel_models']:
            if int(m[0]) in taken:
                raise ValueError(f'fuel_models: code {m[0]} is already in the standard table')
            rows.append(','.join([str(int(m[0])), str(m[1]), fortran(bool(m[2]))] + [f'{float(x):.6g}' for x in m[3:]]))
        (folder / 'fuel_models.csv').write_text('\n'.join(rows) + '\n')


def namelist(grid, req: dict) -> str:
    text = _namelist(grid, req)
    if req.get('fuel_models'):
        text = text.replace("&MISCELLANEOUS\n", "&MISCELLANEOUS\nFUEL_MODEL_FILE = 'fuel_models.csv'\n"
                                                "MISCELLANEOUS_INPUTS_DIRECTORY = './inputs'\n")
    if 'seed' in req:
        text = text.replace("&MONTE_CARLO\n", f"&MONTE_CARLO\nSEED = {int(req['seed'])}\n")
    if req.get('spotting'):
        text += '&SPOTTING\n' + ''.join(f'{k} = {fortran(v)}\n' for k, v in req['spotting'].items()) + '/\n'
    return text


base.write_inputs, base.namelist = write_inputs, namelist

if __name__ == '__main__':
    base.main()
