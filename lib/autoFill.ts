import { Publisher, Participation, ParticipationType, Rule } from '../types';
import { normalizeName, validatePairing, parseWeekDate } from './utils';
import { validateAssignment } from './inferenceEngine';

export interface PartToAssign {
    id: string;
    partTitle: string;
    type: ParticipationType;
    duration?: number;
    requiresHelper: boolean;
    preAssignedTo?: string; // Nome ou 'Presidente'
}

export interface AssignmentState {
    studentId: string;
    helperId?: string;
}

interface Candidate {
    publisher: Publisher;
    isValid: boolean;
    reason?: string;
    lastDate: number;
}

export const getSortedCandidates = (
    part: PartToAssign, 
    isHelper: boolean,
    publishers: Publisher[],
    participations: Participation[],
    rules: Rule[],
    weekLabel: string,
    showBlocked: boolean = false,
    sortBy: 'lastDate' | 'name' = 'lastDate'
): Candidate[] => {
    const targetType = isHelper ? ParticipationType.AJUDANTE : part.type;
    const targetTitle = isHelper ? 'Ajudante' : part.partTitle;
    
    const parsedDate = parseWeekDate(weekLabel);
    const meetingDate = parsedDate.getTime() !== 0 ? parsedDate.toISOString().split('T')[0] : new Date().toISOString().split('T')[0];

    // 1. Filter
    const candidates = publishers.map(p => {
        if (!p.isServing) return { publisher: p, isValid: false, reason: 'Não Atuante' };
        
        const validation = validateAssignment({ publisher: p, partType: targetType, partTitle: targetTitle, meetingDate }, rules);
        return { publisher: p, isValid: validation.isValid, reason: validation.reason };
    });

    // 2. Calc Stats
    const candidatesWithStats = candidates.map(c => {
        const history = participations
            .filter(h => normalizeName(h.publisherName) === normalizeName(c.publisher.name) && h.type === targetType)
            .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        const lastDate = history.length > 0 ? new Date(history[0].date).getTime() : 0;
        return { ...c, lastDate };
    });

    // 3. Sort
    return candidatesWithStats
        .filter(c => showBlocked || c.isValid)
        .sort((a, b) => {
            if (sortBy === 'name') return a.publisher.name.localeCompare(b.publisher.name);
            
            if (a.isValid !== b.isValid) return a.isValid ? -1 : 1;

            if (targetType === ParticipationType.MINISTERIO || targetType === ParticipationType.AJUDANTE) {
                const isPublisherA = a.publisher.condition === 'Publicador';
                const isPublisherB = b.publisher.condition === 'Publicador';
                if (isPublisherA && !isPublisherB) return -1;
                if (!isPublisherA && isPublisherB) return 1;
            }
            
            if (a.lastDate === 0 && b.lastDate !== 0) return -1;
            if (a.lastDate !== 0 && b.lastDate === 0) return 1;
            return a.lastDate - b.lastDate;
        });
};

export const performAutoFill = (
    parts: PartToAssign[],
    currentAssignments: Record<string, AssignmentState>,
    publishers: Publisher[],
    participations: Participation[],
    rules: Rule[],
    weekLabel: string
): Record<string, AssignmentState> => {
    const newAssignments: Record<string, AssignmentState> = { ...currentAssignments };
    const tempUsedIds = new Set<string>();
    
    // Identify President Part
    const presidentPart = parts.find(p => p.type === ParticipationType.PRESIDENTE && p.partTitle === 'Presidente');

    // Pre-fill used IDs from existing assignments
    (Object.values(newAssignments) as AssignmentState[]).forEach((a) => {
        if (a.studentId) tempUsedIds.add(a.studentId);
        if (a.helperId) tempUsedIds.add(a.helperId!);
    });

    // --- PHASE 1: Prioritize President Assignment ---
    let presidentId = presidentPart ? newAssignments[presidentPart.id]?.studentId : undefined;
    
    if (presidentPart && !presidentId) {
         const candidates = getSortedCandidates(presidentPart, false, publishers, participations, rules, weekLabel, false).filter(c => c.isValid);
         const bestCandidate = candidates.find(c => !tempUsedIds.has(c.publisher.id));
         if (bestCandidate) {
             presidentId = bestCandidate.publisher.id;
             newAssignments[presidentPart.id] = { ...newAssignments[presidentPart.id], studentId: presidentId };
             tempUsedIds.add(presidentId);
         }
    }

    // --- PHASE 2: Assign Remaining Parts ---
    parts.forEach(part => {
        if (presidentPart && part.id === presidentPart.id) return;

        let currentStudentId = newAssignments[part.id]?.studentId;
        let currentHelperId = newAssignments[part.id]?.helperId;

        // 1. Assign Student/Principal
        if (!currentStudentId) {
            if (part.preAssignedTo === 'Presidente') {
                if (presidentId) {
                    currentStudentId = presidentId;
                    newAssignments[part.id] = { ...newAssignments[part.id], studentId: currentStudentId };
                }
            } else if (part.preAssignedTo) {
                const prePub = publishers.find(p => normalizeName(p.name) === normalizeName(part.preAssignedTo!));
                if (prePub) {
                    currentStudentId = prePub.id;
                    newAssignments[part.id] = { ...newAssignments[part.id], studentId: currentStudentId };
                    tempUsedIds.add(currentStudentId);
                }
            } else {
                const candidates = getSortedCandidates(part, false, publishers, participations, rules, weekLabel, false).filter(c => c.isValid);
                const bestCandidate = candidates.find(c => !tempUsedIds.has(c.publisher.id));
                if (bestCandidate) {
                    currentStudentId = bestCandidate.publisher.id;
                    newAssignments[part.id] = { ...newAssignments[part.id], studentId: currentStudentId };
                    tempUsedIds.add(currentStudentId);
                }
            }
        } else {
            if (part.preAssignedTo !== 'Presidente') {
                tempUsedIds.add(currentStudentId);
            }
        }

        // 2. Assign Helper
        if (part.requiresHelper && !currentHelperId && currentStudentId) {
            const candidates = getSortedCandidates(part, true, publishers, participations, rules, weekLabel, false).filter(c => c.isValid);
            const student = publishers.find(p => p.id === currentStudentId);
            
            const bestHelper = candidates.find(c => {
                if (tempUsedIds.has(c.publisher.id)) return false;
                if (c.publisher.id === currentStudentId) return false;
                if (student && !validatePairing(student, c.publisher).isValid) return false;
                return true;
            });

            if (bestHelper) {
                currentHelperId = bestHelper.publisher.id;
                newAssignments[part.id] = { ...newAssignments[part.id], helperId: currentHelperId };
                tempUsedIds.add(currentHelperId);
            }
        }
    });

    return newAssignments;
};
