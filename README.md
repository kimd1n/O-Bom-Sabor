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


## Estrutura dos arquivos (v11)

- `index.html`: estrutura das telas e pontos de carregamento dos arquivos.
- `css/base.css`: estilos principais.
- `css/mobile.css`: ajustes de celular e acessibilidade de toque.
- `css/tema-premium.css`: camada visual do tema.
- `js/app-core.js`: núcleo legado do aplicativo; mantido junto para preservar dependências e comportamento nesta etapa.
- `js/vendas.js`: recursos complementares de pedidos/vendas.
- `js/relatorios.js`: relatórios e conveniências de backup.
- `js/revisao-bugs.js`: ajustes pontuais de interface.
- `js/beneficios.js`: ajustes da plataforma/benefícios.
- `js/importacao-ifood.js`: importação de relatório do iFood.
- `calculos.js`: funções de cálculo testáveis.

Os scripts são carregados na ordem em que apareciam no HTML. O núcleo ainda contém funções de mais de uma área que estão acopladas; dividi-las internamente exigiria uma etapa própria, com testes de regressão, para não mudar o funcionamento.
