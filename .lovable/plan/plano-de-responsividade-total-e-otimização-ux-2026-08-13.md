# Plano de Responsividade Total e Otimização UX

Este plano detalha as melhorias para tornar a aplicação 100% responsiva em todos os dispositivos e otimizar a usabilidade em telas menores, mantendo a identidade visual do Clima Político.

## Melhorias Globais (CSS)

- Ajustar breakpoints no `src/index.css` para garantir que o contêiner principal e grids se adaptem sem transbordamento.
- Refinar utilitários de grid mobile para suportar layouts de 1 ou 2 colunas dependendo do contexto.
- Garantir que tabelas e abas (`TabsList`) tenham scroll horizontal seguro em mobile.
- Ajustar tipografia fluida para evitar textos gigantes em telas pequenas.

## Páginas de Dashboard

### Visão Geral (`Overview.tsx`)
- Ajustar o seletor de candidatos (`Popover`/`Command`) para ocupar 100% da largura em mobile.
- Otimizar os cards de KPI para um layout mais compacto (2 colunas em mobile).
- Garantir que os gráficos Recharts ocupem o espaço disponível sem quebrar o layout.
- Ajustar o ranking recente para ser empilhável em telas pequenas.

### Monitor em Tempo Real (`RealTimeMonitor.tsx`)
- Otimizar o pipeline de progresso e cards de inteligência para mobile.
- Ajustar a timeline de eventos para usar melhor o espaço vertical em telas estreitas.
- Garantir que links de fontes consumidas sejam fáceis de tocar.

### Análise Regional (`RegionalAnalysis.tsx`)
- Refinar a visualização dos mapas (Brasil e Regiões) para escala fluida.
- Tornar os cards de detalhe (StatePanel/RegionPanel) empilháveis e legíveis em mobile.
- Ajustar as pílulas de período para scroll horizontal.

### Comparação Estratégica (`CandidateComparison.tsx`)
- Otimizar o gráfico de Radar e a Matriz 2x2 para telas menores.
- Ajustar a comparação direta para um formato de lista vertical quando o espaço lateral for insuficiente.
- Refinar cards de SWOT e narrativas para evitar truncamento de texto.

### Radar Político (`RadarPolitico.tsx`)
- Melhorar a legibilidade dos cards de notícias e filtros.
- Garantir que o calendário e seletor de categorias funcionem bem em touch.

## Componentes de UI

- **AppSidebar**: Garantir que o comportamento colapsável seja suave e não interfira no conteúdo principal em tablets.
- **Modais e Diálogos**: Garantir que ocupem quase toda a tela em mobile para facilitar o preenchimento de formulários (ex: `AddCandidateDialog`).
- **Tabelas**: Implementar scroll horizontal consistente em todas as visualizações de dados tabulares.

## Landing Page e Landing Components

- **HeroSection**: Ajustar o tamanho da logo e títulos para mobile.
- **TrendingCandidates**: Otimizar o carrossel para navegação por toque e visibilidade de 1 item por vez em telas muito pequenas.
- **BentoFeatures / PricingPlans**: Garantir transição fluida entre 1, 2 e 3 colunas.

## Detalhes Técnicos

- Uso de `Flexbox` e `CSS Grid` com `minmax` para layouts adaptáveis.
- Implementação de `overflow-x-auto` em contêineres de dados amplos.
- Verificação de `touch-action` e áreas de clique mínimas (44px) para botões mobile.
- Ajustes de `padding` e `gap` via classes utilitárias do Tailwind (`p-4 md:p-6`).
