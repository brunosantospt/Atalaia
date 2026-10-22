# Pitch · Atalaia (4 min)

Slides em reveal.js 5.1.0, guardado em `vendor/` para correr sem rede.

```bash
python3 -m http.server 8642 --directory pitch
```

Abrir http://127.0.0.1:8642. **S** abre a vista do orador (notas em PT, tempos, cronómetro de 4 min); **F** põe em ecrã inteiro; `?print-pdf` exporta para PDF pelo Chrome.

| # | Slide | Tempo |
|---|---|---|
| 1 | Título | 0:00–0:05 |
| 2 | Gancho: 74 572 ha | 0:05–0:25 |
| 3 | O problema decide-se nos primeiros minutos: ≈ 1 % / 82 % | 0:25–0:45 |
| 4 | O desafio da UMinho: rápida, precisa, prática | 0:45–1:00 |
| 5 | Logótipo ao centro, drone e chama | 1:00–1:03 |
| 6 | Proposta: dados → meios → efeito, "um só mapa" | 1:03–1:18 |
| 7 | **Demo ao vivo (placeholder)** | 1:18–3:10 |
| 8 | Validação: Vieira do Minho | 3:10–3:30 |
| 9 | O que é novo | 3:30–3:45 |
| 10 | A seguir + fecho | 3:45–4:00 |
| 11 | Créditos (fora do tempo) | |

- A demo corre numa janela própria do browser, não dentro dos slides: a app e o reveal usam as mesmas teclas.
- Os marcadores tracejados (`.tbd`) são o que falta preencher depois do feature freeze.
- `media/` fica fora do git: é para o vídeo de reserva da demo (`media/demo.mp4`), gravado da app depois do freeze.
- As imagens da validação vêm de `hindcast/fires/VieiradoMinho_10082016/` no ramo `hindcast-registos`.

Dados verificados em 21 out 2026:

- Slide 2: [contador público ICNF / SGIF](https://www.icnf.pt/data/fogos.php), 74 572 ha e 8 602 ocorrências. A data no slide é a de consulta, pois o endpoint não declara uma data de corte.
- Slide 3: [7.º relatório provisório do ICNF de 2026](https://www.icnf.pt/api/file/doc/eddc5c0c25b98c1a), secção 2, p. 4, período 1 jan–30 set. Incêndios ≥ 100 ha: 84 / 8 032 = 1,046 % das ocorrências; 61 123 / 74 251 = 82,319 % da área. As percentagens no slide estão arredondadas. Não combinar os totais vivos do slide 2 com os numeradores deste relatório.

O slide 5 reutiliza o drone e a chama do SVG original: o drone verifica a chama no «i», a chama desaparece com um pouco de fumo que se dissipa, surge o ponto branco do «i» e o drone regressa à torre com o feixe desligado. A sequência termina em cerca de 3 s e repete-se ao voltar a entrar no slide. Com redução de movimento, mostra o estado final sem animação. A versão para impressão usa logótipos estáticos. A animação representa a marca; a deteção por drones continua na secção «A seguir».
