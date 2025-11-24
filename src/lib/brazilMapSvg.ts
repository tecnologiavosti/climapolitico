// Brazil states SVG paths with coordinates
export interface BrazilState {
  code: string;
  name: string;
  path: string;
}

export const brazilStates: BrazilState[] = [
  {
    code: "AC",
    name: "Acre",
    path: "M150,300 L180,300 L180,330 L150,330 Z"
  },
  {
    code: "AL",
    name: "Alagoas",
    path: "M520,280 L545,280 L545,305 L520,305 Z"
  },
  {
    code: "AP",
    name: "Amapá",
    path: "M320,50 L350,50 L350,100 L320,100 Z"
  },
  {
    code: "AM",
    name: "Amazonas",
    path: "M100,150 L280,150 L280,280 L100,280 Z"
  },
  {
    code: "BA",
    name: "Bahia",
    path: "M420,280 L520,280 L520,400 L420,400 Z"
  },
  {
    code: "CE",
    name: "Ceará",
    path: "M450,200 L520,200 L520,260 L450,260 Z"
  },
  {
    code: "DF",
    name: "Distrito Federal",
    path: "M385,345 L395,345 L395,355 L385,355 Z"
  },
  {
    code: "ES",
    name: "Espírito Santo",
    path: "M475,410 L500,410 L500,440 L475,440 Z"
  },
  {
    code: "GO",
    name: "Goiás",
    path: "M350,320 L420,320 L420,400 L350,400 Z"
  },
  {
    code: "MA",
    name: "Maranhão",
    path: "M350,190 L450,190 L450,260 L350,260 Z"
  },
  {
    code: "MT",
    name: "Mato Grosso",
    path: "M280,280 L380,280 L380,380 L280,380 Z"
  },
  {
    code: "MS",
    name: "Mato Grosso do Sul",
    path: "M300,400 L380,400 L380,480 L300,480 Z"
  },
  {
    code: "MG",
    name: "Minas Gerais",
    path: "M400,380 L500,380 L500,460 L400,460 Z"
  },
  {
    code: "PA",
    name: "Pará",
    path: "M280,100 L420,100 L420,220 L280,220 Z"
  },
  {
    code: "PB",
    name: "Paraíba",
    path: "M520,230 L550,230 L550,255 L520,255 Z"
  },
  {
    code: "PR",
    name: "Paraná",
    path: "M360,480 L440,480 L440,540 L360,540 Z"
  },
  {
    code: "PE",
    name: "Pernambuco",
    path: "M480,240 L545,240 L545,285 L480,285 Z"
  },
  {
    code: "PI",
    name: "Piauí",
    path: "M400,200 L450,200 L450,280 L400,280 Z"
  },
  {
    code: "RJ",
    name: "Rio de Janeiro",
    path: "M460,450 L500,450 L500,475 L460,475 Z"
  },
  {
    code: "RN",
    name: "Rio Grande do Norte",
    path: "M510,210 L550,210 L550,235 L510,235 Z"
  },
  {
    code: "RS",
    name: "Rio Grande do Sul",
    path: "M340,540 L420,540 L420,600 L340,600 Z"
  },
  {
    code: "RO",
    name: "Rondônia",
    path: "M200,300 L280,300 L280,360 L200,360 Z"
  },
  {
    code: "RR",
    name: "Roraima",
    path: "M240,20 L310,20 L310,100 L240,100 Z"
  },
  {
    code: "SC",
    name: "Santa Catarina",
    path: "M380,520 L460,520 L460,560 L380,560 Z"
  },
  {
    code: "SP",
    name: "São Paulo",
    path: "M420,440 L490,440 L490,500 L420,500 Z"
  },
  {
    code: "SE",
    name: "Sergipe",
    path: "M520,260 L545,260 L545,282 L520,282 Z"
  },
  {
    code: "TO",
    name: "Tocantins",
    path: "M350,240 L400,240 L400,330 L350,330 Z"
  }
];

export const stateNameToCode: Record<string, string> = {
  "Acre": "AC",
  "Alagoas": "AL",
  "Amapá": "AP",
  "Amapa": "AP",
  "Amazonas": "AM",
  "Bahia": "BA",
  "Ceará": "CE",
  "Ceara": "CE",
  "Distrito Federal": "DF",
  "Espírito Santo": "ES",
  "Espirito Santo": "ES",
  "Goiás": "GO",
  "Goias": "GO",
  "Maranhão": "MA",
  "Maranhao": "MA",
  "Mato Grosso": "MT",
  "Mato Grosso do Sul": "MS",
  "Minas Gerais": "MG",
  "Pará": "PA",
  "Para": "PA",
  "Paraíba": "PB",
  "Paraiba": "PB",
  "Paraná": "PR",
  "Parana": "PR",
  "Pernambuco": "PE",
  "Piauí": "PI",
  "Piaui": "PI",
  "Rio de Janeiro": "RJ",
  "Rio Grande do Norte": "RN",
  "Rio Grande do Sul": "RS",
  "Rondônia": "RO",
  "Rondonia": "RO",
  "Roraima": "RR",
  "Santa Catarina": "SC",
  "São Paulo": "SP",
  "Sao Paulo": "SP",
  "Sergipe": "SE",
  "Tocantins": "TO"
};

export const getColorForScore = (score: number): string => {
  if (score >= 80) return "hsl(142, 76%, 36%)"; // Green - High potential
  if (score >= 60) return "hsl(78, 92%, 45%)"; // Lime - Good potential
  if (score >= 40) return "hsl(43, 96%, 56%)"; // Yellow - Medium potential
  if (score >= 20) return "hsl(25, 95%, 53%)"; // Orange - Low potential
  return "hsl(0, 84%, 60%)"; // Red - Very low potential
};

export const noDataColor = "hsl(220, 13%, 91%)"; // Gray - No data
