# Pinned SimFire release (MITRE, from PyPI) and the image built from it. The rest of its
# dependencies are pinned in requirements.txt.
SIMFIRE_VERSION=2.0.1
SIMFIRE_IMAGE=atalaia/simfire:$SIMFIRE_VERSION
# What the API reports for every engine (api/engines.py): its version and the image it runs in.
ENGINE_VERSION=$SIMFIRE_VERSION
ENGINE_IMAGE=$SIMFIRE_IMAGE
