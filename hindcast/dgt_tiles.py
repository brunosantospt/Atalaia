"""The DGT LiDAR tiles (MDS-2m and MDT-2m) over a fire's package grid, for canopy.py --dgt.

    hindcast/.venv/bin/python -I hindcast/dgt_tiles.py CabeceirasdeBasto_06092016 --list
    hindcast/.venv/bin/python -I hindcast/dgt_tiles.py CabeceirasdeBasto_06092016 --out <folder outside the repo>

The tiles are 1 km squares in EPSG:3763 from the 2024-25 flights, about 1.2 MB each. The list comes from the Centro
de Dados' STAC search (cdd.dgterritorio.gov.pt/dgt-be/v1/search), open to anyone; the files need a login (a free
account on the portal), so the download asks for the email and password at the terminal and keeps them only in
memory. Writes <out>/MDS-2m/<tile>.tif and <out>/MDT-2m/<tile>.tif and skips the ones already there, so it can be
run again after a failure. --list only prints the tiles, without a login.
"""

import argparse
import getpass
import sys
import time
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin

import requests
from pyproj import Transformer

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import fires  # noqa: E402

SITE = "https://cdd.dgterritorio.gov.pt"
SEARCH = f"{SITE}/dgt-be/v1/search"
COLLECTIONS = ("MDS-2m", "MDT-2m")


def bbox(fire: fires.Fire, margin: float = 0.001) -> list[float]:
    """The package grid in degrees (WGS84), from its corners, a little wider (0.001 degrees, about 100 m)."""
    g = fire.grid
    t = Transformer.from_crs(g["srs"], "EPSG:4326", always_xy=True)
    corners = [t.transform(x, y) for x in (g["xmin"], g["xmin"] + g["cols"] * g["cellsize"])
               for y in (g["ymin"], g["ymin"] + g["rows"] * g["cellsize"])]
    lon, lat = zip(*corners)
    return [min(lon) - margin, min(lat) - margin, max(lon) + margin, max(lat) + margin]


def tiles(box: list[float]) -> dict[str, list[dict]]:
    """The STAC items of each collection that touch the box, page by page."""
    out = {}
    for c in COLLECTIONS:
        body, items = {"bbox": box, "collections": [c], "limit": 100}, []
        while True:
            r = requests.post(SEARCH, json=body, timeout=60)
            r.raise_for_status()
            page = r.json()
            items += page["features"]
            nxt = [link for link in page.get("links", []) if link["rel"] == "next"]
            if not page["features"] or not nxt:
                break
            body = nxt[0]["body"]
        out[c] = items
    return out


class LoginForm(HTMLParser):
    """Where Keycloak's login form (id kc-form-login) posts to, and its hidden fields."""

    def __init__(self):
        super().__init__()
        self.action, self.fields, self.inside = None, {}, False

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if tag == "form" and a.get("id") == "kc-form-login":
            self.action, self.inside = a.get("action"), True
        elif tag == "input" and self.inside and a.get("type") == "hidden" and a.get("name"):
            self.fields[a["name"]] = a.get("value") or ""

    def handle_endtag(self, tag):
        if tag == "form":
            self.inside = False


def login(user: str, password: str) -> requests.Session:
    """A session signed in to the portal: its own /auth/login sends to Keycloak, the form sends back."""
    s = requests.Session()
    r = s.get(f"{SITE}/auth/login", timeout=30)
    r.raise_for_status()
    form = LoginForm()
    form.feed(r.text)
    if not form.action:
        raise SystemExit(f"{r.url}: sem formulário de login (a página do portal mudou?)")
    r = s.post(urljoin(r.url, form.action), data={**form.fields, "username": user, "password": password}, timeout=30)
    r.raise_for_status()
    if not r.url.startswith(SITE):
        raise SystemExit("cdd.dgterritorio.gov.pt: o login falhou (email ou palavra-passe?)")
    return s


def fetch(s: requests.Session, item: dict, path: Path) -> bool:
    """Download one tile; False when the portal answers with a page instead (the session ended)."""
    r = s.get(item["assets"]["data"]["href"], stream=True, timeout=120)
    r.raise_for_status()
    if r.headers.get("Content-Type", "").startswith("text/html"):
        return False
    part = path.with_suffix(".part")
    with open(part, "wb") as f:
        for chunk in r.iter_content(1 << 20):
            f.write(chunk)
    size = item["properties"].get("file:size")
    if size and part.stat().st_size != size:
        part.unlink()
        raise SystemExit(f"{item['id']}: {part.stat().st_size} bytes, esperava {size}")
    part.rename(path)
    return True


def main(argv=None):
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("fire")
    p.add_argument("--out", type=Path, help="folder for MDS-2m/ and MDT-2m/ (outside the repo)")
    p.add_argument("--list", action="store_true", help="only list the tiles (no login)")
    args = p.parse_args(argv)
    if not args.list and not args.out:
        p.error("--out ou --list")

    found = tiles(bbox(fires.Fire(args.fire)))
    for c, items in found.items():
        mb = sum(i["properties"].get("file:size") or 0 for i in items) / 1e6
        flights = sorted({i["id"].split("-", 3)[-1] for i in items})
        print(f"{c}: {len(items)} tiles, {mb:.0f} MB, voos {', '.join(flights)}")
    if args.list:
        return

    todo = [(c, i, args.out / c / f"{i['id']}.tif") for c, items in found.items() for i in items]
    todo = [t for t in todo if not t[2].exists()]
    print(f"{len(todo)} por descarregar para {args.out}")
    if not todo:
        return
    user = input("email da conta em cdd.dgterritorio.gov.pt: ")
    password = getpass.getpass("palavra-passe: ")
    s = login(user, password)
    for n, (c, item, path) in enumerate(todo, 1):
        path.parent.mkdir(parents=True, exist_ok=True)
        if not fetch(s, item, path):
            s = login(user, password)
            if not fetch(s, item, path):
                raise SystemExit(f"{item['id']}: o portal não deu o ficheiro, mesmo depois de novo login")
        print(f"\r{n}/{len(todo)} {c}/{path.name}", end="", flush=True)
        time.sleep(0.5)
    print(f"\n-> {args.out}; depois: hindcast/.venv/bin/python -I hindcast/canopy.py {args.fire} --dgt {args.out}")


if __name__ == "__main__":
    main()
