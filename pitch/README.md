# Pitch · Atalaia (4 min)

Slides em reveal.js 5.1.0, guardado em `vendor/` para correr sem rede.

```bash
python3 -m http.server 8642 --directory pitch
```

Abrir http://127.0.0.1:8642. **S** abre a vista do orador (notas em PT, tempos, cronómetro de 4 min); **F** põe em ecrã inteiro; `?print-pdf` exporta para PDF pelo Chrome.

| # | Slide | Tempo |
|---|---|---|
| 1 | Título | 0:00–0:05 |
| 2 | Gancho: 74 274 ha | 0:05–0:25 |
| 3 | Problema: 1 % = 82 % | 0:25–0:45 |
| 4 | O desafio da UMinho: rápida, precisa, prática | 0:45–1:00 |
| 5 | Logótipo ao centro | 1:00–1:03 |
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
