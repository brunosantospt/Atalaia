# Por que é que a Adição do FWI é Crucial? (Resumo Executivo)

**Projeto:** Atalaia – Fire Decision Twin  
**Hackathon:** Hack4Guimarães 2035 (Desafio 2: Incêndios Rurais)  
**Mentoria:** Prof. Filipe Alvelos & Prof.ª Elsa Silva (UMinho DPS)

---

### 1. Fala a Linguagem Oficial da Proteção Civil e do IPMA
* Em Portugal, o **IPMA** e a **ANEPC** classificam diariamente o perigo de incêndio rural através do **FWI (*Fire Weather Index*)**.
* Os alertas municipais, as restrições de uso do fogo e os níveis de prontidão dos corpos de bombeiros são definidos pelas **5 classes oficiais**: *Reduzido, Moderado, Elevado, Muito Elevado e Máximo*.
* Com o FWI integrado, o *Decision Twin* apresenta exatamente os mesmos índices que o comandante do posto de comando (PCO) consulta.

---

### 2. Substitui Fórmulas Empíricas por Física Validada
* **Antes:** A velocidade de propagação utilizava uma estimativa ad-hoc:  
  $$\text{head} = (1 + 0.18 \times W) \times \exp(-0.025 \times (RH - 30))$$
* **Agora:** A velocidade à cabeça é governada pelo **ISI (*Initial Spread Index*)** de Van Wagner (1987):  
  $$\text{head} = \left(\frac{\text{ISI}}{\text{ISI}_{\text{ref}}}\right) \times 4.6$$
* O **ISI** cruza a velocidade do vento com a humidade horária dos combustíveis finos através de curvas físicas de secagem e humedecimento comprovadas em milhares de incêndios reais.

---

### 3. Modela a "Memória" da Seca e Viabiliza Previsões Futuras
* A humidade dos combustíveis não depende apenas do calor daquela hora, mas da **seca acumulada ao longo de semanas**.
* Através dos códigos de seca (**DMC**, **DC** e **BUI**), o modelo sabe se o mato profundo e a manta morta estão totalmente disponíveis para arder.
* **Para Previsões Futuras (a 24h ou 48h):** O simulador recebe previsões meteorológicas numéricas (e.g. IPMA AROME 2.5 km ou ECMWF) e gera antecipadamente a propagação futura esperada de acordo com as normas operacionais.

---

### 4. Alinhamento Científico com a UMinho (`PyO3F`)
* O software de simulação e otimização de meios desenvolvido na Universidade do Minho (`PyO3F`, Prof. Filipe Alvelos) adota o sistema canadiano FWI e as regras de extinção por intensidade de linha.
* Ao acoplar o FWI no motor do Atalaia, garantimos **100% de conformidade com a literatura académica e a investigação dos mentores**.

---

### 5. Explicabilidade Imediata no Ecrã (HUD)
* No painel **"Conhecido em T"**, qualquer observador ou júri vê claramente:  
  `Perigo FWI: MUITO ELEVADO (FWI 30.1) · ISI 12.5 · FFMC 91 (humidade 10.0 %)`
* O utilizador percebe porque é que o fogo ganha força às 14h00 (humidade cai para 10%, ISI dispara) e acalma de madrugada (humidade sobe, ISI desce).
