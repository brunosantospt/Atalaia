# Pitch · Atalaia (4 min)

Slides em reveal.js 5.1.0, guardado em `vendor/` para correr sem rede.

```bash
python3 -m http.server 8642 --directory pitch
```

Abrir http://127.0.0.1:8642. **S** abre a vista do orador (só o texto a dizer e os cliques, tempos, cronómetro de 4 min); **F** põe em ecrã inteiro; `?print-pdf` exporta para PDF pelo Chrome. O guião para ensaiar está em `GUIAO.md`; o sourcing, as ressalvas e as notas técnicas por slide (para o Q&A) estão em `FONTES.md`, fora da vista do orador.

| # | Slide | Tempo |
|---|---|---|
| 1 | Título | 0:00–0:05 |
| 2 | Gancho: 270 695 ha e > 85 M€ de perdas (2025) | 0:05–0:25 |
| 3 | O problema decide-se nos primeiros minutos | 0:25–0:45 |
| 4 | O que já existe e porque falha: FARSITE, FlamMap, fogos.pt, IPMA/EFFIS, incendiosportugal.pt | 0:45–1:00 |
| 5 | O desafio da UMinho: rápida, precisa, prática | 1:00–1:10 |
| 5b | Logótipo ao centro, drone e chama | 1:10–1:13 |
| 6 | Proposta: roadmap + "um só mapa" | 1:13–1:31 |
| 7 | **Demo ao vivo (placeholder)** | 1:31–3:23 |
| 8 | Validação: Vieira do Minho | 3:23–3:43 |
| 8b | A tecnologia por baixo: ELMFIRE, vento, ILS, tradutor | 3:43–4:03 |
| 9 | A seguir + fecho | 4:03–4:23 |
| 10 | Créditos (fora do tempo) | |

O slide "O que é novo" (a tabela de comparação com fogos.pt, IPMA/EFFIS, Copernicus EMS, incendiosportugal.pt) foi cortado por repetir o argumento do slide 4; esse argumento agora é o próprio slide 4, mais completo (ferramenta vs. o que falha), separado do desafio da UMinho (slide 5).

Os tempos da coluna acima são estimativas por slide, não cronometragem real: a soma (4:23) já passa dos 4:00. Por fazer: cronometrar a fala real de cada slide e cortar onde for preciso antes do pitch final.

- Os números grandes (gancho, sequência de precisão) usam JetBrains Mono (Bold/ExtraBold), guardado em `vendor/fonts/` (SIL OFL) para correr sem rede, tal como o resto do `vendor/`.
- A demo corre numa janela própria do browser, não dentro dos slides: a app e o reveal usam as mesmas teclas.
- Os marcadores tracejados (`.tbd`) são o que falta preencher depois do feature freeze.
- `media/` fica fora do git: é para o vídeo de reserva da demo (`media/demo.mp4`), gravado da app depois do freeze.
- As imagens da validação vêm de `hindcast/fires/VieiradoMinho_10082016/` no ramo `hindcast-registos`.

Dados verificados em 21 out 2026:

- Slide 2 é todo de 2025 (o último ano fechado), para não misturar anos: [Relatório de Atividades do SGIFR 2025 (AGIF)](https://www.agif.pt/app/uploads/2026/07/Relatorio_Atividades_SGIFR_2025_v20260715.pdf). Área e ocorrências: 270 695 ha, 8 252 incêndios (pp. 20, 965). Custo: "prejuízos estimados superiores a 85 milhões de euros" (madeira, biomassa para energia, frutos, carbono armazenado e serviços de ecossistema), pp. 14 e 43. É também um mínimo: não conta casas, infraestruturas, saúde nem o custo do combate. Para comparar: o SGIFR investiu 600 M€ em 2025 (p. 19), e o JRC estimou cerca de 1,5 mil M€ de danos em 2017.
- 2026 não entra no slide 2 por não ter ainda um relatório fechado (só sai em 2027). A estimativa de perdas de 2026 (25–35 M€, extrapolada da área ardida até 21 out — 74 591 ha — vezes o €/ha de 2024–2025, 314–487 €/ha) fica só em `FONTES.md`, para o Q&A.
- Slide 3 é agora também 2025 (antes era o relatório provisório de 2026 do ICNF, limiar de 100 ha): [Relatório de Atividades do SGIFR 2025 (AGIF)](https://www.agif.pt/app/uploads/2026/07/Relatorio_Atividades_SGIFR_2025_v20260715.pdf), pp. 34–36. "Cerca de 91% da área ardida ocorreu em incêndios com dimensão igual ou superior a 500 hectares" — 44 incêndios, "cerca de 0,47% das ocorrências". O limiar mudou de 100 ha para 500 ha, porque é o que este relatório destaca; os 246 mil ha do detalhe são um cálculo nosso (91 % × 270 695 ha do slide 2), não um valor do relatório.

O slide 5 reutiliza o drone e a chama do SVG original: o drone verifica a chama no «i», a chama desaparece com um pouco de fumo que se dissipa, surge o ponto branco do «i» e o drone regressa à torre com o feixe desligado. A sequência termina em cerca de 3 s e repete-se ao voltar a entrar no slide. Com redução de movimento, mostra o estado final sem animação. A versão para impressão usa logótipos estáticos. A animação representa a marca; a deteção por drones continua na secção «A seguir».
