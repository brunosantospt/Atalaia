# Passagem de testemunho: teste do ELMFIRE em nove incêndios (22/10/2026, 13:40)

Para quem continua, pessoa ou agente. Ler por esta ordem:
1. este ficheiro;
2. [`NOVE_INCENDIOS.md`](NOVE_INCENDIOS.md): os resultados e as conclusões até agora;
3. [`MULTIFIRE.md`](MULTIFIRE.md): os números (gerado);
4. o [`README.md`](README.md) desta pasta: as ferramentas, as convenções, a história.

## A tarefa

Testar o ELMFIRE noutros incêndios do PT-FireSprd, perceber porque falha, que entradas (disponíveis em tempo real) o melhoram, e, se não chegar, alternativas como o ensemble. Os fatores principais segundo os professores são combustível, vento e declive; as projeções também, com um peso que talvez dependa das condições (a Mara viu-as estragar resultados). **O que mais conta para a apresentação são as primeiras 2–3 horas.**

## Onde está

| | |
|---|---|
| Ramo | `hindcast-multifire`, a partir do `main` 031b7f6 (que já tem o trabalho do Bruno até ao passo 3 da API) |
| Árvore de trabalho | `/home/ragdraco/development/Hack4Guimaraes/Atalaia-multifire` (separada do checkout principal `Atalaia/`, que tem alterações de outras sessões e não se mexe) |
| Dados | `data/` é uma ligação simbólica para os de `Atalaia/data` (`cache`, `hindcast`, `pt-firesprd-v2`, `meta-canopy`, …), fora do git. Também `engines/elmfire/vendor` é uma ligação: não fazer commit dela |
| Pythons | `HPY=/home/ragdraco/development/Hack4Guimaraes/Atalaia/hindcast/.venv/bin/python` (corridas, relatório), `/home/ragdraco/development/Hack4Guimaraes/Atalaia/scripts/.venv/bin/python` (pacotes) |
| Registos | `data/hindcast/_logs/` (um ficheiro por corrida, e `batch_*.log` por lote) |

## O que está feito

- **Sete pacotes novos** em `web/public/fires/` (Vila Nova de Cerveira 2015, Sever do Vouga 2016, Guarda 2017, Monchique 2018, Vila de Rei 2019, Oleiros 2020, Castro Marim 2021), feitos com `hindcast/multifire_build.sh`.
  - **Para o Bruno:** o `web/public/fires/index.json` passou a ter nove incêndios, e a lista da web mostra-os todos.
- **Copas da Meta** para os nove (`canopy_open.py` → `fires/<id>/canopy_meta.npz`).
- **Corridas livres** de todas as configurações nos nove incêndios: K0, K3, K3m, K4, K5, K5m, K5b, K5mm, K3g, K5g, K3s, K6, K6m, K6d. As projeções (K6s2–5, K6x, K3x, K3xs2–3) correram nos oito sem Monchique.
- **Passo a passo:**
  - K3, K3m, K5 e K5m nos nove incêndios;
  - K5o e K5a nos oito sem Monchique.
- **Referências sem modelo** para todas as janelas: com a borda toda (`references.py`, a correr quando isto foi escrito) e com a borda ativa (`--active-edge oracle` e `hotspots --active-window-h 6`).
- **Calibração** por classe de combustível, deixando um incêndio de fora, sobre o K3 e o K5 (`fires/adj_all_K3.json`, `adj_all_K5.json`, `fires/<id>/adj_lofo_*.json`). Os fatores do K5 mudam até ×2 entre dobras: provavelmente não transferem.
- **Grelhas por incêndio** (versões × horas, corridas livres): `fires/<id>/grid_multifire.png`, feitas com o `grid.py`. A figura de resumo é a `multifire_plots.png` (`multifire_plots.py`).
- **Análises:**
  - porque falha (secção 3 do `MULTIFIRE.md`);
  - as primeiras horas;
  - a persistência do erro entre janelas;
  - o ponto do alerta contra a ignição real (o caso de Alijó, do Carlos);
  - as linhas molhadas em Vieira.

  Todas estão no `NOVE_INCENDIOS.md`.

## O que estava a correr e o que falta

À hora da passagem estava a correr um lote em segundo plano, sem Monchique, 3 trabalhos de cada vez: os membros do ensemble, depois K3x, K5as e K5c (K5o e K5a já acabaram). Se a máquina reiniciou ou a sessão morreu, recomeça-se assim. O `multifire_runs.sh` salta o que já tem `steps/<cfg>.json`, por isso pode correr-se outra vez sem medo:

```bash
cd /home/ragdraco/development/Hack4Guimaraes/Atalaia-multifire
export HPY=/home/ragdraco/development/Hack4Guimaraes/Atalaia/hindcast/.venv/bin/python N=3
export FIRES="VieiradoMinho_10082016 CabeceirasdeBasto_06092016 VilaNovadeCerveira_08082015 SeverdoVouga_09082016 Guarda_23082017 Oleiros_25072020 CastroMarim_16082021 ViladeRei_20072019"
hindcast/multifire_runs.sh steps K5o K5a                                   # a borda ativa (oráculo, focos)
hindcast/multifire_runs.sh steps K3m_w08 K3m_w125 K5m_w08 K5m_w125         # membros do ensemble
hindcast/multifire_runs.sh steps K3x K5as K5c                              # projeções por janela, correção em linha, calibrado
```

Antes de recomeçar, ver se ainda há trabalhos a correr: `pgrep -af "steps.py|multifire_runs"`. Dois lotes ao mesmo tempo no mesmo incêndio e configuração estragam-se um ao outro, porque escrevem as mesmas corridas.

Depois das corridas, por esta ordem:
1. **Formas e referências das configurações novas:**
   ```bash
   $HPY -I hindcast/references.py --shape-of K3 K3m K5 K5m K5as K5c K3x
   $HPY -I hindcast/references.py --active-edge oracle --shape-of K5o
   $HPY -I hindcast/references.py --active-edge hotspots --active-window-h 6 --shape-of K5a
   ```
   Cada uma demora alguns minutos; Monchique é a mais lenta.
2. **O ensemble**, com só os incêndios que têm todos os membros:
   ```bash
   $HPY -I hindcast/ensemble.py --members K3m K3m_w08 K3m_w125 K5m K5m_w08 K5m_w125 --name ensemble
   $HPY -I hindcast/ensemble.py --members K5m K5m_w08 K5m_w125 --name ensemble_K5m
   ```
   Lê as grades de chegada em `data/hindcast/<id>/st_<cfg>_<k>.npy`. Essas grades só existem nesta máquina, porque `data/` não vai para o git. Noutra máquina, apagar os `steps/<cfg>.json` dos membros e voltar a correr os lotes.
3. **O relatório:** `$HPY -I hindcast/multifire_report.py` → `MULTIFIRE.md`, `multifire.json`.
4. **Completar o `NOVE_INCENDIOS.md`:** as secções marcadas *(a completar)*, ou seja, calibração, ensemble, projeções por janela (K3x: o ganho por janela contra a humidade, o vento, a área do fogo e o dia ou a noite), correção em linha (K5as) e o K5a final.
5. **Commit e push** do ramo, sem `engines/elmfire/vendor`.

## Próximos passos sugeridos (por ordem)

1. **Primeiras horas:** fazer do K5 a configuração das primeiras horas na API (`fuel_models` portugueses e vivas de 30/70 %; o motor já aceita os dois) e testar um ensemble de vento (× 0,8, × 1,25) só para elas. As arrancadas muito rápidas (Vila de Rei: 522 ha em 2,5 h) continuam fora do alcance.
2. **A ignição:** pôr a ignição da API no primeiro foco de satélite e não no ponto do alerta. Medir com o MTG-FCI de 2025 (LSA SAF, demonstração; arXiv 2606.06016).
3. **A borda ativa em tempo real:** o K5a só usa VIIRS e MODIS. Com o MTG-FCI e os setores ativos e dominados dos relatórios da ANEPC deve aproximar-se do K5o.
4. **O modelo de mato por região** (V-MAa no Minho, V-MMb noutros sítios): confirmar com incêndios de fora destes nove, como Alijó 2019 (ramo do Hugo) ou outros do PT-FireSprd de 2015–2021.
5. **Projeções condicionais:** projeções fortes só com o fogo grande, vento forte e FFMC alto (Storey et al. 2020), como dimensão do ensemble. Os dados para escolher os limiares saem do K3x por janela.
6. **Linhas molhadas** (`--wet-lines`) em vez de faixas permanentes nas linhas de ataque, quando a API as receber.

## Cuidados

- **Memória:** a máquina tem 30 GB, partilhados com outras sessões, e o utilizador já ficou sem memória uma vez.
  - Até 4 trabalhos de cada vez. Monchique (um milhão de células) passa dos 2 GB por contentor e fica de fora dos lotes extra.
  - A corrida livre de Monchique fica nas 48 h (`--duration-min 2880`), porque as 128 h não cabem.
  - Não parar contentores do Docker que não sejam desta árvore: há outras sessões a usar o Docker.
- **Editar o `multifire_runs.sh`** só por substituição atómica (escrever `.sh.new` e mudar o nome). O bash lê o script aos bocados enquanto corre.
- **`pkill -f` / `pgrep -f`** apanham a própria shell. Matar pelo PID.
- **Ao comparar, usar sempre as mesmas janelas e a mesma borda:** o relatório já o faz. Uma configuração com borda ativa compara-se com referências da mesma borda (`ref_*_oracle`, `ref_*_hotspots`).
- **A correção em linha (K5as)** usa o erro da janela anterior da corrida simples (K5), só se essa janela cresceu pelo menos 5 ha, reduzido a metade. Fora de linha baixa a mediana de |log2 área| de 1,61 para 1,15.
- **Unreal:** só um UnrealEditor na máquina. Perguntar às outras sessões antes de o abrir; esta tarefa não precisa dele.
