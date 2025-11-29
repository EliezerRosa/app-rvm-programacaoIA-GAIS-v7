import { ParticipationType } from '../types';

// pdfjsLib será injetado globalmente pela tag de script no index.html
declare const pdfjsLib: any;

type ParsedPart = { partTitle: string; type: ParticipationType; duration?: number; requiresHelper?: boolean; assignedTo?: string };

/**
 * Converte uma string base64 para um Uint8Array de forma robusta.
 */
function b64toUint8Array(b64: string): Uint8Array {
    if (!b64) throw new Error("Conteúdo do arquivo PDF vazio.");
    const cleanBase64 = b64.includes(',') ? b64.split(',')[1] : b64;
    try {
        const binStr = atob(cleanBase64.replace(/\s/g, '')); 
        const len = binStr.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
            bytes[i] = binStr.charCodeAt(i);
        }
        return bytes;
    } catch (e) {
        console.error("Erro ao decodificar Base64 do PDF:", e);
        throw new Error("O arquivo PDF parece estar corrompido ou inválido.");
    }
}

export function groupTextItemsIntoLines(items: any[]): string[] {
    if (!items || items.length === 0) return [];
    const sortedItems = [...items].sort((a, b) => {
        const y1 = a.transform[5]; const y2 = b.transform[5];
        if (Math.abs(y1 - y2) > 4) return y2 - y1; 
        return a.transform[4] - b.transform[4];
    });
    const lines: { text: string; y: number }[] = [];
    if (sortedItems.length === 0) return [];
    let currentLine: { items: any[] } = { items: [sortedItems[0]] };
    for (let i = 1; i < sortedItems.length; i++) {
        const prevItem = currentLine.items[currentLine.items.length - 1];
        const currentItem = sortedItems[i];
        if (Math.abs(prevItem.transform[5] - currentItem.transform[5]) < 6) {
            currentLine.items.push(currentItem);
        } else {
            lines.push({ text: currentLine.items.map(it => it.str).join(' '), y: prevItem.transform[5] });
            currentLine = { items: [currentItem] };
        }
    }
    lines.push({ text: currentLine.items.map(it => it.str).join(' '), y: currentLine.items[0].transform[5] });
    return lines.map(line => line.text.trim().replace(/\s+/g, ' '));
}

// --- LÓGICA DE TEXTO PURO ---

function needsCounseling(partTitle: string): boolean {
    const ministryKeywords = [
        "Leitura da Bíblia",
        "Iniciando conversas",
        "Cultivando o interesse",
        "Fazendo discípulos",
        "Explicando suas crenças"
    ];
    // Remove numeração apenas para verificar a palavra-chave
    const cleanTitle = partTitle.replace(/^\d+\.\s*/, '');
    return ministryKeywords.some(keyword => cleanTitle.includes(keyword));
}

export function parseScheduleFromPlainText(text: string): { week: string, parts: ParsedPart[] } {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
    const parts: ParsedPart[] = [];
    
    // 1. Identificar Semana
    const weekRegex = /(\d{1,2})\s*[-–—a]\s*(\d{1,2})\s+de\s+([a-zA-ZçÇ]+)|(\d{1,2})\s+de\s+([a-zA-ZçÇ]+)\s*[-–—a]\s*(\d{1,2})\s+de\s+([a-zA-ZçÇ]+)/i;
    let weekLabel = '';
    
    for (let i = 0; i < Math.min(lines.length, 5); i++) {
        const match = lines[i].match(weekRegex);
        if (match) {
            weekLabel = match[0].replace(/\s+/g, ' ').trim().toUpperCase();
            break;
        }
    }

    let currentSection: ParticipationType | null = null;
    
    // Partes Fixas Iniciais
    parts.push({ partTitle: 'Presidente', type: ParticipationType.PRESIDENTE, duration: 0 }); 
    parts.push({ partTitle: 'Oração Inicial', type: ParticipationType.ORACAO_INICIAL, duration: 1 });
    parts.push({ partTitle: 'Comentários Iniciais', type: ParticipationType.PRESIDENTE, duration: 1, assignedTo: 'Presidente' }); 

    for (const line of lines) {
        const upperLine = line.toUpperCase();

        // --- Identificação de Seção ---
        if (upperLine.includes("TESOUROS DA PALAVRA DE DEUS")) {
            currentSection = ParticipationType.TESOUROS;
            continue;
        } else if (upperLine.includes("FAÇA SEU MELHOR NO MINISTÉRIO") || upperLine.includes("FAÇA SEU MELHOR NO MINISTERIO")) {
            currentSection = ParticipationType.MINISTERIO;
            continue;
        } else if (upperLine.includes("NOSSA VIDA CRISTÃ") || upperLine.includes("NOSSA VIDA CRISTA")) {
            currentSection = ParticipationType.VIDA_CRISTA;
            continue;
        } else if (upperLine.includes("ENCERRAMENTO")) {
            continue;
        }

        // --- Processamento de Linhas ---

        // 1. Cânticos
        if (line.match(/(?:^|•)\s*(?:Cântico|Cantico)\s+(\d+)/i)) {
            const songNum = line.match(/\d+/)?.[0] || '';
            parts.push({ partTitle: `Cântico ${songNum}`, type: ParticipationType.CANTICO, duration: 3 });
            continue;
        }

        // 2. Partes Numeradas com Duração (ex: "1. Título (10 min)")
        const partMatch = line.match(/^(\d+\.)\s*(.*?)\s*\((\d+)\s*min\)/);
        if (partMatch && currentSection) {
            const [, numStr, rawTitle, durationStr] = partMatch;
            const cleanTitle = rawTitle.trim();
            const duration = parseInt(durationStr, 10);
            
            // MANTÉM A NUMERAÇÃO NO TÍTULO
            const fullTitle = `${numStr} ${cleanTitle}`;
            
            let type = currentSection;
            let requiresHelper = false;

            // Refinamento de Tipo
            if (currentSection === ParticipationType.VIDA_CRISTA && cleanTitle.toLowerCase().includes('estudo bíblico')) {
                type = ParticipationType.DIRIGENTE;
            }

            // Define se precisa de ajudante (Ministério)
            if (currentSection === ParticipationType.MINISTERIO) {
                if (!cleanTitle.toLowerCase().includes('discurso') && !cleanTitle.toLowerCase().includes('leitura da bíblia')) {
                    requiresHelper = true;
                }
            }

            parts.push({ 
                partTitle: fullTitle, // Ex: "1. Discurso"
                type, 
                duration,
                requiresHelper
            });

            // Regra de Aconselhamento
            if (needsCounseling(cleanTitle)) {
                parts.push({
                    partTitle: 'Aconselhamento',
                    type: ParticipationType.PRESIDENTE, 
                    duration: 1,
                    assignedTo: 'Presidente' 
                });
            }
            continue;
        }
        
        // 3. Partes de Vida Cristã sem número (ex: Necessidades Locais)
        if (currentSection === ParticipationType.VIDA_CRISTA && line.match(/\(\d+\s*min\)/)) {
             const durationMatch = line.match(/\((\d+)\s*min\)/);
             const duration = durationMatch ? parseInt(durationMatch[1], 10) : 10;
             const cleanTitle = line.replace(/\(\d+\s*min\)/, '').trim(); 
             
             if (!parts.some(p => p.partTitle.includes(cleanTitle))) {
                 let type = ParticipationType.VIDA_CRISTA;
                 if (cleanTitle.toLowerCase().includes('estudo bíblico')) type = ParticipationType.DIRIGENTE;
                 
                 parts.push({ partTitle: cleanTitle, type, duration });
             }
        }
    }

    // --- Partes Finais Fixas ---
    if (!parts.some(p => p.type === ParticipationType.COMENTARIOS_FINAIS)) {
        parts.push({ partTitle: 'Comentários Finais', type: ParticipationType.COMENTARIOS_FINAIS, duration: 3, assignedTo: 'Presidente' });
    }
    
    if (!parts.some(p => p.type === ParticipationType.ORACAO_FINAL)) {
        parts.push({ partTitle: 'Oração Final', type: ParticipationType.ORACAO_FINAL, duration: 1 });
    }
    
    const studyIndex = parts.findIndex(p => p.type === ParticipationType.DIRIGENTE);
    if (studyIndex !== -1 && !parts.some(p => p.type === ParticipationType.LEITOR)) {
        parts.splice(studyIndex + 1, 0, { partTitle: 'Leitor do EBC', type: ParticipationType.LEITOR, duration: 0 });
    }

    return { week: weekLabel, parts };
}

export interface ExtractedWeek { id: string; label: string; pageIndex: number; content: any; }
export async function extractWeeksFromPdf(base64Pdf: string): Promise<ExtractedWeek[]> { return []; } 
export function parsePartsFromContent(pageContent: any): ParsedPart[] { return []; } 
export async function parseScheduleFromPdf(base64Pdf: string, targetWeekId: string): Promise<ParsedPart[]> { return []; }