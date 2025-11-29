import { MeetingData, Participation, ParticipationType, Publisher, SpecialEvent, EventTemplate, EventImpact } from '../types';
import { getStandardizedScheduleStructure, StandardPart } from './scheduleStructure';

export type RenderablePart = Participation & { pair?: Participation };

export const ministrySubOrder = ["Iniciando conversas", "Cultivando o interesse", "Fazendo discípulos", "Explicando suas crenças", "Discurso"];

export interface TimedEvent {
    id: string;
    startTime: string;
    partTitle: string;
    publisherName: string;
    durationText: string;
    sectionType: ParticipationType | 'OPENING' | 'TRANSITION' | 'CLOSING' | 'COMMENTS';
    isCounseling?: boolean;
}

function applyEventImpact(
    parts: RenderablePart[], 
    event: SpecialEvent, 
    template: EventTemplate
): RenderablePart[] {
    const { impact } = template;
    const { configuration } = event;

    let modifiedParts = [...parts];
    
    // 1. Aplicar redução de tempo, se houver
    if (configuration.timeReduction && configuration.timeReduction.minutes > 0) {
        const targetIndex = modifiedParts.findIndex(p => p.type === configuration.timeReduction!.targetType);
        if (targetIndex !== -1) {
            modifiedParts[targetIndex] = {
                ...modifiedParts[targetIndex],
                duration: (modifiedParts[targetIndex].duration || 30) - configuration.timeReduction.minutes,
            };
        }
    }

    const specialPart: RenderablePart = {
        id: event.id,
        publisherName: event.assignedTo,
        week: event.week,
        partTitle: event.theme,
        type: ParticipationType.VIDA_CRISTA,
        duration: event.duration,
        date: new Date().toISOString()
    };
    
    // 2. Aplicar impacto principal do template
    switch (impact.action) {
        case 'REPLACE_PART':
            const targetType = Array.isArray(impact.targetType) ? impact.targetType[0] : impact.targetType;
            const partIndexToReplace = modifiedParts.findIndex(p => p.type === targetType);
            if (partIndexToReplace !== -1) {
                modifiedParts.splice(partIndexToReplace, 1, specialPart);
            } else {
                 // Fallback: se a parte alvo não existe, adiciona no final da seção Vida Cristã
                 const lastLifePartIndex = modifiedParts.map(p=>p.type).lastIndexOf(ParticipationType.VIDA_CRISTA);
                 modifiedParts.splice(lastLifePartIndex + 1, 0, specialPart);
            }
            break;
        case 'REPLACE_SECTION':
            const targetTypes = new Set(impact.targetType as ParticipationType[]);
            modifiedParts = modifiedParts.filter(p => !targetTypes.has(p.type));
            modifiedParts.push(specialPart);
            break;
        case 'ADD_PART':
             const studyIndex = modifiedParts.findIndex(p => p.type === ParticipationType.DIRIGENTE);
             if (studyIndex > -1) {
                 modifiedParts.splice(studyIndex, 0, specialPart);
             } else {
                 modifiedParts.push(specialPart);
             }
            break;
    }
    
    // 3. Aplicar regras especiais (como reatribuição)
    if (template.name.toLowerCase().includes('superintendente')) {
        const finalCommentsIndex = modifiedParts.findIndex(p => p.type === ParticipationType.COMENTARIOS_FINAIS);
        if(finalCommentsIndex > -1) {
            modifiedParts[finalCommentsIndex] = { ...modifiedParts[finalCommentsIndex], publisherName: event.assignedTo };
        }
    }

    return modifiedParts;
}


export function getFullScheduleWithTimings(meetingData: MeetingData, publishers: Publisher[], specialEvents: SpecialEvent[], eventTemplates: EventTemplate[]): TimedEvent[] {
    const timedEvents: TimedEvent[] = [];
    let currentTime = new Date();
    currentTime.setHours(19, 30, 0, 0);

    const addMinutes = (date: Date, minutes: number) => new Date(date.getTime() + minutes * 60000);
    const formatTime = (date: Date) => date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

    const eventForWeek = specialEvents.find(e => e.week === meetingData.week);
    const templateForEvent = eventForWeek ? eventTemplates.find(t => t.id === eventForWeek.templateId) : undefined;
    
    // 1. Pair parts first (Student/Helper) and preserve relative order
    let parts = getOrderedAndPairedParts(meetingData.parts, publishers);

    // 2. Apply Special Events logic (Replace/Add parts)
    if (eventForWeek && templateForEvent) {
        parts = applyEventImpact(parts, eventForWeek, templateForEvent);
    }
    
    // 3. Iterate SEQUENTIALLY to build timeline
    // CRITICAL FIX: We stop filtering/grouping by type here. We trust the 'parts' array order.
    
    for (const part of parts) {
        let duration = part.duration || 0;
        let sectionType: TimedEvent['sectionType'] = part.type;
        
        // Set standardized durations if missing or specific types
        if (part.type === ParticipationType.CANTICO) {
            duration = 3;
        }
        if (part.type === ParticipationType.ORACAO_INICIAL) {
            duration = 1;
            sectionType = 'OPENING';
        }
        if (part.type === ParticipationType.ORACAO_FINAL) {
            duration = 1;
            sectionType = 'CLOSING';
        }
        if (part.type === ParticipationType.COMENTARIOS_FINAIS) {
            duration = 3;
            sectionType = 'CLOSING';
        }
        if (part.partTitle === 'Presidente') {
            duration = 0; 
            sectionType = 'OPENING';
        }
        if (part.partTitle === 'Comentários Iniciais') {
            duration = 1;
            sectionType = 'OPENING'; 
        }

        // Override sectionType for known fixed parts to help UI grouping/coloring
        if (part.type === ParticipationType.PRESIDENTE || part.type === ParticipationType.ORACAO_INICIAL || part.partTitle === 'Comentários Iniciais') {
             sectionType = 'OPENING';
        }

        let name = part.publisherName;
        if (part.pair) {
            // Ensure Student Name comes first, then Helper
            name = `${part.publisherName} / ${part.pair.publisherName}`;
        }

        timedEvents.push({
            id: part.id,
            startTime: formatTime(currentTime),
            // FIX: Use raw title without prepending numbers. The saved title already has numbers.
            partTitle: part.partTitle,
            publisherName: name,
            durationText: duration > 0 ? `(${duration} min)` : '',
            sectionType: sectionType
        });

        // Auto-insert Counsel (Aconselhamento) logic for timeline display
        const isBibleReading = part.partTitle.toLowerCase().includes('leitura da bíblia');
        const isMinistryStudentPart = part.type === ParticipationType.MINISTERIO && !part.partTitle.toLowerCase().includes('discurso');
        
        // Check if we have a President assigned to add their name to counsel
        const presidentPart = parts.find(p => p.type === ParticipationType.PRESIDENTE);
        const presidentName = presidentPart ? presidentPart.publisherName : '';

        if ((isBibleReading || isMinistryStudentPart) && presidentName) {
             currentTime = addMinutes(currentTime, duration); // Add part duration first
             
             // Add Counsel line
             timedEvents.push({
                id: `counsel-${part.id}`,
                startTime: formatTime(currentTime),
                partTitle: 'Aconselhamento',
                publisherName: presidentName,
                durationText: '(1 min)',
                sectionType: part.type, // Keep same section color
                isCounseling: true
            });
            
            duration = 1; // Set duration to 1 for the counsel part increment
        }

        currentTime = addMinutes(currentTime, duration);
    }

    return timedEvents;
}


export function getOrderedAndPairedParts(parts: Participation[], publishers: Publisher[]): RenderablePart[] {
    const paired: RenderablePart[] = [];
    const usedPairIds = new Set<string>();

    // We must preserve the original order of 'parts' as much as possible.
    // The input 'parts' should already be sorted by the AI/Manual logic (Standardized Structure).
    
    for (let i = 0; i < parts.length; i++) {
        const currentPart = parts[i];
        
        if (usedPairIds.has(currentPart.id)) continue;
        
        // Skip standalone Helper/Reader parts, they will be attached to their main part logic below
        if ([ParticipationType.AJUDANTE, ParticipationType.LEITOR].includes(currentPart.type)) {
            continue;
        }
        
        // PAIRING LOGIC
        if (currentPart.type === ParticipationType.MINISTERIO && !currentPart.partTitle.toLowerCase().includes('discurso')) {
            // Look ahead for the next 'Ajudante' part in the list
            // Simple proximity search: find the first available helper after this part
            const helper = parts.slice(i + 1).find(p => p.type === ParticipationType.AJUDANTE && !usedPairIds.has(p.id));
            
            if (helper) {
                paired.push({ ...currentPart, pair: helper });
                usedPairIds.add(helper.id);
            } else {
                paired.push(currentPart);
            }
        } else if (currentPart.type === ParticipationType.DIRIGENTE) {
             // Look ahead for the next 'Leitor' part
            const reader = parts.slice(i + 1).find(p => p.type === ParticipationType.LEITOR && !usedPairIds.has(p.id));
            
            if (reader) {
                paired.push({ ...currentPart, pair: reader });
                usedPairIds.add(reader.id);
            } else {
                paired.push(currentPart);
            }
        } else {
             paired.push(currentPart);
        }
    }

    return paired;
}