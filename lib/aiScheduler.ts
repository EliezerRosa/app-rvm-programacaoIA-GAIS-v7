import { GoogleGenAI, Type } from "@google/genai";
import { Publisher, Participation, Rule, Workbook, ParticipationType, AiScheduleResult, SpecialEvent, EventTemplate } from '../types';
import { validateAssignment } from './inferenceEngine';
import { calculatePartDate, PAIRABLE_PART_TYPES, normalizeName } from './utils';
import { performAutoFill, PartToAssign } from './autoFill';
import { getStandardizedScheduleStructure, StandardPart } from './scheduleStructure';

let ai: GoogleGenAI | null = null;

function getAiInstance(): GoogleGenAI {
    if (!ai) {
        if (!process.env.API_KEY) throw new Error("A chave da API do Google GenAI não está configurada.");
        ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
    }
    return ai;
}

interface AiProcessablePart {
    partTitle: string;
    type: ParticipationType;
    duration?: number;
    assignedTo?: string; 
    requiresHelper: boolean;
}

function mapAiTypeToParticipationType(aiType: string, partTitle: string, currentSectionContext: ParticipationType): ParticipationType {
    const titleLower = partTitle.toLowerCase();
    
    // Structural / Fixed Parts
    if (titleLower.includes('oração') && titleLower.includes('inicial')) return ParticipationType.ORACAO_INICIAL;
    if (titleLower.includes('oração') && titleLower.includes('final')) return ParticipationType.ORACAO_FINAL;
    
    // Comentários: Serão refinados pela lógica posicional no getPartsFromWorkbook
    if (titleLower.includes('comentários') && titleLower.includes('finais')) return ParticipationType.COMENTARIOS_FINAIS;
    if (titleLower.includes('comentários') && titleLower.includes('iniciais')) return ParticipationType.PRESIDENTE;
    if (titleLower.includes('comentários')) return ParticipationType.PRESIDENTE; // Default temporário, corrigido depois
    
    // Treasures Section
    if (titleLower.includes('leitura da bíblia')) return ParticipationType.TESOUROS;
    if (titleLower.includes('joias espirituais')) return ParticipationType.TESOUROS;
    
    // Living as Christians Section
    if (titleLower.includes('estudo bíblico') || aiType === 'BIBLE_STUDY') return ParticipationType.DIRIGENTE;
    
    // Ministry Section
    if (aiType === 'STUDENT_PART') {
        if (titleLower.includes('leitura da bíblia')) return ParticipationType.TESOUROS;
        return ParticipationType.MINISTERIO;
    }
    
    if (aiType === 'DISCOURSE') {
        return currentSectionContext; 
    }
    
    return currentSectionContext; // Default fallback
}

const getPartsFromWorkbook = async (
    workbook: Workbook,
    specialEvents: SpecialEvent[],
    eventTemplates: EventTemplate[],
    week: string
): Promise<PartToAssign[]> => {
    let rawExtractedParts: StandardPart[] = [];
    
    try {
        const extracted = await extractScheduleFromPdf(workbook.fileData, week);
        let currentSectionContext = ParticipationType.VIDA_CRISTA;
        const totalParts = extracted.parts.length;

        for (let index = 0; index < totalParts; index++) {
            const item = extracted.parts[index];
            const titleLower = item.part.toLowerCase();

            if (item.type === 'SECTION_HEADER') {
                if (titleLower.includes('tesouros')) currentSectionContext = ParticipationType.TESOUROS;
                else if (titleLower.includes('ministério')) currentSectionContext = ParticipationType.MINISTERIO;
                else if (titleLower.includes('vida cristã')) currentSectionContext = ParticipationType.VIDA_CRISTA;
                continue;
            }

            if (item.type === 'CÂNTICO' || titleLower.includes('término') || titleLower.includes('cântico')) continue;

            let type = mapAiTypeToParticipationType(item.type, item.part, currentSectionContext);
            
            // LÓGICA POSICIONAL PARA COMENTÁRIOS
            // Se for apenas "Comentários" e a IA não especificou, usamos a posição.
            if (titleLower.includes('comentários') && !titleLower.includes('iniciais') && !titleLower.includes('finais')) {
                if (index < 3) {
                    type = ParticipationType.PRESIDENTE; // Início
                } else if (index > totalParts - 4) {
                    type = ParticipationType.COMENTARIOS_FINAIS; // Fim
                }
            }

            let requiresHelper = PAIRABLE_PART_TYPES.includes(type) && !item.part.toLowerCase().includes('discurso');

            let preAssignedTo: string | undefined = undefined;
            if (type === ParticipationType.ORACAO_INICIAL) preAssignedTo = 'Presidente';
            if (type === ParticipationType.COMENTARIOS_FINAIS) preAssignedTo = 'Presidente';
            if (type === ParticipationType.PRESIDENTE && titleLower.includes('comentários')) preAssignedTo = 'Presidente';

            rawExtractedParts.push({
                partTitle: item.part, 
                type: type,
                duration: item.min,
                requiresHelper: requiresHelper,
                preAssignedTo: preAssignedTo
            });
            
            // Auto-Insert Counsel
            const isBibleReading = titleLower.includes('leitura da bíblia');
            const isMinistryStudentPart = type === ParticipationType.MINISTERIO && !titleLower.includes('discurso');
            
            if (isBibleReading || isMinistryStudentPart) {
                rawExtractedParts.push({ 
                    partTitle: 'Aconselhamento', 
                    type: ParticipationType.PRESIDENTE, 
                    duration: 1, 
                    requiresHelper: false, 
                    preAssignedTo: 'Presidente' 
                });
            }
        }

    } catch (error) {
        console.error(`Falha ao analisar o PDF "${workbook.name}" para a semana ${week} com IA.`, error);
    }

    // PADRONIZAÇÃO DA ESTRUTURA
    const standardizedParts = getStandardizedScheduleStructure(rawExtractedParts);

    let finalParts: PartToAssign[] = standardizedParts.map((p, index) => ({
        id: p.id || `std-part-${index}`,
        partTitle: p.partTitle,
        type: p.type,
        duration: p.duration,
        requiresHelper: p.requiresHelper,
        preAssignedTo: p.preAssignedTo
    }));

    // Special Events Logic
    const event = specialEvents.find(e => e.week === week);
    const template = event ? eventTemplates.find(t => t.id === event.templateId) : null;

    if (event && template) {
        const { impact } = template;
        
        if (event.configuration?.timeReduction && event.configuration.timeReduction.minutes > 0) {
            const targetTypeToReduce = event.configuration.timeReduction.targetType;
            const targetPartIndex = finalParts.findIndex(p => p.type === targetTypeToReduce);
            if (targetPartIndex !== -1) {
                finalParts[targetPartIndex] = {
                    ...finalParts[targetPartIndex],
                    duration: (finalParts[targetPartIndex].duration || 30) - event.configuration.timeReduction.minutes,
                };
            }
        }

        const specialPart: PartToAssign = {
            id: 'special-event',
            partTitle: event.theme,
            type: ParticipationType.VIDA_CRISTA, 
            duration: event.duration,
            preAssignedTo: event.assignedTo, 
            requiresHelper: false, 
        };

        if (impact.action === 'REPLACE_PART' || impact.action === 'REPLACE_SECTION') {
            const targetTypes = new Set(Array.isArray(impact.targetType) ? impact.targetType : [impact.targetType]);
            finalParts = finalParts.filter(p => !targetTypes.has(p.type));
        }
        
        let lastLifeIndex = -1;
        for (let i = finalParts.length - 1; i >= 0; i--) {
            if (finalParts[i].type === ParticipationType.VIDA_CRISTA) {
                lastLifeIndex = i;
                break;
            }
        }

        if (lastLifeIndex !== -1) {
             finalParts.splice(lastLifeIndex + 1, 0, specialPart);
        } else {
             finalParts.push(specialPart);
        }

        if (template.name.toLowerCase().includes('superintendente') && specialPart.preAssignedTo) {
            const finalCommentsPartIndex = finalParts.findIndex(p => p.type === ParticipationType.COMENTARIOS_FINAIS);
            if (finalCommentsPartIndex !== -1) {
                finalParts[finalCommentsPartIndex] = {
                    ...finalParts[finalCommentsPartIndex],
                    preAssignedTo: specialPart.preAssignedTo, 
                };
            }
        }
    }

    return finalParts.filter(p => (p.duration === undefined || p.duration > 0));
};

export async function generateAiSchedule(
    workbook: Workbook,
    week: string,
    publishers: Publisher[],
    history: Participation[],
    rules: Rule[],
    specialEvents: SpecialEvent[],
    eventTemplates: EventTemplate[]
): Promise<AiScheduleResult[]> {
    
    const partsToFill = await getPartsFromWorkbook(workbook, specialEvents, eventTemplates, week);
    
    if (partsToFill.length === 0) {
        throw new Error(`Não foram encontradas partes para a semana ${week}.`);
    }

    const autoAssignments = performAutoFill(
        partsToFill,
        {}, 
        publishers,
        history,
        rules,
        week
    );

    const results: AiScheduleResult[] = [];
    const publisherLookup = new Map<string, Publisher>();
    publishers.forEach(p => publisherLookup.set(p.id, p));

    partsToFill.forEach(part => {
        const assign = autoAssignments[part.id];
        
        let studentName = 'Não Designado';
        let helperName = null;
        let reason = 'Gerado automaticamente';

        if (part.preAssignedTo === 'Presidente') {
            const presPart = partsToFill.find(p => p.type === ParticipationType.PRESIDENTE && p.partTitle === 'Presidente');
            if (presPart) {
                 const presId = autoAssignments[presPart.id]?.studentId;
                 const pres = publisherLookup.get(presId!);
                 studentName = pres ? pres.name : 'Presidente (Não definido)';
            } else {
                studentName = 'Presidente';
            }
        } else if (part.preAssignedTo) {
             studentName = part.preAssignedTo;
             reason = 'Pré-designado por evento/regra';
        } else if (assign?.studentId) {
            const pub = publisherLookup.get(assign.studentId);
            if (pub) studentName = pub.name;
        }

        if (assign?.helperId) {
            const help = publisherLookup.get(assign.helperId);
            if (help) helperName = help.name;
        }

        results.push({
            partTitle: part.partTitle,
            studentName,
            helperName,
            reason
        });
    });

    return results;
}

export interface ExtractedSchedule {
    header: string;
    parts: {
        part: string;
        min: number;
        type: 'CÂNTICO' | 'SECTION_HEADER' | 'DISCOURSE' | 'STUDENT_PART' | 'CLOSING' | 'BIBLE_STUDY';
    }[];
}

const weeksIdentificationSchema = {
    type: Type.OBJECT,
    properties: {
        weeks: {
            type: Type.ARRAY,
            description: "Lista das datas das semanas encontradas no documento (ex: '3-9 DE NOVEMBRO', '10-16 DE NOVEMBRO').",
            items: { type: Type.STRING }
        }
    },
    required: ["weeks"]
};

export async function identifyWeeksInPdf(base64Pdf: string): Promise<string[]> {
    try {
        const ai = getAiInstance();
        const prompt = `Liste todas as datas de semanas (ex: 3-9 de Novembro) encontradas nesta apostila. Retorne apenas a lista de strings.`;
        
        const cleanBase64 = base64Pdf.includes(',') ? base64Pdf.split(',')[1] : base64Pdf;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                { role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: 'application/pdf', data: cleanBase64 } }] }
            ],
            config: {
                responseMimeType: "application/json",
                responseSchema: weeksIdentificationSchema,
            }
        });

        const result = JSON.parse(response.text.trim()) as { weeks: string[] };
        return result.weeks || [];

    } catch (error) {
        console.error("Erro ao identificar semanas com IA:", error);
        throw new Error("Falha ao ler as semanas do arquivo PDF.");
    }
}

const extractionSchema = {
    type: Type.OBJECT,
    properties: {
        header: { type: Type.STRING },
        parts: {
            type: Type.ARRAY,
            items: {
                type: Type.OBJECT,
                properties: {
                    part: { type: Type.STRING, description: "O título exato da parte, INCLUINDO A NUMERAÇÃO ORIGINAL se houver (ex: '1. Discurso', '2. Joias')." },
                    min: { type: Type.INTEGER },
                    type: { type: Type.STRING, description: "Classificação: 'CÂNTICO', 'SECTION_HEADER', 'DISCOURSE', 'STUDENT_PART', 'CLOSING', 'BIBLE_STUDY'." }
                },
                required: ["part", "min", "type"]
            }
        }
    },
    required: ["header", "parts"]
};

export async function extractScheduleFromPdf(base64Pdf: string, targetWeek?: string): Promise<ExtractedSchedule> {
    try {
        const ai = getAiInstance();
        const prompt = targetWeek 
            ? `Extraia a pauta DETALHADA APENAS para a semana de "${targetWeek}" deste documento. Mantenha a ordem original.`
            : `Extraia a pauta da primeira semana encontrada neste documento.`;
        
        const systemInstruction = `
            Você é um analista de pautas. Seu trabalho é extrair a programação de uma única semana da apostila.
            Siga estas regras de classificação rigorosamente:
            1. Extraia o Cabeçalho da Semana.
            2. Liste TODAS as partes em ordem cronológica estrita, conforme aparecem na página. NÃO REORDENE.
            3. **IMPORTANTE: Mantenha a numeração original no início do título da parte (ex: "1. Discurso", "2. Joias"). Não remova os números.**
            4. **Durações:**
               - CÂNTICOS: 3 min.
               - Comentários/Orações: 1 min.
               - Estudo Bíblico de Congregação: 30 min.
               - Outras partes: use o tempo indicado no texto.
            5. **Tipos (Classificação):**
               - 'SECTION_HEADER': Para 'TESOUROS DA PALAVRA DE DEUS', 'FAÇA SEU MELHOR NO MINISTÉRIO', 'NOSSA VIDA CRISTÃ', 'ENCERRAMENTO'.
               - 'CÂNTICO': Para todos os cânticos.
               - 'DISCOURSE': Para discursos de 10 min (Tesouros), 15 min (Vida Cristã), Necessidades Locais.
               - 'STUDENT_PART': Para 'Leitura da Bíblia' e partes do Ministério (Iniciando conversas, etc).
               - 'BIBLE_STUDY': Exclusivamente para o 'Estudo bíblico de congregação'.
               - 'CLOSING': Para Oração Final e Comentários Finais.
            6. A resposta deve ser um JSON estruturado.
        `;

        const cleanBase64 = base64Pdf.includes(',') ? base64Pdf.split(',')[1] : base64Pdf;

        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                { role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: 'application/pdf', data: cleanBase64 } }] }
            ],
            config: {
                responseMimeType: "application/json",
                responseSchema: extractionSchema,
                systemInstruction: systemInstruction,
            }
        });

        return JSON.parse(response.text.trim()) as ExtractedSchedule;

    } catch (error) {
        console.error("Erro na extração de PDF via IA:", error);
        throw new Error("Falha ao processar o PDF com IA. Verifique se o arquivo é válido.");
    }
}