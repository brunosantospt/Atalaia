"""Download the CAOP, the official administrative map of Portugal, for the mainland.

    scripts/.venv/bin/python -I scripts/fetch_caop.py

Saves the DGT's GeoPackage of the current edition, untouched, to data/caop/ and unpacks the
.gpkg next to the zip. A file already there is not fetched again. build_inventory.py reads the
municipality layer to give every fire station its concelho by position instead of by name.

The CAOP (Carta Administrativa Oficial de Portugal) is published by the Direção-Geral do
Território (DGT) under CC BY 4.0 (dados.gov.pt "carta-administrativa-oficial-de-portugal-caop2025-
continente"): credit "CAOP 2025, © DGT" wherever it is shown. Since 2024 the DGT ships it as
GeoPackage only (no shapefile); the islands have their own files, not needed here.
"""

import urllib.request
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data/caop"
# CAOP2025: approved by DR aviso of 18 Feb 2026; file dated 2 Feb 2026 on the DGT server.
URL = "https://geo2.dgterritorio.gov.pt/caop/CAOP_Continente_2025-gpkg.zip"
MAX_BYTES = 400_000_000  # the 2025 mainland zip is 112 MB


def fetch_zip() -> Path:
    path = OUT / URL.rsplit("/", 1)[1]
    if path.exists():
        print(f"{path.name}: already here")
        return path
    request = urllib.request.Request(URL, headers={"User-Agent": "Atalaia/0.1 (Hack4Guimaraes)"})
    part = path.with_suffix(".part")
    with urllib.request.urlopen(request, timeout=120) as response:
        size = int(response.headers["Content-Length"])
        if not 0 < size <= MAX_BYTES:
            raise SystemExit(f"{path.name}: unexpected size {size}")
        with part.open("wb") as out:
            while chunk := response.read(1 << 20):
                out.write(chunk)
    if part.stat().st_size != size:
        raise SystemExit(f"{path.name}: got {part.stat().st_size} of {size} bytes")
    part.rename(path)
    print(f"{path.name}: {size / 1e6:.1f} MB → {path.relative_to(ROOT)}")
    return path


def unpack(archive: Path) -> list:
    """Extract every .gpkg in the zip flat into OUT (the zip may nest them in a folder)."""
    extracted = []
    with zipfile.ZipFile(archive) as z:
        for member in z.infolist():
            if member.is_dir() or not member.filename.lower().endswith(".gpkg"):
                continue
            target = OUT / Path(member.filename).name
            extracted.append(target)
            if target.exists():
                print(f"{target.name}: already here")
                continue
            with z.open(member) as src, target.open("wb") as dst:
                while chunk := src.read(1 << 20):
                    dst.write(chunk)
            print(f"{target.name}: {target.stat().st_size / 1e6:.1f} MB → {target.relative_to(ROOT)}")
    if not extracted:
        raise SystemExit(f"{archive.name}: no .gpkg inside")
    return extracted


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    unpack(fetch_zip())


if __name__ == "__main__":
    main()
