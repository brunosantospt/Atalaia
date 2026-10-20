"""The engines in engines/<id>/ (engines/CONTRACT.md): what each one is, whether it can run here, and
running it. An engine is listed when its folder has an engine.json; its env.sh gives the version and
the Docker image it runs in."""

import hashlib
import json
import os
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENGINES = ROOT / 'engines'
RUN_TIMEOUT_S = 30 * 60
# Not the engine's code: they do not change what it computes.
NOT_CODE = {'test.sh', 'setup.sh', 'vendor', '__pycache__', '.gitignore'}


class EngineError(RuntimeError):
    pass


@dataclass
class Engine:
    id: str
    name: str
    method: str
    version: str
    image: str

    @property
    def folder(self) -> Path:
        return ENGINES / self.id

    def state(self, docker: bool | None = None) -> str:
        """ready, not_installed (no image: run its setup.sh) or no_docker (Docker is not running)."""
        if not (docker_running() if docker is None else docker):
            return 'no_docker'
        found = subprocess.run(['docker', 'image', 'inspect', self.image], capture_output=True)
        return 'ready' if found.returncode == 0 else 'not_installed'

    def code_hash(self) -> str:
        """Of the files that decide what the engine computes: its adapter, scripts and image recipe."""
        h = hashlib.sha256()
        for path in sorted(self.folder.rglob('*')):
            parts = path.relative_to(self.folder).parts
            if path.is_file() and not NOT_CODE.intersection(parts):
                h.update('/'.join(parts).encode() + b'\0' + path.read_bytes() + b'\0')
        return h.hexdigest()

    def run(self, request: dict) -> dict:
        """One run of run.sh: the request in, the result out (engines/CONTRACT.md)."""
        env = {k: v for k, v in os.environ.items() if k != 'SIMFIRE_STOCK'}
        done = subprocess.run([str(self.folder / 'run.sh')], input=json.dumps(request, separators=(',', ':')).encode(),
                              capture_output=True, timeout=RUN_TIMEOUT_S, env=env)
        if done.returncode != 0:
            tail = done.stderr.decode(errors='replace').strip().splitlines()[-12:]
            raise EngineError(f'{self.name} falhou (código {done.returncode}):\n' + '\n'.join(tail))
        return json.loads(done.stdout)

    def describe(self, docker: bool) -> dict:
        return {'id': self.id, 'name': self.name, 'version': self.version, 'method': self.method,
                'state': self.state(docker)}


def docker_running() -> bool:
    return shutil.which('docker') is not None and subprocess.run(['docker', 'info'], capture_output=True).returncode == 0


def env_values(env_sh: Path, *names: str) -> list[str]:
    """Variables from an env.sh, as bash leaves them after sourcing it."""
    script = '. "$1"; shift; for name; do printf "%s\\n" "${!name}"; done'
    done = subprocess.run(['bash', '-c', script, '_', str(env_sh), *names], capture_output=True, text=True, check=True)
    return done.stdout.splitlines()


def all_engines() -> dict[str, Engine]:
    found = {}
    for meta in sorted(ENGINES.glob('*/engine.json')):
        info = json.loads(meta.read_text())
        version, image = env_values(meta.parent / 'env.sh', 'ENGINE_VERSION', 'ENGINE_IMAGE')
        found[meta.parent.name] = Engine(meta.parent.name, info['name'], info['method'], version, image)
    return found
