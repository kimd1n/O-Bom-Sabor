# O Bom Sabor

Calculadora de preços e custos para iFood.

## Estado atual (v11)
- `calculos.js`: contas puras (preço, margem, cenários, preço mínimo, fichas, insumos), ao lado do app.
- `calculos.test.js`: testes automáticos.
- O `index.html` já usa o `calculos.js` (veja `MIGRACAO.md` para o que falta).

## Rodar os testes
Instale o Node 18 ou mais novo e, na pasta do projeto:

    node --test

Tudo deve aparecer como `pass`. No GitHub, os testes rodam sozinhos a cada envio (aba Actions).

## Publicar
Igual à v10: `index.html`, `calculos.js`, `manifest.webmanifest`, `sw.js` e os ícones no Cloudflare.
