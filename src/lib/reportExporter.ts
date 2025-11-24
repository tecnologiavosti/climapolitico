import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import * as XLSX from 'xlsx';
import { TraceabilityReportData } from '@/types/traceability';

export type ExportFormat = 'pdf' | 'excel' | 'json';

interface ExportOptions {
  format: ExportFormat;
  filename?: string;
  template?: ReportTemplate;
}

interface ReportTemplate {
  sections: string[];
  styling?: {
    primaryColor?: string;
    fontSize?: number;
    includeCharts?: boolean;
  };
}

export class ReportExporter {
  private data: TraceabilityReportData;
  private template?: ReportTemplate;

  constructor(data: TraceabilityReportData, template?: ReportTemplate) {
    this.data = data;
    this.template = template;
  }

  async export(options: ExportOptions): Promise<void> {
    const { format, filename } = options;
    const baseFilename = filename || `relatorio-rastreabilidade-${new Date().toISOString()}`;

    switch (format) {
      case 'pdf':
        this.exportToPDF(baseFilename);
        break;
      case 'excel':
        this.exportToExcel(baseFilename);
        break;
      case 'json':
        this.exportToJSON(baseFilename);
        break;
    }
  }

  private exportToPDF(filename: string): void {
    const doc = new jsPDF();
    const sections = this.template?.sections || ['all'];
    
    // Header
    doc.setFontSize(20);
    doc.text('Relatório de Rastreabilidade', 14, 20);
    
    doc.setFontSize(12);
    doc.text(`Candidato: ${this.data.metadata.candidateName}`, 14, 30);
    doc.text(`Período: ${new Date(this.data.metadata.periodStart).toLocaleDateString()} - ${new Date(this.data.metadata.periodEnd).toLocaleDateString()}`, 14, 36);
    doc.text(`Gerado em: ${new Date(this.data.metadata.generatedAt).toLocaleString()}`, 14, 42);

    let yPosition = 52;

    // Origin Section
    if (sections.includes('all') || sections.includes('origin')) {
      doc.setFontSize(16);
      doc.text('Origem dos Dados', 14, yPosition);
      yPosition += 10;

      autoTable(doc, {
        startY: yPosition,
        head: [['Rede Social', 'Perfis Únicos', 'Total de Perfis', '% do Total']],
        body: this.data.origin.networks.map(n => [
          n.network,
          n.uniqueProfiles.toString(),
          n.totalProfiles.toString(),
          `${n.percentageOfTotal.toFixed(1)}%`
        ]),
      });

      yPosition = (doc as any).lastAutoTable.finalY + 10;
    }

    // Quantitative Section
    if (sections.includes('all') || sections.includes('quantitative')) {
      if (yPosition > 250) {
        doc.addPage();
        yPosition = 20;
      }

      doc.setFontSize(16);
      doc.text('Métricas Quantitativas', 14, yPosition);
      yPosition += 10;

      const quantData = this.data.quantitative;
      autoTable(doc, {
        startY: yPosition,
        head: [['Métrica', 'Valor']],
        body: [
          ['Total de Perfis', quantData.profiles.total.toString()],
          ['Perfis Únicos', quantData.profiles.unique.toString()],
          ['Total de Posts', quantData.content.totalPosts.toString()],
          ['Total de Comentários', quantData.content.totalComments.toString()],
          ['Total de Interações', quantData.interactions.total.toString()],
          ['Média Interações/Post', quantData.interactions.avgPerPost.toFixed(2)],
        ],
      });

      yPosition = (doc as any).lastAutoTable.finalY + 10;
    }

    // Qualitative Section
    if (sections.includes('all') || sections.includes('qualitative')) {
      if (yPosition > 250) {
        doc.addPage();
        yPosition = 20;
      }

      doc.setFontSize(16);
      doc.text('Análise Qualitativa', 14, yPosition);
      yPosition += 10;

      const sentiment = this.data.qualitative.sentiment.overall;
      autoTable(doc, {
        startY: yPosition,
        head: [['Sentimento', 'Percentual']],
        body: [
          ['Positivo', `${sentiment.positive.toFixed(1)}%`],
          ['Neutro', `${sentiment.neutral.toFixed(1)}%`],
          ['Negativo', `${sentiment.negative.toFixed(1)}%`],
        ],
      });

      yPosition = (doc as any).lastAutoTable.finalY + 10;

      // Top Keywords
      if (this.data.qualitative.themes.topKeywords.length > 0) {
        if (yPosition > 220) {
          doc.addPage();
          yPosition = 20;
        }

        doc.setFontSize(14);
        doc.text('Principais Palavras-Chave', 14, yPosition);
        yPosition += 8;

        autoTable(doc, {
          startY: yPosition,
          head: [['Palavra-Chave', 'Contagem', '%']],
          body: this.data.qualitative.themes.topKeywords.slice(0, 10).map(k => [
            k.keyword,
            k.count.toString(),
            `${k.percentage.toFixed(1)}%`
          ]),
        });

        yPosition = (doc as any).lastAutoTable.finalY + 10;
      }
    }

    // Geographic Section
    if (sections.includes('all') || sections.includes('geographic')) {
      if (yPosition > 200) {
        doc.addPage();
        yPosition = 20;
      }

      doc.setFontSize(16);
      doc.text('Distribuição Geográfica', 14, yPosition);
      yPosition += 10;

      if (this.data.geographic.byState.length > 0) {
        autoTable(doc, {
          startY: yPosition,
          head: [['Estado', 'Menções', 'Perfis', 'Sentimento Dominante']],
          body: this.data.geographic.byState.slice(0, 15).map(s => [
            s.state,
            s.mentions.toString(),
            s.profiles.toString(),
            s.dominantSentiment
          ]),
        });
      }
    }

    // Summary
    if (this.data.summary.length > 0) {
      doc.addPage();
      doc.setFontSize(16);
      doc.text('Resumo Executivo', 14, 20);
      
      doc.setFontSize(11);
      let summaryY = 30;
      this.data.summary.forEach((item, index) => {
        const lines = doc.splitTextToSize(`${index + 1}. ${item}`, 180);
        doc.text(lines, 14, summaryY);
        summaryY += lines.length * 6;
      });
    }

    doc.save(`${filename}.pdf`);
  }

  private exportToExcel(filename: string): void {
    const workbook = XLSX.utils.book_new();

    // Origin Sheet
    const originData = [
      ['Rede Social', 'Perfis Únicos', 'Total de Perfis', '% do Total'],
      ...this.data.origin.networks.map(n => [
        n.network,
        n.uniqueProfiles,
        n.totalProfiles,
        n.percentageOfTotal.toFixed(1) + '%'
      ])
    ];
    const originSheet = XLSX.utils.aoa_to_sheet(originData);
    XLSX.utils.book_append_sheet(workbook, originSheet, 'Origem dos Dados');

    // Quantitative Sheet
    const quantData = this.data.quantitative;
    const quantitativeData = [
      ['Métrica', 'Valor'],
      ['Total de Perfis', quantData.profiles.total],
      ['Perfis Únicos', quantData.profiles.unique],
      ['Total de Posts', quantData.content.totalPosts],
      ['Total de Comentários', quantData.content.totalComments],
      ['Total de Menções', quantData.content.mentions],
      ['Posts por Dia', quantData.content.postsPerDay.toFixed(2)],
      ['Total de Interações', quantData.interactions.total],
      ['Média Interações/Post', quantData.interactions.avgPerPost.toFixed(2)],
    ];
    const quantSheet = XLSX.utils.aoa_to_sheet(quantitativeData);
    XLSX.utils.book_append_sheet(workbook, quantSheet, 'Métricas Quantitativas');

    // Sentiment Sheet
    const sentiment = this.data.qualitative.sentiment.overall;
    const sentimentData = [
      ['Sentimento', 'Percentual'],
      ['Positivo', sentiment.positive.toFixed(1) + '%'],
      ['Neutro', sentiment.neutral.toFixed(1) + '%'],
      ['Negativo', sentiment.negative.toFixed(1) + '%'],
    ];
    const sentimentSheet = XLSX.utils.aoa_to_sheet(sentimentData);
    XLSX.utils.book_append_sheet(workbook, sentimentSheet, 'Sentimento');

    // Keywords Sheet
    if (this.data.qualitative.themes.topKeywords.length > 0) {
      const keywordsData = [
        ['Palavra-Chave', 'Contagem', 'Percentual'],
        ...this.data.qualitative.themes.topKeywords.map(k => [
          k.keyword,
          k.count,
          k.percentage.toFixed(1) + '%'
        ])
      ];
      const keywordsSheet = XLSX.utils.aoa_to_sheet(keywordsData);
      XLSX.utils.book_append_sheet(workbook, keywordsSheet, 'Palavras-Chave');
    }

    // Geographic Sheet
    if (this.data.geographic.byState.length > 0) {
      const geoData = [
        ['Estado', 'Código', 'Menções', 'Perfis', 'Sentimento Dominante', 'Score de Sentimento'],
        ...this.data.geographic.byState.map(s => [
          s.state,
          s.stateCode,
          s.mentions,
          s.profiles,
          s.dominantSentiment,
          s.sentimentScore
        ])
      ];
      const geoSheet = XLSX.utils.aoa_to_sheet(geoData);
      XLSX.utils.book_append_sheet(workbook, geoSheet, 'Distribuição Geográfica');
    }

    // Network Profiles Sheet
    const networkData = [
      ['Rede Social', 'Total', 'Únicos', '% do Total'],
      ...quantData.profiles.byNetwork.map(n => [
        n.network,
        n.total,
        n.unique,
        n.percentageOfTotal.toFixed(1) + '%'
      ])
    ];
    const networkSheet = XLSX.utils.aoa_to_sheet(networkData);
    XLSX.utils.book_append_sheet(workbook, networkSheet, 'Perfis por Rede');

    XLSX.writeFile(workbook, `${filename}.xlsx`);
  }

  private exportToJSON(filename: string): void {
    const dataStr = JSON.stringify(this.data, null, 2);
    const dataBlob = new Blob([dataStr], { type: 'application/json' });
    const url = URL.createObjectURL(dataBlob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${filename}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }
}

export const exportReport = async (
  data: TraceabilityReportData,
  format: ExportFormat,
  template?: ReportTemplate
): Promise<void> => {
  const exporter = new ReportExporter(data, template);
  await exporter.export({ format });
};
