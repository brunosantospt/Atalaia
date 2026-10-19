# SimFire on Python 3.9 with the dependencies pinned in requirements.txt, for adapter.py.
# Runs headless: pygame gets dummy video and audio drivers and matplotlib draws to memory.

FROM python:3.9-slim-bookworm AS build
# noise has no wheels and is compiled here.
RUN apt-get update \
 && apt-get install -y --no-install-recommends gcc libc6-dev \
 && rm -rf /var/lib/apt/lists/*
COPY requirements.txt /requirements.txt
RUN pip install --no-cache-dir --no-deps --prefix=/install -r /requirements.txt

FROM python:3.9-slim-bookworm
ARG SIMFIRE_VERSION
COPY --from=build /install /usr/local
ENV SIMFIRE_VERSION=${SIMFIRE_VERSION} \
    SDL_VIDEODRIVER=dummy \
    SDL_AUDIODRIVER=dummy \
    PYGAME_HIDE_SUPPORT_PROMPT=1 \
    MPLBACKEND=Agg \
    MPLCONFIGDIR=/opt/matplotlib
# Build matplotlib's font cache now, writable by any user, so runs do not rebuild it.
RUN python -c "import matplotlib.font_manager" && chmod -R a+rwX /opt/matplotlib \
 && python -W ignore -c "import simfire"
