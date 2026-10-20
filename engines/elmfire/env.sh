# Pinned ELMFIRE release: the tag, the commit it must resolve to, and the image built from it.
ELMFIRE_REPO=https://github.com/lautenberger/elmfire
ELMFIRE_TAG=2025.0717
ELMFIRE_COMMIT=168c8d4186fa0854ec7615732532fbcf820680c8
ELMFIRE_IMAGE=atalaia/elmfire:$ELMFIRE_TAG
# What the API reports for every engine (api/engines.py): its version and the image it runs in.
ENGINE_VERSION=$ELMFIRE_TAG
ENGINE_IMAGE=$ELMFIRE_IMAGE
