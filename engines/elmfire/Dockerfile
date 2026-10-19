# ELMFIRE built from the pinned source in vendor/elmfire (fetched by setup.sh) with our patches,
# plus GDAL, which ELMFIRE calls to convert its rasters, and Python for adapter.py.
# ELMFIRE is developed on Linux; this also runs it on macOS.

FROM ubuntu:24.04 AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends gfortran make patch libopenmpi-dev openmpi-bin \
 && rm -rf /var/lib/apt/lists/*
COPY vendor/elmfire/build /elmfire/build
COPY patches /patches
RUN for p in /patches/*.patch; do patch -p1 -d /elmfire < "$p"; done
WORKDIR /elmfire/build/linux
RUN ./make_gnu.sh

FROM ubuntu:24.04
ARG ELMFIRE_TAG
RUN apt-get update \
 && apt-get install -y --no-install-recommends gdal-bin python3-gdal python3-numpy openmpi-bin libgfortran5 \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /elmfire/build/linux/bin/elmfire_${ELMFIRE_TAG} /usr/local/bin/elmfire
ENV ELMFIRE_VERSION=${ELMFIRE_TAG}
