# data/

Dados brutos e cache. Não vão para o git (vários GB): cada pessoa mantém a sua cópia local aqui.

| Pasta | Fonte | Licença / nota |
|---|---|---|
| `pt-firesprd-v2/` | PT-FireSprd v2, Zenodo 16279793: progressões de 155 incêndios PT, 2015–2024 | CC BY 4.0. Os incêndios de 2015–2021 citam-se pela v1 (ESSD 2023). Os de 2022–2024 só podem ser usados depois de o paper da v2 ser publicado |
| `cos2015v2-dgt/` | COS 2015 v2, DGT: uso e ocupação do solo | |
| `copernicus-dem-glo30/` | Copernicus DEM GLO-30: tiles de 1° do modelo de superfície a 1″ que cobrem cada grade (`scripts/fetch_dem.py`) | Licença Copernicus DEM, gratuita. Citar "© DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA" |
| `era5-openmeteo/` | ERA5 via Open-Meteo: meteorologia horária de cada incêndio (`scripts/fetch_weather.py`) | Open-Meteo CC BY 4.0. Citar "ERA5, Copernicus Climate Change Service" |
| `caop/` | CAOP 2025 (Continente), DGT: limites administrativos oficiais em GeoPackage, camada `cont_municipios` em PT-TM06, dá o concelho a cada quartel (`scripts/fetch_caop.py`) | CC BY 4.0. Citar "CAOP 2025, Direção-Geral do Território" |
| `osm/` | OpenStreetMap via Overpass: estradas, caminhos, edifícios, lugares e água dentro da grade de cada incêndio, resposta bruta por incêndio (`scripts/fetch_osm.py`; `scripts/build_osm.py` escreve `web/public/fires/<id>/osm.json`) | ODbL. Citar "© contribuidores do OpenStreetMap". O OSM rural subestima casas: o número de casas atingidas é um mínimo |
| `osm-fire-stations/` | OpenStreetMap via Overpass: `amenity=fire_station` em Portugal, a 100 km da Penha | ODbL. Citar "© contribuidores do OpenStreetMap" |
| `simfire/penha_2024-09-16/` | Ligação simbólica para `FireRenderer/data/simfire/penha_2024-09-16`: a grade, combustível, relevo e meteo IFS do incêndio hipotético da Penha (o do render UE). `scripts/build_hypothetical.py` faz dele `web/public/fires/Penha_Guimaraes_hipotetico/`, com uma rotação do vento sintética às 12h-13h | Incêndio hipotético; meteo real exceto o vento das 13h às 21h |
| `hypothetical/` | Cache das corridas ELMFIRE de `scripts/build_hypothetical.py`, pela chave do pedido | |
