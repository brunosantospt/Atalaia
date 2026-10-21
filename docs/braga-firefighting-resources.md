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
* **Acesso aberto**: RepositóriUM, [hdl 1822/97938](https://hdl.handle.net/1822/97938), licença CC BY-NC-SA 4.0

A Tabela 41 é o inventário do caso de estudo da tese e não cita fonte própria: é a melhor lista pública que temos, mas não é uma lista oficial da ANEPC. Também não diz disponibilidade: a tese trata-a à parte, com cenários de 25%, 50% e 100% dos meios de cada quartel.

---

## 2. Inventário Operacional de Braga e Guimarães

O ficheiro gerado em [`web/public/suppression_braga_uminho.json`](../web/public/suppression_braga_uminho.json) mapeia os **21 Corpos de Bombeiros** e os seus **113 veículos**, totalizando uma capacidade hídrica de **240.400 litros**:

| Município | Corpo de Bombeiros (Quartel) | Meios de Combate | Capacidade Hídrica Total |
| :--- | :--- | :---: | :---: |
| **Guimarães** | **Bombeiros Voluntários de Guimarães** | **5 veículos** *(A, B, C, D, E)* | **9.500 L** |
| **Guimarães** | **Bombeiros Voluntários das Caldas das Taipas** | **8 veículos** *(F, G, H, I, J, K, L, M)* | **18.500 L** |
| **Vieira do Minho** | **Bombeiros Voluntários de Vieira do Minho** | **7 veículos** *(AZ, BA, BB, BC, BD, BE, BF)* | **17.900 L** |
| **Cabeceiras de Basto** | Bombeiros Voluntários Cabeceirenses | 3 veículos *(V, W, X)* | 6.400 L |
| **Fafe** | Bombeiros Voluntários de Fafe | 7 veículos *(AL a AR)* | 12.500 L |
| **Vila Nova de Famalicão** | BV Vila Nova de Famalicão + Famalicenses + Riba de Ave | 23 veículos | 49.400 L |
| **Braga** | Sapadores de Braga + Voluntários de Braga | 8 veículos | 20.900 L |
| **Barcelos** | BV Barcelos + BV Barcelinhos + BV Viatodos | 12 veículos | 24.800 L |
| **Esposende** | BV Esposende + BV Fão | 6 veículos | 12.500 L |
| **Outros Concelhos** | Vizela, Amares, Celorico de Basto, Terras de Bouro, Póvoa de Lanhoso, Vila Verde | 34 veículos | 68.000 L |
| **TOTAL** | **21 Quartéis** | **113 Veículos** | **240.400 L** |

---

## 3. Tipologia de Veículos e Limites de Supressão

A tese só dá a capacidade de cada veículo. A categoria no JSON é inferida dela (até 1000 L VLCI, até 6000 L VFCI, acima VTTU) e não é o tipo registado: o Despacho 21638/2009 da ANEPC pede pelo menos 500 L a um VLCI e 3000 L a um VFCI, e a tabela tem veículos de 300–400 L e de 1500–2500 L.

1. **Ligeiros (300 L a 1000 L)**: 51 veículos.

2. **Combate (1500 L a 4500 L)**: 59 veículos.

3. **Tanques (7000 L a 9000 L)**: Vieira do Minho (`BB`: 9000 L), Famalicenses (`BU`: 9000 L) e Vizela (`DE`: 7000 L).

4. **139 Pontos de Água** de primeira ordem (acessíveis por caminhos florestais) e de segunda ordem (sem acesso direto), ex.: *Açude de Serafão*, *Ribeiro do Pontido*, *Rio Homem Açude*.

Pressupostos do caso de estudo (secção 6.1, p. 72): resposta de **10 minutos** entre o alerta e o início da intervenção; reabastecimento de **10 minutos** até o tanque encher, e um veículo só vai reabastecer quando o tanque fica vazio; **10 L** de água por metro de perímetro; tempo de extinção $3.3\sqrt{TBA}$ (Albini, Korovin & Gorovaya 1978).

Os limites de chama (1,2 m / 350 kW/m a pé, 2,4 m / 1700 kW/m para VFCI), o caudal de 200 L/min e os 240 m/h de frente extinta **não vêm da tese**: são pressupostos do próprio Atalaia, com fontes, em [`web/public/suppression.json`](../web/public/suppression.json).

---

## 4. Como Integrar no Gêmeo Digital (Decision Twin)

O ficheiro JSON está estruturado para consumo direto pela API e pelo frontend CesiumJS:
```bash
# Ficheiro disponível em:
web/public/suppression_braga_uminho.json
```

Permite ao sistema responder às seguintes questões operacionais:
1. Dado um foco de incêndio na Serra da Cabreira ou na Penha, qual é o quartel com melhor tempo de chegada (ETA)?
2. A intensidade prevista da chama na estrada de contenção permite segurar a linha com VFCIs de Guimarães/Taipas ou exige apoio aéreo?
3. Se um veículo esgotar a água, onde se encontra o ponto de reabastecimento mais próximo com acesso viário?
