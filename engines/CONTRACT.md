# Contrato dos motores

Cada motor vive em `engines/<motor>/` e corre um incêndio com `run.sh`: o pedido entra em JSON pelo stdin e o resultado sai em JSON pelo stdout. Erros saem pelo stderr, com código de saída diferente de 0. Este é o nível do P3. O cenário completo (perímetro inicial, decisões A e B) chega no P5, em `docs/contracts.md`.

## Pedido

```json
{
  "grid": {"cols": 201, "rows": 201, "cellsize": 30, "xmin": -3015, "ymin": -3015, "srs": "EPSG:3763"},
  "duration_min": 60,
  "ignitions": [{"x": 0, "y": 0, "t_min": 0}],
  "weather": {
    "wind_kmh": 20, "wind_from_deg": 270,
    "dead_1h_pct": 6, "dead_10h_pct": 8, "dead_100h_pct": 10,
    "live_herb_pct": 60, "live_woody_pct": 90
  },
  "layers": {"fuel": 102}
}
```

- **`grid`:** células quadradas de `cellsize` metros. `xmin` e `ymin` são o canto sudoeste, no SRS da grade.
- **`ignitions`:** pontos no SRS da grade, em metros. `t_min` é opcional (0 por omissão).
- **`weather`:** constante durante a simulação. O vento horário chega no P4.
  - `wind_kmh` é o vento a 10 m, em km/h;
  - `wind_from_deg` é a direção de onde o vento vem (convenção meteorológica: 270 = de oeste, empurra o fogo para leste);
  - as humidades dos combustíveis estão em %.
- **`layers`:**
  - `fuel` é obrigatório: código Scott & Burgan (102 = GR2, 165 = TU5, 91 = não combustível);
  - os restantes valem 0 se faltarem: `elevation_m`, `slope_deg`, `aspect_deg`, `canopy_cover_pct`, `canopy_height_m`, `canopy_base_m`, `canopy_bulk_kgm3`.

Cada valor de `weather` e `layers` pode ser um número para a grade toda ou uma matriz `rows` × `cols`, com a linha 0 no bordo norte.

## Resultado

```json
{
  "engine": "elmfire",
  "version": "2025.0717",
  "grid": {"cols": 201, "rows": 201, "cellsize": 30, "xmin": -3015, "ymin": -3015, "srs": "EPSG:3763"},
  "arrival_min": [[null, null, 12.5, ...], ...],
  "burned_ha": 11.34,
  "runtime_s": 0.97
}
```

- **`arrival_min`:** minuto em que o fogo chega a cada célula, desde o início da simulação. Usa a mesma grade e a mesma orientação do pedido (linha 0 a norte). `null` onde o fogo não chegou.
- **`burned_ha`:** área das células que arderam.
- **`runtime_s`:** tempo de relógio do adapter e do motor, sem o arranque do contentor.

## Motores

| Motor | Estado | Notas |
|---|---|---|
| `elmfire/` | P3 | ELMFIRE 2025.0717 num contentor Docker. `./setup.sh` uma vez por máquina, `./test.sh` para validar |
