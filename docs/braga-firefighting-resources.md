# Recursos e Meios de Combate a Incêndios Florestais: Distrito de Braga

Este documento descreve a integração da base de dados operacional de meios de combate a incêndios do distrito de Braga, desenvolvida no ramo `feature/braga-firefighting-resources` do projeto **Atalaia – Fire Decision Twin** (Hack4Guimarães 2035).

---

## 1. Fonte e Enquadramento Científico

Os dados foram extraídos e sistematizados a partir da tese de doutoramento:
* **Autora**: Marina Araújo de Matos
* **Título**: *Minimizing the Impact of Forest Fires*
* **Instituição**: Universidade do Minho, Escola de Engenharia (Departamento de Produção e Sistemas)
* **Data**: Setembro de 2025
* **Orientação**: Prof.ª Ana Maria Alves Coutinho da Rocha e Prof.º Filipe Pereira Pinto Cunha Alvelos
* **Projeto de Financiamento**: FCT `PCIF/GRF/0141/2019` (*O3F - An Optimization Framework to Reduce Forest Fire*)
* **Referência da Tabela**: *Table 41: Firefighting resources available at each fire station* (página 75 da tese / 92 do documento PDF)

---

## 2. Inventário Operacional de Braga e Guimarães

O ficheiro gerado em [`web/public/suppression_braga_uminho.json`](../web/public/suppression_braga_uminho.json) mapeia os **21 Corpos de Bombeiros** e os seus **113 veículos florestais operacionais**, totalizando uma capacidade hídrica de **240.700 litros**:

| Município | Corpo de Bombeiros (Quartel) | Meios de Combate | Capacidade Hídrica Total |
| :--- | :--- | :---: | :---: |
| **Guimarães** | **Bombeiros Voluntários de Guimarães** | **5 veículos** *(A, B, C, D, E)* | **9.500 L** |
| **Guimarães** | **Bombeiros Voluntários das Caldas das Taipas** | **8 veículos** *(F, G, H, I, J, K, L, M)* | **22.000 L** |
| **Vieira do Minho** | **Bombeiros Voluntários de Vieira do Minho** | **7 veículos** *(AZ, BA, BB, BC, BD, BE, BF)* | **17.900 L** |
| **Cabeceiras de Basto** | Bombeiros Voluntários Cabeceirenses | 3 veículos *(V, W, X)* | 6.500 L |
| **Fafe** | Bombeiros Voluntários de Fafe | 7 veículos *(AL a AR)* | 17.500 L |
| **Vila Nova de Famalicão** | Bombeiros Voluntários de Famalicão + Famalicenses | 15 veículos | 39.400 L |
| **Braga** | Sapadores de Braga + Voluntários de Braga | 8 veículos | 20.400 L |
| **Barcelos** | BV Barcelos + BV Barcelinhos + BV Viatodos | 12 veículos | 27.900 L |
| **Outros Concelhos** | Vizela, Amares, Esposende, Celorico, Terras de Bouro, Fão | 48 veículos | 79.600 L |
| **TOTAL** | **21 Quartéis** | **113 Veículos** | **240.700 L** |

---

## 3. Tipologia de Veículos e Limites de Supressão

De acordo com a doutrina nacional da Proteção Civil (ANEPC) e as fórmulas modeladas pela Universidade do Minho:

1. **VFCI Ligeiros (Tanque 400 L a 600 L)**:
   - Meios de primeira intervenção rápida e reconhecimento tático (VCOT/VFCI-L);
   - Tempos de saída de quartel (*turnout*): ~10 minutos.

2. **VFCI Pesados de Linha (Tanque 2000 L a 4500 L)**:
   - Veículos de combate direto com agulhetas de caudal 200 L/min;
   - Taxa de extinção no terreno: **240 metros de frente extinta por hora de trabalho** (`attackMPerH`);
   - **Limite de Segurança (Comprimento de Chama de Byram)**:
     - Chamas até **2.4 metros** (1700 kW/m): combate direto eficaz com água;
     - Chamas superiores a **2.4 metros**: perigo de *overrun* (recuo obrigatório dos meios terrestres e necessidade de descargas aéreas de helicópteros ou aviões anfíbios).

3. **VTTU (Autotanques Pesados de 7000 L a 9000 L)**:
   - Presentes em corporações estratégicas como Vieira do Minho (`BB`: 9000 L), Famalicenses (`BU`: 9000 L) e Vizela (`DE`: 7000 L);
   - Funcionam como estações móveis de reabastecimento na linha de água para evitar que os VFCIs tenham de abandonar o combate para ir aos pontos de água.

4. **139 Pontos de Água Estratégicos**:
   - Açudes e represas georreferenciados (ex.: *Açude de Serafão*, *Ribeiro do Pontido*, *Rio Homem*);
   - Tempo de reabastecimento calibrado: 10 minutos de bombeamento no ponto de água.

---

## 4. Como Integrar no Gêmeo Digital (Decision Twin)

O ficheiro JSON está estruturado para consumo direto pela API e pelo frontend CesiumJS:
```bash
# Ficheiro disponível em:
web/public/suppression_braga_uminho.json
```

Permite ao sistema responder em tempo real às seguintes questões operacionais:
1. Dado um foco de incêndio na Serra da Cabreira ou na Penha, qual é o quartel com melhor tempo de chegada (ETA)?
2. A intensidade prevista da chama na estrada de contenção permite segurar a linha com VFCIs de Guimarães/Taipas ou exige apoio aéreo?
3. Se um veículo esgotar a água, onde se encontra o ponto de reabastecimento mais próximo com acesso viário?
