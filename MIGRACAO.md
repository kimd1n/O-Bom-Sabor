# Mapa de migração (index.html -> calculos.js)

**Status (v11):** todas as linhas da tabela abaixo já foram trocadas no index.html (as funções antigas viraram chamadas ao `calculos.js`). Pendente: `totaisDoPedido` e a taxa 0% (cuidados 1 a 3).

| index.html (linha) | calculos.js | Observação |
|---|---|---|
| `calcularNumerosItemPedido` (2020) | `calcularNumerosItemPedido` | Mesma assinatura (taxa em %) |
| conta de `calcularNumerosItemPedido` / `atualizarCalculoHistorico` (1853) | `calcularRepasse` | taxa em fração |
| `calcular()` (1572), cenários promoção/frete | `calcularCenariosIfood` | Só a conta; a tela continua no index |
| `calcProdutoCenarios` (2877) | `calcularCenariosIfood` | `lucroI` vira `lucroPior` |
| `precoMinimoIfoodParaMeta` (2951) e `minI` dentro de `simularProduto` (2877+) | `precoMinimoParaMeta` | Hoje a conta existe 2 vezes |
| `fichaCustoAtual` (2861) / `custoAtualFichaSalva` (1672) | `custoFichaAtual` + `custoFichaPorRendimento` | O custo de cada item (insumo/receita) ainda vem do index |
| `custoProdutoCat_` (3383) | `custoDoProduto` | |
| `miDadosCalculo` (1709) | `custoInsumoPorUnidade` | |

## Cuidados na troca
1. `calcular()` e `calcularItemPorPlataforma` usam `|| 26.2`: taxa 0 vira 26,2. Trocar por checagem explícita.
2. `calcular()` lê a taxa do campo da tela; Produtos lê das Configurações. Decidir uma fonte só.
3. `totaisDoPedido` existe duas vezes (2151 e 3070; vale a 3070). Ainda não extraída: fica para o próximo passo.
4. Trocar uma função por vez, rodar `node --test` e conferir na tela (roteiro de conferência).
